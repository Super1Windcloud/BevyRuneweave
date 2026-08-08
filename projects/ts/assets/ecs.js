export function clearWorld() { ecs_world_clear(); }
export function spawnEntity(id) { ecs_entity_spawn(id); }
export function spawnEntityBundle(id, components) {
    ecs_entity_spawn_bundle(id, components);
}
export function entityExists(id) { return ecs_entity_exists(id); }
export function despawnEntity(id) { return ecs_entity_despawn(id); }
export function insertComponent(id, name, value) {
    return ecs_component_insert(id, name, value);
}
export function getComponent(id, name) {
    return ecs_component_get(id, name);
}
export function hasComponent(id, name) {
    return ecs_component_has(id, name);
}
export function removeComponent(id, name) {
    return ecs_component_remove(id, name);
}
export function queryEntities(requiredComponents) {
    return ecs_query(requiredComponents);
}
export function queryEntitiesFiltered(requiredComponents, excludedComponents) {
    return ecs_query_filtered(requiredComponents, excludedComponents);
}
export function queryEntitiesMatching(requiredComponents, anyComponents, excludedComponents) {
    return ecs_query_matching(requiredComponents, anyComponents, excludedComponents);
}
export function setResource(name, value) { ecs_resource_set(name, value); }
export function getResource(name) { return ecs_resource_get(name); }
export function removeResource(name) { return ecs_resource_remove(name); }
