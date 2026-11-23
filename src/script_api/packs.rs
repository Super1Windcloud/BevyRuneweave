//! Verified immutable resource packs. Workers perform disk/network I/O outside the Bevy frame.

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

use bevy::prelude::*;
use bevy_mod_scripting::{
    bindings::{FunctionCallContext, InteropError, ScriptValue, WorldExtensions},
    core::event::ScriptDetachedEvent,
    script::ScriptAttachment,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 4096;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackFile {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    url: String,
    bytes: u64,
    sha256: String,
    files: Vec<PackFile>,
}

#[cfg(test)]
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && !value.contains(['\\', ':'])
        && !value.chars().any(char::is_control)
}
impl Descriptor {
    fn parse(json: &str) -> Result<Self, String> {
        if json.len() > 1024 * 1024 {
            return Err("invalid_manifest".into());
        }
        let descriptor: Self = serde_json::from_str(json).map_err(|_| "invalid_manifest")?;
        let url = reqwest::Url::parse(&descriptor.url).map_err(|_| "invalid_url")?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err("invalid_url".into());
        }
        if descriptor.bytes == 0
            || descriptor.bytes > MAX_BYTES
            || !valid_hash(&descriptor.sha256)
            || descriptor.files.is_empty()
            || descriptor.files.len() > MAX_FILES
        {
            return Err("invalid_manifest".into());
        }
        let mut names = HashSet::new();
        let mut bytes = 0_u64;
        for file in &descriptor.files {
            if !valid_path(&file.path)
                || !valid_hash(&file.sha256)
                || !names.insert(file.path.to_ascii_lowercase())
            {
                return Err("invalid_manifest".into());
            }
            bytes = bytes
                .checked_add(file.bytes)
                .filter(|n| *n <= MAX_BYTES)
                .ok_or("too_large")?;
        }
        Ok(descriptor)
    }
}

