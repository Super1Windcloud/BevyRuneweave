import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

export interface ReleaseAsset {
  id: number;
  name: string;
  label: string | null;
  state: string;
}

export interface ReleaseCandidate {
  name: string;
  label: string;
  prepare(): Promise<string>;
}

// Hash the payload before randomized encryption. Keyed hashing also invalidates
// packages when the encryption key changes without publishing a key checksum.
export function releaseAssetLabel(
  assets: string,
  language: "js" | "ts" | "lua",
  scriptEntry: string,
  script: string,
  key: Buffer,
): string {
  const files = new Map<string, Buffer>([[scriptEntry.replaceAll("\\", "/"), Buffer.from(script)]]);
  const excluded = new Set(language === "lua" ? [".lua"] : [".js", ".mjs", ".cjs"]);
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile() && !excluded.has(extname(entry.name).toLowerCase())) {
        files.set(name, readFileSync(path));
      }
    }
  };
  visit(assets, "");
  const hash = createHmac("sha256", key).update("runeweave-release-payload-v1\0");
  for (const [name, contents] of [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    hash.update(JSON.stringify([name, contents.length])).update("\0").update(contents);
  }
  return `runeweave-v1:${hash.digest("hex")}`;
}

export async function listReleaseAssets(
  releaseId: number,
  request: (path: string) => Promise<Response>,
): Promise<ReleaseAsset[]> {
  const assets: ReleaseAsset[] = [];
  for (let page = 1; ; page++) {
    const response = await request(`/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!response.ok) throw new Error(`Release asset lookup failed: ${response.status}`);
    const batch = await response.json() as ReleaseAsset[];
    assets.push(...batch);
    if (batch.length < 100) return assets;
  }
}

export async function syncReleaseAssets(
  candidates: ReleaseCandidate[],
  assets: ReleaseAsset[],
  actions: {
    remove(asset: ReleaseAsset): Promise<void>;
    upload(candidate: ReleaseCandidate, archive: string): Promise<void>;
    log(message: string): void;
  },
): Promise<void> {
  const changed: { candidate: ReleaseCandidate; archive: string; existing: ReleaseAsset[] }[] = [];
  for (const candidate of candidates) {
    const existing = assets.filter((asset) => asset.name === candidate.name);
    if (existing.length === 1 && existing[0]!.state === "uploaded" && existing[0]!.label === candidate.label) {
      actions.log(`Skipped unchanged ${candidate.name}`);
      continue;
    }
    changed.push({ candidate, archive: await candidate.prepare(), existing });
  }
  // Finish packaging before replacing any remote asset.
  for (const { candidate, archive, existing } of changed) {
    for (const asset of existing) await actions.remove(asset);
    await actions.upload(candidate, archive);
    actions.log(`Uploaded ${candidate.name}`);
  }
  actions.log(`Release assets: ${changed.length} uploaded, ${candidates.length - changed.length} unchanged`);
}
