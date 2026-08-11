//! Script-facing Runeweave APIs registered through BMS.

mod input;
mod network;

use std::path::{Component as PathComponent, Path};

use bevy::{prelude::*, sprite::Anchor};
use bevy_mod_scripting::{
    bindings::{FunctionCallContext, InteropError, ReflectReference, WorldExtensions, WorldGuard},
    core::event::ScriptDetachedEvent,
    prelude::{GlobalNamespace, NamespaceBuilder},
    script::ScriptAttachment,
};

use input::{
    input_key_just_pressed, input_key_just_released, input_key_pressed, input_primary_pointer,
    input_primary_touch,
};
use network::ScriptNetwork;

const MAX_ENTITY_ID_LENGTH: usize = 128;

/// Stable script-facing identity stored on a real Bevy entity.
#[derive(Component, Reflect, Clone, Debug, PartialEq, Eq)]
#[reflect(Component)]
pub(crate) struct ScriptEntityId(pub(crate) String);

/// Game state shared between scripts and Rust systems.
#[derive(Resource, Reflect, Clone, Debug, Default, PartialEq)]
#[reflect(Resource)]
pub struct ScriptGameState {
    /// Current score.
    pub score: i64,
    /// Remaining lives.
    pub lives: i64,
    /// Status message shown by the host.
    pub message: String,
}

#[derive(Component, Clone)]
struct ScriptOwnedBy(ScriptAttachment);

fn valid_entity_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ENTITY_ID_LENGTH && !id.chars().any(char::is_control)
}

fn valid_asset_path(path: &str) -> bool {
    let path = Path::new(path);
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, PathComponent::Normal(_)))
}

fn text_anchor(value: &str) -> Anchor {
    match value {
        "bottom_left" => Anchor::BOTTOM_LEFT,
        "bottom_center" => Anchor::BOTTOM_CENTER,
        "bottom_right" => Anchor::BOTTOM_RIGHT,
        "center_left" => Anchor::CENTER_LEFT,
        "center_right" => Anchor::CENTER_RIGHT,
        "top_left" => Anchor::TOP_LEFT,
        "top_center" => Anchor::TOP_CENTER,
        "top_right" => Anchor::TOP_RIGHT,
        _ => Anchor::CENTER,
    }
}

fn current_script(
    context: &FunctionCallContext,
) -> Result<(WorldGuard<'_>, ScriptAttachment), InteropError> {
    let world = context.world()?;
    let attachment = world
        .current_attachment()
        .0
        .ok_or_else(|| InteropError::invariant("script API called without a current attachment"))?;
    Ok((world, attachment))
}

fn find_owned_entity(world: &mut World, owner: &ScriptAttachment, id: &str) -> Option<Entity> {
    let mut query = world.query::<(Entity, &ScriptOwnedBy, &ScriptEntityId)>();
    query
        .iter(world)
        .find(|(_, candidate_owner, candidate_id)| {
            candidate_owner.0 == *owner && candidate_id.0 == id
        })
        .map(|(entity, _, _)| entity)
}

fn scene_spawn(
    context: FunctionCallContext,
    id: String,
    x: f32,
    y: f32,
    z: f32,
) -> Result<bool, InteropError> {
    if !valid_entity_id(&id) {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        if let Some(entity) = find_owned_entity(world, &owner, &id) {
            world
                .entity_mut(entity)
                .insert(Transform::from_xyz(x, y, z));
        } else {
            world.spawn((
                ScriptOwnedBy(owner),
                ScriptEntityId(id),
                Transform::from_xyz(x, y, z),
            ));
        }
        true
    })
}

fn scene_set_sprite(
    context: FunctionCallContext,
    id: String,
    path: String,
    width: f32,
    height: f32,
) -> Result<bool, InteropError> {
    if !valid_asset_path(&path) || width <= 0.0 || height <= 0.0 {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    let asset_server = world
        .with_world(|raw_world| raw_world.get_resource::<AssetServer>().cloned())?
        .ok_or_else(|| InteropError::invariant("scene sprite API requires Bevy AssetPlugin"))?;
    let image = asset_server.load(path);
    world.with_world_mut(|world| {
        let Some(entity) = find_owned_entity(world, &owner, &id) else {
            return false;
        };
        world.entity_mut(entity).insert(Sprite {
            image,
            custom_size: Some(Vec2::new(width, height)),
            ..default()
        });
        true
    })
}

fn scene_set_transform(
    context: FunctionCallContext,
    id: String,
    x: f32,
    y: f32,
    z: f32,
) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_owned_entity(world, &owner, &id) else {
            return false;
        };
        world
            .entity_mut(entity)
            .insert(Transform::from_xyz(x, y, z));
        true
    })
}

