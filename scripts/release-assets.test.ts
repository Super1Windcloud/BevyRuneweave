import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { listReleaseAssets, releaseAssetLabel, syncReleaseAssets, type ReleaseAsset, type ReleaseCandidate } from "./release-assets.js";

function asset(id: number, name: string, label: string | null, state = "uploaded"): ReleaseAsset {
  return { id, name, label, state };
}

test("payload fingerprints track packaged content and keys, ignoring emitted scripts and timestamps", (t) => {
  const parent = resolve(import.meta.dirname, "../target/release-assets-tests");
  mkdirSync(parent, { recursive: true });
  const assets = mkdtempSync(join(parent, "payload-"));
  t.after(() => rmSync(assets, { recursive: true, force: true }));
  writeFileSync(join(assets, "engineConfig.json"), '{"name":"game"}');
  writeFileSync(join(assets, "sprite.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(assets, "game.js"), "generated debug bundle");
  const key = Buffer.alloc(32, 1);
  const label = (script = "bundled entry and imported API", secret = key) =>
    releaseAssetLabel(assets, "ts", "game.js", script, secret);
  const original = label();
  writeFileSync(join(assets, "game.js"), "regenerated debug bundle");
  assert.equal(label(), original);
  // Recreating files in another insertion order must not affect the fingerprint.
  rmSync(join(assets, "sprite.png"));
  writeFileSync(join(assets, "sprite.png"), Buffer.from([1, 2, 3]));
  assert.equal(label(), original);
  assert.notEqual(label("changed imported API"), original);
  assert.notEqual(label(undefined, Buffer.alloc(32, 2)), original);
  writeFileSync(join(assets, "sprite.png"), Buffer.from([1, 2, 4]));
  const changed = label();
  assert.notEqual(changed, original);
  renameSync(join(assets, "sprite.png"), join(assets, "renamed.png"));
  assert.notEqual(label(), changed);
  rmSync(join(assets, "renamed.png"));
  assert.notEqual(label(), original);
  assert.notEqual(releaseAssetLabel(assets, "ts", "other.js", "bundled entry and imported API", key), label());
  writeFileSync(join(assets, "module.lua"), "return 1");
  const lua = releaseAssetLabel(assets, "lua", "game.lua", "bundled Lua", key);
  writeFileSync(join(assets, "module.lua"), "return 2");
  assert.equal(releaseAssetLabel(assets, "lua", "game.lua", "bundled Lua", key), lua);
});

function scenario() {
  const events: string[] = [];
  const candidate = (name: string, label = "current"): ReleaseCandidate => ({
    name, label,
    async prepare() { events.push(`prepare:${name}`); return name; },
  });
  const actions = {
    async remove(existing: ReleaseAsset) { events.push(`remove:${existing.id}`); },
    async upload(item: ReleaseCandidate) { events.push(`upload:${item.name}`); },
    log() {},
  };
  return { events, candidate, actions };
}

test("a repeated upload skips packaging and all remote mutations for unchanged projects", async () => {
  const { events, candidate, actions } = scenario();
  await syncReleaseAssets([candidate("game.zip")], [asset(1, "game.zip", "current")], actions);
  assert.deepEqual(events, []);
});

test("only changed or missing projects upload; unrelated release assets remain intact", async () => {
  const { events, candidate, actions } = scenario();
  await syncReleaseAssets([
    candidate("unchanged.zip"), candidate("changed.zip"), candidate("missing.zip"),
  ], [
    asset(1, "unchanged.zip", "current"), asset(2, "changed.zip", "old"),
    asset(3, "runtime.zip", null), asset(4, "unselected-language.zip", "old"),
  ], actions);
  assert.deepEqual(events, [
    "prepare:changed.zip", "prepare:missing.zip", "remove:2",
    "upload:changed.zip", "upload:missing.zip",
  ]);
});

test("legacy, incomplete and duplicate assets are replaced instead of incorrectly skipped", async () => {
  const { events, candidate, actions } = scenario();
  await syncReleaseAssets([
    candidate("legacy.zip"), candidate("incomplete.zip"), candidate("duplicate.zip"),
  ], [
    asset(1, "legacy.zip", null), asset(2, "incomplete.zip", "current", "starter"),
    asset(3, "duplicate.zip", "current"), asset(4, "duplicate.zip", "old"),
  ], actions);
  assert.deepEqual(events.filter((event) => event.startsWith("remove:")), ["remove:1", "remove:2", "remove:3", "remove:4"]);
  assert.equal(events.filter((event) => event.startsWith("upload:")).length, 3);
});

test("packaging failure leaves every remote asset untouched", async () => {
  const { events, candidate, actions } = scenario();
  const broken = candidate("broken.zip");
  broken.prepare = async () => { throw new Error("packaging failed"); };
  await assert.rejects(syncReleaseAssets([candidate("changed.zip"), broken], [asset(1, "changed.zip", "old")], actions), /packaging failed/);
  assert.deepEqual(events, ["prepare:changed.zip"]);
});

test("failed uploads do not mark a project unchanged; retry skips only successful projects", async () => {
  const { events, candidate, actions } = scenario();
  const remote: ReleaseAsset[] = [];
  const candidates = [candidate("first.zip"), candidate("second.zip")];
  let fail = true;
  actions.upload = async (item) => {
    events.push(`upload:${item.name}`);
    if (item.name === "second.zip" && fail) throw new Error("upload failed");
    remote.push(asset(remote.length + 1, item.name, item.label));
  };
  await assert.rejects(syncReleaseAssets(candidates, remote, actions), /upload failed/);
  events.length = 0;
  fail = false;
  await syncReleaseAssets(candidates, remote, actions);
  assert.deepEqual(events, ["prepare:second.zip", "upload:second.zip"]);
});

test("a failed deletion prevents uploading a conflicting name", async () => {
  const { events, candidate, actions } = scenario();
  actions.remove = async () => { throw new Error("delete failed"); };
  await assert.rejects(syncReleaseAssets([candidate("game.zip")], [asset(1, "game.zip", "old")], actions), /delete failed/);
  assert.deepEqual(events, ["prepare:game.zip"]);
});

test("remote comparison includes every page of release assets", async () => {
  const requests: string[] = [];
  const first = Array.from({ length: 100 }, (_, id) => asset(id, `${id}.zip`, "current"));
  const last = asset(101, "last.zip", "current");
  const assets = await listReleaseAssets(42, async (path) => {
    requests.push(path);
    return Response.json(requests.length === 1 ? first : [last]);
  });
  assert.equal(assets.length, 101);
  assert.equal(assets.at(-1)?.name, "last.zip");
  assert.deepEqual(requests, ["/releases/42/assets?per_page=100&page=1", "/releases/42/assets?per_page=100&page=2"]);
});

test("asset lookup failure aborts comparison", async () => {
  await assert.rejects(listReleaseAssets(42, async () => new Response(null, { status: 403 })), /lookup failed: 403/);
});

test("the real publisher skips identical bundles and replaces only changed or missing remote projects", { timeout: 120_000 }, (t) => {
  const root = resolve(import.meta.dirname, "..");
  const parent = join(root, "target/release-assets-tests");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "publisher-"));
  const tag = `incremental-test-${process.pid}`;
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(join(root, "dist/releases", tag), { recursive: true, force: true });
  });
  const stateFile = join(directory, "remote.json");
  const mock = join(directory, "mock-github.ts");
  // No network fallback: every request is handled by this isolated test double.
  writeFileSync(mock, `
import { readFileSync, writeFileSync } from "node:fs";
const stateFile = process.env.RUNEWEAVE_RELEASE_TEST_STATE!;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  if (new Headers(init.headers).get("Authorization") !== "Bearer release-test-token") throw new Error("Unexpected credentials");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  if (url.hostname === "api.github.com" && method === "GET") {
    if (url.pathname.includes("/releases/tags/")) return Response.json({ id: 42, upload_url: "https://uploads.test/assets{?name,label}" });
    if (url.pathname.endsWith("/releases/42/assets")) {
      const offset = (Number(url.searchParams.get("page")) - 1) * 100;
      return Response.json(state.assets.slice(offset, offset + 100));
    }
  }
  if (url.hostname === "api.github.com" && method === "DELETE" && /\\/releases\\/assets\\/\\d+$/.test(url.pathname)) {
    const id = Number(url.pathname.split("/").at(-1));
    if (!state.assets.some((asset) => asset.id === id)) throw new Error("Deleting missing asset");
    state.assets = state.assets.filter((asset) => asset.id !== id);
    state.events.push({ method, id });
    writeFileSync(stateFile, JSON.stringify(state));
    return new Response(null, { status: 204 });
  }
  if (url.hostname === "uploads.test" && method === "POST") {
    const name = url.searchParams.get("name");
    const label = url.searchParams.get("label");
    if (!label?.startsWith("runeweave-v1:")) throw new Error("Missing fingerprint label");
    if (!Buffer.isBuffer(init.body) || init.body.readUInt32LE(0) !== 0x04034b50) throw new Error("Expected ZIP body");
    if (state.assets.some((asset) => asset.name === name)) throw new Error("Duplicate upload");
    const asset = { id: state.nextId++, name, label, state: "uploaded" };
    state.assets.push(asset);
    state.events.push({ method, name });
    writeFileSync(stateFile, JSON.stringify(state));
    return Response.json(asset, { status: 201 });
  }
  throw new Error("Unexpected request: " + method + " " + url);
};
`);
  interface RemoteState {
    assets: ReleaseAsset[];
    events: { method: string; name?: string; id?: number }[];
    nextId: number;
  }
  const readState = () => JSON.parse(readFileSync(stateFile, "utf8")) as RemoteState;
  const save = (state: RemoteState) => writeFileSync(stateFile, JSON.stringify(state));
  save({ assets: [asset(1, "unrelated-runtime.zip", null)], events: [], nextId: 2 });
  const run = () => execFileSync(process.execPath, [
    "--import", "tsx", "--import", pathToFileURL(mock).href,
    join(root, "scripts/publish-release.ts"), `--tag=${tag}`,
  ], {
    cwd: root, encoding: "utf8", timeout: 90_000,
    env: { ...process.env, GITHUB_TOKEN: "release-test-token", GH_TOKEN: "release-test-token",
      RUNEWEAVE_SCRIPT_KEY: "01".repeat(32), RUNEWEAVE_RELEASE_TEST_STATE: stateFile },
  });
  run();
  let state = readState();
  const projects = state.assets.filter((item) => item.name !== "unrelated-runtime.zip");
  assert.ok(projects.length >= 2);
  assert.equal(state.events.length, projects.length);
  state.events = [];
  save(state);
  const unchanged = run();
  state = readState();
  assert.deepEqual(state.events, []);
  assert.match(unchanged, /0 uploaded/);
  assert.doesNotMatch(unchanged, /Created |Replaced /);
  assert.deepEqual(state.assets.filter((item) => item.name !== "unrelated-runtime.zip"), projects);

  const changed = projects[0]!;
  const missing = projects[1]!;
  state.assets.find((item) => item.id === changed.id)!.label = "previous-payload";
  state.assets = state.assets.filter((item) => item.id !== missing.id);
  save(state);
  run();
  state = readState();
  assert.deepEqual(state.events.filter((event) => event.method === "DELETE"), [{ method: "DELETE", id: changed.id }]);
  assert.deepEqual(state.events.filter((event) => event.method === "POST").map((event) => event.name).sort(), [changed.name, missing.name].sort());
  assert.deepEqual(state.assets.find((item) => item.name === "unrelated-runtime.zip"), asset(1, "unrelated-runtime.zip", null));
});
