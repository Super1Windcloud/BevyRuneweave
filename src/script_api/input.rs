use bevy::{
    prelude::{ButtonInput, KeyCode, Touches, Window},
    window::PrimaryWindow,
};
use bevy_mod_scripting::{
    bindings::{FunctionCallContext, InteropError, WorldExtensions},
    prelude::ScriptValue,
};

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

fn touch_state_value(
    pressed: bool,
    just_pressed: bool,
    position: bevy::math::Vec2,
    delta: bevy::math::Vec2,
) -> ScriptValue {
    let mut state = bevy::platform::collections::HashMap::default();
    state.insert("pressed".into(), ScriptValue::Bool(pressed));
    state.insert("justPressed".into(), ScriptValue::Bool(just_pressed));
    state.insert("x".into(), ScriptValue::Float(f64::from(position.x)));
    state.insert("y".into(), ScriptValue::Float(f64::from(position.y)));
    state.insert("deltaX".into(), ScriptValue::Float(f64::from(delta.x)));
    state.insert("deltaY".into(), ScriptValue::Float(f64::from(delta.y)));
    ScriptValue::Map(state)
}

pub(super) fn input_primary_touch(
    context: FunctionCallContext,
) -> Result<ScriptValue, InteropError> {
    context.world()?.with_world(|world| {
        let Some(touches) = world.get_resource::<Touches>() else {
            return touch_state_value(false, false, bevy::math::Vec2::ZERO, bevy::math::Vec2::ZERO);
        };
        let Some(window) = world.iter_entities().find_map(|entity| {
            entity.get::<PrimaryWindow>()?;
            entity.get::<Window>()
        }) else {
            return touch_state_value(false, false, bevy::math::Vec2::ZERO, bevy::math::Vec2::ZERO);
        };
        let Some(touch) = touches.iter().min_by_key(|touch| touch.id()) else {
            return touch_state_value(false, false, bevy::math::Vec2::ZERO, bevy::math::Vec2::ZERO);
        };
        let size = bevy::math::Vec2::new(window.width(), window.height());
        if size.x <= 0.0 || size.y <= 0.0 {
            return touch_state_value(false, false, bevy::math::Vec2::ZERO, bevy::math::Vec2::ZERO);
        }
        let position = bevy::math::Vec2::new(
            (touch.position().x / size.x).clamp(0.0, 1.0),
            (1.0 - touch.position().y / size.y).clamp(0.0, 1.0),
        );
        let delta = bevy::math::Vec2::new(touch.delta().x / size.x, -touch.delta().y / size.y);
        touch_state_value(true, touches.just_pressed(touch.id()), position, delta)
    })
}

#[cfg(test)]
mod tests {
    use bevy::{
        ecs::reflect::AppTypeRegistry,
        input::touch::{TouchInput, TouchPhase, touch_screen_input_system},
        prelude::{App, Update, Vec2, World},
        window::WindowResolution,
    };
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

    #[test]
    fn returns_normalized_primary_touch_from_the_live_world() -> Result<(), InteropError> {
        let mut app = App::new();
        app.add_message::<TouchInput>()
            .init_resource::<Touches>()
            .add_systems(Update, touch_screen_input_system);
        let window = app
            .world_mut()
            .spawn((
                Window {
                    resolution: WindowResolution::new(200, 400),
                    ..Default::default()
                },
                PrimaryWindow,
            ))
            .id();
        app.world_mut().write_message(TouchInput {
            phase: TouchPhase::Started,
            position: Vec2::new(50.0, 100.0),
            window,
            force: None,
            id: 7,
        });
        app.update();
        app.world_mut().init_resource::<AppScriptFunctionRegistry>();
        app.world_mut().init_resource::<AppTypeRegistry>();
        let cache = WorldGuard::setup_cache(app.world(), CurrentScriptAttachment::default());

        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            let ScriptValue::Map(state) = input_primary_touch(context)? else {
                return Err(InteropError::string("touch state must be a map".to_owned()));
            };
            assert_eq!(state.get("pressed"), Some(&ScriptValue::Bool(true)));
            assert_eq!(state.get("justPressed"), Some(&ScriptValue::Bool(true)));
            assert_eq!(state.get("x"), Some(&ScriptValue::Float(0.25)));
            assert_eq!(state.get("y"), Some(&ScriptValue::Float(0.75)));
            assert_eq!(state.get("deltaX"), Some(&ScriptValue::Float(0.0)));
            assert_eq!(state.get("deltaY"), Some(&ScriptValue::Float(0.0)));
            Ok(())
        })
    }
}
