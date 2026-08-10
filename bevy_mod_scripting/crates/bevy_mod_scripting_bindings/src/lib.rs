//! Abstractions to help with creating bindings between bevy and scripting languages.

pub mod allocator;
pub mod conversions;
pub mod docgen;
pub mod error;
pub mod function;
pub mod globals;
pub mod path;
pub mod query;
pub mod reference;
pub mod reflection_extensions;
#[cfg(feature = "script_systems")]
pub mod schedule;
#[cfg(not(feature = "script_systems"))]
mod schedule_disabled;
#[cfg(feature = "dynamic_components")]
pub mod script_component;
#[cfg(not(feature = "dynamic_components"))]
mod script_component_disabled;
pub mod script_value;
pub mod type_data;
pub mod world_extensions;

pub use allocator::*;
pub use docgen::*;
pub use error::*;
pub use function::*;
pub use globals::*;
// pub use pretty_print::*;
pub use bevy_mod_scripting_world::*;
pub use conversions::*;
pub use path::*;
pub use query::*;
pub use reference::*;
pub use reflection_extensions::*;
#[cfg(feature = "script_systems")]
pub use schedule::*;
#[cfg(not(feature = "script_systems"))]
pub use schedule_disabled::*;
#[cfg(feature = "dynamic_components")]
pub use script_component::*;
#[cfg(not(feature = "dynamic_components"))]
pub use script_component_disabled::AppScriptComponentRegistry;
#[cfg(not(feature = "dynamic_components"))]
pub(crate) use script_component_disabled::DynamicComponent;
pub use script_value::*;
pub use type_data::*;
pub use world_extensions::*;
