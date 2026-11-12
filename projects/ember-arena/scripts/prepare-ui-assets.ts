import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromeFrames, spdUiRevision, uiFrames, type UiRect } from "../modules/ember-arena/game/src/spd-ui-atlas.js";
import { fontAdvances } from "./font-metrics.js";
import { prepareFonts } from "./prepare-fonts.js";

interface Png { w: number; h: number; pixels: Buffer }
export async function prepareUiAssets(assets: string, cache: string, decode: (bytes: Buffer) => Png, encode: (w: number, h: number, pixels: Buffer) => Buffer): Promise<void> {
  await prepareFonts(assets, cache);
  const target = join(assets, "sprites/spd-ui");
  mkdirSync(target, { recursive: true }); mkdirSync(join(assets, "fonts"), { recursive: true });
  const base = `https://raw.githubusercontent.com/00-Evan/shattered-pixel-dungeon/${spdUiRevision}/core/src/main/assets/`;
  const files: Record<string, string> = {};
  for (const frame of Object.values(uiFrames)) files[frame.source] = `interfaces/${frame.source}`;
  files["items.png"] = "sprites/items.png";
  for (const hero of ["warrior", "mage", "rogue", "huntress", "duelist", "cleric"]) files[`${hero}.png`] = `sprites/${hero}.png`;
  files["chrome.png"] = "interfaces/chrome.png";
  files["archs.png"] = "splashes/title/archs.png";
  files["back_clusters.png"] = "splashes/title/back_clusters.png";
  files["mid_mixed.png"] = "splashes/title/mid_mixed.png";
  files["front_small.png"] = "splashes/title/front_small.png";
  files["pixel_font.ttf"] = "fonts/pixel_font.ttf";
  await Promise.all(Object.entries(files).map(async ([name, path]) => {
    const cached = join(cache, `ui-${spdUiRevision.slice(0, 8)}-${name}`);
    if (!existsSync(cached)) {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`UI asset download failed: ${path}: ${response.status}`);
      writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
    }
  }));
  const sources = new Map<string, Png>();
  const records: { file: string; source: string; rect: UiRect; sha256: string }[] = [];
  function crop(name: string, source: string, rect: UiRect): void {
    if (!sources.has(source)) sources.set(source, decode(readFileSync(join(cache, `ui-${spdUiRevision.slice(0, 8)}-${source}`))));
    const png = sources.get(source)!, [x, y, w, h] = rect;
    if (x < 0 || y < 0 || x + w > png.w || y + h > png.h) throw new Error(`Invalid original UI crop: ${name}: ${png.w}x${png.h}`);
    const pixels = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++) png.pixels.copy(pixels, row * w * 4, ((y + row) * png.w + x) * 4, ((y + row) * png.w + x + w) * 4);
    const bytes = encode(w, h, pixels), file = `sprites/spd-ui/${name}.png`;
    writeFileSync(join(assets, file), bytes);
    records.push({ file, source: base + files[source], rect, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  for (const [name, frame] of Object.entries(uiFrames)) crop(name, frame.source, frame.rect);
  for (const [name, frame] of Object.entries(chromeFrames)) {
    const [x, y, w, h] = frame.rect, b = frame.border;
    const widths = [b, w - 2 * b, b], heights = [b, h - 2 * b, b];
    // Tabs use asymmetric top/bottom margins in upstream; retain the full art
    // for tab buttons rather than cutting the one-pixel middle row negatively.
    if (widths[1]! <= 0 || heights[1]! <= 0) { crop(`chrome_${name}`, "chrome.png", frame.rect); continue; }
    for (let row = 0, sy = y; row < 3; sy += heights[row++]!) {
      for (let col = 0, sx = x; col < 3; sx += widths[col++]!) crop(`${name}_${row}_${col}`, "chrome.png", [sx, sy, widths[col]!, heights[row]!]);
    }
  }
  crop("title_arch", "archs.png", [0, 0, 333, 100]);
  crop("title_cluster", "back_clusters.png", [0, 0, 450, 250]);
  crop("title_mid", "mid_mixed.png", [0, 0, 273, 242]);
  crop("title_front", "front_small.png", [0, 0, 112, 116]);
  // HeroSelectScene's black-black-transparent left fade, sampled explicitly so
  // the image can retain nearest sampling alongside the pixel-art chrome.
  const fade = Buffer.alloc(96 * 4);
  for (let x = 0; x < 96; x++) fade[x * 4 + 3] = Math.round(255 * Math.min(1, (95 - x) / 32));
  writeFileSync(join(target, "hero_fade.png"), encode(96, 1, fade));
  const font = readFileSync(join(cache, `ui-${spdUiRevision.slice(0, 8)}-pixel_font.ttf`));
  writeFileSync(join(assets, "fonts/spd-pixel.ttf"), font);
  writeFileSync(join(assets, "fonts/spd-pixel-metrics.json"), JSON.stringify(fontAdvances(font)) + "\n");
  writeFileSync(join(assets, "licenses/ui-sources.json"), JSON.stringify({ revision: spdUiRevision, records,
    font: { file: "fonts/spd-pixel.ttf", source: base + files["pixel_font.ttf"], sha256: createHash("sha256").update(font).digest("hex") } }, null, 2) + "\n");
}
