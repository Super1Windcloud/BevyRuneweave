use std::sync::{Mutex, MutexGuard, OnceLock};

use bevy::prelude::*;

#[derive(Message, Debug)]
pub(super) enum EcsCommand {
    ClearWorld,
    SpawnEntity {
        id: String,
    },
    InsertSprite {
        id: String,
        kind: String,
    },
    SetTransform {
        id: String,
        x: f32,
        y: f32,
    },
    DespawnEntity {
        id: String,
    },
    SetGameState {
        score: i32,
        lives: i32,
        message: String,
    },
}

static COMMAND_QUEUE: OnceLock<Mutex<Vec<EcsCommand>>> = OnceLock::new();

fn command_queue() -> &'static Mutex<Vec<EcsCommand>> {
    COMMAND_QUEUE.get_or_init(|| Mutex::new(Vec::new()))
}

fn lock_command_queue() -> MutexGuard<'static, Vec<EcsCommand>> {
    command_queue()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) fn queue_command(command: EcsCommand) {
    lock_command_queue().push(command);
}

pub(super) fn reset_command_queue() {
    lock_command_queue().clear();
}

pub(super) fn dispatch_commands(mut commands: MessageWriter<EcsCommand>) {
    for command in std::mem::take(&mut *lock_command_queue()) {
        commands.write(command);
    }
}
