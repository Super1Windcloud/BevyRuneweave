//! Disabled dynamic-component registry placeholder used by the world cache.

use bevy_ecs::{
    component::{Component, Mutable, StorageType},
    resource::Resource,
};
use bevy_reflect::Reflect;

/// Internal marker retained by generic component conversion code.
#[derive(Reflect)]
pub(crate) struct DynamicComponent;

impl Component for DynamicComponent {
    const STORAGE_TYPE: StorageType = StorageType::Table;
    type Mutability = Mutable;
}

/// Empty component registry used when `dynamic_components` is disabled.
#[derive(Clone, Default, Resource)]
pub struct AppScriptComponentRegistry;
