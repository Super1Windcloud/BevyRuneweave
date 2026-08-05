use bevy_mod_scripting::{
    bindings::InteropError,
    core::ConfigureScriptPlugin,
    quickjs::{QuickJsContext, QuickJsScriptingPlugin, rquickjs::function::Func},
    script::ScriptAttachment,
};

use super::super::command::{EcsCommand, queue_command};

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn install_ecs_api(
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    context.with(|ctx| {
        let globals = ctx.globals();
        globals
            .set(
                "ecs_clear_world",
                Func::from(|| queue_command(EcsCommand::ClearWorld)),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "ecs_spawn_entity",
                Func::from(|id: String| queue_command(EcsCommand::SpawnEntity { id })),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "ecs_insert_sprite",
                Func::from(|id: String, kind: String| {
                    queue_command(EcsCommand::InsertSprite { id, kind });
                }),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "ecs_set_transform",
                Func::from(|id: String, x: f32, y: f32| {
                    queue_command(EcsCommand::SetTransform { id, x, y });
                }),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "ecs_despawn_entity",
                Func::from(|id: String| queue_command(EcsCommand::DespawnEntity { id })),
            )
            .map_err(interop_error)?;
        globals
            .set(
                "ecs_set_game_state",
                Func::from(|score: i32, lives: i32, message: String| {
                    queue_command(EcsCommand::SetGameState {
                        score,
                        lives,
                        message,
                    });
                }),
            )
            .map_err(interop_error)
    })
}

pub(super) fn ecs_quickjs_plugin() -> QuickJsScriptingPlugin {
    QuickJsScriptingPlugin::default().add_context_initializer(install_ecs_api)
}

#[cfg(test)]
mod tests {
    use bevy_mod_scripting::quickjs::rquickjs::{Context, Function, Runtime};

    use super::*;

    fn assert_shooter_runs(source: &str) {
        let runtime = Runtime::new().unwrap();
        let context = Context::full(&runtime).unwrap();
        context.with(|ctx| {
            let globals = ctx.globals();
            globals.set("ecs_clear_world", Func::from(|| {})).unwrap();
            globals
                .set("ecs_spawn_entity", Func::from(|_: String| {}))
                .unwrap();
            globals
                .set("ecs_insert_sprite", Func::from(|_: String, _: String| {}))
                .unwrap();
            globals
                .set(
                    "ecs_set_transform",
                    Func::from(|_: String, _: f32, _: f32| {}),
                )
                .unwrap();
            globals
                .set("ecs_despawn_entity", Func::from(|_: String| {}))
                .unwrap();
            globals
                .set(
                    "ecs_set_game_state",
                    Func::from(|_: i32, _: i32, _: String| {}),
                )
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
        assert_shooter_runs(include_str!("../../../projects/js/assets/shooter.js"));
    }

    #[test]
    fn compiled_typescript_shooter_runs_gameplay_frames() {
        assert_shooter_runs(include_str!("../../../projects/ts/assets/shooter.js"));
    }
}
