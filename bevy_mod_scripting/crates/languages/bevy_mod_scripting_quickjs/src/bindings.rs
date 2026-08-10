use std::{any::TypeId, collections::VecDeque};

use bevy_asset::Handle;
use bevy_ecs::{entity::Entity, world::World};
use bevy_mod_scripting_asset::ScriptAsset;
use bevy_mod_scripting_bindings::{
    AppScriptGlobalsRegistry, DynamicScriptFunction, DynamicScriptFunctionMut, FunctionCallContext,
    InteropError, Namespace, PartialReflectExt, ReflectReference, ScriptValue, VariadicTuple,
    WorldExtensions,
};
use bevy_mod_scripting_display::OrFakeId;
use bevy_mod_scripting_script::ScriptAttachment;
use bevy_mod_scripting_world::ThreadWorldContainer;
use rquickjs::{
    Array, Class, Ctx, FromJs, Function, IntoJs, JsLifetime, Object, Type, Value, class::Trace,
    function::Rest,
};

use crate::{QUICKJS_LANGUAGE, QuickJsContext, interop_error};

const MAX_VALUE_DEPTH: usize = 64;

fn js_error(error: impl std::fmt::Debug) -> rquickjs::Error {
    rquickjs::Error::new_from_js_message("BMS", "QuickJS", format!("{error:?}"))
}

fn caller_context() -> FunctionCallContext {
    FunctionCallContext::new(QUICKJS_LANGUAGE)
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class(rename = "BmsReflectReference")]
pub(crate) struct JsReflectReference {
    #[qjs(skip_trace)]
    reference: ReflectReference,
}

#[rquickjs::methods]
impl JsReflectReference {
    pub fn get<'js>(&self, ctx: Ctx<'js>, key: Value<'js>) -> rquickjs::Result<Value<'js>> {
        let world = ThreadWorldContainer
            .try_get_context()
            .map_err(js_error)?
            .world;
        let key = js_to_script_value(&ctx, key, 0)?;
        let registry = world.script_function_registry();
        let registry = registry.read();
        let value = registry
            .magic_functions
            .get(caller_context(), self.reference.clone(), key)
            .map_err(js_error)?;
        script_value_to_js(&ctx, value, 0)
    }

    pub fn set<'js>(
        &self,
        ctx: Ctx<'js>,
        key: Value<'js>,
        value: Value<'js>,
    ) -> rquickjs::Result<()> {
        let world = ThreadWorldContainer
            .try_get_context()
            .map_err(js_error)?
            .world;
        let key = js_to_script_value(&ctx, key, 0)?;
        let value = js_to_script_value(&ctx, value, 0)?;
        let registry = world.script_function_registry();
        let registry = registry.read();
        registry
            .magic_functions
            .set(caller_context(), self.reference.clone(), key, value)
            .map_err(js_error)
    }

    pub fn call<'js>(
        &self,
        ctx: Ctx<'js>,
        name: String,
        args: Rest<Value<'js>>,
    ) -> rquickjs::Result<Value<'js>> {
        let world = ThreadWorldContainer
            .try_get_context()
            .map_err(js_error)?
            .world;
        let type_id = self
            .reference
            .tail_type_id(world.clone())
            .map_err(js_error)?
            .or_fake_id();
        let mut script_args = Vec::with_capacity(args.0.len() + 1);
        script_args.push(ScriptValue::Reference(self.reference.clone()));
        for value in args.0 {
            script_args.push(js_to_script_value(&ctx, value, 0)?);
        }
        let value = world
            .try_call_overloads(type_id, name, script_args, caller_context())
            .map_err(js_error)?;
        script_value_to_js(&ctx, value, 0)
    }
}

#[derive(Trace, JsLifetime)]
#[rquickjs::class(rename = "BmsStaticReflectReference")]
pub(crate) struct JsStaticReflectReference {
    #[qjs(skip_trace)]
    type_id: TypeId,
}

