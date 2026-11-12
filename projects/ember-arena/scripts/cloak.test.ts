import assert from "node:assert/strict";
import { test } from "node:test";
import { cloakCapacity, cloakExperience, cloakImage, cloakRechargeStep, cloakStealthStep } from "../modules/ember-arena/game/src/cloak.js";

test("the base cloak has three initial charges and a ten-charge cap", () => {
  assert.equal(cloakImage, 240);
  assert.deepEqual([0, 1, 7, 10].map(cloakCapacity), [3, 4, 10, 10]);
});

test("stealth pays immediately and each charge buys four action ticks including the last charge", () => {
  let state = { charges: 3, level: 0, experience: 0, left: 0, active: true };
  for (let tick = 0; tick <= 12; tick++) {
    state = cloakStealthStep(state.charges, state.level, state.experience, state.left, 1);
    assert.equal(state.active, tick < 12);
    assert.equal(state.charges, Math.max(0, 2 - Math.floor(tick / 4)));
  }
  assert.equal(state.experience, 30);
});

test("cloak use awards hero-relative experience and raises capacity without refilling it", () => {
  assert.equal(cloakExperience(1, 0), 10); assert.equal(cloakExperience(2, 0), 11);
  assert.equal(cloakExperience(1, 1), 6); assert.equal(cloakExperience(15, 7), 8);
  assert.deepEqual(cloakStealthStep(3, 0, 40, 0, 1), { charges: 2, level: 1, experience: 0, left: 4, active: true });
  assert.equal(cloakStealthStep(1, 10, 1000, 0, 30).level, 10);
});

test("inactive cloak recharge retains source float thresholds and scales at high levels", () => {
  for (const [missing, ticks] of [[1, 45], [2, 43], [3, 42]]) {
    let state = { charges: 3 - missing!, partial: 0 };
    for (let tick = 1; tick <= ticks!; tick++) {
      state = cloakRechargeStep(state.charges, state.partial, 0, false, true);
      assert.equal(state.charges, 3 - missing! + (tick === ticks ? 1 : 0));
    }
  }
  assert.ok(cloakRechargeStep(8, 0, 10, false, true).partial > cloakRechargeStep(8, 0, 7, false, true).partial);
});

test("active stealth and depleted boss windows freeze charging, while full charge clears its remainder", () => {
  assert.deepEqual(cloakRechargeStep(1, 0.5, 0, true, true), { charges: 1, partial: 0.5 });
  assert.deepEqual(cloakRechargeStep(1, 0.5, 0, false, false), { charges: 1, partial: 0.5 });
  assert.deepEqual(cloakRechargeStep(3, 0.5, 0, false, true), { charges: 3, partial: 0 });
});
