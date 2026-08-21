import type { SpriteSpec } from "../../api/scene.js";

export const DESIGN_WIDTH = 450;
export const DESIGN_HEIGHT = 800;
export const DESKTOP_WINDOW_WIDTH = 540;
export const DESKTOP_WINDOW_HEIGHT = 960;

export const sprites = {
  arena: { path: "sprites/royale/arena.png", width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
  towerBlue: { path: "sprites/royale/tower-blue.png", width: 86, height: 94 },
  towerRed: { path: "sprites/royale/tower-red.png", width: 86, height: 94 },
  cardFrame: { path: "sprites/royale/card-frame.png", width: 82, height: 100 },
  cardSelected: { path: "sprites/royale/card-selected.png", width: 82, height: 100 },
  elixirFull: { path: "sprites/royale/elixir-full.png", width: 31, height: 17 },
  elixirEmpty: { path: "sprites/royale/elixir-empty.png", width: 31, height: 17 },
  teamBlue: { path: "sprites/royale/team-blue.png", width: 26, height: 14 },
  teamRed: { path: "sprites/royale/team-red.png", width: 26, height: 14 },
  settingsIcon: { path: "sprites/settings-icon.png", width: 54, height: 54 },
  settingsPanel: { path: "sprites/settings-panel.png", width: 440, height: 320 },
  homeBackground: { path: "sprites/royale/home-bg.png", width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
  homeReference: { path: "sprites/royale/home-reference.png", width: DESIGN_WIDTH, height: 1_003 },
  homePlatform: { path: "sprites/royale/home-platform.png", width: 360, height: 260 },
  homeBattleButton: { path: "sprites/royale/home-battle-button.png", width: 310, height: 92 },
  homeResource: { path: "sprites/royale/home-resource.png", width: 136, height: 46 },
  homeDeck: { path: "sprites/royale/home-deck.png", width: 326, height: 82 },
  homeNav: { path: "sprites/royale/home-nav.png", width: DESIGN_WIDTH, height: 84 },
} satisfies Record<string, SpriteSpec>;

export interface UnitStats {
  hp: number;
  damage: number;
  speed: number;
  range: number;
  attackDelay: number;
  width: number;
  height: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
  art: SpriteSpec;
  unit: UnitStats;
}

export const cards: readonly CardDefinition[] = [
  {
    id: "knight",
    name: "KNIGHT",
    cost: 3,
    art: { path: "sprites/royale/knight.png", width: 74, height: 62 },
    unit: { hp: 430, damage: 70, speed: 47, range: 31, attackDelay: 0.95, width: 56, height: 48 },
  },
  {
    id: "archers",
    name: "ARCHERS",
    cost: 3,
    art: { path: "sprites/royale/archers.png", width: 74, height: 58 },
    unit: { hp: 255, damage: 52, speed: 44, range: 92, attackDelay: 1.05, width: 57, height: 45 },
  },
  {
    id: "giant",
    name: "GIANT",
    cost: 5,
    art: { path: "sprites/royale/giant.png", width: 76, height: 58 },
    unit: { hp: 760, damage: 94, speed: 28, range: 35, attackDelay: 1.25, width: 66, height: 50 },
  },
  {
    id: "goblins",
    name: "GOBLINS",
    cost: 2,
    art: { path: "sprites/royale/goblins.png", width: 68, height: 62 },
    unit: { hp: 210, damage: 46, speed: 61, range: 29, attackDelay: 0.72, width: 51, height: 47 },
  },
];
