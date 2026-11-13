import { field, kind } from "./actors.js";
import { type EnemyKind, type HeroClass, type Point } from "./rules.js";
import { SpriteMotion, type RenderPoint } from "./sprite-motion.js";

export const cellSize = 16;
export const mobSprites: Record<EnemyKind, string> = { chaser: "rat", ranger: "gnoll", charger: "crab", boss: "goo" };
const frameSizes: Record<string, readonly [number, number]> = {
  warrior: [12, 15], mage: [12, 15], rogue: [12, 15], huntress: [12, 15],
  rat: [16, 15], gnoll: [12, 15], crab: [16, 16], goo: [20, 14],
  fire: [4, 4],
};
const motions = new Map<string, SpriteMotion>();
const appearances = new Map<string, string>();
const visibility = new Map<string, boolean>();
const smoothSprites = typeof scene_set_sprite_offset === "function";

function worldPosition(id: string): RenderPoint {
  const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
  return { x: translation.get("x") as number, y: translation.get("y") as number };
}

export function renderedPosition(id: string): RenderPoint {
  const position = worldPosition(id), motion = motions.get(id);
  return motion && position.x === motion.target.x && position.y === motion.target.y ? motion.position : position;
}

export function settleSpriteMotion(): void {
  for (const id of motions.keys()) if (scene_transform(id)) scene_set_sprite_offset(id, 0, 0);
  motions.clear();
}

export function clearDungeonVisuals(): void {
  settleSpriteMotion(); appearances.clear(); visibility.clear();
}

export function advanceSpriteMotion(seconds: number): boolean {
  const moving = motions.size > 0;
  for (const [id, motion] of motions) {
    if (!scene_transform(id)) { motions.delete(id); continue; }
    const root = worldPosition(id);
    if (root.x !== motion.target.x || root.y !== motion.target.y) {
      scene_set_sprite_offset(id, 0, 0); motions.delete(id); continue;
    }
    motion.advance(seconds);
    const position = motion.position;
    scene_set_sprite_offset(id, position.x - root.x, position.y - root.y);
    if (motion.finished) motions.delete(id);
  }
  return moving;
}

export function actorCellAt(x: number, y: number, hero: HeroClass): Point | null {
  for (const id of ["player", ...monsterIds()]) {
    if (visibility.get(id) === false) continue;
    const name = id === "player" ? hero : mobSprites[kind(id) as EnemyKind];
    const [width, height] = frameSizes[name] ?? [16, 16], position = renderedPosition(id);
    if (Math.abs(x - position.x) <= Math.min(12, width / 2) && Math.abs(y - position.y) <= Math.min(12, height / 2)) return cellPosition(id);
  }
  return null;
}

export function cellPosition(id: string): Point {
  const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
  return { x: Math.round((translation.get("x") as number) / cellSize + 12),
    z: Math.round(12 - ((translation.get("y") as number) + 40) / cellSize) };
}

export function placeCell(id: string, point: Point, layer = 2, animate = false): void {
  const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
  const before = { x: translation.get("x") as number, y: translation.get("y") as number };
  const target = { x: (point.x - 12) * cellSize, y: (12 - point.z) * cellSize - 40 };
  if (translation.get("z") !== layer) translation.set("z", layer);
  if (before.x === target.x && before.y === target.y) return;
  const previous = motions.get(id);
  if (previous && (previous.target.x !== before.x || previous.target.y !== before.y)) motions.delete(id);
  const visibleBefore = renderedPosition(id);
  translation.set("x", target.x); translation.set("y", target.y);
  if (animate && smoothSprites && visibility.get(id) !== false) {
    let motion = motions.get(id);
    if (motion) motion.retarget(target);
    else { motion = new SpriteMotion(visibleBefore, target); motions.set(id, motion); }
    const position = motion.position;
    scene_set_sprite_offset(id, position.x - target.x, position.y - target.y);
  } else if (motions.delete(id)) scene_set_sprite_offset(id, 0, 0);
}

export function sprite(id: string, name: string, point: Point, layer = 0, factor = 1): void {
  const exists = !!scene_transform(id);
  if (!exists && !scene_spawn(id, 0, 0, layer)) throw new Error(`Could not create sprite ${id}`);
  const [width, height] = frameSizes[name] ?? [16, 16];
  const appearance = `${name}:${factor}`;
  if (!exists || appearances.get(id) !== appearance) {
    if (!scene_set_sprite(id, `sprites/dungeon/${name}.png`, cellSize * factor * width / 16, cellSize * factor * height / 16)) {
      throw new Error(`Could not set sprite ${id}`);
    }
    appearances.set(id, appearance);
  }
  placeCell(id, point, layer);
}

export function actorSprite(id: string, hero: HeroClass, visible = true): void {
  const type = kind(id);
  const name = type === "player" ? hero : mobSprites[type as EnemyKind];
  if (!name) return;
  sprite(id, name, cellPosition(id), 2);
  spriteVisibility(id, visible);
}

export function spriteVisibility(id: string, visible: boolean): void {
  if (!visible && motions.delete(id)) scene_set_sprite_offset(id, 0, 0);
  if (visibility.get(id) !== visible) {
    const scale = scene_transform(id)!.get("scale") as BmsReflectReference;
    for (const axis of ["x", "y"]) scale.set(axis, visible ? 1 : 0);
    visibility.set(id, visible);
  }
}

export function monsterIds(): string[] {
  return scene_actor_ids().filter((id) => kind(id) in mobSprites && field(id, "health") > 0);
}
