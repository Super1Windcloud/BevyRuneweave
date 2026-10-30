import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { constrain, distance, pillars, segmentHits, waveAt } from "../modules/ember-arena/game/src/rules.js";

const assets = resolve(import.meta.dirname, "../modules/ember-arena/game/assets");
type RecordValue = { [key: string]: unknown };
interface Entity { transform: RecordValue; body?: RecordValue; model?: string }
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
function harness(width = 1280, height = 800, mobile = false) {
  const entities = new Map<string, Entity>();
  const ui = new Map<string, Ui>();
  const pressed = new Set<string>();
  const keys = new Set<string>();
  const clicks = new Set<string>();
  let state = { score: 0, lives: 0, message: "" };
  let exitRequested = false;
  let pointer = { pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width, viewportHeight: height };
  const despawnUi = (id: string): boolean => {
    if (!ui.has(id)) return false;
    for (const [child, element] of [...ui]) if (element.parent === id) despawnUi(child);
    return ui.delete(id);
  };
  const context = createContext({
    console,
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
    scene_set_sprite: (id: string, path: string) => entities.has(id) && existsSync(resolve(assets, path)),
    scene_set_text: (id: string) => entities.has(id),
    scene_set_transform: (id: string, x: number, y: number, z: number) => {
      if (!entities.has(id)) return false;
      entities.get(id)!.transform.translation = { x, y, z }; return true;
    },
    scene_transform: (id: string) => entities.has(id) ? new Reference(entities.get(id)!.transform) : null,
    scene_actor_set: (id: string, kind: string, health: number, speed: number, radius: number) => {
      if (!entities.has(id) || ![health, speed, radius].every(Number.isFinite) || radius <= 0) return false;
      entities.get(id)!.body = { kind, health, speed, radius, power: 0, cooldown: 0, lifetime: 0, velocity_x: 0, velocity_z: 0 };
      return true;
    },
    scene_actor: (id: string) => entities.get(id)?.body ? new Reference(entities.get(id)!.body!) : null,
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
    ui_button_just_pressed: (id: string) => { const active = clicks.has(id); clicks.delete(id); return active; },
    input_key_pressed: (key: string) => keys.has(key),
    input_key_just_pressed: (key: string) => pressed.has(key),
    input_key_just_released: () => false,
    input_primary_touch: () => ({ pressed: false, justPressed: false, x: 0, y: 0, deltaX: 0, deltaY: 0 }),
    input_primary_pointer: () => pointer,
    window_safe_area: () => ({ left: -width / 2, right: width / 2, bottom: -height / 2, top: height / 2,
      width: width - (mobile ? 20 : 0), height: height - (mobile ? 40 : 0),
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
    for (let frame = 0; frame < count; frame++) { context.on_update(0.05); pressed.clear(); clicks.clear(); }
  };
  return { entities, ui, keys, pressed, tick, context,
    state: () => state,
    click: (id: string) => { assert.ok(ui.has(id), `Missing button ${id}`); clicks.add(id); tick(); },
    pointer: (value: Partial<typeof pointer>) => { pointer = { ...pointer, ...value }; },
    exitRequested: () => exitRequested,
  };
}

test("room collision, swept projectile hits and wave transitions", () => {
  for (const pillar of pillars) assert.ok(distance(constrain(pillar, 0.35, 8), pillar) >= 1.1499);
  assert.ok(segmentHits({ x: -2, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 0 }, 0.2));
  assert.ok(!segmentHits({ x: -2, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }, 0.2));
  assert.deepEqual([waveAt(0), waveAt(40), waveAt(85), waveAt(130)], [0, 1, 2, 3]);
});
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
  const results = [...game.ui.values()].flatMap((element) => element.text ?? []);
  assert.equal(results.filter((line) => line.startsWith("PASS")).length, 7);
  assert.equal(results.filter((line) => line.startsWith("FAIL")).length, 0);
  game.click("network"); game.tick();
  assert.match(game.ui.get("network_status")!.text!, /PASS GET 200/);
  assert.match(game.ui.get("network_status")!.text!, /PASS POST 200/);
  game.click("back"); game.click("restart");
  assert.equal(game.state().lives, 100);
  assert.equal([...game.entities.values()].filter((value) => value.body).length, 1);
  game.click("pause"); game.click("exit");
  assert.ok(game.exitRequested());
});
test("portrait touch, native safe area and reload reset", () => {
  const game = harness(450, 800, true);
  game.click("start");
  assert.notEqual(game.ui.get("safe_root")!.style!.top, "0%");
  game.pointer({ pressed: true, x: 0 }); game.tick();
  game.pointer({ pressed: true, x: 30 }); game.tick();
  assert.ok((game.entities.get("player")!.transform.translation as { x: number }).x > 0);
  game.context.on_script_reloaded();
  assert.equal(game.state().message, "MENU");
  assert.equal([...game.entities.values()].filter((value) => value.body).length, 1);
});
test("crystals open an upgrade and vigor heals the real actor state", () => {
  const game = harness(); game.click("start");
  game.entities.get("player")!.body!.health = 40;
  for (let index = 0; index < 7; index++) game.entities.set(`pickup_${index}`, {
    transform: { translation: { x: 0, y: 0.3, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: "crystal", health: 1, speed: 0, radius: 0.2, lifetime: 0 },
  });
  game.tick(); assert.equal(game.state().message, "UPGRADE");
  game.click("upgrade_vigor");
  assert.equal(game.entities.get("player")!.body!.health, 70);
  assert.ok((game.entities.get("player")!.body!.speed as number) > 3.7);
  assert.equal(game.state().message, "PLAYING");
});
test("three waves, boss victory, bounded actors and repeatable restart", () => {
  const game = harness(); game.click("start");
  game.entities.get("player")!.body!.health = 100_000;
  let maximum = 0;
  for (let frame = 0; frame < 6500 && game.state().message !== "WON"; frame++) {
    if (game.state().message === "UPGRADE") game.click("upgrade_power");
    game.tick(); maximum = Math.max(maximum, game.entities.size);
  }
  assert.equal(game.state().message, "WON");
  assert.ok(game.state().score >= 500);
  assert.ok(maximum < 230, `Unexpected entity growth: ${maximum}`);
  game.click("restart");
  assert.equal(game.state().score, 0);
  assert.equal(game.state().lives, 100);
});
test("contact damage ends a run and restart removes hostile actors", () => {
  const game = harness(); game.click("start");
  game.entities.get("player")!.body!.health = 1;
  game.entities.set("lethal", {
    transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    body: { kind: "chaser", health: 1000, speed: 0, radius: 0.4, cooldown: 10, lifetime: 0 },
  });
  game.tick(); assert.equal(game.state().message, "LOST");
  game.click("restart"); assert.ok(!game.entities.has("lethal"));
  assert.equal(game.state().lives, 100);
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
