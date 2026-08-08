import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const luamin = require("luamin") as { minify(source: string): string };

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

function createZip(source: string, destination: string) {
  const files: { name: string; data: Buffer }[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({ name: relative(source, path).split(sep).join("/"), data: readFileSync(path) });
    }
  };
  visit(source);
  const localParts: Buffer[] = [], centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8"), compressed = deflateRawSync(file.data, { level: 9 }), checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(destination, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

async function prepareAssets(source: string, destination: string, language: "js" | "ts" | "lua") {
  cpSync(source, destination, { recursive: true });
  const script = join(destination, language === "lua" ? "shooter.lua" : "shooter.js");
  if (!existsSync(script)) return;
  const sourceCode = readFileSync(script, "utf8");
  if (language === "lua") {
    writeFileSync(script, compressLua(sourceCode), "utf8");
    return;
  }
  const result = await transform(sourceCode, {
    loader: "js",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: "none",
    charset: "utf8",
  });
  writeFileSync(script, result.code, "utf8");
}

function compressLua(source: string) {
  return `${luamin.minify(source)}\n`;
}

async function main() {
  mkdirSync(output, { recursive: true });
  const archives: string[] = [];
  const selectedProjects = projects.filter(([directory]) => language === "all" || directory === language || (language === "typescript" && directory === "ts"));
  if (selectedProjects.some(([directory]) => directory === "ts")) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npm, ["--prefix", join(root, "projects", "ts"), "run", "build"], { cwd: root, stdio: "inherit" });
  }
  for (const [directory, packageName] of selectedProjects) {
    const assets = join(root, "projects", directory, "assets");
    const archive = join(output, `${packageName}.zip`);
    if (!existsSync(assets)) throw new Error(`Missing assets directory: ${assets}`);
    const staging = join(output, `.staging-${directory}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    await prepareAssets(assets, staging, directory);
    const replacing = existsSync(archive);
    rmSync(archive, { force: true });
    createZip(staging, archive);
    rmSync(staging, { recursive: true, force: true });
    archives.push(archive);
    console.log(`${replacing ? "Replaced" : "Created"} ${archive}`);
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
