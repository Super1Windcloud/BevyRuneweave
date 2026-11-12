import { seededRandom, type Point } from "./rules.js";

// Terrain and exploration metadata only. Actors and their positions remain in Bevy.
export type Terrain = "wall" | "floor" | "water" | "door" | "open_door" | "entrance" | "exit";
export interface DungeonFloor {
  width: number;
  height: number;
  depth: number;
  tiles: Terrain[];
  entrance: Point;
  exit: Point;
  rooms: Point[];
  explored: Set<number>;
  visible: Set<number>;
}

export const cellKey = (floor: DungeonFloor, point: Point): number => point.z * floor.width + point.x;
export const sameCell = (a: Point, b: Point): boolean => a.x === b.x && a.z === b.z;
export const cellDistance = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export function terrainAt(floor: DungeonFloor, point: Point): Terrain {
  if (point.x < 0 || point.z < 0 || point.x >= floor.width || point.z >= floor.height) return "wall";
  return floor.tiles[cellKey(floor, point)]!;
}
export const passable = (floor: DungeonFloor, point: Point): boolean => terrainAt(floor, point) !== "wall";
export const opaque = (floor: DungeonFloor, point: Point): boolean => ["wall", "door"].includes(terrainAt(floor, point));

export function canStep(floor: DungeonFloor, from: Point, to: Point): boolean {
  if (cellDistance(from, to) !== 1 || !passable(floor, to)) return false;
  // A diagonal cannot squeeze through two touching walls/closed doors.
  return from.x === to.x || from.z === to.z
    || (!opaque(floor, { x: from.x, z: to.z }) && !opaque(floor, { x: to.x, z: from.z }));
}

export function generateFloor(seed: number, depth: number): DungeonFloor {
  const random = seededRandom((seed ^ Math.imul(depth, 0x9e3779b9)) >>> 0);
  const width = 25;
  const floor: DungeonFloor = {
    width, height: width, depth, tiles: Array<Terrain>(width * width).fill("wall"),
    entrance: { x: 12, z: 12 }, exit: { x: 4, z: 4 }, rooms: [], explored: new Set(), visible: new Set(),
  };
  const bounds: { left: number; right: number; top: number; bottom: number }[] = [];
  const set = (point: Point, tile: Terrain): void => { floor.tiles[cellKey(floor, point)] = tile; };
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const center = { x: 4 + column * 8, z: 4 + row * 8 };
    floor.rooms.push(center);
    const left = center.x - 2, top = center.z - 2;
    const right = center.x + 1 + Math.floor(random() * 2), bottom = center.z + 1 + Math.floor(random() * 2);
    bounds.push({ left, right, top, bottom });
    for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++) {
      set({ x, z }, random() < 0.1 ? "water" : "floor");
    }
  }
  // Randomized spanning tree: all nine rooms and the stairs are always reachable.
  const visited = new Set([4]);
  const connections: [number, number][] = [];
  while (visited.size < 9) {
    const edges: [number, number][] = [];
    for (const room of visited) for (const next of [room - 3, room + 3, room - 1, room + 1]) {
      if (next < 0 || next >= 9 || visited.has(next)) continue;
      if (Math.abs(next - room) === 1 && Math.floor(next / 3) !== Math.floor(room / 3)) continue;
      edges.push([room, next]);
    }
    const edge = edges[Math.floor(random() * edges.length)]!;
    connections.push(edge); visited.add(edge[1]);
  }
  for (const [a, b] of connections) {
    const start = floor.rooms[a]!, end = floor.rooms[b]!;
    const dx = Math.sign(end.x - start.x), dz = Math.sign(end.z - start.z);
    for (let point = { ...start }; !sameCell(point, end); point = { x: point.x + dx, z: point.z + dz }) {
      if (terrainAt(floor, point) === "wall") set(point, "floor");
    }
    for (const index of [a, b]) {
      const room = floor.rooms[index]!, box = bounds[index]!;
      const toward = index === a ? end : start;
      const door = room.x === toward.x
        ? { x: room.x, z: toward.z < room.z ? box.top - 1 : box.bottom + 1 }
        : { x: toward.x < room.x ? box.left - 1 : box.right + 1, z: room.z };
      set(door, "door");
    }
  }
  let longest = -1;
  for (const room of floor.rooms) {
    const path = findPath(floor, floor.entrance, room);
    if (path.length > longest) { longest = path.length; floor.exit = { ...room }; }
  }
  set(floor.entrance, "entrance"); set(floor.exit, "exit");
  // Keep the opening move and starting room safe and dry.
  set({ x: floor.entrance.x + 1, z: floor.entrance.z }, "floor");
  return floor;
}

export function findPath(floor: DungeonFloor, start: Point, end: Point, blocked: ReadonlySet<number> = new Set(), knownOnly = false): Point[] {
  if (!passable(floor, start) || !passable(floor, end) || sameCell(start, end)) return [];
  const startKey = cellKey(floor, start), endKey = cellKey(floor, end);
  const previous = new Map<number, number>([[startKey, -1]]);
  const queue = [startKey];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor]!, point = { x: key % floor.width, z: Math.floor(key / floor.width) };
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const next = { x: point.x + dx!, z: point.z + dz! }, nextKey = cellKey(floor, next);
      if (!canStep(floor, point, next) || previous.has(nextKey) || blocked.has(nextKey)
        || (knownOnly && !floor.explored.has(nextKey))) continue;
      previous.set(nextKey, key);
      if (nextKey === endKey) {
        const path: Point[] = [];
        for (let current = endKey; current !== startKey; current = previous.get(current)!) {
          path.unshift({ x: current % floor.width, z: Math.floor(current / floor.width) });
        }
        return path;
      }
      queue.push(nextKey);
    }
  }
  return [];
}

export function lineOfSight(floor: DungeonFloor, start: Point, end: Point): boolean {
  let x = start.x, z = start.z;
  const dx = Math.abs(end.x - x), dz = Math.abs(end.z - z), sx = Math.sign(end.x - x), sz = Math.sign(end.z - z);
  let error = dx - dz;
  while (x !== end.x || z !== end.z) {
    const twice = error * 2;
    const previous = { x, z };
    if (twice > -dz) { error -= dz; x += sx; }
    if (twice < dx) { error += dx; z += sz; }
    if (x !== previous.x && z !== previous.z
      && opaque(floor, { x, z: previous.z }) && opaque(floor, { x: previous.x, z })) return false;
    if (x === end.x && z === end.z) return true; // An opaque target itself is visible.
    if (opaque(floor, { x, z })) return false;
  }
  return true;
}

export function reveal(floor: DungeonFloor, origin: Point, radius = 7): void {
  floor.visible.clear();
  for (let z = Math.max(0, origin.z - radius); z <= Math.min(floor.height - 1, origin.z + radius); z++) {
    for (let x = Math.max(0, origin.x - radius); x <= Math.min(floor.width - 1, origin.x + radius); x++) {
      if (Math.hypot(x - origin.x, z - origin.z) > radius || !lineOfSight(floor, origin, { x, z })) continue;
      const key = cellKey(floor, { x, z }); floor.visible.add(key); floor.explored.add(key);
    }
  }
}
