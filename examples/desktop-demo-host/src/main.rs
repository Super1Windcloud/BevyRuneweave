//! Cross-platform desktop launcher for downloading assets and starting a scripting runtime.

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use eframe::egui;
use flate2::read::GzDecoder;
use libloading::{Library, Symbol};
use lzma_rust2::XzReader;
use serde::Deserialize;
use std::{
    ffi::{CString, OsStr, c_char, c_int},
    fs::{self, File},
    io::{self, Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    thread,
};

const CONFIG_FILE: &str = "engineConfig.json";
const BUILD_TARGET: &str = env!("RUNEWEAVE_BUILD_TARGET");

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Language {
    Js,
    TypeScript,
    Lua,
}

impl Language {
    fn directory(self) -> &'static str {
        match self {
            Self::Js => "js",
            Self::TypeScript => "typescript",
            Self::Lua => "lua",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineConfig {
    schema_version: u32,
    name: String,
    version: String,
    script: ScriptConfig,
}

#[derive(Deserialize)]
struct ScriptConfig {
    language: Language,
    entry: PathBuf,
}

struct LauncherApp {
    url: String,
    downloading: bool,
    error: Option<String>,
    result: Option<Receiver<Result<(), String>>>,
    launch: Arc<AtomicBool>,
}

impl LauncherApp {
    fn new(launch: Arc<AtomicBool>) -> Self {
        Self {
            url: String::new(),
            downloading: false,
            error: None,
            result: None,
            launch,
        }
    }

    fn start_download(&mut self, context: &egui::Context) {
        let url = self.url.trim().to_owned();
        if url.is_empty() {
            self.error = Some("Enter an asset package URL".to_owned());
            return;
        }

        let (sender, receiver) = mpsc::channel();
        let context = context.clone();
        self.downloading = true;
        self.error = None;
        self.result = Some(receiver);
        thread::spawn(move || {
            let _ = sender.send(download_and_install(&url));
            context.request_repaint();
        });
    }

    fn poll_download(&mut self, context: &egui::Context) {
        let Some(receiver) = &self.result else {
            return;
        };
        let Ok(result) = receiver.try_recv() else {
            return;
        };

        self.result = None;
        self.downloading = false;
        match result {
            Ok(()) => {
                self.launch.store(true, Ordering::Release);
                context.send_viewport_cmd(egui::ViewportCommand::Close);
            }
            Err(error) => self.error = Some(error),
        }
    }
}

impl eframe::App for LauncherApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let context = ui.ctx().clone();
        self.poll_download(&context);
        egui::Frame::central_panel(ui.style()).show(ui, |ui| {
            ui.add_space(12.0);
            ui.heading("Bevy RuneWeave");
            ui.add_space(12.0);

            let response = ui.add_enabled(
                !self.downloading,
                egui::TextEdit::singleline(&mut self.url)
                    .hint_text("Asset package URL")
                    .desired_width(f32::INFINITY),
            );
            let submit =
                response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));

            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if self.downloading {
                    ui.spinner();
                    ui.label("Downloading...");
                } else if ui.button("Start Game").clicked() || submit {
                    self.start_download(&context);
                }
            });

            if let Some(error) = &self.error {
                ui.add_space(8.0);
                ui.colored_label(ui.visuals().error_fg_color, error);
            }
        });
    }
}

fn repo_root() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    if let Some(directory) = executable.parent()
        && directory.join("lib").is_dir()
    {
        return Ok(directory.to_path_buf());
    }
    for ancestor in executable.ancestors() {
        if ancestor.join("include/game_runtime.h").is_file() {
            return Ok(ancestor.to_path_buf());
        }
    }
    let current = std::env::current_dir().map_err(|error| error.to_string())?;
    if current.join("include/game_runtime.h").is_file() {
        Ok(current)
    } else {
        Err("Could not find the Bevy RuneWeave runtime directory".to_owned())
    }
}

fn load_config(assets: &Path) -> Result<EngineConfig, String> {
    let bytes = fs::read(assets.join(CONFIG_FILE))
        .map_err(|error| format!("Could not read {CONFIG_FILE}: {error}"))?;
    let config: EngineConfig = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse {CONFIG_FILE}: {error}"))?;
    if config.schema_version != 1 {
        return Err(format!(
            "Unsupported engineConfig schemaVersion: {}",
            config.schema_version
        ));
    }
    if config.name.trim().is_empty() || config.version.trim().is_empty() {
        return Err("engineConfig name and version must not be empty".to_owned());
    }
    if config.script.entry.is_absolute()
        || config
            .script
            .entry
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("script.entry must be a relative path inside assets".to_owned());
    }
    if !assets.join(&config.script.entry).is_file() {
        return Err(format!(
            "Script entry does not exist: {}",
            config.script.entry.display()
        ));
    }
    Ok(config)
}

