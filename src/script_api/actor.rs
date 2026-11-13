//! Reflected gameplay state on script-owned Bevy entities.

use bevy::prelude::*;
use bevy_mod_scripting::bindings::{
    FunctionCallContext, InteropError, ReflectReference, WorldExtensions,
};

use super::{ScriptEntityId, ScriptOwnedBy, current_script, find_owned_entity};

/// Optional gameplay data. Movement and collision rules remain in scripts.
#[derive(Component, Reflect, Clone, Debug, PartialEq)]
#[reflect(Component)]
pub(super) struct ScriptActor {
    pub kind: String,
    pub health: f32,
    pub speed: f32,
    pub radius: f32,
    pub power: f32,
    pub cooldown: f32,
    pub lifetime: f32,
    pub velocity_x: f32,
    pub velocity_z: f32,
}

pub(super) fn scene_actor_set(
    context: FunctionCallContext,
    id: String,
    kind: String,
    health: f32,
    speed: f32,
    radius: f32,
) -> Result<bool, InteropError> {
    if kind.is_empty()
        || kind.len() > 64
        || [health, speed, radius]
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        || radius == 0.0
    {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_owned_entity(world, &owner, &id) else {
            return false;
        };
        world.entity_mut(entity).insert(ScriptActor {
            kind,
            health,
            speed,
            radius,
            power: 0.0,
            cooldown: 0.0,
            lifetime: 0.0,
            velocity_x: 0.0,
            velocity_z: 0.0,
        });
        true
    })
}

pub(super) fn scene_actor(
    context: FunctionCallContext,
    id: String,
) -> Result<Option<ReflectReference>, InteropError> {
    let (world, owner) = current_script(&context)?;
    let entity = world.with_world_mut(|world| {
        find_owned_entity(world, &owner, &id)
            .filter(|entity| world.get::<ScriptActor>(*entity).is_some())
    })?;
    entity
        .map(|entity| ReflectReference::new_component_ref::<ScriptActor>(entity, world))
        .transpose()
}

