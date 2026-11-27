import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { courseModelPaths, mapScenes, sceneFor } from "../modules/stk-car/game/src/courses.ts";

export type { ResourceCatalog, ResourcePack, PackFile } from "../modules/stk-car/game/src/resource-types.ts";
export const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
export function safePath(path: string): boolean {
  return !!path && !/[\\:]/.test(path) && [...path].every((c) => c.charCodeAt(0) >= 32) && path.split("/").every((part) => !!part && part !== "." && part !== "..");
}
export function packFor(path: string): string | null {
  if (path.startsWith("source/")) return "source-local";
  if (path.startsWith("models/karts/")) return `kart-${path.split("/")[2]}`;
  const mapAsset = /^(?:licenses|ui)\/maps\/([^/]+)\//.exec(path)?.[1];
  const scene = mapAsset ? sceneFor(mapAsset) : mapScenes.find((scene) => courseModelPaths(scene).includes(path));
  if (scene) return `track-${scene.id}`;
  if (path.startsWith("audio/music/")) return `music-${path.split("/").at(-1)!.replace(/\.ogg$/, "")}`;
  if (path.startsWith("ui/catalog/")) return `preview-${path.split("/").at(-1)!.replace(/\.[^.]+$/, "")}`;
  return null;
}

/** Deterministic ZIP32, matching the runtime installer: file entries only, relative paths. */
export function zipFiles(files: { path: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [], centralParts: Buffer[] = []; let offset = 0;
  const seen = new Set<string>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!safePath(file.path) || seen.has(file.path)) throw new Error(`Invalid or duplicate ZIP entry: ${file.path}`);
    seen.add(file.path);
    const name = Buffer.from(file.path), data = deflateRawSync(file.data, { level: 9 }), checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name); offset += local.length + name.length + data.length;
  }
  if (files.length >= 65535 || offset >= 0xffffffff) throw new Error("ZIP32 limits exceeded");
  const centralBytes = centralParts.reduce((n, p) => n + p.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBytes, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
export function readPackFiles(root: string, paths: string[]): { path: string; data: Buffer }[] {
  return paths.map((path) => { if (!safePath(path)) throw new Error(`Unsafe path ${path}`); return { path, data: readFileSync(join(root, path)) }; });
}
