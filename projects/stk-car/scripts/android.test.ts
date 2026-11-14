import assert from "node:assert/strict";
import test from "node:test";
import { makeLayout, touchControlRects, TouchControls, type Contact, type ControlRect } from "../modules/stk-car/game/src/controls.ts";
import { raceHudLayout } from "../modules/stk-car/game/src/hud-layout.ts";
import { emptyControls } from "../modules/stk-car/game/src/race.ts";
import { load } from "./game-fixture.ts";
import { menuData } from "../modules/stk-car/game/src/menu-data.ts";

const center = (r: ControlRect, id = "finger"): Contact => ({ id, justPressed: true, x: r.x + r.width / 2, y: r.y + r.height / 2 });
const overlap = (a: ControlRect, b: ControlRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
test("landscape controls stay inside the safe area with separate thumb and instrument zones", () => {
  for (const [width, height, left, right, bottom] of [[800, 360, 28, 0, 12], [914, 411, 32, 0, 8], [960, 540, 0, 32, 16], [1280, 800, 0, 0, 24]]) {
    const layout = makeLayout(width, height, { left, right, top: 0, bottom }, true), controls = touchControlRects(layout);
    const stick = { x: layout.stickX - layout.radius, y: layout.stickY - layout.radius, width: layout.radius * 2, height: layout.radius * 2 };
    const { mapSize, mapBottom, speedUnit, speedBottom } = raceHudLayout(layout);
    const map = { x: layout.left, y: height - mapBottom - mapSize, width: mapSize, height: mapSize };
    const speed = { x: width - layout.right - 28 - 145 * speedUnit, y: height - speedBottom - 145 * speedUnit, width: 145 * speedUnit, height: 145 * speedUnit };
    for (const r of [stick, ...Object.values(controls)]) {
      assert.ok(r.x >= left && r.y >= 0 && r.x + r.width <= width - right && r.y + r.height <= height - bottom);
      assert.ok(r.width >= 44 && r.height >= 44);
      assert.equal(overlap(r, map), false); assert.equal(overlap(r, speed), false);
    }
    const all = Object.values(controls);
    all.forEach((a, index) => { all.slice(index + 1).forEach((b) => { assert.equal(overlap(a, b), false); }); });
  }
});
test("touch braking overrides automatic acceleration; thumb capture survives pointer reordering", () => {
  const layout = makeLayout(914, 411, { left: 30, right: 0, top: 0, bottom: 8 }, true), touch = new TouchControls();
  const stick = { id: "9007199254740993", justPressed: true, x: layout.stickX + layout.radius / 2, y: layout.stickY };
  const brake = center(touchControlRects(layout).brake, "1"), input = emptyControls();
  touch.apply(input, [brake, stick], layout);
  assert.ok(Math.abs(input.steer - 0.5) < 1e-12); assert.equal(input.brake, true); assert.equal(input.throttle, 0);
  const next = emptyControls();
  touch.apply(next, [{ ...stick, justPressed: false, y: layout.stickY + layout.radius * 0.8 }], layout);
  assert.equal(next.brake, true); assert.equal(next.throttle, 0);
  assert.ok(Math.hypot(touch.dx, touch.dy) <= 1);
  touch.apply(emptyControls(), [], layout); assert.equal(touch.stickId, null);
});
test("each item or rescue press fires once and sliding a finger onto a button does not activate it", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), touch = new TouchControls(), rects = touchControlRects(layout);
  for (const action of ["item", "rescue"] as const) {
    const finger = center(rects[action]), input = emptyControls(); touch.apply(input, [finger], layout);
    assert.equal(action === "item" ? input.useItem : input.rescue, true);
    const held = emptyControls(); touch.apply(held, [{ ...finger, justPressed: false }], layout);
    assert.equal(held.useItem, false); assert.equal(held.rescue, false);
    touch.apply(emptyControls(), [], layout);
    const sliding = emptyControls(); touch.apply(sliding, [{ ...finger, justPressed: false }], layout);
    assert.equal(sliding.useItem, false); assert.equal(sliding.rescue, false);
    touch.apply(emptyControls(), [], layout);
  }
});
test("pause, resume and resize require held contacts to release before driving again", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), touch = new TouchControls();
  const gas = center(touchControlRects(layout).gas);
  touch.apply(emptyControls(), [gas], layout); touch.reset();
  const blocked = emptyControls(); touch.apply(blocked, [{ ...gas, justPressed: false }], layout); assert.equal(blocked.throttle, 0);
  touch.apply(emptyControls(), [], layout);
  const fresh = emptyControls(); touch.apply(fresh, [gas], layout); assert.equal(fresh.throttle, 1);
});
test("steering combines with nitro, drift and rear view using independent contacts", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), touch = new TouchControls(), rects = touchControlRects(layout);
  const input = emptyControls();
  touch.apply(input, [{ id: "thumb", justPressed: true, x: layout.stickX + layout.radius * 0.7, y: layout.stickY }, center(rects.boost, "boost"), center(rects.drift, "drift"), center(rects["look-back"], "rear")], layout);
  assert.ok(input.steer > 0.6); assert.equal(input.throttle, 1); assert.equal(input.nitro, true); assert.equal(input.drift, true); assert.equal(input.lookBack, true);
  const cancelled = emptyControls(); touch.apply(cancelled, [], layout);
  assert.deepEqual(cancelled, emptyControls());
});
test("Android touch menus reach normal and time-trial races in English, Chinese and fallback locales", () => {
  for (const locale of ["en-US", "zh-CN", "fr-FR"]) for (const mode of ["normal", "time-trial"]) {
    const game = load(locale, "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
    assert.equal(game.texts.get("singleplayer-label"), locale === "zh-CN" ? "单人游戏" : "Singleplayer");
    game.click("singleplayer"); assert.equal(game.nodes.has("gas"), false);
    game.click("gui:karts:continue"); game.click(`gui:race_setup:mode-${mode}`);
    game.click("gui:tracks_and_gp:track:lighthouse");
    game.click("gui:track_info:target-value-spinner:down");
    game.click("gui:track_info:start");
    assert.ok(game.nodes.has("stick")); assert.ok(game.nodes.has("look-back"));
    assert.equal(game.texts.get("gas-label"), locale === "zh-CN" ? "油门" : "Gas");
    for (let i = 0; i < 200; i++) game.frame();
    const initial = [...game.transforms.get("tux")!];
    const gas = game.styles.get("gas")!, width = Number(gas.width), height = Number(gas.height);
    game.contacts.push({ id: "1", justPressed: true, x: (Number(gas.left) + width / 2) / 914, y: (Number(gas.top) + height / 2) / 411 });
    for (let i = 0; i < 45; i++) game.frame();
    assert.notDeepEqual(game.transforms.get("tux"), initial);
    assert.equal(game.transforms.has("comet"), mode === "normal");
    game.click("pause"); const paused = [...game.transforms.get("tux")!];
    for (let i = 0; i < 30; i++) game.frame(); assert.deepEqual(game.transforms.get("tux"), paused);
    game.click("resume"); game.contacts.length = 0; game.frame();
    game.callbacks.on_suspend?.(); game.frame(); assert.equal(game.texts.get("title"), locale === "zh-CN" ? "已暂停" : "Paused");
    assert.equal(game.voices.get("music")?.paused, true);
  }
});
test("mobile settings and help tabs remain navigable and language changes persist", () => {
  const game = load("zh-CN", "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
  game.click("options"); game.click("gui:options_audio:tab_controls");
  game.click("gui:options_input:device:touch"); assert.ok(game.texts.get("touch-control-rule-0:text")?.includes("摇杆"));
  game.press("Escape"); game.click("gui:options_input:tab_language");
  game.click("gui:options_language:language:en-US");
  game.click("gui:options_language:back"); assert.equal(game.texts.get("singleplayer-label"), "Singleplayer");
  game.callbacks.on_script_reloaded(); assert.equal(game.texts.get("singleplayer-label"), "Singleplayer");
  game.click("help"); game.click("gui:help1:page2"); assert.ok(game.nodes.has("gui:help2:page7"));
  game.press("Escape"); assert.ok(game.nodes.has("singleplayer"));
});
test("mobile kart preview stays selectable and time trial ignores a preview-only AI count", () => {
  const game = load("en-US", "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
  game.click("singleplayer"); game.click("gui:karts:choose-wilber");
  assert.ok(game.nodes.has("gui:karts:continue")); assert.ok(game.transforms.has("preview-body"));
  game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal"); game.click("gui:tracks_and_gp:track:lighthouse");
  game.click("gui:track_info:ai-spinner:up"); game.click("gui:track_info:start"); assert.ok(game.nodes.has("menu-dialog-frame"));
  game.press("Escape"); game.press("Escape"); game.press("Escape");
  game.click("gui:race_setup:mode-time-trial"); game.click("gui:tracks_and_gp:track:lighthouse");
  assert.equal(game.nodes.has("gui:track_info:ai-spinner:up"), false);
  game.click("gui:track_info:start"); assert.ok(game.nodes.has("gas"));
  assert.ok(game.transforms.has("tux")); assert.equal(game.transforms.has("comet"), false);
});
test("touch keyboard edits local fields, masks passwords and keeps credentials out of saved settings", () => {
  const game = load("en-US", "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
  game.click("profile"); game.click("gui:user_screen:password");
  game.click("touch-key:a"); game.click("touch-key:2");
  assert.equal(game.texts.get("touch-keyboard-value:text"), "●●|");
  assert.equal(JSON.stringify([...game.saved.values()]).includes("a2"), false);
  game.click("touch-key-tool:2"); assert.equal(game.nodes.has("touch-keyboard"), false);
  game.click("gui:user_screen:new_user"); game.click("gui:general_text_field_dialog:textfield");
  game.click("touch-key:x"); game.click("touch-key-tool:2"); game.click("gui:general_text_field_dialog:ok");
  assert.ok([...game.texts.values()].some((value) => value === "Player 2x"));
  game.press("Escape"); assert.equal(game.texts.get("profile-name"), "Player 2x");
});
test("iPhone singleplayer works without optional hover and audio diagnostic APIs", () => {
  const game = load("zh-CN", "ios", { width: 852, height: 393, leftInset: 112, rightInset: 0 }, ["ui_button_hovered", "audio_state"]);
  game.click("singleplayer"); assert.ok(game.nodes.has("gui:karts:continue"));
  game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
  game.click("gui:tracks_and_gp:track:lighthouse"); game.click("gui:track_info:start");
  for (let i = 0; i < 300; i++) game.frame();
  assert.ok(game.nodes.has("stick")); assert.ok(game.voices.get("music")?.path.endsWith("klabauter_dance.ogg"));
});
test("iOS home entries construct menus using the native layout enum contract", () => {
  for (const entry of ["story", "online", "addons", "options", "help", "highscores", "achievements", "gpeditor", "about", "profile"]) {
    const game = load("zh-CN", "ios", { width: 852, height: 393, leftInset: 112, rightInset: 0 });
    game.click(entry);
    assert.ok(game.nodes.size > 5, `${entry} should construct a page`);
    game.press("Escape"); assert.ok(game.nodes.has("singleplayer"));
  }
});
test("mobile Grand Prix details expose a playable single-race action inside the safe area", () => {
  for (const platform of ["android", "ios"]) {
    const game = load("zh-CN", platform, { width: 852, height: 393, leftInset: 112, rightInset: 0 });
    game.click("singleplayer"); game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
    game.click(`gui:tracks_and_gp:gp:${menuData.grandPrix[0].id}`);
    for (const id of ["start", "single-race"]) {
      const r = game.styles.get(`gui:gp_info:${id}`)!;
      assert.ok(Number(r.left) >= 0 && Number(r.top) >= 0 && Number(r.top) + Number(r.height) <= 393);
    }
    game.click("gui:gp_info:start"); assert.ok(game.nodes.has("menu-dialog-frame")); game.press("Escape");
    game.click("gui:gp_info:single-race"); game.click("gui:track_info:start"); assert.ok(game.nodes.has("gas"));
  }
});
