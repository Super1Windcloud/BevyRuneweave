use bevy_mod_scripting::{
    bindings::InteropError, core::ConfigureScriptPlugin, script::ScriptAttachment,
};
use bevy_mod_scripting_quickjs::{QuickJsContext, QuickJsScriptingPlugin};
use rquickjs::function::Func;

use crate::{ScriptCommand, queue_command};

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn install_game_api(
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    context.with(|ctx| {
        let globals = ctx.globals();
        globals
            .set(
                "clear_game",
                Func::from(|| queue_command(ScriptCommand::Clear)),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "spawn_sprite",
                Func::from(|kind: String, id: String, x: f32, y: f32| {
                    queue_command(ScriptCommand::Spawn { kind, id, x, y });
                }),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "set_position",
                Func::from(|id: String, x: f32, y: f32| {
                    queue_command(ScriptCommand::SetPosition { id, x, y });
                }),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "despawn_sprite",
                Func::from(|id: String| queue_command(ScriptCommand::Despawn { id })),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "set_hud",
                Func::from(|score: i32, lives: i32, message: String| {
                    queue_command(ScriptCommand::SetHud {
                        score,
                        lives,
                        message,
                    });
                }),
            )
            .map_err(interop_error)
    })
}

pub(crate) fn game_quickjs_plugin() -> QuickJsScriptingPlugin {
    QuickJsScriptingPlugin::default().add_context_initializer(install_game_api)
}

#[cfg(test)]
mod tests {
    use rquickjs::{Context, Function, Runtime};

    use super::*;

    fn assert_shooter_runs(source: &str) {
        let runtime = Runtime::new().unwrap();
        let context = Context::full(&runtime).unwrap();
        context.with(|ctx| {
            let globals = ctx.globals();
            globals.set("clear_game", Func::from(|| {})).unwrap();
            globals
                .set(
                    "spawn_sprite",
                    Func::from(|_: String, _: String, _: f32, _: f32| {}),
                )
                .unwrap();
            globals
                .set("set_position", Func::from(|_: String, _: f32, _: f32| {}))
                .unwrap();
            globals
                .set("despawn_sprite", Func::from(|_: String| {}))
                .unwrap();
            globals
                .set("set_hud", Func::from(|_: i32, _: i32, _: String| {}))
                .unwrap();
            ctx.eval::<(), _>(source).unwrap();
            let loaded: Function = globals.get("on_script_loaded").unwrap();
            loaded.call::<_, ()>(()).unwrap();
            let update: Function = globals.get("on_update").unwrap();
            for frame in 0..600 {
                update
                    .call::<_, ()>((0.016_f64, 0.25_f64, 0.0_f64, frame % 3 != 0))
                    .unwrap();
            }
        });
    }

    #[test]
    fn javascript_shooter_runs_gameplay_frames() {
        assert_shooter_runs(include_str!("../projects/js/assets/shooter.js"));
    }

    #[test]
    fn compiled_typescript_shooter_runs_gameplay_frames() {
        assert_shooter_runs(include_str!("../projects/ts/assets/shooter.js"));
    }
}
