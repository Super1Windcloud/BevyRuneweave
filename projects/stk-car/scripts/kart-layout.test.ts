import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { makeLayout } from "../modules/stk-car/game/src/controls.ts";
import { guiLayout, type GuiBox } from "../modules/stk-car/game/src/gui-layout.ts";
import { kartBackdropTransform, kartMenuSource, kartPreviewBasis, kartPreviewCamera, kartPreviewRect, menuGeometry, playerKartRects } from "../modules/stk-car/game/src/kart-layout.ts";
import { menuData } from "../modules/stk-car/game/src/menu-data.ts";
import { load } from "./game-fixture.ts";
import { skinSlices } from "./skin-slices.ts";

const assets = resolve(import.meta.dirname, "../modules/stk-car/game/assets");
const flatten = (box: GuiBox): GuiBox[] => [box, ...box.children.flatMap(flatten)];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);

test("desktop kart layout follows source proportions, padding and player/model/name ordering at multiple sizes", () => {
  for (const [width, height] of [[960, 540], [1280, 720], [2048, 1152], [2560, 1080]]) {
    const layout = makeLayout(width, height, { left: 0, right: 0, top: 0, bottom: 0 });
    const { rect, scale } = menuGeometry(layout), boxes = flatten(guiLayout(kartMenuSource(), rect, scale));
    const area = boxes.find((box) => box.node.attributes.id === "playerskarts")!.rect;
    const panel = boxes.find((box) => box.node.tag === "box")!;
    const grid = boxes.find((box) => box.node.attributes.id === "karts")!.rect;
    const tabs = boxes.find((box) => box.node.attributes.id === "kartgroups")!.rect;
    assert.ok(!boxes.some((box) => box.node.attributes.id === "continue"));
    close(panel.rect.x, width * 0.01);
    close(panel.rect.width, width * 0.98);
    assert.ok(grid.x >= panel.rect.x + 2 * scale && grid.x + grid.width <= panel.rect.x + panel.rect.width - 2 * scale + 0.001);
    assert.ok(area.y + area.height < panel.rect.y && panel.rect.y + panel.rect.height <= tabs.y + 0.001);
    const player = playerKartRects(area, scale), preview = kartPreviewRect(layout);
    close(preview.x + preview.width / 2, area.x + area.width / 4);
    assert.ok(player.player.y + player.player.height <= preview.y + 0.001);
    assert.ok(preview.y + preview.height <= player.name.y + 0.001);
    for (const box of boxes) for (const child of box.children) {
      assert.ok(child.rect.x >= box.rect.x - 0.001 && child.rect.y >= box.rect.y - 0.001);
      assert.ok(child.rect.x + child.rect.width <= box.rect.x + box.rect.width + 0.001);
      assert.ok(child.rect.y + child.rect.height <= box.rect.y + box.rect.height + 0.001);
    }
  }
});

test("perspective framing projects the rotating kart into its widget and covers every window corner with the backdrop", () => {
  const { right, up, forward } = kartPreviewBasis(), dot = (a: number[], b: number[]) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  for (const platform of ["desktop", "mobile"]) for (const [width, height] of [[960, 540], [2048, 1152], [2560, 1080]]) {
    const layout = makeLayout(width, height, { left: 20, right: 0, top: 0, bottom: 10 }, platform === "mobile");
    const rect = kartPreviewRect(layout), camera = kartPreviewCamera(layout), tangent = Math.tan(camera[6] * Math.PI / 360);
    const project = (point: number[]) => {
      const delta = point.map((value, axis) => value - camera[axis]), depth = dot(delta, forward);
      return [width / 2 + dot(delta, right) / (depth * tangent) * height / 2, height / 2 - dot(delta, up) / (depth * tangent) * height / 2];
    };
    const center = project([0, 0.45, 0]);
    close(center[0], rect.x + rect.width / 2); close(center[1], rect.y + rect.height / 2);
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) for (const y of [0, 1]) {
      const [x, screenY] = project([Math.cos(angle), y, Math.sin(angle)]);
      assert.ok(x >= rect.x && x <= rect.x + rect.width && screenY >= rect.y && screenY <= rect.y + rect.height, "kart bounds stay above the selection panel throughout rotation");
    }
    const backdrop = kartBackdropTransform(layout, camera), scale = backdrop[6];
    const corners = [[-1, -0.5], [1, 0.5]].map(([x, y]) => project(right.map((value, axis) => backdrop[axis] + (value * x + up[axis] * y) * scale)));
    assert.ok(corners[0][0] <= 0.001 && corners[0][1] >= height - 0.001 && corners[1][0] >= width - 0.001 && corners[1][1] <= 0.001);
  }
});

