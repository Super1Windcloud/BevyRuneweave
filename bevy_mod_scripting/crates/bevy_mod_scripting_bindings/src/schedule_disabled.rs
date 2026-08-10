//! Disabled schedule-registry placeholder used by the core world cache.

use bevy_ecs::resource::Resource;

/// Empty schedule registry used when the `script_systems` feature is disabled.
#[derive(Clone, Default, Resource)]
pub struct AppScheduleRegistry;