#[derive(Clone, Copy, Debug)]
enum ArchiveFormat {
    Zip,
    Tar,
    Gzip,
    Zstd,
    Xz,
    SevenZip,
    Rar,
}

fn detect_archive_format(bytes: &[u8]) -> Option<ArchiveFormat> {
    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
    {
        Some(ArchiveFormat::Zip)
    } else if bytes.starts_with(b"\x1f\x8b") {
        Some(ArchiveFormat::Gzip)
    } else if bytes.starts_with(b"\x28\xb5\x2f\xfd") {
        Some(ArchiveFormat::Zstd)
    } else if bytes.starts_with(b"\xfd7zXZ\0") {
        Some(ArchiveFormat::Xz)
    } else if bytes.starts_with(b"7z\xbc\xaf'\x1c") {
        Some(ArchiveFormat::SevenZip)
    } else if bytes.starts_with(b"Rar!\x1a\x07") {
        Some(ArchiveFormat::Rar)
    } else if looks_like_tar(bytes) {
        Some(ArchiveFormat::Tar)
    } else {
        None
    }
}

fn looks_like_tar(bytes: &[u8]) -> bool {
    if bytes.len() < 512 {
        return false;
    }
    let mut archive = tar::Archive::new(Cursor::new(bytes));
    archive
        .entries()
        .and_then(|mut entries| entries.next().transpose())
        .is_ok()
}

fn safe_relative(path: &Path) -> Result<PathBuf, String> {
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Archive entry escapes its destination: {}",
                    path.display()
                ));
            }
        }
    }
    if safe.as_os_str().is_empty() {
        Err("Archive contains an empty entry path".to_owned())
    } else {
        Ok(safe)
    }
}

fn extract_package(bytes: &[u8], source_name: &str, destination: &Path) -> Result<(), String> {
    match detect_archive_format(bytes).ok_or_else(|| "Unsupported archive format".to_owned())? {
        ArchiveFormat::Zip => extract_zip(bytes, destination),
        ArchiveFormat::Tar => extract_tar(Cursor::new(bytes), destination),
        ArchiveFormat::Gzip => extract_compressed(GzDecoder::new(bytes), source_name, destination),
        ArchiveFormat::Zstd => {
            let decoder = zstd::stream::read::Decoder::new(bytes)
                .map_err(|error| format!("Could not open zstd stream: {error}"))?;
            extract_compressed(decoder, source_name, destination)
        }
        ArchiveFormat::Xz => {
            extract_compressed(XzReader::new(bytes, true), source_name, destination)
        }
        ArchiveFormat::SevenZip => extract_seven_zip(bytes, destination),
        ArchiveFormat::Rar => extract_rar(bytes, destination),
    }
}

fn extract_zip(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Could not open ZIP archive: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read ZIP entry: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe ZIP entry path: {}", entry.name()))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!(
                "ZIP symbolic links are not supported: {}",
                entry.name()
            ));
        }
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = File::create(&target).map_err(|error| error.to_string())?;
            io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn extract_tar<R: Read>(reader: R, destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| format!("Could not read tar archive: {error}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|error| format!("Could not read tar entry: {error}"))?;
        let unpacked = entry
            .unpack_in(destination)
            .map_err(|error| format!("Could not extract tar entry: {error}"))?;
        if !unpacked {
            return Err("Tar entry escapes its destination".to_owned());
        }
    }
    Ok(())
}

fn extract_compressed<R: Read>(
    mut reader: R,
    source_name: &str,
    destination: &Path,
) -> Result<(), String> {
    let mut decoded = Vec::new();
    reader
        .read_to_end(&mut decoded)
        .map_err(|error| format!("Could not decompress stream: {error}"))?;
    if looks_like_tar(&decoded) {
        return extract_tar(Cursor::new(decoded), destination);
    }

    let output_name = compressed_output_name(source_name)?;
    fs::write(destination.join(output_name), decoded).map_err(|error| error.to_string())
}

fn compressed_output_name(source_name: &str) -> Result<&str, String> {
    let file_name = Path::new(source_name)
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "Compressed download has no valid file name".to_owned())?;
    for suffix in [".gzip", ".gz", ".zstd", ".zst", ".xz"] {
        if let Some(stem) = file_name.strip_suffix(suffix)
            && !stem.is_empty()
        {
            return Ok(stem);
        }
    }
    Err(format!("Could not determine output name for {file_name}"))
}

