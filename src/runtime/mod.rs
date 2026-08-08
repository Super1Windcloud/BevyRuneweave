use std::{
    ffi::{CStr, c_char, c_int},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

#[cfg(any(target_os = "windows", target_os = "linux"))]
use bevy::window::PrimaryWindow;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use bevy::window::{MonitorSelection, WindowPosition};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use bevy::winit::WINIT_WINDOWS;
use bevy::{
    asset::AssetPlugin,
    prelude::*,
    window::{PresentMode, WindowResolution},
};
use bevy_mod_scripting::prelude::{
    BMSPlugin, ScriptAsset, ScriptCallbackEvent, ScriptComponent, ScriptValue, callback_labels,
    event_handler,
};
#[cfg(target_os = "windows")]
use winit::platform::windows::WindowExtWindows;

use crate::{
    ecs_api::{ApplyEcsCommands, RuneweaveEcsPlugin},
    example_host::ScriptSquadronHostPlugin,
};

#[cfg(all(not(any(feature = "js", feature = "typescript")), feature = "lua"))]
use bevy_mod_scripting::lua::LuaScriptingPlugin as ActiveScriptingPlugin;
#[cfg(any(feature = "js", feature = "typescript"))]
use bevy_mod_scripting::quickjs::QuickJsScriptingPlugin as ActiveScriptingPlugin;

static RELOAD_REQUESTED: AtomicBool = AtomicBool::new(false);

const WINDOW_WIDTH: u32 = 600;
const WINDOW_HEIGHT: u32 = 800;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
const DEFAULT_WINDOW_ICON: &[u8] = include_bytes!("../../assets/branding/bevy_icon.png");

callback_labels!(OnUpdate => "on_update");

#[derive(Resource)]
struct LoadedScriptPath {
    asset_path: PathBuf,
    source_path: PathBuf,
    modified: Option<std::time::SystemTime>,
}

fn attach_script(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    path: Res<LoadedScriptPath>,
) {
    commands.spawn(ScriptComponent::new(vec![
        asset_server.load::<ScriptAsset>(path.asset_path.clone()),
    ]));
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn set_default_window_icon(primary_window: Single<Entity, With<PrimaryWindow>>) {
    let image = match image::load_from_memory(DEFAULT_WINDOW_ICON) {
        Ok(image) => image.into_rgba8(),
        Err(error) => {
            warn!("Failed to decode the embedded Bevy window icon: {error}");
            return;
        }
    };
    let (width, height) = image.dimensions();
    let icon = match winit::window::Icon::from_rgba(image.into_raw(), width, height) {
        Ok(icon) => icon,
        Err(error) => {
            warn!("Failed to create the Bevy window icon: {error}");
            return;
        }
    };

    WINIT_WINDOWS.with_borrow(|windows| {
        if let Some(window) = windows.get_window(*primary_window) {
            #[cfg(target_os = "windows")]
            window.set_taskbar_icon(Some(icon.clone()));
            window.set_window_icon(Some(icon));
        } else {
            warn!("Failed to find the native primary window for its default icon");
        }
    });
}

#[cfg(target_os = "macos")]
fn set_default_window_icon() {
    use objc2::AnyThread as _;
    use objc2_app_kit::{NSApplication, NSBitmapImageRep, NSDeviceRGBColorSpace, NSImage};
    use objc2_foundation::NSSize;

    let image = match image::load_from_memory(DEFAULT_WINDOW_ICON) {
        Ok(image) => image.into_rgba8(),
        Err(error) => {
            warn!("Failed to decode the embedded Bevy application icon: {error}");
            return;
        }
    };
    let (width, height) = image.dimensions();
    let mut pixels = image.into_raw();
    let mut planes = [pixels.as_mut_ptr()];

    unsafe extern "C" {
        static NSApp: Option<&'static NSApplication>;
    }

    // SAFETY: this startup system runs on the main thread, and AppKit copies the
    // pixel representation into the retained application image.
    unsafe {
        let Some(application) = NSApp else {
            warn!("Failed to find the macOS application for its default icon");
            return;
        };
        let Some(representation) = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            planes.as_mut_ptr(),
            width as isize,
            height as isize,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            (width * 4) as isize,
            32,
        ) else {
            warn!("Failed to create the macOS application icon representation");
            return;
        };
        let application_icon =
            NSImage::initWithSize(NSImage::alloc(), NSSize::new(width as f64, height as f64));
        application_icon.addRepresentation(&representation);
        application.setApplicationIconImage(Some(&application_icon));
    }
}

fn source_has_changed(
    previous: Option<std::time::SystemTime>,
    current: Option<std::time::SystemTime>,
) -> bool {
    current.is_some() && current != previous
}

fn request_asset_reload(asset_server: Res<AssetServer>, mut path: ResMut<LoadedScriptPath>) {
    let modified = fs::metadata(&path.source_path)
        .and_then(|metadata| metadata.modified())
        .ok();
    let source_changed = source_has_changed(path.modified, modified);
    let reload_requested = RELOAD_REQUESTED.swap(false, Ordering::AcqRel);

    if source_changed {
        path.modified = modified;
    }
    if source_changed || reload_requested {
        info!(
            "Reloading script after source change: {}",
            path.source_path.display()
        );
        asset_server.reload(path.asset_path.clone());
    }
}

fn emit_update(
    time: Res<Time>,
    keyboard: Res<ButtonInput<KeyCode>>,
    mut callbacks: MessageWriter<ScriptCallbackEvent>,
) {
    let horizontal = axis(&keyboard, KeyCode::ArrowLeft, KeyCode::ArrowRight)
        + axis(&keyboard, KeyCode::KeyA, KeyCode::KeyD);
    let vertical = axis(&keyboard, KeyCode::ArrowDown, KeyCode::ArrowUp)
        + axis(&keyboard, KeyCode::KeyS, KeyCode::KeyW);
    let restart_pressed = keyboard.pressed(KeyCode::Space);
    callbacks.write(ScriptCallbackEvent::new_for_all_scripts(
        OnUpdate,
        vec![
            ScriptValue::Float(time.delta_secs_f64().min(0.05)),
            ScriptValue::Float(horizontal.clamp(-1.0, 1.0)),
            ScriptValue::Float(vertical.clamp(-1.0, 1.0)),
            ScriptValue::Bool(restart_pressed),
        ],
    ));
}

fn axis(keyboard: &ButtonInput<KeyCode>, negative: KeyCode, positive: KeyCode) -> f64 {
    f64::from(keyboard.pressed(positive)) - f64::from(keyboard.pressed(negative))
}

fn normalize_script_path(asset_root: &Path, path: &Path) -> Result<PathBuf, String> {
    let relative = if path.is_absolute() {
        path.strip_prefix(asset_root)
            .map_err(|_| format!("script must be inside {}", asset_root.display()))?
    } else {
        path.strip_prefix("assets").unwrap_or(path)
    };
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("script path must point to a file inside the asset directory".to_owned());
    }
    Ok(relative.to_path_buf())
}

