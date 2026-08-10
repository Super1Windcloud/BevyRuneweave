use std::{
    collections::BTreeSet,
    sync::{Arc, RwLock},
};

use bevy::prelude::*;

#[derive(Default)]
struct InputState {
    pressed: BTreeSet<String>,
    just_pressed: BTreeSet<String>,
    just_released: BTreeSet<String>,
}

#[derive(Resource, Clone, Default)]
pub(crate) struct ScriptInput(Arc<RwLock<InputState>>);

impl ScriptInput {
    pub(crate) fn update(&self, keyboard: &ButtonInput<KeyCode>) {
        let mut state = self
            .0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.pressed = keyboard
            .get_pressed()
            .map(|key| format!("{key:?}"))
            .collect();
        state.just_pressed = keyboard
            .get_just_pressed()
            .map(|key| format!("{key:?}"))
            .collect();
        state.just_released = keyboard
            .get_just_released()
            .map(|key| format!("{key:?}"))
            .collect();
    }

    pub(crate) fn pressed(&self, key: &str) -> bool {
        self.read(|state| state.pressed.contains(key))
    }

    pub(crate) fn just_pressed(&self, key: &str) -> bool {
        self.read(|state| state.just_pressed.contains(key))
    }

    pub(crate) fn just_released(&self, key: &str) -> bool {
        self.read(|state| state.just_released.contains(key))
    }

    fn read(&self, predicate: impl FnOnce(&InputState) -> bool) -> bool {
        let state = self
            .0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        predicate(&state)
    }
}
