//! Shared desktop path rules for development and installed applications.

use std::path::{Path, PathBuf};

pub fn data_base(
    platform: &str,
    local_app_data: Option<PathBuf>,
    home: Option<PathBuf>,
    xdg_data_home: Option<PathBuf>,
) -> Option<PathBuf> {
    match platform {
        "windows" => local_app_data,
        "macos" => home.map(|path| path.join("Library").join("Application Support")),
        "linux" => xdg_data_home
            .filter(|path| path.is_absolute())
            .or_else(|| home.map(|path| path.join(".local").join("share"))),
        _ => None,
    }
}

pub fn data_root(override_directory: Option<PathBuf>, base: Option<PathBuf>) -> Option<PathBuf> {
    match override_directory {
        Some(directory) => Some(directory).filter(|path| path.is_absolute()),
        None => base
            .filter(|path| path.is_absolute())
            .map(|path| path.join("Bevy RuneWeave")),
    }
}

fn repository_root(executable_directory: &Path) -> Option<PathBuf> {
    executable_directory
        .ancestors()
        .find(|path| path.join("include").join("game_runtime.h").is_file())
        .map(Path::to_path_buf)
}

pub fn default_assets_root(executable_directory: &Path) -> Option<PathBuf> {
    let adjacent = executable_directory.join("assets");
    if adjacent.join("engineConfig.json").is_file() {
        return Some(adjacent);
    }
    if let Some(contents) = executable_directory.parent() {
        let bundled = contents.join("Resources").join("assets");
        if bundled.join("engineConfig.json").is_file() {
            return Some(bundled);
        }
    }
    let development = repository_root(executable_directory)?
        .join("projects")
        .join("ts")
        .join("modules")
        .join("shooter")
        .join("game")
        .join("assets");
    development
        .join("engineConfig.json")
        .is_file()
        .then_some(development)
}

pub fn runtime_library_path(
    executable_directory: &Path,
    platform: &str,
    target: &str,
    library_name: &str,
) -> Option<PathBuf> {
    let adjacent = executable_directory.join("lib").join(library_name);
    if adjacent.is_file() {
        return Some(adjacent);
    }
    if let Some(contents) = executable_directory.parent() {
        let bundled = contents.join("Frameworks").join(library_name);
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    let development = repository_root(executable_directory)?
        .join("dist")
        .join("runtimes")
        .join(platform)
        .join(target)
        .join("lib")
        .join(library_name);
    development.is_file().then_some(development)
}

pub fn runtime_icon_path(assets: &Path, data_root: &Path) -> Option<PathBuf> {
    assets
        .starts_with(data_root)
        .then(|| assets.join(".runtime-icon.png"))
}