#[allow(clippy::too_many_arguments)]
fn scene_set_text(
    context: FunctionCallContext,
    id: String,
    value: String,
    font_size: f32,
    red: f32,
    green: f32,
    blue: f32,
    alpha: f32,
    anchor: String,
) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_owned_entity(world, &owner, &id) else {
            return false;
        };
        world.entity_mut(entity).insert((
            Text2d::new(value),
            TextFont {
                font_size: FontSize::Px(font_size.max(1.0)),
                ..default()
            },
            TextColor(Color::srgba(
                red.clamp(0.0, 1.0),
                green.clamp(0.0, 1.0),
                blue.clamp(0.0, 1.0),
                alpha.clamp(0.0, 1.0),
            )),
            text_anchor(&anchor),
        ));
        true
    })
}

fn scene_despawn(context: FunctionCallContext, id: String) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_owned_entity(world, &owner, &id) else {
            return false;
        };
        world.despawn(entity);
        true
    })
}

fn scene_clear(context: FunctionCallContext) -> Result<(), InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| clear_owned_entities(world, &owner))
}

fn scene_transform(
    context: FunctionCallContext,
    id: String,
) -> Result<Option<ReflectReference>, InteropError> {
    let (world, owner) = current_script(&context)?;
    let entity = world.with_world_mut(|raw_world| find_owned_entity(raw_world, &owner, &id))?;
    entity
        .map(|entity| ReflectReference::new_component_ref::<Transform>(entity, world))
        .transpose()
}

fn game_state_set(
    context: FunctionCallContext,
    score: i64,
    lives: i64,
    message: String,
) -> Result<(), InteropError> {
    context.world()?.with_world_mut(|world| {
        world.insert_resource(ScriptGameState {
            score,
            lives,
            message,
        });
    })
}

fn app_request_exit(context: FunctionCallContext) -> Result<bool, InteropError> {
    context
        .world()?
        .with_world_mut(|world| world.write_message(AppExit::Success).is_some())
}

fn window_set_size(
    context: FunctionCallContext,
    width: f32,
    height: f32,
) -> Result<bool, InteropError> {
    if !width.is_finite()
        || !height.is_finite()
        || width < 1.0
        || height < 1.0
        || width > 16_384.0
        || height > 16_384.0
    {
        return Ok(false);
    }

    let world = context.world()?;
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    return world.with_world_mut(|world| {
        let Some(mut window) = world
            .query_filtered::<&mut Window, With<bevy::window::PrimaryWindow>>()
            .iter_mut(world)
            .next()
        else {
            return false;
        };
        window.resolution.set(width, height);
        true
    });

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = world;
        Ok(false)
    }
}

fn clear_owned_entities(world: &mut World, owner: &ScriptAttachment) {
    let mut query = world.query::<(Entity, &ScriptOwnedBy)>();
    let entities = query
        .iter(world)
        .filter(|(_, candidate)| candidate.0 == *owner)
        .map(|(entity, _)| entity)
        .collect::<Vec<_>>();
    for entity in entities {
        world.despawn(entity);
    }
}

fn clear_detached_script_entities(
    mut detached: MessageReader<ScriptDetachedEvent>,
    mut commands: Commands,
    owned: Query<(Entity, &ScriptOwnedBy)>,
) {
    for event in detached.read() {
        for (entity, owner) in &owned {
            if owner.0 == event.0 {
                commands.entity(entity).despawn();
            }
        }
    }
}

/// Registers Runeweave's reflected game types and BMS functions.
pub(crate) struct RuneweaveScriptApiPlugin;

impl Plugin for RuneweaveScriptApiPlugin {
    fn build(&self, app: &mut App) {
        app.register_type::<ScriptEntityId>()
            .register_type::<Transform>()
            .register_type::<Sprite>()
            .register_type::<Text2d>()
            .register_type::<TextFont>()
            .register_type::<TextColor>()
            .register_type::<ScriptGameState>()
            .init_resource::<ScriptNetwork>()
            .init_resource::<ScriptGameState>()
            .add_systems(Update, clear_detached_script_entities);

        let network = app.world().resource::<ScriptNetwork>().clone();
        NamespaceBuilder::<GlobalNamespace>::new_unregistered(app.world_mut())
            .register("scene_spawn", scene_spawn)
            .register("scene_set_sprite", scene_set_sprite)
            .register("scene_set_transform", scene_set_transform)
            .register("scene_set_text", scene_set_text)
            .register("scene_despawn", scene_despawn)
            .register("scene_clear", scene_clear)
            .register("scene_transform", scene_transform)
            .register("game_state_set", game_state_set)
            .register("app_request_exit", app_request_exit)
            .register("window_set_size", window_set_size)
            .register("input_key_pressed", input_key_pressed)
            .register("input_key_just_pressed", input_key_just_pressed)
            .register("input_key_just_released", input_key_just_released)
            .register("input_primary_touch", input_primary_touch)
            .register("input_primary_pointer", input_primary_pointer)
            .register("http_get", {
                let network = network.clone();
                move |url: String| network.get(url)
            })
            .register("http_post", {
                let network = network.clone();
                move |url: String, body: String, content_type: String| {
                    network.post(url, body, content_type)
                }
            })
            .register("http_poll", move |id: u32| network.poll(id));
    }
}

