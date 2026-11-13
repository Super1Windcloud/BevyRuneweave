import { change, field } from "./actors.js";
import { buffId } from "./effects.js";
import { gearDefinitions, type GearItem } from "./equipment.js";

// BrokenSeal, WarriorShield and Char.damage at 57a4e06a, without talents/glyphs.
// The real seal entity stores its attached armor id in power and level in lifetime.
// Shield buff: health = shielding, power = cooldown remaining, speed = turns
// without visible enemies, lifetime = initial shield, cooldown = actor deadline.
export const sealId = "item_seal";
export const shieldId = buffId("warrior_shield", "player");
export const sealImage = 50;
export const sealValue = (name: string): number => scene_actor(sealId) ? field(sealId, name) : 0;
export const shieldValue = (name: string): number => scene_actor(shieldId) ? field(shieldId, name) : 0;
export const sealArmor = (): number => sealValue("power");
export const sealMaximum = (tier: number): number => 3 + 2 * tier;
export function maximumShield(equipment: readonly GearItem[]): number {
  const armor = equipment.find((item) => item.id === sealArmor() && item.equipped && gearDefinitions[item.kind].slot === "armor");
  return armor ? sealMaximum(gearDefinitions[armor.kind].tier) : 0;
}
export function ensureWarriorShield(equipment: readonly GearItem[], now: number): void {
  if (maximumShield(equipment) <= 0 || scene_actor(shieldId)) return;
  if (!scene_spawn(shieldId, 0, 0, -20) || !scene_actor_set(shieldId, "buff_warrior_shield", 0, 0, 1)) throw new Error("Cannot create warrior shield");
  change(shieldId, "cooldown", now);
}
export function createSeal(armor: number, equipment: readonly GearItem[], now: number): void {
  if (scene_actor(sealId)) return;
  if (!scene_spawn(sealId, 0, 0, -20) || !scene_actor_set(sealId, "broken_seal", 1, 0, 1)) throw new Error("Cannot create seal");
  change(sealId, "power", armor); ensureWarriorShield(equipment, now);
}
export function detachSeal(equipment: readonly GearItem[]): void {
  const armor = equipment.find((item) => item.id === sealArmor());
  if (armor && sealValue("lifetime") > 0) armor.level--;
  change(sealId, "power", 0);
}
export function affixSeal(armor: GearItem, equipment: readonly GearItem[], now: number): void {
  if (gearDefinitions[armor.kind].slot !== "armor" || armor.id === sealArmor()) return;
  detachSeal(equipment);
  change(sealId, "power", armor.id);
  if (sealValue("lifetime") > 0) armor.level++;
  ensureWarriorShield(equipment, now);
}

export function shieldDamage(health: number, maxHealth: number, damage: number, shield: number, cooldown: number, capacity: number, hunger = false): {
  damage: number; shield: number; cooldown: number; activated: boolean;
} {
  const activated = !hunger && damage > 0 && cooldown <= 0
    && (health <= Math.floor(maxHealth / 2) || health + shield - damage <= Math.floor(maxHealth / 2));
  if (activated) { shield += capacity; cooldown = Math.max(0, cooldown + 150); }
  if (!hunger) { const absorbed = Math.min(shield, damage); shield -= absorbed; damage -= absorbed; }
  return { damage, shield, cooldown, activated };
}
export function shieldStep(shield: number, cooldown: number, absent: number, initial: number, enemiesVisible: boolean, regenOn: boolean, capacity: number): {
  shield: number; cooldown: number; absent: number; detach: boolean;
} {
  if (cooldown > 0 && regenOn) cooldown--;
  if (shield > 0) {
    absent = enemiesVisible ? 0 : Math.fround(absent + 1);
    if (absent >= 5) {
      if (cooldown > 0) {
        const percent = Math.fround(shield / initial);
        cooldown = Math.max(0, Math.trunc(Math.fround(cooldown - Math.fround(150 * Math.fround(percent / 2)))));
      }
      shield = 0;
    }
  }
  return { shield, cooldown, absent, detach: shield <= 0 && capacity <= 0 && cooldown === 0 };
}
