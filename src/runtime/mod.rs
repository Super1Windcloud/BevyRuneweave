use serde::Deserialize;
use std::{
    ffi::{CStr, c_char, c_int},
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
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
    render::{Render, RenderApp, RenderSystems, view::window::ExtractedWindows},
    window::{AppLifecycle, MonitorSelection, PresentMode, WindowFocused, WindowResolution},
};
use bevy_mod_scripting::core::event::ScriptAttachedEvent;
use bevy_mod_scripting::prelude::{
    BMSPlugin, ConfigureScriptPlugin, ScriptAsset, ScriptCallbackEvent, ScriptComponent,
    ScriptValue, callback_labels, event_handler,
};
#[cfg(target_os = "windows")]
use winit::platform::windows::WindowExtWindows;

use crate::{script_api::RuneweaveScriptApiPlugin, script_crypto::decrypt_script_asset};

#[cfg(feature = "lua")]
use bevy_mod_scripting::lua::LuaScriptingPlugin;
#[cfg(any(feature = "js", feature = "typescript"))]
use bevy_mod_scripting::quickjs::QuickJsScriptingPlugin;

static RELOAD_REQUESTED: AtomicBool = AtomicBool::new(false);
static SCRIPT_SWITCH_REQUESTED: Mutex<Option<PathBuf>> = Mutex::new(None);
static EXIT_CALLBACK: Mutex<Option<RuntimeExitCallback>> = Mutex::new(None);

/// Host callback invoked when a script requests leaving the current game session.
pub type RuntimeExitCallback = extern "C" fn();

const WINDOW_WIDTH: u32 = 600;
const WINDOW_HEIGHT: u32 = 800;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
const DEFAULT_WINDOW_ICON: &[u8] = include_bytes!("../../assets/branding/bevy_icon.png");
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
const DESKTOP_ICON_CORNER_RADIUS_RATIO: f32 = 0.2;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    app_name: Option<String>,
    #[cfg_attr(
        not(any(target_os = "windows", target_os = "macos", target_os = "linux")),
        allow(dead_code)
    )]
    icon: Option<String>,
    window: Option<serde_json::Value>,
    render: Option<serde_json::Value>,
}

#[derive(Resource, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeRenderSettings {
    msaa_samples: u32,
    fxaa: bool,
}
impl Default for RuntimeRenderSettings {
    fn default() -> Self {
        Self {
            msaa_samples: 4,
            fxaa: false,
        }
    }
}
impl RuntimeRenderSettings {
    fn parse(value: Option<serde_json::Value>) -> Result<Self, String> {
        let settings: Self = value
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("Invalid render configuration: {error}"))?
            .unwrap_or_default();
        if !matches!(settings.msaa_samples, 1 | 2 | 4 | 8)
            || settings.fxaa && settings.msaa_samples != 1
        {
            return Err("render.msaaSamples must be 1, 2, 4 or 8; FXAA requires 1".into());
        }
        Ok(settings)
    }
    fn msaa(&self) -> Msaa {
        match self.msaa_samples {
            1 => Msaa::Off,
            2 => Msaa::Sample2,
            8 => Msaa::Sample8,
            _ => Msaa::Sample4,
        }
    }
}

