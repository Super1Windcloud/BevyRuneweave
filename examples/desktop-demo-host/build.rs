//! Provides target metadata and embeds the launcher icon on Windows.

fn main() {
    let target = std::env::var("TARGET").expect("Cargo always sets TARGET");
    println!("cargo:rustc-env=RUNEWEAVE_BUILD_TARGET={target}");
    embed_windows_icon();
}

#[cfg(target_os = "windows")]
fn embed_windows_icon() {
    use std::{env, fs, path::PathBuf};

    const ICON_PNG: &[u8] = include_bytes!("../../assets/branding/bevy_icon.png");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    let icon_path = out_dir.join("bevy-runeweave-demo.ico");
    let mut icon = Vec::with_capacity(22 + ICON_PNG.len());
    icon.extend_from_slice(&[0, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
    icon.extend_from_slice(&1_u16.to_le_bytes());
    icon.extend_from_slice(&32_u16.to_le_bytes());
    icon.extend_from_slice(&(ICON_PNG.len() as u32).to_le_bytes());
    icon.extend_from_slice(&22_u32.to_le_bytes());
    icon.extend_from_slice(ICON_PNG);
    fs::write(&icon_path, icon).expect("failed to write Windows icon");
    winres::WindowsResource::new()
        .set_icon(icon_path.to_string_lossy().as_ref())
        .compile()
        .expect("failed to embed Windows icon");
    println!("cargo:rerun-if-changed=../../assets/branding/bevy_icon.png");
}

#[cfg(not(target_os = "windows"))]
fn embed_windows_icon() {}
