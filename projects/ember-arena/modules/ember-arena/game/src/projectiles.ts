import { passable, sameCell, terrainAt, type DungeonFloor } from "./dungeon.js";
import type { Point } from "./rules.js";
export type TargetKind = "flame" | "bow";

// First collision for Ballistica.PROJECTILE at revision 57a4e06a. Keep its
// integer half-error/major-axis rule, including a collision ON closed doors
// and BEFORE impassable terrain without a character. Full post-impact paths
// and non-projectile flag combinations are not needed by the potion thrower.
export function projectileImpact(floor: DungeonFloor, from: Point, to: Point, occupied: (point: Point) => boolean): Point {
  if (sameCell(from, to)) return { ...from };
  const dx = Math.abs(to.x - from.x), dz = Math.abs(to.z - from.z);
  const sx = to.x > from.x ? 1 : -1, sz = to.z > from.z ? 1 : -1;
  const majorX = dx > dz, major = Math.max(dx, dz), minor = Math.min(dx, dz);
  let error = Math.floor(major / 2), point = { ...from }, previous = { ...from };
  for (let step = 0; step <= major; step++) {
    if (!sameCell(point, from)) {
      const character = occupied(point), tile = terrainAt(floor, point);
      if (!passable(floor, point) && !character) return previous;
      if (tile === "wall" || tile === "secret_door" || tile === "door" || character || sameCell(point, to)) return point;
    }
    previous = { ...point };
    if (majorX) point.x += sx; else point.z += sz;
    error += minor;
    if (error >= major) {
      error -= major;
      if (majorX) point.z += sz; else point.x += sx;
    }
  }
  return previous;
}
