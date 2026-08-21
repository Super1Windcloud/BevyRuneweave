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
    process::Command,
    sync::mpsc::{self, Receiver},
    thread,
};

const CONFIG_FILE: &str = "engineConfig.json";
const ACTIVE_PROJECT_FILE: &str = "active-project";
const BUILD_TARGET: &str = env!("RUNEWEAVE_BUILD_TARGET");
const GITHUB_API_ROOT: &str = "https://api.github.com/repos/Super1Windcloud/BevyRuneweave";
const GITHUB_RELEASE_DOWNLOAD_ROOT: &str =
    "https://github.com/Super1Windcloud/BevyRuneweave/releases/latest/download";
const FALLBACK_RELEASE_ASSETS: [&str; 3] = [
    "script-squadron-typescript.zip",
    "script-squadron-js.zip",
    "script-squadron-lua.zip",
];
#[cfg(target_os = "macos")]
const LAUNCHER_ICON: &[u8] =
    include_bytes!("../../../assets/branding/bevy_launcher_icon_macos.png");
#[cfg(not(target_os = "macos"))]
const LAUNCHER_ICON: &[u8] = include_bytes!("../../../assets/branding/bevy_icon.png");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProcessMode {
    Launcher,
    Runtime,
}

impl ProcessMode {
    fn from_args() -> Self {
        if std::env::args_os().nth(1).as_deref() == Some(OsStr::new("--run-game")) {
            Self::Runtime
        } else {
            Self::Launcher
        }
    }

