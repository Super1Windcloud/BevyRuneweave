//! Traits and types for managing script contexts.

use std::{any::Any, ops::Deref, sync::Arc};

use bevy_ecs::world::WorldId;
use bevy_mod_scripting_bindings::{InteropError, WorldExtensions};
use bevy_mod_scripting_script::ScriptAttachment;
use bevy_mod_scripting_world::WorldGuard;

use crate::IntoScriptPluginParams;

/// A trait that all script contexts must implement.
///
/// Contexts are not required to be `Sync` as they are internally stored behind a `Mutex` but they must satisfy `Send` so they can be
/// freely sent between threads.
pub trait Context: 'static + Send + Any {}
impl<T: 'static + Send + Any> Context for T {}

/// Initializer run once after creating a context but before executing it for the first time as well as after re-loading the script
pub struct ContextInitializer<P: IntoScriptPluginParams + ?Sized>(
    Arc<dyn Fn(&ScriptAttachment, &mut P::C) -> Result<(), InteropError> + Send + Sync + 'static>,
);

impl<P: IntoScriptPluginParams + ?Sized> ContextInitializer<P> {
    /// Wraps a context initializer function or capturing closure.
    pub fn new(
        initializer: impl Fn(&ScriptAttachment, &mut P::C) -> Result<(), InteropError>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self(Arc::new(initializer))
    }
}

impl<P: IntoScriptPluginParams + ?Sized> Clone for ContextInitializer<P> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<P: IntoScriptPluginParams + ?Sized> std::fmt::Debug for ContextInitializer<P> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ContextInitializer(..)")
    }
}

impl<P: IntoScriptPluginParams + ?Sized> Deref for ContextInitializer<P> {
    type Target = dyn Fn(&ScriptAttachment, &mut P::C) -> Result<(), InteropError> + Send + Sync;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}

/// Initializer run every time before executing or loading/re-loading a script
pub type ContextPreHandlingInitializer<P> =
    fn(&ScriptAttachment, &mut <P as IntoScriptPluginParams>::C) -> Result<(), InteropError>;

/// A strategy for loading contexts
pub type ContextLoadFn<P> = fn(
    attachment: &ScriptAttachment,
    content: &[u8],
    world_id: WorldId,
) -> Result<<P as IntoScriptPluginParams>::C, InteropError>;

/// A strategy for reloading contexts
pub type ContextReloadFn<P> = fn(
    attachment: &ScriptAttachment,
    content: &[u8],
    previous_context: &mut <P as IntoScriptPluginParams>::C,
    world_id: WorldId,
) -> Result<(), InteropError>;

/// A utility trait for types implementing `IntoScriptPluginParams`.
///
/// Provides methods for initializing and reloading script contexts using the plugin's context loader and reloader functions.
pub trait ScriptingLoader<P: IntoScriptPluginParams> {
    /// Loads a script context using the provided loader function
    fn load(
        attachment: &ScriptAttachment,
        content: &[u8],
        world: WorldGuard,
    ) -> Result<P::C, InteropError>;

    /// Reloads a script context using the provided reloader function
    fn reload(
        attachment: &ScriptAttachment,
        content: &[u8],
        previous_context: &mut P::C,
        world: WorldGuard,
    ) -> Result<(), InteropError>;
}

impl<P: IntoScriptPluginParams> ScriptingLoader<P> for P {
    fn load(
        attachment: &ScriptAttachment,
        content: &[u8],
        world: WorldGuard,
    ) -> Result<P::C, InteropError> {
        WorldGuard::with_existing_static_guard(world.clone(), |world| {
            world.set_current_attachment(attachment.clone());
            let world_id = world.id();
            Self::context_loader()(attachment, content, world_id)
        })
    }

    fn reload(
        attachment: &ScriptAttachment,
        content: &[u8],
        previous_context: &mut P::C,
        world: WorldGuard,
    ) -> Result<(), InteropError> {
        WorldGuard::with_existing_static_guard(world, |world| {
            world.set_current_attachment(attachment.clone());
            let world_id = world.id();
            Self::context_reloader()(attachment, content, previous_context, world_id)
        })
    }
}
