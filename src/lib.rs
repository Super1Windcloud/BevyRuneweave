#[cfg(any(feature = "lua", feature = "luau"))]
mod lua;
#[cfg(feature = "js")]
mod quickjs;
#[cfg(not(any(feature = "js", feature = "lua", feature = "luau")))]
compile_error!("enable exactly one scripting feature: js, lua, or luau");
#[cfg(any(
    all(feature = "js", any(feature = "lua", feature = "luau")),
    all(feature = "lua", feature = "luau")
))]
compile_error!("the js, lua, and luau features are mutually exclusive");

use std::{
    collections::HashMap,
    ffi::{CStr, c_char, c_int},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use bevy::{
    asset::AssetPlugin,
    prelude::*,
    sprite::Anchor,
    window::{PresentMode, WindowResolution},
};
use bevy_mod_scripting::prelude::{
    BMSPlugin, ScriptAsset, ScriptCallbackEvent, ScriptComponent, ScriptValue, callback_labels,
    event_handler,
};

#[cfg(all(not(feature = "js"), any(feature = "lua", feature = "luau")))]
use bevy_mod_scripting::lua::LuaScriptingPlugin as ActiveScriptingPlugin;
#[cfg(feature = "js")]
use bevy_mod_scripting_quickjs::QuickJsScriptingPlugin as ActiveScriptingPlugin;

static RELOAD_REQUESTED: AtomicBool = AtomicBool::new(false);
static COMMAND_QUEUE: OnceLock<CommandQueue> = OnceLock::new();

const WINDOW_WIDTH: u32 = 600;
const WINDOW_HEIGHT: u32 = 800;

callback_labels!(OnUpdate => "on_update");

#[derive(Debug)]
pub(crate) enum ScriptCommand {
    Clear,
    Spawn {
        kind: String,
        id: String,
        x: f32,
        y: f32,
    },
    SetPosition {
        id: String,
        x: f32,
        y: f32,
    },
    Despawn {
        id: String,
    },
    SetHud {
        score: i32,
        lives: i32,
        message: String,
    },
}

#[derive(Resource, Clone, Default)]
pub(crate) struct CommandQueue(pub Arc<Mutex<Vec<ScriptCommand>>>);

pub(crate) fn runtime_command_queue() -> CommandQueue {
    COMMAND_QUEUE.get_or_init(CommandQueue::default).clone()
}

pub(crate) fn queue_command(command: ScriptCommand) {
    runtime_command_queue()
        .0
        .lock()
        .expect("script command queue poisoned")
        .push(command);
}

#[derive(Resource)]
struct LoadedScriptPath(PathBuf);

#[derive(Resource, Default)]
struct ScriptEntities(HashMap<String, Entity>);

#[derive(Component)]
struct ScriptGameEntity;

#[derive(Component)]
struct HudText;

fn setup(mut commands: Commands, asset_server: Res<AssetServer>, path: Res<LoadedScriptPath>) {
    commands.spawn(Camera2d);
    commands.spawn((
        Sprite {
            image: asset_server.load("sprites/background.png"),
            custom_size: Some(Vec2::new(WINDOW_WIDTH as f32, WINDOW_HEIGHT as f32)),
            ..default()
        },
        Transform::from_xyz(0.0, 0.0, -10.0),
    ));
    commands.spawn((
        Text2d::new("SCORE 00000    LIVES 3"),
        TextFont {
            font_size: FontSize::Px(25.0),
            ..default()
        },
        TextColor(Color::srgb(0.82, 0.94, 1.0)),
        Anchor::TOP_CENTER,
        Transform::from_xyz(0.0, 382.0, 20.0),
        HudText,
    ));
    commands.spawn(ScriptComponent::new(vec![
        asset_server.load::<ScriptAsset>(path.0.clone()),
    ]));
}

fn request_asset_reload(asset_server: Res<AssetServer>, path: Res<LoadedScriptPath>) {
    if RELOAD_REQUESTED.swap(false, Ordering::AcqRel) {
        asset_server.reload(path.0.clone());
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
    callbacks.write(ScriptCallbackEvent::new_for_all_scripts(
        OnUpdate,
        vec![
            ScriptValue::Float(time.delta_secs_f64().min(0.05)),
            ScriptValue::Float(horizontal.clamp(-1.0, 1.0)),
            ScriptValue::Float(vertical.clamp(-1.0, 1.0)),
            ScriptValue::Bool(keyboard.pressed(KeyCode::Space)),
        ],
    ));
}

fn axis(keyboard: &ButtonInput<KeyCode>, negative: KeyCode, positive: KeyCode) -> f64 {
    f64::from(keyboard.pressed(positive)) - f64::from(keyboard.pressed(negative))
}

fn sprite_spec(kind: &str) -> (&'static str, Vec2, f32) {
    match kind {
        "player" => ("sprites/player.png", Vec2::new(72.0, 88.0), 3.0),
        "enemy" => ("sprites/enemy.png", Vec2::new(66.0, 70.0), 2.0),
        "bullet" => ("sprites/bullet.png", Vec2::new(14.0, 34.0), 1.0),
        _ => ("sprites/bullet.png", Vec2::splat(24.0), 1.0),
    }
}

fn apply_script_commands(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    queue: Res<CommandQueue>,
    mut entities: ResMut<ScriptEntities>,
    mut transforms: Query<&mut Transform>,
    mut hud: Query<&mut Text2d, With<HudText>>,
    game_entities: Query<Entity, With<ScriptGameEntity>>,
) {
    let pending = std::mem::take(&mut *queue.0.lock().expect("script command queue poisoned"));
    for command in pending {
        match command {
            ScriptCommand::Clear => {
                for entity in &game_entities {
                    commands.entity(entity).despawn();
                }
                entities.0.clear();
            }
            ScriptCommand::Spawn { kind, id, x, y } => {
                if let Some(old) = entities.0.remove(&id) {
                    commands.entity(old).despawn();
                }
                let (path, size, z) = sprite_spec(&kind);
                let entity = commands
                    .spawn((
                        Sprite {
                            image: asset_server.load(path),
                            custom_size: Some(size),
                            ..default()
                        },
                        Transform::from_xyz(x, y, z),
                        ScriptGameEntity,
                    ))
                    .id();
                entities.0.insert(id, entity);
            }
            ScriptCommand::SetPosition { id, x, y } => {
                if let Some(entity) = entities.0.get(&id)
                    && let Ok(mut transform) = transforms.get_mut(*entity)
                {
                    transform.translation.x = x;
                    transform.translation.y = y;
                }
            }
            ScriptCommand::Despawn { id } => {
                if let Some(entity) = entities.0.remove(&id) {
                    commands.entity(entity).despawn();
                }
            }
            ScriptCommand::SetHud {
                score,
                lives,
                message,
            } => {
                if let Ok(mut text) = hud.single_mut() {
                    text.0 = if message.is_empty() {
                        format!("SCORE {score:05}    LIVES {lives}")
                    } else {
                        format!("SCORE {score:05}    LIVES {lives}\n{message}")
                    };
                }
            }
        }
    }
}

fn normalize_script_path(asset_root: &Path, path: &Path) -> Result<PathBuf, String> {
    let relative = if path.is_absolute() {
        path.strip_prefix(&asset_root)
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

#[cfg(feature = "js")]
fn add_language(app: &mut App) {
    app.add_plugins(quickjs::game_quickjs_plugin());
}

#[cfg(all(not(feature = "js"), any(feature = "lua", feature = "luau")))]
fn add_language(app: &mut App) {
    app.add_plugins(lua::game_lua_plugin());
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
    let queue = runtime_command_queue();
    queue
        .0
        .lock()
        .expect("script command queue poisoned")
        .clear();

    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            .set(AssetPlugin {
                file_path: asset_root.to_string_lossy().into_owned(),
                watch_for_changes_override: Some(true),
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: format!("Script Squadron - {}", active_language()),
                    resolution: WindowResolution::new(WINDOW_WIDTH, WINDOW_HEIGHT),
                    present_mode: PresentMode::AutoVsync,
                    resizable: false,
                    ..default()
                }),
                ..default()
            }),
    )
    .add_plugins(BMSPlugin)
    .insert_resource(queue)
    .insert_resource(LoadedScriptPath(asset_path))
    .init_resource::<ScriptEntities>()
    .add_systems(Startup, setup)
    .add_systems(
        Update,
        (
            request_asset_reload,
            emit_update,
            event_handler::<OnUpdate, ActiveScriptingPlugin>,
            apply_script_commands,
        )
            .chain(),
    );
    add_language(&mut app);
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
    #[cfg(feature = "js")]
    return "assets/shooter.js";
    #[cfg(all(not(feature = "js"), feature = "lua"))]
    return "assets/shooter.lua";
    #[cfg(all(not(feature = "js"), not(feature = "lua"), feature = "luau"))]
    return "assets/shooter.luau";
}

const fn active_language() -> &'static str {
    #[cfg(feature = "js")]
    return "QuickJS";
    #[cfg(all(not(feature = "js"), feature = "lua"))]
    return "Lua 5.5";
    #[cfg(all(not(feature = "js"), not(feature = "lua"), feature = "luau"))]
    return "Luau";
}

/// Requests a BMS asset reload on the runtime's next frame.
#[unsafe(no_mangle)]
pub extern "C" fn game_runtime_request_reload() {
    RELOAD_REQUESTED.store(true, Ordering::Release);
}

/// C ABI entry point for desktop/mobile hosts. Returns non-zero for invalid input or startup panic.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn game_runtime_run(script_path: *const c_char) -> c_int {
    if script_path.is_null() {
        return 1;
    }
    // SAFETY: The caller promises a valid, NUL-terminated string for this call.
    let path = unsafe { CStr::from_ptr(script_path) };
    let Ok(path) = path.to_str() else {
        return 2;
    };
    match std::panic::catch_unwind(|| run(PathBuf::from(path))) {
        Ok(()) => 0,
        Err(_) => 3,
    }
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
}
