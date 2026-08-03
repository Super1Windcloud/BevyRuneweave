//! QuickJS integration for `bevy_mod_scripting`.

use std::{borrow::Cow, ops::Deref};

use bevy_app::{App, Plugin};
use bevy_ecs::world::WorldId;
use bevy_log::trace;
use bevy_mod_scripting_asset::Language;
use bevy_mod_scripting_bindings::{InteropError, ScriptValue};
use bevy_mod_scripting_core::{
    IntoScriptPluginParams, ScriptingPlugin,
    config::{GetPluginThreadConfig, ScriptingPluginConfiguration},
    context::{ContextLoadFn, ContextReloadFn},
    event::CallbackLabel,
    handler::HandlerFn,
    make_plugin_config_static,
    script::ContextPolicy,
};
use bevy_mod_scripting_script::ScriptAttachment;
pub use rquickjs;
use rquickjs::{
    Context, FromJs, Function, Runtime, Type, Value,
    function::{Args, Func},
};

const QUICKJS_LANGUAGE: Language = Language::External {
    name: Cow::Borrowed("QuickJS"),
    one_indexed: false,
};

make_plugin_config_static!(QuickJsScriptingPlugin);

/// A QuickJS execution context managed by the BMS script pipeline.
pub struct QuickJsContext(Context);

impl Deref for QuickJsContext {
    type Target = Context;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// The shared QuickJS runtime used to create script contexts.
#[derive(Clone)]
pub struct QuickJsRuntime(Result<Runtime, String>);

impl Default for QuickJsRuntime {
    fn default() -> Self {
        Self(Runtime::new().map_err(|error| error.to_string()))
    }
}

/// BMS language plugin for `.js` and `.mjs` assets executed by QuickJS.
pub struct QuickJsScriptingPlugin {
    /// The language-agnostic BMS plugin implementation.
    pub scripting_plugin: ScriptingPlugin<Self>,
}

impl Default for QuickJsScriptingPlugin {
    fn default() -> Self {
        Self {
            scripting_plugin: ScriptingPlugin {
                runtime_initializers: Vec::new(),
                context_policy: ContextPolicy::default(),
                language: QUICKJS_LANGUAGE,
                supported_extensions: vec!["js", "mjs"],
                context_initializers: vec![install_console],
                context_pre_handling_initializers: Vec::new(),
                emit_responses: false,
                processing_pipeline_plugin: Default::default(),
            },
        }
    }
}

impl AsMut<ScriptingPlugin<Self>> for QuickJsScriptingPlugin {
    fn as_mut(&mut self) -> &mut ScriptingPlugin<Self> {
        &mut self.scripting_plugin
    }
}

impl Plugin for QuickJsScriptingPlugin {
    fn build(&self, app: &mut App) {
        self.scripting_plugin.build(app);
    }

    fn finish(&self, app: &mut App) {
        self.scripting_plugin.finish(app);
    }
}

impl IntoScriptPluginParams for QuickJsScriptingPlugin {
    const LANGUAGE: Language = QUICKJS_LANGUAGE;
    type C = QuickJsContext;
    type R = QuickJsRuntime;

    fn build_runtime() -> Self::R {
        QuickJsRuntime::default()
    }

    fn handler() -> HandlerFn<Self> {
        quickjs_handler
    }

    fn context_loader() -> ContextLoadFn<Self> {
        quickjs_context_load
    }