/// Apply desktop dimensions before winit creates and centers the native window.
/// Mobile hosts retain their platform-managed fullscreen window.
fn initial_window(
    title: String,
    configuration: Option<serde_json::Value>,
) -> Result<Window, String> {
    let resolution = WindowResolution::new(WINDOW_WIDTH, WINDOW_HEIGHT);
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let (resolution, present_mode) = if let Some(configuration) = configuration {
        #[derive(Deserialize)]
        struct Dimensions {
            width: u32,
            height: u32,
            vsync: Option<bool>,
        }
        let dimensions: Dimensions = serde_json::from_value(configuration)
            .map_err(|error| format!("Invalid desktop window configuration: {error}"))?;
        if !(1..=16_384).contains(&dimensions.width) || !(1..=16_384).contains(&dimensions.height) {
            return Err(
                "Desktop window dimensions must be integers between 1 and 16384".to_owned(),
            );
        }
        (
            WindowResolution::new(dimensions.width, dimensions.height),
            if dimensions.vsync.unwrap_or(true) {
                PresentMode::AutoVsync
            } else {
                PresentMode::AutoNoVsync
            },
        )
    } else {
        (resolution, PresentMode::AutoVsync)
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let present_mode = PresentMode::AutoVsync;
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let _ = configuration;

    Ok(Window {
        title,
        resolution,
        #[cfg(any(target_os = "android", target_os = "ios"))]
        mode: WindowMode::BorderlessFullscreen(MonitorSelection::Primary),
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        position: WindowPosition::Centered(MonitorSelection::Primary),
        present_mode,
        resizable: true,
        ..default()
    })
}

callback_labels!(OnUpdate => "on_update", OnSuspend => "on_suspend");

#[derive(Resource)]
pub(crate) struct ScriptLifecycle {
    focused: bool,
    active: bool,
    notified: bool,
}

impl ScriptLifecycle {
    pub(crate) fn is_active(&self) -> bool {
        self.focused && self.active
    }
}

impl Default for ScriptLifecycle {
    fn default() -> Self {
        Self {
            focused: true,
            active: true,
            notified: false,
        }
    }
}

// BMS dispatches the same optional callback through both language adapters.
// Keep focus and application state separate: their native events can arrive in
// different frames, and regaining focus alone does not mean the app has resumed.
fn emit_suspend(
    mut state: ResMut<ScriptLifecycle>,
    mut focus: MessageReader<WindowFocused>,
    mut lifecycle: MessageReader<AppLifecycle>,
    windows: Query<Entity, With<bevy::window::PrimaryWindow>>,
    mut callbacks: MessageWriter<ScriptCallbackEvent>,
) {
    let mut interrupted = false;
    for event in focus.read() {
        if windows.contains(event.window) {
            state.focused = event.focused;
            interrupted |= !event.focused;
        }
    }
    for event in lifecycle.read() {
        match event {
            AppLifecycle::WillSuspend | AppLifecycle::Suspended => {
                state.active = false;
                interrupted = true;
            }
            AppLifecycle::Running | AppLifecycle::WillResume => state.active = true,
            AppLifecycle::Idle => {}
        }
    }
    if interrupted && !state.notified {
        callbacks.write(ScriptCallbackEvent::new_for_all_scripts(OnSuspend, vec![]));
        state.notified = true;
    }
    if state.focused && state.active {
        state.notified = false;
    }
}

fn runtime_scripting_plugins() -> bevy::app::PluginGroupBuilder {
    let plugins = BMSPlugin.build();
    #[cfg(feature = "lua")]
    let plugins =
        plugins.set(LuaScriptingPlugin::default().set_asset_preprocessor(decrypt_script_asset));
    #[cfg(any(feature = "js", feature = "typescript"))]
    let plugins =
        plugins.set(QuickJsScriptingPlugin::default().set_asset_preprocessor(decrypt_script_asset));
    plugins
}

#[derive(Resource)]
struct LoadedScriptPath {
    asset_path: PathBuf,
    source_path: PathBuf,
    modified: Option<std::time::SystemTime>,
}
#[derive(Resource)]
struct RuntimeAssetRoot(PathBuf);

#[derive(Resource)]
struct RuntimeStartupTimer(Instant);

#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
#[derive(Resource)]
struct ScriptFilePollTimer(Timer);

fn attach_script(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    path: Res<LoadedScriptPath>,
) {
    eprintln!(
        "[runtime-timing] attach_script queued at {:?}",
        path.asset_path
    );
    commands.spawn(ScriptComponent::new(vec![
        asset_server.load::<ScriptAsset>(path.asset_path.clone()),
    ]));
}

fn log_script_attached(
    mut events: MessageReader<ScriptAttachedEvent>,
    timer: Res<RuntimeStartupTimer>,
) {
    if events.read().next().is_some() {
        eprintln!(
            "[runtime-timing] script asset attached after {:?}",
            timer.0.elapsed()
        );
    }
}

fn log_first_update(timer: Res<RuntimeStartupTimer>, mut logged: Local<bool>) {
    if !*logged {
        *logged = true;
        eprintln!(
            "[runtime-timing] first update after {:?}",
            timer.0.elapsed()
        );
    }
}

fn log_first_frame_presented(
    timer: Res<RuntimeStartupTimer>,
    windows: Res<ExtractedWindows>,
    mut logged: Local<bool>,
) {
    if *logged
        || !windows.values().any(|window| {
            window.swap_chain_texture_view.is_some() && window.swap_chain_texture.is_none()
        })
    {
        return;
    }

    *logged = true;
    eprintln!(
        "[runtime-timing] first frame submitted for presentation after {:?}",
        timer.0.elapsed()
    );
}

fn spawn_scene_camera(mut commands: Commands, settings: Option<Res<RuntimeRenderSettings>>) {
    let settings = settings.as_deref().cloned().unwrap_or_default();
    commands.spawn((
        Camera2d,
        settings.msaa(),
        IsDefaultUiCamera,
        Camera {
            order: 0,
            ..default()
        },
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: bevy::camera::ScalingMode::FixedVertical {
                viewport_height: crate::GAME_VIEWPORT_HEIGHT,
            },
            ..OrthographicProjection::default_2d()
        }),
    ));
    let mut camera_3d = commands.spawn((
        Camera3d::default(),
        settings.msaa(),
        Camera {
            is_active: false,
            order: 1,
            clear_color: bevy::camera::ClearColorConfig::None,
            ..default()
        },
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: bevy::camera::ScalingMode::FixedVertical {
                viewport_height: 22.0,
            },
            ..OrthographicProjection::default_3d()
        }),
        Transform::from_xyz(0.0, 18.0, 16.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    if settings.fxaa {
        camera_3d.insert(bevy::anti_alias::fxaa::Fxaa::default());
    }
    commands.spawn((
        DirectionalLight {
            illuminance: 12_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -0.9, -0.55, 0.0)),
    ));
    commands.insert_resource(GlobalAmbientLight {
        color: Color::WHITE,
        brightness: 600.0,
        ..default()
    });
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn decode_desktop_icon(bytes: &[u8]) -> Result<image::RgbaImage, image::ImageError> {
    let mut image = image::load_from_memory(bytes)?.into_rgba8();
    let (width, height) = image.dimensions();
    let radius = width.min(height) as f32 * DESKTOP_ICON_CORNER_RADIUS_RATIO;
    let half_width = width as f32 / 2.0;
    let half_height = height as f32 / 2.0;
    let inner_half_width = (half_width - radius).max(0.0);
    let inner_half_height = (half_height - radius).max(0.0);

    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let dx = ((x as f32 + 0.5) - half_width).abs() - inner_half_width;
        let dy = ((y as f32 + 0.5) - half_height).abs() - inner_half_height;
        let corner_distance = dx.max(0.0).hypot(dy.max(0.0));
        let coverage = (radius + 0.5 - corner_distance).clamp(0.0, 1.0);
        pixel.0[3] = (pixel.0[3] as f32 * coverage).round() as u8;
    }

    Ok(image)
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn load_desktop_icon(asset_root: &Path) -> Result<image::RgbaImage, image::ImageError> {
    // Cargo launchers use the project icon directly; downloaded HTTP icons are
    // still provided by the native host at .runtime-icon.png.
    let configured_icon = fs::read(asset_root.join("engineConfig.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RuntimeConfig>(&bytes).ok())
        .and_then(|config| config.icon)
        .filter(|icon| {
            !icon.is_empty()
                && !icon.contains("://")
                && Path::new(icon)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
        });
    if let Some(icon) = configured_icon {
        let path = asset_root.join(icon);
        match fs::read(&path)
            .ok()
            .and_then(|bytes| decode_desktop_icon(&bytes).ok())
        {
            Some(image) => return Ok(image),
            None => warn!(
                "Could not load configured application icon {}",
                path.display()
            ),
        }
    }
    let custom_icon = asset_root.join(".runtime-icon.png");
    match fs::read(&custom_icon) {
        Ok(bytes) => match decode_desktop_icon(&bytes) {
            Ok(image) => return Ok(image),
            Err(error) => warn!(
                "Failed to decode custom runtime icon {}: {error}; using the default icon",
                custom_icon.display()
            ),
        },
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => warn!(
            "Failed to read custom runtime icon {}: {error}; using the default icon",
            custom_icon.display()
        ),
        Err(_) => {}
    }
    decode_desktop_icon(DEFAULT_WINDOW_ICON)
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn set_default_window_icon(
    primary_window: Single<Entity, With<PrimaryWindow>>,
    asset_root: Res<RuntimeAssetRoot>,
) {
    let image = match load_desktop_icon(&asset_root.0) {
        Ok(image) => image,
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
fn set_default_window_icon(asset_root: Res<RuntimeAssetRoot>) {
    use objc2::AnyThread as _;
    use objc2_app_kit::{NSApplication, NSBitmapImageRep, NSDeviceRGBColorSpace, NSImage};
    use objc2_foundation::NSSize;

    let image = match load_desktop_icon(&asset_root.0) {
        Ok(image) => image,
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

#[derive(Debug, PartialEq)]
enum RuntimeRequest {
    Switch(PathBuf),
    Reload,
}

fn take_runtime_request() -> Option<RuntimeRequest> {
    // A switch performs a fresh load, so it also consumes any pending reload.
    let reload_requested = RELOAD_REQUESTED.swap(false, Ordering::AcqRel);
    let switch_requested = SCRIPT_SWITCH_REQUESTED
        .lock()
        .ok()
        .and_then(|mut requested| requested.take());
    match switch_requested {
        Some(path) => Some(RuntimeRequest::Switch(path)),
        None => reload_requested.then_some(RuntimeRequest::Reload),
    }
}

fn request_asset_reload(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    asset_root: Res<RuntimeAssetRoot>,
    mut path: ResMut<LoadedScriptPath>,
    mut storage: ResMut<crate::script_api::storage::ScriptStorage>,
    scripts: Query<Entity, With<ScriptComponent>>,
) {
    let Some(request) = take_runtime_request() else {
        return;
    };
    if let RuntimeRequest::Switch(requested) = request {
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
        storage.refresh_for_assets(&asset_root.0);
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

    info!("Reloading script: {}", path.source_path.display());
    storage.refresh_for_assets(&asset_root.0);
    asset_server.reload(path.asset_path.clone());
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
    let relative = if path.has_root() {
        path.strip_prefix(asset_root)
            .map_err(|_| format!("script must be inside {}", asset_root.display()))?
    } else {
        path.strip_prefix("assets").unwrap_or(path)
    };
    if relative.as_os_str().is_empty()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
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
    let startup_timer = Instant::now();
    eprintln!(
        "[runtime-timing] build_app_with_assets start: assets={}, script={}",
        asset_root.display(),
        script_path.display()
    );
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
    let window = initial_window(title, runtime_config.window)?;
    let render_settings = RuntimeRenderSettings::parse(runtime_config.render)?;

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
                primary_window: Some(window),
                ..default()
            }),
    )
    .add_plugins(scripting_plugins)
    .add_plugins(RuneweaveScriptApiPlugin)
    .insert_resource(RuntimeStartupTimer(startup_timer))
    .insert_resource(render_settings)
    .insert_resource(LoadedScriptPath {
        source_path: asset_root.join(&asset_path),
        modified: fs::metadata(asset_root.join(&asset_path))
            .and_then(|metadata| metadata.modified())
            .ok(),
        asset_path,
    })
    .insert_resource(RuntimeAssetRoot(asset_root.clone()))
    .init_resource::<ScriptLifecycle>()
    .insert_resource(crate::script_api::storage::ScriptStorage::for_assets(
        &asset_root,
    ))
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
            log_first_update,
            log_script_attached,
            #[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
            poll_asset_reload,
            emit_suspend,
            #[cfg(any(feature = "js", feature = "typescript"))]
            event_handler::<OnSuspend, QuickJsScriptingPlugin>,
            #[cfg(feature = "lua")]
            event_handler::<OnSuspend, LuaScriptingPlugin>,
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
    app.get_sub_app_mut(RenderApp)
        .ok_or_else(|| "render app is unavailable".to_owned())?
        .insert_resource(RuntimeStartupTimer(startup_timer))
        .add_systems(
            Render,
            log_first_frame_presented.after(RenderSystems::Render),
        );
    crate::script_api::install_audio(&mut app);
    #[cfg(debug_assertions)]
    if std::env::var_os("RUNEWEAVE_RENDER_DIAGNOSTICS").is_some() {
        app.add_plugins((
            bevy::diagnostic::FrameTimeDiagnosticsPlugin::default(),
            bevy::render::diagnostic::RenderDiagnosticsPlugin,
            bevy::diagnostic::LogDiagnosticsPlugin::default(),
        ));
    }
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

/// Installs or clears the host callback used for script exit requests.
///
/// Embedding hosts use this to return to their launcher without terminating the
/// process-owned platform event loop. Without a callback, exit requests retain
/// the standalone behavior and emit Bevy's portable [`AppExit::Success`].
pub extern "C" fn game_runtime_set_exit_callback(callback: Option<RuntimeExitCallback>) {
    if let Ok(mut registered) = EXIT_CALLBACK.lock() {
        *registered = callback;
    }
}

pub(crate) fn request_runtime_exit(world: &mut World) -> bool {
    let callback = EXIT_CALLBACK.lock().ok().and_then(|registered| *registered);
    dispatch_exit_request(world, callback)
}

fn dispatch_exit_request(world: &mut World, callback: Option<RuntimeExitCallback>) -> bool {
    if let Some(callback) = callback {
        callback();
        true
    } else {
        world.write_message(AppExit::Success).is_some()
    }
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

    static EXIT_CALLBACK_CALLED: AtomicBool = AtomicBool::new(false);

    extern "C" fn record_exit_callback() {
        EXIT_CALLBACK_CALLED.store(true, Ordering::Release);
    }

    #[test]
    fn suspension_is_primary_window_scoped_deduplicated_and_rearmed_after_resume() {
        let mut app = App::new();
        app.add_message::<WindowFocused>()
            .add_message::<AppLifecycle>()
            .add_message::<ScriptCallbackEvent>()
            .init_resource::<ScriptLifecycle>()
            .add_systems(Update, emit_suspend);
        let primary = app.world_mut().spawn(bevy::window::PrimaryWindow).id();
        let secondary = app.world_mut().spawn_empty().id();
        let count = |app: &mut App| {
            let messages = app
                .world()
                .resource::<bevy::ecs::message::Messages<ScriptCallbackEvent>>();
            let mut cursor = messages.get_cursor();
            cursor
                .read(messages)
                .filter(|event| event.label == OnSuspend.into())
                .count()
        };
        app.world_mut().write_message(WindowFocused {
            window: secondary,
            focused: false,
        });
        app.update();
        assert_eq!(count(&mut app), 0);
        app.world_mut().write_message(WindowFocused {
            window: primary,
            focused: false,
        });
        app.update();
        assert_eq!(count(&mut app), 1);
        app.world_mut().write_message(AppLifecycle::WillSuspend);
        app.world_mut().write_message(AppLifecycle::Suspended);
        app.update();
        app.update();
        assert_eq!(
            count(&mut app),
            0,
            "duplicate focus/lifecycle notifications must not repeat callbacks"
        );
        app.world_mut().write_message(WindowFocused {
            window: primary,
            focused: true,
        });
        app.update();
        assert!(app.world().resource::<ScriptLifecycle>().notified);
        app.world_mut().write_message(AppLifecycle::Running);
        app.update();
        assert!(!app.world().resource::<ScriptLifecycle>().notified);
        app.world_mut().write_message(WindowFocused {
            window: primary,
            focused: false,
        });
        app.world_mut().write_message(WindowFocused {
            window: primary,
            focused: true,
        });
        app.update();
        assert_eq!(
            count(&mut app),
            1,
            "even a focus cycle completed in one frame must notify scripts"
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn desktop_window_uses_project_dimensions_before_native_creation() {
        let config: RuntimeConfig =
            serde_json::from_str(r#"{"appName":"Game","window":{"width":1280,"height":800}}"#)
                .unwrap();
        let window = initial_window(config.app_name.unwrap(), config.window).unwrap();
        assert_eq!((window.width(), window.height()), (1280.0, 800.0));
        assert!(matches!(
            window.position,
            WindowPosition::Centered(MonitorSelection::Primary)
        ));
        assert!(window.resizable, "manual resizing must remain available");
        assert_eq!(window.present_mode, PresentMode::AutoVsync);
        let unsynchronized = initial_window(
            "Game".into(),
            Some(serde_json::json!({"width":1280,"height":720,"vsync":false})),
        )
        .unwrap();
        assert_eq!(unsynchronized.present_mode, PresentMode::AutoNoVsync);
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn desktop_window_keeps_legacy_defaults_and_rejects_invalid_dimensions() {
        let config: RuntimeConfig = serde_json::from_str(r#"{"appName":"Legacy"}"#).unwrap();
        let window = initial_window(config.app_name.unwrap(), config.window).unwrap();
        assert_eq!((window.width(), window.height()), (600.0, 800.0));
        for configuration in [
            serde_json::json!({ "width": 0, "height": 800 }),
            serde_json::json!({ "width": 1280, "height": 16_385 }),
            serde_json::json!({ "width": -1, "height": 800 }),
            serde_json::json!({ "width": 1280.5, "height": 800 }),
            serde_json::json!({ "width": "1280", "height": 800 }),
            serde_json::json!({ "width": 1280 }),
            serde_json::json!({ "width": 1280, "height": 720, "vsync": "false" }),
        ] {
            assert!(initial_window("Invalid".to_owned(), Some(configuration)).is_err());
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    #[test]
    fn mobile_window_keeps_fullscreen_and_ignores_desktop_configuration() {
        let window = initial_window(
            "Mobile".to_owned(),
            Some(serde_json::json!({ "width": 1280, "height": 800 })),
        )
        .unwrap();
        assert!(matches!(
            window.mode,
            WindowMode::BorderlessFullscreen(MonitorSelection::Primary)
        ));
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn desktop_icon_has_rounded_corners_without_changing_inner_alpha() {
        let mut source = image::RgbaImage::from_pixel(32, 32, image::Rgba([40, 80, 120, 255]));
        source.put_pixel(16, 16, image::Rgba([40, 80, 120, 73]));
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(source)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("test icon must encode");

        let rounded = decode_desktop_icon(encoded.get_ref()).expect("test icon must decode");

        assert_eq!(rounded.get_pixel(0, 0).0[3], 0);
        assert_eq!(rounded.get_pixel(31, 0).0[3], 0);
        assert_eq!(rounded.get_pixel(0, 31).0[3], 0);
        assert_eq!(rounded.get_pixel(31, 31).0[3], 0);
        assert_eq!(rounded.get_pixel(16, 16).0, [40, 80, 120, 73]);
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn configured_project_icon_overrides_cached_icon_without_allowing_parent_paths() {
        let directory = tempfile::tempdir().unwrap();
        let assets = directory.path();
        fs::create_dir(assets.join("branding")).unwrap();
        image::RgbaImage::from_pixel(32, 32, image::Rgba([12, 34, 56, 255]))
            .save(assets.join("branding/icon.png"))
            .unwrap();
        image::RgbaImage::from_pixel(32, 32, image::Rgba([90, 80, 70, 255]))
            .save(assets.join(".runtime-icon.png"))
            .unwrap();
        fs::write(
            assets.join("engineConfig.json"),
            r#"{"icon":"branding/icon.png"}"#,
        )
        .unwrap();
        assert_eq!(
            load_desktop_icon(assets).unwrap().get_pixel(16, 16).0,
            [12, 34, 56, 255]
        );

        for icon in [
            "../outside.png",
            "/outside.png",
            "https://example.com/icon.png",
        ] {
            fs::write(
                assets.join("engineConfig.json"),
                serde_json::json!({ "icon": icon }).to_string(),
            )
            .unwrap();
            assert_eq!(
                load_desktop_icon(assets).unwrap().get_pixel(16, 16).0,
                [90, 80, 70, 255]
            );
        }
    }

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
        let asset_root = std::env::current_dir().unwrap().join("assets");
        assert_eq!(
            normalize_script_path(&asset_root, &asset_root.join("shooter.js")).unwrap(),
            PathBuf::from("shooter.js")
        );
    }

    #[test]
    fn rejects_scripts_outside_asset_root() {
        assert!(normalize_script_path(Path::new("assets"), Path::new("../shooter.js")).is_err());
        assert!(normalize_script_path(Path::new("assets"), Path::new("/tmp/shooter.js")).is_err());
        #[cfg(target_os = "windows")]
        for path in [r"\tmp\shooter.js", r"C:shooter.js", r"C:\tmp\shooter.js"] {
            assert!(normalize_script_path(Path::new("assets"), Path::new(path)).is_err());
        }
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
    fn script_switch_consumes_pending_reload_without_reloading_again() {
        let script = std::ffi::CString::new(default_script_path()).expect("path has no NUL");

        game_runtime_request_reload();
        assert_eq!(unsafe { game_runtime_switch_script(script.as_ptr()) }, 0);
        assert_eq!(
            take_runtime_request(),
            Some(RuntimeRequest::Switch(PathBuf::from(default_script_path())))
        );
        assert_eq!(take_runtime_request(), None);

        game_runtime_request_reload();
        assert_eq!(take_runtime_request(), Some(RuntimeRequest::Reload));
        assert_eq!(take_runtime_request(), None);
    }

    #[test]
    fn host_exit_callback_handles_request_without_stopping_bevy() {
        EXIT_CALLBACK_CALLED.store(false, Ordering::Release);
        let mut world = World::new();

        assert!(dispatch_exit_request(
            &mut world,
            Some(record_exit_callback)
        ));
        assert!(EXIT_CALLBACK_CALLED.load(Ordering::Acquire));
    }

    #[test]
    fn scene_camera_keeps_a_responsive_virtual_height() {
        let mut world = World::new();
        world
            .run_system_cached(spawn_scene_camera)
            .expect("camera startup system must run");
        let projection = world
            .query_filtered::<&Projection, With<Camera2d>>()
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
        let ui_camera = world
            .run_system_cached(|camera: bevy::ui::DefaultUiCamera| camera.get())
            .expect("default UI camera query must run")
            .expect("UI must have an active default camera");
        assert!(world.get::<Camera2d>(ui_camera).is_some());

        let (camera, projection) = world
            .query_filtered::<(&Camera, &Projection), With<Camera3d>>()
            .single(&world)
            .expect("one 3D camera projection must be spawned");
        assert!(!camera.is_active);
        let Projection::Orthographic(projection) = projection else {
            panic!("3D scene camera must be orthographic");
        };
        let bevy::camera::ScalingMode::FixedVertical { viewport_height } = projection.scaling_mode
        else {
            panic!("3D scene camera must keep a fixed virtual height");
        };
        assert_eq!(viewport_height, 22.0);
    }

    #[test]
    fn render_settings_validate_and_apply_without_changing_legacy_cameras() {
        for configured in [false, true] {
            let mut world = World::new();
            if configured {
                world.insert_resource(
                    RuntimeRenderSettings::parse(Some(
                        serde_json::json!({"msaaSamples":1,"fxaa":true}),
                    ))
                    .unwrap(),
                );
            }
            world.run_system_cached(spawn_scene_camera).unwrap();
            let cameras: Vec<_> = world
                .query::<(
                    &Msaa,
                    Option<&Camera3d>,
                    Option<&bevy::anti_alias::fxaa::Fxaa>,
                )>()
                .iter(&world)
                .collect();
            assert_eq!(cameras.len(), 2);
            for (msaa, camera_3d, fxaa) in cameras {
                assert_eq!(*msaa, if configured { Msaa::Off } else { Msaa::Sample4 });
                assert_eq!(fxaa.is_some(), configured && camera_3d.is_some());
            }
        }
        for samples in [1, 2, 4, 8] {
            assert!(
                RuntimeRenderSettings::parse(Some(serde_json::json!({"msaaSamples":samples})))
                    .is_ok()
            );
        }
        for value in [
            serde_json::json!({"msaaSamples":0}),
            serde_json::json!({"msaaSamples":3}),
            serde_json::json!({"msaaSamples":1.5}),
            serde_json::json!({"msaaSamples":"1"}),
            serde_json::json!({"fxaa":true}),
            serde_json::json!({"msaaSamples":4,"fxaa":true}),
            serde_json::json!({"msaaSample":1}),
        ] {
            assert!(RuntimeRenderSettings::parse(Some(value)).is_err());
        }
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
