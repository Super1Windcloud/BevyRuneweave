import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createContext, Script } from "node:vm";
import { buildSync } from "esbuild";

const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, "../modules/stk-car/game/src/stk-car.ts")], bundle: true, write: false, format: "iife", target: "es2023" }).outputFiles[0].text;
export function load(locale: string, platform = "macos", geometry = { width: 1280, height: 720, leftInset: 10, rightInset: 10 }, missingApis: string[] = [], downloads: { hold: boolean; error: string; root: string; received?: number } = { hold: false, error: "", root: "" }, sceneReadiness?: { models: "loading" | "ready" | "failed"; frame: number }) {
  const texts = new Map<string, string>(), images = new Map<string, string>(), nodes = new Set<string>();
  const transforms = new Map<string, number[]>(), held = new Set<string>(), pressed = new Set<string>();
  const models = new Map<string, string>();
  const kinds = new Map<string, string>(), parents = new Map<string, string>();
  const cameras: number[][] = [];
  const voices = new Map<string, { path: string; volume: number; speed: number; paused: boolean }>();
  let width = geometry.width, height = geometry.height, clicked = "";
  const contacts: { id: string; justPressed: boolean; x: number; y: number }[] = [];
  const styles = new Map<string, Record<string, number | string>>();
  const saved = new Map<string, string>();
  let packId = 0;
  const packRequests = new Map<number, { files: { path: string }[]; bytes: number }>();
  const context = createContext({
    String: Object.freeze({ rustType: "String" }),
    app_locale: () => locale, app_platform: () => platform, app_request_exit: () => true,
    asset_pack_request: (json: string) => { packRequests.set(++packId, JSON.parse(json)); return packId; },
    asset_pack_poll: (id: number) => downloads.error ? { state: "error", error: downloads.error } : downloads.hold ? { state: "pending", received: downloads.received ?? 0, total: packRequests.get(id)?.bytes ?? 0 } : { state: "ready", root: downloads.root },
    audio_play: (id: string, path: string, _loop: boolean, volume: number) => { voices.set(id, { path, volume, speed: 1, paused: false }); return true; },
    audio_update: (id: string, volume: number, speed: number, paused: boolean) => { const voice = voices.get(id); if (voice) Object.assign(voice, { volume, speed, paused }); return !!voice; },
    audio_stop: (id: string) => voices.delete(id), audio_clear: () => voices.clear(), audio_state: (id: string) => voices.has(id) ? "playing" : "missing",
    scene_clear: () => { transforms.clear(); models.clear(); }, scene_set_3d_enabled: () => true, scene_set_environment: () => true,
    scene_spawn: () => true, scene_set_model: (id: string, path: string) => { models.set(id, path); return true; }, scene_despawn: () => true,
    scene_models_state: sceneReadiness && ((ids: string[]) => {
      assert.ok(ids.includes("track") && ids.includes("sky"));
      for (const id of ids) assert.ok(models.has(id), `Missing model ${id}`);
      return sceneReadiness.models;
    }),
    scene_render_ready_frame: sceneReadiness && (() => sceneReadiness.frame),
    scene_set_transform_3d: (id: string, ...values: number[]) => { transforms.set(id, values); return true; },
    scene_set_camera_3d: (...values: number[]) => { assert.ok(values.every(Number.isFinite)); cameras.push(values); return true; },
    storage_read: (key: string) => saved.has(key) ? { state: "ok", value: saved.get(key) } : key === "pc-race-settings-v1" ? { state: "missing" } : { state: "ok", value: "120.4" }, storage_write: (key: string, value: string) => { saved.set(key, value); return { state: "ok" }; },
    window_metrics: () => ({ width, height }),
    window_safe_area: () => ({ leftInset: geometry.leftInset, rightInset: geometry.rightInset, topInset: 0, bottomInset: 0 }),
    input_primary_pointer: () => ({ pressed: false, justPressed: false, x: 0, y: 0, viewportWidth: width * 800 / height, viewportHeight: 800 }),
    input_touches: () => { if (platform === "macos") throw new Error("PC controls must not read touch input"); return contacts; },
    input_key_pressed: (key: string) => held.has(key), input_key_just_pressed: (key: string) => pressed.has(key),
    ui_clear: () => { texts.clear(); images.clear(); nodes.clear(); styles.clear(); kinds.clear(); parents.clear(); }, ui_spawn: (id: string, parent: string, kind: string) => { assert.ok(!nodes.has(id), `Duplicate UI ID ${id}`); nodes.add(id); kinds.set(id, kind); parents.set(id, parent); return true; }, ui_set_style: (id: string, value: string) => {
      const style = JSON.parse(value);
      // Match the native enum contract; browsers accept flex-start, BMS uses start.
      if (style.alignItems && !["start", "end", "center", "stretch", "baseline"].includes(style.alignItems)) return false;
      if (style.justifyContent && !["start", "end", "center", "space-between", "space-around", "space-evenly"].includes(style.justifyContent)) return false;
      styles.set(id, { ...styles.get(id), ...style }); return true;
    }, ui_set_font: () => true,
    ui_set_image: (id: string, path: string) => { if (kinds.get(id) !== "image") return false; images.set(id, path); return true; },
    ui_set_text: (id: string, value: string) => { texts.set(id, value); return true; }, ui_button_just_pressed: (id: string) => id === clicked, ui_button_hovered: () => false,
    console: { log: () => {} },
  });
  for (const name of missingApis) delete context[name];
  new Script(bundle).runInContext(context);
  const callbacks = context as unknown as RuneweaveCallbacks;
  callbacks.on_script_loaded();
  function frame(dt = 1 / 60) { callbacks.on_update(dt); pressed.clear(); clicked = ""; contacts.forEach((contact) => { contact.justPressed = false; }); }
  function settle() { if (!downloads.hold) for (let i = 0; i < 12; i++) frame(0); }
  settle();
  function press(key: string) { pressed.add(key); frame(); settle(); }
  function click(id: string) { assert.ok(nodes.has(id), `Missing button ${id}`); clicked = id; frame(); settle(); }
  function start() {
    for (let i = 0; i < 3; i++) press("Enter");
    click("gui:tracks_and_gp:track:lighthouse"); press("Enter");
    assert.ok(images.has("map"));
    for (let i = 0; i < 190; i++) frame();
  }
  return { callbacks, frame, press, click, start, settle, downloads, packRequests, contacts, styles, saved, models, texts, images, nodes, parents, transforms, cameras, held, voices, resize: (w = 1000, h = height) => { width = w; height = h; } };
}
