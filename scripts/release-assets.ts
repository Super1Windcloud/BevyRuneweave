import { createHmac } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

export const gameCatalogName = "game-catalog.json";

/** Keep the public catalog keyed by actual archive names and expose only display fields. */
export function gameCatalog(projects: { packageName: string; assets: string }[]): string {
  type Copy = { appName?: string; description?: string };
  const fields = (source?: Copy): Copy => ({
    appName: typeof source?.appName === "string" ? source.appName.trim() || undefined : undefined,
    description: typeof source?.description === "string" ? source.description.trim() || undefined : undefined,
  });
  const games = Object.fromEntries([...projects].sort((a, b) => a.packageName.localeCompare(b.packageName, "en")).map((project) => {
    const config = JSON.parse(readFileSync(join(project.assets, "engineConfig.json"), "utf8")) as Copy & {
      localizations?: Record<string, Copy>;
    };
    return [`${project.packageName}.zip`, { ...fields(config), localizations: { "zh-CN": fields(config.localizations?.["zh-CN"]) } }];
  }));
  return `${JSON.stringify({ schemaVersion: 1, games }, null, 2)}\n`;
}

/** Optional explicit startup payload; production source assets never enter this ZIP. */
export function startupAssetFiles(assets: string): Set<string> | null {
  const path = join(assets, "startup-manifest.json");
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion: number; files: string[] };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.some((name) => typeof name !== "string" || !name || /[\\:\x00-\x1f]/.test(name) || name.split("/").some((part) => !part || part === "." || part === ".."))) throw new Error("Invalid startup manifest");
  return new Set(manifest.files);
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
  const startup = startupAssetFiles(assets);
  const excluded = new Set(language === "lua" ? [".lua"] : [".js", ".mjs", ".cjs"]);
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${name}/`);
      else if (entry.isFile() && (!startup || startup.has(name)) && !excluded.has(extname(entry.name).toLowerCase())) {
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
