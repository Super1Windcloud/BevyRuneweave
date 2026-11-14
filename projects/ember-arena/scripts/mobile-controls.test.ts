import assert from "node:assert/strict";
import { test } from "node:test";
import { MobileControls, mobileLayout } from "../modules/ember-arena/game/src/mobile-controls.js";

const metrics = { width: 400, height: 180, scale: 2, left: 20, top: 10 };
const size = { x: 840, y: 380 };
const layout = mobileLayout(metrics);
function contact(id: string, x: number, y: number, justPressed = true): RuneweaveTouchContact {
  return { id, justPressed, x: (x * metrics.scale + metrics.left) / size.x, y: (y * metrics.scale + metrics.top) / size.y };
}

test("the mobile layout has no joystick and keeps every action button on screen", () => {
  assert.equal("joystick" in layout, false);
  for (const rect of Object.values(layout.buttons)) {
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= metrics.width && rect.y + rect.height <= metrics.height);
  }
});

test("a ground tap moves while a secondary skill contact keeps independent ownership across redraws", () => {
  const controls = new MobileControls(), skill = layout.buttons.mobile_skill;
  const ground = controls.sample([contact("left", 40, 40)], metrics, size, true);
  assert.equal(ground.worldTap?.id, "left");
  assert.equal(ground.consumed, false);
  const left = contact("left", 40, 40, false);
  const right = contact("right", skill.x + skill.width / 2, skill.y + skill.height / 2);
  const pressed = controls.sample([left, right], metrics, size, true);
  assert.deepEqual(pressed.actions, ["mobile_skill"]);
  assert.equal(pressed.worldTap, null);
  const held = { ...right, justPressed: false };
  assert.deepEqual(controls.sample([left, held], metrics, size, true).actions, []);
  const released = controls.sample([left], metrics, size, true);
  assert.equal(released.consumed, false);
  assert.deepEqual(released.actions, []);
  assert.equal(released.worldTap, null);
});

test("modal reset and dragged buttons never turn captured fingers into ground taps", () => {
  const controls = new MobileControls();
  const held = contact("left", 40, 40);
  controls.reset([held]);
  assert.equal(controls.sample([held], metrics, size, false).consumed, true);
  const resumed = controls.sample([held], metrics, size, true);
  assert.equal(resumed.consumed, true);
  assert.equal(resumed.worldTap, null);
  controls.sample([], metrics, size, true);
  assert.equal(controls.sample([held], metrics, size, true).worldTap?.id, "left");
  const attack = layout.buttons.mobile_attack;
  controls.reset();
  controls.sample([contact("right", attack.x + attack.width / 2, attack.y + attack.height / 2)], metrics, size, true);
  const dragged = controls.sample([contact("right", metrics.width / 2, metrics.height / 2, false)], metrics, size, true);
  assert.equal(dragged.consumed, true);
  assert.equal(dragged.worldTap, null);
  assert.deepEqual(dragged.actions, []);
});
