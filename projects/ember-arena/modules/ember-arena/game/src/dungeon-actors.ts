import { field, kind } from "./actors.js";
import { type EnemyKind, type HeroClass, type Point } from "./rules.js";

export let cellSize = 22;
export const mobSprites: Record<EnemyKind, string> = { chaser: "rat", ranger: "gnoll", charger: "crab", boss: "goo" };
const frameSizes: Record<string, readonly [number, number]> = {
  warrior: [12, 15], mage: [12, 15], rogue: [12, 15], huntress: [12, 15],
  rat: [16, 15], gnoll: [12, 15], crab: [16, 16], goo: [20, 14],
};

export function cellPosition(id: string): Point {
  const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
  return { x: Math.round((translation.get("x") as number) / cellSize + 12),
    z: Math.round(12 - ((translation.get("y") as number) + 40) / cellSize) };
}

export function placeCell(id: string, point: Point, layer = 2): void {
  const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
  translation.set("x", (point.x - 12) * cellSize);
  translation.set("y", (12 - point.z) * cellSize - 40);
  translation.set("z", layer);
}

export function sprite(id: string, name: string, point: Point, layer = 0, factor = 1): void {
  if (!scene_transform(id) && !scene_spawn(id, 0, 0, layer)) throw new Error(`Could not create sprite ${id}`);
  const [width, height] = frameSizes[name] ?? [16, 16];
  if (!scene_set_sprite(id, `sprites/dungeon/${name}.png`, cellSize * factor * width / 16, cellSize * factor * height / 16)) {
    throw new Error(`Could not set sprite ${id}`);
  }
  placeCell(id, point, layer);
}

export function actorSprite(id: string, hero: HeroClass, visible = true): void {
  const type = kind(id);
  const name = type === "player" ? hero : mobSprites[type as EnemyKind];
  if (!name) return;
  sprite(id, name, cellPosition(id), 2);
  const scale = scene_transform(id)!.get("scale") as BmsReflectReference;
  for (const axis of ["x", "y"]) scale.set(axis, visible ? 1 : 0);
}

export function resizeGrid(size: number): void {
  if (size === cellSize) return;
  // Rescale the real transforms without caching another set of actor positions.
  const ratio = size / cellSize;
  for (const id of scene_actor_ids()) {
    if (kind(id) === "effect") { scene_despawn(id); continue; }
    const translation = scene_transform(id)!.get("translation") as BmsReflectReference;
    translation.set("x", (translation.get("x") as number) * ratio);
    translation.set("y", ((translation.get("y") as number) + 40) * ratio - 40);
  }
  cellSize = size;
}

export function monsterIds(): string[] {
  return scene_actor_ids().filter((id) => kind(id) in mobSprites && field(id, "health") > 0);
}
