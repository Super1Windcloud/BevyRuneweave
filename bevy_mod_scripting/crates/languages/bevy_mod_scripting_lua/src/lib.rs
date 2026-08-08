//! Lua integration for the bevy_mod_scripting system.
#![cfg(feature = "lua55")]

use std::ops::{Deref, DerefMut};

use bevy_app::{App, Plugin};
use bevy_ecs::world::WorldId;
use bevy_log::trace;
use bevy_mod_scripting_asset::Language;
use bevy_mod_scripting_bindings::{InteropError, ScriptValue};
use bevy_mod_scripting_core::{
    IntoScriptPluginParams, ScriptingPlugin,
    config::{GetPluginThreadConfig, ScriptingPluginConfiguration},
    event::CallbackLabel,
    make_plugin_config_static,
    script::ContextPolicy,
};
use bevy_mod_scripting_script::ScriptAttachment;
pub use mlua;
use mlua::{Function, Lua, MultiValue, Value};

make_plugin_config_static!(LuaScriptingPlugin);

/// A newtype around a lua context.
#[derive(Debug, Clone)]
pub struct LuaContext(Lua);

impl Deref for LuaContext {
    type Target = Lua;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for LuaContext {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl IntoScriptPluginParams for LuaScriptingPlugin {
    type C = LuaContext;
    type R = ();
    const LANGUAGE: Language = Language::Lua;

    fn build_runtime() -> Self::R {}

    fn handler() -> bevy_mod_scripting_core::handler::HandlerFn<Self> {
        lua_handler
    }

    fn context_loader() -> bevy_mod_scripting_core::context::ContextLoadFn<Self> {
        lua_context_load
    }

    fn context_reloader() -> bevy_mod_scripting_core::context::ContextReloadFn<Self> {
        lua_context_reload
    }
}

// necessary for automatic config goodies
impl AsMut<ScriptingPlugin<Self>> for LuaScriptingPlugin {
    fn as_mut(&mut self) -> &mut ScriptingPlugin<LuaScriptingPlugin> {
        &mut self.scripting_plugin
    }
}

/// The lua scripting plugin. Used to add lua scripting to a bevy app within the context of the BMS framework.
pub struct LuaScriptingPlugin {
    /// The internal scripting plugin
    pub scripting_plugin: ScriptingPlugin<Self>,
}

impl Default for LuaScriptingPlugin {
    fn default() -> Self {
        LuaScriptingPlugin {
            scripting_plugin: ScriptingPlugin {
                runtime_initializers: Vec::default(),
                supported_extensions: vec!["lua"],
                context_initializers: Vec::new(),
                context_pre_handling_initializers: Vec::new(),
                language: Language::Lua,
                context_policy: ContextPolicy::default(),
                emit_responses: false,
                processing_pipeline_plugin: Default::default(),
            },
        }
    }
}

impl Plugin for LuaScriptingPlugin {
    fn build(&self, app: &mut App) {
        self.scripting_plugin.build(app);
    }

    fn finish(&self, app: &mut App) {
        self.scripting_plugin.finish(app);
    }
}

fn load_lua_content_into_context(
    context: &mut LuaContext,
    context_key: &ScriptAttachment,
    content: &[u8],
    world_id: WorldId,
) -> Result<(), InteropError> {
    let config = LuaScriptingPlugin::readonly_configuration(world_id);
    let initializers = config.context_initialization_callbacks;
    let pre_handling_initializers = config.pre_handling_callbacks;
    initializers
        .iter()
        .try_for_each(|init| init(context_key, context))?;

    pre_handling_initializers
        .iter()
        .try_for_each(|init| init(context_key, context))?;

    context
        .load(content)
        .exec()
        .map_err(IntoInteropError::to_bms_error)?;

    Ok(())
}

/// Load a lua context from a script
pub fn lua_context_load(
    context_key: &ScriptAttachment,
    content: &[u8],
    world_id: WorldId,
) -> Result<LuaContext, InteropError> {
    let mut context = LuaContext(Lua::new());

    load_lua_content_into_context(&mut context, context_key, content, world_id)?;
    Ok(context)
}

/// Reload a lua context from a script
pub fn lua_context_reload(
    context_key: &ScriptAttachment,
    content: &[u8],
    old_ctxt: &mut LuaContext,
    world_id: WorldId,
) -> Result<(), InteropError> {
    load_lua_content_into_context(old_ctxt, context_key, content, world_id)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
/// The lua handler for events
pub fn lua_handler(
    args: Vec<ScriptValue>,
    context_key: &ScriptAttachment,
    callback_label: &CallbackLabel,
    context: &mut LuaContext,
    world_id: WorldId,
) -> Result<ScriptValue, bevy_mod_scripting_bindings::InteropError> {
    let config = LuaScriptingPlugin::readonly_configuration(world_id);

    config
        .pre_handling_callbacks
        .iter()
        .try_for_each(|init| init(context_key, context))?;

    let handler: Function = match context.globals().raw_get(callback_label.as_ref()) {
        Ok(handler) => handler,
        // not subscribed to this event type
        Err(_) => {
            trace!(
                "Context {} is not subscribed to callback {}",
                context_key,
                callback_label.as_ref()
            );
            return Ok(ScriptValue::Unit);
        }
    };

    let input = MultiValue::from_vec(
        args.into_iter()
            .map(|arg| into_lua_value(context, arg))
            .collect::<Result<_, _>>()?,
    );

    let out = handler
        .call::<Value>(input)
        .map_err(IntoInteropError::to_bms_error)?;

    from_lua_value(out)
}

fn unsupported_value(kind: &str, type_name: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(format!(
        "unsupported Lua {kind}: {type_name}"
    )))
}

fn into_lua_value(lua: &Lua, value: ScriptValue) -> Result<Value, InteropError> {
    match value {
        ScriptValue::Unit => Ok(Value::Nil),
        ScriptValue::Bool(value) => Ok(Value::Boolean(value)),
        ScriptValue::Integer(value) => Ok(Value::Integer(value)),
        ScriptValue::Float(value) => Ok(Value::Number(value)),
        ScriptValue::String(value) => lua
            .create_string(value.as_ref())
            .map(Value::String)
            .map_err(IntoInteropError::to_bms_error),
        other => Err(unsupported_value("argument", other.type_name())),
    }
}

fn from_lua_value(value: Value) -> Result<ScriptValue, InteropError> {
    match value {
        Value::Nil => Ok(ScriptValue::Unit),
        Value::Boolean(value) => Ok(ScriptValue::Bool(value)),
        Value::Integer(value) => Ok(ScriptValue::Integer(value)),
        Value::Number(value) => Ok(ScriptValue::Float(value)),
        Value::String(value) => value
            .to_str()
            .map(|value| ScriptValue::from(value.to_owned()))
            .map_err(IntoInteropError::to_bms_error),
        other => Err(unsupported_value("return type", other.type_name())),
    }
}

/// A trait to convert between mlua::Error and InteropError
pub trait IntoInteropError {
    /// Convert into InteropError
    fn to_bms_error(self) -> InteropError;
}

impl IntoInteropError for mlua::Error {
    fn to_bms_error(self) -> InteropError {
        match self {
            mlua::Error::CallbackError { traceback, cause }
                if matches!(cause.as_ref(), mlua::Error::ExternalError(_)) =>
            {
                let inner = cause.deref().clone();
                inner.to_bms_error().with_context(traceback)
            }
            e => {
                if let Some(inner) = e.downcast_ref::<InteropError>() {
                    inner.clone()
                } else {
                    InteropError::external(e)
                }
            }
        }
    }
}

/// A trait to convert between InteropError and mlua::Error
pub trait IntoMluaError {
    /// Convert into mlua::Error
    fn to_lua_error(self) -> mlua::Error;
}

impl<T: Into<InteropError>> IntoMluaError for T {
    fn to_lua_error(self) -> mlua::Error {
        let error: InteropError = self.into();
        mlua::Error::external(error)
    }
}

#[cfg(test)]
mod test {
    use ::bevy_asset::Handle;
    use bevy_ecs::entity::Entity;
    use bevy_mod_scripting_asset::LanguageExtensions;
    use mlua::Value;

    use super::*;

    #[test]
    fn test_reload_doesnt_overwrite_old_context() {
        let lua = Lua::new();
        let mut old_ctxt = LuaContext(lua.clone());
        let handle = Handle::default();
        let context_key = ScriptAttachment::EntityScript(Entity::from_raw_u32(1).unwrap(), handle);
        let world_id = WorldId::new().unwrap();
        LuaScriptingPlugin::set_world_local_config(
            world_id,
            ScriptingPluginConfiguration {
                pre_handling_callbacks: &[],
                context_initialization_callbacks: &[],
                emit_responses: false,
                runtime: &(),
                language_extensions: Box::leak(Box::new(LanguageExtensions::default())),
            },
        );
        lua_context_load(
            &context_key,
            "function hello_world_from_first_load()

            end"
            .as_bytes(),
            world_id,
        )
        .unwrap();

        lua_context_reload(
            &context_key,
            "function hello_world_from_second_load()

            end"
            .as_bytes(),
            &mut old_ctxt,
            world_id,
        )
        .unwrap();

        // assert both functions exist in globals
        let globals = lua.globals();
        assert!(globals.get::<Value>("hello_world_from_first_load").is_ok());
        assert!(globals.get::<Value>("hello_world_from_second_load").is_ok());
    }
}
