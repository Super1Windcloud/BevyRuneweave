import { enemySpecs, type EnemyKind, type Point } from "./rules.js";

// References are acquired inside the current script callback, never cached
// across reload/despawn. Bevy is the authoritative store for actor and position.
export function actor(id: string): BmsReflectReference {
  const reference = scene_actor(id);
  if (!reference) throw new Error(`Actor no longer exists: ${id}`);
  return reference;
}
export function field(id: string, key: string): number {
  return actor(id).get(key) as number;
}
export function change(id: string, key: string, value: number): void {
  actor(id).set(key, value);
}
export function kind(id: string): string { return actor(id).get("kind") as string; }
export function position(id: string): Point {
  const transform = scene_transform(id);
  if (!transform) throw new Error(`Entity no longer exists: ${id}`);
  const translation = transform.get("translation") as BmsReflectReference;
  return { x: translation.get("x") as number, z: translation.get("z") as number };
}
export function move(id: string, point: Point, rotation = 0): void {
  const transform = scene_transform(id);
  if (!transform) return;
  const translation = transform.get("translation") as BmsReflectReference;
  translation.set("x", point.x);
  translation.set("z", point.z);
  // Preserve scale and translation; only update the yaw quaternion by reflection.
  const quaternion = transform.get("rotation") as BmsReflectReference;
  quaternion.set("x", 0);
  quaternion.set("y", Math.sin(rotation / 2));
  quaternion.set("z", 0);
  quaternion.set("w", Math.cos(rotation / 2));
}
export function model(id: string, name: string, point: Point, scale = 1, y = 0, rotation = 0): void {
  if (!scene_spawn(id, point.x, y, point.z)
    || !scene_set_model(id, `models/${name}.glb`)
    || !scene_set_transform_3d(id, point.x, y, point.z, 0, rotation, 0, scale)) {
    throw new Error(`Could not create model: ${id}`);
  }
}
export function enemy(id: string, type: EnemyKind, point: Point): void {
  const spec = enemySpecs[type];
  model(id, spec.model, point, spec.scale);
  if (!scene_actor_set(id, type, spec.health, spec.speed, spec.radius)) throw new Error(`Could not create actor: ${id}`);
  scene_play_animation(id, `models/${spec.model}.glb`, true);
  change(id, "cooldown", 1.5);
}
