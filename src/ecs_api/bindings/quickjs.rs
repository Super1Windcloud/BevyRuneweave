use std::collections::BTreeMap;

use bevy_mod_scripting::{
    bindings::InteropError,
    core::ConfigureScriptPlugin,
    quickjs::{
        QuickJsContext, QuickJsScriptingPlugin,
        rquickjs::{self, Array, Ctx, IntoJs, Object, Value, function::Func},
    },
    script::ScriptAttachment,
};

use super::super::{command::EcsBridge, value::EcsValue};

const MAX_VALUE_DEPTH: usize = 32;

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn js_to_ecs(value: Value<'_>, depth: usize) -> rquickjs::Result<EcsValue> {
    if depth > MAX_VALUE_DEPTH {
        return Err(rquickjs::Error::new_from_js_message(
            "value",
            "EcsValue",
            "nesting exceeds 32 levels",
        ));
    }
    if value.is_null() || value.is_undefined() {
        return Ok(EcsValue::Null);
    }
    if let Some(value) = value.as_bool() {
        return Ok(EcsValue::Bool(value));
    }
    if let Some(value) = value.as_number() {
        return if value.is_finite() {
            Ok(EcsValue::Number(value))
        } else {
            Err(rquickjs::Error::new_from_js_message(
                "number",
                "EcsValue",
                "numbers must be finite",
            ))
        };
    }
    if value.is_string() {
        return value.get::<String>().map(EcsValue::String);
    }
    if value.is_array() {
        let array = value.get::<Array>()?;
        return array
            .iter::<Value>()
            .map(|value| js_to_ecs(value?, depth + 1))
            .collect::<rquickjs::Result<Vec<_>>>()
            .map(EcsValue::Array);
    }
    if value.is_object() {
        let object = value.get::<Object>()?;
        let fields = object
            .props::<String, Value>()
            .map(|entry| {
                let (name, value) = entry?;
                Ok((name, js_to_ecs(value, depth + 1)?))
            })
            .collect::<rquickjs::Result<BTreeMap<_, _>>>()?;
        return Ok(EcsValue::Object(fields));
    }
    Err(rquickjs::Error::new_from_js("value", "EcsValue"))
}

fn ecs_to_js<'js>(ctx: &Ctx<'js>, value: EcsValue, depth: usize) -> rquickjs::Result<Value<'js>> {
    if depth > MAX_VALUE_DEPTH {
        return Err(rquickjs::Error::new_into_js_message(
            "EcsValue",
            "value",
            "nesting exceeds 32 levels",
        ));
    }
    match value {
        EcsValue::Null => Ok(Value::new_null(ctx.clone())),
        EcsValue::Bool(value) => Ok(Value::new_bool(ctx.clone(), value)),
        EcsValue::Number(value) => Ok(Value::new_number(ctx.clone(), value)),
        EcsValue::String(value) => value.into_js(ctx),
        EcsValue::Array(values) => {
            let array = Array::new(ctx.clone())?;
            for (index, value) in values.into_iter().enumerate() {
                array.set(index, ecs_to_js(ctx, value, depth + 1)?)?;
            }
            array.into_js(ctx)
        }
        EcsValue::Object(fields) => {
            let object = Object::new(ctx.clone())?;
            for (name, value) in fields {
                object.set(name, ecs_to_js(ctx, value, depth + 1)?)?;
            }
            object.into_js(ctx)
        }
    }
}

fn js_component_insert(
    bridge: &EcsBridge,
    id: String,
    name: String,
    value: Value<'_>,
) -> rquickjs::Result<bool> {
    Ok(bridge.insert_component(&id, name, js_to_ecs(value, 0)?))
}

struct JsEcsValue(EcsValue);

