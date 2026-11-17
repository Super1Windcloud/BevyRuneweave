import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ResourceDownloads } from "../modules/stk-car/game/src/resources.ts";
import type { ResourceCatalog } from "../modules/stk-car/game/src/resource-types.ts";
import { packFor, safePath, sha256, zipFiles } from "./resource-packs.ts";
import { resourceCatalog } from "../modules/stk-car/game/src/resource-catalog.ts";
import { load } from "./game-fixture.ts";

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
  for (const path of startup.files) assert.equal(packFor(path), null, path);
  for (const [path, owner] of Object.entries(resourceCatalog.owners)) assert.ok(resourceCatalog.packs.some((pack) => pack.id === owner && pack.files.some((file) => file.path === path)));
  for (const pack of resourceCatalog.packs) {
    const files = pack.files.map((file) => ({ path: file.path, data: readFileSync(`${root}/${file.path}`) }));
    for (let i = 0; i < files.length; i++) assert.equal(sha256(files[i].data), pack.files[i].sha256);
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
