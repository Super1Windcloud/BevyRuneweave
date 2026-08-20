use std::path::PathBuf;

#[path = "../../../build-support/run-typescript-project.rs"]
mod run_typescript_project;

fn main() {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Err(error) = run_typescript_project::compile_typescript_project(&project_root) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    let asset_root = project_root.join("modules/clash/game/assets");
    bevy_runeweave::run_with_assets(asset_root, PathBuf::from("clash.js"));
}