    fn context_reloader() -> ContextReloadFn<Self> {
        quickjs_context_reload
    }
}

fn interop_error(error: impl std::fmt::Display) -> InteropError {
    InteropError::external(std::io::Error::other(error.to_string()))
}

fn install_console(
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    context.with(|ctx| {
        let console = rquickjs::Object::new(ctx.clone()).map_err(interop_error)?;
        console
            .set(
                "log",
                Func::from(|message: String| {
                    bevy_log::info!(target: "quickjs", "{message}");
                }),
            )
            .map_err(interop_error)?;
        ctx.globals().set("console", console).map_err(interop_error)
    })
}

fn create_context(
    attachment: &ScriptAttachment,
    content: &[u8],
    world_id: WorldId,
) -> Result<QuickJsContext, InteropError> {
    let configuration = QuickJsScriptingPlugin::readonly_configuration(world_id);
    let runtime = configuration.runtime.0.as_ref().map_err(interop_error)?;
    let context = Context::full(runtime).map_err(interop_error)?;
    let mut context = QuickJsContext(context);

    configuration
        .context_initialization_callbacks
        .iter()
        .try_for_each(|initializer| initializer(attachment, &mut context))?;
    configuration
        .pre_handling_callbacks
        .iter()
        .try_for_each(|initializer| initializer(attachment, &mut context))?;

    let source = std::str::from_utf8(content).map_err(interop_error)?;
    context
        .with(|ctx| ctx.eval::<(), _>(source))
        .map_err(interop_error)?;
    Ok(context)
}

/// Creates and evaluates a QuickJS context for a BMS script attachment.
pub fn quickjs_context_load(
    attachment: &ScriptAttachment,
    content: &[u8],
    world_id: WorldId,
) -> Result<QuickJsContext, InteropError> {
    create_context(attachment, content, world_id)
}

/// Transactionally replaces a context after the new source evaluates successfully.
pub fn quickjs_context_reload(
    attachment: &ScriptAttachment,
    content: &[u8],
    previous: &mut QuickJsContext,
    world_id: WorldId,
) -> Result<(), InteropError> {
    let replacement = create_context(attachment, content, world_id)?;
    *previous = replacement;
    Ok(())
}

fn push_script_value(args: &mut Args<'_>, value: ScriptValue) -> Result<(), InteropError> {
    match value {
        ScriptValue::Unit => args.push_arg(()),
        ScriptValue::Bool(value) => args.push_arg(value),
        ScriptValue::Integer(value) => args.push_arg(value as f64),
        ScriptValue::Float(value) => args.push_arg(value),
        ScriptValue::String(value) => args.push_arg(value.as_ref()),
        other => {
            return Err(interop_error(format!(
                "unsupported QuickJS argument: {}",
                other.type_name()
            )));
        }
    }
    .map_err(interop_error)
}

fn from_js_value<'js>(
    ctx: &rquickjs::Ctx<'js>,
    value: Value<'js>,
) -> Result<ScriptValue, InteropError> {
    match value.type_of() {
        Type::Uninitialized | Type::Undefined | Type::Null => Ok(ScriptValue::Unit),
        Type::Bool => bool::from_js(ctx, value)
            .map(ScriptValue::Bool)
            .map_err(interop_error),
        Type::Int => i32::from_js(ctx, value)
            .map(|value| ScriptValue::Integer(value.into()))
            .map_err(interop_error),
        Type::Float => f64::from_js(ctx, value)
            .map(ScriptValue::Float)
            .map_err(interop_error),
        Type::String => std::string::String::from_js(ctx, value)
            .map(ScriptValue::from)
            .map_err(interop_error),
        other => Err(interop_error(format!(
            "unsupported QuickJS return type: {other}"
        ))),
    }
}

/// Invokes a global JavaScript function matching the BMS callback label.
pub fn quickjs_handler(
    values: Vec<ScriptValue>,
    attachment: &ScriptAttachment,
    callback: &CallbackLabel,
    context: &mut QuickJsContext,
    world_id: WorldId,
) -> Result<ScriptValue, InteropError> {
    let configuration = QuickJsScriptingPlugin::readonly_configuration(world_id);
    configuration
        .pre_handling_callbacks
        .iter()
        .try_for_each(|initializer| initializer(attachment, context))?;

    context.with(|ctx| {
        let function = ctx
            .globals()
            .get::<_, Option<Function>>(callback.as_ref())
            .map_err(interop_error)?;
        let Some(function) = function else {
            trace!("{attachment} does not implement {callback}");
            return Ok(ScriptValue::Unit);
        };

        let mut args = Args::new(ctx.clone(), values.len());
        for value in values {
            push_script_value(&mut args, value)?;
        }
        let result = args.apply::<Value>(&function).map_err(interop_error)?;
        from_js_value(&ctx, result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_mod_scripting_asset::LanguageExtensions;
    use bevy_mod_scripting_core::config::ScriptingPluginConfiguration;

    #[test]
    fn loads_script_and_dispatches_callback() -> Result<(), Box<dyn std::error::Error>> {
        let world_id = WorldId::new()
            .ok_or_else(|| std::io::Error::other("failed to allocate a test world id"))?;
        let runtime = Box::leak(Box::new(QuickJsRuntime::default()));
        let extensions = Box::leak(Box::new(LanguageExtensions::new([(
            "js",
            QUICKJS_LANGUAGE,
        )])));
        QuickJsScriptingPlugin::set_world_local_config(
            world_id,
            ScriptingPluginConfiguration {
                pre_handling_callbacks: &[],
                context_initialization_callbacks: &[install_console],
                emit_responses: false,
                runtime,
                language_extensions: extensions,
            },
        );

        let attachment = ScriptAttachment::StaticScript(Default::default());
        let mut context = quickjs_context_load(
            &attachment,
            b"globalThis.on_update = (delta) => delta * 2;",
            world_id,
        )?;
        let result = quickjs_handler(
            vec![ScriptValue::Float(0.25)],
            &attachment,
            &CallbackLabel::from("on_update"),
            &mut context,
            world_id,
        )?;

        assert_eq!(result, ScriptValue::Float(0.5));
        Ok(())
    }
}
