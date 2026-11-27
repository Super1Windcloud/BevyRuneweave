import assert from "node:assert/strict";
import test from "node:test";
import { kartBodies } from "../modules/stk-car/game/src/kart-bodies.ts";
import { kartContact, resolveKartContacts } from "../modules/stk-car/game/src/kart-collision.ts";
import { Circuit, Race, emptyControls, fixedStep, type Racer } from "../modules/stk-car/game/src/race.ts";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";
import { courses } from "../modules/stk-car/game/src/courses.ts";
import { readLocalAsset } from "./asset-fixture.ts";

const circuit = new Circuit([{ center: [0, 0, 0], width: 30 }, { center: [0, 0, -200], width: 30 }, { center: [200, 0, -200], width: 30 }, { center: [200, 0, 0], width: 30 }]);
function race(count = 2): Race {
  const game = new Race(circuit, [], 3, { difficulty: 1, aiCount: count - 1, mode: "normal", kartId: "tux" });
  game.phase = "racing"; game.elapsed = 2;
  for (const racer of game.racers) { racer.startBoostApplied = true; place(racer, 50, 0); }
  return game;
}
function place(racer: Racer, distance: number, lane: number, speed = 0, heading = 0): void {
  const pose = circuit.sample(distance, lane);
  Object.assign(racer, pose, { heading, previous: { ...pose, heading }, routeDistance: circuit.wrap(distance), progress: distance, speed, sideSpeed: 0, lane });
}
function separated(racers: Racer[]): void {
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) assert.ok((kartContact(racers[i], racers[j])?.depth ?? 0) < 0.001, `${racers[i].id}/${racers[j].id} overlap`);
  for (const racer of racers) for (const value of [racer.x, racer.y, racer.z, racer.speed, racer.sideSpeed, racer.progress]) assert.ok(Number.isFinite(value));
}
const energy = (racers: Racer[]) => racers.reduce((sum, racer) => sum + racer.speed ** 2 + racer.sideSpeed ** 2, 0);

test("collision bounds match each packaged chassis and all four wheel mounts", () => {
  for (const kart of trackData.karts) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const parts = [{ path: kart.model, position: [0, 0, 0] }, ...kart.wheels].map((part) => ({ ...part, data: readLocalAsset(part.path) }));
    if (parts.some((part) => !part.data)) continue;
    for (const part of parts) {
      const bytes = part.data!;
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min: number[]; max: number[] }[] };
      for (const primitive of gltf.meshes[0].primitives) for (let axis = 0; axis < 3; axis++) {
        const bounds = gltf.accessors[primitive.attributes.POSITION];
        min[axis] = Math.min(min[axis], bounds.min[axis] + part.position[axis]); max[axis] = Math.max(max[axis], bounds.max[axis] + part.position[axis]);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(kartBodies[kart.id].min[axis] - min[axis]) < 1e-6);
      assert.ok(Math.abs(kartBodies[kart.id].max[axis] - max[axis]) < 1e-6);
    }
  }
});

test("all starting grids are free of chassis overlap on every course and in reverse", () => {
  for (const course of courses) for (const reverse of [false, true]) for (const kart of trackData.karts) {
    const game = new Race(new Circuit(reverse ? [...course.route].reverse() : course.route), [], 3, { difficulty: 1, aiCount: 3, mode: "normal", kartId: kart.id });
    separated(game.racers);
  }
});

test("oriented bodies collide before their centers meet and reject side-by-side false positives", () => {
  const [a, b] = race().racers;
  a.kartId = "tux"; b.kartId = "tux";
  place(a, 50, 0); place(b, 51.2, 0);
  assert.ok(kartContact(a, b));
  place(b, 50, 1.2); assert.equal(kartContact(a, b), null);
  place(a, 50, 0, 0, Math.PI / 2); place(b, 50, 1.2, 0, Math.PI / 2);
  assert.ok(kartContact(a, b), "length follows heading");
  place(b, 51.2, 0, 0, Math.PI / 2); assert.equal(kartContact(a, b), null);
  place(b, 50.8, 1.3); assert.equal(kartContact(a, b), null, "separating axes reject diagonal near misses");
});

test("rear impacts transfer speed symmetrically for player/AI, AI/player and AI/AI", () => {
  for (const [first, second] of [[0, 1], [1, 0], [1, 2]]) {
    const racers = race(3).racers, a = racers[first], b = racers[second];
    for (const racer of racers) place(racer, 80, 10);
    place(a, 50, 0, 20); place(b, 51.1, 0, 5);
    const before = energy([a, b]); resolveKartContacts([a, b]);
    separated([a, b]);
    assert.ok(a.speed < 20 && b.speed > 5 && b.speed >= a.speed);
    assert.ok(Math.abs(a.speed + b.speed - 25) < 1e-9, "longitudinal momentum is conserved");
    assert.ok(energy([a, b]) <= before + 1e-9);
  }
});

