import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createContext, Script } from "node:vm";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, "../modules/stk-car/game/src/stk-car.ts")], bundle: true, write: false, format: "iife", target: "es2023" }).outputFiles[0].text;
function load(locale: string) {
  const texts = new Map<string, string>();
  const transforms = new Map<string, number[]>();
  const held = new Set<string>();
  const pressed = new Set<string>();
  let width = 1280;
  const context = createContext({
    // BMS exposes a reflected Rust String here; game code must not call it as a JS constructor.
    String: Object.freeze({ rustType: "String" }),
    app_locale: () => locale, app_request_exit: () => true,
    scene_clear: () => { transforms.clear(); }, scene_set_3d_enabled: () => true,
    scene_spawn: () => true, scene_set_model: () => true, scene_despawn: () => true,
    scene_set_transform_3d: (id: string, ...values: number[]) => { transforms.set(id, values); return true; },
    scene_set_camera_3d: (...values: number[]) => { assert.ok(values.every(Number.isFinite)); return true; },
    storage_read: () => ({ state: "ok", value: "120.4" }), storage_write: () => ({ state: "ok" }),
    window_metrics: () => ({ width, height: 720 }),
    window_safe_area: () => ({ leftInset: 10, rightInset: 10, topInset: 0, bottomInset: 0 }),
    input_primary_pointer: () => ({ pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width * 800 / 720, viewportHeight: 800 }),
    input_touches: () => [], input_key_pressed: (key: string) => held.has(key), input_key_just_pressed: (key: string) => pressed.has(key),
    ui_clear: () => { texts.clear(); }, ui_spawn: () => true, ui_set_style: () => true, ui_set_font: () => true,
    ui_set_text: (id: string, value: string) => { texts.set(id, value); return true; }, ui_button_just_pressed: () => false,
    console: { log: () => {} },
  });
  new Script(bundle).runInContext(context);
  const callbacks = context as unknown as RuneweaveCallbacks;
  callbacks.on_script_loaded();
  function frame(dt = 1 / 60) { callbacks.on_update(dt); pressed.clear(); }
  return { callbacks, frame, texts, transforms, held, pressed, resize: () => { width = 1000; } };
}
test("bundle loads in English, Chinese and fallback locales with BMS reflected String", () => {
  for (const locale of ["en-US", "zh-CN", "zh-TW", "fr-FR"]) {
    const game = load(locale);
    assert.equal(game.texts.get("primary-label"), locale.startsWith("zh") ? "开始比赛" : "Start race");
    assert.ok(game.texts.get("best")?.includes("2:00.400"));
    game.resize(); game.frame();
    game.callbacks.on_script_reloaded();
    assert.equal(game.texts.get("time"), "0:00.000");
  }
});
test("bundled callbacks drive the player and freeze on suspend until explicitly resumed", () => {
  const game = load("en-US");
  game.pressed.add("Enter"); game.frame();
  for (let i = 0; i < 190; i++) game.frame();
  const initial = game.transforms.get("tux")!;
  game.held.add("KeyW");
  for (let i = 0; i < 30; i++) game.frame();
  assert.notDeepEqual(game.transforms.get("tux"), initial);
  game.callbacks.on_suspend?.(); game.frame();
  assert.equal(game.texts.get("title"), "Paused");
  const paused = game.transforms.get("tux");
  for (let i = 0; i < 20; i++) game.frame();
  assert.deepEqual(game.transforms.get("tux"), paused);
  game.pressed.add("Enter"); game.frame();
  assert.equal(game.texts.has("title"), false);
  for (let i = 0; i < 10; i++) game.frame();
  assert.notDeepEqual(game.transforms.get("tux"), paused);
});
