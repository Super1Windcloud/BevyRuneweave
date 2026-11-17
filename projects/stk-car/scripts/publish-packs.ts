import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { sha256 } from "./resource-packs.ts";

const output = resolve(import.meta.dirname, "../../../dist/stk-car");
const publication = JSON.parse(readFileSync(join(output, "packs/publication.json"), "utf8")) as { tag: string; files: { name: string; path: string; sha256: string; bytes: number }[] };
if (existsSync(join(output, "source-packs/publication.json"))) publication.files.push(...JSON.parse(readFileSync(join(output, "source-packs/publication.json"), "utf8")).files);
if (existsSync(join(output, "stk-car.zip"))) { const path = join(output, "stk-car.zip"), data = readFileSync(path), hash = sha256(data); publication.files.push({ name: `stk-car-${hash}.zip`, path, sha256: hash, bytes: data.length }); }
// Verify every artifact before the first remote mutation.
for (const file of publication.files) { const data = readFileSync(file.path); if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new Error(`Artifact changed: ${file.name}`); }
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
const api = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/Super1Windcloud/BevyRuneweave${path}`, { ...init, headers: { ...headers, ...init.headers } });
let response = await api(`/releases/tags/${encodeURIComponent(publication.tag)}`);
if (response.status === 404) response = await api("/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_name: publication.tag, name: "STK versioned content packs", prerelease: true, body: "Immutable STK runtime packs and production source archives. Runtime pack support is required. Source archives are for asset preparation and are not downloaded by the game." }) });
if (!response.ok) throw new Error(`Release lookup/create failed: HTTP ${response.status}`);
const release = await response.json() as { id: number; upload_url: string; html_url: string };
const existing: { name: string; state: string; size: number; label: string | null; digest?: string }[] = [];
for (let page = 1; ; page++) { const response = await api(`/releases/${release.id}/assets?per_page=100&page=${page}`); if (!response.ok) throw new Error(`Asset lookup: HTTP ${response.status}`); const batch = await response.json(); existing.push(...batch); if (batch.length < 100) break; }
for (const file of publication.files) {
  const found = existing.find((asset) => asset.name === file.name);
  if (found) { if (found.state !== "uploaded" || found.size !== file.bytes || found.label !== `sha256:${file.sha256}` || found.digest && found.digest !== `sha256:${file.sha256}`) throw new Error(`Existing immutable asset conflicts: ${file.name}`); console.log(`Verified existing ${file.name}`); continue; }
  const url = new URL(release.upload_url.replace(/\{.*$/, "")); url.searchParams.set("name", file.name); url.searchParams.set("label", `sha256:${file.sha256}`);
  const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/zip" }, body: readFileSync(file.path) });
  if (!response.ok) throw new Error(`Upload failed: ${file.name}: HTTP ${response.status}`);
  const asset = await response.json() as { size: number; digest?: string };
  if (asset.size !== file.bytes || asset.digest && asset.digest !== `sha256:${file.sha256}`) throw new Error(`Upload verification failed: ${file.name}`);
  console.log(`Published ${file.name} (${(file.bytes / 1048576).toFixed(2)} MiB)`);
}
writeFileSync(join(output, "published-packs.json"), `${JSON.stringify({ release: release.html_url, files: publication.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }, null, 2)}\n`);
console.log(`Published and verified ${publication.files.length} artifacts: ${release.html_url}`);