test("side impacts preserve lateral response without injecting energy or kicking separating cars", () => {
  const [a, b] = race().racers; place(a, 50, 0, 8); place(b, 50, 0.7, 8); a.sideSpeed = 6;
  const before = energy([a, b]); resolveKartContacts([a, b]); separated([a, b]);
  assert.ok(b.sideSpeed > 2 && a.sideSpeed < 4);
  assert.ok(energy([a, b]) <= before + 1e-9);
  place(a, 50, 0); place(b, 50, 0.7); a.sideSpeed = -3; b.sideSpeed = 3;
  resolveKartContacts([a, b]); assert.equal(a.sideSpeed, -3); assert.equal(b.sideSpeed, 3); separated([a, b]);
});

test("coincident centers and four-car pileups separate deterministically with finite poses", () => {
  const racers = race(4).racers;
  const before = racers.map((racer) => ({ ...racer, previous: { ...racer.previous } }));
  resolveKartContacts(racers); separated(racers);
  resolveKartContacts(before); assert.deepEqual(racers, before);
  const once = racers.map((racer) => [racer.x, racer.z, racer.speed, racer.sideSpeed]);
  resolveKartContacts(racers); assert.deepEqual(racers.map((racer) => [racer.x, racer.z, racer.speed, racer.sideSpeed]), once);
});

test("grade-separated crossings and finished karts do not produce phantom contacts", () => {
  const [a, b] = race().racers; b.y = 4;
  assert.equal(kartContact(a, b), null); assert.equal(resolveKartContacts([a, b]).size, 0);
  b.y = 0; b.finishedAt = 12;
  assert.equal(kartContact(a, b), null);
});

test("four-car contacts remain stable at arbitrary headings without adding kinetic energy", () => {
  let seed = 71429;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2 ** 32; };
  for (let trial = 0; trial < 200; trial++) {
    const racers = race(4).racers;
    for (const racer of racers) {
      place(racer, 50 + random() * 0.8, random() * 0.8, random() * 10 - 5, random() * Math.PI * 2);
      racer.sideSpeed = random() * 10 - 5;
    }
    const before = energy(racers); resolveKartContacts(racers); separated(racers);
    assert.ok(energy(racers) <= before + 1e-8);
  }
});

test("race integration stops fast rear and head-on impacts from tunneling during a 50ms tick", () => {
  for (const headOn of [false, true]) {
    const game = race(), [a, b] = game.racers;
    place(a, headOn ? 53 : 50, 0, 120, headOn ? Math.PI : 0); place(b, headOn ? 50 : 53, 0, headOn ? 120 : 0);
    game.step(0.05, emptyControls()); separated(game.racers);
    assert.ok(headOn ? a.routeDistance > b.routeDistance : a.routeDistance < b.routeDistance, "cars cannot swap sides through each other");
    assert.ok(a.speed < 100, "the impact must affect the actual race velocity");
  }
});

test("AI retains lateral displacement after impact and cannot snap through a parked player", () => {
  const game = race(), [a, b] = game.racers;
  place(a, 50, 0); place(b, 50, 0.7); b.lane = 0;
  game.step(fixedStep, emptyControls()); separated(game.racers);
  const displaced = b.x;
  game.step(fixedStep, emptyControls()); separated(game.racers);
  assert.ok(Math.abs(b.x - displaced) < 0.05, "lane correction is gradual");
  for (let tick = 0; tick < 240; tick++) { game.step(fixedStep, emptyControls()); separated(game.racers); }
});

test("separation and rescue cannot award a lap, and substeps consume each item press once", () => {
  const game = race(), [a, b] = game.racers;
  place(a, circuit.length - 0.01, 0); place(b, circuit.length - 0.8, 0);
  const progress = a.progress;
  game.step(0.00001, emptyControls());
  assert.equal(a.progress, progress); assert.equal(game.lapTimes.length, 0);
  a.sideSpeed = 5; game.rescue(); assert.equal(a.sideSpeed, 0); assert.equal(a.progress, progress);
  const trial = new Race(circuit, [], 3, { difficulty: 1, aiCount: 0, mode: "time-trial", kartId: "tux" });
  trial.phase = "racing"; trial.elapsed = 2; trial.player.speed = 100; trial.player.startBoostApplied = true;
  trial.step(0.05, { ...emptyControls(), useItem: true });
  assert.equal(trial.player.zipperCount, 2);
});
