use std::collections::BTreeMap;

use bevy_mod_scripting::{
    bindings::InteropError,
    core::ConfigureScriptPlugin,
    lua::{LuaContext, LuaScriptingPlugin, mlua},
    script::ScriptAttachment,
};
use mlua::{Lua, Table, Value};

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

fn lua_to_ecs(value: Value, depth: usize) -> mlua::Result<EcsValue> {
    if depth > MAX_VALUE_DEPTH {
        return Err(mlua::Error::runtime("ECS value nesting exceeds 32 levels"));
    }
    match value {
        Value::Nil => Ok(EcsValue::Null),
        Value::Boolean(value) => Ok(EcsValue::Bool(value)),
        Value::Integer(value) => Ok(EcsValue::Number(value as f64)),
        Value::Number(value) if value.is_finite() => Ok(EcsValue::Number(value)),
        Value::Number(_) => Err(mlua::Error::runtime("ECS numbers must be finite")),
        Value::String(value) => Ok(EcsValue::String(value.to_str()?.to_owned())),
        Value::Table(table) => table_to_ecs(table, depth + 1),
        other => Err(mlua::Error::runtime(format!(
            "unsupported ECS value type: {}",
            other.type_name()
        ))),
    }
}

fn table_to_ecs(table: Table, depth: usize) -> mlua::Result<EcsValue> {
    let entries = table
        .pairs::<Value, Value>()
        .collect::<mlua::Result<Vec<_>>>()?;
    let array_len = entries
        .iter()
        .filter_map(|(key, _)| match key {
            Value::Integer(index) if *index > 0 => usize::try_from(*index).ok(),
            _ => None,
        })
        .max()
        .unwrap_or_default();
    let is_array = !entries.is_empty()
        && entries.len() == array_len
        && entries.iter().all(|(key, _)| {
            matches!(key, Value::Integer(index) if *index > 0 && (*index as usize) <= array_len)
        });

    if is_array {
        let mut values = vec![EcsValue::Null; array_len];
        for (key, value) in entries {
            let Value::Integer(index) = key else {
                unreachable!();
            };
            values[index as usize - 1] = lua_to_ecs(value, depth)?;
        }
        return Ok(EcsValue::Array(values));
    }

    let mut fields = BTreeMap::new();
    for (key, value) in entries {
        let Value::String(key) = key else {
            return Err(mlua::Error::runtime(
                "ECS object tables require string keys",
            ));
        };
        fields.insert(key.to_str()?.to_owned(), lua_to_ecs(value, depth)?);
    }
    Ok(EcsValue::Object(fields))
}

fn ecs_to_lua(lua: &Lua, value: EcsValue, depth: usize) -> mlua::Result<Value> {
    if depth > MAX_VALUE_DEPTH {
        return Err(mlua::Error::runtime("ECS value nesting exceeds 32 levels"));
    }
    match value {
        EcsValue::Null => Ok(Value::Nil),
        EcsValue::Bool(value) => Ok(Value::Boolean(value)),
        EcsValue::Number(value) => Ok(Value::Number(value)),
        EcsValue::String(value) => lua.create_string(value).map(Value::String),
        EcsValue::Array(values) => {
            let table = lua.create_table_with_capacity(values.len(), 0)?;
            for (index, value) in values.into_iter().enumerate() {
                table.raw_set(index + 1, ecs_to_lua(lua, value, depth + 1)?)?;
            }
            Ok(Value::Table(table))
        }
        EcsValue::Object(fields) => {
            let table = lua.create_table_with_capacity(0, fields.len())?;
            for (name, value) in fields {
                table.raw_set(name, ecs_to_lua(lua, value, depth + 1)?)?;
            }
            Ok(Value::Table(table))
        }
    }
}

