import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import {
  getHungerStatus,
  heroClasses,
  heroClassList,
  enemySpecs,
  mobCombat,
  seededRandom,
  lootKinds,
  type Point,
  type HeroClass,
} from "../modules/ember-arena/game/src/rules.js";
import { canStep, cellKey, findPath, generateFloor, lineOfSight, passable, reveal, sameCell, searchFloor, terrainAt, type DungeonFloor, type Terrain } from "../modules/ember-arena/game/src/dungeon.js";
import { defaultProfile, parseProfile } from "../modules/ember-arena/game/src/profile.js";
import { message, messages, renderMessage, translate, type MessageKey } from "../modules/ember-arena/game/src/i18n.js";
import { fontForText, measureText, wrapText } from "../modules/ember-arena/game/src/text-layout.js";
import { fontAdvances } from "./font-metrics.js";
import { buffId, type BuffKind } from "../modules/ember-arena/game/src/effects.js";
import { staffChargeId } from "../modules/ember-arena/game/src/staff.js";
import { cloakBuffId, cloakId } from "../modules/ember-arena/game/src/cloak.js";
import { sealId, shieldId } from "../modules/ember-arena/game/src/seal.js";

const assets = resolve(import.meta.dirname, "../modules/ember-arena/game/assets");
type RecordValue = { [key: string]: unknown };
interface Entity { transform: RecordValue; body?: RecordValue; model?: string; sprite?: { path: string; width: number; height: number } }
interface Ui { parent: string; text?: string; style?: RecordValue; image?: string; font?: string; fontSize?: number }

// Platform doubles for deterministic gameplay tests, not runtime acceptance.
// Real BMS references and Lua/QuickJS parity are tested in Rust separately.
class Reference {
  constructor(private value: RecordValue) {}
  get(key: string): unknown {
    const value = this.value[key];
    return value !== null && typeof value === "object" ? new Reference(value as RecordValue) : value;
  }
  // ScriptActor numbers and Transform members are f32 in the real Bevy world.
  set(key: string, value: unknown): void { this.value[key] = typeof value === "number" ? Math.fround(value) : value; }
}
function harness(width = 1280, height = 800, mobile = false, saves = new Map<string, string>(), stickyUi = false, locale = "en-US") {
  const entities = new Map<string, Entity>();
  const ui = new Map<string, Ui>();
  const pressed = new Set<string>();
  const keys = new Set<string>();
  const clicks = new Set<string>();
  let buttonPolls = 0;
  let heldButton: string | null = null;
  let state = { score: 0, lives: 0, message: "" };
  let exitRequested = false;
  let storageFailure = "";
  const windowSizeRequests: [number, number][] = [];
  let pointer = { pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width / height * 800, viewportHeight: 800 };
  let camera = { x: 0, y: 0, height: 800 };
  const despawnUi = (id: string): boolean => {
    if (!ui.has(id)) return false;
    for (const [child, element] of [...ui]) if (element.parent === id) despawnUi(child);
    return ui.delete(id);
  };
  const context = createContext({
    console,
    app_locale: () => locale,
    storage_read: (key: string) => storageFailure ? { state: "error", error: storageFailure }
      : saves.has(key) ? { state: "ok", value: saves.get(key) } : { state: "missing" },
    storage_write: (key: string, value: string) => {
      if (storageFailure) return { state: "error", error: storageFailure };
      saves.set(key, value); return { state: "ok" };
    },
    storage_remove: (key: string) => storageFailure ? { state: "error", error: storageFailure }
      : { state: saves.delete(key) ? "ok" : "missing" },
    scene_clear: () => entities.clear(),
    scene_spawn: (id: string, x: number, y: number, z: number) => {
      if (![x, y, z].every(Number.isFinite)) return false;
      entities.set(id, { transform: { translation: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } });
      return true;
    },
    scene_set_model: (id: string, path: string) => {
      if (path.includes("..") || !entities.has(id)) return false;
      assert.ok(existsSync(resolve(assets, path)), `Missing asset ${path}`);
      entities.get(id)!.model = path;
      return true;
    },
    scene_set_transform_3d: (id: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) => {
      if (!entities.has(id) || scale <= 0 || ![x, y, z, rx, ry, rz, scale].every(Number.isFinite)) return false;
      entities.get(id)!.transform = { translation: { x, y, z }, rotation: { x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }, scale: { x: scale, y: scale, z: scale } };
      return true;
    },
    scene_play_animation: (id: string, path: string) => entities.has(id) && existsSync(resolve(assets, path)),
    scene_set_3d_enabled: () => true,
    scene_set_camera_2d: (x: number, y: number, height: number) => { camera = { x, y, height }; return true; },
    scene_set_sprite: (id: string, path: string, width: number, height: number) => {
      if (!entities.has(id) || !existsSync(resolve(assets, path))) return false;
      entities.get(id)!.sprite = { path, width, height }; return true;
    },
    scene_set_text: (id: string) => entities.has(id),
    scene_set_transform: (id: string, x: number, y: number, z: number) => {
      if (!entities.has(id)) return false;
      entities.get(id)!.transform.translation = { x, y, z }; return true;
    },
    scene_transform: (id: string) => entities.has(id) ? new Reference(entities.get(id)!.transform) : undefined,
    scene_actor_set: (id: string, kind: string, health: number, speed: number, radius: number) => {
      if (!entities.has(id) || ![health, speed, radius].every(Number.isFinite) || radius <= 0) return false;
      entities.get(id)!.body = { kind, health, speed, radius, power: 0, cooldown: 0, lifetime: 0, velocity_x: 0, velocity_z: 0 };
      return true;
    },
    scene_actor: (id: string) => entities.get(id)?.body ? new Reference(entities.get(id)!.body!) : undefined,
    scene_actor_ids: () => [...entities].filter(([, value]) => value.body).map(([id]) => id).sort(),
    scene_despawn: (id: string) => entities.delete(id),
    game_state_set: (score: number, lives: number, message: string) => { state = { score, lives, message }; },
    ui_spawn: (id: string, parent: string) => { ui.set(id, { parent }); return true; },
    ui_clear: () => ui.clear(),
    ui_set_style: (id: string, json: string) => {
      const style = JSON.parse(json) as RecordValue;
      if (!ui.has(id) || "unsupported" in style) return false;
      ui.get(id)!.style = { ...ui.get(id)!.style, ...style }; return true;
    },
    ui_set_text: (id: string, value: string, fontSize: number) => {
      if (!ui.has(id)) return false;
      ui.get(id)!.text = value; ui.get(id)!.fontSize = fontSize; return true;
    },
    ui_set_image: (id: string, path: string) => {
      if (!ui.has(id) || !existsSync(resolve(assets, path))) return false;
      ui.get(id)!.image = path; return true;
    },
    ui_set_font: (id: string, path: string) => {
      if (!ui.has(id) || !existsSync(resolve(assets, path))) return false;
      ui.get(id)!.font = path; return true;
    },
    ui_despawn: despawnUi,
    ui_button_just_pressed: (id: string) => {
      if (stickyUi && ++buttonPolls > 100) throw new Error("UI callbacks revisited a remounted tree");
      const active = clicks.has(id) || heldButton === id; if (!stickyUi) clicks.delete(id); return active;
    },
    input_key_pressed: (key: string) => keys.has(key),
    input_key_just_pressed: (key: string) => pressed.has(key),
    input_key_just_released: () => false,
    input_primary_touch: () => ({ pressed: false, justPressed: false, x: 0, y: 0, deltaX: 0, deltaY: 0 }),
    input_primary_pointer: () => pointer,
    window_metrics: () => ({ width, height }),
    window_safe_area: () => ({ left: -pointer.viewportWidth / 2, right: pointer.viewportWidth / 2, bottom: -400, top: 400,
      width: pointer.viewportWidth - (mobile ? 20 : 0), height: 800 - (mobile ? 40 : 0),
      leftInset: mobile ? 10 : 0, rightInset: mobile ? 10 : 0, topInset: mobile ? 20 : 0, bottomInset: mobile ? 20 : 0 }),
    window_set_size: (w: number, h: number) => {
      windowSizeRequests.push([w, h]);
      return !mobile && Number.isFinite(w) && Number.isFinite(h);
    },
    app_request_exit: () => { exitRequested = true; return true; },
    http_get: () => 1,
    http_post: () => 2,
    http_poll: (id: number) => id === 2147483647 ? { state: "unknown" } : { state: "complete", status: 200, body: "{}" },
  });
  runInContext(readFileSync(resolve(assets, "ember-arena.js"), "utf8"), context);
  context.on_script_loaded();
  const tick = (count = 1): void => {
    for (let frame = 0; frame < count; frame++) { buttonPolls = 0; context.on_update(0.05); pressed.clear(); clicks.clear(); pointer.justPressed = false; }
  };
  return { entities, ui, keys, pressed, tick, context, saves, windowSizeRequests,
    start: (hero?: HeroClass) => { clicks.add("start"); tick(); if (hero) { clicks.add(`hero_${hero}`); tick(); } clicks.add("begin_run"); tick(); },
    item: (item: string) => { clicks.add(`slot_${item}`); tick(); clicks.add(`use_${item}`); tick(); },
    setting: (id: string) => {
      const tab = id === "sensitivity" ? 2 : ["hints", "motion"].includes(id) ? 1 : 3;
      clicks.add(`settings_tab_${tab}`); tick(); assert.ok(ui.has(id), `Missing setting ${id}`); clicks.add(id); tick();
    },
    failStorage: (error = "") => { storageFailure = error; },
    state: () => state,
    click: (id: string) => { assert.ok(ui.has(id), `Missing button ${id}`); clicks.add(id); tick(); },
    pointer: (value: Partial<typeof pointer>) => { pointer = { ...pointer, ...value }; },
    camera: () => camera,
    tapCell: (point: Point) => {
      const size = entities.get("terrain_312")!.sprite!.width;
      pointer = { ...pointer, pressed: true, justPressed: true,
        x: ((point.x - 12) * size - camera.x) * 800 / camera.height,
        y: ((12 - point.z) * size - 40 - camera.y) * 800 / camera.height };
      tick();
      pointer.pressed = false;
    },
    exitRequested: () => exitRequested,
    resize: (w: number, h: number) => { width = w; height = h; pointer.viewportWidth = w / h * 800; },
    key: (key: string) => { pressed.add(key); tick(); },
    holdButton: (id: string) => { heldButton = id; pointer.pressed = true; tick(); },
    releaseButton: () => { heldButton = null; pointer.pressed = false; tick(); },
    step: (dx: number, dz: number) => {
      if (dx) keys.add(dx > 0 ? "KeyD" : "KeyA");
      if (dz) keys.add(dz > 0 ? "KeyS" : "KeyW");
      tick(); keys.clear(); tick(4);
    },
  };
}