#[rquickjs::methods]
impl JsStaticReflectReference {
    pub fn call<'js>(
        &self,
        ctx: Ctx<'js>,
        name: String,
        args: Rest<Value<'js>>,
    ) -> rquickjs::Result<Value<'js>> {
        let world = ThreadWorldContainer
            .try_get_context()
            .map_err(js_error)?
            .world;
        let function = world
            .lookup_function([self.type_id], name)
            .map_err(js_error)?;
        let args = args
            .0
            .into_iter()
            .map(|value| js_to_script_value(&ctx, value, 0))
            .collect::<rquickjs::Result<Vec<_>>>()?;
        let value = function.call(args, caller_context()).map_err(js_error)?;
        script_value_to_js(&ctx, value, 0)
    }
}

fn function_to_js<'js>(
    ctx: &Ctx<'js>,
    function: DynamicScriptFunction,
) -> rquickjs::Result<Function<'js>> {
    Function::new(ctx.clone(), move |ctx: Ctx<'js>, args: Rest<Value<'js>>| {
        let args = args
            .0
            .into_iter()
            .map(|value| js_to_script_value(&ctx, value, 0))
            .collect::<rquickjs::Result<Vec<_>>>()?;
        let value = function.call(args, caller_context()).map_err(js_error)?;
        script_value_to_js(&ctx, value, 0)
    })
}

fn function_mut_to_js<'js>(
    ctx: &Ctx<'js>,
    function: DynamicScriptFunctionMut,
) -> rquickjs::Result<Function<'js>> {
    Function::new(ctx.clone(), move |ctx: Ctx<'js>, args: Rest<Value<'js>>| {
        let args = args
            .0
            .into_iter()
            .map(|value| js_to_script_value(&ctx, value, 0))
            .collect::<rquickjs::Result<Vec<_>>>()?;
        let value = function.call(args, caller_context()).map_err(js_error)?;
        script_value_to_js(&ctx, value, 0)
    })
}

fn script_value_to_js<'js>(
    ctx: &Ctx<'js>,
    value: ScriptValue,
    depth: usize,
) -> rquickjs::Result<Value<'js>> {
    if depth >= MAX_VALUE_DEPTH {
        return Err(js_error("ScriptValue nesting exceeds the supported depth"));
    }
    match value {
        ScriptValue::Unit => ().into_js(ctx),
        ScriptValue::Bool(value) => value.into_js(ctx),
        ScriptValue::Integer(value) => value.into_js(ctx),
        ScriptValue::Float(value) => value.into_js(ctx),
        ScriptValue::String(value) => value.as_ref().into_js(ctx),
        ScriptValue::List(values) | ScriptValue::Tuple(VariadicTuple(values)) => {
            let array = Array::new(ctx.clone())?;
            for (index, value) in values.into_iter().enumerate() {
                array.set(index, script_value_to_js(ctx, value, depth + 1)?)?;
            }
            array.into_js(ctx)
        }
        ScriptValue::Map(values) => {
            let object = Object::new(ctx.clone())?;
            for (key, value) in values {
                object.set(key, script_value_to_js(ctx, value, depth + 1)?)?;
            }
            object.into_js(ctx)
        }
        ScriptValue::Reference(reference) => {
            Class::instance(ctx.clone(), JsReflectReference { reference })?.into_js(ctx)
        }
        ScriptValue::Function(function) => function_to_js(ctx, function)?.into_js(ctx),
        ScriptValue::FunctionMut(function) => function_mut_to_js(ctx, function)?.into_js(ctx),
        ScriptValue::Error(error) => Err(js_error(error)),
    }
}

