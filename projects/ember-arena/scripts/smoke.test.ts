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
  type Point,
} from "../modules/ember-arena/game/src/rules.js";
import { canStep, cellKey, findPath, generateFloor, lineOfSight, reveal, sameCell, terrainAt, type DungeonFloor, type Terrain } from "../modules/ember-arena/game/src/dungeon.js";
import { defaultProfile, parseProfile } from "../modules/ember-arena/game/src/profile.js";

const assets = resolve(import.meta.dirname, "../modules/ember-arena/game/assets");
type RecordValue = { [key: string]: unknown };
interface Entity { transform: RecordValue; body?: RecordValue; model?: string; sprite?: { path: string; width: number; height: number } }
interface Ui { parent: string; text?: string; style?: RecordValue }

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
function harness(width = 1280, height = 800, mobile = false, saves = new Map<string, string>(), stickyUi = false) {
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
  let pointer = { pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width / height * 800, viewportHeight: 800 };
  const despawnUi = (id: string): boolean => {
    if (!ui.has(id)) return false;
    for (const [child, element] of [...ui]) if (element.parent === id) despawnUi(child);
    return ui.delete(id);
  };
  const context = createContext({
    console,
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
    ui_set_text: (id: string, value: string) => {
      if (!ui.has(id)) return false;
      ui.get(id)!.text = value; return true;
    },
    ui_set_image: (id: string, path: string) => ui.has(id) && existsSync(resolve(assets, path)),
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
    window_set_size: (w: number, h: number) => !mobile && Number.isFinite(w) && Number.isFinite(h),
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
  return { entities, ui, keys, pressed, tick, context, saves,
    failStorage: (error = "") => { storageFailure = error; },
    state: () => state,
    click: (id: string) => { assert.ok(ui.has(id), `Missing button ${id}`); clicks.add(id); tick(); },
    pointer: (value: Partial<typeof pointer>) => { pointer = { ...pointer, ...value }; },
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
  game.click("start");
  game.keys.add("KeyD"); game.tick(4); game.keys.clear();
  assert.ok((game.entities.get("player")!.transform.translation as { x: number }).x > 0);
  game.click("pause");
  const before = JSON.stringify([...game.entities]); game.tick(20);
  assert.equal(JSON.stringify([...game.entities]), before, "pause must freeze the world");
  game.click("checks");
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
  game.click("back"); game.click("restart");
  assert.equal(game.state().lives, 20);
  assert.equal([...game.entities.values()].filter((value) => value.body?.kind === "chaser").length, 8);
  game.click("pause"); game.click("exit");
  assert.ok(game.exitRequested());
});
test("portrait touch, native safe area and reload reset", () => {
  const game = harness(450, 800, true);
  game.click("start");
  assert.notEqual(game.ui.get("safe_root")!.style!.top, "0%");
  game.pointer({ pressed: true, justPressed: true, x: game.entities.get("player")!.sprite!.width, y: -40 }); game.tick();
  assert.ok((game.entities.get("player")!.transform.translation as { x: number }).x > 0);
  game.context.on_script_reloaded();
  assert.equal(game.state().message, "MENU");
  assert.equal([...game.entities.values()].filter((value) => value.body).length, 1);
});
test("contact damage ends a run and restart removes hostile actors", () => {
  const game = harness(); game.click("start");
  game.entities.get("player")!.body!.health = 1;
  game.entities.set("lethal", {
    transform: { translation: { x: 22, y: -40, z: 2 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: "chaser", health: 1000, speed: 1, radius: 0.4, cooldown: 0, lifetime: 1, power: 0 },
  });
  for (let turn = 0; turn < 20 && game.state().message === "PLAYING"; turn++) game.click("wait");
  assert.equal(game.state().message, "LOST");
  game.click("restart"); assert.ok(!game.entities.has("lethal"));
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
  game.click("settings"); game.click("sensitivity"); game.click("hints"); game.click("motion"); game.click("seed");
  const saved = parseProfile(saves.get("profile")!);
  assert.equal(saved.sensitivity, 1.25); assert.equal(saved.showHints, false);
  assert.equal(saved.reducedMotion, true); assert.equal(saved.seed, 1338);
  const reopened = harness(1280, 800, false, saves);
  reopened.click("settings"); assert.match(reopened.ui.get("sensitivity__label")!.text!, /1.25x/);
  reopened.click("reset_save"); assert.ok(saves.has("profile"));
  reopened.click("cancel_reset"); assert.ok(saves.has("profile"));
  reopened.click("reset_save"); reopened.click("confirm_reset"); assert.ok(!saves.has("profile"));
  reopened.click("settings_back"); reopened.click("start");
  assert.equal(reopened.ui.get("hint")!.style!.display, "flex");
});
test("incompatible saves are preserved until an explicit reset", () => {
  const saves = new Map([["profile", "{\"schemaVersion\":99,\"valuable\":true}"]]);
  const game = harness(1280, 800, false, saves); game.click("settings");
  assert.match(game.ui.get("save_notice")!.text!, /will not be overwritten/);
  game.click("hints"); game.click("retry_save");
  assert.equal(saves.get("profile"), "{\"schemaVersion\":99,\"valuable\":true}");
  game.click("settings_back"); game.click("start"); assert.equal(game.state().message, "PLAYING");
});
test("failed saves can be retried and a finished run is counted once", () => {
  const game = harness(); game.click("settings"); game.failStorage("io"); game.click("hints");
  assert.match(game.ui.get("save_notice")!.text!, /Save failed/);
  game.failStorage(); game.click("retry_save"); assert.equal(parseProfile(game.saves.get("profile")!).showHints, false);
  game.click("settings_back"); game.click("start");
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
  const one = harness(); const two = harness(); one.click("start"); two.click("start"); one.tick(5); two.tick(5);
  assert.deepEqual([...one.entities], [...two.entities]);
  const landscape = harness(800, 400, true); landscape.click("settings");
  assert.equal(landscape.ui.get("settings_back")!.style!.height, 36);
  assert.equal(landscape.ui.get("settings_input")!.style!.justifyContent, "space-between");
});
test("save schema validation rejects bad statistics and nonfinite settings", () => {
  assert.deepEqual(parseProfile(JSON.stringify(defaultProfile())), defaultProfile());
  for (const data of [null, [], { ...defaultProfile(), bestScore: -1 }, { ...defaultProfile(), wins: 3 },
    { ...defaultProfile(), sensitivity: 100 }, { ...defaultProfile(), seed: 0x100000000 }, { ...defaultProfile(), showHints: "false" }]) {
    assert.throws(() => parseProfile(JSON.stringify(data)));
  }
});

test("in-game backpack inventory, item usage and hero class switching", () => {
  const game = harness();
  // Hero cycle in menu
  assert.match(game.ui.get("hero_class_label")!.text!, /WARRIOR/);
  game.click("hero_class");
  assert.match(game.ui.get("hero_class_label")!.text!, /MAGE/);
  game.click("hero_class");
  assert.match(game.ui.get("hero_class_label")!.text!, /ROGUE/);
  game.click("hero_class");
  assert.match(game.ui.get("hero_class_label")!.text!, /HUNTRESS/);
  game.click("hero_class");
  assert.match(game.ui.get("hero_class_label")!.text!, /WARRIOR/);

  // Start game and open backpack
  game.click("start");
  assert.equal(game.state().message, "PLAYING");
  game.click("bag_btn");
  assert.equal(game.state().message, "INVENTORY");
  assert.match(game.ui.get("item_title_potion_healing")!.text!, /Potion of Healing/);

  // Drink healing potion
  game.entities.get("player")!.body!.health = 4;
  game.click("use_potion_healing");
  assert.equal(game.entities.get("player")!.body!.health, 20);

  // Read upgrade scroll
  game.click("bag_btn"); game.click("use_scroll_upgrade");
  assert.equal(game.entities.get("player")!.body!.health, 20, "weapon upgrades do not grant HP");
  assert.equal(game.state().message, "PLAYING");
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

test("waiting without input freezes actors, hunger and depth; blocked movement costs no turn", () => {
  const game = harness(); game.click("start");
  const before = JSON.stringify([...game.entities]);
  game.tick(4000);
  assert.equal(JSON.stringify([...game.entities]), before);
  assert.match(game.ui.get("hud_info")!.text!, /^TURN 0 /);
  assert.match(game.ui.get("hud_wave")!.text!, /DEPTH 1/);
  removeMonsters(game);
  const map = generateFloor(1337, 1);
  const target = { x: 10, z: 10 };
  walk(game, map, target);
  const turn = game.ui.get("hud_info")!.text;
  game.step(-1, -1); // The wall outside the north-west corner of the starting room.
  assert.deepEqual(cell(game), target);
  assert.equal(game.ui.get("hud_info")!.text, turn);
  game.key("Digit4");
  assert.equal(game.ui.get("hud_info")!.text, turn, "an empty item slot consumes no turn");
});

test("door opening costs one turn and keyboard movement lands exactly on a tile", () => {
  const game = harness(); game.click("start"); removeMonsters(game);
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
  const game = harness(); game.click("start");
  game.click("descend"); assert.match(game.ui.get("hud_wave")!.text!, /DEPTH 1/);
  game.entities.get("player")!.body!.health = 20;
  for (let depth = 1; depth < 5; depth++) {
    removeMonsters(game);
    const map = generateFloor(1337, depth);
    walk(game, map, map.exit);
    game.click("descend");
    assert.deepEqual(cell(game), map.entrance);
    assert.match(game.ui.get("hud_wave")!.text!, new RegExp(`DEPTH ${depth + 1}`));
    assert.equal(game.entities.get("player")!.body!.health, 20);
    assert.ok(game.entities.size < 200, "previous terrain and actors must be removed");
  }
  assert.equal(game.entities.get("warden")!.body!.health, 100);
  assert.equal(game.ui.get("boss_panel")!.style!.display, "flex");
  removeMonsters(game);
  putActor(game, "warden", "boss", { x: 13, z: 12 }, 1, 1);
  for (let attempt = 0; attempt < 5 && game.state().message === "PLAYING"; attempt++) game.step(1, 0);
  assert.equal(game.state().message, "WON");
  assert.match(game.ui.get("victory_key_label")!.text!, /SKELETON KEY/);
  assert.equal(parseProfile(game.saves.get("profile")!).wins, 1);
  game.tick(50); assert.equal(parseProfile(game.saves.get("profile")!).runs, 1);
  game.click("restart");
  assert.equal(game.state().lives, 20); assert.match(game.ui.get("hud_info")!.text!, /^TURN 0 /);
});

test("bump attacks consume turns, break invisibility and never move into an occupied cell", () => {
  const game = harness(); game.click("start"); removeMonsters(game);
  putActor(game, "target", "chaser", { x: 13, z: 12 });
  const health = game.state().lives;
  game.key("Digit3");
  assert.equal(game.state().lives, health, "invisible heroes cannot be attacked");
  assert.match(game.ui.get("hud_info")!.text!, /INVISIBLE 20/);
  game.step(1, 0);
  assert.deepEqual(cell(game), { x: 12, z: 12 });
  assert.ok((game.entities.get("target")!.body!.health as number) < 1000);
  assert.doesNotMatch(game.ui.get("hud_info")!.text!, /INVISIBLE/);
  assert.ok([...game.ui.values()].some((node) => node.text?.includes("Surprise attack!")));
  const snapshot = JSON.stringify([...game.entities]); game.tick(100);
  assert.equal(JSON.stringify([...game.entities]), snapshot, "enemies only retaliate after an action");
});

test("magic mapping reveals terrain while hidden monsters and items stay hidden", () => {
  const game = harness(); game.click("hero_class"); game.click("start"); game.key("Digit6");
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
  const game = harness(); game.click("start"); game.step(1, 0);
  const before = new Map([...game.entities].filter(([, entity]) => entity.body).map(([id]) => [id, cell(game, id)]));
  game.resize(450, 800); game.tick();
  assert.ok(game.entities.get("terrain_312")!.sprite!.width < 22);
  for (const [id, point] of before) assert.deepEqual(cell(game, id), point);
  game.resize(1280, 800); game.tick();
  assert.equal(game.entities.get("terrain_312")!.sprite!.width, 22);
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
  const game = harness(); game.click("start"); removeMonsters(game);
  game.entities.get("player")!.body!.health = 4;
  game.click("wait");
  assert.equal(game.state().lives, 4);
  for (let turn = 1; turn < 301; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "HUNGRY");
  game.entities.get("player")!.body!.health = 4;
  game.key("Digit7");
  assert.equal(game.state().lives, 4, "food must not directly heal the hero");
  assert.match(game.ui.get("hud_info")!.text!, /^TURN 304 /);
  assert.equal(game.ui.get("hud_hunger")!.text, "SATIATED");
  for (let turn = 0; turn < 449; turn++) game.click("wait");
  assert.equal(game.ui.get("hud_hunger")!.text, "STARVING");
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

test("Goo charges before its burst and heals in water even while sleeping", () => {
  const game = harness(); game.click("start"); removeMonsters(game);
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
  const game = harness(); game.click("start"); removeMonsters(game);
  const map = generateFloor(1337, 1);
  const path = findPath(map, map.entrance, map.exit);
  const index = path.findIndex((point) => terrainAt(map, point) === "door");
  walk(game, map, path[index - 1]!);
  putActor(game, "hidden_rat", "chaser", path[index + 1]!);
  const size = game.entities.get("terrain_312")!.sprite!.width;
  const door = path[index]!, before = cell(game);
  game.pointer({ justPressed: true, x: (door.x - 12) * size, y: (12 - door.z) * size - 40 });
  game.tick(20);
  assert.deepEqual(cell(game), before);
  assert.equal(game.entities.get(`terrain_${cellKey(map, door)}`)!.sprite!.path, "sprites/dungeon/open_door.png");
  assert.equal((game.entities.get("hidden_rat")!.transform.scale as { x: number }).x, 1);
});

test("compact landscape backpacks paginate every item without advancing turns", () => {
  const game = harness(800, 400, true); game.click("start"); game.click("bag_btn");
  const before = JSON.stringify([...game.entities]);
  assert.ok(game.ui.has("use_potion_healing") && !game.ui.has("use_food_ration"));
  assert.equal(game.ui.get("item_desc_potion_healing")!.style!.display, "none");
  game.click("bag_page");
  assert.ok(game.ui.has("use_food_ration") && game.ui.has("use_scroll_upgrade"));
  assert.ok(!game.ui.has("use_potion_healing"));
  assert.equal(JSON.stringify([...game.entities]), before);
  game.click("bag_page"); assert.ok(game.ui.has("use_potion_healing"));
  game.key("KeyI"); assert.equal(game.state().message, "PLAYING");
});

test("button callbacks can remount the same button without replaying a frame's press", () => {
  const game = harness(800, 400, false, new Map(), true);
  game.click("start"); game.click("bag_btn"); game.click("bag_page");
  assert.equal(game.ui.get("bag_page__label")!.text, "PAGE 2 / 2 / NEXT");
  assert.ok(game.ui.has("use_food_ration"));
  game.tick(3);
  assert.equal(game.ui.get("bag_page__label")!.text, "PAGE 2 / 2 / NEXT");
  game.click("bag_page");
  assert.equal(game.ui.get("bag_page__label")!.text, "PAGE 1 / 2 / NEXT");
});

test("holding a pointer across a UI remount triggers one action until release", () => {
  const game = harness(800, 400); game.click("start"); game.click("bag_btn");
  game.holdButton("bag_page"); game.tick(10);
  assert.equal(game.ui.get("bag_page__label")!.text, "PAGE 2 / 2 / NEXT");
  game.releaseButton(); game.holdButton("bag_page"); game.tick(10);
  assert.equal(game.ui.get("bag_page__label")!.text, "PAGE 1 / 2 / NEXT");
  game.releaseButton();
});