test("menu, movement, pause, restart, diagnostics and host exit", () => {
  const game = harness();
  assert.equal(game.state().message, "MENU");
  game.start();
  game.keys.add("KeyD"); game.tick(4); game.keys.clear();
  assert.ok((game.entities.get("player")!.transform.translation as { x: number }).x > 0);
  game.click("pause");
  const before = JSON.stringify([...game.entities]); game.tick(20);
  assert.equal(JSON.stringify([...game.entities]), before, "pause must freeze the world");
  game.key("F12");
  const results: string[] = [];
  for (let page = 0; page < 2; page++) {
    results.push(...[...game.ui.values()].flatMap((element) => element.text ?? []));
    game.click("check_page");
  }
  assert.equal(results.filter((line) => line.startsWith("PASS")).length, 8);
  assert.equal(results.filter((line) => line.startsWith("FAIL")).length, 0);
  game.click("network"); game.tick();
  assert.match(game.ui.get("network_status")!.text!, /PASS GET 200/);
  assert.match(game.ui.get("network_status")!.text!, /PASS POST 200/);
  game.click("back"); game.click("home"); game.start();
  assert.equal(game.state().lives, 20);
  assert.equal([...game.entities.values()].filter((value) => value.body?.kind === "chaser").length, 8);
  game.click("pause"); game.click("home"); game.click("exit");
  assert.ok(game.exitRequested());
});
test("portrait touch, native safe area and reload reset", () => {
  const game = harness(450, 800, true);
  game.start();
  assert.notEqual(game.ui.get("safe_root")!.style!.top, "0%");
  game.tapCell({ x: 13, z: 12 });
  assert.ok((game.entities.get("player")!.transform.translation as { x: number }).x > 0);
  game.context.on_script_reloaded();
  assert.equal(game.state().message, "MENU");
  assert.equal([...game.entities.values()].filter((value) => value.body).length, 1);
});
test("suspension pauses a run, cancels queued walking and preserves actor state until explicit resume", () => {
  const game = harness(393, 852, true); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1);
  const path = findPath(map, cell(game), { x: 14, z: 12 }); assert.ok(path.length >= 2);
  game.tapCell(path.at(-1)!);
  const stopped = cell(game), before = JSON.stringify([...game.entities]), turns = turnCount(game);
  game.context.on_suspend(); assert.equal(game.state().message, "PAUSED");
  game.tick(100); assert.equal(JSON.stringify([...game.entities]), before); assert.equal(turnCount(game), turns);
  game.click("pause_window_outside"); game.tick(100);
  assert.equal(game.state().message, "PLAYING"); assert.deepEqual(cell(game), stopped);
  assert.equal(turnCount(game), turns, "foregrounding cannot resume the old queued route");
  game.context.on_suspend(); game.context.on_suspend(); assert.equal(game.state().message, "PAUSED");
});
test("suspension cancels aiming without closing inventory or advancing timers", () => {
  const game = harness(852, 393, true); game.start("mage"); removeMonsters(game);
  game.click("quick_staff_1"); assert.ok(game.ui.has("target_prompt"));
  const before = turnCount(game); game.context.on_suspend(); game.click("pause_window_outside");
  assert.ok(!game.ui.has("target_prompt")); assert.equal(turnCount(game), before);
  game.key("KeyI"); const actors = JSON.stringify([...game.entities]);
  game.context.on_suspend(); game.tick(20);
  assert.equal(game.state().message, "INVENTORY"); assert.equal(JSON.stringify([...game.entities]), actors);
});
test("contact damage ends a run and restart removes hostile actors", () => {
  const game = harness(); game.start();
  game.entities.get("player")!.body!.health = 1;
  game.entities.set("lethal", {
    transform: { translation: { x: 22, y: -40, z: 2 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: "chaser", health: 1000, speed: 1, radius: 0.4, cooldown: 0, lifetime: 1, power: 0 },
  });
  for (let turn = 0; turn < 20 && game.state().message === "PLAYING"; turn++) game.click("wait");
  assert.equal(game.state().message, "LOST");
  game.click("restart"); game.click("begin_run"); assert.ok(!game.entities.has("lethal"));
  assert.equal(game.state().lives, 20);
});
test("downloaded GLBs contain an embedded texture and walking clip", () => {
  for (const name of ["Mage", "Knight", "Rogue_Hooded", "Barbarian"]) {
    const bytes = readFileSync(resolve(assets, `models/${name}.glb`));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.equal(document.animations[0].name, "Walking_A");
    assert.ok(document.images.every((image: { uri?: string; bufferView?: number }) => image.uri === undefined && image.bufferView !== undefined));
    assert.ok(document.buffers.every((buffer: { uri?: string }) => buffer.uri === undefined));
  }
});

test("settings persist across sessions, and reset requires confirmation", () => {
  const saves = new Map<string, string>();
  const game = harness(1280, 800, false, saves);
  game.click("settings"); game.setting("sensitivity"); game.setting("hints"); game.setting("motion"); game.setting("seed");
  const saved = parseProfile(saves.get("profile")!);
  assert.equal(saved.sensitivity, 1, "unavailable sensitivity must not change"); assert.equal(saved.showHints, false);
  assert.equal(saved.reducedMotion, true); assert.equal(saved.seed, 1338);
  const reopened = harness(1280, 800, false, saves);
  reopened.click("settings"); reopened.click("settings_tab_2"); assert.match(reopened.ui.get("sensitivity__label")!.text!, /1.00x/);
  reopened.setting("reset_save"); assert.ok(saves.has("profile"));
  reopened.click("cancel_reset"); assert.ok(saves.has("profile"));
  reopened.setting("reset_save"); reopened.click("confirm_reset"); assert.ok(!saves.has("profile"));
  reopened.key("Escape"); reopened.start();
  assert.equal(reopened.state().message, "PLAYING");
});
test("incompatible saves are preserved until an explicit reset", () => {
  const saves = new Map([["profile", "{\"schemaVersion\":99,\"valuable\":true}"]]);
  const game = harness(1280, 800, false, saves); game.click("settings"); game.click("settings_tab_3");
  assert.match(game.ui.get("save_notice")!.text!, /will not be overwritten/);
  game.setting("hints"); game.setting("retry_save");
  assert.equal(saves.get("profile"), "{\"schemaVersion\":99,\"valuable\":true}");
  game.key("Escape"); game.start(); assert.equal(game.state().message, "PLAYING");
});
test("failed saves can be retried and a finished run is counted once", () => {
  const game = harness(); game.click("settings"); game.failStorage("io"); game.setting("hints");
  game.click("settings_tab_3");
  assert.match(game.ui.get("save_notice")!.text!, /Save failed/);
  game.failStorage(); game.setting("retry_save"); assert.equal(parseProfile(game.saves.get("profile")!).showHints, false);
  game.key("Escape"); game.start();
  game.entities.get("player")!.body!.health = 1;
  game.entities.set("lethal", {
    transform: { translation: { x: 22, y: -40, z: 2 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: "chaser", health: 1000, speed: 1, radius: 0.4, cooldown: 0, lifetime: 1, power: 0 },
  });
  for (let turn = 0; turn < 20 && game.state().message === "PLAYING"; turn++) game.click("wait");
  assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.context.on_script_reloaded(); game.tick();
  assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
});
test("seeded encounters replay exactly and landscape UI uses compact controls", () => {
  const first = seededRandom(1337); const second = seededRandom(1337);
  assert.deepEqual(Array.from({ length: 20 }, first), Array.from({ length: 20 }, second));
  assert.notEqual(seededRandom(1337)(), seededRandom(1338)());
  const one = harness(); const two = harness(); one.start(); two.start(); one.tick(5); two.tick(5);
  assert.deepEqual([...one.entities], [...two.entities]);
  const landscape = harness(800, 400, true); landscape.click("settings");
  assert.equal(landscape.ui.get("settings_window")!.style!.width, 470);
});
test("save schema validation rejects bad statistics and nonfinite settings", () => {
  assert.deepEqual(parseProfile(JSON.stringify(defaultProfile())), defaultProfile());
  for (const data of [null, [], { ...defaultProfile(), bestScore: -1 }, { ...defaultProfile(), wins: 3 },
    { ...defaultProfile(), sensitivity: 100 }, { ...defaultProfile(), seed: 0x100000000 }, { ...defaultProfile(), showHints: "false" }]) {
    assert.throws(() => parseProfile(JSON.stringify(data)));
  }
});

test("official shattered pixel dungeon sprite assets exist and are valid", () => {
  const spdFiles = [
    // Heroes
    "warrior.png",
    "mage.png",
    "rogue.png",
    "huntress.png",
    "avatars.png",
    "hero_icons.png",

    // Mobs
    "rat.png",
    "gnoll.png",
    "crab.png",
    "swarm.png",
    "slime.png",
    "goo.png",
    "skeleton.png",
    "thief.png",

    // Items & environment
    "amulet.png",
    "items.png",
    "item_icons.png",
    "tiles_sewers.png",
    "terrain_features.png",
    "water0.png",

    // UI
    "banners.png",
    "badges.png",
    "boss_hp.png",
    "buffs.png",
    "icons.png",
    "status_pane.png",
    "toolbar.png",
    "menu_pane.png",

    // Splashes
    "sewers.jpg",
    "warrior.jpg",
    "mage.jpg",
    "rogue.jpg",
    "huntress.jpg",
  ];
  for (const file of spdFiles) {
    const fullPath = resolve(assets, `sprites/spd/${file}`);
    assert.ok(existsSync(fullPath), `Missing SPD asset: ${file}`);
    const stat = readFileSync(fullPath);
    assert.ok(stat.length > 0, `Empty asset: ${file}`);
  }
});

test("the application icon is the pinned upstream desktop icon", () => {
  const config = JSON.parse(readFileSync(resolve(assets, "engineConfig.json"), "utf8"));
  const source = JSON.parse(readFileSync(resolve(assets, "licenses/icon-source.json"), "utf8"));
  assert.equal(config.icon, source.file);
  const icon = readFileSync(resolve(assets, config.icon));
  assert.equal(icon.readUInt32BE(16), 256); assert.equal(icon.readUInt32BE(20), 256);
  assert.equal(createHash("sha256").update(icon).digest("hex"), source.sha256);
  assert.match(source.source, /desktop\/src\/main\/assets\/icons\/icon_256\.png$/);
  assert.ok(source.source.includes(source.revision));
});

type Game = ReturnType<typeof harness>;
function cell(game: Game, id = "player"): Point {
  const size = game.entities.get("terrain_312")!.sprite!.width;
  const translation = game.entities.get(id)!.transform.translation as { x: number; y: number };
  return { x: Math.round(translation.x / size + 12), z: Math.round(12 - (translation.y + 40) / size) };
}
function putActor(game: Game, id: string, type: string, point: Point, health = 1000, speed = 1): void {
  const size = game.entities.get("terrain_312")!.sprite!.width;
  const previous = game.entities.get(id)?.body;
  game.entities.set(id, {
    transform: { translation: { x: (point.x - 12) * size, y: (12 - point.z) * size - 40, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: type, health, speed, radius: 0.4, cooldown: id === "player" ? previous?.cooldown ?? 0 : 0,
      lifetime: id === "player" ? previous?.lifetime ?? 0 : 0, power: 0, velocity_x: 0, velocity_z: 0 },
  });
}
function removeMonsters(game: Game): void {
  for (const [id, entity] of game.entities) if (entity.body?.kind && String(entity.body.kind) in enemySpecs) game.entities.delete(id);
}
function walk(game: Game, map: DungeonFloor, target: Point): void {
  const path = findPath(map, cell(game), target);
  assert.ok(path.length || sameCell(cell(game), target), "destination must be reachable");
  for (const next of path) {
    // Opening a closed door takes a turn before stepping into its cell.
    for (let attempt = 0; attempt < 2 && !sameCell(cell(game), next); attempt++) {
      const current = cell(game); game.step(next.x - current.x, next.z - current.z);
    }
    assert.deepEqual(cell(game), next);
    if (terrainAt(map, next) === "door") map.tiles[cellKey(map, next)] = "open_door";
  }
}

test("seeded sewer floors connect every room and keep stairs inside the boundary", () => {
  for (let seed = 0; seed < 40; seed++) for (let depth = 1; depth <= 5; depth++) {
    const map = generateFloor(seed, depth);
    assert.equal(terrainAt(map, map.entrance), "entrance");
    assert.equal(terrainAt(map, map.exit), "exit");
    assert.ok(!sameCell(map.entrance, map.exit));
    for (const room of map.rooms) assert.ok(sameCell(room, map.entrance) || findPath(map, map.entrance, room).length);
    for (let index = 0; index < map.width; index++) {
      assert.equal(terrainAt(map, { x: index, z: 0 }), "wall");
      assert.equal(terrainAt(map, { x: 0, z: index }), "wall");
      assert.equal(terrainAt(map, { x: index, z: map.height - 1 }), "wall");
      assert.equal(terrainAt(map, { x: map.width - 1, z: index }), "wall");
    }
  }
  assert.deepEqual(generateFloor(1337, 2).tiles, generateFloor(1337, 2).tiles);
  assert.notDeepEqual(generateFloor(1337, 1).tiles, generateFloor(1337, 2).tiles);
});

test("closed doors block vision, opening reveals the room, and memory retains terrain", () => {
  const map: DungeonFloor = { width: 7, height: 5, depth: 1, entrance: { x: 1, z: 2 }, exit: { x: 5, z: 2 }, rooms: [],
    tiles: Array<Terrain>(35).fill("wall"), explored: new Set(), visible: new Set() };
  for (let z = 1; z < 4; z++) for (const x of [1, 2, 4, 5]) map.tiles[cellKey(map, { x, z })] = "floor";
  map.tiles[cellKey(map, { x: 3, z: 2 })] = "door";
  reveal(map, map.entrance);
  assert.ok(map.visible.has(cellKey(map, { x: 3, z: 2 })), "the closed door itself is visible");
  assert.ok(!map.visible.has(cellKey(map, map.exit)), "the room behind the door stays hidden");
  assert.ok(!lineOfSight(map, map.entrance, map.exit));
  map.tiles[cellKey(map, { x: 3, z: 2 })] = "open_door";
  reveal(map, map.entrance); assert.ok(map.visible.has(cellKey(map, map.exit)));
  reveal(map, map.entrance, 1);
  assert.ok(!map.visible.has(cellKey(map, map.exit)) && map.explored.has(cellKey(map, map.exit)));
  assert.ok(!canStep(map, { x: 2, z: 1 }, { x: 3, z: 2 }), "a diagonal cannot squeeze through a solid corner");
  assert.deepEqual(findPath(map, map.entrance, map.exit, new Set([cellKey(map, { x: 3, z: 2 })])), []);
});

test("secret doors block movement and sight until a visible in-range search reveals them", () => {
  const map: DungeonFloor = { width: 7, height: 5, depth: 1, entrance: { x: 1, z: 2 }, exit: { x: 5, z: 2 }, rooms: [],
    tiles: Array<Terrain>(35).fill("wall"), explored: new Set(), visible: new Set() };
  for (let x = 1; x <= 5; x++) map.tiles[cellKey(map, { x, z: 2 })] = "floor";
  const door = { x: 3, z: 2 };
  map.tiles[cellKey(map, door)] = "secret_door";
  reveal(map, map.entrance);
  assert.equal(passable(map, door), false);
  assert.equal(lineOfSight(map, map.entrance, map.exit), false);
  assert.equal(searchFloor(map, map.entrance, 1), 0);
  assert.equal(searchFloor(map, map.entrance, 2), 1, "starting Rogue range reaches two tiles");
  assert.equal(terrainAt(map, door), "door");
  assert.equal(lineOfSight(map, map.entrance, map.exit), false, "discovery does not open the door");
  map.tiles[cellKey(map, door)] = "secret_door"; map.visible.clear();
  assert.equal(searchFloor(map, map.entrance, 2), 0, "search must not discover unseen secrets");
  for (let seed = 0; seed < 40; seed++) {
    const generated = generateFloor(seed, 1);
    assert.equal(generated.tiles.filter((tile) => tile === "secret_door").length, 1);
    for (const room of generated.rooms) assert.ok(sameCell(room, generated.entrance) || findPath(generated, generated.entrance, room).length);
  }
});

test("search icon examines without turns, active search costs two ticks and six hunger, and cancel is safe", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "visible_rat", "chaser", { x: 13, z: 12 }, 8);
  game.click("search");
  assert.ok(game.ui.has("examine_prompt"));
  assert.equal(turnCount(game), 0);
  const before = JSON.stringify([...game.entities]); game.tick(50);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.tapCell({ x: 13, z: 12 });
  assert.equal(game.state().message, "MESSAGE");
  assert.match(game.ui.get("message_text")!.text!.replace(/\n/g, ""), /Marsupial Rat.*Health: 8/);
  assert.deepEqual(cell(game), { x: 12, z: 12 }); assert.equal(turnCount(game), 0);
  game.key("Escape"); removeMonsters(game);
  game.key("KeyF"); game.key("Escape");
  assert.equal(game.state().message, "PLAYING"); assert.ok(!game.ui.has("examine_prompt"));
  game.click("search"); game.click("cancel_examine"); assert.equal(turnCount(game), 0);
  for (let search = 0; search < 49; search++) { game.click("search"); game.click("search"); }
  assert.equal(turnCount(game), 98); assert.ok(!game.ui.has("hud_hunger"));
  game.key("KeyF"); game.key("KeyF");
  assert.equal(turnCount(game), 100); assert.equal(game.ui.get("hud_hunger")!.text, "Hungry");
  assert.equal(game.ui.get("hud_wave")!.text, "1", "search never descends");
});

test("examining remembered terrain does not disclose a hidden monster", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1);
  const remembered = { x: 4, z: 12 };
  walk(game, map, remembered);
  walk(game, map, map.entrance);
  putActor(game, "unseen_rat", "chaser", remembered, 99);
  game.resize(1281, 800); game.tick();
  const hp = game.state().lives, turns = turnCount(game);
  game.click("search"); game.tapCell(remembered);
  assert.equal(game.state().message, "MESSAGE");
  assert.ok(!game.ui.get("message_text")!.text!.includes("99"));
  assert.ok(!game.ui.get("message_text")!.text!.includes("Rat"));
  assert.equal(turnCount(game), turns); assert.equal(game.state().lives, hp);
});

test("held search clicks cannot repeat an active search after the UI is remounted", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.holdButton("search"); game.tick(20);
  assert.ok(game.ui.has("examine_prompt")); assert.equal(turnCount(game), 0);
  game.releaseButton(); game.holdButton("search"); game.tick(20);
  assert.ok(!game.ui.has("examine_prompt")); assert.equal(turnCount(game), 2);
  game.releaseButton();
});

test("waiting without input freezes actors, hunger and depth; blocked movement costs no turn", () => {
  const game = harness(); game.start();
  const before = JSON.stringify([...game.entities]);
  game.tick(4000);
  assert.equal(JSON.stringify([...game.entities]), before);
  assert.equal(turnCount(game), 0);
  assert.equal(game.ui.get("hud_wave")!.text, "1");
  removeMonsters(game);
  const map = generateFloor(1337, 1);
  const target = { x: 10, z: 10 };
  walk(game, map, target);
  const turn = turnCount(game);
  game.click("search");
  game.step(-1, -1); // The wall outside the north-west corner of the starting room.
  assert.deepEqual(cell(game), target);
  assert.equal(turnCount(game), turn);
  assert.ok(!game.ui.has("examine_prompt"), "blocked movement still cancels examine mode");
  game.key("Digit4");
  assert.equal(turnCount(game), turn, "an empty item slot consumes no turn");
});

test("door opening costs one turn and keyboard movement lands exactly on a tile", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1);
  const path = findPath(map, map.entrance, map.exit);
  const doorIndex = path.findIndex((point) => terrainAt(map, point) === "door");
  assert.ok(doorIndex > 0);
  walk(game, map, path[doorIndex - 1]!);
  const current = cell(game), next = path[doorIndex]!;
  game.step(next.x - current.x, next.z - current.z);
  assert.deepEqual(cell(game), current);
  assert.equal(game.entities.get(`terrain_${cellKey(map, next)}`)!.sprite!.path, "sprites/dungeon/open_door.png");
  game.step(next.x - current.x, next.z - current.z);
  assert.deepEqual(cell(game), next);
});

test("stairs require the exit tile and preserve hero health and inventory across all five depths", () => {
  const game = harness(); game.start();
  game.click("descend"); assert.equal(game.ui.get("hud_wave")!.text, "1");
  game.entities.get("player")!.body!.health = 20;
  for (let depth = 1; depth < 5; depth++) {
    removeMonsters(game);
    const map = generateFloor(1337, depth);
    walk(game, map, map.exit);
    game.click("descend");
    assert.deepEqual(cell(game), map.entrance);
    assert.equal(game.ui.get("hud_wave")!.text, String(depth + 1));
    assert.equal(game.entities.get("player")!.body!.health, 20);
    assert.ok(game.entities.size < 200, "previous terrain and actors must be removed");
  }
  assert.equal(game.entities.get("warden")!.body!.health, 100);
  assert.ok(game.ui.has("boss_panel"));
  removeMonsters(game);
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 1, 1);
  for (let attempt = 0; attempt < 20 && game.entities.has("warden"); attempt++) game.step(1, 0);
  assert.ok(!game.entities.has("warden"));
  assert.equal(game.state().message, "PLAYING", "boss death must not end the run");
  assert.ok(!game.saves.has("profile"), "boss death must not record a milestone");
  const drops = [...game.entities].filter(([, entity]) => entity.body?.kind === "loot");
  const keyDrops = drops.filter(([, entity]) => lootKinds[Number(entity.body!.power) - 1] === "worn_key");
  const blobs = drops.filter(([, entity]) => lootKinds[Number(entity.body!.power) - 1] === "goo_blob");
  assert.equal(keyDrops.length, 1); assert.deepEqual(cell(game, keyDrops[0]![0]), { x: 13, z: 12 });
  assert.ok(blobs.length >= 2 && blobs.length <= 4);
  game.step(1, 0);
  assert.ok(!game.entities.has(keyDrops[0]![0]), "the key must be picked up from its actual tile");
  game.key("KeyI");
  assert.equal(game.ui.get("item_count_worn_key")!.text, "1");
  game.click("slot_worn_key"); assert.match(game.ui.get("message_text")!.text!, /depth 5/);
  game.key("Escape"); game.key("Escape");
  const map = generateFloor(1337, 5);
  walk(game, map, map.exit);
  const beforeUnlock = turnCount(game);
  game.click("descend");
  assert.equal(game.state().message, "PLAYING");
  assert.equal(turnCount(game), beforeUnlock + 1, "unlocking spends a turn");
  game.key("KeyI"); assert.ok(!game.ui.has("slot_worn_key")); game.key("Escape");
  game.click("descend");
  assert.equal(game.state().message, "WON");
  assert.match(game.ui.get("result_title")!.text!, /Sewers milestone complete/);
  assert.match(game.ui.get("result_boundary")!.text!, /not available yet/);
  assert.equal(parseProfile(game.saves.get("profile")!).wins, 1);
  game.tick(50); assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.click("restart"); game.click("begin_run");
  assert.equal(game.state().lives, 20); assert.equal(turnCount(game), 0);
});

