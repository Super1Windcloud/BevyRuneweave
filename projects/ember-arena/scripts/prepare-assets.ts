import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const assets = resolve(import.meta.dirname, "../modules/ember-arena/game/assets");
const cache = join(root, "dist/asset-downloads/ember-arena");
const commit = "672074b73ba276876a19e8816ecdc5241817ab47";
const base = `https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/${commit}`;
mkdirSync(cache, { recursive: true });
mkdirSync(join(assets, "models"), { recursive: true });
mkdirSync(join(assets, "licenses"), { recursive: true });

async function download(path: string, name: string): Promise<Buffer> {
  const cached = join(cache, name);
  if (!existsSync(cached)) {
    const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Asset download failed: ${name} (${response.status})`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(cached);
}

function glb(document: object, binary: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(binary.length / 4) * 4;
  const result = Buffer.alloc(28 + jsonLength + binLength);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(32, 20, 20 + jsonLength);
  json.copy(result, 20);
  result.writeUInt32LE(binLength, 20 + jsonLength);
  result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(result, 28 + jsonLength);
  return result;
}

// The current runtime plays animation 0. Keep one named walking clip, without
// changing the source skeleton, mesh, texture, or animation data.
const records: { file: string; source: string; sha256: string; animation: string }[] = [];
for (const name of ["Mage", "Knight", "Rogue_Hooded", "Barbarian"]) {
  const source = `addons/kaykit_character_pack_adventures/Characters/gltf/${name}.glb`;
  const bytes = await download(source, `${name}.glb`);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`Invalid GLB: ${name}`);
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as {
    animations: { name: string }[];
  };
  const animation = document.animations.find((clip) => clip.name === "Walking_A");
  if (!animation) throw new Error(`Walking_A animation missing: ${name}`);
  document.animations = [animation];
  const binary = bytes.subarray(28 + jsonLength);
  writeFileSync(join(assets, "models", `${name}.glb`), glb(document, binary));
  records.push({ file: `models/${name}.glb`, source: `${base}/${source}`,
    sha256: createHash("sha256").update(bytes).digest("hex"), animation: animation.name });
}
writeFileSync(join(assets, "licenses/KayKit-Adventurers.txt"), await download("LICENSE.txt", "LICENSE.txt"));

// Repository-authored colored geometry for the room, obstacles and projectiles.
// Each model has baked dimensions; scripts only need portable uniform scaling.
function box(name: string, size: [number, number, number], color: number[], emissive = false): void {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces = [
    [[1, 0, 0], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, 0, 0], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    [[0, 0, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]],
    [[0, 0, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
  ];
  for (const face of faces) {
    const offset = positions.length / 3;
    for (const vertex of face.slice(1)) {
      positions.push(...vertex.map((axis, index) => axis * size[index]! / 2));
      normals.push(...face[0]!);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const binary = Buffer.concat([Buffer.from(new Float32Array(positions).buffer),
    Buffer.from(new Float32Array(normals).buffer), Buffer.from(new Uint16Array(indices).buffer)]);
  const document = {
    asset: { version: "2.0", generator: "Ember Arena TypeScript asset preparation" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.9 },
      ...(emissive ? { emissiveFactor: color } : {}) }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 288 }, { buffer: 0, byteOffset: 288, byteLength: 288 },
      { buffer: 0, byteOffset: 576, byteLength: 72 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 24, type: "VEC3",
      min: size.map((axis) => -axis / 2), max: size.map((axis) => axis / 2) },
    { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" }],
  };
  writeFileSync(join(assets, `models/${name}.glb`), glb(document, binary));
}
box("floor", [18, 0.3, 14], [0.045, 0.085, 0.10]);
box("tile", [1.9, 0.04, 1.9], [0.08, 0.14, 0.16]);
box("wall", [1.9, 0.65, 0.35], [0.15, 0.24, 0.26]);
box("pillar", [1.1, 1.5, 1.1], [0.19, 0.31, 0.32]);
box("ember", [0.20, 0.20, 0.45], [1, 0.48, 0.10], true);
box("hostile", [0.30, 0.30, 0.30], [1, 0.13, 0.20], true);
box("crystal", [0.25, 0.45, 0.25], [0.15, 0.95, 0.68], true);
box("beacon", [0.30, 1.2, 0.30], [1, 0.5, 0.12], true);
const manifest = { author: "Kay Lousberg", license: "CC0-1.0", commit, records };
const manifestPath = join(assets, "licenses/sources.json");
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${records.length} downloaded characters and 8 procedural room models.`);