    #[cfg(any(not(debug_assertions), test))]
    fn log_file_name(self) -> &'static str {
        match self {
            Self::Launcher => "launcher.log",
            Self::Runtime => "runtime.log",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Language {
    Js,
    TypeScript,
    Lua,
}

impl Language {
    fn label(self) -> &'static str {
        match self {
            Self::Js => "JavaScript",
            Self::TypeScript => "TypeScript",
            Self::Lua => "Lua",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineConfig {
    schema_version: u32,
    name: String,
    version: String,
    #[serde(default, rename = "appName")]
    _app_name: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    script: ScriptConfig,
}

#[derive(Deserialize)]
struct ScriptConfig {
    language: Language,
    entry: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct LatestRelease {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

type RemoteAssetsResult = Result<(String, Vec<ReleaseAsset>), String>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct InstalledGame {
    project: String,
    name: String,
    version: String,
    language: Language,
}

struct LauncherApp {
    url: String,
    downloading: bool,
    installed_games: Vec<InstalledGame>,
    active_project: Option<String>,
    remote_release_tag: Option<String>,
    remote_assets: Vec<ReleaseAsset>,
    error: Option<String>,
    result: Option<Receiver<Result<(), String>>>,
    remote_assets_result: Option<Receiver<RemoteAssetsResult>>,
}

impl LauncherApp {
    fn new() -> Self {
        let mut app = Self {
            url: String::new(),
            downloading: false,
            installed_games: Vec::new(),
            active_project: None,
            remote_release_tag: None,
            remote_assets: Vec::new(),
            error: None,
            result: None,
            remote_assets_result: Some(fetch_remote_assets()),
        };
        if let Err(error) = app.refresh_installed_games() {
            app.error = Some(error);
        }
        app
    }

    fn refresh_installed_games(&mut self) -> Result<(), String> {
        let (installed_games, active_project) = installed_games()?;
        self.installed_games = installed_games;
        self.active_project = active_project;
        Ok(())
    }

    fn start_installed_game(&mut self, project: &str) {
        let result = platform_data_root()
            .and_then(|root| write_active_project(&root, project))
            .and_then(|()| launch_runtime_process());
        match result {
            Ok(()) => {
                self.active_project = Some(project.to_owned());
                self.error = None;
            }
            Err(error) => self.error = Some(error),
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

    fn poll_download(&mut self) {
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
                if let Err(error) = self.refresh_installed_games() {
                    self.error = Some(error);
                } else if let Err(error) = launch_runtime_process() {
                    self.error = Some(error);
                }
            }
            Err(error) => self.error = Some(error),
        }
    }

    fn refresh_remote_assets(&mut self) {
        self.remote_assets_result = Some(fetch_remote_assets());
        self.error = None;
    }

    fn poll_remote_assets(&mut self, context: &egui::Context) {
        let Some(receiver) = &self.remote_assets_result else {
            return;
        };
        let Ok(result) = receiver.try_recv() else {
            return;
        };

        self.remote_assets_result = None;
        match result {
            Ok((tag, assets)) => {
                self.remote_release_tag = Some(tag);
                self.remote_assets = assets;
            }
            Err(error) => self.error = Some(format!("Could not load release assets: {error}")),
        }
        context.request_repaint();
    }
}

impl eframe::App for LauncherApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let context = ui.ctx().clone();
        self.poll_download();
        self.poll_remote_assets(&context);
        egui::Frame::central_panel(ui.style()).show(ui, |ui| {
            ui.add_space(12.0);
            ui.heading("Bevy RuneWeave");
            ui.add_space(12.0);

            ui.horizontal(|ui| {
                let label = self
                    .remote_release_tag
                    .as_deref()
                    .map(|tag| format!("GitHub release assets ({tag})"))
                    .unwrap_or_else(|| "GitHub release assets".to_owned());
                ui.label(label);
                if self.remote_assets_result.is_some() {
                    ui.spinner();
                } else if ui.button("Refresh").clicked() {
                    self.refresh_remote_assets();
                }
            });
            if !self.remote_assets.is_empty() {
                let assets = self.remote_assets.clone();
                egui::ScrollArea::vertical()
                    .id_salt("remote_release_assets")
                    .max_height(150.0)
                    .auto_shrink([false, true])
                    .show(ui, |ui| {
                        ui.horizontal_wrapped(|ui| {
                            for asset in assets {
                                let asset_id = asset.name.clone();
                                ui.push_id(asset_id, |ui| {
                                    if ui
                                        .add_enabled(
                                            !self.downloading,
                                            egui::Button::new(release_asset_label(&asset)),
                                        )
                                        .clicked()
                                    {
                                        self.url = asset.browser_download_url;
                                        self.start_download(&context);
                                    }
                                });
                            }
                        });
                    });
            }
            ui.add_space(10.0);

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

            ui.add_space(14.0);
            ui.heading("Installed games");
            ui.add_space(4.0);
            let mut project_to_start = None;
            egui::ScrollArea::vertical()
                .id_salt("installed_games")
                .max_height(240.0)
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    if self.installed_games.is_empty() {
                        ui.weak("No installed games");
                    }
                    for game in &self.installed_games {
                        ui.push_id(&game.project, |ui| {
                            ui.separator();
                            ui.horizontal(|ui| {
                                ui.vertical(|ui| {
                                    ui.strong(&game.name);
                                    ui.weak(format!(
                                        "Version {} | {}",
                                        game.version,
                                        game.language.label()
                                    ));
                                });
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        if ui
                                            .add_enabled(
                                                !self.downloading,
                                                egui::Button::new("Start"),
                                            )
                                            .clicked()
                                        {
                                            project_to_start = Some(game.project.clone());
                                        }
                                        if self.active_project.as_deref()
                                            == Some(game.project.as_str())
                                        {
                                            ui.weak("Active");
                                        }
                                    },
                                );
                            });
                        });
                    }
                });
            if let Some(project) = project_to_start {
                self.start_installed_game(&project);
            }

            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.button("Refresh Installed Games").clicked()
                    && let Err(error) = self.refresh_installed_games()
                {
                    self.error = Some(error);
                }
                if ui.button("Open Resource Directory").clicked()
                    && let Err(error) = open_resource_directory()
                {
                    self.error = Some(error);
                }
            });

            if let Some(error) = &self.error {
                ui.add_space(8.0);
                ui.colored_label(ui.visuals().error_fg_color, error);
            }
        });
    }
}