test("the sewer exit requires both the defeated boss and a physically collected key", () => {
  const game = harness(); game.start();
  for (let depth = 1; depth < 5; depth++) {
    removeMonsters(game);
    const map = generateFloor(1337, depth); walk(game, map, map.exit); game.click("descend");
  }
  const map = generateFloor(1337, 5);
  // Fixture placement checks the exit gate independently of the boss's pathfinding.
  putActor(game, "player", "player", map.exit, 100);
  game.resize(1281, 800); game.tick();
  const before = turnCount(game); game.click("descend");
  assert.equal(turnCount(game), before); assert.equal(game.state().message, "PLAYING");
  assert.ok(!game.saves.has("profile"));
  removeMonsters(game);
  const target = findPath(map, map.exit, map.entrance)[0]!;
  putActor(game, "warden", "boss", target, 1);
  for (let attempt = 0; attempt < 30 && game.entities.has("warden"); attempt++) {
    game.entities.get("warden")!.body!.lifetime = 0;
    game.step(target.x - map.exit.x, target.z - map.exit.z);
  }
  assert.ok(!game.entities.has("warden")); assert.deepEqual(cell(game), map.exit);
  const killedAt = turnCount(game); game.click("descend");
  assert.equal(game.state().message, "PLAYING"); assert.equal(turnCount(game), killedAt);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /Collect the Worn Key/);
  assert.ok(!game.saves.has("profile"));
  const blobDrop = [...game.entities].find(([, entity]) => entity.body?.kind === "loot" && lootKinds[Number(entity.body.power) - 1] === "goo_blob")!;
  assert.ok(blobDrop);
  const blobCell = cell(game, blobDrop[0]);
  // A drop on the current tile is collected when the hero steps off and back.
  walk(game, map, target); walk(game, map, blobCell);
  if (game.entities.has(blobDrop[0])) { walk(game, map, target); walk(game, map, blobCell); }
  game.key("KeyI"); assert.ok(game.ui.has("slot_goo_blob"));
  const beforeInfo = turnCount(game); game.click("slot_goo_blob");
  assert.match(game.ui.get("message_text")!.text!, /not available/);
  assert.equal(turnCount(game), beforeInfo); assert.ok(!game.ui.has("use_goo_blob"));
});

test("bump attacks consume turns, break invisibility and never move into an occupied cell", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "target", "chaser", { x: 13, z: 12 });
  const health = game.state().lives;
  game.key("Digit3");
  assert.equal(game.state().lives, health, "invisible heroes cannot be attacked");
  assert.ok(game.ui.has("hud_invisible"));
  game.step(1, 0);
  assert.deepEqual(cell(game), { x: 12, z: 12 });
  assert.ok((game.entities.get("target")!.body!.health as number) < 1000);
  assert.ok(!game.ui.has("hud_invisible"));
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("Surprise attack!")));
  const snapshot = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), snapshot, "enemies only retaliate after an action");
});

test("magic mapping reveals terrain while hidden monsters and items stay hidden", () => {
  const game = harness(); game.click("start"); game.click("hero_mage"); game.click("begin_run"); game.key("Digit6");
  const map = generateFloor(1337, 1);
  reveal(map, map.entrance);
  assert.equal([...game.entities.keys()].filter((id) => id.startsWith("terrain_")).length, 625);
  for (const [id, entity] of game.entities) {
    if (entity.body?.kind !== "chaser" && entity.body?.kind !== "loot") continue;
    const visible = map.visible.has(cellKey(map, cell(game, id)));
    assert.equal((entity.transform.scale as { x: number }).x, visible ? 1 : 0);
  }
});

test("viewport changes preserve every real actor tile and update sprite dimensions", () => {
  const game = harness(); game.start(); game.step(1, 0);
  const before = new Map([...game.entities].filter(([, entity]) => entity.body).map(([id]) => [id, cell(game, id)]));
  game.resize(450, 800); game.tick();
  assert.ok(game.entities.get("terrain_312")!.sprite!.width < 22);
  for (const [id, point] of before) assert.deepEqual(cell(game, id), point);
  game.resize(1280, 800); game.tick();
  assert.equal(game.entities.get("terrain_312")!.sprite!.width, 16);
  for (const [id, point] of before) assert.deepEqual(cell(game, id), point);
});

test("upstream basic sewer statistics, hero vitality and hunger boundaries", () => {
  assert.deepEqual([enemySpecs.chaser.health, enemySpecs.ranger.health, enemySpecs.charger.health, enemySpecs.boss.health], [8, 12, 15, 100]);
  assert.deepEqual([mobCombat.chaser.attack, mobCombat.ranger.attack, mobCombat.charger.attack], [8, 10, 12]);
  assert.equal(enemySpecs.charger.speed, 2);
  for (const hero of heroClassList) assert.equal(heroClasses[hero].baseHealth, 20);
  assert.deepEqual([299, 300, 449, 450].map(getHungerStatus), ["satiated", "hungry", "hungry", "starving"]);
});

test("hunger advances with turns, food takes three turns, and waiting grants no instant heal", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 4;
  game.click("wait");
  assert.equal(game.state().lives, 4);
  for (let turn = 1; turn < 301; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "Hungry");
  game.entities.get("player")!.body!.health = 4;
  game.key("Digit7");
  assert.equal(game.state().lives, 4, "food must not directly heal the hero");
  assert.equal(turnCount(game), 304);
  assert.ok(!game.ui.has("hud_hunger"));
  for (let turn = 0; turn < 449; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "Starving");
  game.entities.get("player")!.body!.health = 20;
  for (let turn = 0; turn < 10; turn++) game.click("wait");
  assert.equal(game.state().lives, 20, "starvation accumulates maximum HP/1000 per tick instead of one damage per ten turns");
});

test("survival actors keep independent fractional deadlines and freeze while idle or in menus", () => {
  const game = harness(); game.click("start"); game.click("hero_huntress"); game.click("begin_run"); removeMonsters(game);
  const hunger = game.entities.get(buffId("hunger", "player"))!.body!, regen = game.entities.get(buffId("regeneration", "player"))!.body!;
  hunger.cooldown = 0.25; regen.cooldown = 0.5; regen.power = Math.fround(0.9);
  game.entities.get("player")!.body!.health = 4;
  putActor(game, "target", "chaser", { x: 13, z: 12 }); game.entities.get("target")!.body!.cooldown = 100;
  game.step(1, 0);
  assert.equal(turnCount(game), 0.5); assert.equal(hunger.health, 1); assert.equal(hunger.cooldown, 1.25);
  assert.equal(game.state().lives, 4, "the hero wins a tie with regeneration at 0.5");
  game.step(1, 0);
  assert.equal(turnCount(game), 1); assert.equal(regen.cooldown, 1.5); assert.equal(game.state().lives, 5);
  const before = JSON.stringify([...game.entities]);
  game.tick(100); game.key("KeyI"); game.tick(100); game.key("Escape"); game.key("Escape"); game.tick(100); game.key("Escape");
  assert.equal(JSON.stringify([...game.entities]), before);
});

test("natural regeneration counts eligible wounded ticks and runs before lethal damage", () => {
  const game = harness(); game.start("huntress"); removeMonsters(game);
  const regen = game.entities.get(buffId("regeneration", "player"))!.body!;
  for (let tick = 0; tick < 9; tick++) game.click("wait");
  assert.equal(regen.power, 0, "full health must not build up healing credit");
  game.entities.get("player")!.body!.health = 4;
  for (let tick = 0; tick < 9; tick++) game.click("wait");
  assert.equal(game.state().lives, 4);
  game.click("wait"); assert.equal(game.state().lives, 5);
  game.entities.get("player")!.body!.health = 1; regen.power = Math.fround(0.9);
  const burn = putBuff(game, "burning", "player", 1); game.entities.get(burn)!.body!.power = 1;
  game.click("wait"); assert.equal(game.state().message, "PLAYING"); assert.equal(game.state().lives, 1);
  game.entities.get(buffId("hunger", "player"))!.body!.health = 450; regen.power = Math.fround(0.9);
  game.click("wait"); assert.equal(game.state().lives, 1); assert.equal(regen.power, Math.fround(0.9), "starvation pauses the accumulator");
});

test("entering starvation hurts once and subsequent damage follows maximum-health accumulation", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  hunger.health = 449; game.click("wait");
  assert.equal(game.state().lives, 19); assert.equal(hunger.health, 450);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /starving/);
  for (let tick = 0; tick < 50; tick++) game.click("wait");
  assert.equal(game.state().lives, 19);
  game.click("wait"); assert.equal(game.state().lives, 18); assert.equal(hunger.health, 450);
});

test("eating preserves the hunger actor phase and remainder, while searching applies overflow damage", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  hunger.health = 450; hunger.power = Math.fround(0.9); hunger.cooldown = 0.5;
  game.key("Digit7");
  assert.equal(turnCount(game), 3); assert.equal(hunger.health, 153);
  assert.equal(hunger.power, Math.fround(0.9)); assert.equal(hunger.cooldown, 3.5);
  hunger.health = 448; hunger.power = Math.fround(0.99);
  game.click("search"); game.click("search");
  assert.equal(turnCount(game), 5); assert.equal(hunger.health, 450);
  assert.equal(game.state().lives, 18, "crossing the threshold and converting excess hunger both deal damage");
  assert.ok(Math.abs(Number(hunger.power) - 0.07) < 1e-6);
});

function exhaustBossWindow(game: Game): void {
  removeMonsters(game);
  // Let Goo notice naturally, then defer its next action to isolate passive time.
  putActor(game, "warden", "boss", { x: 12, z: 10 }, 100);
  game.entities.get("player")!.body!.health = 4;
  const hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  hunger.health = 200; hunger.power = Math.fround(0.4);
  game.click("wait"); assert.ok(game.entities.has(buffId("locked_floor", "player")));
  game.entities.get("warden")!.body!.cooldown = 1000;
  for (let tick = 1; tick < 60; tick++) game.click("wait");
}

test("a noticed boss grants fifty regeneration ticks while hunger stays frozen after the window expires", () => {
  const game = harness(); game.start(); exhaustBossWindow(game);
  const lock = game.entities.get(buffId("locked_floor", "player"))!.body!, hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  assert.equal(lock.health, 0); assert.equal(game.state().lives, 9);
  assert.equal(hunger.health, 200); assert.equal(hunger.power, Math.fround(0.4));
  assert.equal(game.ui.get("hud_locked_floor")!.text, "Regen off");
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.click("search"); game.click("search");
  assert.equal(hunger.health, 200, "intentional search also spends no hunger on a locked floor");
  assert.equal(lock.health, 0, "searching does not reset the depleted window");
  game.key("Digit1"); assert.equal(game.state().lives, 17, "a spent passive window must not suppress healing potions");
  assert.equal(hunger.health, 200);
});

test("hurting Goo restores the passive window without resetting it and killing Goo immediately unseals", () => {
  const game = harness(); game.start(); exhaustBossWindow(game);
  const lockId = buffId("locked_floor", "player"), lock = game.entities.get(lockId)!.body!;
  const regen = game.entities.get(buffId("regeneration", "player"))!.body!, hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 100); game.entities.get("warden")!.body!.cooldown = 1000;
  regen.power = Math.fround(0.9);
  let damage = 0;
  for (let attempt = 0; attempt < 10 && !damage; attempt++) {
    const before = Number(game.entities.get("warden")!.body!.health);
    game.entities.get("warden")!.body!.lifetime = 0; game.step(1, 0);
    damage = before - Number(game.entities.get("warden")!.body!.health);
  }
  assert.ok(damage > 0); assert.equal(lock.health, Math.min(50, damage * 1.5) - 1);
  assert.equal(game.state().lives, 10, "damage re-enables the waiting partial regeneration");
  lock.health = 49;
  let capped = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = Number(game.entities.get("warden")!.body!.health);
    game.entities.get("warden")!.body!.lifetime = 0; game.step(1, 0);
    if (Number(game.entities.get("warden")!.body!.health) < before) {
      assert.equal(lock.health, 49, "damage caps the window at fifty before its next tick"); capped = true; break;
    }
  }
  assert.ok(capped);
  game.entities.get("warden")!.body!.health = 1;
  for (let attempt = 0; attempt < 10 && game.entities.has("warden"); attempt++) {
    game.entities.get("warden")!.body!.lifetime = 0; game.step(1, 0);
  }
  assert.ok(!game.entities.has("warden")); assert.ok(!game.entities.has(lockId)); assert.ok(!game.ui.has("hud_locked_floor"));
  assert.equal(hunger.health, 201, "hunger resumes during the action that defeats Goo");
});

test("descent preserves the actual hunger and regeneration components and their accumulated values", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1); walk(game, map, map.exit);
  const hungerId = buffId("hunger", "player"), regenId = buffId("regeneration", "player");
  const hunger = game.entities.get(hungerId)!.body!, regen = game.entities.get(regenId)!.body!;
  hunger.health = 200; hunger.power = Math.fround(0.7); regen.power = Math.fround(0.6);
  game.click("descend");
  assert.equal(game.entities.get(hungerId)!.body, hunger); assert.equal(game.entities.get(regenId)!.body, regen);
  assert.equal(hunger.health, 201); assert.equal(hunger.power, Math.fround(0.7)); assert.equal(regen.power, Math.fround(0.6));
  assert.equal(hunger.cooldown, game.entities.get("player")!.body!.cooldown);
});

test("lethal starvation removes all scheduled buffs and a new run starts with fresh survival state", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 1;
  game.entities.get(buffId("hunger", "player"))!.body!.health = 449;
  game.click("wait"); assert.equal(game.state().message, "LOST");
  assert.ok(![...game.entities.values()].some((entity) => entity.body?.kind?.toString().startsWith("buff_")));
  game.tick(100); assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.click("restart"); game.click("begin_run");
  for (const type of ["hunger", "regeneration"] as const) {
    const body = game.entities.get(buffId(type, "player"))!.body!;
    assert.equal(body.health, 0); assert.equal(body.power, 0); assert.equal(body.cooldown, 0);
  }
});

test("generated native sprites retain upstream frame sizes and manifest checksums", () => {
  const manifest = JSON.parse(readFileSync(resolve(assets, "licenses/sources.json"), "utf8")) as {
    spriteRecords: { file: string; sha256: string }[];
  };
  assert.ok(manifest.spriteRecords.length >= 20);
  for (const entry of manifest.spriteRecords) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(assets, entry.file))).digest("hex"), entry.sha256);
  }
  for (const [name, width, height] of [["warrior", 12, 15], ["gnoll", 12, 15], ["goo", 20, 14], ["exit", 16, 16], ["broken_seal", 13, 13]] as const) {
    const png = readFileSync(resolve(assets, `sprites/dungeon/${name}.png`));
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[25], 6, "indexed upstream assets must become real RGBA sprites");
  }
});

test("original images and new Goo drops have immutable source provenance and verified hashes", () => {
  const source = JSON.parse(readFileSync(resolve(assets, "licenses/sources.json"), "utf8")) as {
    revision: string; sourceRecords: { file: string; source: string; sha256: string }[];
    spriteRecords: { file: string; source: string; sha256: string }[];
  };
  assert.equal(source.revision, "57a4e06a4caf162446d1c28caa7983f0493fecf0");
  assert.equal(source.sourceRecords.length, 33);
  for (const record of [...source.sourceRecords, ...source.spriteRecords]) {
    assert.ok(record.source.includes(`/${source.revision}/`));
    assert.equal(createHash("sha256").update(readFileSync(resolve(assets, record.file))).digest("hex"), record.sha256);
  }
  for (const item of ["worn_key", "goo_blob"]) assert.ok(source.spriteRecords.some((record) => record.file === `sprites/dungeon/${item}.png`));
});

test("hints affect the HUD and unavailable sensitivity preserves legacy settings and exact tile input", () => {
  const profile = { ...defaultProfile(), sensitivity: 1.25 };
  const game = harness(1280, 800, false, new Map([["profile", JSON.stringify(profile)]]));
  game.start(); removeMonsters(game); assert.ok(game.ui.has("hud_hint"));
  game.click("pause"); game.click("settings"); game.setting("hints");
  game.setting("sensitivity");
  assert.ok(game.ui.has("sensitivity_unavailable"));
  assert.equal(parseProfile(game.saves.get("profile")!).sensitivity, 1.25);
  game.key("Escape"); assert.ok(!game.ui.has("hud_hint"));
  const turn = turnCount(game); game.tapCell({ x: 13, z: 12 }); game.tick(5);
  assert.deepEqual(cell(game), { x: 13, z: 12 }); assert.equal(turnCount(game), turn + 1);
});

test("reduced effects disables Goo camera shake without changing authoritative actor positions", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 1000;
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 40);
  game.entities.get("warden")!.body!.power = 2;
  game.click("wait");
  const heroX = (game.entities.get("player")!.transform.translation as { x: number }).x;
  assert.notEqual(game.camera().x, heroX);
  const before = JSON.stringify([...game.entities]); game.tick(10);
  assert.equal(game.camera().x, heroX); assert.equal(JSON.stringify([...game.entities]), before);
  game.click("pause"); game.click("settings"); game.setting("motion"); game.key("Escape");
  game.entities.get("warden")!.body!.power = 2;
  game.click("wait"); assert.equal(game.camera().x, heroX);
  assert.equal(parseProfile(game.saves.get("profile")!).reducedMotion, true);
});

