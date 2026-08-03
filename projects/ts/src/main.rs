use std::path::PathBuf;

fn main() {
    let asset_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    bevy_script_runtime::run_with_assets(asset_root, PathBuf::from("shooter.js"));
}
