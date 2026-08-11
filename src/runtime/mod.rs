use serde::Deserialize;
use std::{
    ffi::{CStr, c_char, c_int},
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[cfg(target_os = "android")]
use bevy::asset::{
    AssetApp,
    io::{AssetSourceBuilder, AssetSourceId, file::FileAssetReader},
};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use bevy::window::PrimaryWindow;
#[cfg(any(target_os = "android", target_os = "ios"))]
use bevy::window::WindowMode;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use bevy::window::WindowPosition;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use bevy::winit::WINIT_WINDOWS;
use bevy::{
    asset::AssetPlugin,
    prelude::*,
    window::{MonitorSelection, PresentMode, WindowResolution},
};
use bevy_mod_scripting::prelude::{
    BMSPlugin, ScriptAsset, ScriptCallbackEvent, ScriptComponent, ScriptValue, callback_labels,
    event_handler,
};
#[cfg(target_os = "windows")]
use winit::platform::windows::WindowExtWindows;

use crate::script_api::RuneweaveScriptApiPlugin;

#[cfg(feature = "lua")]
use bevy_mod_scripting::lua::LuaScriptingPlugin;
#[cfg(any(feature = "js", feature = "typescript"))]
use bevy_mod_scripting::quickjs::QuickJsScriptingPlugin;

static RELOAD_REQUESTED: AtomicBool = AtomicBool::new(false);
static SCRIPT_SWITCH_REQUESTED: Mutex<Option<PathBuf>> = Mutex::new(None);

const WINDOW_WIDTH: u32 = 600;
const WINDOW_HEIGHT: u32 = 800;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
const DEFAULT_WINDOW_ICON: &[u8] = include_bytes!("../../assets/branding/bevy_icon.png");

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    app_name: Option<String>,
    #[allow(dead_code)]
    icon: Option<String>,
}

callback_labels!(OnUpdate => "on_update");

fn runtime_scripting_plugins() -> bevy::app::PluginGroupBuilder {
    BMSPlugin.build()
}

#[derive(Resource)]
struct LoadedScriptPath {
    asset_path: PathBuf,
    source_path: PathBuf,
    modified: Option<std::time::SystemTime>,
}
#[derive(Resource)]
struct RuntimeAssetRoot(PathBuf);

#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
#[derive(Resource)]
struct ScriptFilePollTimer(Timer);

fn attach_script(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    path: Res<LoadedScriptPath>,
) {
    commands.spawn(ScriptComponent::new(vec![
        asset_server.load::<ScriptAsset>(path.asset_path.clone()),
    ]));
}

fn spawn_scene_camera(mut commands: Commands) {
    commands.spawn((
        Camera2d,
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: bevy::camera::ScalingMode::FixedVertical {
                viewport_height: crate::GAME_VIEWPORT_HEIGHT,
            },
            ..OrthographicProjection::default_2d()
        }),
    ));
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn set_default_window_icon(
    primary_window: Single<Entity, With<PrimaryWindow>>,
    asset_root: Res<RuntimeAssetRoot>,
) {
    let bytes = fs::read(asset_root.0.join(".runtime-icon.png"))
        .unwrap_or_else(|_| DEFAULT_WINDOW_ICON.to_vec());
    let image = match image::load_from_memory(&bytes) {
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
            {
                window.set_window_icon(Some(icon.clone()));
                window.set_taskbar_icon(Some(icon));
            }
            #[cfg(target_os = "linux")]
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

#[cfg(any(
    test,
    all(debug_assertions, not(any(target_os = "android", target_os = "ios")))
))]
fn source_has_changed(
    previous: Option<std::time::SystemTime>,
    current: Option<std::time::SystemTime>,
) -> bool {
    current.is_some() && current != previous
}