pub(super) fn scene_actor_ids(context: FunctionCallContext) -> Result<Vec<String>, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let mut query =
            world.query_filtered::<(&ScriptOwnedBy, &ScriptEntityId), With<ScriptActor>>();
        let mut ids = query
            .iter(world)
            .filter(|(candidate, _)| candidate.0 == owner)
            .map(|(_, id)| id.0.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::script_api::RuneweaveScriptApiPlugin;
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{CoreScriptGlobalsPlugin, CurrentScriptAttachment, WorldGuard},
        core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
        script::ScriptAttachment,
    };

    fn app() -> App {
        let mut app = App::new();
        app.add_plugins((
            bevy::app::TaskPoolPlugin::default(),
            bevy::asset::AssetPlugin::default(),
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            RuneweaveScriptApiPlugin,
        ));
        app
    }

    #[test]
    fn actor_state_is_reflected_and_queries_exclude_unowned_entities() -> Result<(), InteropError> {
        let mut app = app();
        let foreign_owner = app.world_mut().spawn_empty().id();
        app.world_mut().spawn((
            ScriptOwnedBy(ScriptAttachment::EntityScript(
                foreign_owner,
                Handle::default(),
            )),
            ScriptEntityId("foreign".into()),
            ScriptActor {
                kind: "foreign".into(),
                health: 1.0,
                speed: 0.0,
                radius: 1.0,
                power: 0.0,
                cooldown: 0.0,
                lifetime: 0.0,
                velocity_x: 0.0,
                velocity_z: 0.0,
            },
        ));
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(app.world(), CurrentScriptAttachment(Some(attachment)));
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            assert!(!scene_actor_set(
                context.clone(),
                "missing".into(),
                "enemy".into(),
                2.0,
                1.0,
                0.5
            )?);
            super::super::scene_spawn(context.clone(), "enemy".into(), 0.0, 0.0, 0.0)?;
            assert!(!scene_actor_set(
                context.clone(),
                "enemy".into(),
                "enemy".into(),
                f32::NAN,
                1.0,
                0.5
            )?);
            assert!(scene_actor_set(
                context.clone(),
                "enemy".into(),
                "enemy".into(),
                2.0,
                1.0,
                0.5
            )?);
            assert_eq!(scene_actor_ids(context.clone())?, vec!["enemy"]);
            assert!(scene_actor(context.clone(), "foreign".into())?.is_none());
            assert!(!scene_actor_set(
                context.clone(),
                "foreign".into(),
                "enemy".into(),
                5.0,
                1.0,
                0.5
            )?);
            assert!(scene_actor(context.clone(), "enemy".into())?.is_some());
            super::super::scene_despawn(context.clone(), "enemy".into())?;
            assert!(scene_actor_ids(context.clone())?.is_empty());
            assert!(scene_actor(context, "enemy".into())?.is_none());
            Ok(())
        })
    }

    #[cfg(any(feature = "js", feature = "typescript"))]
    #[test]
    fn quickjs_actor_reference_mutates_the_real_component() -> Result<(), InteropError> {
        use bevy_mod_scripting::quickjs::{
            QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler,
        };
        let mut app = app();
        app.add_plugins(QuickJsScriptingPlugin::default());
        app.finish();
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let mut context = quickjs_context_load(
                &attachment,
                br#"
                function on_script_loaded() {
                    scene_spawn("actor", 1, 0, 2);
                    if (!scene_actor_set("actor", "player", 100, 4, 0.4)) throw Error("actor set");
                    const actor = scene_actor("actor");
                    actor.set("health", 73);
                    const position = scene_transform("actor").get("translation");
                    position.set("x", 6);
                    if (scene_actor_ids()[0] !== "actor") throw Error("actor query");
                }
            "#,
                world_id,
            )?;
            quickjs_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )
        })?;
        let (actor, transform) = app
            .world_mut()
            .query::<(&ScriptActor, &Transform)>()
            .single(app.world())
            .unwrap();
        assert_eq!(actor.health, 73.0);
        assert_eq!(transform.translation.x, 6.0);
        Ok(())
    }

    #[cfg(any(feature = "js", feature = "typescript"))]
    #[test]
    fn quickjs_arena_runs_with_real_actor_components_and_ui() -> Result<(), InteropError> {
        use super::super::{ScriptGameState, ui::ScriptUiNode};
        use bevy::asset::AssetApp;
        use bevy::window::{PrimaryWindow, WindowResolution};
        use bevy_mod_scripting::quickjs::{
            QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler,
        };

        let save_root = tempfile::tempdir().unwrap();
        let mut app = App::new();
        app.add_plugins((
            bevy::app::TaskPoolPlugin::default(),
            bevy::asset::AssetPlugin {
                file_path: format!(
                    "{}/projects/ember-arena/modules/ember-arena/game/assets",
                    env!("CARGO_MANIFEST_DIR")
                ),
                ..default()
            },
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            QuickJsScriptingPlugin::default(),
            RuneweaveScriptApiPlugin,
        ))
        .init_asset::<Image>()
        .init_asset::<Font>()
        .init_asset::<bevy::world_serialization::WorldAsset>()
        .init_asset::<AnimationClip>()
        .init_asset::<AnimationGraph>();
        app.insert_resource(super::super::storage::ScriptStorage::for_test(
            save_root.path(),
            "arena",
        ));
        app.world_mut().spawn((
            Window {
                resolution: WindowResolution::new(1280, 800),
                ..default()
            },
            PrimaryWindow,
        ));
        app.world_mut()
            .spawn((Camera3d::default(), Camera::default()));
        app.world_mut().spawn((
            Camera2d,
            Projection::Orthographic(OrthographicProjection::default_2d()),
            Transform::default(),
        ));
        app.world_mut().init_resource::<ButtonInput<KeyCode>>();
        app.world_mut().init_resource::<ButtonInput<MouseButton>>();
        app.finish();
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |guard| {
            let mut context = quickjs_context_load(
                &attachment,
                include_bytes!(
                    "../../projects/ember-arena/modules/ember-arena/game/assets/ember-arena.js"
                ),
                world_id,
            )?;
            let call = |name: &str, context: &mut _| {
                quickjs_handler(
                    if name == "on_update" {
                        vec![bevy_mod_scripting::bindings::ScriptValue::Float(0.05)]
                    } else {
                        Vec::new()
                    },
                    &attachment,
                    &CallbackLabel::from(name),
                    context,
                    world_id,
                )
            };
            let click = |id: &str| -> Result<(), InteropError> {
                guard.with_world_mut(|world| {
                    let entity = super::super::find_owned_entity(world, &attachment, id)
                        .expect("button exists");
                    world.entity_mut(entity).insert(Interaction::Pressed);
                })
            };
            call("on_script_loaded", &mut context)?;
            click("start")?;
            call("on_update", &mut context)?;
            click("begin_run")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                for (id, kind) in [
                    ("buff_hunger:player", "buff_hunger"),
                    ("buff_regeneration:player", "buff_regeneration"),
                ] {
                    let entity = super::super::find_owned_entity(world, &attachment, id).unwrap();
                    let actor = world.get::<ScriptActor>(entity).unwrap();
                    assert_eq!(actor.kind, kind);
                    assert_eq!(actor.health, 0.0);
                    assert_eq!(actor.power, 0.0);
                    assert_eq!(actor.cooldown, 0.0);
                }
                world
                    .resource_mut::<ButtonInput<KeyCode>>()
                    .press(KeyCode::KeyD);
            })?;
            for _ in 0..10 {
                call("on_update", &mut context)?;
            }
            guard.with_world_mut(|world| {
                let entity = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                assert!(world.get::<Transform>(entity).unwrap().translation.x > 0.0);
                assert_eq!(world.resource::<ScriptGameState>().message, "PLAYING");
                let hunger =
                    super::super::find_owned_entity(world, &attachment, "buff_hunger:player")
                        .unwrap();
                let hunger = world.get::<ScriptActor>(hunger).unwrap();
                assert!(hunger.health > 0.0);
                assert_eq!(
                    hunger.health,
                    world.get::<ScriptActor>(entity).unwrap().cooldown
                );
                assert_eq!(hunger.cooldown, hunger.health);
                world.resource_mut::<ButtonInput<KeyCode>>().reset_all();
            })?;
            click("pause")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                world
                    .resource_mut::<ButtonInput<KeyCode>>()
                    .press(KeyCode::F12)
            })?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| world.resource_mut::<ButtonInput<KeyCode>>().clear())?;
            let mut lines = std::collections::HashSet::new();
            for _ in 0..2 {
                guard.with_world_mut(|world| {
                    let mut query = world.query_filtered::<&Text, With<ScriptUiNode>>();
                    lines.extend(query.iter(world).map(|text| text.0.clone()));
                })?;
                click("check_page")?;
                call("on_update", &mut context)?;
            }
            {
                assert_eq!(
                    lines.iter().filter(|line| line.starts_with("PASS")).count(),
                    8,
                    "{lines:?}"
                );
                assert!(
                    !lines.iter().any(|line| line.starts_with("FAIL")),
                    "{lines:?}"
                );
            }
            click("back")?;
            call("on_update", &mut context)?;
            click("pause_window_outside")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let mut query = world.query_filtered::<&mut Window, With<PrimaryWindow>>();
                query
                    .single_mut(world)
                    .unwrap()
                    .resolution
                    .set(800.0, 400.0);
            })?;
            call("on_update", &mut context)?;
            click("bag_btn")?;
            call("on_update", &mut context)?;
            click("slot_food_ration")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                assert_eq!(world.resource::<ScriptGameState>().message, "ITEM");
                let label =
                    super::super::find_owned_entity(world, &attachment, "item_detail_title")
                        .unwrap();
                let expected = if super::super::app_locale()
                    .to_ascii_lowercase()
                    .starts_with("zh")
                {
                    "口粮"
                } else {
                    "Food Ration"
                };
                assert_eq!(world.get::<Text>(label).unwrap().0, expected);
                assert_eq!(
                    world.get::<TextFont>(label).unwrap().font_smoothing,
                    bevy::text::FontSmoothing::None
                );
                assert!(
                    super::super::find_owned_entity(world, &attachment, "use_food_ration")
                        .is_some()
                );
                let hunger =
                    super::super::find_owned_entity(world, &attachment, "buff_hunger:player")
                        .unwrap();
                world.get_mut::<ScriptActor>(hunger).unwrap().health = 300.0;
            })?;
            click("use_food_ration")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let hunger =
                    super::super::find_owned_entity(world, &attachment, "buff_hunger:player")
                        .unwrap();
                assert_eq!(world.get::<ScriptActor>(hunger).unwrap().health, 3.0);
                assert_eq!(world.resource::<ScriptGameState>().message, "PLAYING");
            })?;
            call("on_script_reloaded", &mut context)?;
            guard.with_world_mut(|world| {
                assert_eq!(world.query::<&ScriptActor>().iter(world).count(), 1);
                assert_eq!(world.resource::<ScriptGameState>().message, "MENU");
                assert_eq!(
                    world
                        .query_filtered::<&Node, (With<ScriptUiNode>, Without<ChildOf>)>()
                        .iter(world)
                        .count(),
                    1
                );
            })?;
            click("start")?;
            call("on_update", &mut context)?;
            click("hero_huntress")?;
            call("on_update", &mut context)?;
            click("begin_run")?;
            call("on_update", &mut context)?;
            let target = guard.with_world_mut(|world| {
                let enemies: Vec<_> = world
                    .query::<(Entity, &ScriptActor)>()
                    .iter(world)
                    .filter(|(_, actor)| actor.kind == "chaser")
                    .map(|(entity, _)| entity)
                    .collect();
                let target = enemies[0];
                for &enemy in &enemies[1..] {
                    world.despawn(enemy);
                }
                world.get_mut::<Transform>(target).unwrap().translation =
                    Vec3::new(16.0, -40.0, 2.0);
                let mut actor = world.get_mut::<ScriptActor>(target).unwrap();
                actor.health = 1000.0;
                actor.cooldown = 1000.0;
                target
            })?;
            for shot in 1..=4 {
                click("quick_spirit_bow")?;
                call("on_update", &mut context)?;
                guard.with_world_mut(|world| {
                    assert!(
                        super::super::find_owned_entity(world, &attachment, "target_prompt")
                            .is_some()
                    );
                    let mut query = world.query_filtered::<&mut Window, With<PrimaryWindow>>();
                    // At 800x400 with UI zoom 2, tile (13,12) is (432,220).
                    query
                        .single_mut(world)
                        .unwrap()
                        .set_cursor_position(Some(Vec2::new(432.0, 220.0)));
                    world
                        .resource_mut::<ButtonInput<MouseButton>>()
                        .press(MouseButton::Left);
                })?;
                call("on_update", &mut context)?;
                guard.with_world_mut(|world| {
                    let player =
                        super::super::find_owned_entity(world, &attachment, "player").unwrap();
                    assert_eq!(
                        world.get::<ScriptActor>(player).unwrap().cooldown,
                        shot as f32
                    );
                    assert_eq!(world.get::<Transform>(player).unwrap().translation.x, 0.0);
                    world.resource_mut::<ButtonInput<MouseButton>>().reset_all();
                })?;
                call("on_update", &mut context)?;
            }
            guard.with_world_mut(|world| {
                let health = world.get::<ScriptActor>(target).unwrap().health;
                assert!(health < 1000.0 && health >= 976.0);
            })?;
            click("bag_btn")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                assert!(
                    super::super::find_owned_entity(world, &attachment, "slot_spirit_bow")
                        .is_some()
                );
                assert!(
                    super::super::find_owned_entity(world, &attachment, "gear_icon_1").is_some()
                );
            })?;
            call("on_script_reloaded", &mut context)?;
            click("start")?;
            call("on_update", &mut context)?;
            click("hero_mage")?;
            call("on_update", &mut context)?;
            click("begin_run")?;
            call("on_update", &mut context)?;
            let (target, charger) = guard.with_world_mut(|world| {
                let target = world
                    .query::<(Entity, &ScriptActor)>()
                    .iter(world)
                    .find(|(_, actor)| actor.kind == "chaser")
                    .unwrap()
                    .0;
                world.get_mut::<Transform>(target).unwrap().translation =
                    Vec3::new(16.0, -40.0, 2.0);
                let mut actor = world.get_mut::<ScriptActor>(target).unwrap();
                actor.health = 1000.0;
                actor.cooldown = 1000.0;
                let charger =
                    super::super::find_owned_entity(world, &attachment, "staff_charge:1").unwrap();
                assert_eq!(world.get::<ScriptActor>(charger).unwrap().health, 4.0);
                (target, charger)
            })?;
            click("quick_staff_1")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let mut query = world.query_filtered::<&mut Window, With<PrimaryWindow>>();
                query
                    .single_mut(world)
                    .unwrap()
                    .set_cursor_position(Some(Vec2::new(432.0, 220.0)));
                world
                    .resource_mut::<ButtonInput<MouseButton>>()
                    .press(MouseButton::Left);
            })?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let health = world.get::<ScriptActor>(target).unwrap().health;
                assert!((992.0..=998.0).contains(&health));
                let charger = world.get::<ScriptActor>(charger).unwrap();
                assert_eq!(charger.health, 3.0);
                assert_eq!(charger.power, 0.025);
                assert_eq!(charger.cooldown, 1.0);
                let player = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                assert_eq!(world.get::<ScriptActor>(player).unwrap().cooldown, 1.0);
                world.resource_mut::<ButtonInput<MouseButton>>().reset_all();
            })?;
            call("on_script_reloaded", &mut context)?;
            click("start")?;
            call("on_update", &mut context)?;
            click("hero_rogue")?;
            call("on_update", &mut context)?;
            click("begin_run")?;
            call("on_update", &mut context)?;
            click("quick_cloak_of_shadows")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let cloak =
                    super::super::find_owned_entity(world, &attachment, "artifact_cloak").unwrap();
                let cloak = world.get::<ScriptActor>(cloak).unwrap();
                assert_eq!(cloak.health, 2.0);
                assert_eq!(cloak.speed, 10.0);
                assert_eq!(cloak.velocity_x, 1.0);
                assert_eq!(cloak.cooldown, 1.0);
                let active =
                    super::super::find_owned_entity(world, &attachment, "buff_cloak:player")
                        .unwrap();
                let active = world.get::<ScriptActor>(active).unwrap();
                assert_eq!(active.health, 4.0);
                assert_eq!(active.cooldown, 1.0);
                assert!(
                    super::super::find_owned_entity(world, &attachment, "hud_invisible").is_some()
                );
            })?;
            click("quick_cloak_of_shadows")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                assert!(
                    super::super::find_owned_entity(world, &attachment, "buff_cloak:player")
                        .is_none()
                );
                assert!(
                    super::super::find_owned_entity(world, &attachment, "hud_invisible").is_none()
                );
                let player = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                assert_eq!(world.get::<ScriptActor>(player).unwrap().cooldown, 1.0);
            })?;
            call("on_script_reloaded", &mut context)?;
            click("start")?;
            call("on_update", &mut context)?;
            click("hero_warrior")?;
            call("on_update", &mut context)?;
            click("begin_run")?;
            call("on_update", &mut context)?;
            let shield = guard.with_world_mut(|world| {
                let seal =
                    super::super::find_owned_entity(world, &attachment, "item_seal").unwrap();
                assert_eq!(world.get::<ScriptActor>(seal).unwrap().power, 2.0);
                let shield = super::super::find_owned_entity(
                    world,
                    &attachment,
                    "buff_warrior_shield:player",
                )
                .unwrap();
                assert_eq!(world.get::<ScriptActor>(shield).unwrap().health, 0.0);
                let player = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                world.get_mut::<ScriptActor>(player).unwrap().health = 10.0;
                let transform = *world.get::<Transform>(player).unwrap();
                let enemies: Vec<_> = world
                    .query::<(Entity, &ScriptActor)>()
                    .iter(world)
                    .filter(|(_, actor)| actor.kind == "chaser")
                    .map(|(entity, _)| entity)
                    .collect();
                let burning = enemies[0];
                for &enemy in &enemies[1..] {
                    world.despawn(enemy);
                }
                world.get_mut::<ScriptEntityId>(burning).unwrap().0 = "buff_burning:player".into();
                *world.get_mut::<Transform>(burning).unwrap() = transform;
                let mut actor = world.get_mut::<ScriptActor>(burning).unwrap();
                actor.kind = "buff_burning".into();
                actor.health = 1.0;
                actor.power = 1.0;
                actor.speed = 0.0;
                actor.lifetime = 0.0;
                actor.cooldown = 0.0;
                shield
            })?;
            click("wait")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let actor = world.get::<ScriptActor>(shield).unwrap();
                assert_eq!(actor.health, 4.0);
                assert_eq!(actor.power, 149.0);
                assert_eq!(actor.speed, 1.0);
                assert_eq!(actor.lifetime, 5.0);
                assert_eq!(actor.cooldown, 1.0);
                let player = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                assert_eq!(world.get::<ScriptActor>(player).unwrap().health, 10.0);
                assert!(
                    super::super::find_owned_entity(world, &attachment, "hud_shield").is_some()
                );
            })?;
            click("bag_btn")?;
            call("on_update", &mut context)?;
            click("gear_slot_2")?;
            call("on_update", &mut context)?;
            click("detach_seal")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let seal =
                    super::super::find_owned_entity(world, &attachment, "item_seal").unwrap();
                assert_eq!(world.get::<ScriptActor>(seal).unwrap().power, 0.0);
                assert_eq!(world.get::<ScriptActor>(shield).unwrap().power, 149.0);
            })?;
            click("equipment_window_outside")?;
            call("on_update", &mut context)?;
            click("slot_broken_seal")?;
            call("on_update", &mut context)?;
            click("use_broken_seal")?;
            call("on_update", &mut context)?;
            click("affix_2")?;
            call("on_update", &mut context)?;
            guard.with_world_mut(|world| {
                let seal =
                    super::super::find_owned_entity(world, &attachment, "item_seal").unwrap();
                assert_eq!(world.get::<ScriptActor>(seal).unwrap().power, 2.0);
                assert_eq!(world.get::<ScriptActor>(shield).unwrap().health, 4.0);
                assert_eq!(world.get::<ScriptActor>(shield).unwrap().power, 149.0);
                let player = super::super::find_owned_entity(world, &attachment, "player").unwrap();
                assert_eq!(world.get::<ScriptActor>(player).unwrap().cooldown, 1.0);
            })?;
            Ok(())
        })
    }

    #[cfg(feature = "lua")]
    #[test]
    fn lua_actor_reference_mutates_the_real_component() -> Result<(), InteropError> {
        use bevy_mod_scripting::lua::{LuaScriptingPlugin, lua_context_load, lua_handler};
        let mut app = app();
        app.add_plugins(LuaScriptingPlugin::default());
        app.finish();
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let mut context = lua_context_load(
                &attachment,
                br#"
                function on_script_loaded()
                    scene_spawn("actor", 1, 0, 2)
                    assert(scene_actor_set("actor", "player", 100, 4, 0.4))
                    local actor = scene_actor("actor")
                    actor.health = 73
                    local transform = scene_transform("actor")
                    transform.translation.x = 6
                    assert(scene_actor_ids()[1] == "actor")
                end
            "#,
                world_id,
            )?;
            lua_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )
        })?;
        let (actor, transform) = app
            .world_mut()
            .query::<(&ScriptActor, &Transform)>()
            .single(app.world())
            .unwrap();
        assert_eq!(actor.health, 73.0);
        assert_eq!(transform.translation.x, 6.0);
        Ok(())
    }
}
