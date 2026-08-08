#[cfg(target_os = "android")]
use std::{fs, path::PathBuf};

use bevy::prelude::bevy_main;
#[cfg(target_os = "android")]
use serde::Deserialize;

#[cfg(not(any(feature = "js", feature = "typescript", feature = "lua")))]
compile_error!("enable exactly one scripting feature: js, typescript, or lua");
#[cfg(any(
    all(feature = "js", any(feature = "typescript", feature = "lua")),
    all(feature = "typescript", feature = "lua")
))]
compile_error!("the js, typescript, and lua features are mutually exclusive");

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineConfig {
    schema_version: u32,
    script: ScriptConfig,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct ScriptConfig {
    language: String,
    entry: PathBuf,
}

#[bevy_main]
fn main() {
    #[cfg(target_os = "android")]
    run_android();
}

#[cfg(target_os = "android")]
fn run_android() {
    let app = bevy::android::ANDROID_APP
        .get()
        .expect("AndroidApp was not initialized by NativeActivity");
    let data = app
        .internal_data_path()
        .expect("NativeActivity did not provide an internal data directory");
    let assets = data.join("assets");
    let config: EngineConfig = serde_json::from_slice(
        &fs::read(assets.join("engineConfig.json")).expect("failed to read engineConfig.json"),
    )
    .expect("failed to parse engineConfig.json");

    assert_eq!(config.schema_version, 1, "unsupported engineConfig schema");
    assert_eq!(
        config.script.language,
        active_language(),
        "asset language does not match the compiled Android runtime"
    );
    bevy_runeweave::run_with_assets(assets, config.script.entry);
}

#[cfg(all(target_os = "android", feature = "js"))]
const fn active_language() -> &'static str {
    "js"
}

#[cfg(all(target_os = "android", feature = "typescript"))]
const fn active_language() -> &'static str {
    "typescript"
}

#[cfg(all(target_os = "android", feature = "lua"))]
const fn active_language() -> &'static str {
    "lua"
}
