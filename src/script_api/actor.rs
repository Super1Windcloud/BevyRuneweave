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