test("Goo charges before its burst and heals in water even while sleeping", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 100;
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 40);
  game.entities.get("warden")!.body!.power = 1;
  game.click("wait");
  assert.equal(game.entities.get("warden")!.body!.power, 2);
  assert.equal(game.state().lives, 100, "the second pump-up stage spends a turn without attacking");
  game.click("wait");
  assert.equal(game.entities.get("warden")!.body!.power, 0);
  assert.ok(game.state().lives < 100, "the charged burst resolves on the following action");
  const map = generateFloor(1337, 1);
  const key = map.tiles.findIndex((tile, index) => tile === "water" && Math.abs(index % 25 - 12) > 7);
  assert.ok(key >= 0);
  putActor(game, "warden", "boss", { x: key % 25, z: Math.floor(key / 25) }, 40);
  game.click("wait");
  assert.equal(game.entities.get("warden")!.body!.health, 41);
});

test("click walking stops at a door when a previously hidden enemy appears", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1);
  const path = findPath(map, map.entrance, map.exit);
  const index = path.findIndex((point) => terrainAt(map, point) === "door");
  walk(game, map, path[index - 1]!);
  putActor(game, "hidden_rat", "chaser", path[index + 1]!);
  const door = path[index]!, before = cell(game);
  game.tapCell(door);
  game.tick(20);
  assert.deepEqual(cell(game), before);
  assert.equal(game.entities.get(`terrain_${cellKey(map, door)}`)!.sprite!.path, "sprites/dungeon/open_door.png");
  assert.equal((game.entities.get("hidden_rat")!.transform.scale as { x: number }).x, 1);
});


function turnCount(game: Game): number { return Number(game.entities.get("player")!.body!.lifetime); }

function putBuff(game: Game, type: BuffKind, target: string, left: number, acted = false): string {
  const id = buffId(type, target);
  putActor(game, id, `buff_${type}`, cell(game, target), left, 0);
  game.entities.get(id)!.body!.cooldown = game.entities.get("player")!.body!.cooldown;
  game.entities.get(id)!.body!.lifetime = acted ? 1 : 0;
  return id;
}

test("healing acts before lethal ooze and healing potions do not cure that ooze", () => {
  const game = harness(); game.start("huntress"); removeMonsters(game);
  game.entities.get("player")!.body!.health = 1;
  const ooze = putBuff(game, "ooze", "player", 20);
  game.key("Digit1");
  assert.equal(game.state().message, "PLAYING");
  assert.equal(game.entities.get("player")!.body!.health, 8, "heal eight before ooze takes one");
  assert.equal(game.entities.get(ooze)!.body!.health, 19);
  assert.equal(game.entities.get(buffId("healing", "player"))!.body!.health, 22);
  assert.ok(game.ui.has("hud_healing") && game.ui.has("hud_ooze"));
});

test("healing reapplication combines maximum budgets without stacking, and idle frames do not heal", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 4;
  game.key("Digit1");
  assert.equal(game.entities.get("player")!.body!.health, 12);
  const before = JSON.stringify([...game.entities]); game.tick(500);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.key("Digit1");
  const id = buffId("healing", "player");
  assert.equal(game.entities.get("player")!.body!.health, 20);
  assert.equal(game.entities.get(id)!.body!.health, 22, "max(22, 30), then one eight-point tick");
  assert.equal([...game.entities.values()].filter((entity) => entity.body?.kind === "buff_healing").length, 1);
  game.click("wait"); assert.equal(game.entities.get(id)!.body!.health, 16, "the budget still advances at full HP");
});

test("a healing buff attached between whole ticks keeps its own fractional phase", () => {
  const game = harness(); game.click("start"); game.click("hero_huntress"); game.click("begin_run"); removeMonsters(game);
  putActor(game, "target", "chaser", { x: 13, z: 12 }, 1000);
  game.entities.get("target")!.body!.cooldown = 100;
  game.step(1, 0); assert.equal(turnCount(game), 0.5);
  game.entities.get("player")!.body!.health = 4;
  game.key("Digit1");
  const id = buffId("healing", "player");
  assert.equal(game.entities.get(id)!.body!.cooldown, 1.5);
  assert.equal(game.entities.get("player")!.body!.health, 12);
  game.step(1, 0); assert.equal(turnCount(game), 2);
  assert.equal(game.entities.get(id)!.body!.cooldown, 2.5);
  assert.equal(game.entities.get("player")!.body!.health, 18);
});

test("player buffs survive descending while environmental fire stays on the old floor", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1); walk(game, map, map.exit);
  game.entities.get("player")!.body!.health = 1; game.key("Digit1");
  const id = buffId("healing", "player");
  assert.equal(game.entities.get(id)!.body!.health, 22);
  putActor(game, "old_fire", "fire_cell", { x: 12, z: 12 }, 2, 0);
  game.click("descend");
  assert.ok(!game.entities.has("old_fire"));
  assert.equal(game.entities.get(id)!.body!.health, 16);
  assert.ok(Number(game.entities.get("player")!.body!.health) >= 15);
  removeMonsters(game); const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
});

test("only the Warrior starts with a real seal affixed to cloth armor and an empty shield buff", () => {
  for (const hero of heroClassList) {
    const game = harness(); game.start(hero); removeMonsters(game);
    assert.equal(game.entities.has(sealId), hero === "warrior");
    assert.equal(game.entities.has(shieldId), hero === "warrior");
    game.key("KeyI"); assert.ok(!game.ui.has("slot_broken_seal"));
    assert.equal(game.ui.has("gear_seal_2"), hero === "warrior");
    if (hero === "warrior") {
      assert.equal(game.entities.get(sealId)!.body!.power, 2);
      const shield = game.entities.get(shieldId)!.body!;
      assert.deepEqual([shield.health, shield.power, shield.speed, shield.lifetime, shield.cooldown], [0, 0, 0, 0, 0]);
      game.click("gear_slot_2"); assert.match(game.ui.get("gear_detail_stats")!.text!, /Shield capacity: 5/);
      assert.ok(game.ui.has("detach_seal"));
    }
  }
});

test("a low-health burn activates a shield before damage and idle frames freeze its clock", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.entities.get("player")!.body!.health = 10;
  const burn = putBuff(game, "burning", "player", 1); game.entities.get(burn)!.body!.power = 1;
  game.click("wait"); const shield = game.entities.get(shieldId)!.body!;
  assert.equal(game.state().lives, 10);
  assert.deepEqual([shield.health, shield.power, shield.speed, shield.lifetime, shield.cooldown], [4, 149, 1, 5, 1]);
  assert.equal(game.ui.get("hud_shield")!.text, "Shield 4");
  const before = JSON.stringify([...game.entities]); game.tick(100); assert.equal(JSON.stringify([...game.entities]), before);
  for (let tick = 0; tick < 4; tick++) game.click("wait");
  assert.deepEqual([shield.health, shield.power, shield.speed], [0, 85, 5]);
  assert.equal(game.ui.get("hud_shield")!.text, "Shield CD 85");
});

test("visible enemies retain shielding and the next activation waits for its cooldown", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "visible", "chaser", { x: 13, z: 12 }); game.entities.get("visible")!.body!.cooldown = 1000;
  game.entities.get("player")!.body!.health = 10;
  let burn = putBuff(game, "burning", "player", 1); game.entities.get(burn)!.body!.power = 1;
  game.click("wait"); const shield = game.entities.get(shieldId)!.body!;
  for (let tick = 0; tick < 6; tick++) game.click("wait");
  assert.equal(shield.health, 4); assert.equal(shield.speed, 0);
  burn = putBuff(game, "burning", "player", 1); game.entities.get(burn)!.body!.power = 6;
  game.click("wait"); assert.equal(game.state().lives, 8); assert.equal(shield.health, 0); assert.equal(shield.power, 142);
  for (let tick = 0; tick < 142; tick++) game.click("wait");
  assert.equal(shield.power, 0); game.entities.get("player")!.body!.health = 10;
  burn = putBuff(game, "burning", "player", 1); game.entities.get(burn)!.body!.power = 1;
  game.click("wait"); assert.equal(shield.health, 4); assert.equal(shield.power, 149);
});

test("hunger bypasses shielding and starvation does not pause the seal cooldown", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const shield = game.entities.get(shieldId)!.body!, hunger = game.entities.get(buffId("hunger", "player"))!.body!;
  game.entities.get("player")!.body!.health = 10; hunger.health = 449;
  game.click("wait"); assert.equal(game.state().lives, 9); assert.equal(shield.power, 0); assert.equal(shield.health, 0);
  shield.health = 5; shield.power = 100; shield.lifetime = 5; hunger.power = Math.fround(0.99);
  game.click("wait"); assert.equal(game.state().lives, 8); assert.equal(shield.health, 5); assert.equal(shield.power, 99);
});

test("an exhausted LockedFloor pauses shield cooldown and damaging Goo resumes it", () => {
  const game = harness(); game.start(); exhaustBossWindow(game);
  const shield = game.entities.get(shieldId)!.body!; shield.power = 10; shield.health = 0;
  for (let tick = 0; tick < 3; tick++) game.click("wait");
  assert.equal(shield.power, 10);
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 100); game.entities.get("warden")!.body!.cooldown = 1000;
  game.step(1, 0); assert.equal(shield.power, 9);
});

test("a seal keeps one armor upgrade when detached and reaffixed without spending an action", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.key("Digit5"); assert.ok(!game.ui.has("upgrade_0")); game.click("upgrade_2");
  assert.equal(game.entities.get(sealId)!.body!.lifetime, 1);
  putActor(game, "scroll", "loot", { x: 13, z: 12 }, 1, 0);
  game.entities.get("scroll")!.body!.power = lootKinds.indexOf("scroll_upgrade") + 1; game.step(1, 0);
  game.key("Digit5"); game.click("upgrade_2");
  assert.equal(game.entities.get(sealId)!.body!.lifetime, 1, "further armor upgrades stay on the armor");
  const before = turnCount(game); game.key("KeyI"); game.click("gear_slot_2"); game.click("detach_seal");
  assert.equal(turnCount(game), before); assert.equal(game.entities.get(sealId)!.body!.power, 0);
  assert.match(game.ui.get("gear_detail_title")!.text!, /\+1/, "detaching takes exactly one level from +2 armor");
  game.key("Escape"); assert.ok(game.ui.has("slot_broken_seal")); assert.equal(game.ui.get("item_level_seal")!.text, "+1");
  game.click("slot_broken_seal"); game.click("use_broken_seal"); assert.ok(game.ui.has("affix_2")); assert.ok(!game.ui.has("affix_1"));
  game.click("upgrade_cancel"); assert.equal(turnCount(game), before);
  game.click("slot_broken_seal"); game.click("use_broken_seal"); game.click("affix_2");
  assert.equal(turnCount(game), before); assert.equal(game.entities.get(sealId)!.body!.power, 2);
  assert.match(game.ui.get("gear_detail_title")!.text!, /\+2/);
  assert.match(game.ui.get("gear_detail_stats")!.text!, /Shield capacity: 5/);
});

test("a loose seal accepts one scroll upgrade and cannot consume a second scroll", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.key("KeyI"); game.click("gear_slot_2"); game.click("detach_seal"); game.key("Escape"); game.key("Escape");
  game.key("Digit5"); assert.ok(game.ui.has("upgrade_0")); game.click("upgrade_0");
  assert.equal(turnCount(game), 1); assert.equal(game.entities.get(sealId)!.body!.lifetime, 1);
  putActor(game, "scroll", "loot", { x: 13, z: 12 }, 1, 0);
  game.entities.get("scroll")!.body!.power = lootKinds.indexOf("scroll_upgrade") + 1; game.step(1, 0);
  game.key("Digit5"); assert.ok(!game.ui.has("upgrade_0")); game.click("upgrade_cancel");
  game.click("slot_broken_seal"); game.click("use_broken_seal"); game.click("affix_2");
  assert.match(game.ui.get("gear_detail_title")!.text!, /\+1/);
});

test("unequipping sealed armor keeps a spent shield until cooldown expiry and reequipping restores it", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const shield = game.entities.get(shieldId)!.body!; shield.power = 2;
  game.key("KeyI"); game.click("gear_slot_2"); game.click("toggle_equipment");
  assert.equal(shield.power, 1); assert.equal(game.entities.get(sealId)!.body!.power, 2);
  game.click("wait"); assert.ok(!game.entities.has(shieldId));
  game.key("KeyI"); game.click("gear_slot_2"); game.click("toggle_equipment");
  assert.ok(game.entities.has(shieldId)); assert.equal(game.entities.get(shieldId)!.body!.power, 0);
});

test("armor replacement waits for a seal-transfer choice and moves its upgrade only when accepted", () => {
  for (const transfer of [false, true]) {
    const game = harness(); game.start(); removeMonsters(game); game.key("Digit5"); game.click("upgrade_2");
    putActor(game, "armor_drop", "loot", { x: 13, z: 12 }, 1, 0);
    game.entities.get("armor_drop")!.body!.power = lootKinds.indexOf("leather_armor") + 1; game.step(1, 0);
    game.key("KeyI"); game.click("gear_slot_3");
    const before = turnCount(game), shield = game.entities.get(shieldId)!.body!, deadline = shield.cooldown;
    game.click("toggle_equipment"); assert.ok(game.ui.has("seal_transfer_window"));
    game.tick(100); game.key("Escape"); assert.ok(game.ui.has("seal_transfer_window"));
    assert.equal(turnCount(game), before); assert.equal(shield.cooldown, deadline);
    game.click(transfer ? "seal_transfer_yes" : "seal_transfer_no"); assert.equal(turnCount(game), before + 2);
    assert.equal(game.entities.get(sealId)!.body!.power, transfer ? 3 : 2);
    game.key("KeyI"); game.click("gear_slot_3");
    assert.equal(game.ui.get("gear_detail_title")!.text!.includes("+1"), transfer);
    assert.equal(game.ui.has("detach_seal"), transfer);
    if (transfer) assert.match(game.ui.get("gear_detail_stats")!.text!, /Shield capacity: 7/);
  }
});

test("descent retains the real seal and shield and death removes them before a fresh restart", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1); walk(game, map, map.exit);
  const item = game.entities.get(sealId)!.body!, shield = game.entities.get(shieldId)!.body!;
  shield.power = 100; const before = turnCount(game); game.click("descend");
  assert.equal(game.entities.get(sealId)!.body, item); assert.equal(game.entities.get(shieldId)!.body, shield);
  assert.equal(turnCount(game), before + 1); assert.equal(shield.power, 99);
  removeMonsters(game); game.entities.get("player")!.body!.health = 1;
  game.entities.get(buffId("hunger", "player"))!.body!.health = 449;
  game.click("wait"); assert.equal(game.state().message, "LOST");
  assert.ok(!game.entities.has(sealId)); assert.ok(!game.entities.has(shieldId));
  game.click("restart"); game.click("begin_run");
  assert.deepEqual([game.entities.get(sealId)!.body!.power, game.entities.get(sealId)!.body!.lifetime, game.entities.get(shieldId)!.body!.power], [2, 0, 0]);
});

test("Chinese seal windows fit portrait and short landscape and held detach or affix costs no turn", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) {
    const game = harness(width, height, mobile, new Map(), false, "zh-CN"); game.start(); removeMonsters(game);
    game.key("KeyI"); game.click("gear_slot_2"); assert.match(game.ui.get("gear_detail_stats")!.text!, /护盾上限：5/);
    const style = game.ui.get("equipment_window")!.style!;
    assert.ok(Number(style.top) >= 0); assert.ok(Number(style.top) + Number(style.height) <= Number(game.ui.get("safe_root")!.style!.height));
    game.holdButton("detach_seal"); game.tick(30); game.releaseButton(); assert.equal(turnCount(game), 0);
    game.key("Escape"); game.click("slot_broken_seal"); game.click("use_broken_seal");
    assert.equal(game.ui.get("upgrade_title")!.text, "选择附加纹章的护甲");
    game.holdButton("affix_2"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 0); assert.equal(game.entities.get(sealId)!.body!.power, 2);
    game.key("Escape"); game.key("Escape");
    putActor(game, "armor_drop", "loot", { x: 13, z: 12 }, 1, 0);
    game.entities.get("armor_drop")!.body!.power = lootKinds.indexOf("leather_armor") + 1; game.step(1, 0);
    game.key("KeyI"); game.click("gear_slot_3"); game.click("toggle_equipment");
    assert.match(game.ui.get("seal_transfer_prompt")!.text!, /纹章/);
    const transfer = game.ui.get("seal_transfer_window")!.style!;
    assert.ok(Number(transfer.top) >= 0); assert.ok(Number(transfer.top) + Number(transfer.height) <= Number(game.ui.get("safe_root")!.style!.height));
    const before = turnCount(game); game.holdButton("seal_transfer_yes"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), before + 2); assert.equal(game.entities.get(sealId)!.body!.power, 3);
  }
});