#[cfg(test)]
mod tests {
    use bevy::app::{App, TaskPoolPlugin};
    use bevy::asset::Handle;
    use bevy::asset::{AssetApp, AssetPlugin};
    use bevy::ecs::message::Messages;
    use bevy::image::Image;
    #[cfg(any(feature = "js", feature = "typescript"))]
    use bevy::input::mouse::MouseButton;
    #[cfg(feature = "lua")]
    use bevy::input::touch::{TouchInput, TouchPhase, touch_screen_input_system};
    use bevy::window::{PrimaryWindow, WindowResolution};
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{
            AppScriptFunctionRegistry, CoreScriptGlobalsPlugin, CurrentScriptAttachment,
            ScriptValue,
        },
        core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
    };

    use super::*;

    #[test]
    fn scene_api_mutates_real_bevy_components() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        world
            .resource::<AppTypeRegistry>()
            .write()
            .register::<Transform>();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache =
            WorldGuard::setup_cache(&world, CurrentScriptAttachment(Some(attachment.clone())));

        WorldGuard::with_static_guard(&mut world, cache, |_guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            assert!(scene_spawn(
                context.clone(),
                "player".to_owned(),
                1.0,
                2.0,
                3.0
            )?);
            assert!(scene_set_transform(
                context.clone(),
                "player".to_owned(),
                4.0,
                5.0,
                6.0,
            )?);
            assert!(scene_transform(context, "player".to_owned())?.is_some());
            Ok::<(), InteropError>(())
        })?;

        let mut query = world.query::<(&ScriptOwnedBy, &ScriptEntityId, &Transform)>();
        let (owner, id, transform) = query.single(&world).map_err(|error| {
            InteropError::string(format!("expected one reflected scene entity: {error}"))
        })?;
        assert_eq!(owner.0, attachment);
        assert_eq!(id.0, "player");
        assert_eq!(transform.translation, Vec3::new(4.0, 5.0, 6.0));
        Ok(())
    }

    #[test]
    fn app_exit_api_writes_the_portable_bevy_exit_message() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        world.init_resource::<Messages<AppExit>>();
        let cache = WorldGuard::setup_cache(&world, CurrentScriptAttachment::default());

        WorldGuard::with_static_guard(&mut world, cache, |_guard| {
            assert!(app_request_exit(FunctionCallContext::new(
                Language::Unknown
            ))?);
            Ok::<(), InteropError>(())
        })?;

        let exits = world
            .resource_mut::<Messages<AppExit>>()
            .drain()
            .collect::<Vec<_>>();
        assert_eq!(exits, vec![AppExit::Success]);
        Ok(())
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    #[test]
    fn desktop_window_size_api_updates_the_primary_window() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        world.spawn((
            Window {
                resolution: WindowResolution::new(600, 800),
                ..default()
            },
            PrimaryWindow,
        ));
        let cache = WorldGuard::setup_cache(&world, CurrentScriptAttachment::default());

        WorldGuard::with_static_guard(&mut world, cache, |_guard| {
            assert!(window_set_size(
                FunctionCallContext::new(Language::Unknown),
                960.0,
                540.0,
            )?);
            Ok::<(), InteropError>(())
        })?;

        let window = world
            .query_filtered::<&Window, With<PrimaryWindow>>()
            .single(&world)
            .expect("one primary window must exist");
        assert_eq!((window.width(), window.height()), (960.0, 540.0));
        Ok(())
    }

    #[cfg(feature = "lua")]
    fn install_settings_touch(world: &mut World) -> Result<(), InteropError> {
        world.init_resource::<Messages<TouchInput>>();
        world.init_resource::<Touches>();
        let window = world
            .spawn((
                Window {
                    resolution: WindowResolution::new(600, 800),
                    ..default()
                },
                PrimaryWindow,
            ))
            .id();
        world.write_message(TouchInput {
            phase: TouchPhase::Started,
            position: Vec2::new(190.0, 20.0),
            window,
            force: None,
            id: 1,
        });
        world
            .run_system_cached(touch_screen_input_system)
            .map_err(|error| InteropError::string(error.to_string()))?;
        Ok(())
    }

    #[cfg(any(feature = "js", feature = "typescript"))]
    fn install_settings_mouse(world: &mut World) {
        let mut window = Window {
            resolution: WindowResolution::new(600, 800),
            ..default()
        };
        window.set_cursor_position(Some(Vec2::new(190.0, 20.0)));
        world.spawn((window, PrimaryWindow));
        let mut buttons = ButtonInput::default();
        buttons.press(MouseButton::Left);
        world.insert_resource(buttons);
    }

    fn assert_loaded_settings_scene(world: &mut World) {
        let mut query = world.query::<(&ScriptEntityId, &Transform)>();
        let ids = query
            .iter(world)
            .map(|(id, _)| id.0.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            ids,
            [
                "background",
                "hud",
                "player",
                "settings_exit",
                "settings_icon",
                "settings_panel",
                "settings_restart",
                "settings_title",
            ]
            .into_iter()
            .collect()
        );
        assert_eq!(world.query::<&Sprite>().iter(world).count(), 4);
        assert_eq!(world.query::<&Text2d>().iter(world).count(), 4);
        assert_eq!(world.resource::<ScriptGameState>().lives, 3);
        assert_eq!(world.resource::<ScriptGameState>().message, "PAUSED");

        let mut query = world.query::<(&ScriptEntityId, &Transform, Option<&Sprite>)>();
        let (_, icon_transform, icon_sprite) = query
            .iter(world)
            .find(|(id, _, _)| id.0 == "settings_icon")
            .expect("settings icon must exist");
        assert_eq!(icon_transform.translation.x, 156.0);
        assert_eq!(
            icon_sprite.and_then(|sprite| sprite.custom_size),
            Some(Vec2::splat(64.0))
        );
        let (_, _, panel_sprite) = query
            .iter(world)
            .find(|(id, _, _)| id.0 == "settings_panel")
            .expect("settings panel must exist");
        let panel_size = panel_sprite
            .and_then(|sprite| sprite.custom_size)
            .expect("settings panel must have a responsive size");
        assert_eq!(panel_size.x, 376.0);
        assert!((panel_size.y - 273.454_56).abs() < 0.001);
    }

    #[cfg(any(feature = "js", feature = "typescript"))]
    #[test]
    fn quickjs_shooter_uses_bms_registry_and_real_components() -> Result<(), InteropError> {
        use bevy_mod_scripting::quickjs::{
            QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler,
        };

        let mut app = App::new();
        app.add_plugins((
            TaskPoolPlugin::default(),
            AssetPlugin::default(),
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            QuickJsScriptingPlugin::default(),
            RuneweaveScriptApiPlugin,
        ))
        .init_asset::<Image>();
        app.finish();
        install_settings_mouse(app.world_mut());
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            #[cfg(feature = "js")]
            let source = include_bytes!("../../projects/js/modules/shooter/game/assets/shooter.js")
                .as_slice();
            #[cfg(feature = "typescript")]
            let source = include_bytes!("../../projects/ts/modules/shooter/game/assets/shooter.js")
                .as_slice();
            let mut context = quickjs_context_load(&attachment, source, world_id)?;
            quickjs_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )?;
            assert!(window_set_size(
                FunctionCallContext::new(Language::Unknown),
                200.0,
                400.0,
            )?);
            quickjs_handler(
                vec![ScriptValue::Float(1.0 / 60.0)],
                &attachment,
                &CallbackLabel::from("on_update"),
                &mut context,
                world_id,
            )?;
            Ok::<(), InteropError>(())
        })?;
        assert_loaded_settings_scene(app.world_mut());
        Ok(())
    }

    #[cfg(feature = "lua")]
    #[test]
    fn lua_shooter_uses_bms_registry_and_real_components() -> Result<(), InteropError> {
        use bevy_mod_scripting::lua::{LuaScriptingPlugin, lua_context_load, lua_handler};

        let mut app = App::new();
        app.add_plugins((
            TaskPoolPlugin::default(),
            AssetPlugin::default(),
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            LuaScriptingPlugin::default(),
            RuneweaveScriptApiPlugin,
        ))
        .init_asset::<Image>();
        app.finish();
        install_settings_touch(app.world_mut())?;
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let mut context = lua_context_load(
                &attachment,
                include_bytes!("../../projects/lua/modules/shooter/game/assets/shooter.lua"),
                world_id,
            )?;
            lua_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )?;
            assert!(window_set_size(
                FunctionCallContext::new(Language::Unknown),
                200.0,
                400.0,
            )?);
            lua_handler(
                vec![ScriptValue::Float(1.0 / 60.0)],
                &attachment,
                &CallbackLabel::from("on_update"),
                &mut context,
                world_id,
            )?;
            Ok::<(), InteropError>(())
        })?;
        assert_loaded_settings_scene(app.world_mut());
        Ok(())
    }
}
