mod bindings;
mod command;
mod world;

use bevy::prelude::*;

pub(crate) use bindings::add_language;
use command::{dispatch_commands, reset_command_queue};

#[derive(Resource)]
struct EcsApiConfig {
    width: f32,
    height: f32,
}

#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct ApplyEcsCommands;

pub(crate) struct EcsApiPlugin {
    width: f32,
    height: f32,
}

impl EcsApiPlugin {
    pub(crate) const fn new(width: u32, height: u32) -> Self {
        Self {
            width: width as f32,
            height: height as f32,
        }
    }
}

impl Plugin for EcsApiPlugin {
    fn build(&self, app: &mut App) {
        reset_command_queue();
        app.insert_resource(EcsApiConfig {
            width: self.width,
            height: self.height,
        })
        .init_resource::<world::ScriptEntityRegistry>()
        .init_resource::<world::GameState>()
        .add_message::<command::EcsCommand>()
        .add_systems(Startup, world::setup_scene)
        .add_systems(
            Update,
            (
                dispatch_commands,
                world::apply_ecs_writes,
                ApplyDeferred,
                world::sync_sprite_components,
                world::sync_transform_components,
                world::sync_game_state,
            )
                .chain()
                .in_set(ApplyEcsCommands),
        );
    }
}
