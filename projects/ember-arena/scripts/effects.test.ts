import assert from "node:assert/strict";
import { test } from "node:test";
import { effectPriority, healingAmount, healingStep, oozeDamage } from "../modules/ember-arena/game/src/effects.js";
import { projectileImpact } from "../modules/ember-arena/game/src/projectiles.js";
import { cellKey, type DungeonFloor, type Terrain } from "../modules/ember-arena/game/src/dungeon.js";

// Source fixtures: v4.0.2 Healing, PotionOfHealing, Ooze, Actor/Blob and
// Ballistica.PROJECTILE at revision 57a4e06a. Advanced modifiers are excluded.
test("healing consumes a diminishing budget rather than instantly restoring maximum health", () => {
  assert.equal(healingAmount(20), 30); assert.equal(healingAmount(70), 70);
  let remaining = 30;
  const amounts: number[] = [];
  while (remaining > 0) { const amount = healingStep(remaining); amounts.push(amount); remaining -= amount; }
  assert.deepEqual(amounts, [8, 6, 4, 3, 2, 2, 1, 1, 1, 1, 1]);
  assert.equal(healingStep(0), 0);
});

test("ooze deals alternating sewer damage and one damage per tick in Goo's lair", () => {
  assert.deepEqual([20, 19, 18, 17].map((left) => oozeDamage(1, left)), [1, 0, 1, 0]);
  assert.deepEqual([20, 19, 18, 17].map((left) => oozeDamage(5, left)), [1, 1, 1, 1]);
  assert.equal(oozeDamage(6, 20), 2);
});

test("healing, fire blobs and normal buffs retain their distinct original priorities", () => {
  assert.equal(effectPriority("buff_healing"), -1);
  assert.equal(effectPriority("blob_fire"), -10);
  assert.equal(effectPriority("buff_burning"), -30);
  assert.equal(effectPriority("buff_invisibility"), -30);
  assert.equal(effectPriority("loot"), undefined);
  assert.equal(effectPriority("fire_cell"), undefined, "the field evolves as one blob, not independent cascading cell events");
});

function emptyFloor(): DungeonFloor {
  return { width: 9, height: 9, depth: 1, entrance: { x: 4, z: 4 }, exit: { x: 7, z: 7 }, rooms: [],
    tiles: Array<Terrain>(81).fill("floor"), explored: new Set(), visible: new Set() };
}

test("projectiles stop on a character or closed door, and before an empty solid wall", () => {
  const floor = emptyFloor(), from = floor.entrance, to = { x: 7, z: 4 };
  assert.deepEqual(projectileImpact(floor, from, to, () => false), to);
  assert.deepEqual(projectileImpact(floor, from, to, (p) => p.x === 5), { x: 5, z: 4 });
  floor.tiles[cellKey(floor, { x: 6, z: 4 })] = "wall";
  assert.deepEqual(projectileImpact(floor, from, to, () => false), { x: 5, z: 4 });
  floor.tiles[cellKey(floor, { x: 6, z: 4 })] = "door";
  assert.deepEqual(projectileImpact(floor, from, to, () => false), { x: 6, z: 4 });
  floor.tiles[cellKey(floor, { x: 6, z: 4 })] = "open_door";
  assert.deepEqual(projectileImpact(floor, from, to, () => false), to);
});

test("projectile major-axis tracing handles all octants and the source cell", () => {
  const floor = emptyFloor(), from = floor.entrance;
  for (const [dx, dz] of [[3, 1], [1, 3], [-3, 1], [-1, 3], [3, -1], [1, -3], [-3, -1], [-1, -3]]) {
    const to = { x: from.x + dx!, z: from.z + dz! };
    assert.deepEqual(projectileImpact(floor, from, to, () => false), to);
  }
  assert.deepEqual(projectileImpact(floor, from, from, () => false), from);
});