fn open_resource_directory() -> Result<(), String> {
    let resources = platform_data_root()?;
    fs::create_dir_all(&resources).map_err(|error| {
        format!(
            "Could not create resource directory {}: {error}",
            resources.display()
        )
    })?;
    directory_open_command(&resources)
        .spawn()
        .map_err(|error| format!("Could not open {}: {error}", resources.display()))?;
    Ok(())
}

fn directory_open_command(path: &Path) -> Command {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
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

fn executable_directory() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not determine the launcher directory".to_owned())
}

fn bundled_assets_root() -> Result<PathBuf, String> {
    let executable = executable_directory()?;
    let adjacent = executable.join("assets");
    if adjacent.join(CONFIG_FILE).is_file() {
        return Ok(adjacent);
    }
    let app_resources = executable
        .parent()
        .map(|contents| contents.join("Resources/assets"));
    if let Some(resources) = app_resources
        && resources.join(CONFIG_FILE).is_file()
    {
        return Ok(resources);
    }
    Err("The installed application does not contain default assets".to_owned())
}

fn platform_data_root() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("RUNEWEAVE_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support"));
    #[cfg(target_os = "linux")]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local/share"))
        });
    base.map(|path| path.join("Bevy RuneWeave"))
        .ok_or_else(|| "Could not determine the user data directory".to_owned())
}

#[cfg(any(not(debug_assertions), test))]
fn release_log_path_at(data_root: &Path, mode: ProcessMode) -> PathBuf {
    data_root.join("logs").join(mode.log_file_name())
}

#[cfg(not(debug_assertions))]
fn initialize_release_logging(mode: ProcessMode) -> Result<PathBuf, String> {
    let path = release_log_path_at(&platform_data_root()?, mode);
    let parent = path
        .parent()
        .ok_or_else(|| "Could not determine the release log directory".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    let file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| format!("Could not reset {}: {error}", path.display()))?;
    redirect_standard_streams(file)
        .map_err(|error| format!("Could not redirect output to {}: {error}", path.display()))?;
    println!(
        "Bevy RuneWeave {mode:?} started (pid {})",
        std::process::id()
    );
    Ok(path)
}

#[cfg(all(not(debug_assertions), unix))]
fn redirect_standard_streams(file: File) -> io::Result<()> {
    use std::os::fd::AsRawFd;

    io::stdout().flush()?;
    io::stderr().flush()?;
    let descriptor = file.as_raw_fd();
    if unsafe { libc::dup2(descriptor, libc::STDOUT_FILENO) } == -1 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::dup2(descriptor, libc::STDERR_FILENO) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(all(not(debug_assertions), target_os = "windows"))]
fn redirect_standard_streams(file: File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Console::{STD_ERROR_HANDLE, STD_OUTPUT_HANDLE, SetStdHandle};

    io::stdout().flush()?;
    io::stderr().flush()?;
    let file = Box::leak(Box::new(file));
    let handle = file.as_raw_handle();
    if unsafe { SetStdHandle(STD_OUTPUT_HANDLE, handle) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { SetStdHandle(STD_ERROR_HANDLE, handle) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn active_assets_root() -> Result<PathBuf, String> {
    let installed_root = platform_data_root()?;
    fs::create_dir_all(&installed_root).map_err(|error| error.to_string())?;
    active_assets_root_at(&installed_root).or_else(|_| {
        if let Ok(bundled) = bundled_assets_root() {
            load_config(&bundled)?;
            return Ok(bundled);
        }
        let development = repo_root()?.join("assets");
        load_config(&development)?;
        Ok(development)
    })
}

fn installed_games() -> Result<(Vec<InstalledGame>, Option<String>), String> {
    let installed_root = platform_data_root()?;
    fs::create_dir_all(&installed_root).map_err(|error| error.to_string())?;
    installed_games_at(&installed_root)
}

fn installed_games_at(
    installed_root: &Path,
) -> Result<(Vec<InstalledGame>, Option<String>), String> {
    // Preserve the existing newest-project fallback and active marker migration.
    let _ = active_assets_root_at(installed_root);

    let active_project = fs::read_to_string(installed_root.join(ACTIVE_PROJECT_FILE))
        .ok()
        .map(|project| project.trim().to_owned())
        .filter(|project| project_directory_name(project).as_deref() == Ok(project.as_str()));
    let mut games = Vec::new();
    for entry in fs::read_dir(installed_root).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(project) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if project_directory_name(&project).as_deref() != Ok(project.as_str()) {
            continue;
        }
        let assets = entry.path().join("assets");
        let Ok(config) = load_config(&assets) else {
            continue;
        };
        games.push(InstalledGame {
            project,
            name: config.name,
            version: config.version,
            language: config.script.language,
        });
    }
    games.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.project.cmp(&right.project))
    });
    let active_project = active_project.filter(|active| {
        games
            .iter()
            .any(|game| game.project.as_str() == active.as_str())
    });
    Ok((games, active_project))
}

