import { change, field, kind } from "./actors.js";
import { cellKey, terrainAt, type DungeonFloor } from "./dungeon.js";
import { placeCell } from "./dungeon-actors.js";
import { timeAfter } from "./equipment.js";
import type { Point } from "./rules.js";
import { lockedFloorDuration } from "./survival.js";

// v4.0.2 Healing/Burning/Ooze/Invisibility and Fire. Effect state lives in
// real, script-owned Bevy entities accessed through the existing BMS registry.
// ScriptEntityId encodes the target relationship; no actor/status mirror is kept.
const buffKinds = ["healing", "burning", "ooze", "invisibility", "hunger", "regeneration", "locked_floor", "cloak", "warrior_shield"] as const;
export type BuffKind = typeof buffKinds[number];
export const fireRoot = "blob_fire";
export const buffId = (type: BuffKind, target: string): string => `buff_${type}:${target}`;
export const buffTarget = (id: string): string => id.slice(id.indexOf(":") + 1);
export function buffKind(tag: string): BuffKind | undefined {
  switch (tag) {
    case "buff_healing": return "healing";
    case "buff_burning": return "burning";
    case "buff_ooze": return "ooze";
    case "buff_invisibility": return "invisibility";
    case "buff_hunger": return "hunger";
    case "buff_regeneration": return "regeneration";
    case "buff_locked_floor": return "locked_floor";
    case "buff_cloak": return "cloak";
    case "buff_warrior_shield": return "warrior_shield";
    default: return undefined;
  }
}
export const hasBuff = (type: BuffKind, target: string): boolean => !!scene_actor(buffId(type, target));
export const remainingBuff = (type: BuffKind, target: string): number => hasBuff(type, target) ? field(buffId(type, target), "health") : 0;
export function removeBuffs(target: string): void {
  for (const type of buffKinds) scene_despawn(buffId(type, target));
}

// health = remaining healing/duration, power = heal rate or cached next burn
// damage, lifetime = acted flag, cooldown = next absolute action timestamp.
// Hunger uses health for level and power for partial damage; Regeneration uses
// power for partial healing. LockedFloor uses health for its remaining window.
function create(id: string, tag: string, remaining: number, now: number): void {
  if (!scene_spawn(id, 0, 0, -20) || !scene_actor_set(id, tag, remaining, 0, 1)) throw new Error(`Cannot create effect: ${id}`);
  change(id, "cooldown", Math.fround(now));
}
function ensureBuff(type: BuffKind, target: string, now: number): string {
  if (!scene_actor(target)) throw new Error(`Missing effect target: ${target}`);
  const id = buffId(type, target);
  if (!scene_actor(id)) create(id, `buff_${type}`, 0, now);
  return id;
}
export function healingAmount(maxHealth: number): number {
  return Math.trunc(Math.fround(Math.fround(Math.fround(0.8) * maxHealth) + 14));
}
export function healingStep(remaining: number, rate = 0.25): number {
  return remaining > 0 ? Math.min(remaining, Math.max(1, Math.round(remaining * rate))) : 0;
}
export function oozeDamage(depth: number, remaining: number): number {
  return depth > 5 ? 1 + Math.floor(depth / 5) : depth === 5 || Math.trunc(remaining) % 2 === 0 ? 1 : 0;
}
export function applyHealing(target: string, maxHealth: number, now: number): void {
  const id = ensureBuff("healing", target, now);
  change(id, "health", Math.max(field(id, "health"), healingAmount(maxHealth)));
  change(id, "power", Math.max(field(id, "power"), 0.25));
}
export function applyBurning(target: string, now: number): void {
  const id = ensureBuff("burning", target, now);
  change(id, "health", Math.max(field(id, "health"), 8)); change(id, "lifetime", 0);
}
export function applyOoze(target: string, now: number): void {
  const id = ensureBuff("ooze", target, now);
  change(id, "health", 20); change(id, "lifetime", 0);
}
export function applyInvisibility(target: string, now: number): void {
  const id = ensureBuff("invisibility", target, now);
  change(id, "health", 20);
  change(id, "cooldown", Math.max(field(id, "cooldown"), timeAfter(now, 20)));
}
export function startVitals(target: string, now: number): void {
  ensureBuff("regeneration", target, now); ensureBuff("hunger", target, now);
}
export function applyLockedFloor(target: string, now: number): void {
  if (!hasBuff("locked_floor", target)) change(ensureBuff("locked_floor", target, now), "health", lockedFloorDuration);
}
export function effectPriority(tag: string): number | undefined {
  if (tag === "buff_healing" || tag === "buff_regeneration") return -1;
  if (tag === "blob_fire") return -10;
  return buffKind(tag) ? -30 : undefined;
}
export function playerBuff(id: string): boolean { return buffKind(kind(id)) !== undefined && buffTarget(id) === "player"; }

export const fireId = (floor: DungeonFloor, point: Point): string => `fire_${floor.depth}_${cellKey(floor, point)}`;
export function fireVolume(floor: DungeonFloor, point: Point): number {
  const id = fireId(floor, point);
  return scene_actor(id) ? field(id, "health") : 0;
}
export function seedFireCell(floor: DungeonFloor, point: Point, volume: number, now: number): void {
  const id = fireId(floor, point);
  if (scene_actor(id)) change(id, "health", field(id, "health") + volume);
  else { create(id, "fire_cell", volume, now); placeCell(id, point, 2.5); }
  if (!scene_actor(fireRoot)) create(fireRoot, "blob_fire", 1, now);
}
export function seedLiquidFlame(floor: DungeonFloor, impact: Point, now: number): void {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const point = { x: impact.x + dx, z: impact.z + dz }, tile = terrainAt(floor, point);
    if (tile !== "wall" && tile !== "secret_door") seedFireCell(floor, point, 2, now);
  }
}
