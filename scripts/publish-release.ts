import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { build, transform } from "esbuild";

const require = createRequire(import.meta.url);
const luamin = require("luamin") as { minify(source: string): string };
const { obfuscate } = require("javascript-obfuscator") as typeof import("javascript-obfuscator");

const root = resolve(import.meta.dirname, "..");
const tag = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) ?? "0.0.1";
const upload = !process.argv.includes("--no-upload");
const language = process.argv.find((arg) => arg.startsWith("--language="))?.slice(11) ?? "all";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const output = join(root, "dist", "releases", tag);

type ProjectLanguage = "js" | "ts" | "lua";

interface CargoMetadata {
  packages: { manifest_path: string; name: string }[];
}

interface ModuleConfig {
  schemaVersion: number;
  language: ProjectLanguage;
  sourceDirectory: string;
  assetDirectory: string;
  scriptEntry: string;
}

interface ReleaseProject {
  directory: string;
  packageName: string;
  language: ProjectLanguage;
  assets: string;
  sourceEntry?: string;
  scriptEntry: string;
}

function safeRelativePath(path: string) {
  return path.length > 0 && !path.startsWith("/") && !path.startsWith("\\") &&
    path.split(/[\\/]/).every((part) => part.length > 0 && part !== "." && part !== "..");
}

function discoverProjects(): ReleaseProject[] {
  const projectsRoot = join(root, "projects");
  const metadata = JSON.parse(execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps"],
    { cwd: root, encoding: "utf8" },
  )) as CargoMetadata;
  const packageByDirectory = new Map(
    metadata.packages.map((cargoPackage) => [resolve(dirname(cargoPackage.manifest_path)), cargoPackage.name]),
  );

  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const projectRoot = join(projectsRoot, entry.name);
      const packageName = packageByDirectory.get(resolve(projectRoot));
      if (!packageName) throw new Error(`Project is not a Cargo workspace package: ${projectRoot}`);

      const modulesRoot = join(projectRoot, "modules");
      if (!existsSync(modulesRoot)) throw new Error(`Project has no modules directory: ${projectRoot}`);
      const moduleFiles = readdirSync(modulesRoot, { withFileTypes: true })
        .filter((module) => module.isDirectory() && existsSync(join(modulesRoot, module.name, "module.json")))
        .map((module) => join(modulesRoot, module.name, "module.json"));
      if (moduleFiles.length !== 1) {
        throw new Error(`Project must contain exactly one publishable module.json: ${projectRoot}`);
      }

      const moduleFile = moduleFiles[0]!;
      const moduleRoot = dirname(moduleFile);
      const config = JSON.parse(readFileSync(moduleFile, "utf8")) as ModuleConfig;
      if (config.schemaVersion !== 1 || !["js", "ts", "lua"].includes(config.language)) {
        throw new Error(`Unsupported module configuration: ${moduleFile}`);
      }
      for (const [field, value] of [
        ["sourceDirectory", config.sourceDirectory],
        ["assetDirectory", config.assetDirectory],
        ["scriptEntry", config.scriptEntry],
      ] as const) {
        if (!safeRelativePath(value)) throw new Error(`${field} must be a safe relative path: ${moduleFile}`);
      }

      const assets = join(moduleRoot, config.assetDirectory);
      if (!existsSync(assets)) throw new Error(`Missing assets directory: ${assets}`);
      const expectedExtension = config.language === "lua" ? ".lua" : ".js";
      if (extname(config.scriptEntry) !== expectedExtension) {
        throw new Error(`scriptEntry does not match module language in ${moduleFile}`);
      }
      const sourceEntry = config.language === "ts"
        ? join(moduleRoot, config.sourceDirectory, config.scriptEntry.slice(0, -expectedExtension.length) + ".ts")
        : undefined;
      if (sourceEntry && !existsSync(sourceEntry)) throw new Error(`Missing TypeScript entry: ${sourceEntry}`);

      return {
        directory: entry.name,
        packageName,
        language: config.language,
        assets,
        sourceEntry,
        scriptEntry: config.scriptEntry,
      };
    });
}

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

async function prepareAssets(project: ReleaseProject, destination: string) {
  cpSync(project.assets, destination, { recursive: true });
  const script = join(destination, project.scriptEntry);
  if (project.language === "ts") {
    await build({
      entryPoints: [project.sourceEntry!],
      outfile: script,
      bundle: true,
      format: "iife",
      target: "es2023",
    });
  }
  if (!existsSync(script)) return;
  const sourceCode = readFileSync(script, "utf8");
  if (project.language === "lua") {
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
  // Keep release obfuscation parse-time only so gameplay callbacks gain no per-frame overhead.
  const obfuscated = obfuscate(result.code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    identifierNamesGenerator: "hexadecimal",
    numbersToExpressions: false,
    renameGlobals: true,
    renameProperties: false,
    seed: tag,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: false,
    target: "browser-no-eval",
    transformObjectKeys: false,
    unicodeEscapeSequence: true,
  });
  writeFileSync(script, `${obfuscated.getObfuscatedCode()}\n`, "utf8");
}

function compressLua(source: string) {
  return `${luamin.minify(source)}\n`;
}

async function main() {
  mkdirSync(output, { recursive: true });
  const archives: string[] = [];
  const projects = discoverProjects();
  const selectedProjects = projects.filter((project) =>
    language === "all" || project.language === language ||
    (language === "typescript" && project.language === "ts"),
  );
  if (selectedProjects.length === 0) throw new Error(`No projects match language: ${language}`);
  for (const project of selectedProjects) {
    const archive = join(output, `${project.packageName}.zip`);
    const staging = join(output, `.staging-${project.directory}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    await prepareAssets(project, staging);
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