fn active_assets_root_at(installed_root: &Path) -> Result<PathBuf, String> {
    let active_file = installed_root.join(ACTIVE_PROJECT_FILE);
    if let Ok(key) = fs::read_to_string(&active_file) {
        let key = key.trim();
        if project_directory_name(key).is_ok() {
            let active = installed_root.join(key).join("assets");
            if active.join(CONFIG_FILE).is_file() {
                load_config(&active)?;
                return Ok(active);
            }
        }
    }

    let legacy = installed_root.join("assets");
    if legacy.join(CONFIG_FILE).is_file() {
        load_config(&legacy)?;
        return Ok(legacy);
    }

    let mut installed = fs::read_dir(installed_root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("assets"))
        .filter(|path| path.join(CONFIG_FILE).is_file())
        .filter_map(|path| {
            let modified = fs::metadata(path.join(CONFIG_FILE))
                .and_then(|metadata| metadata.modified())
                .ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    installed.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    if let Some((_, path)) = installed.into_iter().next() {
        load_config(&path)?;
        if let Some(key) = path
            .parent()
            .and_then(Path::file_name)
            .and_then(OsStr::to_str)
        {
            let _ = write_active_project(installed_root, key);
        }
        return Ok(path);
    }
    Err("No installed game assets are available".to_owned())
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

fn fetch_remote_assets() -> Receiver<RemoteAssetsResult> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(load_remote_assets());
    });
    receiver
}

fn load_remote_assets() -> RemoteAssetsResult {
    #[cfg(not(debug_assertions))]
    {
        Ok(("direct downloads".to_owned(), fallback_release_assets()))
    }
    #[cfg(debug_assertions)]
    {
        load_remote_assets_from_api().or_else(|error| {
            eprintln!("GitHub release API unavailable, using direct downloads: {error}");
            Ok(("direct downloads".to_owned(), fallback_release_assets()))
        })
    }
}

#[cfg(debug_assertions)]
fn load_remote_assets_from_api() -> RemoteAssetsResult {
    let client = reqwest::blocking::Client::builder()
        .user_agent("BevyRuneweave-Desktop-Demo/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(format!("{GITHUB_API_ROOT}/releases/latest"));
    if let Some(token) = option_env!("RUNEWEAVE_GITHUB_TOKEN")
        .map(str::to_owned)
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .or_else(|| std::env::var("GH_TOKEN").ok())
        .filter(|token| !token.trim().is_empty())
    {
        request = request.bearer_auth(token);
    }
    let mut latest = request
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| error.to_string())?
        .json::<LatestRelease>()
        .map_err(|error| error.to_string())?;
    latest.assets.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
    });
    Ok((latest.tag_name, latest.assets))
}

fn fallback_release_assets() -> Vec<ReleaseAsset> {
    FALLBACK_RELEASE_ASSETS
        .into_iter()
        .map(|name| ReleaseAsset {
            name: name.to_owned(),
            browser_download_url: format!("{GITHUB_RELEASE_DOWNLOAD_ROOT}/{name}"),
            size: 0,
        })
        .collect()
}

