import assert from "node:assert/strict";
import { test } from "node:test";
import { rechargeStaff, staffCapacity, staffDamageRange } from "../modules/ember-arena/game/src/staff.js";
import { projectileImpact } from "../modules/ember-arena/game/src/projectiles.js";
import { cellKey, type DungeonFloor, type Terrain } from "../modules/ember-arena/game/src/dungeon.js";

test("magic missile staff starts with four charges and scales damage and capacity with item upgrades", () => {
  for (const [level, capacity, min, max] of [[0, 4, 2, 8], [1, 5, 3, 10], [6, 10, 8, 20], [10, 10, 12, 28]]) {
    assert.equal(staffCapacity(level!), capacity); assert.deepEqual(staffDamageRange(level!), [min, max]);
  }
});

test("staff recharge uses the missing-charge curve and Java float accumulation", () => {
  for (const [missing, ticks] of [[1, 41], [2, 33], [3, 27], [4, 23]]) {
    let current = { charges: 4 - missing!, partial: 0 };
    for (let tick = 1; tick <= ticks!; tick++) {
      current = rechargeStaff(current.charges, current.partial, 4, true);
      assert.equal(current.charges, 4 - missing! + (tick === ticks ? 1 : 0));
    }
  }
});

test("depleted passive windows freeze charging and a full staff clears excess charge", () => {
  assert.deepEqual(rechargeStaff(1, 0.75, 4, false), { charges: 1, partial: 0.75 });
  assert.deepEqual(rechargeStaff(4, 0.75, 4, true), { charges: 4, partial: 0 });
  assert.deepEqual(rechargeStaff(3, 1.25, 4, false), { charges: 4, partial: 0 });
});

function emptyFloor(): DungeonFloor {
  return { width: 9, height: 9, depth: 1, entrance: { x: 4, z: 4 }, exit: { x: 7, z: 7 }, rooms: [],
    tiles: Array<Terrain>(81).fill("floor"), explored: new Set(), visible: new Set() };
}

test("magic bolts continue past empty aim cells but stop at the first character or door", () => {
  const floor = emptyFloor(), from = floor.entrance, to = { x: 5, z: 4 };
  assert.deepEqual(projectileImpact(floor, from, to, (p) => p.x === 7), to);
  assert.deepEqual(projectileImpact(floor, from, to, (p) => p.x === 7, false), { x: 7, z: 4 });
  floor.tiles[cellKey(floor, { x: 6, z: 4 })] = "door";
  assert.deepEqual(projectileImpact(floor, from, to, () => false, false), { x: 6, z: 4 });
  floor.tiles[cellKey(floor, { x: 6, z: 4 })] = "wall";
  assert.deepEqual(projectileImpact(floor, from, to, () => false, false), { x: 5, z: 4 });
});

test("extended magic rays stop inside the map in every direction without wrapping rows", () => {
  const floor = emptyFloor(), from = floor.entrance;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    assert.deepEqual(projectileImpact(floor, from, { x: 4 + dx!, z: 4 + dz! }, () => false, false), { x: 4 + dx! * 4, z: 4 + dz! * 4 });
  }
});
