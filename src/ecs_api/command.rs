use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex, MutexGuard},
};

use bevy::prelude::Resource;
use bevy_mod_scripting::script::ScriptAttachment;

use super::value::EcsValue;

pub(super) type ComponentMap = BTreeMap<String, EcsValue>;
pub(super) type ResourceMap = BTreeMap<String, EcsValue>;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) struct ScriptEntityKey {
    pub owner: String,
    pub id: String,
}

const MAX_KEY_LENGTH: usize = 128;

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_LENGTH && !key.chars().any(char::is_control)
}

#[derive(Default)]
struct EcsSnapshot {
    entities: BTreeMap<ScriptEntityKey, ComponentMap>,
    resources: ResourceMap,
}

#[derive(Default)]
struct BridgeState {
    snapshot: EcsSnapshot,
    dirty_entities: BTreeSet<ScriptEntityKey>,
    removed_entities: BTreeSet<ScriptEntityKey>,
    cleared_owners: BTreeSet<String>,
    resources_dirty: bool,
    owners: std::collections::HashMap<ScriptAttachment, String>,
    next_owner_id: u64,
}

/// App-local handle shared by script contexts and the Bevy synchronization system.
#[derive(Resource, Clone, Default)]
pub(super) struct EcsBridge {
    state: Arc<Mutex<BridgeState>>,
    owner: String,
}

pub(super) struct EcsChanges {
    pub cleared_owners: BTreeSet<String>,
    pub upsert_entities: BTreeMap<ScriptEntityKey, ComponentMap>,
    pub removed_entities: BTreeSet<ScriptEntityKey>,
    pub resources: Option<ResourceMap>,
}

impl EcsBridge {
    pub fn for_attachment(&self, attachment: &ScriptAttachment) -> Self {
        let owner = {
            let mut bridge = self.lock();
            if let Some(owner) = bridge.owners.get(attachment) {
                owner.clone()
            } else {
                bridge.next_owner_id += 1;
                let owner = format!("script-{}", bridge.next_owner_id);
                bridge.owners.insert(attachment.clone(), owner.clone());
                owner
            }
        };
        self.for_owner(owner)
    }

    pub fn for_owner(&self, owner: String) -> Self {
        Self {
            state: Arc::clone(&self.state),
            owner,
        }
    }

    fn key(&self, id: impl Into<String>) -> ScriptEntityKey {
        ScriptEntityKey {
            owner: self.owner.clone(),
            id: id.into(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, BridgeState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn clear_world(&self) {
        let mut bridge = self.lock();
        bridge
            .snapshot
            .entities
            .retain(|key, _| key.owner != self.owner);
        bridge.dirty_entities.retain(|key| key.owner != self.owner);
        bridge
            .removed_entities
            .retain(|key| key.owner != self.owner);
        bridge.cleared_owners.insert(self.owner.clone());
    }

    pub fn spawn_entity(&self, id: String) {
        self.spawn_entity_bundle(id, ComponentMap::new());
    }

    pub fn spawn_entity_bundle(&self, id: String, components: ComponentMap) {
        if !valid_key(&id) || components.keys().any(|name| !valid_key(name)) {
            return;
        }
        let mut bridge = self.lock();
        let key = self.key(id);
        bridge.snapshot.entities.insert(key.clone(), components);
        bridge.removed_entities.remove(&key);
        bridge.dirty_entities.insert(key);
    }

    pub fn entity_exists(&self, id: &str) -> bool {
        self.lock().snapshot.entities.contains_key(&self.key(id))
    }

    pub fn despawn_entity(&self, id: String) -> bool {
        let mut bridge = self.lock();
        let key = self.key(id);
        if bridge.snapshot.entities.remove(&key).is_none() {
            return false;
        }
        bridge.dirty_entities.remove(&key);
        bridge.removed_entities.insert(key);
        true
    }

    pub fn insert_component(&self, id: &str, name: String, value: EcsValue) -> bool {
        if !valid_key(id) || !valid_key(&name) {
            return false;
        }
        let mut bridge = self.lock();
        let key = self.key(id);
        let Some(components) = bridge.snapshot.entities.get_mut(&key) else {
            return false;
        };
        components.insert(name, value);
        bridge.dirty_entities.insert(key);
        true
    }

    pub fn remove_component(&self, id: &str, name: &str) -> bool {
        if !valid_key(id) || !valid_key(name) {
            return false;
        }
        let mut bridge = self.lock();
        let key = self.key(id);
        let Some(components) = bridge.snapshot.entities.get_mut(&key) else {
            return false;
        };
        if components.remove(name).is_none() {
            return false;
        }
        bridge.dirty_entities.insert(key);
        true
    }

    pub fn get_component(&self, id: &str, name: &str) -> Option<EcsValue> {
        self.lock()
            .snapshot
            .entities
            .get(&self.key(id))
            .and_then(|components| components.get(name))
            .cloned()
    }

    pub fn has_component(&self, id: &str, name: &str) -> bool {
        self.get_component(id, name).is_some()
    }

    pub fn query_entities(&self, required: &[String]) -> Vec<String> {
        self.query_entities_filtered(required, &[])
    }

    pub fn query_entities_filtered(&self, required: &[String], excluded: &[String]) -> Vec<String> {
        self.query_entities_matching(required, &[], excluded)
    }

    pub fn query_entities_matching(
        &self,
        required: &[String],
        any: &[String],
        excluded: &[String],
    ) -> Vec<String> {
        self.lock()
            .snapshot
            .entities
            .iter()
            .filter(|(_, components)| {
                required.iter().all(|name| components.contains_key(name))
                    && (any.is_empty() || any.iter().any(|name| components.contains_key(name)))
                    && excluded.iter().all(|name| !components.contains_key(name))
            })
            .filter(|(key, _)| key.owner == self.owner)
            .map(|(key, _)| key.id.clone())
            .collect()
    }

    pub fn set_resource(&self, name: String, value: EcsValue) {
        if !valid_key(&name) {
            return;
        }
        let mut bridge = self.lock();
        bridge.snapshot.resources.insert(name, value);
        bridge.resources_dirty = true;
    }

    pub fn get_resource(&self, name: &str) -> Option<EcsValue> {
        self.lock().snapshot.resources.get(name).cloned()
    }

    pub fn remove_resource(&self, name: &str) -> bool {
        if !valid_key(name) {
            return false;
        }
        let mut bridge = self.lock();
        if bridge.snapshot.resources.remove(name).is_none() {
            return false;
        }
        bridge.resources_dirty = true;
        true
    }

    pub fn take_changes(&self) -> EcsChanges {
        let mut bridge = self.lock();
        let dirty_entities = std::mem::take(&mut bridge.dirty_entities);
        let upsert_entities = dirty_entities
            .into_iter()
            .filter_map(|id| {
                bridge
                    .snapshot
                    .entities
                    .get(&id)
                    .cloned()
                    .map(|components| (id, components))
            })
            .collect();
        let resources = bridge
            .resources_dirty
            .then(|| bridge.snapshot.resources.clone());
        let changes = EcsChanges {
            cleared_owners: std::mem::take(&mut bridge.cleared_owners),
            upsert_entities,
            removed_entities: std::mem::take(&mut bridge.removed_entities),
            resources,
        };
        bridge.resources_dirty = false;
        changes
    }
}
