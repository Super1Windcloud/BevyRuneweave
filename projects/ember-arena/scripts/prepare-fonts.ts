import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { messages } from "../modules/ember-arena/game/src/i18n.js";
import { fontAdvances } from "./font-metrics.js";

const revision = "523d033d6cb47f4a80c58a35753646f5c3608a78";
const source = `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/`;
const fontHash = "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9";
const licenseHash = "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2";

export async function prepareFonts(assets: string, cache: string): Promise<void> {
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(assets, "fonts"), { recursive: true });
  mkdirSync(join(assets, "licenses"), { recursive: true });
  async function download(name: string, path: string, hash: string): Promise<Buffer> {
    const cached = join(cache, name);
    if (!existsSync(cached)) {
      const response = await fetch(source + path, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Font download failed: ${path}: ${response.status}`);
      writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
    }
    const bytes = readFileSync(cached);
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`Font checksum mismatch: ${name}`);
    return bytes;
  }
  const fontPath = "Sans/SubsetOTF/SC/NotoSansSC-Regular.otf";
  const font = await download("noto-sans-sc-2.004.otf", fontPath, fontHash);
  const license = await download("noto-sans-sc-2.004-LICENSE.txt", "LICENSE", licenseHash);
  const characters = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join("")
    + Object.values(messages).flat().join("").replace(/[\n\r\t]/g, "");
  const metrics = fontAdvances(font, characters);
  const missing = [...new Set(characters)].filter((character) => metrics[character] === undefined);
  if (missing.length) throw new Error(`Chinese font is missing glyphs: ${missing.join("")}`);
  writeFileSync(join(assets, "fonts/noto-sans-sc.otf"), font);
  writeFileSync(join(assets, "fonts/noto-sans-sc-metrics.json"), JSON.stringify(metrics) + "\n");
  writeFileSync(join(assets, "licenses/NotoSansSC-OFL.txt"), license);
  writeFileSync(join(assets, "licenses/font-sources.json"), JSON.stringify({ revision, license: "SIL Open Font License 1.1",
    font: { file: "fonts/noto-sans-sc.otf", source: source + fontPath, sha256: fontHash },
    notice: { file: "licenses/NotoSansSC-OFL.txt", source: source + "LICENSE", sha256: licenseHash } }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareFonts(resolve(import.meta.dirname, "../modules/ember-arena/game/assets"),
    resolve(import.meta.dirname, "../../../dist/asset-downloads/ember-arena"));
}