function rogue(game = harness()): Game {
  game.click("start"); game.click("hero_rogue"); game.click("begin_run"); removeMonsters(game); return game;
}

test("only the Rogue starts with a real equipped cloak in the artifact slot and first quick slot", () => {
  for (const hero of heroClassList) {
    const game = harness(); game.click("start"); game.click(`hero_${hero}`); game.click("begin_run"); removeMonsters(game);
    assert.equal(game.entities.has(cloakId), hero === "rogue");
    assert.equal(game.ui.has("quick_cloak_of_shadows"), hero === "rogue");
    game.key("KeyI"); assert.equal(game.ui.has("slot_cloak_of_shadows"), hero === "rogue");
    if (hero === "rogue") {
      const state = game.entities.get(cloakId)!.body!;
      assert.deepEqual([state.health, state.power, state.lifetime, state.speed, state.velocity_x], [3, 0, 0, 0, 1]);
      assert.ok(!game.ui.has("equipment_2")); assert.equal(game.ui.get("item_charge_cloak")!.text, "3/3");
      game.click("slot_cloak_of_shadows"); assert.equal(game.ui.get("use_cloak_of_shadows__label")!.text, "Stealth");
    }
  }
});

test("cloak activation spends one tick and one charge before stealth can freeze indefinitely while idle", () => {
  const game = rogue(); putActor(game, "target", "chaser", { x: 13, z: 12 });
  game.key("KeyC"); const cloak = game.entities.get(cloakId)!.body!;
  assert.equal(turnCount(game), 1); assert.equal(game.state().lives, 20);
  assert.equal(cloak.health, 2); assert.equal(cloak.speed, 10); assert.equal(game.entities.get(cloakBuffId)!.body!.health, 4);
  assert.ok(game.ui.has("hud_invisible"));
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.key("KeyC"); assert.equal(turnCount(game), 1); assert.ok(!game.entities.has(cloakBuffId));
  assert.equal(cloak.health, 2); assert.ok(!game.ui.has("hud_invisible"));
});

test("the final cloak charge grants its full four ticks before exhaustion and empty activation is free", () => {
  const game = rogue(); game.click("quick_cloak_of_shadows");
  for (let tick = 1; tick < 12; tick++) game.click("wait");
  const cloak = game.entities.get(cloakId)!.body!;
  assert.equal(cloak.health, 0); assert.equal(cloak.speed, 30); assert.ok(game.entities.has(cloakBuffId));
  game.click("wait"); assert.equal(turnCount(game), 13); assert.ok(!game.entities.has(cloakBuffId));
  assert.ok(!game.ui.has("hud_invisible"));
  const before = JSON.stringify([...game.entities]); game.key("KeyC");
  assert.equal(turnCount(game), 13); assert.equal(JSON.stringify([...game.entities]), before);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /run out of energy/);
});

test("cloak and potion invisibility remain independent and a melee attack dispels both", () => {
  const game = rogue(), cloak = game.entities.get(cloakId)!.body!;
  cloak.lifetime = 7; cloak.health = 10; // Enough legitimate capacity to outlast a potion.
  game.key("Digit3"); game.key("KeyC");
  for (let tick = 0; tick < 20; tick++) game.click("wait");
  assert.ok(!game.entities.has(buffId("invisibility", "player"))); assert.ok(game.entities.has(cloakBuffId));
  assert.ok(game.ui.has("hud_invisible"));
  game.key("Digit3"); game.key("KeyC");
  assert.ok(!game.entities.has(cloakBuffId)); assert.ok(game.entities.has(buffId("invisibility", "player")));
  game.key("KeyC"); const charges = cloak.health;
  putActor(game, "target", "chaser", { x: 13, z: 12 }); game.entities.get("target")!.body!.cooldown = 1000;
  game.step(1, 0);
  assert.ok(!game.entities.has(cloakBuffId)); assert.ok(!game.entities.has(buffId("invisibility", "player")));
  assert.equal(cloak.health, charges, "attacking after a paid tick must not charge twice");
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /Surprise attack/);
});

test("unequipping cancels cloak stealth and freezes its passive phase until equipped again", () => {
  const game = rogue(), cloak = game.entities.get(cloakId)!.body!;
  cloak.health = 1; cloak.power = Math.fround(0.4); game.key("KeyC");
  game.key("KeyI"); game.click("slot_cloak_of_shadows"); game.click("toggle_cloak_equipment");
  assert.equal(turnCount(game), 2); assert.ok(!game.entities.has(cloakBuffId)); assert.equal(cloak.velocity_x, 0);
  const deadline = cloak.cooldown, partial = cloak.power;
  for (let tick = 0; tick < 10; tick++) game.click("wait");
  assert.equal(cloak.cooldown, deadline); assert.equal(cloak.power, partial);
  game.key("KeyC"); assert.equal(turnCount(game), 12);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /Equip the cloak/);
  game.key("KeyI"); assert.ok(game.ui.has("equipment_2")); game.click("slot_cloak_of_shadows"); game.click("toggle_cloak_equipment");
  assert.equal(turnCount(game), 13); assert.equal(cloak.velocity_x, 1); assert.equal(cloak.cooldown, 13);
  assert.ok(Number(cloak.power) > Number(partial));
});

test("inactive equipped cloak recharges using float action ticks rather than wall-clock time", () => {
  const game = rogue(), cloak = game.entities.get(cloakId)!.body!;
  game.key("KeyC"); game.key("KeyC");
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  for (let tick = 0; tick < 44; tick++) game.click("wait");
  assert.equal(cloak.health, 2); game.click("wait"); assert.equal(cloak.health, 3); assert.equal(cloak.power, 0);
});

test("using cloak energy grows its level and displayed capacity without accepting upgrade scrolls", () => {
  const game = rogue(), cloak = game.entities.get(cloakId)!.body!;
  for (let use = 0; use < 5; use++) {
    cloak.health = 3; // Isolate use-XP progression from separately tested recharge waits.
    game.key("KeyC"); game.key("KeyC");
  }
  assert.equal(cloak.lifetime, 1); assert.equal(cloak.speed, 0); assert.equal(cloak.health, 2);
  assert.equal(game.ui.get("quick_count_0")!.text, "2/4");
  game.key("Digit5"); assert.ok(![...game.ui.values()].some((entry) => entry.text?.includes("Cloak of Shadows")));
  game.click("upgrade_cancel"); game.key("Escape"); game.key("KeyI");
  assert.equal(game.ui.get("item_level_cloak")!.text, "+1"); game.click("slot_cloak_of_shadows");
  assert.match(game.ui.get("item_detail_desc")!.text!.replace(/\n/g, " "), /Experience: 0\/100/);
});

test("starvation allows cloak recharge while an exhausted boss window pauses it", () => {
  const game = rogue(), cloak = game.entities.get(cloakId)!.body!;
  cloak.health = 1; game.entities.get(buffId("hunger", "player"))!.body!.health = 450;
  game.click("wait"); assert.ok(Number(cloak.power) > 0);
  exhaustBossWindow(game); cloak.health = 1; cloak.power = 0.5;
  for (let tick = 0; tick < 5; tick++) game.click("wait");
  assert.equal(cloak.power, 0.5);
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 100); game.entities.get("warden")!.body!.cooldown = 1000;
  game.step(1, 0); assert.ok(Number(cloak.power) > 0.5);
});

test("descent retains cloak item and active-buff identity, energy and deadlines", () => {
  const game = rogue(), map = generateFloor(1337, 1); walk(game, map, map.exit);
  game.key("KeyC"); const item = game.entities.get(cloakId)!.body!, active = game.entities.get(cloakBuffId)!.body!;
  const before = turnCount(game); game.click("descend");
  assert.equal(turnCount(game), before + 1); assert.equal(game.entities.get(cloakId)!.body, item);
  assert.equal(game.entities.get(cloakBuffId)!.body, active); assert.equal(item.health, 2); assert.equal(active.health, 3);
  assert.equal(item.cooldown, turnCount(game)); assert.equal(active.cooldown, turnCount(game));
  game.key("KeyC"); assert.ok(!game.ui.has("hud_invisible"));
});

test("death removes cloak state and a restarted Rogue cannot inherit the previous cloak", () => {
  const game = rogue(); game.key("KeyC"); game.entities.get("player")!.body!.health = 1;
  const burn = putBuff(game, "burning", "player", 8); game.entities.get(burn)!.body!.power = 3;
  game.click("wait"); assert.equal(game.state().message, "LOST"); assert.ok(!game.entities.has(cloakId)); assert.ok(!game.entities.has(cloakBuffId));
  game.tick(100); assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.click("restart"); game.click("begin_run");
  const cloak = game.entities.get(cloakId)!.body!;
  assert.deepEqual([cloak.health, cloak.speed, cloak.lifetime, cloak.power], [3, 0, 0, 0]);
  assert.ok(!game.entities.has(cloakBuffId));
});

test("Chinese cloak controls fit portrait and short landscape and held activation spends one tick", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) {
    const game = rogue(harness(width, height, mobile, new Map(), false, "zh-CN"));
    game.key("KeyI"); game.click("slot_cloak_of_shadows");
    assert.equal(game.ui.get("item_detail_title")!.text, "暗影斗篷");
    const bounds = game.ui.get("item_window")!.style!, text = game.ui.get("item_detail_desc")!;
    assert.ok(Number(bounds.top) >= 0); assert.ok(Number(bounds.top) + Number(bounds.height) <= Number(game.ui.get("safe_root")!.style!.height));
    for (const line of text.text!.split("\n")) assert.ok(measureText("zh-CN", line, text.fontSize!) <= Number(text.style!.width) + 0.01);
    game.holdButton("use_cloak_of_shadows"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 1); assert.equal(game.entities.get(cloakId)!.body!.health, 2);
    game.key("KeyI"); game.click("slot_cloak_of_shadows");
    assert.equal(game.ui.get("use_cloak_of_shadows__label")!.text, "停止潜行");
    game.holdButton("use_cloak_of_shadows"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 1); assert.ok(!game.entities.has(cloakBuffId));
  }
});

function mage(game = harness()): Game {
  game.click("start"); game.click("hero_mage"); game.click("begin_run"); removeMonsters(game); return game;
}

test("the mage staff owns real charge state and exposes Zap without losing its melee action", () => {
  const game = mage(), charger = game.entities.get(staffChargeId(1))!.body!;
  assert.equal(charger.kind, "staff_charger"); assert.equal(charger.health, 4); assert.equal(charger.power, 0);
  assert.equal(game.ui.get("quick_count_0")!.text, "4/4");
  game.key("KeyI"); assert.equal(game.ui.get("gear_charge_1")!.text, "4/4"); game.click("gear_slot_1");
  assert.equal(game.ui.get("zap_staff__label")!.text, "Zap"); assert.ok(game.ui.has("toggle_equipment"));
  assert.match(game.ui.get("gear_detail_stats")!.text!.replace(/\n/g, " "), /Magic missile: 2–8/);
  game.click("zap_staff"); assert.match(game.ui.get("target_prompt")!.text!, /Magic continues/);
  game.click("cancel_target"); assert.equal(turnCount(game), 0);
});

test("staff targeting rejects self and unseen cells and idle or cancelled aim does not charge", () => {
  const game = mage(), before = JSON.stringify([...game.entities]);
  game.key("Digit3"); const afterPotion = JSON.stringify([...game.entities]);
  game.key("KeyZ"); game.tapCell({ x: 12, z: 12 });
  assert.equal(turnCount(game), 1); assert.equal(JSON.stringify([...game.entities]), afterPotion);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /cannot zap yourself/);
  game.tapCell({ x: 4, z: 12 }); game.tick(100); game.key("Escape");
  assert.equal(JSON.stringify([...game.entities]), afterPotion); assert.ok(before !== afterPotion);
  assert.ok(game.entities.has(buffId("invisibility", "player")));
});

test("magic missiles fly past an empty aim cell and always damage the first character without armor reduction", () => {
  const game = mage(), charge = game.entities.get(staffChargeId(1))!.body!;
  putActor(game, "front", "charger", { x: 12, z: 10 }); putActor(game, "behind", "chaser", { x: 12, z: 9 });
  for (const id of ["front", "behind"]) game.entities.get(id)!.body!.cooldown = 1000;
  for (let shot = 0; shot < 4; shot++) {
    const before = Number(game.entities.get("front")!.body!.health);
    game.click("quick_staff_1"); game.tapCell({ x: 12, z: 11 });
    const damage = before - Number(game.entities.get("front")!.body!.health);
    assert.ok(damage >= 2 && damage <= 8); assert.equal(charge.health, 3 - shot);
    assert.equal(game.entities.get("behind")!.body!.health, 1000); assert.equal(turnCount(game), shot + 1);
    assert.deepEqual(cell(game), { x: 12, z: 12 });
  }
  const before = JSON.stringify([...game.entities]); game.key("KeyZ");
  assert.equal(turnCount(game), 4); assert.ok(!game.ui.has("target_prompt"));
  assert.equal(JSON.stringify([...game.entities]), before);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /no charges/);
});

test("empty staff casts still spend a charge and a tick and dispel invisibility", () => {
  const game = mage(); game.key("Digit3"); game.key("KeyZ"); game.tapCell({ x: 12, z: 11 });
  assert.equal(turnCount(game), 2); assert.equal(game.entities.get(staffChargeId(1))!.body!.health, 3);
  assert.ok(!game.entities.has(buffId("invisibility", "player"))); assert.equal(game.state().lives, 20);
});

test("a carried unequipped staff recharges on eligible action ticks rather than idle frames", () => {
  const game = mage(), charge = game.entities.get(staffChargeId(1))!.body!;
  game.key("KeyZ"); game.tapCell({ x: 12, z: 11 });
  assert.equal(charge.health, 3);
  game.key("KeyI"); game.click("gear_slot_1"); game.click("toggle_equipment");
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  for (let tick = 2; tick < 40; tick++) game.click("wait");
  assert.equal(charge.health, 3, "forty float increments of 0.025 remain just below one");
  game.click("wait"); assert.equal(charge.health, 4); assert.equal(charge.power, 0);
  game.key("KeyI"); assert.ok(game.ui.has("equipment_0")); game.click("gear_slot_1"); game.click("zap_staff");
  assert.equal(turnCount(game), 41); assert.ok(game.ui.has("target_prompt"));
});

test("staff upgrades improve magic capacity and damage, restoring one charge without resetting its clock", () => {
  const game = mage(), charge = game.entities.get(staffChargeId(1))!.body!;
  game.key("KeyZ"); game.tapCell({ x: 12, z: 11 });
  game.key("Digit5"); game.click("upgrade_2"); assert.equal(charge.health, 3, "armor upgrades do not grant staff charges");
  const partial = Number(charge.power);
  game.key("Digit5"); game.click("upgrade_1");
  assert.equal(charge.health, 4); assert.ok(Number(charge.power) > partial); assert.equal(charge.cooldown, 3);
  assert.equal(game.ui.get("quick_count_0")!.text, "4/5");
  game.key("KeyI"); game.click("gear_slot_1");
  assert.match(game.ui.get("gear_detail_stats")!.text!.replace(/\n/g, " "), /Magic missile: 3–10/);
  game.click("zap_staff"); putActor(game, "target", "charger", { x: 13, z: 12 }); game.entities.get("target")!.body!.cooldown = 1000;
  game.tapCell({ x: 13, z: 12 }); const damage = 1000 - Number(game.entities.get("target")!.body!.health);
  assert.ok(damage >= 3 && damage <= 10); assert.equal(charge.health, 3);
});

test("starvation does not stop staff charging but a depleted boss passive window does", () => {
  const game = mage(), charge = game.entities.get(staffChargeId(1))!.body!;
  charge.health = 3; game.entities.get(buffId("hunger", "player"))!.body!.health = 450;
  game.click("wait"); assert.equal(charge.power, Math.fround(0.025));
  exhaustBossWindow(game);
  const before = { health: charge.health, power: charge.power };
  for (let tick = 0; tick < 5; tick++) game.click("wait");
  assert.deepEqual({ health: charge.health, power: charge.power }, before);
  // A real zap restores LockedFloor time and charging resumes that same action.
  charge.health = 1; charge.power = 0.5;
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 100); game.entities.get("warden")!.body!.cooldown = 1000;
  game.key("KeyZ"); game.tapCell({ x: 13, z: 12 });
  assert.ok(Number(charge.power) > 0.5); assert.ok(Number(game.entities.get(buffId("locked_floor", "player"))!.body!.health) >= 2);
});

test("staff chargers preserve fractional phases and actual component identity across descent", () => {
  const game = mage(), id = staffChargeId(1), charge = game.entities.get(id)!.body!;
  charge.health = 3; charge.cooldown = 0.5; game.click("wait");
  assert.equal(charge.cooldown, 1.5);
  const map = generateFloor(1337, 1); walk(game, map, map.exit);
  charge.health = 3; charge.power = 0.5;
  const deadline = Number(charge.cooldown); game.click("descend");
  assert.equal(game.entities.get(id)!.body, charge); assert.equal(charge.cooldown, deadline + 1);
  assert.equal(charge.power, Math.fround(0.525)); assert.ok(game.ui.has("quick_staff_1"));
});

