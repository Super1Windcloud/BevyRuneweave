import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tag = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) ?? "0.0.1";
const upload = !process.argv.includes("--no-upload");
const language = process.argv.find((arg) => arg.startsWith("--language="))?.slice(11) ?? "all";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const output = join(root, "dist", "releases", tag);
const projects = [
  ["js", "script-squadron-js"],
  ["ts", "script-squadron-typescript"],
  ["lua", "script-squadron-lua"],
  ["luau", "script-squadron-luau"],
] as const;

function api(path: string, init: RequestInit = {}) {
  if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required; put it in .env");
  return fetch(`https://api.github.com/repos/Super1windcloud/BevyRuneweave${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
}

async function main() {
  mkdirSync(output, { recursive: true });
  const archives: string[] = [];
  for (const [directory, packageName] of projects.filter(([directory]) => language === "all" || directory === language || (language === "typescript" && directory === "ts"))) {
    const assets = join(root, "projects", directory, "assets");
    const archive = join(output, `${packageName}.zip`);
    if (!existsSync(assets)) throw new Error(`Missing assets directory: ${assets}`);
    rmSync(archive, { force: true });
    execFileSync("powershell", ["-NoProfile", "-Command", "Compress-Archive", "-Path", `${assets}\\*`, "-DestinationPath", archive, "-CompressionLevel", "Optimal", "-Force"], { stdio: "inherit" });
    archives.push(archive);
    console.log(`Created ${archive}`);
  }
  if (!upload) return;
  const releaseResponse = await api(`/releases/tags/${tag}`);
  if (!releaseResponse.ok) throw new Error(`Release lookup failed: ${releaseResponse.status} ${await releaseResponse.text()}`);
  const release = await releaseResponse.json() as { upload_url: string; assets: { id: number; name: string }[] };
  for (const archive of archives) {
    const name = archive.split(/[\\/]/).pop()!;
    for (const asset of release.assets.filter((item) => item.name === name)) {
      const deleted = await api(`/releases/assets/${asset.id}`, { method: "DELETE" });
      if (!deleted.ok) throw new Error(`Could not replace ${name}: ${deleted.status}`);
    }
    const uploadUrl = release.upload_url.replace(/\{.*$/, "") + `?name=${encodeURIComponent(name)}`;
    const body = readFileSync(archive);
    const uploaded = await fetch(uploadUrl, { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/zip" }, body });
    if (!uploaded.ok) throw new Error(`Upload failed for ${name}: ${uploaded.status} ${await uploaded.text()}`);
    console.log(`Uploaded ${name}`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
