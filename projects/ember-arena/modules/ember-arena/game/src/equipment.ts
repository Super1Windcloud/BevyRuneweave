import type { HeroClass } from "./rules.js";

// Normal, identified equipment rules from Shattered Pixel Dungeon v4.0.2,
// revision 57a4e06a: MeleeWeapon, Weapon, Armor and the named item classes.
// These are carried items, not an actor/component mirror. Actors stay in Bevy.
export type GearKind = "worn_shortsword" | "mages_staff" | "dagger" | "gloves" | "shortsword" | "cloth_armor" | "leather_armor";
export type GearSlot = "weapon" | "armor";
export interface GearItem { id: number; kind: GearKind; level: number; equipped: boolean }
export interface GearDefinition { slot: GearSlot; tier: number; image: number; maxBase: number; maxScaling: number; delay: number }
export const gearDefinitions: Record<GearKind, GearDefinition> = {
  worn_shortsword: { slot: "weapon", tier: 1, image: 96, maxBase: 10, maxScaling: 2, delay: 1 },
  mages_staff: { slot: "weapon", tier: 1, image: 101, maxBase: 6, maxScaling: 2, delay: 1 },
  dagger: { slot: "weapon", tier: 1, image: 100, maxBase: 8, maxScaling: 2, delay: 1 },
  gloves: { slot: "weapon", tier: 1, image: 98, maxBase: 5, maxScaling: 1, delay: 0.5 },
  shortsword: { slot: "weapon", tier: 2, image: 104, maxBase: 15, maxScaling: 3, delay: 1 },
  cloth_armor: { slot: "armor", tier: 1, image: 176, maxBase: 0, maxScaling: 0, delay: 1 },
  leather_armor: { slot: "armor", tier: 2, image: 177, maxBase: 0, maxScaling: 0, delay: 1 },
};
export const isGearKind = (value: string): value is GearKind => Object.hasOwn(gearDefinitions, value);
export function startingEquipment(hero: HeroClass): GearItem[] {
  const weapon: Record<HeroClass, GearKind> = { warrior: "worn_shortsword", mage: "mages_staff", rogue: "dagger", huntress: "gloves" };
  return [{ id: 1, kind: weapon[hero], level: 0, equipped: true }, { id: 2, kind: "cloth_armor", level: 0, equipped: true }];
}
export const equippedGear = (items: readonly GearItem[], slot: GearSlot): GearItem | undefined => items.find((item) => item.equipped && gearDefinitions[item.kind].slot === slot);
export function strengthRequired(item: GearItem): number {
  return 8 + gearDefinitions[item.kind].tier * 2 - Math.floor((Math.sqrt(8 * Math.max(0, item.level) + 1) - 1) / 2);
}
export function weaponRange(item: GearItem): readonly [number, number] {
  const spec = gearDefinitions[item.kind];
  return [spec.tier + item.level, spec.maxBase + spec.maxScaling * item.level];
}
export function armorRange(item: GearItem): readonly [number, number] {
  const max = gearDefinitions[item.kind].tier * (2 + item.level);
  return [item.level >= max ? item.level - max : item.level, item.level > max ? Math.floor((item.level - max + 1) / 2) : max];
}
export const strengthDeficit = (item: GearItem | undefined, strength: number): number => item ? Math.max(0, strengthRequired(item) - strength) : 0;
export function attackDelay(item: GearItem | undefined, strength: number): number {
  return (item ? gearDefinitions[item.kind].delay : 1) * Math.pow(1.2, strengthDeficit(item, strength));
}
export const moveDelay = (armor: GearItem | undefined, strength: number): number => Math.pow(1.2, strengthDeficit(armor, strength));
export const attackSkill = (weapon: GearItem | undefined, strength: number, level: number): number => Math.max(1, Math.round((9 + level) / Math.pow(1.5, strengthDeficit(weapon, strength))));
export const defenseSkill = (armor: GearItem | undefined, strength: number, level: number): number => Math.max(1, Math.round((4 + level) / Math.pow(1.5, strengthDeficit(armor, strength))));
export function weaponDamage(item: GearItem | undefined, strength: number, surprised: boolean, roll: (min: number, max: number) => number): number {
  if (!item) return roll(1, Math.max(strength - 8, 1));
  let [min, max] = weaponRange(item);
  if (item.kind === "dagger" && surprised) min += Math.round((max - min) * 0.75);
  return roll(min, max) + (strength > strengthRequired(item) ? roll(0, strength - strengthRequired(item)) : 0);
}
export function armorReduction(item: GearItem | undefined, strength: number, roll: (min: number, max: number) => number): number {
  if (!item) return 0;
  const [min, max] = armorRange(item);
  return Math.max(0, roll(min, max) - 2 * strengthDeficit(item, strength));
}

// Actor.time and Bevy ScriptActor.cooldown are both f32. Quantize before
// comparisons so reflection cannot change a timestamp after tie-breaking.
// Actor.spendConstant rounds times within .001 of a whole tick.
export function timeAfter(time: number, delay: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(delay) || delay <= 0) throw new Error("invalid action time");
  const next = Math.fround(Math.fround(time) + Math.fround(delay)), whole = Math.round(next);
  if (!Number.isFinite(next)) throw new Error("invalid action time");
  return Math.abs(next - whole) < 0.001 ? whole : next;
}