fn extract_seven_zip(bytes: &[u8], destination: &Path) -> Result<(), String> {
    sevenz_rust::decompress_with_extract_fn(
        Cursor::new(bytes),
        destination,
        |entry, reader, _default_path| {
            let relative =
                safe_relative(Path::new(entry.name())).map_err(sevenz_rust::Error::other)?;
            let target = destination.join(relative);
            if entry.is_directory() {
                fs::create_dir_all(&target).map_err(sevenz_rust::Error::io)?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(sevenz_rust::Error::io)?;
                }
                let mut output = File::create(target).map_err(sevenz_rust::Error::io)?;
                io::copy(reader, &mut output).map_err(sevenz_rust::Error::io)?;
            }
            Ok(true)
        },
    )
    .map_err(|error| format!("Could not extract 7z archive: {error}"))
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn extract_rar(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut source = tempfile::NamedTempFile::new()
        .map_err(|error| format!("Could not create temporary RAR file: {error}"))?;
    source
        .write_all(bytes)
        .and_then(|()| source.flush())
        .map_err(|error| format!("Could not write temporary RAR file: {error}"))?;
    let mut archive = unrar::Archive::new(source.path())
        .open_for_processing()
        .map_err(|error| format!("Could not open RAR archive: {error}"))?;
    while let Some(header) = archive
        .read_header()
        .map_err(|error| format!("Could not read RAR entry: {error}"))?
    {
        let relative = safe_relative(&header.entry().filename)?;
        let target = destination.join(relative);
        if header.entry().is_directory() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            archive = header
                .skip()
                .map_err(|error| format!("Could not skip RAR directory: {error}"))?;
        } else {
            let (data, remaining) = header
                .read()
                .map_err(|error| format!("Could not extract RAR entry: {error}"))?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(target, data).map_err(|error| error.to_string())?;
            archive = remaining;
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn extract_rar(_bytes: &[u8], _destination: &Path) -> Result<(), String> {
    Err("RAR extraction is not supported on this operating system".to_owned())
}

fn download_and_install(url: &str) -> Result<(), String> {
    let root = repo_root()?;
    let response = reqwest::blocking::Client::builder()
        .user_agent("BevyRuneWeave-Desktop-Demo/0.1")
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Download failed: {error}"))?;
    let source_name = response
        .url()
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).next_back())
        .unwrap_or("package")
        .to_owned();
    let bytes = response
        .bytes()
        .map_err(|error| format!("Could not read download: {error}"))?;
    let staging = tempfile::Builder::new()
        .prefix("bevy-runeweave-assets-")
        .tempdir_in(&root)
        .map_err(|error| format!("Could not create staging directory: {error}"))?;

    extract_package(&bytes, &source_name, staging.path())?;
    let config_path =
        find_config(staging.path())?.ok_or_else(|| format!("Package is missing {CONFIG_FILE}"))?;
    let package_root = config_path
        .parent()
        .ok_or_else(|| "Invalid engineConfig.json path".to_owned())?;
    load_config(package_root)?;
    install_tree(package_root, &root.join("assets"))
}

fn find_config(directory: &Path) -> Result<Option<PathBuf>, String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            if let Some(found) = find_config(&path)? {
                return Ok(Some(found));
            }
        } else if path.file_name() == Some(OsStr::new(CONFIG_FILE)) {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn install_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            install_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn platform_directory() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn runtime_library_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "bevy_runeweave.dll"
    } else if cfg!(target_os = "macos") {
        "libbevy_runeweave.dylib"
    } else {
        "libbevy_runeweave.so"
    }
}

fn run_game() -> Result<(), String> {
    let root = repo_root()?;
    std::env::set_current_dir(&root).map_err(|error| error.to_string())?;
    let config = load_config(&root.join("assets"))?;
    let executable_dir = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not determine the launcher directory".to_owned())?;
    let language = config.script.language.directory();
    let library_name = runtime_library_name();
    let bundled = executable_dir.join("lib").join(language).join(library_name);
    let development = root
        .join("dist/runtimes")
        .join(platform_directory())
        .join(language)
        .join(BUILD_TARGET)
        .join("lib")
        .join(library_name);
    let library_path = if bundled.is_file() {
        bundled
    } else {
        development
    };
    let library = unsafe { Library::new(&library_path) }
        .map_err(|error| format!("Could not load {}: {error}", library_path.display()))?;
    type Run = unsafe extern "C" fn(*const c_char) -> c_int;
    let run: Symbol<'_, Run> = unsafe { library.get(b"game_runtime_run\0") }
        .map_err(|error| format!("Could not find game_runtime_run: {error}"))?;
    let script = CString::new(config.script.entry.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())?;
    let code = unsafe { run(script.as_ptr()) };
    if code == 0 {
        Ok(())
    } else {
        Err(format!("Game runtime returned error code {code}"))
    }
}