#[derive(Clone)]
enum State {
    Pending(u64, u64),
    Ready(String),
    Error(String),
}
struct Job {
    state: Arc<Mutex<State>>,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Job {
    fn state(&self) -> State {
        // If the worker already exited, any result it published is visible below.
        let finished = self.worker.as_ref().is_some_and(JoinHandle::is_finished);
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if finished && matches!(*state, State::Pending(..)) {
            return State::Error("unavailable".into());
        }
        state.clone()
    }
}

/// The named Bevy asset source and the download workers share this project-independent root.
pub(crate) fn cache_root() -> Option<PathBuf> {
    super::storage::native_data_root().map(|p| p.join("resource-packs"))
}

#[derive(Resource, Default)]
pub(crate) struct ScriptPacks {
    project: Option<String>,
    assets: PathBuf,
    bindings: HashMap<ScriptAttachment, (Option<String>, PathBuf)>,
    jobs: HashMap<(ScriptAttachment, u32), Job>,
    next: u32,
}
impl ScriptPacks {
    pub(crate) fn for_assets(assets: &Path) -> Self {
        let project = fs::read(assets.join("engineConfig.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|c| c.get("name")?.as_str().map(str::to_owned))
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 64
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
            });
        Self {
            project,
            assets: assets.to_path_buf(),
            ..default()
        }
    }
    pub(crate) fn refresh_for_assets(&mut self, assets: &Path) {
        let next = Self::for_assets(assets);
        self.project = next.project;
        self.assets = next.assets;
    }
    fn request(&mut self, owner: ScriptAttachment, json: &str) -> u32 {
        self.next = self.next.wrapping_add(1).max(1);
        let id = self.next;
        let state = Arc::new(Mutex::new(State::Pending(0, 0)));
        let job_cancel = Arc::new(AtomicBool::new(false));
        let descriptor = Descriptor::parse(json);
        let active = self
            .jobs
            .keys()
            .filter(|(candidate, _)| candidate == &owner)
            .count();
        if active >= 8 {
            return 0;
        }
        let (project, assets) = self
            .bindings
            .entry(owner.clone())
            .or_insert_with(|| (self.project.clone(), self.assets.clone()))
            .clone();
        let worker_state = state.clone();
        let cancel = job_cancel.clone();
        let worker = std::thread::Builder::new()
            .name("resource-pack".into())
            .spawn(move || {
                let outcome = (|| {
                    let descriptor = descriptor?;
                    let project = project.ok_or("unavailable")?;
                    let root = cache_root().ok_or("unavailable")?.join(&project);
                    // Full development bundles remain runnable offline without copying their assets.
                    if verified_files(&assets, &descriptor.files, &cancel) {
                        return Ok(String::new());
                    }
                    let target = root.join(&descriptor.sha256);
                    if verified_files(&target, &descriptor.files, &cancel) {
                        return Ok(format!("cache://{project}/{}/", descriptor.sha256));
                    }
                    fs::create_dir_all(&root).map_err(|_| "io")?;
                    let mut archive = tempfile::NamedTempFile::new_in(&root).map_err(|_| "io")?;
                    download(&descriptor, &mut archive, &worker_state, &cancel)?;
                    let staging = tempfile::tempdir_in(&root).map_err(|_| "io")?;
                    extract(
                        &descriptor,
                        archive.reopen().map_err(|_| "io")?,
                        staging.path(),
                        &cancel,
                    )?;
                    if cancel.load(Ordering::Relaxed) {
                        return Err("cancelled".into());
                    }
                    if target.exists() {
                        if verified_files(&target, &descriptor.files, &cancel) {
                            return Ok(format!("cache://{project}/{}/", descriptor.sha256));
                        }
                        // Preserve a corrupt old cache for diagnosis; never replace a valid pack in place.
                        let quarantine = root.join(format!(".invalid-{}-{id}", descriptor.sha256));
                        fs::rename(&target, quarantine).map_err(|_| "io")?;
                    }
                    fs::rename(staging.path(), &target).map_err(|_| "io")?;
                    Ok(format!("cache://{project}/{}/", descriptor.sha256))
                })();
                *worker_state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = match outcome {
                    Ok(root) => State::Ready(root),
                    Err(code) => State::Error(code),
                };
            })
            .ok();
        if worker.is_none() {
            *state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                State::Error("unavailable".into());
        }
        self.jobs.insert(
            (owner, id),
            Job {
                state,
                cancel: job_cancel,
                worker,
            },
        );
        id
    }
    fn poll(&mut self, owner: ScriptAttachment, id: u32) -> ScriptValue {
        let key = (owner, id);
        let state = self.jobs.get(&key).map(Job::state);
        let mut fields = bevy::platform::collections::HashMap::default();
        let status = match &state {
            Some(State::Pending(received, total)) => {
                fields.insert("received".into(), ScriptValue::Integer(*received as i64));
                fields.insert("total".into(), ScriptValue::Integer(*total as i64));
                "pending"
            }
            Some(State::Ready(root)) => {
                fields.insert("root".into(), ScriptValue::from(root.clone()));
                "ready"
            }
            Some(State::Error(error)) => {
                fields.insert("error".into(), ScriptValue::from(error.clone()));
                "error"
            }
            None => "unknown",
        };
        fields.insert("state".into(), ScriptValue::from(status));
        if !matches!(state, Some(State::Pending(..))) {
            self.jobs.remove(&key);
        }
        ScriptValue::Map(fields)
    }
}

fn verified_files(root: &Path, files: &[PackFile], cancel: &AtomicBool) -> bool {
    files.iter().all(|file| {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let path = root.join(&file.path);
        let Ok(meta) = fs::symlink_metadata(&path) else {
            return false;
        };
        if !meta.is_file() || meta.len() != file.bytes {
            return false;
        }
        let Ok(input) = File::open(path) else {
            return false;
        };
        let mut hasher = Sha256::new();
        let Ok(count) = std::io::copy(&mut input.take(file.bytes + 1), &mut hasher) else {
            return false;
        };
        count == file.bytes && format!("{:x}", hasher.finalize()) == file.sha256
    })
}
fn download(
    descriptor: &Descriptor,
    archive: &mut tempfile::NamedTempFile,
    state: &Mutex<State>,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let client = super::network::http_client_builder()
        .map_err(|_| "network")?
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" || attempt.previous().len() >= 10 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "network")?;
    let mut response = client
        .get(&descriptor.url)
        .header(reqwest::header::USER_AGENT, "Runeweave-resource-packs")
        .send()
        .map_err(|_| "network")?
        .error_for_status()
        .map_err(|_| "http")?;
    if response
        .content_length()
        .is_some_and(|n| n != descriptor.bytes)
    {
        return Err("size_mismatch".into());
    }
    let mut hasher = Sha256::new();
    let mut received = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let n = response.read(&mut buffer).map_err(|_| "network")?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > descriptor.bytes {
            return Err("size_mismatch".into());
        }
        hasher.update(&buffer[..n]);
        archive.write_all(&buffer[..n]).map_err(|_| "io")?;
        *state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            State::Pending(received, descriptor.bytes);
    }
    if received != descriptor.bytes || format!("{:x}", hasher.finalize()) != descriptor.sha256 {
        return Err("checksum_mismatch".into());
    }
    archive.as_file().sync_all().map_err(|_| "io")?;
    Ok(())
}
fn extract(
    descriptor: &Descriptor,
    archive: File,
    root: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(archive).map_err(|_| "invalid_archive")?;
    if zip.len() != descriptor.files.len() {
        return Err("invalid_archive".into());
    }
    let expected: HashMap<_, _> = descriptor
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut seen = HashSet::new();
    for i in 0..zip.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let mut entry = zip.by_index(i).map_err(|_| "invalid_archive")?;
        let name = entry.name().to_owned();
        let file = expected.get(name.as_str()).ok_or("unexpected_file")?;
        if !valid_path(&name)
            || !seen.insert(name.clone())
            || entry.is_dir()
            || entry.is_symlink()
            || entry.size() != file.bytes
        {
            return Err("invalid_archive".into());
        }
        let destination = root.join(name);
        fs::create_dir_all(destination.parent().ok_or("invalid_archive")?).map_err(|_| "io")?;
        let mut output = File::create(destination).map_err(|_| "io")?;
        let mut hasher = Sha256::new();
        let mut total = 0;
        let mut buffer = [0; 64 * 1024];
        loop {
            let n = entry.read(&mut buffer).map_err(|_| "invalid_archive")?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > file.bytes {
                return Err("size_mismatch".into());
            }
            hasher.update(&buffer[..n]);
            output.write_all(&buffer[..n]).map_err(|_| "io")?;
        }
        if total != file.bytes || format!("{:x}", hasher.finalize()) != file.sha256 {
            return Err("checksum_mismatch".into());
        }
        output.sync_all().map_err(|_| "io")?;
    }
    Ok(())
}