impl<'js> IntoJs<'js> for JsEcsValue {
    fn into_js(self, ctx: &Ctx<'js>) -> rquickjs::Result<Value<'js>> {
        ecs_to_js(ctx, self.0, 0)
    }
}

fn js_entity_spawn_bundle(
    bridge: &EcsBridge,
    id: String,
    bundle: Value<'_>,
) -> rquickjs::Result<()> {
    let EcsValue::Object(components) = js_to_ecs(bundle, 0)? else {
        return Err(rquickjs::Error::new_from_js_message(
            "value",
            "component bundle",
            "expected an object",
        ));
    };
    bridge.spawn_entity_bundle(id, components);
    Ok(())
}

fn js_resource_set(bridge: &EcsBridge, name: String, value: Value<'_>) -> rquickjs::Result<()> {
    bridge.set_resource(name, js_to_ecs(value, 0)?);
    Ok(())
}

fn install_ecs_api(
    bridge: &EcsBridge,
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    let bridge = bridge.clone();
    context
        .with(move |ctx| {
            let globals = ctx.globals();
            globals.set(
                "ecs_world_clear",
                Func::from({
                    let bridge = bridge.clone();
                    move || bridge.clear_world()
                }),
            )?;
            globals.set(
                "ecs_entity_spawn",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String| bridge.spawn_entity(id)
                }),
            )?;
            globals.set(
                "ecs_entity_spawn_bundle",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String, bundle: Value<'_>| js_entity_spawn_bundle(&bridge, id, bundle)
                }),
            )?;
            globals.set(
                "ecs_entity_exists",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String| bridge.entity_exists(&id)
                }),
            )?;
            globals.set(
                "ecs_entity_despawn",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String| bridge.despawn_entity(id)
                }),
            )?;
            globals.set(
                "ecs_component_insert",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String, name: String, value: Value<'_>| {
                        js_component_insert(&bridge, id, name, value)
                    }
                }),
            )?;
            globals.set(
                "ecs_component_get",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String, name: String| {
                        JsEcsValue(bridge.get_component(&id, &name).unwrap_or(EcsValue::Null))
                    }
                }),
            )?;
            globals.set(
                "ecs_component_has",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String, name: String| bridge.has_component(&id, &name)
                }),
            )?;
            globals.set(
                "ecs_component_remove",
                Func::from({
                    let bridge = bridge.clone();
                    move |id: String, name: String| bridge.remove_component(&id, &name)
                }),
            )?;
            globals.set(
                "ecs_query",
                Func::from({
                    let bridge = bridge.clone();
                    move |required: Vec<String>| bridge.query_entities(&required)
                }),
            )?;
            globals.set(
                "ecs_query_filtered",
                Func::from({
                    let bridge = bridge.clone();
                    move |required: Vec<String>, excluded: Vec<String>| {
                        bridge.query_entities_filtered(&required, &excluded)
                    }
                }),
            )?;
            globals.set(
                "ecs_query_matching",
                Func::from({
                    let bridge = bridge.clone();
                    move |required: Vec<String>, any: Vec<String>, excluded: Vec<String>| {
                        bridge.query_entities_matching(&required, &any, &excluded)
                    }
                }),
            )?;
            globals.set(
                "ecs_resource_set",
                Func::from({
                    let bridge = bridge.clone();
                    move |name: String, value: Value<'_>| js_resource_set(&bridge, name, value)
                }),
            )?;
            globals.set(
                "ecs_resource_get",
                Func::from({
                    let bridge = bridge.clone();
                    move |name: String| {
                        JsEcsValue(bridge.get_resource(&name).unwrap_or(EcsValue::Null))
                    }
                }),
            )?;
            globals.set(
                "ecs_resource_remove",
                Func::from({
                    let bridge = bridge.clone();
                    move |name: String| bridge.remove_resource(&name)
                }),
            )?;
            Ok::<(), rquickjs::Error>(())
        })
        .map_err(interop_error)
}

pub(super) fn ecs_quickjs_plugin(bridge: EcsBridge) -> QuickJsScriptingPlugin {
    QuickJsScriptingPlugin::default().add_context_initializer(move |attachment, context| {
        let owned_bridge = bridge.for_attachment(attachment);
        install_ecs_api(&owned_bridge, attachment, context)
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicI32, AtomicUsize, Ordering},
    };

    use bevy_mod_scripting::quickjs::rquickjs::{Context, Function, Runtime};

    use super::*;

    fn assert_shooter_uses_structured_ecs_api(source: &str) {
        let runtime = Runtime::new().unwrap();
        let context = Context::full(&runtime).unwrap();
        let sprite_count = Arc::new(AtomicUsize::new(0));
        let remaining_lives = Arc::new(AtomicI32::new(3));

        context.with(|ctx| {
            let globals = ctx.globals();
            globals.set("ecs_world_clear", Func::from(|| {})).unwrap();
            globals
                .set("ecs_entity_spawn", Func::from(|_: String| {}))
                .unwrap();
            globals
                .set("ecs_entity_despawn", Func::from(|_: String| true))
                .unwrap();
            globals
                .set(
                    "ecs_component_insert",
                    Func::from({
                        let sprite_count = Arc::clone(&sprite_count);
                        move |_: String, name: String, _: Value<'_>| {
                            if name == "sprite" {
                                sprite_count.fetch_add(1, Ordering::Relaxed);
                            }
                            true
                        }
                    }),
                )
                .unwrap();
            globals
                .set(
                    "ecs_resource_set",
                    Func::from({
                        let remaining_lives = Arc::clone(&remaining_lives);
                        move |name: String, value: Value<'_>| -> rquickjs::Result<()> {
                            if name == "game_state" {
                                let state = value.get::<Object>()?;
                                remaining_lives.store(state.get("lives")?, Ordering::Relaxed);
                            }
                            Ok(())
                        }
                    }),
                )
                .unwrap();

            ctx.eval::<(), _>(source).unwrap();
            let loaded: Function = globals.get("on_script_loaded").unwrap();
            loaded.call::<_, ()>(()).unwrap();
            let update: Function = globals.get("on_update").unwrap();
            update
                .call::<_, ()>((0.016_f64, 0.0_f64, 0.0_f64, true))
                .unwrap();
            update
                .call::<_, ()>((0.016_f64, 0.0_f64, 0.0_f64, false))
                .unwrap();
            for _ in 0..600 {
                update
                    .call::<_, ()>((0.016_f64, 0.25_f64, 0.0_f64, false))
                    .unwrap();
            }
        });

        assert!(sprite_count.load(Ordering::Relaxed) > 1);
        assert!(remaining_lives.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn javascript_shooter_uses_structured_ecs_api() {
        assert_shooter_uses_structured_ecs_api(include_str!(
            "../../../projects/js/assets/shooter.js"
        ));
    }

    #[test]
    fn compiled_typescript_shooter_uses_structured_ecs_api() {
        assert_shooter_uses_structured_ecs_api(include_str!(
            "../../../projects/ts/assets/shooter.js"
        ));
    }
}
