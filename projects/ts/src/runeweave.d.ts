type EcsValue = null | boolean | number | string | EcsValue[] | object;

declare function ecs_world_clear(): void;
declare function ecs_entity_spawn(id: string): void;
declare function ecs_entity_spawn_bundle(id: string, components: Record<string, EcsValue>): void;
declare function ecs_entity_exists(id: string): boolean;
declare function ecs_entity_despawn(id: string): boolean;
declare function ecs_component_insert(id: string, name: string, value: EcsValue): boolean;
declare function ecs_component_get(id: string, name: string): EcsValue | null;
declare function ecs_component_has(id: string, name: string): boolean;
declare function ecs_component_remove(id: string, name: string): boolean;
declare function ecs_query(requiredComponents: string[]): string[];
declare function ecs_query_filtered(
  requiredComponents: string[],
  excludedComponents: string[],
): string[];
declare function ecs_query_matching(
  requiredComponents: string[],
  anyComponents: string[],
  excludedComponents: string[],
): string[];
declare function ecs_resource_set(name: string, value: EcsValue): void;
declare function ecs_resource_get(name: string): EcsValue | null;
declare function ecs_resource_remove(name: string): boolean;
