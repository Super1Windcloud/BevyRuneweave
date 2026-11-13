import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { build } from "esbuild";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";

const project = resolve(import.meta.dirname, "..");
const assets = join(project, "modules/stk-car/game/assets");
const required = [trackData.trackModel, trackData.kartModel, ...trackData.wheels.map((wheel) => wheel.path),
  ...trackData.scenery.map((object) => object.path), ...Object.values(trackData.pickupModels),
  "fonts/wqy-microhei.ttf", "branding/tux.png", "licenses/source-manifest.json"];
for (const file of required) if (!existsSync(join(assets, file))) throw new Error(`Missing ${file}; run prepare:assets before packaging`);
await build({ absWorkingDir: project, entryPoints: ["modules/stk-car/game/src/stk-car.ts"], outfile: join(assets, "stk-car.js"), bundle: true, format: "iife", target: "es2023" });

const localParts: Buffer[] = [];
const centralParts: Buffer[] = [];
let offset = 0;
let count = 0;
function visit(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in asset bundle: ${path}`);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const name = Buffer.from(`assets/${relative(assets, path).replaceAll("\\", "/")}`);
    const data = readFileSync(path);
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // Deterministic valid ZIP date: 1980-01-01.
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
    count++;
  }
}
visit(assets);
if (count >= 65535 || offset >= 0xffffffff) throw new Error("Bundle exceeds ZIP32 limits");
const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...localParts, ...centralParts, end]);
const output = resolve(project, "../../dist/stk-car");
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "stk-car.zip"), archive);
writeFileSync(join(output, "stk-car.zip.sha256"), `${createHash("sha256").update(archive).digest("hex")}  stk-car.zip\n`);
console.log(`${join(output, "stk-car.zip")} — ${count} files, ${(archive.length / 1024 ** 2).toFixed(2)} MiB`);