test("staff charging is removed on death and cannot leak into another hero's run", () => {
  const game = mage(); game.entities.get("player")!.body!.health = 1;
  const burn = putBuff(game, "burning", "player", 8); game.entities.get(burn)!.body!.power = 3;
  game.click("wait"); assert.equal(game.state().message, "LOST"); assert.ok(!game.entities.has(staffChargeId(1)));
  game.click("restart"); game.click("hero_warrior"); game.click("begin_run");
  assert.ok(!game.entities.has(staffChargeId(1))); assert.ok(!game.ui.has("quick_staff_1"));
});

test("Chinese staff details and held Zap controls fit portrait and short landscape", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) {
    const game = mage(harness(width, height, mobile, new Map(), false, "zh-CN"));
    game.key("KeyI"); game.click("gear_slot_1");
    assert.equal(game.ui.get("zap_staff__label")!.text, "施法");
    const bounds = game.ui.get("equipment_window")!.style!;
    assert.ok(Number(bounds.top) >= 0); assert.ok(Number(bounds.top) + Number(bounds.height) <= Number(game.ui.get("safe_root")!.style!.height));
    const stats = game.ui.get("gear_detail_stats")!;
    assert.match(stats.text!, /魔弹伤害/);
    for (const line of stats.text!.split("\n")) assert.ok(measureText("zh-CN", line, stats.fontSize!) <= Number(stats.style!.width) + 0.01);
    const before = JSON.stringify([...game.entities]); game.holdButton("zap_staff"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 0); assert.equal(JSON.stringify([...game.entities]), before);
    assert.match(game.ui.get("target_prompt")!.text!, /魔弹/); game.click("cancel_target");
  }
});

function huntress(game = harness()): Game {
  game.click("start"); game.click("hero_huntress"); game.click("begin_run"); removeMonsters(game); return game;
}

test("only the Huntress starts with a carried spirit bow and its first quick slot", () => {
  for (const hero of heroClassList) {
    const game = harness(); game.click("start"); game.click(`hero_${hero}`); game.click("begin_run"); removeMonsters(game);
    assert.equal(game.ui.has("quick_spirit_bow"), hero === "huntress");
    game.key("KeyI"); assert.equal(game.ui.has("slot_spirit_bow"), hero === "huntress");
    if (hero === "huntress") {
      assert.equal(game.ui.get("item_ico_spirit_bow")!.image, "sprites/dungeon/spirit_bow.png");
      assert.ok(!game.ui.has("item_count_spirit_bow"));
      game.click("slot_spirit_bow"); assert.equal(game.ui.get("use_spirit_bow__label")!.text, "Shoot");
      assert.match(game.ui.get("item_detail_desc")!.text!.replace(/\n/g, " "), /Damage: 1–6/);
      assert.ok(!game.ui.has("toggle_equipment"));
      game.click("use_spirit_bow"); assert.match(game.ui.get("target_prompt")!.text!, /shoot/);
      game.click("cancel_target"); assert.equal(turnCount(game), 0);
    } else {
      game.key("Escape"); game.key("Digit8"); assert.ok(!game.ui.has("target_prompt")); assert.equal(turnCount(game), 0);
    }
  }
});

test("bow aim cancellation and switching to flame cannot consume items or advance effects", () => {
  const game = huntress(), before = JSON.stringify([...game.entities]);
  game.click("quick_spirit_bow"); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.tapCell({ x: 4, z: 12 }); assert.ok(game.ui.has("target_prompt")); assert.equal(turnCount(game), 0);
  game.key("Digit2"); assert.match(game.ui.get("target_prompt")!.text!, /throw/);
  game.key("Digit8"); assert.match(game.ui.get("target_prompt")!.text!, /shoot/);
  game.key("Escape"); assert.ok(!game.ui.has("target_prompt")); assert.equal(game.state().message, "PLAYING");
  game.key("KeyI"); assert.equal(game.ui.get("item_count_potion_liquid_flame")!.text, "2");
  assert.ok(game.ui.has("slot_spirit_bow")); assert.equal(JSON.stringify([...game.entities]), before);
});

test("repeated spirit arrows hit the first character without consuming the bow or changing glove timing", () => {
  const game = huntress();
  putActor(game, "front", "chaser", { x: 13, z: 12 }); putActor(game, "behind", "chaser", { x: 14, z: 12 });
  for (const id of ["front", "behind"]) game.entities.get(id)!.body!.cooldown = 1000;
  for (let shot = 0; shot < 8; shot++) {
    const before = Number(game.entities.get("front")!.body!.health);
    game.entities.get("front")!.body!.lifetime = 0;
    game.key("Digit8"); game.tapCell({ x: 14, z: 12 });
    const damage = before - Number(game.entities.get("front")!.body!.health);
    assert.ok(damage >= 0 && damage <= 6); assert.equal(turnCount(game), shot + 1);
    assert.equal(game.entities.get("behind")!.body!.health, 1000);
    assert.deepEqual(cell(game), { x: 12, z: 12 });
  }
  assert.ok(Number(game.entities.get("front")!.body!.health) < 1000);
  game.step(1, 0); assert.equal(turnCount(game), 8.5, "bump melee still uses the equipped gloves");
  game.key("KeyI"); assert.ok(game.ui.has("slot_spirit_bow"));
  assert.equal(game.ui.get("gear_icon_1")!.image, "sprites/dungeon/gloves.png");
  assert.ok(![...game.entities.values()].some((entity) => entity.body?.kind === "fire_cell"));
});

test("empty and self shots preserve invisibility while shooting a character dispels it", () => {
  const game = huntress(); game.key("Digit3");
  game.key("Digit8"); game.tapCell({ x: 12, z: 10 });
  game.key("Digit8"); game.tapCell({ x: 12, z: 12 });
  assert.equal(turnCount(game), 3); assert.equal(game.state().lives, 20);
  assert.ok(game.entities.has(buffId("invisibility", "player")));
  putActor(game, "target", "chaser", { x: 13, z: 12 }); game.entities.get("target")!.body!.cooldown = 1000;
  game.key("Digit8"); game.tapCell({ x: 13, z: 12 });
  assert.ok(!game.entities.has(buffId("invisibility", "player")));
  assert.equal(game.entities.get("target")!.body!.lifetime, 1);
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /Surprise attack/);
});

test("the bow remains usable without equipped gloves and cannot be selected for scroll upgrades", () => {
  const game = huntress(); game.key("KeyI"); game.click("gear_slot_1"); game.click("toggle_equipment");
  assert.equal(turnCount(game), 1);
  game.key("Digit5");
  assert.ok(![...game.ui.values()].some((element) => element.text?.includes("Spirit Bow")));
  game.click("upgrade_1"); game.key("Digit8"); game.tapCell({ x: 13, z: 12 });
  assert.equal(turnCount(game), 3, "upgrading gloves and shooting each cost one tick");
  game.key("KeyI"); assert.equal(game.ui.get("gear_level_1")!.text, "+1");
  game.click("slot_spirit_bow");
  const text = game.ui.get("item_detail_desc")!.text!.replace(/\n/g, " ");
  assert.match(text, /Bow level: \+0/); assert.match(text, /Damage: 1–6/);
});

test("actual kill experience grows the carried bow and updates damage and strength details", () => {
  const game = huntress();
  // Seven ten-XP boss fixtures reach level five through the normal kill path.
  for (let kill = 0; kill < 7; kill++) {
    putActor(game, "warden", "boss", { x: 13, z: 12 }, 1); game.entities.get("warden")!.body!.cooldown = 1000;
    for (let attempt = 0; attempt < 12 && game.entities.has("warden"); attempt++) {
      game.entities.get("warden")!.body!.lifetime = 0;
      game.key("Digit8"); game.tapCell({ x: 13, z: 12 });
    }
    assert.ok(!game.entities.has("warden"));
  }
  assert.equal(game.ui.get("quick_count_0")!.text, "+1");
  game.key("KeyI"); assert.equal(game.ui.get("item_level_spirit_bow")!.text, "+1");
  game.click("slot_spirit_bow"); const text = game.ui.get("item_detail_desc")!.text!.replace(/\n/g, " ");
  assert.match(text, /Bow level: \+1/); assert.match(text, /Damage: 2–8/); assert.match(text, /Strength required: 9/);
});

test("descending preserves the bow and cancels aiming, while a different hero starts without it", () => {
  const game = huntress(), map = generateFloor(1337, 1); walk(game, map, map.exit);
  const before = turnCount(game); game.key("Digit8"); game.click("descend");
  assert.equal(turnCount(game), before + 1); assert.ok(!game.ui.has("target_prompt"));
  assert.ok(game.ui.has("quick_spirit_bow"));
  game.key("KeyI"); assert.ok(game.ui.has("slot_spirit_bow")); game.key("Escape");
  game.click("pause"); game.click("home"); game.click("start"); game.click("hero_warrior"); game.click("begin_run");
  assert.ok(!game.ui.has("quick_spirit_bow")); game.key("KeyI"); assert.ok(!game.ui.has("slot_spirit_bow"));
});

test("Chinese bow details and held Shoot controls fit portrait and short landscape without spending a turn", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) {
    const game = huntress(harness(width, height, mobile, new Map(), false, "zh-CN"));
    game.key("KeyI"); game.click("slot_spirit_bow");
    assert.equal(game.ui.get("item_detail_title")!.text, "灵能短弓");
    assert.equal(game.ui.get("use_spirit_bow__label")!.text, "射击");
    const bounds = game.ui.get("item_window")!.style!;
    assert.ok(Number(bounds.top) >= 0);
    assert.ok(Number(bounds.top) + Number(bounds.height) <= Number(game.ui.get("safe_root")!.style!.height));
    const details = game.ui.get("item_detail_desc")!;
    for (const line of details.text!.split("\n")) assert.ok(measureText("zh-CN", line, details.fontSize!) <= Number(details.style!.width) + 0.01);
    const before = JSON.stringify([...game.entities]);
    game.holdButton("use_spirit_bow"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 0); assert.equal(JSON.stringify([...game.entities]), before);
    const prompt = game.ui.get("target_prompt")!; assert.match(prompt.text!, /射击/);
    for (const line of prompt.text!.split("\n")) assert.ok(measureText("zh-CN", line, prompt.fontSize!) <= Number(prompt.style!.width) + 0.01);
    game.holdButton("cancel_target"); game.tick(30); game.releaseButton();
    assert.ok(!game.ui.has("target_prompt")); assert.equal(turnCount(game), 0);
  }
});

test("liquid flame targeting can be cancelled and rejects unseen tiles without spending anything", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const before = JSON.stringify([...game.entities]);
  game.key("Digit2"); assert.ok(game.ui.has("target_prompt")); assert.equal(turnCount(game), 0);
  game.tick(100); assert.equal(JSON.stringify([...game.entities]), before);
  game.tapCell({ x: 4, z: 12 });
  assert.equal(turnCount(game), 0); assert.ok(game.ui.has("target_prompt"));
  assert.match([...game.ui.values()].flatMap((element) => element.text ?? []).join(" "), /current field of view/);
  game.key("Escape"); assert.equal(game.state().message, "PLAYING"); assert.ok(!game.ui.has("target_prompt"));
  game.key("KeyI"); assert.equal(game.ui.get("item_count_potion_liquid_flame")!.text, "1");
  game.click("slot_potion_liquid_flame"); assert.equal(game.ui.get("use_potion_liquid_flame__label")!.text, "Throw");
  game.click("use_potion_liquid_flame"); game.click("cancel_target");
  assert.equal(turnCount(game), 0);
  assert.equal(JSON.stringify([...game.entities]), before);
});

test("Chinese effect amounts and flame targeting remain usable in portrait and short landscape", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) {
    const game = harness(width, height, mobile, new Map(), false, "zh-CN");
    game.start(); removeMonsters(game);
    putBuff(game, "healing", "player", 22); putBuff(game, "burning", "player", 7); putBuff(game, "ooze", "player", 19);
    putBuff(game, "locked_floor", "player", 50);
    game.key("Digit2");
    for (const [id, amount] of [["hud_healing", 22], ["hud_burning", 7], ["hud_ooze", 19], ["hud_locked_floor", 50]] as const) {
      const label = game.ui.get(id)!;
      assert.match(label.text!, /[\u4e00-\u9fff]/); assert.ok(label.text!.includes(`${amount}`));
      assert.ok(measureText("zh-CN", label.text!, label.fontSize!) <= Number(label.style!.width));
    }
    const prompt = game.ui.get("target_prompt")!;
    assert.match(prompt.text!, /投掷/);
    for (const line of prompt.text!.split("\n")) assert.ok(measureText("zh-CN", line, prompt.fontSize!) <= Number(prompt.style!.width));
    const before = JSON.stringify([...game.entities]);
    game.holdButton("cancel_target"); game.tick(30); game.releaseButton();
    assert.ok(!game.ui.has("target_prompt")); assert.equal(turnCount(game), 0);
    assert.equal(JSON.stringify([...game.entities]), before);
    game.entities.get(buffId("locked_floor", "player"))!.body!.health = 0;
    game.resize(width + 1, height); game.tick();
    assert.equal(game.ui.get("hud_locked_floor")!.text, "恢复暂停");
  }
});

test("a thrown flame potion creates real fire and burning instead of a fixed twelve-damage blast", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "target", "chaser", { x: 13, z: 12 }, 1000);
  game.entities.get("target")!.body!.cooldown = 100;
  game.key("Digit2"); game.tapCell({ x: 14, z: 12 });
  assert.equal(turnCount(game), 1); assert.ok(!game.ui.has("target_prompt"));
  const damage = 1000 - Number(game.entities.get("target")!.body!.health);
  assert.ok(damage >= 1 && damage <= 3);
  assert.equal(game.entities.get(buffId("burning", "target"))!.body!.health, 7);
  assert.ok(game.entities.has(buffId("burning", "player")), "the intercepted blast can burn the thrower too");
  const cells = [...game.entities].filter(([, entity]) => entity.body?.kind === "fire_cell");
  assert.ok(cells.length > 0);
  const map = generateFloor(1337, 1);
  for (const [id, entity] of cells) {
    const point = cell(game, id);
    const initial = Math.abs(point.x - 13) <= 1 && Math.abs(point.z - 12) <= 1;
    assert.equal(entity.body!.health, initial ? 1 : 4, "new flammable neighbours receive four turns of fire");
    if (!initial) assert.ok(["door", "open_door", "secret_door"].includes(terrainAt(map, point)));
    assert.equal(entity.sprite!.path, "sprites/dungeon/fire.png");
  }
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.key("KeyI"); assert.ok(!game.ui.has("slot_potion_liquid_flame"));
});

test("entering a fire field ignites the hero and water removes an already active burn without another hit", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1); reveal(map, map.entrance);
  const direction = [[-1, 0], [0, -1], [-1, -1], [1, -1]].find(([dx, dz]) => {
    const step = { x: 12 + dx!, z: 12 + dz! }, impact = { x: 12 + 2 * dx!, z: 12 + 2 * dz! };
    return terrainAt(map, step) === "floor" && passable(map, impact) && map.visible.has(cellKey(map, impact));
  })!;
  assert.ok(direction);
  const [dx, dz] = direction as [number, number];
  game.key("Digit2"); game.tapCell({ x: 12 + 2 * dx, z: 12 + 2 * dz });
  assert.ok(!game.entities.has(buffId("burning", "player")));
  game.step(dx, dz); assert.ok(game.entities.has(buffId("burning", "player")));
  const water = map.tiles.findIndex((tile) => tile === "water"); assert.ok(water >= 0);
  // Fixture placement isolates the water interaction from travel distance.
  putActor(game, "player", "player", { x: water % 25, z: Math.floor(water / 25) }, 12);
  game.click("wait");
  assert.ok(!game.entities.has(buffId("burning", "player")));
  assert.equal(game.entities.get("player")!.body!.health, 12);
});

test("fresh ooze hurts once in water, while an already active ooze washes off before damage", () => {
  for (const acted of [false, true]) {
    const game = harness(); game.start(); removeMonsters(game);
    const map = generateFloor(1337, 1), water = map.tiles.findIndex((tile) => tile === "water");
    putActor(game, "player", "player", { x: water % 25, z: Math.floor(water / 25) }, 12);
    const id = putBuff(game, "ooze", "player", 20, acted);
    game.click("wait"); assert.ok(!game.entities.has(id));
    assert.equal(game.entities.get("player")!.body!.health, acted ? 12 : 11);
  }
});

test("Goo applies the original twenty-tick ooze through the normal attack proc", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 40);
  const id = buffId("ooze", "player");
  for (let i = 0; i < 30 && !game.entities.has(id); i++) {
    game.entities.get("player")!.body!.health = 1000;
    game.entities.get("warden")!.body!.power = 2;
    game.click("wait");
  }
  assert.equal(game.state().message, "PLAYING");
  assert.equal(game.entities.get(id)!.body!.health, 19);
  assert.equal(game.entities.get(id)!.body!.lifetime, 1);
});

