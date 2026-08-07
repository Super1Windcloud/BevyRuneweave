//! Language-neutral ECS operations exposed consistently to every script runtime.

mod bindings;
mod command;
mod value;
mod world;

use bevy::prelude::*;
use bevy_mod_scripting::core::event::ScriptDetachedEvent;

use command::EcsBridge;
pub use value::EcsValue;
pub use world::{ScriptComponents, ScriptEntityId, ScriptOwned, ScriptOwnerId, ScriptResources};

/// Applies script ECS mutations to the Bevy world.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ApplyEcsCommands;

/// Adds the common script-facing ECS state and synchronization systems.
pub struct RuneweaveEcsPlugin;

impl Plugin for RuneweaveEcsPlugin {
    fn build(&self, app: &mut App) {
        let bridge = EcsBridge::default();
        bindings::add_language(app, bridge.clone());
        app.insert_resource(bridge)
            .init_resource::<world::ScriptEntityRegistry>()
            .init_resource::<ScriptResources>()
            .add_systems(
                Update,
                (
                    clear_detached_script_entities,
                    world::apply_ecs_writes,
                    ApplyDeferred,
                )
                    .chain()
                    .in_set(ApplyEcsCommands),
            );
    }
}

fn clear_detached_script_entities(
    bridge: Res<EcsBridge>,
    mut detached: MessageReader<ScriptDetachedEvent>,
) {
    for event in detached.read() {
        bridge.for_attachment(&event.0).clear_world();
    }
}
