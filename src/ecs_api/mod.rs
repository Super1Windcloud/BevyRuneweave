//! Language-neutral ECS operations exposed consistently to every script runtime.

mod bindings;
mod command;
mod value;
mod world;

use bevy::prelude::*;

use command::reset_bridge;
pub use value::EcsValue;
pub use world::{ScriptComponents, ScriptEntityId, ScriptOwned, ScriptResources};

/// Applies script ECS mutations to the Bevy world.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ApplyEcsCommands;

/// Adds the common script-facing ECS state and synchronization systems.
pub struct RuneweaveEcsPlugin;

impl Plugin for RuneweaveEcsPlugin {
    fn build(&self, app: &mut App) {
        reset_bridge();
        bindings::add_language(app);
        app.init_resource::<world::ScriptEntityRegistry>()
            .init_resource::<ScriptResources>()
            .add_systems(
                Update,
                (world::apply_ecs_writes, ApplyDeferred)
                    .chain()
                    .in_set(ApplyEcsCommands),
            );
    }
}
