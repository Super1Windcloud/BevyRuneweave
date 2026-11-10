export interface Point { x: number; z: number }
export type EnemyKind = "chaser" | "ranger" | "charger" | "boss";
export const pillars: readonly Point[] = [{ x: -3, z: -1 }, { x: 3, z: 1 }, { x: 0, z: 3.5 }];
export const waveEnds = [40, 85, 130] as const;

export const enemySpecs: Record<EnemyKind, { model: string; health: number; speed: number; radius: number; scale: number }> = {
  chaser: { model: "Knight", health: 24, speed: 1.4, radius: 0.4, scale: 0.62 },
  ranger: { model: "Rogue_Hooded", health: 18, speed: 1.1, radius: 0.35, scale: 0.60 },
  charger: { model: "Barbarian", health: 40, speed: 1.7, radius: 0.45, scale: 0.68 },
  boss: { model: "Knight", health: 500, speed: 0.85, radius: 0.9, scale: 1.25 },
};

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
}

export function direction(a: Point, b: Point): Point {
  const length = distance(a, b);
  return length < 0.0001 ? { x: 0, z: 0 } : { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
}

export function constrain(point: Point, radius: number, halfWidth: number): Point {
  let x = clamp(point.x, -halfWidth + radius, halfWidth - radius);
  let z = clamp(point.z, -5.5 + radius, 5.5 - radius);
  for (const pillar of pillars) {
    const delta = direction(pillar, { x, z });
    const length = distance(pillar, { x, z });
    const minimum = radius + 0.8;
    if (length < minimum) {
      x = pillar.x + (length < 0.0001 ? 1 : delta.x) * minimum;
      z = pillar.z + delta.z * minimum;
    }
  }
  return { x: clamp(x, -halfWidth + radius, halfWidth - radius), z: clamp(z, -5.5 + radius, 5.5 - radius) };
}

export function segmentHits(start: Point, end: Point, target: Point, radius: number): boolean {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 0.00001 ? 0 : clamp(((target.x - start.x) * dx + (target.z - start.z) * dz) / lengthSquared, 0, 1);
  return distance({ x: start.x + dx * t, z: start.z + dz * t }, target) <= radius;
}

export function waveAt(elapsed: number): number {
  return waveEnds.filter((end) => elapsed >= end).length;
}

// ---------------------------------------------------------------------------
// Shattered Pixel Dungeon: Sewer Depths, Mobs, Hero Classes, Items & Mechanics
// ---------------------------------------------------------------------------

export type HeroClass = "warrior" | "mage" | "rogue" | "huntress";

export interface HeroClassSpec {
  id: HeroClass;
  name: string;
  title: string;
  model: string;
  splash: string;
  sprite: string;
  icon: string;
  description: string;
  baseHealth: number;
  baseSpeed: number;
  baseDamage: number;
  fireDelay: number;
  perks: string;
}

export const heroClasses: Record<HeroClass, HeroClassSpec> = {
  warrior: {
    id: "warrior",
    name: "WARRIOR",
    title: "Vanguard of the Sewers",
    model: "Knight",
    splash: "sprites/spd/warrior.jpg",
    sprite: "sprites/spd/warrior.png",
    icon: "sprites/spd/hero_icons.png",
    description: "Equipped with iron mail and a tempered blade. Sturdy and resilient in direct melee.",
    baseHealth: 100,
    baseSpeed: 3.7,
    baseDamage: 18,
    fireDelay: 0.48,
    perks: "+1 Potion of Healing, higher base strike power",
  },
  mage: {
    id: "mage",
    name: "MAGE",
    title: "Scholar of Arcana",
    model: "Mage",
    splash: "sprites/spd/mage.jpg",
    sprite: "sprites/spd/mage.png",
    icon: "sprites/spd/hero_icons.png",
    description: "Channels magic missile bolts from an ancient staff. Rapid ranged firepower.",
    baseHealth: 100,
    baseSpeed: 3.7,
    baseDamage: 16,
    fireDelay: 0.40,
    perks: "+1 Scroll of Upgrade, 16% faster wand casting",
  },
  rogue: {
    id: "rogue",
    name: "ROGUE",
    title: "Shadow Stalker",
    model: "Rogue_Hooded",
    splash: "sprites/spd/rogue.jpg",
    sprite: "sprites/spd/rogue.png",
    icon: "sprites/spd/hero_icons.png",
    description: "Shrouded in a cloak of shadows. Swift movement and deadly surprise attacks.",
    baseHealth: 100,
    baseSpeed: 4.1,
    baseDamage: 15,
    fireDelay: 0.46,
    perks: "+1 Potion of Invisibility, +10% move speed",
  },
  huntress: {
    id: "huntress",
    name: "HUNTRESS",
    title: "Seeker of the Slums",
    model: "Barbarian",
    splash: "sprites/spd/huntress.jpg",
    sprite: "sprites/spd/huntress.png",
    icon: "sprites/spd/hero_icons.png",
    description: "Armed with a spirit bow and fiery alchemy. Masters area damage.",
    baseHealth: 100,
    baseSpeed: 3.8,
    baseDamage: 19,
    fireDelay: 0.48,
    perks: "+1 Potion of Liquid Flame & Food Ration",
  },
};

export const heroClassList: readonly HeroClass[] = ["warrior", "mage", "rogue", "huntress"];

export interface DungeonMonsterInfo {
  name: string;
  depth: number;
  lore: string;
  drops: string;
  sprite: string;
}

export const dungeonMonsters: Record<EnemyKind, DungeonMonsterInfo> = {
  chaser: {
    name: "Marsupial Rat",
    depth: 1,
    lore: "Fast, scurrying pest native to the upper sewer conduits.",
    drops: "Dew Drops, Gold Coins, Mystery Meat",
    sprite: "sprites/spd/rat.png",
  },
  ranger: {
    name: "Gnoll Scout",
    depth: 2,
    lore: "Wild hyena scout slinging poisoned darts from afar.",
    drops: "Gold, Healing Potions, Darts",
    sprite: "sprites/spd/gnoll.png",
  },
  charger: {
    name: "Sewer Crab",
    depth: 3,
    lore: "Heavy chitin carapace charging with crushing claws.",
    drops: "Armor Plates, Dew Drops, Meat",
    sprite: "sprites/spd/crab.png",
  },
  boss: {
    name: "Goo (The Warden)",
    depth: 5,
    lore: "The colossal caustic slime ruling the sewer depths. Pumps itself up before explosive blasts!",
    drops: "Amulet of Yendor, 500 Gold",
    sprite: "sprites/spd/goo.png",
  },
};

export type ItemKind =
  | "potion_healing"
  | "potion_liquid_flame"
  | "potion_invisibility"
  | "potion_strength"
  | "scroll_upgrade"
  | "scroll_magic_mapping"
  | "food_ration";

export interface ItemDef {
  id: ItemKind;
  name: string;
  category: "potion" | "scroll" | "food";
  description: string;
  effectText: string;
  sprite: string;
}

export const itemCatalog: Record<ItemKind, ItemDef> = {
  potion_healing: {
    id: "potion_healing",
    name: "Potion of Healing",
    category: "potion",
    description: "Restores 45 Vitality and cures caustic ooze.",
    effectText: "A warm soothing energy flows through you (+45 HP).",
    sprite: "sprites/spd/items.png",
  },
  potion_liquid_flame: {
    id: "potion_liquid_flame",
    name: "Liquid Flame",
    category: "potion",
    description: "Hurls volatile fire that deals 35 damage to surrounding foes.",
    effectText: "The flask shatters into a roaring blaze (35 damage)! ",
    sprite: "sprites/spd/items.png",
  },
  potion_invisibility: {
    id: "potion_invisibility",
    name: "Potion of Invisibility",
    category: "potion",
    description: "Cloaks hero in shadows for 6s. Grants guaranteed surprise attacks.",
    effectText: "You vanish from enemy sight. Surprise attacks ready!",
    sprite: "sprites/spd/items.png",
  },
  potion_strength: {
    id: "potion_strength",
    name: "Potion of Strength",
    category: "potion",
    description: "Permanently enhances hero strike power by +4.",
    effectText: "Your muscles surge with power (+4 Base Damage)!",
    sprite: "sprites/spd/items.png",
  },
  scroll_upgrade: {
    id: "scroll_upgrade",
    name: "Scroll of Upgrade",
    category: "scroll",
    description: "Upgrades equipped gear (+8 Damage, +20 Max Vitality).",
    effectText: "Ancient runes infuse your weaponry (+8 DMG, +20 HP)!",
    sprite: "sprites/spd/items.png",
  },
  scroll_magic_mapping: {
    id: "scroll_magic_mapping",
    name: "Magic Mapping",
    category: "scroll",
    description: "Reveals the sewer currents and draws all crystals to you.",
    effectText: "The dungeon layout clears in your mind! Crystals magnetic!",
    sprite: "sprites/spd/items.png",
  },
  food_ration: {
    id: "food_ration",
    name: "Food Ration",
    category: "food",
    description: "Wholesome subterranean bread. Resets hunger and restores 15 HP.",
    effectText: "You feast on the ration. Hunger fully satisfied (+15 HP)!",
    sprite: "sprites/spd/items.png",
  },
};

export type HungerState = "satiated" | "hungry" | "starving";

export function getHungerStatus(hungerTime: number): HungerState {
  if (hungerTime < 60) return "satiated";
  if (hungerTime < 120) return "hungry";
  return "starving";
}

export function depthAtTime(elapsed: number): number {
  if (elapsed < 30) return 1;
  if (elapsed < 65) return 2;
  if (elapsed < 100) return 3;
  if (elapsed < 130) return 4;
  return 5;
}

export function depthTitle(depth: number): string {
  switch (depth) {
    case 1: return "DEPTH 1: SEWERS";
    case 2: return "DEPTH 2: DRAINAGE CANAL";
    case 3: return "DEPTH 3: FLOODED BASIN";
    case 4: return "DEPTH 4: SLIME VAULTS";
    case 5: default: return "DEPTH 5: GOO'S LAIR";
  }
}

export function isSurpriseStrike(
  heroPos: Point,
  targetPos: Point,
  isInvisible: boolean,
  obstaclePillars: readonly Point[] = pillars
): boolean {
  if (isInvisible) return true;
  for (const pillar of obstaclePillars) {
    if (distance(heroPos, pillar) < 1.4 && distance(targetPos, pillar) > 1.3) {
      return true;
    }
  }
  return false;
}