test("burning death removes pending buffs and restart cannot inherit the previous effects", () => {
  const game = harness(); game.start("huntress"); removeMonsters(game);
  game.entities.get("player")!.body!.health = 1;
  const id = putBuff(game, "burning", "player", 8);
  game.entities.get(id)!.body!.power = 3;
  game.click("wait"); assert.equal(game.state().message, "LOST");
  assert.ok(!game.entities.has(id));
  game.tick(100); assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.click("restart"); game.click("begin_run");
  assert.equal(game.state().lives, 20);
  const buffs = [...game.entities.values()].filter((entity) => entity.body?.kind?.toString().startsWith("buff_"));
  assert.deepEqual(buffs.map((entity) => entity.body!.kind).sort(), ["buff_hunger", "buff_regeneration"]);
  for (const buff of buffs) assert.equal(buff.body!.power, 0);
});

test("real starting equipment can be inspected, removed and equipped without duplicating the item", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.key("KeyI"); game.click("gear_slot_1");
  assert.equal(game.ui.get("gear_detail_title")!.text, "Worn Shortsword");
  assert.match(game.ui.get("gear_detail_stats")!.text!, /1–10/); assert.equal(turnCount(game), 0);
  game.key("Escape"); assert.equal(game.state().message, "INVENTORY"); assert.equal(turnCount(game), 0);
  game.click("gear_slot_1"); game.click("toggle_equipment");
  assert.equal(game.state().message, "PLAYING"); assert.equal(turnCount(game), 1);
  game.key("KeyI");
  assert.equal(game.ui.get("equipment_0")!.image, "sprites/spd-ui/empty_weapon.png");
  assert.equal([...game.ui.keys()].filter((id) => id === "gear_slot_1").length, 1);
  game.click("gear_slot_1"); assert.equal(game.ui.get("toggle_equipment__label")!.text, "Equip");
  game.click("toggle_equipment"); assert.equal(turnCount(game), 2);
  game.key("KeyI"); assert.ok(!game.ui.has("equipment_0"));
  assert.equal(game.ui.get("gear_icon_1")!.image, "sprites/dungeon/worn_shortsword.png");
});

test("upgrade selection is free to cancel and changes only the chosen equipment on confirmation", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.key("Digit5"); assert.equal(game.state().message, "UPGRADE"); assert.equal(turnCount(game), 0);
  game.click("upgrade_cancel"); assert.equal(game.state().message, "INVENTORY");
  assert.equal(game.ui.get("item_count_scroll_upgrade")!.text, "1"); game.key("Escape");
  game.key("Digit5"); game.click("upgrade_2");
  assert.equal(game.state().message, "PLAYING"); assert.equal(turnCount(game), 1);
  game.key("KeyI"); assert.equal(game.ui.get("gear_level_2")!.text, "+1");
  assert.ok(!game.ui.has("gear_level_1")); assert.ok(!game.ui.has("slot_scroll_upgrade"));
  game.click("gear_slot_2"); assert.match(game.ui.get("gear_detail_stats")!.text!, /1–3/);
  game.key("Escape"); game.key("Escape"); game.key("Digit5");
  assert.equal(game.state().message, "PLAYING"); assert.equal(turnCount(game), 1, "an absent scroll must not spend time");
});

test("an unequipped weapon can be upgraded without silently re-equipping it", () => {
  const game = harness(); game.start(); removeMonsters(game);
  game.key("KeyI"); game.click("gear_slot_1"); game.click("toggle_equipment");
  game.key("Digit5"); game.click("upgrade_1");
  assert.equal(turnCount(game), 2);
  game.key("KeyI"); assert.ok(game.ui.has("equipment_0"));
  game.click("gear_slot_1"); assert.match(game.ui.get("gear_detail_title")!.text!, /\+1/);
  assert.equal(game.ui.get("toggle_equipment__label")!.text, "Equip");
});

test("glove attacks spend half ticks while a normal-speed enemy responds on its own timeline", () => {
  const game = harness(); game.click("start"); game.click("hero_huntress"); game.click("begin_run"); removeMonsters(game);
  putActor(game, "target", "chaser", { x: 13, z: 12 }, 1000);
  game.step(1, 0); assert.equal(turnCount(game), 0.5);
  assert.equal(game.entities.get("target")!.body!.cooldown, 1);
  game.step(1, 0); assert.equal(turnCount(game), 1);
  assert.equal(game.entities.get("target")!.body!.cooldown, 1, "the hero wins the timestamp tie");
  const before = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.step(1, 0); assert.equal(turnCount(game), 1.5);
  assert.equal(game.entities.get("target")!.body!.cooldown, 2);
});

test("a crab uses its half-tick movement event before a full-tick attack event", () => {
  const game = harness(); game.start(); removeMonsters(game);
  putActor(game, "crab", "charger", { x: 10, z: 10 }, 15, 2);
  game.click("wait");
  assert.deepEqual(cell(game, "crab"), { x: 11, z: 11 });
  assert.equal(game.entities.get("crab")!.body!.cooldown, 1.5);
  assert.equal(turnCount(game), 1);
});

test("heavy armor found on the floor changes movement time and upgrades remove part of the penalty", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const first = generateFloor(1337, 1); walk(game, first, first.exit); game.click("descend"); removeMonsters(game);
  const map = generateFloor(1337, 2);
  const drop = [...game.entities].find(([, entity]) => entity.body?.kind === "loot" && lootKinds[Number(entity.body.power) - 1] === "leather_armor")!;
  assert.ok(drop); walk(game, map, cell(game, drop[0])); assert.ok(!game.entities.has(drop[0]));
  game.key("KeyI");
  const icon = [...game.ui].find(([, element]) => element.image === "sprites/dungeon/leather_armor.png")!;
  const id = Number(icon[0].slice("gear_icon_".length));
  game.click(`gear_slot_${id}`); assert.match(game.ui.get("gear_detail_stats")!.text!, /Too heavy/);
  const before = turnCount(game); game.click("toggle_equipment");
  assert.ok(game.ui.has("seal_transfer_window")); game.click("seal_transfer_no");
  assert.equal(turnCount(game), before + 2, "swapping also spends the previous armor's removal tick");
  const next = findPath(map, cell(game), map.entrance)[0]!, current = cell(game), start = turnCount(game);
  game.step(next.x - current.x, next.z - current.z);
  assert.ok(Math.abs(turnCount(game) - start - 1.44) < 1e-4);
  game.key("Digit5"); game.click(`upgrade_${id}`);
  game.key("KeyI"); game.click(`gear_slot_${id}`);
  assert.match(game.ui.get("gear_detail_stats")!.text!, /required: 11/);
  game.key("Escape"); game.key("Escape");
  const nextAfter = findPath(map, cell(game), map.entrance)[0]!, currentAfter = cell(game), startAfter = turnCount(game);
  game.step(nextAfter.x - currentAfter.x, nextAfter.z - currentAfter.z);
  assert.ok(Math.abs(turnCount(game) - startAfter - 1.2) < 1e-4);
});

test("Chinese equipment and upgrade controls fit portrait and short landscape layouts with one action per hold", () => {
  for (const [width, height, mobile] of [[450, 800, true], [800, 320, false]] as const) for (const hero of heroClassList) {
    const game = harness(width, height, mobile, new Map(), false, "zh-CN");
    game.click("start"); game.click(`hero_${hero}`); game.click("begin_run"); removeMonsters(game);
    game.key("KeyI"); game.click("gear_slot_1");
    assert.match(game.ui.get("gear_detail_title")!.text!, /短剑|魔杖|匕首|手套/);
    assert.match(game.ui.get("gear_detail_stats")!.text!, /伤害/);
    for (const id of ["equipment_window"]) {
      const style = game.ui.get(id)!.style!;
      assert.ok(Number(style.top) >= 0);
      assert.ok(Number(style.top) + Number(style.height) <= Number(game.ui.get("safe_root")!.style!.height));
    }
    game.key("Escape"); game.key("Escape"); game.key("Digit5");
    assert.equal(game.ui.get("upgrade_title")!.text, "选择要升级的装备");
    game.holdButton("upgrade_2"); game.tick(30); game.releaseButton();
    assert.equal(turnCount(game), 1);
    game.key("KeyI"); assert.equal(game.ui.get("gear_level_2")!.text, "+1");
  }
});

test("descending advances status time once and new monsters start at the current reflected clock", () => {
  const game = harness(); game.start(); removeMonsters(game);
  const map = generateFloor(1337, 1); walk(game, map, map.exit);
  game.key("Digit3"); const before = turnCount(game); game.click("descend");
  assert.equal(turnCount(game), before + 1);
  const ready = game.entities.get("player")!.body!.cooldown;
  for (const entity of game.entities.values()) if (entity.body?.kind && String(entity.body.kind) in enemySpecs) assert.equal(entity.body.cooldown, ready);
  removeMonsters(game);
  for (let i = 0; i < 18; i++) game.click("wait");
  assert.ok(game.ui.has("hud_invisible"));
  game.click("wait"); assert.ok(!game.ui.has("hud_invisible"));
});

test("title uses upstream landscape banner, eight entrances, pixel font and integer zoom", () => {
  const game = harness();
  for (const id of ["start", "support", "rankings", "journal", "news", "settings", "changes", "about"]) assert.ok(game.ui.has(id));
  assert.equal(game.ui.get("spd_banner")!.image, "sprites/spd-ui/title_land.png");
  assert.deepEqual([game.ui.get("spd_banner")!.style!.width, game.ui.get("spd_banner")!.style!.height], [720, 171]);
  assert.equal(game.ui.get("start__label")!.font, "fonts/spd-pixel.ttf");
  assert.ok(!game.ui.has("panel_kicker") && !game.ui.has("hero_class_label"));
  game.click("start"); assert.equal(game.state().message, "HEROES");
  for (const hero of heroClassList) assert.equal(game.ui.get(`hero_icon_${hero}`)!.image, `sprites/spd-ui/hero_${hero}.png`);
  game.click("hero_mage"); assert.equal(game.ui.get("hero_class_label")!.text, "Mage");
  game.click("begin_run"); assert.equal(game.state().message, "PLAYING");
  assert.equal(game.entities.get("player")!.sprite!.path, "sprites/dungeon/mage.png");
});

test("backpack has upstream five-column grid and requires an item action confirmation", () => {
  for (const [width, height] of [[1280, 800], [450, 800], [800, 400]]) {
    const game = harness(width, height); game.start(); game.click("bag_btn");
    assert.equal([...game.ui.keys()].filter((key) => /^bag_slot_\d+$/.test(key) || key.startsWith("slot_") || key.startsWith("gear_slot_")).length, 25);
    if (width === 450) {
      assert.equal(game.ui.get("gear_slot_1")!.style!.width, 78);
      assert.equal(game.ui.get("gear_slot_1")!.style!.height, 84);
      assert.equal(game.ui.get("bag_window")!.style!.height, 510);
    }
    assert.ok(!game.ui.has("bag_page"), "the original backpack is a grid in both orientations");
    game.entities.get("player")!.body!.health = 4;
    game.click("slot_potion_healing");
    assert.equal(game.state().message, "ITEM"); assert.equal(turnCount(game), 0);
    assert.equal(game.entities.get("player")!.body!.health, 4);
    assert.equal(game.ui.get("item_detail_title")!.text, "Potion of Healing");
    game.key("Escape"); assert.equal(game.state().message, "INVENTORY");
    game.item("potion_healing");
    assert.equal(game.state().message, "PLAYING"); assert.equal(turnCount(game), 1);
    assert.equal(game.entities.get("player")!.body!.health, 12, "the first healing tick restores eight HP, not a full heal");
    assert.equal(game.entities.get(buffId("healing", "player"))!.body!.health, 22);
  }
});

test("status pane and toolbars use original pixel rectangles rather than full-width cards", () => {
  const game = harness(); game.start();
  assert.equal(game.ui.get("health_fill")!.image, "sprites/spd-ui/hp_large.png");
  assert.equal(game.ui.get("health_fill")!.style!.left, 90);
  assert.equal(game.ui.get("health_fill")!.style!.top, 57);
  assert.equal(game.ui.get("health_fill")!.style!.width, 384);
  game.entities.get("player")!.body!.health = 10; game.click("wait");
  assert.equal(game.ui.get("health_fill")!.style!.width, 192);
  assert.equal(game.ui.get("bag_tool_icon")!.image, "sprites/spd-ui/bag_tool_icon.png");
  assert.ok(!game.ui.has("turn_controls") && !game.ui.has("hint"));
});

test("original chrome scales its center strips explicitly and preserves border pixel widths", () => {
  const game = harness(); game.click("settings");
  const corner = game.ui.get("settings_window_frame_0_0")!.style!;
  const edge = game.ui.get("settings_window_frame_0_1")!.style!;
  assert.equal(corner.width, 18); assert.equal(corner.height, 18);
  assert.equal(edge.height, 18); assert.equal(edge.width, 669);
  assert.equal(edge.imageMode, "stretch");
  assert.equal(game.ui.get("settings_window_frame_0_0")!.image, "sprites/spd-ui/window_0_0.png");
});

test("held clicks cannot repeat a setting action after its UI tree is remounted", () => {
  const game = harness(); game.click("settings"); game.click("settings_tab_1");
  game.holdButton("hints"); game.tick(10);
  assert.equal(parseProfile(game.saves.get("profile")!).showHints, false);
  game.releaseButton(); game.holdButton("hints"); game.tick(10);
  assert.equal(parseProfile(game.saves.get("profile")!).showHints, true);
  game.releaseButton();
});

test("original title secondary entrances and six settings tabs remain reachable", () => {
  const game = harness();
  for (const page of ["rankings", "journal", "news", "changes", "about", "support"]) {
    game.click(page); assert.ok(game.ui.has(`${page}_window`)); game.click("back");
    assert.equal(game.state().message, "MENU");
  }
  game.click("settings");
  for (let tab = 0; tab < 6; tab++) { game.click(`settings_tab_${tab}`); assert.ok(game.ui.has("settings_title")); }
  game.key("Escape"); assert.equal(game.state().message, "MENU");
});

test("UI atlas crops are pinned to the upstream revision with reproducible checksums", () => {
  const manifest = JSON.parse(readFileSync(resolve(assets, "licenses/ui-sources.json"), "utf8")) as {
    revision: string; records: { file: string; rect: number[]; sha256: string; source: string }[];
  };
  assert.equal(manifest.revision, "57a4e06a4caf162446d1c28caa7983f0493fecf0");
  assert.ok(manifest.records.length > 100);
  for (const record of manifest.records) {
    const png = readFileSync(resolve(assets, record.file));
    assert.equal(png.readUInt32BE(16), record.rect[2]); assert.equal(png.readUInt32BE(20), record.rect[3]);
    assert.equal(createHash("sha256").update(png).digest("hex"), record.sha256);
    assert.ok(record.source.includes(manifest.revision));
  }
});

test("all six upstream class buttons exist and locked kits show the original unlock rule", () => {
  const game = harness(); game.click("start");
  for (const hero of ["warrior", "mage", "rogue", "huntress", "duelist", "cleric"]) assert.ok(game.ui.has(`hero_${hero}`));
  game.click("hero_duelist"); assert.equal(game.state().message, "MESSAGE");
  assert.match(game.ui.get("message_text")!.text!.replace(/\s+/g, " "), /tier 2 or higher weapon/);
  game.key("Escape"); assert.equal(game.state().message, "HEROES");
  game.click("hero_cleric"); assert.match(game.ui.get("message_text")!.text!.replace(/\s+/g, " "), /cleanse the curse/);
  game.key("Escape"); game.click("begin_run"); assert.equal(game.state().message, "PLAYING");
});

test("camera zoom and following preserve real world actor positions across resizing", () => {
  const game = harness(); game.start(); game.step(1, 0);
  const player = game.entities.get("player")!.transform.translation as { x: number; y: number };
  assert.equal(game.camera().x, player.x); assert.equal(game.camera().y, player.y + 10);
  assert.equal(game.camera().height, 800 / 3);
  const actors = [...game.entities].filter(([, entity]) => entity.body).map(([id, entity]) => [id, JSON.stringify(entity.transform)]);
  game.resize(800, 400); game.tick();
  assert.equal(game.camera().height, 200);
  for (const [id, transform] of actors) assert.equal(JSON.stringify(game.entities.get(id!)!.transform), transform);
  assert.equal(game.entities.get("terrain_312")!.sprite!.width, 16);
});

test("developer UI previews cover every existing core screen without recording a win or loss", () => {
  const game = harness(); game.start(); const before = JSON.stringify([...game.entities]);
  game.key("F12");
  for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    game.key(`Digit${digit}`); assert.equal(game.state().message, "CHECKS");
    assert.ok(game.ui.size > 1);
  }
  assert.equal(game.saves.get("profile"), undefined);
  assert.equal(JSON.stringify([...game.entities]), before);
  game.key("F12"); assert.equal(game.state().message, "PLAYING");
});

