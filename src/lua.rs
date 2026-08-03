use bevy_mod_scripting::{
    bindings::InteropError,
    core::ConfigureScriptPlugin,
    lua::{LuaContext, LuaScriptingPlugin},
    script::ScriptAttachment,
};

use crate::{ScriptCommand, queue_command};

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn install_game_api(
    _attachment: &ScriptAttachment,
    context: &mut LuaContext,
) -> Result<(), InteropError> {
    let globals = context.globals();
    globals
        .set(
            "clear_game",
            context
                .create_function(|_, ()| {
                    queue_command(ScriptCommand::Clear);
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "spawn_sprite",
            context
                .create_function(|_, (kind, id, x, y): (String, String, f32, f32)| {
                    queue_command(ScriptCommand::Spawn { kind, id, x, y });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "set_position",
            context
                .create_function(|_, (id, x, y): (String, f32, f32)| {
                    queue_command(ScriptCommand::SetPosition { id, x, y });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "despawn_sprite",
            context
                .create_function(|_, id: String| {
                    queue_command(ScriptCommand::Despawn { id });
                    Ok(())
                })
                .map_err(interop_error)?,
        )
        .map_err(interop_error)?;
    globals
        .set(
            "set_hud",
            context
                .create_function(|_, (score, lives, message): (i32, i32, String)| {
                    queue_command(ScriptCommand::SetHud {
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

pub(crate) fn game_lua_plugin() -> LuaScriptingPlugin {
    LuaScriptingPlugin::default().add_context_initializer(install_game_api)
}

#[cfg(test)]
mod tests {
    use bevy_mod_scripting::lua::mlua::Lua;

    #[test]
    fn shooter_script_runs_gameplay_frames() {
        let context = Lua::new();
        let globals = context.globals();
        globals
            .set(
                "clear_game",
                context.create_function(|_, ()| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "spawn_sprite",
                context
                    .create_function(|_, _: (String, String, f32, f32)| Ok(()))
                    .unwrap(),
            )
            .unwrap();
        globals
            .set(
                "set_position",
                context
                    .create_function(|_, _: (String, f32, f32)| Ok(()))
                    .unwrap(),
            )
            .unwrap();
        globals
            .set(
                "despawn_sprite",
                context.create_function(|_, _: String| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "set_hud",
                context
                    .create_function(|_, _: (i32, i32, String)| Ok(()))
                    .unwrap(),
            )
            .unwrap();
        #[cfg(feature = "lua")]
        let source = include_str!("../projects/lua/assets/shooter.lua");
        #[cfg(feature = "luau")]
        let source = include_str!("../projects/luau/assets/shooter.luau");

        context.load(source).exec().unwrap();
        let loaded: bevy_mod_scripting::lua::mlua::Function =
            globals.get("on_script_loaded").unwrap();
        loaded.call::<()>(()).unwrap();
        let update: bevy_mod_scripting::lua::mlua::Function = globals.get("on_update").unwrap();
        for frame in 0..600 {
            update
                .call::<()>((0.016_f64, 0.25_f64, 0.0_f64, frame % 3 != 0))
                .unwrap();
        }
    }
}
