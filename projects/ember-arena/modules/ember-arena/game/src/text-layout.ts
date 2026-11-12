import pixelAdvances from "../assets/fonts/spd-pixel-metrics.json" with { type: "json" };
import chineseAdvances from "../assets/fonts/noto-sans-sc-metrics.json" with { type: "json" };
import type { Language } from "./i18n.js";

const hasCjk = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
export function fontForText(language: Language, value: string): string {
  return language === "zh-CN" || hasCjk.test(value) ? "fonts/noto-sans-sc.otf" : "fonts/spd-pixel.ttf";
}

export function measureText(language: Language, value: string, size: number): number {
  const advances: Record<string, number> = fontForText(language, value) === "fonts/spd-pixel.ttf" ? pixelAdvances : chineseAdvances;
  let width = 0;
  for (const glyph of value) width += (advances[glyph] ?? (hasCjk.test(glyph) ? 1 : advances["?"]!)) * size;
  return width;
}

// Do not depend on Intl.Segmenter: the native QuickJS runtime need not provide it.
// Break Chinese at character boundaries, English at spaces, and split overlong
// tokens (including diagnostic URLs) so every line fits the available width.
export function wrapText(language: Language, value: string, width: number, size: number): string[] {
  if (width <= 0 || size <= 0) return [value];
  const layoutLanguage = fontForText(language, value) === "fonts/noto-sans-sc.otf" ? "zh-CN" : language;
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "", space = false;
    const tokens = paragraph.match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+|\s+/gu) ?? [];
    for (const token of tokens) {
      if (/^\s+$/u.test(token)) { space = line.length > 0; continue; }
      const next = line + (space ? " " : "") + token;
      space = false;
      if (measureText(layoutLanguage, next, size) <= width) { line = next; continue; }
      // Keep closing punctuation with the preceding glyph rather than orphaning
      // it at the start of a Chinese line.
      if (line.length > 1 && /^[，。！？、：；）】》」』…]/u.test(token)) {
        const glyphs = [...line], last = glyphs.pop()!;
        lines.push(glyphs.join("").trimEnd());
        line = last + token;
        continue;
      }
      if (line) { lines.push(line); line = ""; }
      for (const glyph of token) {
        if (line && measureText(layoutLanguage, line + glyph, size) > width) { lines.push(line); line = ""; }
        line += glyph;
      }
    }
    lines.push(line);
  }
  return lines;
}
