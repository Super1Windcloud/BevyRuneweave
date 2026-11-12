import assert from "node:assert/strict";
import { test } from "node:test";
import { affectHunger, extendLockedFloor, hungerStep, lockedFloorStep, regenerationStep } from "../modules/ember-arena/game/src/survival.js";
import { effectPriority } from "../modules/ember-arena/game/src/effects.js";

test("hunger announces thresholds and clamps at starvation with one immediate damage", () => {
  assert.equal(hungerStep(299, 0, 20).notice, "hungry");
  assert.deepEqual(hungerStep(449, 0.25, 20), { level: 450, partialDamage: 0.25, damage: 1, notice: "starving" });
  assert.equal(hungerStep(450, 0, 20).level, 450);
});

test("starvation accumulates a float percentage of maximum health and uses a strict threshold", () => {
  assert.equal(hungerStep(450, 0, 1000).damage, 0, "a remainder exactly equal to one is retained");
  assert.equal(hungerStep(450, 1, 1000).damage, 2);
  for (const [maxHealth, firstDamageAt] of [[20, 51], [25, 41], [100, 10]] as const) {
    let partial = 0;
    for (let tick = 1; tick <= firstDamageAt; tick++) {
      const step = hungerStep(450, partial, maxHealth); partial = step.partialDamage;
      assert.equal(step.damage, tick === firstDamageAt ? 1 : 0);
    }
  }
});

test("food preserves starvation remainder and search converts excess hunger to damage", () => {
  assert.deepEqual(affectHunger(450, 0.5, 300, 20), { level: 150, partialDamage: 0.5, damage: 0, notice: undefined });
  assert.equal(affectHunger(10, 0, 300, 20).level, 0);
  assert.equal(affectHunger(448, 0, -4, 20).damage, 1);
  const searched = affectHunger(450, 1, -4, 20);
  assert.equal(searched.damage, 1); assert.ok(Math.abs(searched.partialDamage - 0.08) < 1e-6);
});

test("natural regeneration accumulates ten eligible ticks with Java float rounding", () => {
  let partial = 0;
  for (let tick = 1; tick <= 10; tick++) {
    const step = regenerationStep(partial); partial = step.partial;
    assert.equal(step.healing, tick === 10 ? 1 : 0);
  }
  assert.ok(partial > 0 && partial < 1e-6);
  assert.equal(effectPriority("buff_regeneration"), -1);
  assert.equal(effectPriority("buff_hunger"), -30);
  assert.equal(effectPriority("buff_locked_floor"), -30);
});

test("the normal boss window counts down without disappearing and damage restores at most fifty", () => {
  assert.equal(lockedFloorStep(50), 49); assert.equal(lockedFloorStep(0), 0);
  assert.equal(lockedFloorStep(1.5), 0.5); assert.equal(lockedFloorStep(-2), -2);
  assert.equal(extendLockedFloor(0, 3), 4.5);
  assert.equal(extendLockedFloor(49, 10), 50);
});
