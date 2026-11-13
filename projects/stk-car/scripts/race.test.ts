import assert from "node:assert/strict";
import test from "node:test";
import { TouchControls, type Layout } from "../modules/stk-car/game/src/controls.ts";
import { Circuit, Race, angleDelta, clamp, emptyControls, fixedStep, interpolate } from "../modules/stk-car/game/src/race.ts";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";

const circuit = new Circuit(trackData.route);
const start = (race: Race) => { race.start(); for (let i = 0; i < 361; i++) race.step(fixedStep, emptyControls()); };
function autopilot(race: Race) {
  const player = race.player;
  const target = circuit.sample(player.routeDistance + Math.max(5, player.speed * 0.35), -1);
  const heading = Math.atan2(target.x - player.x, -(target.z - player.z));
  const difference = angleDelta(heading - player.heading);
  return { ...emptyControls(), throttle: Math.abs(difference) > 0.4 && player.speed > 15 ? 0 : 1,
    steer: clamp(difference * 2.8, -1, 1), brake: Math.abs(difference) > 0.8 && player.speed > 12 };
}

test("the original Lighthouse driveline wraps, projects and preserves heights", () => {
  assert.equal(circuit.nodes.length, 115);
  assert.ok(circuit.length > 500 && circuit.length < 3000);
  for (let s = -5; s < circuit.length * 2; s += 5) {
    const pose = circuit.sample(s);
    const projected = circuit.project(pose.x, pose.z, pose.segment);
    const difference = Math.abs(circuit.wrap(projected.distance) - circuit.wrap(s));
    assert.ok(difference < 0.001 || Math.abs(difference - circuit.length) < 0.001);
    assert.ok(Math.abs(projected.y - pose.y) < 0.001);
  }
});
test("three full laps finish with ordered AI, lap splits and finite render poses", () => {
  const race = new Race(circuit, []);
  const initial = { ...race.player };
  race.step(fixedStep, { ...emptyControls(), throttle: 1 });
  assert.equal(race.player.x, initial.x);
  start(race);
  let ticks = 0;
  for (; ticks < 90000 && race.phase !== "finished"; ticks++) race.step(fixedStep, autopilot(race));
  assert.equal(race.phase, "finished", `progress=${race.player.progress}, length=${circuit.length}, offRoad=${race.player.offRoad}`);
  assert.equal(race.lapTimes.length, 3);
  assert.ok(Math.abs(race.lapTimes.reduce((sum, time) => sum + time, 0) - race.elapsed) < 0.0001);
  assert.ok(race.rank >= 1 && race.rank <= 4);
  assert.deepEqual(new Set(race.ranking.map((racer) => racer.id)), new Set(["tux", "comet", "pepper", "ocean"]));
  for (const racer of race.racers) assert.ok(Object.values(interpolate(racer, 0.5)).every(Number.isFinite));
});
test("nitro consumes a bounded reserve and pickup cooldown prevents repeated collection", () => {
  const race = new Race(circuit, [{ kind: "big-nitro", position: [0, 0, 0] }]);
  start(race);
  race.player.speed = 10;
  race.player.nitro = 0;
  race.pickups[0].position = [race.player.x, race.player.y, race.player.z];
  race.step(fixedStep, { ...emptyControls(), throttle: 1 });
  assert.equal(race.player.nitro, 28);
  assert.ok(race.pickups[0].cooldown > 6);
  race.step(fixedStep, { ...emptyControls(), throttle: 1, nitro: true });
  assert.ok(race.player.nitro < 28 && race.player.nitro > 27);
  race.player.nitro = 0.01;
  race.step(fixedStep, { ...emptyControls(), throttle: 1, nitro: true });
  assert.equal(race.player.nitro, 0);
});
test("rescue and reverse cannot award a lap; item activation consumes one item", () => {
  const race = new Race(circuit, []);
  start(race);
  race.player.x += 90;
  const progress = race.player.progress;
  race.rescue();
  assert.equal(race.player.progress, progress);
  assert.equal(race.player.speed, 0);
  for (const rival of race.racers.slice(1)) rival.routeDistance += 100;
  race.player.item = true;
  race.step(fixedStep, { ...emptyControls(), useItem: true });
  race.step(fixedStep, { ...emptyControls(), useItem: true });
  assert.equal(race.traps.length, 1);
  for (let i = 0; i < 100; i++) race.step(fixedStep, { ...emptyControls(), throttle: -1 });
  assert.ok(race.player.progress <= progress);
  assert.equal(race.lapTimes.length, 0);
});
test("simulation gives the same result at 30 and 120 render frames per second", () => {
  function run(fps: number): Race {
    const race = new Race(circuit, []); start(race);
    let accumulator = 0;
    for (let frame = 0; frame < fps * 12; frame++) {
      accumulator += 1 / fps;
      while (accumulator >= fixedStep) {
        race.step(fixedStep, autopilot(race));
        accumulator -= fixedStep;
      }
    }
    return race;
  }
  const a = run(30); const b = run(120);
  assert.ok(Math.abs(a.player.progress - b.player.progress) < 0.3);
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 0.01);
});
test("touch steering captures an ID while a second finger holds nitro; release clears steering", () => {
  const layout: Layout = { width: 1000, height: 600, left: 20, right: 20, top: 20, bottom: 20, stickX: 100, stickY: 500, radius: 60, controlSize: 64 };
  const touch = new TouchControls();
  const input = emptyControls();
  touch.apply(input, [{ id: "a", justPressed: true, x: 130, y: 500 }, { id: "b", justPressed: true, x: 880, y: 480 }], layout);
  assert.equal(input.steer, 0.5);
  assert.equal(input.throttle, 1);
  assert.equal(input.nitro, true);
  assert.equal(touch.stickId, "a");
  touch.apply(emptyControls(), [{ id: "a", justPressed: false, x: 400, y: 500 }], layout);
  assert.equal(touch.dx, 1);
  const released = emptyControls();
  touch.apply(released, [], layout);
  assert.equal(released.steer, 0);
  assert.equal(released.throttle, 0);
  assert.equal(touch.stickId, null);
});
