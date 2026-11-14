import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createContext, Script } from "node:vm";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, "../modules/stk-car/game/src/stk-car.ts")], bundle: true, write: false, format: "iife", target: "es2023" }).outputFiles[0].text;
function load(locale: string, platform = "macos") {
  const texts = new Map<string, string>(), images = new Map<string, string>(), nodes = new Set<string>();
  const transforms = new Map<string, number[]>(), held = new Set<string>(), pressed = new Set<string>();
  const cameras: number[][] = [];
  const voices = new Map<string, { path: string; volume: number; speed: number; paused: boolean }>();
  let width = 1280;
  const context = createContext({
    String: Object.freeze({ rustType: "String" }),
    app_locale: () => locale, app_platform: () => platform, app_request_exit: () => true,
    audio_play: (id: string, path: string, _loop: boolean, volume: number) => { voices.set(id, { path, volume, speed: 1, paused: false }); return true; },
    audio_update: (id: string, volume: number, speed: number, paused: boolean) => { const voice = voices.get(id); if (voice) Object.assign(voice, { volume, speed, paused }); return !!voice; },
    audio_stop: (id: string) => voices.delete(id), audio_clear: () => voices.clear(), audio_state: (id: string) => voices.has(id) ? "playing" : "missing",
    scene_clear: () => { transforms.clear(); }, scene_set_3d_enabled: () => true, scene_set_environment: () => true,
    scene_spawn: () => true, scene_set_model: () => true, scene_despawn: () => true,
    scene_set_transform_3d: (id: string, ...values: number[]) => { transforms.set(id, values); return true; },
    scene_set_camera_3d: (...values: number[]) => { assert.ok(values.every(Number.isFinite)); cameras.push(values); return true; },
    storage_read: (key: string) => key === "pc-race-settings-v1" ? { state: "missing" } : { state: "ok", value: "120.4" }, storage_write: () => ({ state: "ok" }),
    window_metrics: () => ({ width, height: 720 }),
    window_safe_area: () => ({ leftInset: 10, rightInset: 10, topInset: 0, bottomInset: 0 }),
    input_primary_pointer: () => ({ pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width * 800 / 720, viewportHeight: 800 }),
    input_touches: () => { if (platform === "macos") throw new Error("PC controls must not read touch input"); return []; },
    input_key_pressed: (key: string) => held.has(key), input_key_just_pressed: (key: string) => pressed.has(key),
    ui_clear: () => { texts.clear(); images.clear(); nodes.clear(); }, ui_spawn: (id: string) => { assert.ok(!nodes.has(id), `Duplicate UI ID ${id}`); nodes.add(id); return true; }, ui_set_style: () => true, ui_set_font: () => true,
    ui_set_image: (id: string, path: string) => { images.set(id, path); return true; },
    ui_set_text: (id: string, value: string) => { texts.set(id, value); return true; }, ui_button_just_pressed: () => false, ui_button_hovered: () => false,
    console: { log: () => {} },
  });
  new Script(bundle).runInContext(context);
  const callbacks = context as unknown as RuneweaveCallbacks;
  callbacks.on_script_loaded();
  function frame(dt = 1 / 60) { callbacks.on_update(dt); pressed.clear(); }
  function press(key: string) { pressed.add(key); frame(); }
  function start() {
    for (let i = 0; i < 5; i++) press("Enter");
    assert.ok(images.has("map"));
    for (let i = 0; i < 190; i++) frame();
  }
  return { callbacks, frame, press, start, texts, images, nodes, transforms, cameras, held, voices, resize: () => { width = 1000; } };
}
test("PC menus use original assets, follow system language and exclude touch HUD", () => {
  for (const locale of ["en-US", "zh-CN", "zh-TW", "fr-FR"]) {
    const game = load(locale);
    assert.equal(game.texts.get("singleplayer-label"), locale.startsWith("zh") ? "单人游戏" : "Singleplayer");
    assert.equal(game.images.get("logo"), "ui/logo.png");
    assert.equal(game.images.get("menu-background"), "ui/background.jpg");
    assert.equal(game.transforms.size, 0);
    game.resize(); game.frame(); game.start();
    assert.equal(game.nodes.has("stick"), false);
    assert.equal(game.nodes.has("gas"), false);
    assert.equal(game.nodes.has("speed-meter"), true);
    game.callbacks.on_script_reloaded();
    assert.ok(game.texts.has("singleplayer-label"));
  }
});
test("keyboard navigation traverses kart, setup, track and race confirmation screens", () => {
  const game = load("en-US");
  game.press("Enter"); assert.equal(game.texts.get("title"), "Choose a Kart");
  const preview = game.transforms.get("preview-body"); game.frame();
  assert.notDeepEqual(game.transforms.get("preview-body"), preview);
  game.press("ArrowRight"); game.press("Enter"); assert.equal(game.texts.get("title"), "Race Setup");
  game.press("Enter"); assert.equal(game.texts.get("title"), "Choose a Track");
  game.press("Enter"); assert.equal(game.texts.get("title"), "Around the Lighthouse");
  assert.equal(game.texts.get("lap-count"), "Laps  4");
  assert.ok(game.texts.get("best")?.includes("2:00.400"));
  game.press("Escape"); assert.equal(game.texts.get("title"), "Choose a Track");
  game.press("Escape"); assert.equal(game.texts.get("title"), "Race Setup");
});
test("reference main menu keeps five original entries, tool icons and honest notices; audio volume works", () => {
  const game = load("en-US");
  for (const name of ["story", "singleplayer", "multiplayer", "online", "addons"]) assert.ok(game.nodes.has(name));
  assert.equal(game.images.get("singleplayer-icon"), "ui/menu_race_focus.png");
  for (const name of ["options", "help", "tutorial", "highscores", "achievements", "gpeditor", "about", "quit"]) assert.ok(game.nodes.has(name));
  assert.equal(game.images.get("bottom-bar"), "ui/bottom_bar.png");
  assert.ok(game.voices.get("music")?.path.endsWith("menutheme.ogg"));
  game.press("ArrowLeft"); game.press("Enter");
  assert.equal(game.texts.get("title"), "Story Mode"); assert.match(game.texts.get("notice-text")!, /not implemented/);
  game.press("Escape");
  for (let index = 0; index < 4; index++) game.press("Tab");
  game.press("Enter"); assert.equal(game.texts.get("title"), "Options");
  game.press("Enter"); assert.equal(game.voices.get("music")?.volume, 0.5);
});
test("bundled PC callbacks drive, look back and stop on suspend until resumed", () => {
  const game = load("en-US"); game.start();
  assert.ok(game.voices.get("music")?.path.endsWith("klabauter_dance.ogg"));
  const initial = game.transforms.get("tux")!;
  const startCamera = game.cameras.at(-1)!;
  assert.equal(startCamera[6], 55);
  assert.ok(Math.hypot(startCamera[0] - initial[0], startCamera[2] - initial[2]) < 5, "chase camera keeps the stationary car readable");
  game.held.add("ArrowUp"); for (let i = 0; i < 40; i++) game.frame();
  assert.notDeepEqual(game.transforms.get("tux"), initial);
  const camera = game.cameras.at(-1)!;
  const moving = game.transforms.get("tux")!;
  assert.ok(Math.hypot(camera[0] - moving[0], camera[2] - moving[2]) < 5, "acceleration must not shrink the car through camera lag");
  game.held.add("KeyB"); game.frame();
  assert.notDeepEqual(game.cameras.at(-1), camera); game.held.delete("KeyB");
  game.callbacks.on_suspend?.(); game.frame(); assert.equal(game.texts.get("title"), "Paused");
  assert.equal(game.voices.get("music")?.paused, true);
  const paused = game.transforms.get("tux");
  for (let i = 0; i < 20; i++) game.frame();
  assert.deepEqual(game.transforms.get("tux"), paused);
  game.press("Enter"); for (let i = 0; i < 10; i++) game.frame();
  assert.equal(game.texts.has("title"), false); assert.notDeepEqual(game.transforms.get("tux"), paused);
});
