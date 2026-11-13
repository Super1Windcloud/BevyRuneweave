import assert from "node:assert/strict";
import { test } from "node:test";
import { SpriteMotion, stepSeconds } from "../modules/ember-arena/game/src/sprite-motion.js";

test("sprite presentation advances between grid steps and finishes exactly at its destination", () => {
  const motion = new SpriteMotion({ x: 0, y: 0 }, { x: 16, y: 0 });
  assert.deepEqual(motion.position, { x: 0, y: 0 });
  motion.advance(stepSeconds / 2);
  assert.deepEqual(motion.position, { x: 8, y: 0 });
  assert.equal(motion.finished, false);
  motion.advance(stepSeconds);
  assert.deepEqual(motion.position, { x: 16, y: 0 });
  assert.equal(motion.finished, true);
});

test("retargeting preserves the current visual point and intermediate corners", () => {
  const motion = new SpriteMotion({ x: 0, y: 0 }, { x: 16, y: 0 });
  motion.advance(stepSeconds / 4);
  motion.retarget({ x: 16, y: 16 });
  assert.deepEqual(motion.position, { x: 4, y: 0 });
  motion.advance(stepSeconds / 2);
  assert.deepEqual(motion.position, { x: 16, y: 0 });
  motion.advance(stepSeconds / 2);
  assert.deepEqual(motion.position, { x: 16, y: 16 });
});
