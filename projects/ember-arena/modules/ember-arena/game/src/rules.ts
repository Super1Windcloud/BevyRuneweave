import type { GearKind } from "./equipment.js";

export interface Point { x: number; z: number }
export type EnemyKind = "chaser" | "ranger" | "charger" | "boss";

export const enemySpecs: Record<EnemyKind, { model: string; health: number; speed: number; radius: number; scale: number }> = {
  chaser: { model: "spd_rat", health: 8, speed: 1, radius: 0.4, scale: 0.9 },
  ranger: { model: "spd_gnoll", health: 12, speed: 1, radius: 0.35, scale: 1.0 },
  charger: { model: "spd_crab", health: 15, speed: 2, radius: 0.45, scale: 1.0 },
  boss: { model: "spd_goo", health: 100, speed: 1, radius: 0.9, scale: 1.6 },
};

// Normal (no challenge modifiers) values from upstream Rat/Gnoll/Crab/Goo.java.
export const mobCombat: Record<EnemyKind, { attack: number; defense: number; minDamage: number; maxDamage: number; armor: number; experience: number; maxLevel: number }> = {
  chaser: { attack: 8, defense: 2, minDamage: 1, maxDamage: 4, armor: 1, experience: 1, maxLevel: 5 },
  ranger: { attack: 10, defense: 4, minDamage: 1, maxDamage: 6, armor: 2, experience: 2, maxLevel: 8 },
  charger: { attack: 12, defense: 5, minDamage: 1, maxDamage: 7, armor: 4, experience: 4, maxLevel: 9 },
  boss: { attack: 10, defense: 8, minDamage: 1, maxDamage: 8, armor: 2, experience: 10, maxLevel: 30 },
};

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 0x100000000; };
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
  perks: string;
}

