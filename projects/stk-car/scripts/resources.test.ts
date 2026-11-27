import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ResourceDownloads } from "../modules/stk-car/game/src/resources.ts";
import type { ResourceCatalog } from "../modules/stk-car/game/src/resource-types.ts";
import { packFor, safePath, sha256, zipFiles } from "./resource-packs.ts";
import { resourceCatalog } from "../modules/stk-car/game/src/resource-catalog.ts";
import { courseFor, courseModelPaths, mapScenes, sceneFor } from "../modules/stk-car/game/src/courses.ts";
import { menuData } from "../modules/stk-car/game/src/menu-data.ts";
import { load } from "./game-fixture.ts";
import { readLocalAsset } from "./asset-fixture.ts";

const catalog: ResourceCatalog = { schemaVersion: 1, owners: { "a.glb": "a", "b.glb": "b", "c.ogg": "c" }, packs: ["a", "b", "c"].map((id) => ({ id, url: `https://example.com/${id}.zip`, bytes: 100, sha256: "a".repeat(64), files: [] })) };
test("foreground dependencies outrank queued music and downloads stay bounded", () => {
  const started: string[] = [];
  globalThis.asset_pack_request = (json) => { started.push(JSON.parse(json).url); return started.length; };
  globalThis.asset_pack_poll = () => ({ state: "pending", received: 40, total: 100 });
  const downloads = new ResourceDownloads(catalog);
  downloads.ensure(["c.ogg"], -10); downloads.ensure(["a.glb", "b.glb"], 100);
  downloads.tick(); assert.deepEqual(started, ["https://example.com/a.zip", "https://example.com/b.zip"]);
  downloads.tick(); assert.equal(started.length, 2); assert.equal(downloads.path("a.glb"), "");
  assert.equal(downloads.status(["a.glb", "b.glb"]).received, 80);
  globalThis.asset_pack_poll = () => ({ state: "ready", root: "cache://game/hash/" }); downloads.tick();
  assert.equal(downloads.path("a.glb"), "cache://game/hash/a.glb"); assert.equal(downloads.path("ui/core.png"), "ui/core.png");
  assert.equal(started.length, 3);
});
test("failed packs stay unavailable until explicit retry and missing APIs fail without crashing menus", () => {
  globalThis.asset_pack_request = () => 1;
  globalThis.asset_pack_poll = () => ({ state: "error", error: "checksum_mismatch" });
  const downloads = new ResourceDownloads(catalog); downloads.ensure(["a.glb"]); downloads.tick(); downloads.tick();
  assert.equal(downloads.ready("a.glb"), false); assert.equal(downloads.status().error, "checksum_mismatch");
  downloads.ensure(["a.glb"], 100, true); downloads.tick();
  globalThis.asset_pack_poll = () => ({ state: "ready", root: "" }); downloads.tick(); assert.equal(downloads.path("a.glb"), "a.glb");
  const game = load("zh-CN", "ios", undefined, ["asset_pack_request", "asset_pack_poll"]);
  assert.match(game.texts.get("resource-status")!, /更新游戏运行时/); assert.ok(game.nodes.has("singleplayer"));
});
test("selecting a playable course prefetches its models and shows progress before starting on mobile and desktop", () => {
  const course = courseFor("lighthouse")!;
  for (const platform of ["android", "windows"]) {
    const game = load("zh-CN", platform);
    game.click("singleplayer");
    if (platform === "android") game.click("gui:karts:continue");
    else game.press("Enter");
    game.click("gui:race_setup:mode-normal");
    const requested = () => [...game.packRequests.values()].flatMap((pack) => pack.files.map((file) => file.path));
    assert.ok(!requested().includes(course.trackModel), platform);

    game.downloads.hold = true;
    game.click("gui:tracks_and_gp:track:lighthouse");
    for (const model of courseModelPaths(course)) assert.ok(requested().includes(model), `${platform}: ${model}`);
    assert.ok(game.nodes.has("resource-status"));
    assert.match(game.texts.get("resource-status")!, /正在下载资源 0\.0 \/ /);
    game.downloads.received = 1048576;
    game.frame();
    assert.match(game.texts.get("resource-status")!, /正在下载资源 [1-9]\d*\.\d \/ /);
    assert.ok(!game.models.has("track"));

    game.downloads.hold = false;
    game.settle();
    assert.equal(game.texts.get("resource-status"), "资源已就绪");
    game.click("gui:track_info:start");
    assert.equal(game.models.get("track"), course.trackModel);
  }
});
test("non-racing maps download their own 3D scene and can return or retry", () => {
  const scene = sceneFor("alien_signal")!;
  const root = "cache://stk-car/test/";
  for (const platform of ["android", "ios", "windows"]) {
    const game = load("zh-CN", platform, undefined, [], { hold: false, error: "", root });
    game.click("singleplayer");
    if (platform !== "windows") game.click("gui:karts:continue");
    else game.press("Enter");
    game.click("gui:race_setup:mode-normal");
    const id = `gui:tracks_and_gp:track:${scene.id}`;
    for (let page = 0; page < mapScenes.length && !game.nodes.has(id); page++) {
      const next = [...game.nodes].find((node) => node.endsWith(":page-1"));
      assert.ok(next); game.click(next);
    }
    assert.match(game.texts.get(`${id}:label:text`)!, /3D 场景$/);
    game.downloads.hold = true;
    game.click(id);
    assert.ok(!game.nodes.has("gui:track_info:start"));
    game.click("gui:track_info:view-scene");
    assert.ok(game.nodes.has("download-back"));
    assert.ok(!game.models.has("track"));
    game.downloads.error = "network"; game.frame();
    assert.match(game.texts.get("resource-status")!, /下载失败/);
    game.downloads.error = ""; game.downloads.hold = false;
    game.click("download-retry"); game.settle();
    assert.equal(game.models.get("track"), root + scene.trackModel);
    assert.equal(game.models.get("sky"), root + scene.skyModel);
    assert.ok(!game.models.has("tux"));
    game.click("scene-back");
    assert.ok(!game.models.has("track")); assert.ok(game.nodes.has("gui:track_info:view-scene"));
  }
});
test("an additional race uses the downloaded scene and minimap", () => {
  const course = courseFor("abyss")!, root = "cache://stk-car/test/";
  const game = load("en-US", "android", undefined, [], { hold: false, error: "", root });
  game.click("singleplayer"); game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
  game.click(`gui:tracks_and_gp:track:${course.id}`); game.click("gui:track_info:start");
  assert.equal(game.models.get("track"), root + course.trackModel);
  assert.equal(game.images.get("map"), root + course.minimap.image);
  assert.equal(JSON.parse(game.saved.get("pc-race-settings-v1")!).trackId, course.id);
});
test("desktop Grand Prix previews return to the track picker without selecting Hacienda", () => {
  const game = load("zh-CN", "windows");
  game.click("singleplayer"); game.press("Enter"); game.click("gui:race_setup:mode-normal");
  game.click(`gui:tracks_and_gp:gp:${menuData.grandPrix[0].id}`);
  assert.match(game.texts.get("gui:gp_info:name:text")!, /预览$/);
  assert.ok(!game.nodes.has("gui:gp_info:start"));
  assert.ok(!game.nodes.has("gui:gp_info:continue"));
  game.click("gui:gp_info:single-race");
  assert.ok(!game.nodes.has("gui:track_info:start"));
  game.click("gui:tracks_and_gp:track:lighthouse");
  game.click("gui:track_info:start");
  assert.equal(game.models.get("track"), courseFor("lighthouse")!.trackModel);
});
test("a new track selection replaces the cancelled race while both courses are downloading", () => {
  const root = "cache://stk-car/test/";
  const game = load("en-US", "android", undefined, [], { hold: true, error: "", root });
  game.click("singleplayer"); game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
  game.click("gui:tracks_and_gp:track:hacienda"); game.click("gui:track_info:start");
  game.click("download-back"); game.press("Escape");
  game.click("gui:tracks_and_gp:track:lighthouse"); game.click("gui:track_info:start");
  assert.ok(!game.models.has("track"));

  game.downloads.hold = false; game.settle();
  const course = courseFor("lighthouse")!;
  assert.equal(game.models.get("track"), root + course.trackModel);
  assert.equal(game.models.get("sky"), root + course.skyModel);
  assert.equal(game.images.get("map"), course.minimap.image);
  assert.equal(game.voices.get("music")?.path, root + course.music);
  game.click("pause"); game.click("restart-race");
  assert.equal(game.models.get("track"), root + course.trackModel);
});
test("starting a race waits for scene and AI vehicles; leaving the download page cannot auto-start later", () => {
  const game = load("en-US", "android", undefined, [], { hold: true, error: "", root: "" });
  for (let i = 0; i < 5; i++) game.press("Enter");
  assert.ok(game.nodes.has("download-back")); assert.ok(!game.models.has("track"));
  game.downloads.hold = false; game.click("download-back"); game.settle();
  assert.ok(!game.models.has("track"));
  game.press("Enter"); game.settle(); assert.ok(game.models.has("track"));
  const files = [...game.packRequests.values()].flatMap((pack) => pack.files.map((file) => file.path));
  for (const id of ["pidgin", "wilber", "suzanne"]) assert.ok(files.includes(`models/karts/${id}/kart.glb`));
});
test("download errors preserve navigation and explicit retry recovers", () => {
  const game = load("zh-CN", "macos", undefined, [], { hold: true, error: "", root: "" });
  for (let i = 0; i < 5; i++) game.press("Enter");
  game.downloads.error = "network"; game.frame(); assert.match(game.texts.get("resource-status")!, /下载失败/);
  game.downloads.error = ""; game.downloads.hold = false; game.click("download-retry"); game.settle(); assert.ok(game.models.has("track"));
});
test("startup payload excludes production sources, scenes, extra vehicles and music", () => {
  const root = resolve(import.meta.dirname, "../modules/stk-car/game/assets");
  const startup = JSON.parse(readFileSync(`${root}/startup-manifest.json`, "utf8")) as { files: string[] };
  assert.ok(startup.files.includes("models/tux.glb")); assert.ok(startup.files.includes("fonts/wqy-microhei.ttf"));
  assert.equal(mapScenes.length, 44);
  assert.deepEqual(mapScenes.map((scene) => scene.id).sort(), menuData.tracks.map((track) => track.id).sort());
  for (const scene of mapScenes) {
    const id = `track-${scene.id}`;
    const pack = resourceCatalog.packs.find((pack) => pack.id === id);
    assert.ok(pack, id);
    assert.ok(pack.bytes <= 512 * 1024 ** 2 && pack.files.reduce((total, file) => total + file.bytes, 0) <= 512 * 1024 ** 2, id);
    for (const path of courseModelPaths(scene)) assert.equal(resourceCatalog.owners[path], id);
    const { ambient, sun, background, direction, fog } = scene.environment;
    for (const color of [ambient, sun, background]) assert.ok(color.length === 3 && color.every((value) => value >= 0 && value <= 1), id);
    assert.ok(direction.length === 3 && direction.every(Number.isFinite) && Math.hypot(...direction) > 0, id);
    if (fog) assert.ok(fog.color.length === 4 && fog.color.every((value) => value >= 0 && value <= 1) && fog.start >= 0 && fog.end > fog.start, id);
  }
  for (const path of startup.files) assert.equal(packFor(path), null, path);
  for (const [path, owner] of Object.entries(resourceCatalog.owners)) assert.ok(resourceCatalog.packs.some((pack) => pack.id === owner && pack.files.some((file) => file.path === path)));
  for (const pack of resourceCatalog.packs) {
    const files = pack.files.flatMap((file) => {
      const data = readLocalAsset(file.path);
      if (!data) return [];
      assert.equal(sha256(data), file.sha256, file.path);
      return [{ path: file.path, data }];
    });
    if (files.length !== pack.files.length) continue;
    const archive = zipFiles(files); assert.equal(sha256(archive), pack.sha256); assert.equal(archive.length, pack.bytes);
  }
  assert.deepEqual(zipFiles([{ path: "a.txt", data: Buffer.from("a") }]), zipFiles([{ path: "a.txt", data: Buffer.from("a") }]));
  for (const path of ["../escape", "/abs", "a\\b", "C:/x", "a//b", "a/./b"]) assert.equal(safePath(path), false);
});
test("all imported local production assets match their recorded source hashes", () => {
  const root = resolve(import.meta.dirname, "../modules/stk-car/game/assets/source");
  const manifest = JSON.parse(readFileSync(`${root}/source-manifest.json`, "utf8")) as { files: Record<string, string> };
  for (const prefix of ["stk-assets/models/", "stk-assets/sfx/", "stk-assets/library/", "stk-code/data/gui/", "stk-code/data/skins/", "stk-code/data/ttf/", "stk-code/data/replay/"]) assert.ok(Object.keys(manifest.files).some((path) => path.startsWith(prefix)), prefix);
  for (const [path, expected] of Object.entries(manifest.files)) { assert.ok(safePath(path)); assert.equal(sha256(readFileSync(`${root}/${path}`)), expected, path); }
});