fn install_ecs_api(
    _attachment: &ScriptAttachment,
    context: &mut LuaContext,
) -> Result<(), InteropError> {
    let globals = context.globals();
    let result = (|| -> mlua::Result<()> {
        globals.set(
            "ecs_world_clear",
            context.create_function(|_, ()| {
                clear_world();
                Ok(())
            })?,
        )?;
        globals.set(
            "ecs_entity_spawn",
            context.create_function(|_, id: String| {
                spawn_entity(id);
                Ok(())
            })?,
        )?;
        globals.set(
            "ecs_entity_exists",
            context.create_function(|_, id: String| Ok(entity_exists(&id)))?,
        )?;
        globals.set(
            "ecs_entity_despawn",
            context.create_function(|_, id: String| Ok(despawn_entity(id)))?,
        )?;
        globals.set(
            "ecs_component_insert",
            context.create_function(|_, (id, name, value): (String, String, Value)| {
                Ok(insert_component(&id, name, lua_to_ecs(value, 0)?))
            })?,
        )?;
        globals.set(
            "ecs_component_get",
            context.create_function(|lua, (id, name): (String, String)| {
                get_component(&id, &name).map_or(Ok(Value::Nil), |value| ecs_to_lua(lua, value, 0))
            })?,
        )?;
        globals.set(
            "ecs_component_has",
            context
                .create_function(|_, (id, name): (String, String)| Ok(has_component(&id, &name)))?,
        )?;
        globals.set(
            "ecs_component_remove",
            context.create_function(|_, (id, name): (String, String)| {
                Ok(remove_component(&id, &name))
            })?,
        )?;
        globals.set(
            "ecs_query",
            context.create_function(|lua, required: Vec<String>| {
                let result = lua.create_table_with_capacity(required.len(), 0)?;
                for (index, id) in query_entities(&required).into_iter().enumerate() {
                    result.raw_set(index + 1, id)?;
                }
                Ok(result)
            })?,
        )?;
        globals.set(
            "ecs_resource_set",
            context.create_function(|_, (name, value): (String, Value)| {
                set_resource(name, lua_to_ecs(value, 0)?);
                Ok(())
            })?,
        )?;
        globals.set(
            "ecs_resource_get",
            context.create_function(|lua, name: String| {
                get_resource(&name).map_or(Ok(Value::Nil), |value| ecs_to_lua(lua, value, 0))
            })?,
        )?;
        globals.set(
            "ecs_resource_remove",
            context.create_function(|_, name: String| Ok(remove_resource(&name)))?,
        )?;
        Ok(())
    })();
    result.map_err(interop_error)
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

    use super::*;

    #[test]
    fn shooter_uses_structured_ecs_api_for_gameplay() {
        let lua = Lua::new();
        let globals = lua.globals();
        let sprite_count = Arc::new(AtomicUsize::new(0));
        let remaining_lives = Arc::new(AtomicI32::new(3));

        globals
            .set(
                "ecs_world_clear",
                lua.create_function(|_, ()| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_entity_spawn",
                lua.create_function(|_, _: String| Ok(())).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_entity_despawn",
                lua.create_function(|_, _: String| Ok(true)).unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_component_insert",
                lua.create_function({
                    let sprite_count = Arc::clone(&sprite_count);
                    move |_, (_, name, _): (String, String, Value)| {
                        if name == "sprite" {
                            sprite_count.fetch_add(1, Ordering::Relaxed);
                        }
                        Ok(true)
                    }
                })
                .unwrap(),
            )
            .unwrap();
        globals
            .set(
                "ecs_resource_set",
                lua.create_function({
                    let remaining_lives = Arc::clone(&remaining_lives);
                    move |_, (name, value): (String, Value)| {
                        if name == "game_state"
                            && let Value::Table(state) = value
                        {
                            remaining_lives.store(state.get("lives")?, Ordering::Relaxed);
                        }
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
        lua.load(source).exec().unwrap();
        let loaded: mlua::Function = globals.get("on_script_loaded").unwrap();
        loaded.call::<()>(()).unwrap();
        let update: mlua::Function = globals.get("on_update").unwrap();
        update
            .call::<()>((0.016_f64, 0.0_f64, 0.0_f64, true))
            .unwrap();
        update
            .call::<()>((0.016_f64, 0.0_f64, 0.0_f64, false))
            .unwrap();
        for _ in 0..600 {
            update
                .call::<()>((0.016_f64, 0.25_f64, 0.0_f64, false))
                .unwrap();
        }

        assert!(sprite_count.load(Ordering::Relaxed) > 1);
        assert!(remaining_lives.load(Ordering::Relaxed) > 0);
    }
}