test("kart menu uses section slices, preserves focused skins and keeps input navigation working in both languages", () => {
  for (const locale of ["en-US", "zh-CN", "fr-FR"]) {
    const game = load(locale); game.press("Enter");
    const panel = [...game.nodes].find((id) => id.endsWith(":box"))!;
    assert.ok(panel);
    for (let index = 0; index < 9; index++) assert.equal(game.images.get(`${panel}:slice-${index}`), `ui/slices/glass_section-${index}.png`);
    assert.ok(!game.nodes.has("gui:karts:continue"));
    assert.equal(game.styles.get("performance")?.bottom, undefined, "diagnostics must not cover the bottom tabs");
    assert.equal(game.texts.get("gui:karts:playerskarts:player:label:text"), locale === "zh-CN" ? "玩家" : "Player");
    assert.equal(game.texts.get("gui:karts:playerskarts:name:text"), "Tux");
    assert.ok(Number(game.styles.get("gui:karts:playerskarts:player:face:slice-4")?.height) > 14, "short spinners retain their center instead of collapsing into the bottom border");
    assert.ok(!game.images.has("gui:karts:search:face"), "source text fields must not look like orange buttons");
    game.click("gui:karts:group:Standard");
    assert.equal(game.images.get("gui:karts:group:Standard:face:slice-4"), "ui/slices/glasstab_focus-4.png");
    game.click("gui:karts:choose-pidgin");
    assert.equal(game.texts.get("gui:karts:playerskarts:name:text"), "Pidgin");
    game.click("gui:karts:choose-pidgin"); assert.ok(game.nodes.has("gui:race_setup:mode-normal"));
  }
});

test("packaged skin slices retain PNG palettes/alpha and have source border dimensions", () => {
  const manifest = JSON.parse(readFileSync(join(assets, "asset-manifest.json"), "utf8")) as { files: string[] };
  for (const info of Object.values(menuData.images)) {
    if (!info.slices || !info.borders) continue;
    const original = readFileSync(join(assets, info.path)), [left, right, top, bottom] = info.borders;
    const widths = [left, info.width - left - right, right], heights = [top, info.height - top - bottom, bottom];
    info.slices.forEach((path, index) => {
      if (!path) return;
      assert.ok(manifest.files.includes(path));
      const png = readFileSync(join(assets, path));
      assert.equal(png.readUInt32BE(16), widths[index % 3]); assert.equal(png.readUInt32BE(20), heights[Math.floor(index / 3)]);
      for (const type of ["PLTE", "tRNS"]) {
        const start = original.indexOf(type), sliced = png.indexOf(type);
        assert.equal(start < 0, sliced < 0);
        if (start >= 0) assert.deepEqual(png.subarray(sliced, sliced + 4 + png.readUInt32BE(sliced - 4)), original.subarray(start, start + 4 + original.readUInt32BE(start - 4)));
      }
      const cropped = skinSlices(png, [0, 0, 0, 0]);
      const center = cropped[4], start = center.indexOf("IDAT"), raw = inflateSync(center.subarray(start + 4, start + 4 + center.readUInt32BE(start - 4)));
      assert.ok(raw.length > 0);
    });
  }
  assert.throws(() => skinSlices(readFileSync(join(assets, "ui/source/skins/common/glass_section.png")), [1000, 1, 1, 1]), /Invalid skin borders/);
});