test("desktop uses six joined quick slots on the right and portrait uses four split slots", () => {
  const desktop = harness(); desktop.start();
  const quickIds = (game: Game): string[] => [...game.ui.keys()].filter((id) => /^(quick_potion_|quick_scroll_|quick_empty_)/.test(id));
  assert.equal(quickIds(desktop).length, 6);
  assert.equal(desktop.ui.get("quick_frame_0")!.image, "sprites/spd-ui/quick_left.png");
  assert.equal(desktop.ui.get("quick_potion_healing")!.style!.left, 755);
  assert.equal(desktop.ui.get("quick_empty_5")!.style!.left, 1031);
  assert.equal(desktop.ui.get("search")!.style!.left, 1088);
  const portrait = harness(450, 800); portrait.start();
  assert.equal(quickIds(portrait).length, 4);
  assert.equal(portrait.ui.get("wait")!.style!.left, 0);
  assert.equal(portrait.ui.get("search")!.style!.left, 60);
  assert.equal(portrait.ui.get("quick_scroll_upgrade")!.style!.left, 153);
  assert.equal(portrait.ui.get("bag_btn")!.style!.left, 378);
});

test("closing settings opened through the game menu returns to play and remembers its tab", () => {
  const game = harness(); game.start(); game.click("pause"); game.click("settings");
  game.click("settings_tab_2"); game.key("Escape");
  assert.equal(game.state().message, "PLAYING");
  game.click("pause"); game.click("settings");
  assert.equal(game.ui.get("settings_title")!.text, "Input");
});

test("zero-sized minimized windows preserve the scene and restore the pixel UI safely", () => {
  const game = harness(); game.start(); const before = JSON.stringify([...game.entities]);
  game.resize(0, 0); game.tick(10);
  assert.equal(JSON.stringify([...game.entities]), before);
  assert.equal(game.state().message, "PLAYING");
  game.resize(1280, 800); game.tick();
  assert.equal(game.ui.get("health_fill")!.image, "sprites/spd-ui/hp_large.png");
  assert.equal(game.camera().height, 800 / 3);
});

function changeLanguage(game: Game, language: "en" | "zh-CN"): void {
  game.click("settings"); game.click("settings_tab_5");
  game.click(language === "en" ? "language_english" : "language_chinese");
}

test("English and Chinese catalogs are complete and share interpolation parameters", () => {
  for (const [key, [english, chinese]] of Object.entries(messages)) {
    assert.ok(english.trim(), `Missing English: ${key}`);
    assert.ok(chinese.trim(), `Missing Chinese: ${key}`);
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(parameters(chinese), parameters(english), key);
    assert.equal(translate("en", key as MessageKey), english);
    assert.equal(translate("zh-CN", key as MessageKey), chinese);
  }
  const hit = message("log.surprise", { monster: message("monster.chaser"), damage: 7 });
  assert.equal(renderMessage("en", hit), "Surprise attack! You hit Marsupial Rat for 7.");
  assert.equal(renderMessage("zh-CN", hit), "伏击！你击中了食腐老鼠，造成7点伤害。");
});

test("legacy and unsupported language values preserve statistics without blocking saves", () => {
  const { language: _, followSystemLanguage: __, ...legacy } = { ...defaultProfile(), bestScore: 123, runs: 8, wins: 2 };
  for (const language of [undefined, "fr", "zh-TW", null, 42]) {
    const parsed = parseProfile(JSON.stringify({ ...legacy, language }));
    assert.equal(parsed.language, "en");
    assert.equal(parsed.bestScore, 123); assert.equal(parsed.runs, 8); assert.equal(parsed.wins, 2);
  }
  assert.equal(parseProfile(JSON.stringify({ ...legacy, language: "zh" })).language, "zh-CN");
  assert.equal(parseProfile(JSON.stringify({ ...legacy, language: "zh-CN" })).language, "zh-CN");
});

test("default language follows the system until the user saves an explicit choice", () => {
  for (const locale of ["zh-CN", "zh-Hans-CN", "zh-TW", "ZH_hant_HK"]) {
    assert.equal(defaultProfile(locale).language, "zh-CN");
    const game = harness(800, 600, false, new Map(), false, locale);
    assert.equal(game.ui.get("start__label")!.text, "进入地牢");
  }
  for (const locale of ["en-GB", "fr-FR", "ja-JP", ""]) assert.equal(defaultProfile(locale).language, "en");
  const saves = new Map<string, string>();
  const chinese = harness(800, 600, false, saves, false, "zh-CN");
  chinese.click("settings");
  chinese.setting("hints");
  assert.equal(JSON.parse(saves.get("profile")!).followSystemLanguage, true);
  const english = harness(800, 600, false, saves, false, "en-US");
  assert.equal(english.ui.get("start__label")!.text, "Enter the Dungeon");
  changeLanguage(english, "zh-CN");
  assert.equal(JSON.parse(saves.get("profile")!).followSystemLanguage, false);
  const reopened = harness(800, 600, false, saves, false, "en-US");
  assert.equal(reopened.ui.get("start__label")!.text, "进入地牢");
  reopened.click("settings"); reopened.click("settings_tab_3");
  reopened.click("reset_save"); reopened.click("confirm_reset");
  assert.equal(reopened.ui.get("settings_title")!.text, "Data");
  assert.equal(saves.has("profile"), false);
});

test("legacy profiles without a language follow the system and explicit choices retain progress", () => {
  const { language: _, followSystemLanguage: __, ...legacy } = { ...defaultProfile(), bestScore: 123, runs: 8, wins: 2 };
  const migrated = parseProfile(JSON.stringify(legacy), "zh-CN");
  assert.equal(migrated.language, "zh-CN");
  assert.equal(migrated.followSystemLanguage, true);
  const selected = parseProfile(JSON.stringify({ ...legacy, language: "en" }), "zh-CN");
  assert.equal(selected.language, "en");
  assert.equal(selected.followSystemLanguage, false);
  assert.equal(selected.bestScore, 123); assert.equal(selected.runs, 8); assert.equal(selected.wins, 2);
});

test("language choices apply immediately, persist, and restore English without losing progress", () => {
  const profile = { ...defaultProfile(), bestScore: 900, runs: 3, wins: 1 };
  const saves = new Map([["profile", JSON.stringify(profile)]]);
  const game = harness(1280, 800, false, saves);
  changeLanguage(game, "zh-CN");
  assert.equal(game.ui.get("settings_title")!.text, "语言");
  assert.match(game.ui.get("language_chinese__label")!.text!, /已选择/);
  assert.equal(parseProfile(saves.get("profile")!).language, "zh-CN");
  game.key("Escape");
  assert.equal(game.ui.get("start__label")!.text, "进入地牢");
  assert.equal(game.ui.get("spd_banner")!.text, "破碎的像素地牢");
  const reopened = harness(1280, 800, false, saves);
  assert.equal(reopened.ui.get("start__label")!.text, "进入地牢");
  changeLanguage(reopened, "en"); reopened.key("Escape");
  assert.equal(reopened.ui.get("start__label")!.text, "Enter the Dungeon");
  assert.equal(reopened.ui.get("spd_banner")!.image, "sprites/spd-ui/title_land.png");
  const restored = parseProfile(saves.get("profile")!);
  assert.equal(restored.bestScore, 900); assert.equal(restored.runs, 3); assert.equal(restored.wins, 1);
  assert.equal(restored.language, "en");
});

test("in-run switching retranslates existing logs and keeps actors, inventory, and turns", () => {
  const game = harness(); game.start();
  const actors = JSON.stringify([...game.entities]);
  const turns = turnCount(game);
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("Welcome to the sewers")));
  game.click("pause"); changeLanguage(game, "zh-CN"); game.key("Escape");
  assert.equal(game.state().message, "PLAYING");
  assert.equal(turnCount(game), turns);
  assert.equal(JSON.stringify([...game.entities]), actors);
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("欢迎来到下水道，战士")));
  game.click("bag_btn");
  assert.equal(game.ui.get("bag_title")!.text, "背包");
  game.click("slot_potion_healing");
  assert.equal(game.ui.get("item_detail_title")!.text, "治疗药水");
  assert.equal(game.ui.get("use_potion_healing__label")!.text, "饮用");
  assert.match(game.ui.get("item_detail_desc")!.text!, /恢复生命/);
  game.click("use_potion_healing");
  assert.equal(turnCount(game), turns + 1);
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("温暖而舒缓的能量")));
  game.click("pause"); changeLanguage(game, "en"); game.key("Escape");
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("A warm soothing energy")));
});

test("Chinese menus, hero messages, settings tabs and read-only results are localized", () => {
  const game = harness(); changeLanguage(game, "zh-CN");
  for (const [tab, title] of ["显示", "界面", "输入", "数据", "音频", "语言"].entries()) {
    game.click(`settings_tab_${tab}`); assert.equal(game.ui.get("settings_title")!.text, title);
  }
  game.key("Escape"); game.click("rankings");
  assert.match(game.ui.get("rankings_content")!.text!, /最高分/);
  game.click("back"); game.click("start");
  assert.equal(game.ui.get("hero_class_label")!.text, "战士");
  game.click("hero_mage"); assert.equal(game.ui.get("hero_class_label")!.text, "法师");
  assert.match(game.ui.get("hero_description")!.text!, /古老法杖/);
  game.click("hero_duelist"); assert.match(game.ui.get("message_text")!.text!.replace(/\n/g, ""), /决斗家/);
  game.key("Escape"); game.click("begin_run"); game.key("F12"); game.key("Digit8");
  assert.equal(game.ui.get("result_title")!.text, "下水道里程碑完成");
  assert.equal(game.ui.get("result_banner")!.text, "首领已被击败");
  game.key("Digit9"); assert.equal(game.ui.get("result_title")!.text, "你死了……");
  assert.equal(parseProfile(game.saves.get("profile")!).runs, 0, "previews cannot record a run");
});

test("Chinese save errors and incompatible profiles preserve data and remain recoverable", () => {
  const game = harness(); changeLanguage(game, "zh-CN"); game.failStorage("io");
  game.setting("hints"); game.click("settings_tab_3");
  assert.match(game.ui.get("save_notice")!.text!, /保存失败（io）/);
  game.failStorage(); game.setting("retry_save");
  assert.equal(parseProfile(game.saves.get("profile")!).language, "zh-CN");
  assert.equal(game.ui.get("save_notice")!.text, "进度和设置已保存。");
  const incompatible = "{\"schemaVersion\":99,\"valuable\":true}";
  const saves = new Map([["profile", incompatible]]);
  const blocked = harness(1280, 800, false, saves);
  changeLanguage(blocked, "zh-CN"); blocked.click("settings_tab_3");
  assert.equal(blocked.ui.get("save_notice")!.text, "现有存档不兼容，不会覆盖该存档。");
  assert.equal(saves.get("profile"), incompatible);
});

test("the bundled Chinese font covers both dictionaries and language-choice labels", () => {
  const metadata = JSON.parse(readFileSync(resolve(assets, "licenses/font-sources.json"), "utf8"));
  for (const record of [metadata.font, metadata.notice]) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(assets, record.file))).digest("hex"), record.sha256);
    assert.ok(record.source.includes(metadata.revision));
  }
  assert.match(readFileSync(resolve(assets, metadata.notice.file), "utf8"), /SIL OPEN FONT LICENSE/);
  const glyphs = Object.values(messages).flat().join("").replace(/[\n\r\t]/g, "");
  const font = readFileSync(resolve(assets, metadata.font.file));
  const measured = fontAdvances(font, glyphs);
  const bundled = JSON.parse(readFileSync(resolve(assets, "fonts/noto-sans-sc-metrics.json"), "utf8"));
  for (const glyph of new Set(glyphs)) {
    assert.ok(measured[glyph] !== undefined, `Missing glyph ${glyph}`);
    assert.equal(bundled[glyph], measured[glyph], `Stale glyph metrics ${glyph}`);
  }
  assert.equal(fontForText("en", "简体中文"), "fonts/noto-sans-sc.otf");
  assert.equal(fontForText("en", "English"), "fonts/spd-pixel.ttf");
});

test("Chinese and long Latin words wrap by measured glyph width without losing characters", () => {
  for (const language of ["en", "zh-CN"] as const) {
    for (const value of ["恢复生命并清除腐蚀黏液。消耗1回合。", "A long English description wraps at word boundaries.", "shatteredpixel.com/blog/very-long-diagnostic-token"]) {
      const lines = wrapText(language, value, 40, 6);
      assert.ok(lines.length > 1);
      assert.equal(lines.join("").replace(/\s/g, ""), value.replace(/\s/g, ""));
      assert.ok(lines.every((line) => measureText(language, line, 6) <= 40.001));
    }
  }
  const paragraph = translate("zh-CN", "hero.warrior.description");
  const wrapped = wrapText("zh-CN", paragraph, 80, 6);
  assert.ok(wrapped.every((line) => !/^[，。！？、：；）】》]/u.test(line)));
  assert.equal(wrapped.join(""), paragraph);
});

test("Chinese portrait and compact landscape controls use real glyph sizes and retain their actions", () => {
  for (const [width, height] of [[450, 800], [800, 400], [1280, 800]]) {
    const game = harness(width, height); changeLanguage(game, "zh-CN");
    for (const [id, element] of game.ui) {
      if (!id.endsWith("__label")) continue;
      const parent = game.ui.get(element.parent)!;
      assert.ok(Number(element.style!.width) <= Number(parent.style!.width), `${width}: ${id}`);
      assert.equal(element.font, "fonts/noto-sans-sc.otf");
    }
    game.key("Escape"); game.start(); game.click("bag_btn"); game.click("slot_potion_healing");
    const description = game.ui.get("item_detail_desc")!;
    assert.equal(description.font, "fonts/noto-sans-sc.otf");
    assert.ok(description.text!.split("\n").every((line) => measureText("zh-CN", line, description.fontSize!) <= Number(description.style!.width) + 0.01));
    assert.ok(Number(description.style!.top) + Number(description.style!.height) <= Number(game.ui.get("use_potion_healing")!.style!.top));
  }
});

test("Chinese HUD states, diagnostics and network results keep machine status tokens", () => {
  const game = harness(); changeLanguage(game, "zh-CN"); game.key("Escape"); game.start(); removeMonsters(game);
  for (let turn = 0; turn < 300; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "饥饿");
  for (let turn = 300; turn < 450; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "极度饥饿");
  game.key("Digit3"); assert.equal(game.ui.get("hud_invisible")!.text, "隐形");
  game.key("F12"); assert.equal(game.ui.get("checks_title")!.text, "运行时检查");
  assert.match(game.ui.get("check_0")!.text!, /^PASS  所属实体/);
  game.click("network");
  assert.match(game.ui.get("network_status")!.text!, /PASS GET 200/);
  assert.match(game.ui.get("network_status")!.text!, /PASS POST 200/);
});

test("portrait Chinese logs wrap without overlapping their neighbors or the toolbar", () => {
  const game = harness(450, 800); changeLanguage(game, "zh-CN"); game.key("Escape"); game.start();
  game.click("descend");
  const logs = [...game.ui].filter(([id]) => id.startsWith("log_line_")).map(([, element]) => element);
  let bottom = 0;
  for (const log of logs) {
    assert.ok(Number(log.style!.top) >= bottom);
    assert.ok(log.text!.split("\n").every((line) => measureText("zh-CN", line, log.fontSize!) <= Number(log.style!.width) + 0.01));
    bottom = Number(log.style!.top) + Number(log.style!.height);
  }
  assert.ok(bottom <= Number(game.ui.get("bag_btn")!.style!.top));
});

test("numeric translations work when BMS reflection occupies the String global", () => {
  const game = harness();
  game.context.String = { reflectedType: "String" };
  game.start();
  assert.equal(game.ui.get("hud_level")!.text, "lv. 1");
  game.click("pause"); changeLanguage(game, "zh-CN"); game.key("Escape");
  assert.equal(game.ui.get("hud_level")!.text, "1级");
  game.click("hero_info");
  assert.match(game.ui.get("hero_stats")!.text!, /生命：20\/20/);
});

test("startup and reload retain the host window size while display controls still resize", () => {
  const config = JSON.parse(readFileSync(resolve(assets, "engineConfig.json"), "utf8"));
  assert.ok(Number.isInteger(config.window.width) && config.window.width > 0);
  assert.ok(Number.isInteger(config.window.height) && config.window.height > 0);
  for (const [width, height] of [[1280, 800], [450, 800], [800, 400]]) {
    const game = harness(width, height);
    assert.deepEqual(game.windowSizeRequests, [], "loading must not resize a visible window");
    game.context.on_script_reloaded(); game.tick();
    assert.deepEqual(game.windowSizeRequests, [], "reloading must retain the user's current size");
    game.click("settings"); game.click("settings_tab_0");
    game.click("window_landscape"); game.click("window_portrait");
    assert.deepEqual(game.windowSizeRequests, [[1280, 800], [450, 800]]);
  }
});