fn release_asset_label(asset: &ReleaseAsset) -> String {
    if asset.size == 0 {
        format!("Download {}", asset.name)
    } else {
        format!("Download {} ({})", asset.name, format_size(asset.size))
    }
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn download_and_install(url: &str) -> Result<(), String> {
    let root = platform_data_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let source_name = reqwest::Url::parse(url)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "package".to_owned());
    let response = reqwest::blocking::Client::builder()
        .user_agent("BevyRuneWeave-Desktop-Demo/0.1")
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Download failed: {error}"))?;
    let bytes = response
        .bytes()
        .map_err(|error| format!("Could not read download: {error}"))?;
    install_downloaded_package(&root, &bytes, &source_name).map(|_| ())
}

fn project_directory_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(format!("Invalid engineConfig project name: {name}"));
    }
    Ok(name.to_ascii_lowercase())
}

fn write_active_project(root: &Path, project: &str) -> Result<(), String> {
    let key = project_directory_name(project)?;
    if key != project {
        return Err("Active project key is not normalized".to_owned());
    }
    let marker = root.join(ACTIVE_PROJECT_FILE);
    let temporary = root.join(format!(".{ACTIVE_PROJECT_FILE}.{}.tmp", std::process::id()));
    fs::write(&temporary, format!("{key}\n"))
        .map_err(|error| format!("Could not write active project marker: {error}"))?;
    if marker.exists() {
        fs::remove_file(&marker)
            .map_err(|error| format!("Could not replace active project marker: {error}"))?;
    }
    fs::rename(&temporary, &marker)
        .map_err(|error| format!("Could not activate installed project: {error}"))
}

fn install_downloaded_package(
    root: &Path,
    bytes: &[u8],
    source_name: &str,
) -> Result<PathBuf, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let staging = tempfile::Builder::new()
        .prefix(".installing-")
        .tempdir_in(root)
        .map_err(|error| format!("Could not create staging directory: {error}"))?;
    let staged_project = staging.path().join("project");
    let staged_assets = staged_project.join("assets");
    fs::create_dir_all(&staged_project).map_err(|error| error.to_string())?;
    install_package(bytes, source_name, &staged_assets)?;

    let config = load_config(&staged_assets)?;
    let project = project_directory_name(&config.name)?;
    let destination = root.join(&project);
    let backup = root.join(format!(".{project}.backup"));
    if backup.exists() {
        fs::remove_dir_all(&backup)
            .map_err(|error| format!("Could not remove stale project backup: {error}"))?;
    }
    if destination.exists() {
        fs::rename(&destination, &backup)
            .map_err(|error| format!("Could not preserve installed project: {error}"))?;
    }
    if let Err(error) = fs::rename(&staged_project, &destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(format!("Could not install project: {error}"));
    }
    if let Err(error) = write_active_project(root, &project) {
        let _ = fs::remove_dir_all(&destination);
        if backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(error);
    }
    if backup.exists() {
        fs::remove_dir_all(&backup)
            .map_err(|error| format!("Could not remove project backup: {error}"))?;
    }
    Ok(destination.join("assets"))
}

