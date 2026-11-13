import assert from "node:assert/strict";
import { test } from "node:test";
import { MobileControls, mobileLayout } from "../modules/ember-arena/game/src/mobile-controls.js";

const metrics = { width: 400, height: 180, scale: 2, left: 20, top: 10 };
const size = { x: 840, y: 380 };
const layout = mobileLayout(metrics);
function contact(id: string, x: number, y: number, justPressed = true): RuneweaveTouchContact {
  return { id, justPressed, x: (x * metrics.scale + metrics.left) / size.x, y: (y * metrics.scale + metrics.top) / size.y };
}

test("a joystick contact and a secondary skill contact keep independent ownership across redraws", () => {
  const controls = new MobileControls(), stick = layout.joystick, skill = layout.buttons.mobile_skill;
  controls.sample([contact("left", stick.x, stick.y)], metrics, size, true);
  const left = contact("left", stick.x + stick.radius * 0.7, stick.y, false);
  const right = contact("right", skill.x + skill.width / 2, skill.y + skill.height / 2);
  const pressed = controls.sample([left, right], metrics, size, true);
  assert.deepEqual(pressed.direction, { x: 1, y: 0 });
  assert.deepEqual(pressed.actions, ["mobile_skill"]);
  assert.equal(pressed.worldTap, null);
  const held = { ...right, justPressed: false };
  assert.deepEqual(controls.sample([left, held], metrics, size, true).actions, []);
  const released = controls.sample([held], metrics, size, true);
  assert.equal(released.engaged, false);
  assert.deepEqual(released.direction, { x: 0, y: 0 });
  assert.deepEqual(released.actions, []);
});

test("dead zone, eight directions and modal reset never turn captured fingers into ground taps", () => {
  const controls = new MobileControls(), stick = layout.joystick;
  const held = contact("left", stick.x, stick.y);
  controls.sample([held], metrics, size, true);
  assert.deepEqual(controls.sample([contact("left", stick.x + stick.radius * 0.1, stick.y, false)], metrics, size, true).direction, { x: 0, y: 0 });
  assert.deepEqual(controls.sample([contact("left", stick.x + stick.radius, stick.y - stick.radius, false)], metrics, size, true).direction, { x: 1, y: -1 });
  controls.reset([held]);
  assert.equal(controls.sample([held], metrics, size, false).consumed, true);
  const resumed = controls.sample([held], metrics, size, true);
  assert.equal(resumed.engaged, false);
  assert.equal(resumed.worldTap, null);
  controls.sample([], metrics, size, true);
  assert.equal(controls.sample([held], metrics, size, true).engaged, true);
  const attack = layout.buttons.mobile_attack;
  controls.reset();
  controls.sample([contact("right", attack.x + attack.width / 2, attack.y + attack.height / 2)], metrics, size, true);
  const dragged = controls.sample([contact("right", metrics.width / 2, metrics.height / 2, false)], metrics, size, true);
  assert.equal(dragged.consumed, true);
  assert.equal(dragged.worldTap, null);
  assert.deepEqual(dragged.actions, []);
});
