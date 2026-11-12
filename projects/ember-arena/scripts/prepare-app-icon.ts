import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spdUiRevision } from "../modules/ember-arena/game/src/spd-ui-atlas.js";

const checksum = "00962b4d99401827b24bce91bc76672ee69380d075085f6d5148a085d7badcb5";

export async function prepareAppIcon(assets: string, cache: string): Promise<void> {
  const source = `https://raw.githubusercontent.com/00-Evan/shattered-pixel-dungeon/${spdUiRevision}/desktop/src/main/assets/icons/icon_256.png`;
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(assets, "branding"), { recursive: true });
  mkdirSync(join(assets, "licenses"), { recursive: true });
  const cached = join(cache, `spd-app-icon-${spdUiRevision.slice(0, 8)}.png`);
  if (!existsSync(cached)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Application icon download failed: ${response.status}`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(cached);
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Application icon checksum mismatch");
  const file = "branding/shattered-pixel-dungeon.png";
  writeFileSync(join(assets, file), bytes);
  writeFileSync(join(assets, "licenses/icon-source.json"), JSON.stringify({ revision: spdUiRevision,
    author: "Evan Debenham (00-Evan)", license: "GPL-3.0", file, source, sha256: checksum }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareAppIcon(resolve(import.meta.dirname, "../modules/ember-arena/game/assets"),
    resolve(import.meta.dirname, "../../../dist/asset-downloads/ember-arena"));
}
