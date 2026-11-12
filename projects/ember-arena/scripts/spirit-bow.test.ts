import assert from "node:assert/strict";
import { test } from "node:test";
import { spiritBowAccuracy, spiritBowDamage, spiritBowDelay, spiritBowImage, spiritBowLevel, spiritBowRange, spiritBowStrength } from "../modules/ember-arena/game/src/spirit-bow.js";

test("spirit bow growth follows hero level rather than scroll upgrades", () => {
  assert.equal(spiritBowImage, 144);
  for (const [level, bowLevel, min, max, strength] of [[1, 0, 1, 6, 10], [4, 0, 1, 7, 10], [5, 1, 2, 8, 9],
    [10, 2, 3, 10, 9], [15, 3, 4, 12, 8], [30, 6, 7, 18, 7]]) {
    assert.equal(spiritBowLevel(level!), bowLevel); assert.deepEqual(spiritBowRange(level!), [min, max]);
    assert.equal(spiritBowStrength(level!), strength);
  }
});

test("arrows use the original adjacent penalty and ranged accuracy bonus with strength encumbrance", () => {
  assert.equal(spiritBowAccuracy(1, 10, 1), 5); assert.equal(spiritBowAccuracy(1, 10, 2), 15);
  assert.equal(spiritBowAccuracy(1, 8, 1), 2); assert.equal(spiritBowAccuracy(1, 8, 2), 7);
  assert.equal(spiritBowAccuracy(5, 9, 2), 21);
});

test("spirit arrows use bow damage plus excess strength without the equipped melee weapon", () => {
  assert.equal(spiritBowDamage(1, 10, (min) => min), 1);
  assert.equal(spiritBowDamage(1, 10, (_min, max) => max), 6);
  const ranges: number[][] = [];
  assert.equal(spiritBowDamage(5, 10, (min, max) => { ranges.push([min, max]); return max; }), 9);
  assert.deepEqual(ranges, [[2, 8], [0, 1]]);
});

test("shooting a target costs bow time while an empty shot costs one throw tick", () => {
  assert.equal(spiritBowDelay(1, 10, true), 1);
  assert.equal(spiritBowDelay(1, 8, true), Math.fround(1.44));
  assert.equal(spiritBowDelay(1, 8, false), 1);
  assert.equal(spiritBowDelay(5, 9, true), 1);
});