fn request_asset_reload(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    asset_root: Res<RuntimeAssetRoot>,
    mut path: ResMut<LoadedScriptPath>,
    scripts: Query<Entity, With<ScriptComponent>>,
) {
    let requested = SCRIPT_SWITCH_REQUESTED
        .lock()
        .ok()
        .and_then(|mut requested| requested.take());
    if let Some(requested) = requested {
        let asset_path = match normalize_script_path(&asset_root.0, &requested)
            .and_then(|path| script_backend(&path).map(|_| path))
        {
            Ok(path) if asset_root.0.join(&path).is_file() => path,
            Ok(path) => {
                error!("Requested script does not exist: {}", path.display());
                return;
            }
            Err(error) => {
                error!("Could not switch runtime script: {error}");
                return;
            }
        };
        for entity in &scripts {
            commands.entity(entity).despawn();
        }
        commands.spawn(ScriptComponent::new(vec![
            asset_server.load::<ScriptAsset>(asset_path.clone()),
        ]));
        path.source_path = asset_root.0.join(&asset_path);
        path.modified = fs::metadata(&path.source_path)
            .and_then(|metadata| metadata.modified())
            .ok();
        path.asset_path = asset_path;
        info!("Switched runtime script to {}", path.source_path.display());
        return;
    }

    let reload_requested = RELOAD_REQUESTED.swap(false, Ordering::AcqRel);
    if reload_requested {
        info!("Reloading script: {}", path.source_path.display());
        asset_server.reload(path.asset_path.clone());
    }
}

#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
fn poll_asset_reload(
    time: Res<Time>,
    mut timer: ResMut<ScriptFilePollTimer>,
    asset_server: Res<AssetServer>,
    mut path: ResMut<LoadedScriptPath>,
) {
    if !timer.0.tick(time.delta()).just_finished() {
        return;
    }

    let modified = fs::metadata(&path.source_path)
        .and_then(|metadata| metadata.modified())
        .ok();
    if source_has_changed(path.modified, modified) {
        path.modified = modified;
        info!(
            "Reloading script after source change: {}",
            path.source_path.display()
        );
        asset_server.reload(path.asset_path.clone());
    }
}

fn emit_update(time: Res<Time>, mut callbacks: MessageWriter<ScriptCallbackEvent>) {
    callbacks.write(ScriptCallbackEvent::new_for_all_scripts(
        OnUpdate,
        vec![ScriptValue::Float(time.delta_secs_f64().min(0.05))],
    ));
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

fn script_backend(path: &Path) -> Result<&'static str, String> {
    match path.extension().and_then(|extension| extension.to_str()) {
        #[cfg(any(feature = "js", feature = "typescript"))]
        Some("js" | "mjs") => Ok("QuickJS"),
        #[cfg(feature = "lua")]
        Some("lua") => Ok("Lua 5.5"),
        Some(extension) => Err(format!("unsupported script extension: .{extension}")),
        None => Err("script path must have a supported extension".to_owned()),
    }
}

