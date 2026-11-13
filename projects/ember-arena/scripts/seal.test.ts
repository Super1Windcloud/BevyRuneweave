import assert from "node:assert/strict";
import { test } from "node:test";
import { sealMaximum, shieldDamage, shieldStep } from "../modules/ember-arena/game/src/seal.js";

test("seal shield uses armor tier, not its upgrade level", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(sealMaximum), [5, 7, 9, 11, 13]);
});

test("a positive hit at or crossing half health activates before shield absorption", () => {
  assert.deepEqual(shieldDamage(20, 20, 9, 0, 0, 5), { damage: 9, shield: 0, cooldown: 0, activated: false });
  assert.deepEqual(shieldDamage(20, 20, 10, 0, 0, 5), { damage: 5, shield: 0, cooldown: 150, activated: true });
  assert.deepEqual(shieldDamage(10, 20, 2, 0, 0, 5), { damage: 0, shield: 3, cooldown: 150, activated: true });
  assert.equal(shieldDamage(13, 25, 1, 0, 0, 5).activated, true, "integer half of odd maximum HP");
  assert.equal(shieldDamage(13, 25, 0, 0, 0, 5).activated, false);
  assert.equal(shieldDamage(11, 20, 1, 2, 0, 5).activated, false, "include existing shield in crossing threshold");
});

test("starvation bypasses both shield activation and absorption and cooldown prevents activation", () => {
  assert.deepEqual(shieldDamage(5, 20, 2, 3, 0, 5, true), { damage: 2, shield: 3, cooldown: 0, activated: false });
  assert.deepEqual(shieldDamage(5, 20, 2, 0, 1, 5), { damage: 2, shield: 0, cooldown: 1, activated: false });
  assert.deepEqual(shieldDamage(5, 20, 7, 3, 1, 5), { damage: 4, shield: 0, cooldown: 1, activated: false });
});

test("five ticks out of combat remove remaining shielding and refund its initial fraction", () => {
  let state = { shield: 3, cooldown: 150, absent: 0, detach: false };
  for (let tick = 0; tick < 5; tick++) state = shieldStep(state.shield, state.cooldown, state.absent, 5, false, true, 5);
  assert.deepEqual(state, { shield: 0, cooldown: 100, absent: 5, detach: false });
  assert.equal(shieldStep(5, 150, 4, 5, false, true, 5).cooldown, 74);
  assert.equal(shieldStep(3, 100, 4, 7, false, true, 7).cooldown, 66, "float refund is truncated after subtraction");
  assert.equal(shieldStep(3, 100, 4, 5, true, true, 5).absent, 0);
});

test("LockedFloor pauses positive cooldown but not out-of-combat decay or refund", () => {
  assert.deepEqual(shieldStep(3, 100, 4, 5, false, false, 5), { shield: 0, cooldown: 55, absent: 5, detach: false });
  assert.equal(shieldStep(0, 1, 0, 0, false, false, 5).cooldown, 1);
  assert.equal(shieldStep(0, 1, 0, 0, false, true, 0).detach, true);
  assert.equal(shieldStep(0, 0, 0, 0, false, true, 5).detach, false);
});
