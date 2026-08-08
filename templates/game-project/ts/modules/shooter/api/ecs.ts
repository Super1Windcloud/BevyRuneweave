export type EcsValue = null | boolean | number | string | EcsValue[] | object;

export function clearWorld(): void { ecs_world_clear(); }
export function spawnEntity(id: string): void { ecs_entity_spawn(id); }
export function spawnEntityBundle(id: string, components: Record<string, EcsValue>): void {
  ecs_entity_spawn_bundle(id, components);
}
export function entityExists(id: string): boolean { return ecs_entity_exists(id); }
export function despawnEntity(id: string): boolean { return ecs_entity_despawn(id); }
export function insertComponent(id: string, name: string, value: EcsValue): boolean {
  return ecs_component_insert(id, name, value);
}
export function getComponent(id: string, name: string): EcsValue | null {
  return ecs_component_get(id, name);
}
export function hasComponent(id: string, name: string): boolean {
  return ecs_component_has(id, name);
}
export function removeComponent(id: string, name: string): boolean {
  return ecs_component_remove(id, name);
}
export function queryEntities(requiredComponents: string[]): string[] {
  return ecs_query(requiredComponents);
}
export function queryEntitiesFiltered(requiredComponents: string[], excludedComponents: string[]): string[] {
  return ecs_query_filtered(requiredComponents, excludedComponents);
}
export function queryEntitiesMatching(
  requiredComponents: string[],
  anyComponents: string[],
  excludedComponents: string[],
): string[] {
  return ecs_query_matching(requiredComponents, anyComponents, excludedComponents);
}
export function setResource(name: string, value: EcsValue): void { ecs_resource_set(name, value); }
export function getResource(name: string): EcsValue | null { return ecs_resource_get(name); }
export function removeResource(name: string): boolean { return ecs_resource_remove(name); }
