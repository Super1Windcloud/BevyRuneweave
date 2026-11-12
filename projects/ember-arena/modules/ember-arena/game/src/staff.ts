import { change, field } from "./actors.js";
import type { GearItem } from "./equipment.js";

// Base MagesStaff with an identified WandOfMagicMissile at revision 57a4e06a.
// Real ScriptActor: health = charges, power = partial charge, cooldown = tick.
// The ID links to the carried gear instance; equipment level supplies capacity.
export const staffChargerKind = "staff_charger";
export const staffChargeId = (gearId: number): string => `staff_charge:${gearId}`;
export const staffGearId = (id: string): number => Number(id.slice(id.indexOf(":") + 1));
export const staffCapacity = (level: number): number => Math.min(4 + level, 10);
export const staffDamageRange = (level: number): readonly [number, number] => [2 + level, 8 + 2 * level];
export function staffCharges(gearId: number): number {
  return scene_actor(staffChargeId(gearId)) ? field(staffChargeId(gearId), "health") : 0;
}
export function createStaffCharger(gear: GearItem, now: number): void {
  if (gear.kind !== "mages_staff" || scene_actor(staffChargeId(gear.id))) return;
  const id = staffChargeId(gear.id);
  if (!scene_spawn(id, 0, 0, -20) || !scene_actor_set(id, staffChargerKind, staffCapacity(gear.level), 0, 1)) throw new Error("Cannot create staff charger");
  change(id, "cooldown", Math.fround(now));
}
export function rechargeStaff(charges: number, partial: number, capacity: number, regenOn: boolean): { charges: number; partial: number } {
  if (charges < capacity && regenOn) {
    const delay = Math.fround(10 + 40 * Math.pow(0.75, Math.max(0, capacity - charges)));
    partial = Math.fround(partial + Math.fround(1 / delay));
  }
  while (partial >= 1 && charges < capacity) { charges++; partial = Math.fround(partial - 1); }
  return { charges, partial: charges === capacity ? 0 : partial };
}
export function upgradeStaffCharge(gear: GearItem): void {
  if (gear.kind === "mages_staff") change(staffChargeId(gear.id), "health", Math.min(staffCharges(gear.id) + 1, staffCapacity(gear.level)));
}