/// Builds the Bevy application without starting its platform event loop.
pub fn build_app_with_assets(asset_root: PathBuf, script_path: PathBuf) -> Result<App, String> {
    let asset_path = normalize_script_path(&asset_root, &script_path)?;
    if !asset_root.is_dir() {
        return Err(format!(
            "asset directory does not exist: {}",
            asset_root.display()
        ));
    }

    let mut app = App::new();
    let scripting_plugins = BMSPlugin.build();
    let scripting_plugins = scripting_plugins.disable::<ActiveScriptingPlugin>();

    app.add_plugins(
        DefaultPlugins
            .set(AssetPlugin {
                file_path: asset_root.to_string_lossy().into_owned(),
                watch_for_changes_override: Some(false),
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: format!("Script Squadron - {}", active_language()),
                    resolution: WindowResolution::new(WINDOW_WIDTH, WINDOW_HEIGHT),
                    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
                    position: WindowPosition::Centered(MonitorSelection::Primary),
                    present_mode: PresentMode::AutoVsync,
                    resizable: true,
                    ..default()
                }),
                ..default()
            }),
    )
    .add_plugins(scripting_plugins)
    .add_plugins((RuneweaveEcsPlugin, ScriptSquadronHostPlugin))
    .insert_resource(LoadedScriptPath {
        source_path: asset_root.join(&asset_path),
        modified: fs::metadata(asset_root.join(&asset_path))
            .and_then(|metadata| metadata.modified())
            .ok(),
        asset_path,
    })
    .add_systems(
        Startup,
        (
            attach_script,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            set_default_window_icon,
        ),
    )
    .add_systems(
        Update,
        (
            request_asset_reload,
            emit_update,
            event_handler::<OnUpdate, ActiveScriptingPlugin>,
        )
            .chain()
            .before(ApplyEcsCommands),
    );
    Ok(app)
}

