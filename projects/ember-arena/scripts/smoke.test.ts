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
  itemCatalog,
  enemySpecs,
  mobCombat,
  seededRandom,
  lootKinds,
  type Point,
} from "../modules/ember-arena/game/src/rules.js";
import { canStep, cellKey, findPath, generateFloor, lineOfSight, passable, reveal, sameCell, searchFloor, terrainAt, type DungeonFloor, type Terrain } from "../modules/ember-arena/game/src/dungeon.js";
import { defaultProfile, parseProfile } from "../modules/ember-arena/game/src/profile.js";
import { message, messages, renderMessage, translate, type MessageKey } from "../modules/ember-arena/game/src/i18n.js";
import { fontForText, measureText, wrapText } from "../modules/ember-arena/game/src/text-layout.js";
import { fontAdvances } from "./font-metrics.js";

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
  set(key: string, value: unknown): void { this.value[key] = value; }
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
    start: () => { clicks.add("start"); tick(); clicks.add("begin_run"); tick(); },
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
  game.entities.set(id, {
    transform: { translation: { x: (point.x - 12) * size, y: (12 - point.z) * size - 40, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: type, health, speed, radius: 0.4, cooldown: 0, lifetime: 0, power: 0, velocity_x: 0, velocity_z: 0 },
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
  assert.equal(game.state().lives, 19);
});

test("generated native sprites retain upstream frame sizes and manifest checksums", () => {
  const manifest = JSON.parse(readFileSync(resolve(assets, "licenses/sources.json"), "utf8")) as {
    spriteRecords: { file: string; sha256: string }[];
  };
  assert.ok(manifest.spriteRecords.length >= 20);
  for (const entry of manifest.spriteRecords) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(assets, entry.file))).digest("hex"), entry.sha256);
  }
  for (const [name, width, height] of [["warrior", 12, 15], ["gnoll", 12, 15], ["goo", 20, 14], ["exit", 16, 16]] as const) {
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
  const size = game.entities.get("terrain_312")!.sprite!.width;
  const door = path[index]!, before = cell(game);
  game.tapCell(door);
  game.tick(20);
  assert.deepEqual(cell(game), before);
  assert.equal(game.entities.get(`terrain_${cellKey(map, door)}`)!.sprite!.path, "sprites/dungeon/open_door.png");
  assert.equal((game.entities.get("hidden_rat")!.transform.scale as { x: number }).x, 1);
});


function turnCount(game: Game): number { return Number(game.entities.get("player")!.body!.lifetime); }

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
    assert.equal([...game.ui.keys()].filter((key) => /^bag_slot_\d+$/.test(key) || key.startsWith("slot_")).length, 25);
    if (width === 450) {
      assert.equal(game.ui.get("bag_slot_0")!.style!.width, 78);
      assert.equal(game.ui.get("bag_slot_0")!.style!.height, 84);
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
    assert.equal(game.entities.get("player")!.body!.health, 20);
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
