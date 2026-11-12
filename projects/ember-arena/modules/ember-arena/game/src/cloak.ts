import { change, field } from "./actors.js";
import { buffId } from "./effects.js";

// Base CloakOfShadows/Artifact at 57a4e06a. Real item entity fields:
// health = charges, power = partial charge, lifetime = level, speed = XP,
// velocity_x = equipped, cooldown = passive tick. Active buff has its own clock.
export const cloakId = "artifact_cloak";
export const cloakKind = "cloak_recharge";
export const cloakBuffId = buffId("cloak", "player");
export const cloakImage = 240;
export const cloakCapacity = (level: number): number => Math.min(level + 3, 10);
export const cloakValue = (name: string): number => scene_actor(cloakId) ? field(cloakId, name) : 0;
export const cloakEquipped = (): boolean => cloakValue("velocity_x") === 1;
export const cloakActive = (): boolean => !!scene_actor(cloakBuffId);

export function createCloak(equipped: boolean, now: number): void {
  if (scene_actor(cloakId)) return;
  if (!scene_spawn(cloakId, 0, 0, -20) || !scene_actor_set(cloakId, cloakKind, 3, 0, 1)) throw new Error("Cannot create cloak");
  change(cloakId, "velocity_x", equipped ? 1 : 0); change(cloakId, "cooldown", now);
}
export function startCloak(now: number): void {
  if (!scene_spawn(cloakBuffId, 0, 0, -20) || !scene_actor_set(cloakBuffId, "buff_cloak", 0, 0, 1)) throw new Error("Cannot activate cloak");
  change(cloakBuffId, "cooldown", now);
}
export function stopCloak(dispel = false): void {
  if (dispel && cloakActive() && field(cloakBuffId, "health") <= 0 && cloakValue("health") > 0) change(cloakId, "health", cloakValue("health") - 1);
  scene_despawn(cloakBuffId);
}

export function cloakExperience(heroLevel: number, cloakLevel: number): number {
  const difference = heroLevel - (1 + cloakLevel * 2) - (cloakLevel >= 7 ? cloakLevel - 6 : 0);
  return Math.round(10 * Math.pow(difference >= 0 ? Math.fround(1.1) : 0.75, Math.abs(difference)));
}
export function cloakStealthStep(charges: number, level: number, experience: number, left: number, heroLevel: number): {
  charges: number; level: number; experience: number; left: number; active: boolean;
} {
  left--;
  if (left <= 0) {
    if (charges <= 0) return { charges: 0, level, experience, left: 0, active: false };
    charges--; experience += cloakExperience(heroLevel, level);
    if (level < 10 && experience >= (level + 1) * 50) { level++; experience -= level * 50; }
    left = 4;
  }
  return { charges, level, experience, left, active: true };
}
export function cloakRechargeStep(charges: number, partial: number, level: number, active: boolean, regenOn: boolean): { charges: number; partial: number } {
  const capacity = cloakCapacity(level);
  if (charges >= capacity) return { charges, partial: 0 };
  if (!active && regenOn) {
    const missing = Math.fround(capacity - charges + (level > 7 ? Math.fround(5 * (level - 7) / 3) : 0));
    const delay = Math.fround(45 - missing);
    partial = Math.fround(partial + Math.fround(1 / delay));
  }
  while (partial >= 1 && charges < capacity) { charges++; partial = Math.fround(partial - 1); }
  return { charges, partial: charges === capacity ? 0 : partial };
}
