import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./game-fixture.ts";

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
test("keyboard navigation traverses source menus and preserves the race configuration on return", () => {
  const game = load("en-US");
  game.press("Enter"); assert.ok(game.nodes.has("gui:karts:choose-tux"));
  const preview = game.transforms.get("preview-body"); game.frame();
  assert.notDeepEqual(game.transforms.get("preview-body"), preview);
  game.press("ArrowRight"); game.press("Enter"); assert.ok(game.nodes.has("gui:race_setup:mode-normal"));
  game.press("Enter"); assert.ok(game.nodes.has("gui:tracks_and_gp:track:lighthouse"));
  game.press("Enter"); assert.equal(game.texts.get("gui:track_info:name:text"), "Around the lighthouse");
  assert.equal(game.texts.get("gui:track_info:target-value-spinner:value:text"), "4");
  assert.ok([...game.texts.values()].some((text) => text.includes("2:00.400")));
  game.press("Escape"); assert.ok(game.nodes.has("gui:tracks_and_gp:track:lighthouse"));
  game.press("Escape"); assert.ok(game.nodes.has("gui:race_setup:mode-normal"));
});
test("reference home entries navigate to source pages and audio volume remains functional", () => {
  const game = load("en-US");
  for (const name of ["story", "singleplayer", "multiplayer", "online", "addons", "options", "help", "tutorial", "highscores", "achievements", "gpeditor", "about", "quit"]) assert.ok(game.nodes.has(name));
  assert.equal(game.images.get("singleplayer-icon"), "ui/menu_race_focus.png");
  assert.equal(game.images.get("bottom-bar"), "ui/bottom_bar.png");
  assert.ok(game.voices.get("music")?.path.endsWith("menutheme.ogg"));
  game.click("story"); assert.equal(game.texts.get("story-title:text"), "Story Mode");
  game.press("Escape"); game.click("options");
  game.click("gui:options_audio:music_volume:down"); assert.equal(game.voices.get("music")?.volume, 0.5);
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
test("bundled racing wheels keep their axle aligned with the body while driving through a turn", () => {
  const game = load("en-US"); game.start();
  const axle = (transform: number[]) => {
    const [x, y, z] = transform.slice(3, 6);
    return [Math.cos(y) * Math.cos(z), Math.cos(x) * Math.sin(z) + Math.sin(x) * Math.sin(y) * Math.cos(z),
      Math.sin(x) * Math.sin(z) - Math.cos(x) * Math.sin(y) * Math.cos(z)];
  };
  const initialWheel = [...game.transforms.get("tux-wheel-2")!];
  game.held.add("ArrowUp"); game.held.add("ArrowRight");
  for (let frame = 0; frame < 120; frame++) {
    game.frame();
    const body = axle(game.transforms.get("tux")!);
    for (const index of [2, 3]) {
      const wheel = axle(game.transforms.get(`tux-wheel-${index}`)!);
      assert.ok(body.every((value, axis) => Math.abs(value - wheel[axis]) < 1e-8), "rolling must not wobble the rear axle");
    }
  }
  assert.notDeepEqual(game.transforms.get("tux-wheel-2")!.slice(3, 6), initialWheel.slice(3, 6));
});
