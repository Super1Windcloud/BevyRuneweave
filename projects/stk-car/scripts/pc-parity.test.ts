import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { keyboardControls } from "../modules/stk-car/game/src/controls.ts";
import { Circuit, Race, angleDelta, emptyControls, fixedStep } from "../modules/stk-car/game/src/race.ts";
import { PcSession, parseSettings } from "../modules/stk-car/game/src/session.ts";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";
import { bakePrimitive, multiply, parseXml, sourceTransform, transformPoint } from "./scene-source.ts";

const circuit = new Circuit(trackData.route);
test("PC keys match STK KeyboardConfig, separating fire, drift, nitro and reverse", () => {
  const held = new Set(["ArrowUp", "ArrowRight", "KeyN", "KeyV", "KeyB"]), pressed = new Set(["Space", "Backspace"]);
  const input = keyboardControls((key) => held.has(key), (key) => pressed.has(key));
  assert.deepEqual(input, { throttle: 1, steer: 1, brake: false, drift: true, nitro: true, rescue: true, useItem: true, lookBack: true });
  const old = keyboardControls((key) => ["Space", "ShiftLeft", "KeyS"].includes(key), () => false, false);
  assert.equal(old.drift, false); assert.equal(old.nitro, false); assert.equal(old.throttle, 0); assert.equal(old.brake, false);
  assert.equal(keyboardControls((key) => key === "ArrowDown", () => false).brake, true);
});
test("PC settings validate persisted data; selected kart, laps, AI and reverse reach the simulation", () => {
  const session = new PcSession();
  assert.equal(session.settings.laps, 4);
  assert.equal(session.settings.wasd, false);
  session.settings = parseSettings('{"kartId":"wilber","laps":2,"aiCount":1,"difficulty":3,"reverse":true,"mode":"normal"}');
  session.start();
  assert.equal(session.race.player.kartId, "wilber"); assert.equal(session.race.laps, 2); assert.equal(session.race.racers.length, 2);
  assert.ok(Math.abs(angleDelta(session.race.circuit.sample(5).heading - circuit.sample(circuit.length - 5).heading)) > 2.8);
  assert.equal(parseSettings('{"laps":999,"aiCount":-99,"kartId":"unknown"}').laps, 20);
  assert.equal(parseSettings('null').kartId, "tux"); assert.equal(parseSettings('invalid').difficulty, 1);
  session.screen = "paused"; session.open("help"); session.back(); assert.equal(session.screen, "paused"); session.back(); assert.equal(session.screen, "race");
});
test("time trial removes bonus boxes and AI but keeps nitro and grants one zipper per lap", () => {
  const race = new Race(circuit, [{ kind: "item", position: [0, 0, 0] }, { kind: "small-nitro", position: [0, 0, 0] }], 4,
    { difficulty: 1, aiCount: 3, mode: "time-trial", kartId: "tux" });
  assert.equal(race.racers.length, 1); assert.equal(race.pickups.length, 1); assert.equal(race.pickups[0].kind, "small-nitro");
  assert.equal(race.player.zipperCount, 4); race.start();
  for (let i = 0; i < 362; i++) race.step(fixedStep, emptyControls());
  race.step(fixedStep, { ...emptyControls(), useItem: true });
  assert.equal(race.player.zipperCount, 3); assert.ok(race.player.boost > 3); assert.equal(race.traps.length, 0);
});
test("countdown forbids early acceleration and down brakes before reversing", () => {
  const race = new Race(circuit, []); race.start();
  for (let i = 0; i < 362; i++) race.step(fixedStep, { ...emptyControls(), throttle: 1 });
  assert.equal(race.player.falseStart, true); assert.equal(race.player.speed, 0);
  for (let i = 0; i < 130; i++) race.step(fixedStep, emptyControls());
  race.player.speed = 10;
  const progress = race.player.progress;
  race.step(fixedStep, { ...emptyControls(), brake: true });
  assert.ok(race.player.speed > 0 && race.player.speed < 10); assert.ok(race.player.progress >= progress);
  for (let i = 0; i < 180; i++) race.step(fixedStep, { ...emptyControls(), brake: true });
  assert.ok(race.player.speed < 0);
});
test("source hierarchy composes rotation and nonuniform scale without inheriting LOD prototype offsets", () => {
  const document = parseXml(`<?xml version="1.0"?><scene><!-- ignored --><object name="a'b" xyz='1 2 3'/></scene>`);
  assert.equal(document.children[0].attributes.name, "a'b"); assert.throws(() => parseXml("<scene><object></scene>"), /Mismatched/);
  const parent = sourceTransform({ xyz: "10 0 0", hpr: "0 90 0", scale: "2 3 4" });
  const child = sourceTransform({ xyz: "1 0 0" });
  const point = transformPoint(multiply(parent, child), [0, 0, 0]);
  assert.ok(Math.abs(point[0] - 10) < 0.0001 && Math.abs(point[2] + 2) < 0.0001);
  const primitive = { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], colors: new Array(12).fill(1), uvs: [], indices: [0, 1, 2], material: 0 };
  const baked = bakePrimitive(primitive, parent, 0);
  assert.ok(Math.abs(Math.hypot(...baked.normals.slice(0, 3)) - 1) < 1e-6);
  const instances = JSON.parse(readFileSync(resolve(import.meta.dirname, "../modules/stk-car/game/assets/licenses/scene-instances.json"), "utf8")) as { category: string; matrix: number[] }[];
  assert.equal(trackData.sceneMetadata.libraryInstances, 70); assert.equal(instances.length, 164);
  assert.ok(!instances.some((instance) => instance.category === "track-lod" && instance.matrix[12] === 266.88));
});
