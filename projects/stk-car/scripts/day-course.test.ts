import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { courseFor, defaultCourse } from "../modules/stk-car/game/src/courses.ts";
import { Circuit, Race, angleDelta, clamp, emptyControls, fixedStep } from "../modules/stk-car/game/src/race.ts";
import { PcSession } from "../modules/stk-car/game/src/session.ts";
import { load } from "./game-fixture.ts";

test("default course is the brighter Hacienda with complete models, audio, minimap and attribution", () => {
  assert.equal(defaultCourse.id, "hacienda"); assert.equal(defaultCourse.defaultLaps, 3);
  const night = courseFor("lighthouse")!;
  assert.ok(defaultCourse.environment.illuminance >= 30000);
  assert.ok(defaultCourse.environment.brightness > night.environment.brightness);
  assert.ok(defaultCourse.environment.sun[0] > night.environment.sun[0]);
  const assets = resolve(import.meta.dirname, "../modules/stk-car/game/assets");
  const manifest = JSON.parse(readFileSync(resolve(assets, "asset-manifest.json"), "utf8")) as { files: string[] };
  for (const path of [defaultCourse.trackModel, defaultCourse.skyModel, defaultCourse.music, defaultCourse.minimap.image, "licenses/hacienda.txt"]) assert.ok(manifest.files.includes(path), path);
  assert.match(readFileSync(resolve(assets, "licenses/hacienda.txt"), "utf8"), /CC-BY-SA/);
});
test("Hacienda driveline supports a full playable lap and keeps its high scores separate", () => {
  const circuit = new Circuit(defaultCourse.route), race = new Race(circuit, [], 1);
  assert.equal(circuit.nodes.length, 109); race.start();
  for (let tick = 0; tick < 90000 && race.phase !== "finished"; tick++) {
    const player = race.player, target = circuit.sample(player.routeDistance + Math.max(5, player.speed * 0.35), -1);
    const error = angleDelta(Math.atan2(target.x - player.x, -(target.z - player.z)) - player.heading);
    race.step(fixedStep, { ...emptyControls(), throttle: race.phase === "countdown" ? 0 : Math.abs(error) > 0.4 && player.speed > 15 ? 0 : 1,
      steer: clamp(error * 2.8, -1, 1), brake: Math.abs(error) > 0.8 && player.speed > 12 });
  }
  assert.equal(race.phase, "finished"); assert.equal(race.lapTimes.length, 1);
  const session = new PcSession(), dayKey = session.bestKey;
  session.settings.trackId = "lighthouse"; assert.notEqual(session.bestKey, dayKey); assert.ok(session.bestKey.startsWith("pc-lighthouse-"));
});
test("PC and mobile start the daylight map with its own model, music and minimap", () => {
  for (const platform of ["macos", "android", "ios"]) {
    const game = load("en-US", platform);
    for (let i = 0; i < 5; i++) game.press("Enter");
    assert.equal(game.models.get("track"), defaultCourse.trackModel);
    assert.equal(game.images.get("map"), defaultCourse.minimap.image);
    assert.equal(game.voices.get("music")?.path, defaultCourse.music);
    assert.equal(game.texts.get("lap"), "1 / 3");
  }
});