/// Builds the Bevy application without starting its platform event loop.
pub fn build_app_with_assets(asset_root: PathBuf, script_path: PathBuf) -> Result<App, String> {
    let asset_path = normalize_script_path(&asset_root, &script_path)?;
    let backend = script_backend(&asset_path)?;
    if !asset_root.is_dir() {
        return Err(format!(
            "asset directory does not exist: {}",
            asset_root.display()
        ));
    }
    let runtime_config = fs::read(asset_root.join("engineConfig.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RuntimeConfig>(&bytes).ok())
        .unwrap_or_default();
    let title = runtime_config
        .app_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("Script Squadron - {backend}"));

    let mut app = App::new();
    let scripting_plugins = runtime_scripting_plugins();

    #[cfg(target_os = "android")]
    {
        let file_asset_root = asset_root.clone();
        app.register_asset_source(
            AssetSourceId::Default,
            AssetSourceBuilder::new(move || {
                Box::new(FileAssetReader::new(file_asset_root.clone()))
            }),
        );
    }

    app.add_plugins(
        DefaultPlugins
            .set(AssetPlugin {
                file_path: asset_root.to_string_lossy().into_owned(),
                watch_for_changes_override: Some(false),
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title,
                    resolution: WindowResolution::new(WINDOW_WIDTH, WINDOW_HEIGHT),
                    #[cfg(any(target_os = "android", target_os = "ios"))]
                    mode: WindowMode::BorderlessFullscreen(MonitorSelection::Primary),
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
    .add_plugins(RuneweaveScriptApiPlugin)
    .insert_resource(LoadedScriptPath {
        source_path: asset_root.join(&asset_path),
        modified: fs::metadata(asset_root.join(&asset_path))
            .and_then(|metadata| metadata.modified())
            .ok(),
        asset_path,
    })
    .insert_resource(RuntimeAssetRoot(asset_root.clone()))
    .add_systems(
        Startup,
        (
            attach_script,
            spawn_scene_camera,
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            set_default_window_icon,
        ),
    )
    .add_systems(
        Update,
        (
            request_asset_reload,
            #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
            poll_asset_reload,
            emit_update,
            #[cfg(any(feature = "js", feature = "typescript"))]
            event_handler::<OnUpdate, QuickJsScriptingPlugin>,
            #[cfg(feature = "lua")]
            event_handler::<OnUpdate, LuaScriptingPlugin>,
        )
            .chain(),
    );
    #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
    app.insert_resource(ScriptFilePollTimer(Timer::from_seconds(
        0.5,
        TimerMode::Repeating,
    )));
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

/// Requests a BMS asset reload on the runtime's next frame.
pub extern "C" fn game_runtime_request_reload() {
    RELOAD_REQUESTED.store(true, Ordering::Release);
}

/// Switches the active script to another relative path inside the current asset directory.
///
/// # Safety
///
/// `script_path` must point to a valid, NUL-terminated UTF-8 string for the duration of this call.
pub unsafe extern "C" fn game_runtime_switch_script(script_path: *const c_char) -> c_int {
    let script_path = match unsafe { c_path(script_path) } {
        Ok(path) => path,
        Err(code) => return code,
    };
    if normalize_script_path(Path::new("assets"), &script_path)
        .and_then(|path| script_backend(&path).map(|_| path))
        .is_err()
    {
        return 2;
    }
    match SCRIPT_SWITCH_REQUESTED.lock() {
        Ok(mut requested) => {
            *requested = Some(script_path);
            RELOAD_REQUESTED.store(true, Ordering::Release);
            0
        }
        Err(_) => 3,
    }
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
    #[cfg(feature = "unified")]
    use bevy::ecs::message::Messages;
    #[cfg(feature = "unified")]
    use bevy_mod_scripting::core::event::{ScriptAttachedEvent, ScriptDetachedEvent};

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

    #[test]
    fn scene_camera_keeps_a_responsive_virtual_height() {
        let mut world = World::new();
        world
            .run_system_cached(spawn_scene_camera)
            .expect("camera startup system must run");
        let projection = world
            .query::<&Projection>()
            .single(&world)
            .expect("one camera projection must be spawned");
        let Projection::Orthographic(projection) = projection else {
            panic!("scene camera must be orthographic");
        };
        let bevy::camera::ScalingMode::FixedVertical { viewport_height } = projection.scaling_mode
        else {
            panic!("scene camera must keep a fixed virtual height");
        };
        assert_eq!(viewport_height, crate::GAME_VIEWPORT_HEIGHT);
    }

    #[cfg(feature = "unified")]
    #[test]
    fn runtime_registers_script_loading_pipeline() {
        let mut app = App::new();
        app.add_plugins((MinimalPlugins, AssetPlugin::default()))
            .add_plugins(runtime_scripting_plugins());
        assert!(
            app.world()
                .contains_resource::<Messages<ScriptAttachedEvent>>()
        );
        assert!(
            app.world()
                .contains_resource::<Messages<ScriptDetachedEvent>>()
        );
    }

    #[cfg(all(feature = "lua", any(feature = "js", feature = "typescript")))]
    #[test]
    fn unified_runtime_routes_lua_and_quickjs_scripts() -> Result<(), String> {
        assert_eq!(script_backend(Path::new("shooter.lua"))?, "Lua 5.5");
        assert_eq!(script_backend(Path::new("shooter.js"))?, "QuickJS");
        assert_eq!(script_backend(Path::new("shooter.mjs"))?, "QuickJS");
        Ok(())
    }
}
