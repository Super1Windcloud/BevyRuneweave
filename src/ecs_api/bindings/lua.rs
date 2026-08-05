use bevy_mod_scripting::{
    bindings::InteropError,
    core::ConfigureScriptPlugin,
    lua::{LuaContext, LuaScriptingPlugin},
    script::ScriptAttachment,
};

use super::super::command::{EcsCommand, queue_command};

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn install_ecs_api(
    _attachment: &ScriptAttachment,
    context: &mut LuaContext,
) -> Result<(), InteropError> {
    let globals = context.globals();
    globals
        .set(
            "ecs_clear_world",
            context
                .create_function(|_, ()| {
                    queue_command(EcsCommand::ClearWorld);
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "ecs_spawn_entity",
            context
                .create_function(|_, id: String| {
                    queue_command(EcsCommand::SpawnEntity { id });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "ecs_insert_sprite",
            context
                .create_function(|_, (id, kind): (String, String)| {
                    queue_command(EcsCommand::InsertSprite { id, kind });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "ecs_set_transform",
            context
                .create_function(|_, (id, x, y): (String, f32, f32)| {
                    queue_command(EcsCommand::SetTransform { id, x, y });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "ecs_despawn_entity",
            context
                .create_function(|_, id: String| {
                    queue_command(EcsCommand::DespawnEntity { id });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "ecs_set_game_state",
            context
                .create_function(|_, (score, lives, message): (f64, i32, String)| {
                    queue_command(EcsCommand::SetGameState {
                        score,
                        lives,
                        message,
                    });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)
}

pub(super) fn ecs_lua_plugin() -> LuaScriptingPlugin {
    LuaScriptingPlugin::default().add_context_initializer(install_ecs_api)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicI32, AtomicUsize, Ordering},
    };

    use bevy_mod_scripting::lua::mlua::Lua;

    #[test]
    fn shooter_script_runs_gameplay_frames() {
        let context = Lua::new();
        let globals = context.globals();
        let bullet_count = Arc::new(AtomicUsize::new(0));
        let remaining_lives = Arc::new(AtomicI32::new(3));
        globals
            .set(
                "ecs_clear_world",
                context.create_function(|_, ()| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_spawn_entity",
                context.create_function(|_, _: String| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_insert_sprite",
                context
                    .create_function({
                        let bullet_count = Arc::clone(&bullet_count);
                        move |_, (_, kind): (String, String)| {
                            if kind == "bullet" {
                                bullet_count.fetch_add(1, Ordering::Relaxed);
                            }
                            Ok(())
                        }
                    })
                    .unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_set_transform",
                context
                    .create_function(|_, _: (String, f32, f32)| Ok(()))
                    .unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_despawn_entity",
                context.create_function(|_, _: String| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_set_game_state",
                context
                    .create_function({
                        let remaining_lives = Arc::clone(&remaining_lives);
                        move |_, (_, lives, _): (f64, i32, String)| {
                            remaining_lives.store(lives, Ordering::Relaxed);
                            Ok(())
                        }
                    })
                    .unwrap(),
            )
            .unwrap();
        #[cfg(feature = "lua")]
        let source = include_str!("../../../projects/lua/assets/shooter.lua");
        #[cfg(feature = "luau")]
        let source = include_str!("../../../projects/luau/assets/shooter.luau");

        context.load(source).exec().unwrap();
        let loaded: bevy_mod_scripting::lua::mlua::Function =
            globals.get("on_script_loaded").unwrap();
        loaded.call::<()>(()).unwrap();
        let update: bevy_mod_scripting::lua::mlua::Function = globals.get("on_update").unwrap();
        for _ in 0..600 {
            update
                .call::<()>((0.016_f64, 0.25_f64, 0.0_f64, false))
                .unwrap();
        }
        assert!(bullet_count.load(Ordering::Relaxed) > 0);
        assert!(remaining_lives.load(Ordering::Relaxed) > 0);
    }
}
