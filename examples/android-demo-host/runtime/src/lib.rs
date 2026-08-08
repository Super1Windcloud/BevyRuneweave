#[cfg(target_os = "android")]
use std::{fs, path::PathBuf};

use bevy::prelude::bevy_main;
#[cfg(target_os = "android")]
use serde::Deserialize;

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
    let extension = config
        .script
        .entry
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    assert!(
        matches!(
            (config.script.language.as_str(), extension),
            ("lua", "lua") | ("js" | "typescript", "js" | "mjs")
        ),
        "asset language does not match the script entry extension"
    );
    bevy_runeweave::run_with_assets(assets, config.script.entry);
}