/// Builds the app with the conventional `assets` directory in the current directory.
pub fn build_app(script_path: PathBuf) -> Result<App, String> {
    let asset_root = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("assets");
    build_app_with_assets(asset_root, script_path)
}

/// Runs the platform event loop. This call blocks until the window closes.
pub fn run(script_path: PathBuf) {
    match build_app(script_path) {
        Ok(mut app) => {
            app.run();
        }
        Err(error) => panic!("failed to start game runtime: {error}"),
    }
}

/// Runs a game using an explicit, isolated asset directory.
pub fn run_with_assets(asset_root: PathBuf, script_path: PathBuf) {
    match build_app_with_assets(asset_root, script_path) {
        Ok(mut app) => {
            app.run();
        }
        Err(error) => panic!("failed to start game runtime: {error}"),
    }
}

/// Returns the script path matching the selected language feature.
pub const fn default_script_path() -> &'static str {
    #[cfg(any(feature = "js", feature = "typescript"))]
    return "assets/shooter.js";
    #[cfg(all(not(any(feature = "js", feature = "typescript")), feature = "lua"))]
    return "assets/shooter.lua";
}

const fn active_language() -> &'static str {
    #[cfg(feature = "js")]
    return "QuickJS";
    #[cfg(all(not(feature = "js"), feature = "typescript"))]
    return "TypeScript / QuickJS";
    #[cfg(all(not(any(feature = "js", feature = "typescript")), feature = "lua"))]
    return "Lua 5.5";
}

/// Requests a BMS asset reload on the runtime's next frame.
pub extern "C" fn game_runtime_request_reload() {
    RELOAD_REQUESTED.store(true, Ordering::Release);
}

/// C ABI entry point for desktop/mobile hosts. Returns non-zero for invalid input or startup panic.
///
/// # Safety
///
/// `script_path` must point to a valid, NUL-terminated UTF-8 string for the duration of this call.
pub unsafe extern "C" fn game_runtime_run(script_path: *const c_char) -> c_int {
    let script_path = match unsafe { c_path(script_path) } {
        Ok(path) => path,
        Err(code) => return code,
    };
    match std::panic::catch_unwind(|| run(script_path)) {
        Ok(()) => 0,
        Err(_) => 3,
    }
}

/// C ABI entry point using an explicit asset directory.
///
/// # Safety
///
/// Both arguments must point to valid, NUL-terminated UTF-8 strings for the duration of this call.
pub unsafe extern "C" fn game_runtime_run_with_assets(
    asset_root: *const c_char,
    script_path: *const c_char,
) -> c_int {
    let asset_root = match unsafe { c_path(asset_root) } {
        Ok(path) => path,
        Err(code) => return code,
    };
    let script_path = match unsafe { c_path(script_path) } {
        Ok(path) => path,
        Err(code) => return code,
    };
    match std::panic::catch_unwind(|| run_with_assets(asset_root, script_path)) {
        Ok(()) => 0,
        Err(_) => 3,
    }
}

unsafe fn c_path(path: *const c_char) -> Result<PathBuf, c_int> {
    if path.is_null() {
        return Err(1);
    }
    // SAFETY: The caller promises a valid, NUL-terminated string for this call.
    unsafe { CStr::from_ptr(path) }
        .to_str()
        .map(PathBuf::from)
        .map_err(|_| 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths_under_assets() {
        assert_eq!(
            normalize_script_path(Path::new("assets"), Path::new("assets/shooter.js")).unwrap(),
            PathBuf::from("shooter.js")
        );
        assert_eq!(
            normalize_script_path(Path::new("assets"), Path::new("shooter.js")).unwrap(),
            PathBuf::from("shooter.js")
        );
    }

    #[test]
    fn rejects_scripts_outside_asset_root() {
        assert!(normalize_script_path(Path::new("assets"), Path::new("../shooter.js")).is_err());
        assert!(normalize_script_path(Path::new("assets"), Path::new("/tmp/shooter.js")).is_err());
    }

    #[test]
    fn detects_source_timestamp_changes() {
        let first = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
        let second = first + std::time::Duration::from_secs(1);

        assert!(!source_has_changed(Some(first), Some(first)));
        assert!(source_has_changed(Some(first), Some(second)));
        assert!(source_has_changed(None, Some(first)));
        assert!(!source_has_changed(Some(first), None));
    }
}