export const heroClasses: Record<HeroClass, HeroClassSpec> = {
  warrior: {
    id: "warrior",
    name: "WARRIOR",
    title: "Vanguard of the Sewers",
    model: "Knight",
    splash: "sprites/spd/avatar_warrior.png",
    sprite: "sprites/spd/warrior.png",
    icon: "sprites/spd/hero_icons.png",
    description: "A sturdy melee fighter. Starts with a stronger blade and an extra healing potion.",
    baseHealth: 20,
    baseSpeed: 1,
    perks: "Worn shortsword / cloth armor / extra healing potion",
  },
  mage: {
    id: "mage",
    name: "MAGE",
    title: "Scholar of Arcana",
    model: "Mage",
    splash: "sprites/spd/avatar_mage.png",
    sprite: "sprites/spd/mage.png",
    icon: "sprites/spd/hero_icons.png",
    description: "A scholar carrying an ancient staff. Starts with an extra upgrade and mapping scroll.",
    baseHealth: 20,
    baseSpeed: 1,
    perks: "Mage's staff / cloth armor / magic mapping scroll",
  },
  rogue: {
    id: "rogue",
    name: "ROGUE",
    title: "Shadow Stalker",
    model: "Rogue_Hooded",
    splash: "sprites/spd/avatar_rogue.png",
    sprite: "sprites/spd/rogue.png",
    icon: "sprites/spd/hero_icons.png",
    description: "A stealthy fighter. Starts with an extra invisibility potion for surprise attacks.",
    baseHealth: 20,
    baseSpeed: 1,
    perks: "Dagger / cloth armor / extra invisibility potion",
  },
  huntress: {
    id: "huntress",
    name: "HUNTRESS",
    title: "Seeker of the Slums",
    model: "Barbarian",
    splash: "sprites/spd/avatar_huntress.png",
    sprite: "sprites/spd/huntress.png",
    icon: "sprites/spd/hero_icons.png",
    description: "A wilderness explorer carrying a spirit bow that grows with her level. Starts with extra food and liquid flame.",
    baseHealth: 20,
    baseSpeed: 1,
    perks: "Spirit bow / gloves / cloth armor / extra food ration",
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
    lore: "A sewer-dwelling gnoll scout that attacks in melee.",
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
    name: "Goo",
    depth: 5,
    lore: "The colossal caustic slime ruling the sewer depths. Pumps itself up before explosive blasts!",
    drops: "Worn Key and 2–4 blobs of goo",
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
  | "food_ration"
  | "spirit_bow";

export type LootKind = ItemKind | "worn_key" | "goo_blob" | GearKind;
// Stable indices stored in reflected ScriptActor.power, shared by spawning and pickup.
export const lootKinds: readonly LootKind[] = ["potion_healing", "potion_liquid_flame", "potion_invisibility",
  "potion_strength", "scroll_upgrade", "scroll_magic_mapping", "food_ration", "worn_key", "goo_blob",
  "worn_shortsword", "mages_staff", "dagger", "gloves", "shortsword", "cloth_armor", "leather_armor", "spirit_bow"];

export interface ItemDef {
  id: ItemKind;
  name: string;
  category: "potion" | "scroll" | "food" | "weapon";
  description: string;
  effectText: string;
  sprite: string;
}

export const itemCatalog: Record<ItemKind, ItemDef> = {
  potion_healing: {
    id: "potion_healing",
    name: "Potion of Healing",
    category: "potion",
    description: "Restores health over time. Ooze washes off in water. Costs 1 turn.",
    effectText: "A warm soothing energy flows through you.",
    sprite: "sprites/spd/items.png",
  },
  potion_liquid_flame: {
    id: "potion_liquid_flame",
    name: "Liquid Flame",
    category: "potion",
    description: "Throw to ignite a 3×3 area. Fire can burn you too. Costs 1 turn after targeting.",
    effectText: "The flask shatters into a roaring blaze!",
    sprite: "sprites/spd/items.png",
  },
  potion_invisibility: {
    id: "potion_invisibility",
    name: "Potion of Invisibility",
    category: "potion",
    description: "Cloaks the hero for 20 turns. Attacking breaks invisibility.",
    effectText: "You vanish from enemy sight. Surprise attacks ready!",
    sprite: "sprites/spd/items.png",
  },
  potion_strength: {
    id: "potion_strength",
    name: "Potion of Strength",
    category: "potion",
    description: "Permanently increases strength by 1. Costs 1 turn.",
    effectText: "Your muscles surge with power (+1 Strength)!",
    sprite: "sprites/spd/items.png",
  },
  scroll_upgrade: {
    id: "scroll_upgrade",
    name: "Scroll of Upgrade",
    category: "scroll",
    description: "Choose a carried weapon or armor to upgrade by 1. Costs 1 turn after selection.",
    effectText: "Ancient runes infuse the selected equipment (+1 upgrade)!",
    sprite: "sprites/spd/items.png",
  },
  scroll_magic_mapping: {
    id: "scroll_magic_mapping",
    name: "Magic Mapping",
    category: "scroll",
    description: "Reveals this floor's terrain, without revealing its inhabitants.",
    effectText: "The dungeon layout clears in your mind!",
    sprite: "sprites/spd/items.png",
  },
  food_ration: {
    id: "food_ration",
    name: "Food Ration",
    category: "food",
    description: "Satisfies 300 hunger. Eating takes 3 turns; it does not heal.",
    effectText: "You eat the ration. Your hunger subsides.",
    sprite: "sprites/spd/items.png",
  },
  spirit_bow: {
    id: "spirit_bow",
    name: "Spirit Bow",
    category: "weapon",
    description: "Fires unlimited spirit arrows and grows with hero level. Shooting does not replace your melee weapon. Cannot be upgraded with scrolls.",
    effectText: "The spirit arrow fades away.",
    sprite: "sprites/spd/items.png",
  },
};

export type HungerState = "satiated" | "hungry" | "starving";

export function getHungerStatus(hungerTime: number): HungerState {
  if (hungerTime < 300) return "satiated";
  if (hungerTime < 450) return "hungry";
  return "starving";
}
