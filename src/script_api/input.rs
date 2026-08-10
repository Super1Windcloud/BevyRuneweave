use bevy::prelude::{ButtonInput, KeyCode};
use bevy_mod_scripting::bindings::{FunctionCallContext, InteropError, WorldExtensions};

enum InputKind {
    Pressed,
    JustPressed,
    JustReleased,
}

fn input_matches(
    context: FunctionCallContext,
    key: String,
    kind: InputKind,
) -> Result<bool, InteropError> {
    context.world()?.with_world(|world| {
        let Some(input) = world.get_resource::<ButtonInput<KeyCode>>() else {
            return false;
        };
        match kind {
            InputKind::Pressed => input
                .get_pressed()
                .any(|candidate| format!("{candidate:?}") == key),
            InputKind::JustPressed => input
                .get_just_pressed()
                .any(|candidate| format!("{candidate:?}") == key),
            InputKind::JustReleased => input
                .get_just_released()
                .any(|candidate| format!("{candidate:?}") == key),
        }
    })
}

pub(super) fn input_key_pressed(
    context: FunctionCallContext,
    key: String,
) -> Result<bool, InteropError> {
    input_matches(context, key, InputKind::Pressed)
}

pub(super) fn input_key_just_pressed(
    context: FunctionCallContext,
    key: String,
) -> Result<bool, InteropError> {
    input_matches(context, key, InputKind::JustPressed)
}

pub(super) fn input_key_just_released(
    context: FunctionCallContext,
    key: String,
) -> Result<bool, InteropError> {
    input_matches(context, key, InputKind::JustReleased)
}

#[cfg(test)]
mod tests {
    use bevy::{ecs::reflect::AppTypeRegistry, prelude::World};
    use bevy_mod_scripting::{
        asset::Language,
        bindings::{AppScriptFunctionRegistry, CurrentScriptAttachment, WorldGuard},
    };

    use super::*;

    #[test]
    fn reads_the_live_bevy_input_resource() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        let mut input = ButtonInput::default();
        input.press(KeyCode::ArrowLeft);
        world.insert_resource(input);
        let cache = WorldGuard::setup_cache(&world, CurrentScriptAttachment::default());

        WorldGuard::with_static_guard(&mut world, cache, |_guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            assert!(input_key_pressed(context.clone(), "ArrowLeft".to_owned())?);
            assert!(input_key_just_pressed(context, "ArrowLeft".to_owned())?);
            Ok(())
        })
    }
}
