// Base SpiritBow/SpiritArrow, MissileWeapon, Weapon and Hero rules at 57a4e06a.
// Bow growth follows hero level; scroll upgrades and the equipped melee weapon
// do not affect it. Rings, talents, enchantments and sniper specials are pending.
export const spiritBowImage = 144; // ItemSpriteSheet.xy(1, 10), a 16x16 frame.
export const spiritBowLevel = (heroLevel: number): number => Math.floor(heroLevel / 5);
export const spiritBowRange = (heroLevel: number): readonly [number, number] =>
  [1 + Math.floor(heroLevel / 5), 6 + Math.trunc(Math.fround(heroLevel / 2.5))];
export const spiritBowStrength = (heroLevel: number): number =>
  10 - Math.floor((Math.sqrt(8 * spiritBowLevel(heroLevel) + 1) - 1) / 2);

export function spiritBowAccuracy(heroLevel: number, strength: number, distance: number): number {
  const encumbrance = Math.max(0, spiritBowStrength(heroLevel) - strength);
  const factor = Math.fround(Math.fround(1 / Math.pow(1.5, encumbrance)) * (distance <= 1 ? 0.5 : 1.5));
  return Math.max(1, Math.round(Math.fround((9 + heroLevel) * factor)));
}
export function spiritBowDelay(heroLevel: number, strength: number, hasTarget: boolean): number {
  // A missed attack still uses weapon delay; firing into empty terrain uses
  // Item.TIME_TO_THROW instead, as in MissileWeapon.castDelay.
  return hasTarget ? Math.fround(Math.pow(1.2, Math.max(0, spiritBowStrength(heroLevel) - strength))) : 1;
}
export function spiritBowDamage(heroLevel: number, strength: number, roll: (min: number, max: number) => number): number {
  const [min, max] = spiritBowRange(heroLevel), excess = strength - spiritBowStrength(heroLevel);
  return roll(min, max) + (excess > 0 ? roll(0, excess) : 0);
}