fn install_package(bytes: &[u8], source_name: &str, destination: &Path) -> Result<(), String> {
    let started = std::time::Instant::now();
    eprintln!(
        "[launcher-timing] install package start: {} ({} bytes)",
        source_name,
        bytes.len()
    );
    if destination.exists() {
        fs::remove_dir_all(destination)
            .map_err(|error| format!("Could not replace installed assets: {error}"))?;
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;

    let result = (|| {
        extract_package(bytes, source_name, destination)?;
        let config_path =
            find_config(destination)?.ok_or_else(|| format!("Package is missing {CONFIG_FILE}"))?;
        let package_root = config_path
            .parent()
            .ok_or_else(|| "Invalid engineConfig.json path".to_owned())?;
        load_config(package_root)?;

        // Packages may contain one or more wrapper directories. Copy their game root
        // into assets so the runtime always finds engineConfig.json at the expected path.
        if package_root != destination {
            install_tree(package_root, destination)?;
            load_config(destination)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    eprintln!(
        "[launcher-timing] install package finished in {:?}: {}",
        started.elapsed(),
        if result.is_ok() { "ok" } else { "failed" }
    );
    result
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

fn prepare_runtime_icon(assets: &Path, icon: &str) -> Result<(), String> {
    let target = assets.join(".runtime-icon.png");
    if icon.starts_with("http://") || icon.starts_with("https://") {
        let response = reqwest::blocking::get(icon)
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| format!("Could not download runtime icon: {error}"))?;
        let bytes = response
            .bytes()
            .map_err(|error| format!("Could not read runtime icon response: {error}"))?;
        return fs::write(&target, bytes)
            .map_err(|error| format!("Could not write {}: {error}", target.display()));
    }

    let relative = Path::new(icon);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| component == Component::ParentDir)
    {
        return Err("icon must be a relative path inside assets or an HTTP(S) URL".to_owned());
    }

    let source = assets.join(relative);
    if source == target {
        let metadata = fs::metadata(&source)
            .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(format!(
                "Runtime icon is empty or not a file: {}",
                source.display()
            ));
        }
        return Ok(());
    }

    fs::copy(&source, &target).map(|_| ()).map_err(|error| {
        format!(
            "Could not copy runtime icon from {} to {}: {error}",
            source.display(),
            target.display()
        )
    })
}

fn run_game() -> Result<(), String> {
    let assets = active_assets_root()?;
    let config = load_config(&assets)?;
    if let Some(icon) = config.icon.as_deref()
        && let Err(error) = prepare_runtime_icon(&assets, icon)
    {
        eprintln!("Bevy RuneWeave: {error}; using the default runtime icon");
    }
    let executable_dir = executable_directory()?;
    let library_name = runtime_library_name();
    let bundled = executable_dir.join("lib").join(library_name);
    let app_framework = executable_dir
        .parent()
        .map(|contents| contents.join("Frameworks").join(library_name));
    let development = repo_root()?
        .join("dist/runtimes")
        .join(platform_directory())
        .join(BUILD_TARGET)
        .join("lib")
        .join(library_name);
    let library_path = if bundled.is_file() {
        bundled
    } else if let Some(framework) = app_framework
        && framework.is_file()
    {
        framework
    } else {
        development
    };
    let library = unsafe { Library::new(&library_path) }
        .map_err(|error| format!("Could not load {}: {error}", library_path.display()))?;
    type Run = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
    let run: Symbol<'_, Run> = unsafe { library.get(b"game_runtime_run_with_assets\0") }
        .map_err(|error| format!("Could not find game_runtime_run_with_assets: {error}"))?;
    let asset_root =
        CString::new(assets.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
    let script = CString::new(config.script.entry.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())?;
    let code = unsafe { run(asset_root.as_ptr(), script.as_ptr()) };
    if code == 0 {
        Ok(())
    } else {
        Err(format!("Game runtime returned error code {code}"))
    }
}

fn launch_runtime_process() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = Command::new(executable);
    command.arg("--run-game");
    eprintln!("[launcher-timing] spawning runtime process");
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn main() -> eframe::Result {
    let mode = ProcessMode::from_args();
    #[cfg(not(debug_assertions))]
    if let Err(error) = initialize_release_logging(mode) {
        eprintln!("Bevy RuneWeave: {error}");
    }

    if mode == ProcessMode::Runtime {
        if let Err(error) = run_game() {
            eprintln!("Bevy RuneWeave: {error}");
            std::process::exit(1);
        }
        return Ok(());
    }

    let icon = eframe::icon_data::from_png_bytes(LAUNCHER_ICON).unwrap_or_default();
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1000.0, 693.0])
            .with_min_inner_size([420.0, 210.0])
            .with_icon(icon)
            .with_resizable(true),
        centered: true,
        ..Default::default()
    };
    eframe::run_native(
        "Bevy RuneWeave",
        options,
        Box::new(move |_creation_context| Ok(Box::new(LauncherApp::new()))),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use lzma_rust2::{XzOptions, XzWriter};
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    #[test]
    fn release_logs_are_separate_for_launcher_and_runtime() {
        let data_root = Path::new("application-data");
        assert_eq!(
            release_log_path_at(data_root, ProcessMode::Launcher),
            data_root.join("logs/launcher.log")
        );
        assert_eq!(
            release_log_path_at(data_root, ProcessMode::Runtime),
            data_root.join("logs/runtime.log")
        );
    }

    #[test]
    fn preserves_runtime_icon_when_config_already_uses_target_path() {
        let assets = tempfile::tempdir().unwrap();
        let icon = assets.path().join(".runtime-icon.png");
        fs::write(&icon, b"clash icon bytes").unwrap();

        prepare_runtime_icon(assets.path(), ".runtime-icon.png").unwrap();

        assert_eq!(fs::read(icon).unwrap(), b"clash icon bytes");
    }

    #[test]
    fn copies_project_icon_to_runtime_icon_path() {
        let assets = tempfile::tempdir().unwrap();
        fs::create_dir_all(assets.path().join("branding")).unwrap();
        fs::write(
            assets.path().join("branding/icon.png"),
            b"project icon bytes",
        )
        .unwrap();

        prepare_runtime_icon(assets.path(), "branding/icon.png").unwrap();

        assert_eq!(
            fs::read(assets.path().join(".runtime-icon.png")).unwrap(),
            b"project icon bytes"
        );
    }

    const CONTENT: &[u8] = b"archive format test";

    fn zip_bytes(name: &str, content: &[u8]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file(name, options).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn asset_package_zip(prefix: &str) -> Vec<u8> {
        asset_package_zip_for(prefix, "Test", "1.0.0", "typescript", "shooter.js")
    }

    fn asset_package_zip_for(
        prefix: &str,
        name: &str,
        version: &str,
        language: &str,
        entry: &str,
    ) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file(format!("{prefix}engineConfig.json"), options)
            .unwrap();
        writer
            .write_all(
                format!(
                    r#"{{"schemaVersion":1,"name":"{name}","version":"{version}","script":{{"language":"{language}","entry":"{entry}"}}}}"#
                )
                .as_bytes(),
            )
            .unwrap();
        writer
            .start_file(format!("{prefix}{entry}"), options)
            .unwrap();
        writer.write_all(b"globalThis.testGame = true;").unwrap();
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
    fn parses_every_release_asset_shape() {
        let assets: Vec<ReleaseAsset> = serde_json::from_str(
            r#"[
                {"name":"clash-ts.zip","browser_download_url":"https://example/clash.zip","size":1048576},
                {"name":"script-squadron-lua.zip","browser_download_url":"https://example/lua.zip","size":512}
            ]"#,
        )
        .unwrap();

        assert_eq!(assets.len(), 2);
        assert_eq!(assets[0].name, "clash-ts.zip");
        assert_eq!(format_size(assets[0].size), "1.0 MB");
        assert_eq!(format_size(assets[1].size), "512 B");
    }

    #[test]
    fn parses_assets_from_latest_release_response() {
        let release: LatestRelease = serde_json::from_str(
            r#"{
                "id": 42,
                "tag_name": "0.0.1",
                "assets": [
                    {"name":"script-squadron-js.zip","browser_download_url":"https://example/js.zip","size":2048}
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(release.tag_name, "0.0.1");
        assert_eq!(release.assets.len(), 1);
        assert_eq!(release.assets[0].name, "script-squadron-js.zip");
    }

    #[test]
    fn release_api_fallback_uses_public_latest_download_urls() {
        let assets = fallback_release_assets();

        assert_eq!(assets.len(), FALLBACK_RELEASE_ASSETS.len());
        assert_eq!(assets[0].size, 0);
        assert_eq!(
            assets[0].browser_download_url,
            format!(
                "{GITHUB_RELEASE_DOWNLOAD_ROOT}/{}",
                FALLBACK_RELEASE_ASSETS[0]
            )
        );
        assert_eq!(
            release_asset_label(&assets[0]),
            format!("Download {}", FALLBACK_RELEASE_ASSETS[0])
        );
    }

    #[test]
    fn installs_assets_directly_into_destination() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("assets");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("stale.txt"), b"stale").unwrap();

        install_package(&asset_package_zip(""), "package.zip", &destination).unwrap();

        assert!(destination.join(CONFIG_FILE).is_file());
        assert!(destination.join("shooter.js").is_file());
        assert!(!destination.join("stale.txt").exists());
    }

    #[test]
    fn derives_project_directory_from_engine_config_name() {
        assert_eq!(
            project_directory_name("Script-Squadron-TypeScript").unwrap(),
            "script-squadron-typescript"
        );
        assert!(project_directory_name("bad project").is_err());
        assert!(project_directory_name("../project").is_err());
    }

    #[test]
    fn reuses_project_directory_and_records_active_project() {
        let root = tempfile::tempdir().unwrap();
        let first = install_downloaded_package(
            root.path(),
            &asset_package_zip("release-one/"),
            "first-random-id.zip",
        )
        .unwrap();
        let second = install_downloaded_package(
            root.path(),
            &asset_package_zip("release-two/"),
            "second-random-id.zip",
        )
        .unwrap();

        let expected = root.path().join("test/assets");
        assert_eq!(first, expected);
        assert_eq!(second, expected);
        assert_eq!(
            fs::read_to_string(root.path().join(ACTIVE_PROJECT_FILE)).unwrap(),
            "test\n"
        );
        assert_eq!(active_assets_root_at(root.path()).unwrap(), expected);
        let project_directories = fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_dir())
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .count();
        assert_eq!(project_directories, 1);
    }

    #[test]
    fn lists_installed_games_with_metadata_and_active_project() {
        let root = tempfile::tempdir().unwrap();
        install_downloaded_package(
            root.path(),
            &asset_package_zip_for("", "Zulu", "2.0.0", "lua", "main.lua"),
            "zulu.zip",
        )
        .unwrap();
        install_downloaded_package(
            root.path(),
            &asset_package_zip_for("", "Alpha", "1.2.3", "js", "main.js"),
            "alpha.zip",
        )
        .unwrap();
        fs::create_dir_all(root.path().join(".installing-hidden/assets")).unwrap();
        fs::write(
            root.path()
                .join(".installing-hidden/assets/engineConfig.json"),
            b"{}",
        )
        .unwrap();

        let (games, active_project) = installed_games_at(root.path()).unwrap();

        assert_eq!(games.len(), 2);
        assert_eq!(games[0].name, "Alpha");
        assert_eq!(games[0].version, "1.2.3");
        assert_eq!(games[0].language, Language::Js);
        assert_eq!(games[1].name, "Zulu");
        assert_eq!(games[1].language, Language::Lua);
        assert_eq!(active_project.as_deref(), Some("alpha"));
    }

    #[test]
    fn builds_platform_directory_open_command() {
        let path = Path::new("assets folder");
        let command = directory_open_command(path);
        let program = if cfg!(target_os = "windows") {
            "explorer.exe"
        } else if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };

        assert_eq!(command.get_program(), OsStr::new(program));
        assert_eq!(command.get_args().collect::<Vec<_>>(), [path.as_os_str()]);
    }

    #[test]
    fn promotes_assets_from_archive_wrapper_directory() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("assets");

        install_package(
            &asset_package_zip("release-package/"),
            "package.zip",
            &destination,
        )
        .unwrap();

        assert!(destination.join(CONFIG_FILE).is_file());
        assert!(destination.join("shooter.js").is_file());
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
