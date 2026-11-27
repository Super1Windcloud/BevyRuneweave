import assert from "node:assert/strict";
import test from "node:test";
import { makeLayout, touchControlRects, TouchControls, steeringAssist, type Contact, type ControlRect } from "../modules/stk-car/game/src/controls.ts";
import { raceHudLayout } from "../modules/stk-car/game/src/hud-layout.ts";
import { Circuit, Race, emptyControls, fixedStep } from "../modules/stk-car/game/src/race.ts";
import { parseSettings } from "../modules/stk-car/game/src/session.ts";
import { load } from "./game-fixture.ts";
import { menuData } from "../modules/stk-car/game/src/menu-data.ts";
import { courses, courseFor } from "../modules/stk-car/game/src/courses.ts";

const center = (r: ControlRect, id = "finger"): Contact => ({ id, justPressed: true, x: r.x + r.width / 2, y: r.y + r.height / 2 });
const overlap = (a: ControlRect, b: ControlRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
test("landscape controls stay inside the safe area with separate thumb and instrument zones", () => {
  for (const [width, height, left, right, bottom] of [[800, 360, 28, 0, 12], [914, 411, 32, 0, 8], [960, 540, 0, 32, 16], [1280, 800, 0, 0, 24]]) {
    const layout = makeLayout(width, height, { left, right, top: 0, bottom }, true), controls = touchControlRects(layout);
    const { mapSize, mapBottom, speedUnit, speedBottom } = raceHudLayout(layout);
    const map = { x: layout.left, y: height - mapBottom - mapSize, width: mapSize, height: mapSize };
    const speed = { x: width - layout.right - 28 - 145 * speedUnit, y: height - speedBottom - 145 * speedUnit, width: 145 * speedUnit, height: 145 * speedUnit };
    for (const r of Object.values(controls)) {
      assert.ok(r.x >= left && r.y >= 0 && r.x + r.width <= width - right && r.y + r.height <= height - bottom);
      assert.ok(r.width >= 44 && r.height >= 44);
      assert.equal(overlap(r, map), false); assert.equal(overlap(r, speed), false);
    }
    const all = Object.values(controls);
    all.forEach((a, index) => { all.slice(index + 1).forEach((b) => { assert.equal(overlap(a, b), false); }); });
  }
});
test("automatic acceleration and contextual drift/brake survive pointer reordering", () => {
  const layout = makeLayout(914, 411, { left: 30, right: 0, top: 0, bottom: 8 }, true), touch = new TouchControls();
  const rects = touchControlRects(layout), arrow = center(rects.right, "9007199254740993"), drift = center(rects.drift, "1"), input = emptyControls();
  touch.apply(input, [drift, arrow], layout);
  assert.equal(input.steer, 1); assert.equal(input.drift, true); assert.equal(input.brake, false); assert.equal(input.throttle, 1);
  const next = emptyControls();
  touch.apply(next, [{ ...arrow, justPressed: false }, { ...drift, justPressed: false }], layout);
  assert.equal(next.steer, 1); assert.equal(next.drift, true);
  const brake = emptyControls(); touch.apply(brake, [{ ...drift, justPressed: false }], layout);
  assert.equal(brake.brake, true); assert.equal(brake.drift, false); assert.equal(brake.throttle, 0); assert.equal(brake.allowReverse, false);
  const released = emptyControls(); touch.apply(released, [], layout);
  assert.equal(released.throttle, 1); assert.equal(released.steer, 0); assert.equal(released.brake, false);
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
  const arrow = center(touchControlRects(layout).right);
  touch.apply(emptyControls(), [arrow], layout); touch.reset();
  const blocked = emptyControls(); touch.apply(blocked, [{ ...arrow, justPressed: false }], layout); assert.equal(blocked.throttle, 0); assert.equal(blocked.steer, 0);
  touch.apply(emptyControls(), [], layout);
  const fresh = emptyControls(); touch.apply(fresh, [arrow], layout); assert.equal(fresh.throttle, 1); assert.equal(fresh.steer, 1);
});
test("steering combines with nitro, drift and rear view using independent contacts", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), touch = new TouchControls(), rects = touchControlRects(layout);
  const input = emptyControls();
  touch.apply(input, [center(rects.right, "thumb"), center(rects.boost, "boost"), center(rects.drift, "drift"), center(rects["look-back"], "rear")], layout);
  assert.equal(input.steer, 1); assert.equal(input.throttle, 1); assert.equal(input.nitro, true); assert.equal(input.drift, true); assert.equal(input.lookBack, true);
  const cancelled = emptyControls(); touch.apply(cancelled, [], layout);
  assert.deepEqual(cancelled, { ...emptyControls(), throttle: 1, allowReverse: false });
});
test("steering can slide between arrows but cannot slide onto nitro or fire", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), rects = touchControlRects(layout), touch = new TouchControls();
  const finger = center(rects.left, "steering"), first = emptyControls(); touch.apply(first, [finger], layout); assert.equal(first.steer, -1);
  const switched = emptyControls(); touch.apply(switched, [{ ...center(rects.right, finger.id), justPressed: false }], layout); assert.equal(switched.steer, 1);
  for (const target of [rects.boost, rects.item]) {
    const outside = emptyControls(); touch.apply(outside, [{ ...center(target, finger.id), justPressed: false }], layout);
    assert.equal(outside.steer, 0); assert.equal(outside.nitro, false); assert.equal(outside.useItem, false);
  }
});
test("opposing arrows cancel and explicit steering overrides the optional assistance", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), rects = touchControlRects(layout), touch = new TouchControls();
  const assist = { steer: 0.65, speed: 20, speedLimit: 10 };
  const assisted = emptyControls(); touch.apply(assisted, [], layout, true, assist);
  assert.equal(assisted.steer, 0.65); assert.equal(assisted.throttle, 0); assert.equal(assisted.brake, true);
  const manual = emptyControls(); touch.apply(manual, [center(rects.left, "a")], layout, true, assist);
  assert.equal(manual.steer, -1); assert.equal(manual.throttle, 1); assert.equal(manual.brake, false);
  const opposite = emptyControls(); touch.apply(opposite, [{ ...center(rects.left, "a"), justPressed: false }, center(rects.right, "b")], layout, true, assist);
  assert.equal(opposite.steer, 0); assert.equal(opposite.brake, false);
  touch.apply(emptyControls(), [], layout);
  const nitro = emptyControls(); touch.apply(nitro, [center(rects.boost)], layout, true, assist);
  assert.equal(nitro.throttle, 1); assert.equal(nitro.brake, false);
});
test("steering assistance leaves the brake in braking mode until a steering arrow is pressed", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true);
  const touch = new TouchControls(), rects = touchControlRects(layout), brake = center(rects.drift, "brake");
  const assist = { steer: 0.7, speed: 15, speedLimit: 11 };
  const assisted = emptyControls(); touch.apply(assisted, [brake], layout, true, assist);
  assert.equal(assisted.brake, true); assert.equal(assisted.drift, false); assert.equal(assisted.throttle, 0);
  const manual = emptyControls(); touch.apply(manual, [{ ...brake, justPressed: false }, center(rects.left, "steer")], layout, true, assist);
  assert.equal(manual.drift, true); assert.equal(manual.brake, false); assert.equal(manual.steer, -1);
});
test("resuming with old fingers down suppresses new actions until they release", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), rects = touchControlRects(layout), touch = new TouchControls();
  touch.reset();
  const old = { ...center(rects.right, "old"), justPressed: false }, boost = center(rects.boost, "new");
  touch.apply(emptyControls(), [old], layout);
  const blocked = emptyControls(); touch.apply(blocked, [old, boost], layout); assert.equal(blocked.throttle, 0); assert.equal(blocked.nitro, false);
  const released = emptyControls(); touch.apply(released, [{ ...boost, justPressed: false }], layout); assert.equal(released.throttle, 1); assert.equal(released.nitro, false);
  touch.apply(emptyControls(), [], layout);
  const fresh = emptyControls(); touch.apply(fresh, [boost], layout); assert.equal(fresh.nitro, true);
});
test("mobile braking stops without reversing and a charged drift still boosts on release", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true), touch = new TouchControls(), rects = touchControlRects(layout);
  const circuit = new Circuit([{ center: [0, 0, 0], width: 100 }, { center: [0, 0, -200], width: 100 }, { center: [200, 0, -200], width: 100 }, { center: [200, 0, 0], width: 100 }]);
  const race = new Race(circuit, [], 3, { difficulty: 1, aiCount: 0, mode: "normal", kartId: "tux" });
  race.phase = "racing"; race.elapsed = 2; race.player.speed = 15; race.player.startBoostApplied = true;
  const brake = center(rects.drift);
  for (let tick = 0; tick < 360; tick++) {
    const input = emptyControls(); touch.apply(input, [{ ...brake, justPressed: tick === 0 }], layout); race.step(fixedStep, input); assert.ok(race.player.speed >= 0);
  }
  assert.equal(race.player.speed, 0);
  const go = emptyControls(); touch.apply(go, [], layout); race.step(fixedStep, go); assert.ok(race.player.speed > 0);
  Object.assign(race.player, circuit.sample(30), { speed: 15, routeDistance: 30, progress: 30, steering: 1, driftCharge: 1.5 });
  const drifting = emptyControls(); touch.apply(drifting, [center(rects.right, "turn"), center(rects.drift, "drift")], layout);
  race.step(fixedStep, drifting); assert.ok(race.player.driftCharge > 1.5);
  const exit = emptyControls(); touch.apply(exit, [{ ...center(rects.right, "turn"), justPressed: false }], layout); race.step(fixedStep, exit);
  assert.equal(race.player.driftCharge, 0); assert.ok(race.player.boost > 2.9); assert.equal(exit.throttle, 1);
});
test("assistance corrects an edge departure and its setting validates saved types", () => {
  const circuit = new Circuit([{ center: [0, 0, 0], width: 10 }, { center: [0, 0, -100], width: 10 }, { center: [100, 0, -100], width: 10 }]);
  const race = new Race(circuit, []);
  Object.assign(race.player, circuit.sample(30, 4), { routeDistance: 30, speed: 15 });
  assert.ok(steeringAssist(race).steer < 0);
  Object.assign(race.player, circuit.sample(30, -4)); assert.ok(steeringAssist(race).steer > 0);
  assert.equal(parseSettings("{}").steeringAssist, false);
  assert.equal(parseSettings('{"steeringAssist":true}').steeringAssist, true);
  assert.equal(parseSettings('{"steeringAssist":"true"}').steeringAssist, false);
});
test("the mobile steering assist completes all courses in both directions at each difficulty", () => {
  const layout = makeLayout(914, 411, { left: 0, right: 0, top: 0, bottom: 0 }, true);
  for (const course of courses) for (const reverse of [false, true]) for (const difficulty of [0, 1, 2, 3]) {
    const race = new Race(new Circuit(reverse ? [...course.route].reverse() : course.route), course.pickups, 1,
      { difficulty, aiCount: 0, mode: "time-trial", kartId: "tux" });
    const touch = new TouchControls();
    race.start();
    for (let frame = 0; frame < 60 * 300 && race.phase !== "finished"; frame++) {
      const input = emptyControls(), racing = race.phase === "racing";
      touch.apply(input, [], layout, racing, racing ? steeringAssist(race) : undefined);
      race.step(fixedStep, input);
      race.step(fixedStep, input);
    }
    assert.equal(race.phase, "finished", `${course.id}, reverse=${reverse}, difficulty=${difficulty}`);
  }
});
test("the Android random track shortcut only selects playable maps and returns to the picker", () => {
  const game = load("en-US", "android", { width: 680, height: 306, leftInset: 36, rightInset: 0 });
  game.click("singleplayer");
  game.click("gui:karts:continue");
  game.click("gui:race_setup:mode-time-trial");
  game.click("gui:tracks_and_gp:random_track");
  const settings = JSON.parse(game.saved.get("pc-race-settings-v1")!);
  assert.ok(courseFor(settings.trackId));
  assert.equal(settings.mode, "time-trial");
  assert.ok(game.nodes.has("gui:track_info:start"));
  game.click("gui:track_info:back");
  game.click("gui:tracks_and_gp:track-section:scenes");
  assert.equal(game.nodes.has("gui:tracks_and_gp:random_track"), false);
});
test("compact Android results paginate lap times and retain the kart and mode when changing tracks", () => {
  const game = load("zh-CN", "android", { width: 670, height: 290, leftInset: 32, rightInset: 0 });
  game.saved.set("pc-race-settings-v1", JSON.stringify({ steeringAssist: true }));
  game.callbacks.on_script_reloaded();
  game.click("singleplayer");
  game.click("gui:karts:choose-suzanne");
  game.click("gui:karts:continue");
  game.click("gui:race_setup:mode-time-trial");
  game.click("gui:tracks_and_gp:track:lighthouse");
  game.click("gui:track_info:target-value-spinner:down");
  game.click("gui:track_info:start");
  for (let frame = 0; frame < 60 * 360 && !game.nodes.has("results-panel"); frame++) game.frame();
  assert.ok(game.nodes.has("results-panel"));
  assert.equal(game.texts.get("title"), "比赛结果");
  assert.match(game.texts.get("result-0")!, /Suzanne/);
  for (const id of ["result-standings", "result-laps"]) assert.equal(game.styles.get(id)?.flexDirection, "column");
  assert.equal(game.texts.get("result-page"), "1/2");
  game.click("result-laps-next");
  assert.equal(game.texts.get("result-lap-2-name"), "第 3 圈");
  assert.equal(game.texts.get("result-page"), "2/2");
  for (const id of ["race-again", "change-track", "choose-new-race", "result-menu"]) {
    assert.equal(game.parents.get(id), "result-actions");
    assert.equal(game.styles.get(id)?.height, 48);
  }
  game.click("change-track");
  game.click("gui:tracks_and_gp:track:hacienda");
  assert.equal(game.nodes.has("gui:track_info:ai-spinner"), false);
  const settings = JSON.parse(game.saved.get("pc-race-settings-v1")!);
  assert.equal(settings.mode, "time-trial");
  assert.equal(settings.kartId, "suzanne");
  assert.equal(settings.trackId, "hacienda");
});
test("Android and iOS auto accelerate only after countdown and keep the primary HUD separate from auxiliary controls", () => {
  for (const platform of ["android", "ios"]) {
    const game = load("en-US", platform, { width: 914, height: 411, leftInset: 40, rightInset: 0 });
    for (let page = 0; page < 5; page++) game.press("Enter");
    const initial = [...game.transforms.get("tux")!];
    for (let frame = 0; frame < 150; frame++) game.frame();
    assert.deepEqual(game.transforms.get("tux"), initial, "countdown cannot accelerate or cause a false start");
    for (let frame = 0; frame < 60; frame++) game.frame();
    assert.notDeepEqual(game.transforms.get("tux"), initial, "driving begins without holding a throttle button");
    assert.notEqual(game.texts.get("status"), "False start!");
    for (const absent of ["gas", "brake", "stick", "stick-thumb"]) assert.equal(game.nodes.has(absent), false);
    assert.ok(Number(game.styles.get("rescue")!.top) < Number(game.styles.get("left")!.top));
    const arrow = game.styles.get("right")!;
    game.contacts.push({ id: "thumb", justPressed: true, x: (Number(arrow.left) + Number(arrow.width) / 2) / 914, y: (Number(arrow.top) + Number(arrow.height) / 2) / 411 });
    game.frame(); assert.notDeepEqual(game.styles.get("right")!.background, game.styles.get("left")!.background);
  }
});
test("steering assistance toggles from touch settings, persists, and remains optional", () => {
  for (const platform of ["android", "ios"]) {
    const game = load("zh-CN", platform);
    game.click("options"); game.click("gui:options_audio:tab_controls"); game.click("gui:options_input:device:touch");
    assert.equal(game.texts.get("gui:touch_controls:steering-assist:label:text"), "辅助转向：关闭");
    game.click("gui:touch_controls:steering-assist");
    assert.equal(JSON.parse(game.saved.get("pc-race-settings-v1")!).steeringAssist, true);
    game.callbacks.on_script_reloaded();
    game.click("options"); game.click("gui:options_audio:tab_controls"); game.click("gui:options_input:device:touch");
    assert.equal(game.texts.get("gui:touch_controls:steering-assist:label:text"), "辅助转向：开启");
    game.click("gui:touch_controls:steering-assist"); assert.equal(JSON.parse(game.saved.get("pc-race-settings-v1")!).steeringAssist, false);
  }
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
    assert.ok(game.nodes.has("left")); assert.ok(game.nodes.has("right")); assert.ok(game.nodes.has("look-back"));
    assert.equal(game.nodes.has("gas"), false); assert.equal(game.nodes.has("stick"), false);
    assert.equal(game.texts.get("boost-label"), locale === "zh-CN" ? "氮气" : "Nitro");
    for (let i = 0; i < 200; i++) game.frame();
    const initial = [...game.transforms.get("tux")!];
    for (let i = 0; i < 45; i++) game.frame();
    assert.notDeepEqual(game.transforms.get("tux"), initial);
    assert.equal(game.transforms.has("comet"), mode === "normal");
    game.click("pause"); const paused = [...game.transforms.get("tux")!];
    assert.ok(!game.nodes.has("positions")); assert.ok(!game.nodes.has("map"));
    for (let i = 0; i < 30; i++) game.frame(); assert.deepEqual(game.transforms.get("tux"), paused);
    game.click("resume"); game.contacts.length = 0; game.frame();
    game.callbacks.on_suspend?.(); game.frame(); assert.equal(game.texts.get("title"), locale === "zh-CN" ? "已暂停" : "Paused");
    assert.equal(game.voices.get("music")?.paused, true);
  }
});
test("mobile settings and help tabs remain navigable and language changes persist", () => {
  const game = load("zh-CN", "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
  game.click("options"); game.click("gui:options_audio:tab_controls");
  game.click("gui:options_input:device:touch"); assert.ok(game.texts.get("touch-control-rule-0:text")?.includes("左右键"));
  game.press("Escape"); game.click("gui:options_input:tab_language");
  game.click("gui:options_language:language:en-US");
  game.click("gui:options_language:back"); assert.equal(game.texts.get("singleplayer-label"), "Singleplayer");
  game.callbacks.on_script_reloaded(); assert.equal(game.texts.get("singleplayer-label"), "Singleplayer");
  game.click("help"); game.click("gui:help1:page2"); assert.ok(game.nodes.has("gui:help2:page7"));
  game.press("Escape"); assert.ok(game.nodes.has("singleplayer"));
});
test("mobile kart selection requires Continue and racing setup clamps AI to the supported range", () => {
  const game = load("en-US", "android", { width: 914, height: 411, leftInset: 50, rightInset: 0 });
  game.click("singleplayer"); game.click("gui:karts:choose-wilber");
  game.click("gui:karts:choose-wilber");
  assert.ok(game.nodes.has("gui:karts:continue")); assert.ok(game.transforms.has("preview-body"));
  game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal"); game.click("gui:tracks_and_gp:track:lighthouse");
  game.click("gui:track_info:ai-spinner:up");
  assert.equal(game.texts.get("gui:track_info:ai-spinner:value:text"), "3");
  game.click("gui:track_info:option"); assert.match(game.texts.get("gui:track_info:option:label:text")!, /On$/);
  game.press("Escape"); game.press("Escape");
  game.click("gui:race_setup:mode-time-trial"); game.click("gui:tracks_and_gp:track:lighthouse");
  assert.equal(game.nodes.has("gui:track_info:ai-spinner:up"), false);
  game.click("gui:track_info:start"); assert.ok(game.nodes.has("right"));
  assert.ok(game.transforms.has("tux")); assert.equal(game.transforms.has("comet"), false);
});
test("preview-only modes stay in setup and new race clears the previous navigation stack", () => {
  const game = load("zh-CN", "android");
  game.click("singleplayer"); game.click("gui:karts:continue");
  assert.match(game.texts.get("gui:race_setup:mode-battle:label:text")!, /预览$/);
  game.click("gui:race_setup:mode-battle"); assert.ok(game.nodes.has("menu-dialog-frame"));
  assert.ok(!game.nodes.has("gui:tracks_and_gp:track:lighthouse"));
  game.press("Escape"); game.click("gui:race_setup:mode-normal");
  game.click("gui:tracks_and_gp:track:lighthouse"); game.click("gui:track_info:start");
  game.click("pause"); game.click("new-race"); assert.ok(game.nodes.has("gui:karts:continue"));
  game.click("gui:karts:back"); assert.ok(game.nodes.has("singleplayer"));
});
test("compact landscape keeps map pagination and race actions inside the safe area", () => {
  const game = load("en-US", "android", { width: 680, height: 300, leftInset: 42, rightInset: 0 });
  game.click("singleplayer"); game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
  const race = "gui:tracks_and_gp:track:lighthouse", next = "mobile-tracks:races:page-1";
  const bounds = (id: string) => {
    const { left, top, width, height } = game.styles.get(id)!;
    return { x: Number(left), y: Number(top), width: Number(width), height: Number(height) };
  };
  assert.equal(bounds(next).width, 44);
  assert.equal(overlap(bounds(next), bounds(race)), false);
  game.click(race);
  const reverse = bounds("gui:track_info:option"), start = bounds("gui:track_info:start"), status = bounds("track-resource-status");
  assert.equal(overlap(reverse, start), false); assert.equal(overlap(reverse, status), false);
  assert.ok(start.y + start.height <= 300);
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
  assert.ok(game.nodes.has("right")); assert.ok(game.voices.get("music")?.path.endsWith("klabauter_dance.ogg"));
});
test("iOS home entries construct menus using the native layout enum contract", () => {
  for (const entry of ["story", "online", "addons", "options", "help", "highscores", "achievements", "gpeditor", "about", "profile"]) {
    const game = load("zh-CN", "ios", { width: 852, height: 393, leftInset: 112, rightInset: 0 });
    game.click(entry);
    assert.ok(game.nodes.size > 5, `${entry} should construct a page`);
    game.press("Escape"); assert.ok(game.nodes.has("singleplayer"));
  }
});
test("mobile Grand Prix details let players choose a single-race track inside the safe area", () => {
  for (const platform of ["android", "ios"]) {
    const game = load("zh-CN", platform, { width: 852, height: 393, leftInset: 112, rightInset: 0 });
    game.click("singleplayer"); game.click("gui:karts:continue"); game.click("gui:race_setup:mode-normal");
    game.click("gui:tracks_and_gp:track-section:grand-prix");
    game.click(`gui:tracks_and_gp:gp:${menuData.grandPrix[0].id}`);
    for (const id of ["start", "single-race"]) {
      const r = game.styles.get(`gui:gp_info:${id}`)!;
      assert.ok(Number(r.left) >= 0 && Number(r.top) >= 0 && Number(r.top) + Number(r.height) <= 393);
    }
    game.click("gui:gp_info:start"); assert.ok(game.nodes.has("menu-dialog-frame")); game.press("Escape");
    game.click("gui:gp_info:single-race"); game.click("gui:tracks_and_gp:track:lighthouse");
    game.click("gui:track_info:start"); assert.ok(game.nodes.has("right"));
    assert.equal(game.images.get("map"), "ui/minimap.png");
  }
});