fn main() -> eframe::Result {
    let launch = Arc::new(AtomicBool::new(false));
    let app_launch = Arc::clone(&launch);
    let icon =
        eframe::icon_data::from_png_bytes(include_bytes!("../../../assets/branding/bevy_icon.png"))
            .unwrap_or_default();
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1000.0, 693.0])
            .with_min_inner_size([420.0, 210.0])
            .with_icon(icon)
            .with_resizable(true),
        ..Default::default()
    };
    eframe::run_native(
        "Bevy RuneWeave",
        options,
        Box::new(move |_creation_context| Ok(Box::new(LauncherApp::new(app_launch)))),
    )?;
    if launch.load(Ordering::Acquire)
        && let Err(error) = run_game()
    {
        eprintln!("Bevy RuneWeave: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use lzma_rust2::{XzOptions, XzWriter};
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    const CONTENT: &[u8] = b"archive format test";

    fn zip_bytes(name: &str, content: &[u8]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file(name, options).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn tar_bytes() -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(CONTENT.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "nested/test.txt", CONTENT)
            .unwrap();
        builder.into_inner().unwrap()
    }

    fn assert_single_file(bytes: &[u8], source_name: &str, relative: &str) {
        let destination = tempfile::tempdir().unwrap();
        extract_package(bytes, source_name, destination.path()).unwrap();
        assert_eq!(
            fs::read(destination.path().join(relative)).unwrap(),
            CONTENT
        );
    }

    #[test]
    fn extracts_zip() {
        assert_single_file(
            &zip_bytes("nested/test.txt", CONTENT),
            "package.zip",
            "nested/test.txt",
        );
    }

    #[test]
    fn extracts_tar() {
        assert_single_file(&tar_bytes(), "package.tar", "nested/test.txt");
    }

    #[test]
    fn extracts_gzip_stream() {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(CONTENT).unwrap();
        assert_single_file(&encoder.finish().unwrap(), "test.txt.gz", "test.txt");
    }

    #[test]
    fn extracts_zstd_stream() {
        let bytes = zstd::stream::encode_all(CONTENT, 1).unwrap();
        assert_single_file(&bytes, "test.txt.zst", "test.txt");
    }

    #[test]
    fn extracts_xz_stream() {
        let mut bytes = Vec::new();
        {
            let mut writer = XzWriter::new(&mut bytes, XzOptions::with_preset(1)).unwrap();
            writer.write_all(CONTENT).unwrap();
            writer.finish().unwrap();
        }
        assert_single_file(&bytes, "test.txt.xz", "test.txt");
    }

    #[test]
    fn extracts_seven_zip_read_only() {
        let bytes = include_bytes!("../tests/fixtures/sample.7z");
        let destination = tempfile::tempdir().unwrap();
        extract_package(bytes, "sample.7z", destination.path()).unwrap();
        assert_eq!(
            fs::read_to_string(destination.path().join("file1.txt")).unwrap(),
            "file one content\n"
        );
        assert_eq!(
            fs::read_to_string(destination.path().join("file2.txt")).unwrap(),
            "file two content\n"
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn extracts_rar_read_only() {
        let bytes = include_bytes!("../tests/fixtures/sample.rar");
        let destination = tempfile::tempdir().unwrap();
        extract_package(bytes, "sample.rar", destination.path()).unwrap();
        assert_eq!(
            fs::read_to_string(destination.path().join("VERSION")).unwrap(),
            "unrar-0.4.0"
        );
    }

    #[test]
    fn rejects_zip_path_traversal() {
        let bytes = zip_bytes("../escaped.txt", CONTENT);
        let destination = tempfile::tempdir().unwrap();
        let error = extract_package(&bytes, "unsafe.zip", destination.path()).unwrap_err();
        assert!(error.contains("Unsafe ZIP entry path"));
        assert!(
            !destination
                .path()
                .parent()
                .unwrap()
                .join("escaped.txt")
                .exists()
        );
    }
}
