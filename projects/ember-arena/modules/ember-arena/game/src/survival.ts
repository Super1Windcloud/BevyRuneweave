// Base, unmodified v4.0.2 Hunger/Regeneration/LockedFloor rules. Intermediate
// rounding follows Java floats as well as the reflected f32 component fields.
export const hungryAt = 300;
export const starvingAt = 450;
export const lockedFloorDuration = 50;

export interface HungerStep {
  level: number;
  partialDamage: number;
  damage: number;
  notice?: "hungry" | "starving";
}

function starvation(partialDamage: number, maxHealth: number, turns = 1): { partialDamage: number; damage: number } {
  const total = Math.fround(partialDamage + Math.fround(turns * Math.fround(maxHealth / 1000)));
  const damage = total > 1 ? Math.trunc(total) : 0; // Deliberately strict, as in Hunger.java.
  return { partialDamage: Math.fround(total - damage), damage };
}

export function hungerStep(level: number, partialDamage: number, maxHealth: number): HungerStep {
  if (level >= starvingAt) return { level, ...starvation(partialDamage, maxHealth) };
  const next = Math.min(starvingAt, Math.fround(level + 1));
  return { level: next, partialDamage, damage: next >= starvingAt ? 1 : 0,
    notice: next >= starvingAt ? "starving" : level < hungryAt && next >= hungryAt ? "hungry" : undefined };
}

// Food and intentional search change the level without resetting the existing
// starvation remainder or the independent hunger actor's next deadline.
export function affectHunger(level: number, partialDamage: number, energy: number, maxHealth: number): HungerStep {
  const changed = Math.fround(level - energy), next = Math.max(0, Math.min(starvingAt, changed));
  const overflow = changed > starvingAt ? starvation(partialDamage, maxHealth, Math.fround(changed - starvingAt))
    : { partialDamage, damage: 0 };
  const notice = level < hungryAt && next >= hungryAt ? "hungry"
    : level < starvingAt && next >= starvingAt ? "starving" : undefined;
  return { level: next, partialDamage: overflow.partialDamage,
    damage: overflow.damage + (notice === "starving" ? 1 : 0), notice };
}

export function regenerationStep(partial: number): { partial: number; healing: number } {
  const total = Math.fround(partial + Math.fround(1 / 10)), healing = Math.trunc(total);
  return { partial: Math.fround(total - healing), healing };
}

export const lockedFloorStep = (left: number): number => left >= 1 ? Math.fround(left - 1) : left;
export const extendLockedFloor = (left: number, damage: number): number => Math.min(lockedFloorDuration, Math.fround(left + Math.fround(damage * 1.5)));
