use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use super::value::EcsValue;

pub(super) type ComponentMap = BTreeMap<String, EcsValue>;
pub(super) type ResourceMap = BTreeMap<String, EcsValue>;

#[derive(Debug)]
pub(super) enum EcsCommand {
    ClearWorld,
    SpawnEntity { id: String, components: ComponentMap },
    SetComponent { id: String, name: String, value: EcsValue },
    RemoveComponent { id: String, name: String },
    DespawnEntity {
        id: String,
    },
    SetResource { name: String, value: EcsValue },
    RemoveResource { name: String },
}

#[derive(Default)]
struct EcsSnapshot {
    entities: BTreeMap<String, ComponentMap>,
    resources: ResourceMap,
}

#[derive(Default)]
struct BridgeState {
    snapshot: EcsSnapshot,
    commands: Vec<EcsCommand>,
}

static BRIDGE_STATE: OnceLock<Mutex<BridgeState>> = OnceLock::new();

fn bridge_state() -> &'static Mutex<BridgeState> {
    BRIDGE_STATE.get_or_init(|| Mutex::new(BridgeState::default()))
}

fn lock_bridge() -> MutexGuard<'static, BridgeState> {
    bridge_state()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) fn reset_bridge() {
    *lock_bridge() = BridgeState::default();
}

pub(super) fn clear_world() {
    let mut bridge = lock_bridge();
    bridge.snapshot.entities.clear();
    bridge.commands.push(EcsCommand::ClearWorld);
}

pub(super) fn spawn_entity(id: String) {
    spawn_entity_bundle(id, ComponentMap::new());
}

pub(super) fn spawn_entity_bundle(id: String, components: ComponentMap) {
    let mut bridge = lock_bridge();
    bridge.snapshot.entities.insert(id.clone(), components.clone());
    bridge.commands.push(EcsCommand::SpawnEntity { id, components });
}

pub(super) fn entity_exists(id: &str) -> bool {
    lock_bridge().snapshot.entities.contains_key(id)
}

pub(super) fn despawn_entity(id: String) -> bool {
    let mut bridge = lock_bridge();
    if bridge.snapshot.entities.remove(&id).is_none() {
        return false;
    }
    bridge.commands.push(EcsCommand::DespawnEntity { id });
    true
}

pub(super) fn insert_component(id: &str, name: String, value: EcsValue) -> bool {
    let mut bridge = lock_bridge();
    let Some(components) = bridge.snapshot.entities.get_mut(id) else {
        return false;
    };
    components.insert(name.clone(), value.clone());
    bridge.commands.push(EcsCommand::SetComponent { id: id.to_owned(), name, value });
    true
}

pub(super) fn remove_component(id: &str, name: &str) -> bool {
    let mut bridge = lock_bridge();
    let Some(components) = bridge.snapshot.entities.get_mut(id) else {
        return false;
    };
    if components.remove(name).is_none() {
        return false;
    }
    bridge.commands.push(EcsCommand::RemoveComponent { id: id.to_owned(), name: name.to_owned() });
    true
}

pub(super) fn get_component(id: &str, name: &str) -> Option<EcsValue> {
    lock_bridge()
        .snapshot
        .entities
        .get(id)
        .and_then(|components| components.get(name))
        .cloned()
}

pub(super) fn has_component(id: &str, name: &str) -> bool {
    get_component(id, name).is_some()
}

pub(super) fn query_entities(required: &[String]) -> Vec<String> {
    query_entities_filtered(required, &[])
}

pub(super) fn query_entities_filtered(required: &[String], excluded: &[String]) -> Vec<String> {
    lock_bridge()
        .snapshot
        .entities
        .iter()
        .filter(|(_, components)| {
            required.iter().all(|name| components.contains_key(name))
                && excluded.iter().all(|name| !components.contains_key(name))
        })
        .map(|(id, _)| id.clone())
        .collect()
}

pub(super) fn set_resource(name: String, value: EcsValue) {
    let mut bridge = lock_bridge();
    bridge.snapshot.resources.insert(name.clone(), value.clone());
    bridge.commands.push(EcsCommand::SetResource { name, value });
}

pub(super) fn get_resource(name: &str) -> Option<EcsValue> {
    lock_bridge().snapshot.resources.get(name).cloned()
}

pub(super) fn remove_resource(name: &str) -> bool {
    let mut bridge = lock_bridge();
    if bridge.snapshot.resources.remove(name).is_none() {
        return false;
    }
    bridge.commands.push(EcsCommand::RemoveResource { name: name.to_owned() });
    true
}

pub(super) fn take_commands() -> Vec<EcsCommand> {
    std::mem::take(&mut lock_bridge().commands)
}