pub(super) fn asset_pack_request(
    context: FunctionCallContext,
    descriptor: String,
) -> Result<u32, InteropError> {
    let (world, owner) = super::current_script(&context)?;
    world.with_world_mut(|world| {
        world
            .resource_mut::<ScriptPacks>()
            .request(owner, &descriptor)
    })
}
pub(super) fn asset_pack_poll(
    context: FunctionCallContext,
    id: u32,
) -> Result<ScriptValue, InteropError> {
    let (world, owner) = super::current_script(&context)?;
    world.with_world_mut(|world| world.resource_mut::<ScriptPacks>().poll(owner, id))
}
pub(super) fn clear_detached_packs(
    mut events: MessageReader<ScriptDetachedEvent>,
    mut packs: ResMut<ScriptPacks>,
) {
    for event in events.read() {
        packs.bindings.remove(&event.0);
        packs.jobs.retain(|(owner, _), job| {
            if owner == &event.0 {
                job.cancel.store(true, Ordering::Relaxed);
                false
            } else {
                true
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_mod_scripting::asset::ScriptAsset;

    fn descriptor(name: &str, contents: &[u8]) -> Descriptor {
        Descriptor {
            url: "https://example.com/pack.zip".into(),
            bytes: 123,
            sha256: digest(b"archive"),
            files: vec![PackFile {
                path: name.into(),
                bytes: contents.len() as u64,
                sha256: digest(contents),
            }],
        }
    }
    fn json(descriptor: &Descriptor) -> String {
        serde_json::json!({"url": descriptor.url, "bytes": descriptor.bytes, "sha256": descriptor.sha256, "files": descriptor.files.iter().map(|f| serde_json::json!({"path":f.path,"bytes":f.bytes,"sha256":f.sha256})).collect::<Vec<_>>()}).to_string()
    }
    fn archive(root: &Path, name: &str, contents: &[u8]) -> File {
        let file = File::create(root.join("pack.zip")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(contents).unwrap();
        zip.finish().unwrap();
        File::open(root.join("pack.zip")).unwrap()
    }
    #[test]
    fn manifests_reject_traversal_urls_duplicates_and_oversized_packs() {
        for name in [
            "../escape",
            "/absolute",
            "C:/drive",
            "folder\\escape",
            "a//b",
            "a/./b",
        ] {
            assert!(
                Descriptor::parse(&json(&descriptor(name, b"x"))).is_err(),
                "{name}"
            );
        }
        let mut d = descriptor("models/kart.glb", b"x");
        d.url = "http://example.com/file".into();
        assert!(Descriptor::parse(&json(&d)).is_err());
        d.url = "https://user:secret@example.com/file".into();
        assert!(Descriptor::parse(&json(&d)).is_err());
        d.url = "https://example.com/file".into();
        d.bytes = MAX_BYTES + 1;
        assert!(Descriptor::parse(&json(&d)).is_err());
        d.bytes = 123;
        d.files.push(d.files[0].clone());
        assert!(Descriptor::parse(&json(&d)).is_err());
        d.files[1].path = "models/KART.glb".into();
        assert!(Descriptor::parse(&json(&d)).is_err());
    }
    #[test]
    fn extraction_verifies_contents_and_cache_corruption_is_detected() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let d = descriptor("models/kart.glb", b"verified model");
        let cancel = AtomicBool::new(false);
        extract(
            &d,
            archive(source.path(), "models/kart.glb", b"verified model"),
            destination.path(),
            &cancel,
        )
        .unwrap();
        assert!(verified_files(destination.path(), &d.files, &cancel));
        fs::write(
            destination.path().join("models/kart.glb"),
            b"corruptd model",
        )
        .unwrap();
        assert!(!verified_files(destination.path(), &d.files, &cancel));
        assert_eq!(
            extract(
                &d,
                archive(source.path(), "models/kart.glb", b"wrong contents"),
                destination.path(),
                &cancel
            )
            .unwrap_err(),
            "checksum_mismatch"
        );
    }
    #[test]
    fn archives_cannot_install_unlisted_files_and_cancellation_stops_installation() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let d = descriptor("models/kart.glb", b"model");
        let cancel = AtomicBool::new(false);
        assert_eq!(
            extract(
                &d,
                archive(source.path(), "other.glb", b"model"),
                destination.path(),
                &cancel
            )
            .unwrap_err(),
            "unexpected_file"
        );
        cancel.store(true, Ordering::Relaxed);
        assert_eq!(
            extract(
                &d,
                archive(source.path(), "models/kart.glb", b"model"),
                destination.path(),
                &cancel
            )
            .unwrap_err(),
            "cancelled"
        );
        assert!(!destination.path().join("models/kart.glb").exists());
    }
    #[test]
    fn a_worker_exit_without_a_result_returns_a_consumable_error() {
        let worker = std::thread::spawn(|| {});
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !worker.is_finished() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        let owner = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let mut packs = ScriptPacks::default();
        packs.jobs.insert(
            (owner.clone(), 1),
            Job {
                state: Arc::new(Mutex::new(State::Pending(0, 0))),
                cancel: Arc::default(),
                worker: Some(worker),
            },
        );
        assert!(matches!(
            packs.poll(owner.clone(), 1),
            ScriptValue::Map(fields)
                if fields.get("state") == Some(&ScriptValue::from("error"))
                    && fields.get("error") == Some(&ScriptValue::from("unavailable"))
        ));
        assert!(!packs.jobs.contains_key(&(owner, 1)));
    }

    #[test]
    fn bundled_resources_verify_offline_and_requests_are_attachment_scoped() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("engineConfig.json"),
            br#"{"name":"pack-test"}"#,
        )
        .unwrap();
        fs::write(root.path().join("model.glb"), b"model").unwrap();
        let mut packs = ScriptPacks::for_assets(root.path());
        let owner = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let other = ScriptAttachment::EntityScript(Entity::PLACEHOLDER, Handle::default());
        let id = packs.request(owner.clone(), &json(&descriptor("model.glb", b"model")));
        assert!(
            matches!(packs.poll(other, id), ScriptValue::Map(fields) if fields.get("state") == Some(&ScriptValue::from("unknown")))
        );
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let ScriptValue::Map(fields) = packs.poll(owner.clone(), id) else {
                panic!("map required")
            };
            if fields.get("state") == Some(&ScriptValue::from("ready")) {
                assert_eq!(fields.get("root"), Some(&ScriptValue::from("")));
                break;
            }
            assert!(std::time::Instant::now() < deadline, "{fields:?}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
