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