fn js_to_script_value<'js>(
    ctx: &Ctx<'js>,
    value: Value<'js>,
    depth: usize,
) -> rquickjs::Result<ScriptValue> {
    if depth >= MAX_VALUE_DEPTH {
        return Err(js_error(
            "QuickJS value nesting exceeds the supported depth",
        ));
    }
    if let Ok(reference) = Class::<JsReflectReference>::from_js(ctx, value.clone()) {
        return Ok(ScriptValue::Reference(reference.borrow().reference.clone()));
    }
    match value.type_of() {
        Type::Uninitialized | Type::Undefined | Type::Null => Ok(ScriptValue::Unit),
        Type::Bool => bool::from_js(ctx, value).map(ScriptValue::Bool),
        Type::Int => i32::from_js(ctx, value).map(|value| ScriptValue::Integer(value.into())),
        Type::Float => f64::from_js(ctx, value).map(ScriptValue::Float),
        Type::String => String::from_js(ctx, value).map(ScriptValue::from),
        Type::Array => {
            let array = Array::from_js(ctx, value)?;
            let mut values = VecDeque::with_capacity(array.len());
            for item in array.iter::<Value>() {
                values.push_back(js_to_script_value(ctx, item?, depth + 1)?);
            }
            Ok(ScriptValue::List(values))
        }
        Type::Object => {
            let object = Object::from_js(ctx, value)?;
            let mut values = bevy_platform::collections::HashMap::default();
            for item in object.props::<String, Value>() {
                let (key, value) = item?;
                values.insert(key, js_to_script_value(ctx, value, depth + 1)?);
            }
            Ok(ScriptValue::Map(values))
        }
        other => Err(rquickjs::Error::new_from_js_message(
            "QuickJS",
            "ScriptValue",
            format!("unsupported value type: {other}"),
        )),
    }
}

pub(crate) fn install_bms_globals(
    _attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    enum GlobalValue {
        Dynamic(ScriptValue),
        Static(TypeId),
    }

    let world = ThreadWorldContainer.try_get_context()?.world;
    let globals_registry =
        world.with_resource(|registry: &AppScriptGlobalsRegistry| registry.clone())?;
    let globals_registry = globals_registry.read();
    let mut registered_globals = Vec::new();
    for (name, global) in globals_registry.iter() {
        let value = match &global.maker {
            Some(maker) => GlobalValue::Dynamic((maker)(world.clone())?),
            None => GlobalValue::Static(global.type_id),
        };
        registered_globals.push((name.to_string(), value));
    }
    drop(globals_registry);

    let function_registry = world.script_function_registry();
    let function_registry = function_registry.read();
    let global_functions = function_registry
        .iter_all()
        .filter(|(key, _)| key.namespace == Namespace::Global)
        .map(|(key, function)| (key.name.to_string(), function.clone()))
        .collect::<Vec<_>>();
    drop(function_registry);

    context
        .with(|ctx| {
            let globals = ctx.globals();
            Class::<JsReflectReference>::define(&globals)?;
            Class::<JsStaticReflectReference>::define(&globals)?;
            globals.set(
                "world",
                Class::instance(
                    ctx.clone(),
                    JsStaticReflectReference {
                        type_id: TypeId::of::<World>(),
                    },
                )?,
            )?;
            for (name, value) in registered_globals {
                match value {
                    GlobalValue::Dynamic(value) => {
                        globals.set(name, script_value_to_js(&ctx, value, 0)?)?
                    }
                    GlobalValue::Static(type_id) => globals.set(
                        name,
                        Class::instance(ctx.clone(), JsStaticReflectReference { type_id })?,
                    )?,
                }
            }
            for (name, function) in global_functions {
                globals.set(name, function_to_js(&ctx, function)?)?;
            }
            Ok::<(), rquickjs::Error>(())
        })
        .map_err(interop_error)
}

pub(crate) fn install_attachment_globals(
    attachment: &ScriptAttachment,
    context: &mut QuickJsContext,
) -> Result<(), InteropError> {
    let world = ThreadWorldContainer.try_get_context()?.world;
    let entity = attachment
        .entity()
        .map(|entity| <Entity>::allocate(Box::new(entity), world.clone()));
    let script_asset = <Handle<ScriptAsset>>::allocate(Box::new(attachment.script()), world);
    context
        .with(|ctx| {
            let globals = ctx.globals();
            if let Some(reference) = entity {
                globals.set(
                    "entity",
                    Class::instance(ctx.clone(), JsReflectReference { reference })?,
                )?;
            }
            globals.set(
                "script_asset",
                Class::instance(
                    ctx.clone(),
                    JsReflectReference {
                        reference: script_asset,
                    },
                )?,
            )
        })
        .map_err(interop_error)
}
