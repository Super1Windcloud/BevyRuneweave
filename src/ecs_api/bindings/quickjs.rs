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

use super::super::{
    command::{
        clear_world, despawn_entity, entity_exists, get_component, get_resource, has_component,
        insert_component, query_entities, remove_component, remove_resource, set_resource,
        spawn_entity,
    },
    value::EcsValue,
};

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

fn js_component_insert(id: String, name: String, value: Value<'_>) -> rquickjs::Result<bool> {
    Ok(insert_component(&id, name, js_to_ecs(value, 0)?))
}

fn js_component_get<'js>(ctx: Ctx<'js>, id: String, name: String) -> rquickjs::Result<Value<'js>> {
    get_component(&id, &name).map_or_else(
        || Ok(Value::new_null(ctx.clone())),
        |value| ecs_to_js(&ctx, value, 0),
    )
}

fn js_query<'js>(ctx: Ctx<'js>, required: Vec<String>) -> rquickjs::Result<Array<'js>> {
    let result = Array::new(ctx)?;
    for (index, id) in query_entities(&required).into_iter().enumerate() {
        result.set(index, id)?;
    }
    Ok(result)
}

fn js_resource_set(name: String, value: Value<'_>) -> rquickjs::Result<()> {
    set_resource(name, js_to_ecs(value, 0)?);
    Ok(())
}

fn js_resource_get<'js>(ctx: Ctx<'js>, name: String) -> rquickjs::Result<Value<'js>> {
    get_resource(&name).map_or_else(
        || Ok(Value::new_null(ctx.clone())),
        |value| ecs_to_js(&ctx, value, 0),
    )
}

fn install_ecs_api(
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    context
        .with(|ctx| {
            let globals = ctx.globals();
            globals.set("ecs_world_clear", Func::from(clear_world))?;
            globals.set("ecs_entity_spawn", Func::from(spawn_entity))?;
            globals.set(
                "ecs_entity_exists",
                Func::from(|id: String| entity_exists(&id)),
            )?;
            globals.set("ecs_entity_despawn", Func::from(despawn_entity))?;
            globals.set("ecs_component_insert", Func::from(js_component_insert))?;
            globals.set("ecs_component_get", Func::from(js_component_get))?;
            globals.set(
                "ecs_component_has",
                Func::from(|id: String, name: String| has_component(&id, &name)),
            )?;
            globals.set(
                "ecs_component_remove",
                Func::from(|id: String, name: String| remove_component(&id, &name)),
            )?;
            globals.set("ecs_query", Func::from(js_query))?;
            globals.set("ecs_resource_set", Func::from(js_resource_set))?;
            globals.set("ecs_resource_get", Func::from(js_resource_get))?;
            globals.set(
                "ecs_resource_remove",
                Func::from(|name: String| remove_resource(&name)),
            )?;
            Ok::<(), rquickjs::Error>(())
        })
        .map_err(interop_error)
}

pub(super) fn ecs_quickjs_plugin() -> QuickJsScriptingPlugin {
    QuickJsScriptingPlugin::default().add_context_initializer(install_ecs_api)
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
