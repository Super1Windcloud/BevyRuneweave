import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { prepareUiAssets } from "./prepare-ui-assets.js";
import { spdUiRevision } from "../modules/ember-arena/game/src/spd-ui-atlas.js";
import { gearDefinitions } from "../modules/ember-arena/game/src/equipment.js";
import { spiritBowImage } from "../modules/ember-arena/game/src/spirit-bow.js";
import { cloakImage } from "../modules/ember-arena/game/src/cloak.js";

const root = resolve(import.meta.dirname, "../../..");
const assets = resolve(import.meta.dirname, "../modules/ember-arena/game/assets");
const cache = join(root, "dist/asset-downloads/ember-arena");
const modelsDir = join(assets, "models");
const licensesDir = join(assets, "licenses");
const spdAssetsDir = join(assets, "sprites/spd");

mkdirSync(cache, { recursive: true });
mkdirSync(modelsDir, { recursive: true });
mkdirSync(licensesDir, { recursive: true });
mkdirSync(spdAssetsDir, { recursive: true });

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

const align = (b: Buffer): Buffer => {
  const pad = (4 - (b.length % 4)) % 4;
  return pad > 0 ? Buffer.concat([b, Buffer.alloc(pad)]) : b;
};

// Builds a double-sided pixel-art billboard standee tilted to match the camera angle,
// with an embedded "Walking_A" bobbing animation clip for live playback in Bevy.
function buildStandeeGlb(
  pngBuffer: Buffer,
  [u0, v0, u1, v1]: [number, number, number, number],
  width: number,
  height: number,
): Buffer {
  const w = width / 2;
  const h = height;
  // Camera is orthographic at (0, 18, 16) looking at (0, 0, 0).
  // Pitch angle from vertical is ~41.63 deg.
  const uy = 0.66436, uz = -0.74741;
  const ny = 0.74741, nz = 0.66436;

  const positions = new Float32Array([
    -w, 0, 0,
    w, 0, 0,
    w, h * uy, h * uz,
    -w, h * uy, h * uz,
  ]);
  const normals = new Float32Array([
    0, ny, nz,
    0, ny, nz,
    0, ny, nz,
    0, ny, nz,
  ]);
  const uvs = new Float32Array([
    u0, v1,
    u1, v1,
    u1, v0,
    u0, v0,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
  ]);

  const animTimes = new Float32Array([0.0, 0.2, 0.4]);
  const animTrans = new Float32Array([
    0, 0, 0,
    0, 0.08, 0,
    0, 0, 0,
  ]);

  const bPos = align(Buffer.from(positions.buffer));
  const bNorm = align(Buffer.from(normals.buffer));
  const bUv = align(Buffer.from(uvs.buffer));
  const bIdx = align(Buffer.from(indices.buffer));
  const bTime = align(Buffer.from(animTimes.buffer));
  const bTrans = align(Buffer.from(animTrans.buffer));
  const bPng = align(pngBuffer);

  let offset = 0;
  const bvOffsets: { offset: number; length: number }[] = [];
  const addBv = (b: Buffer): void => {
    bvOffsets.push({ offset, length: b.length });
    offset += b.length;
  };
  addBv(bPos);
  addBv(bNorm);
  addBv(bUv);
  addBv(bIdx);
  addBv(bTime);
  addBv(bTrans);
  addBv(bPng);

  const bin = Buffer.concat([bPos, bNorm, bUv, bIdx, bTime, bTrans, bPng]);

  const doc = {
    asset: { version: "2.0", generator: "Shattered Pixel Dungeon GLB Standee" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Root" }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: "spd_sprite_material",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      alphaMode: "MASK",
      alphaCutoff: 0.5,
      doubleSided: true,
    }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 6, mimeType: "image/png" }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }], // NEAREST for razor-sharp pixel art
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: bvOffsets[0]!.offset, byteLength: bvOffsets[0]!.length },
      { buffer: 0, byteOffset: bvOffsets[1]!.offset, byteLength: bvOffsets[1]!.length },
      { buffer: 0, byteOffset: bvOffsets[2]!.offset, byteLength: bvOffsets[2]!.length },
      { buffer: 0, byteOffset: bvOffsets[3]!.offset, byteLength: bvOffsets[3]!.length },
      { buffer: 0, byteOffset: bvOffsets[4]!.offset, byteLength: bvOffsets[4]!.length },
      { buffer: 0, byteOffset: bvOffsets[5]!.offset, byteLength: bvOffsets[5]!.length },
      { buffer: 0, byteOffset: bvOffsets[6]!.offset, byteLength: bvOffsets[6]!.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-w, 0, h * uz], max: [w, h * uy, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 3, type: "SCALAR", min: [0.0], max: [0.4] },
      { bufferView: 5, componentType: 5126, count: 3, type: "VEC3" },
    ],
    animations: [{
      name: "Walking_A",
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }],
    }],
  };

  return glb(doc, bin);
}

// Builds a textured 3D cuboid with UV mapping to an embedded PNG texture.
function buildTexturedBoxGlb(
  pngBuffer: Buffer,
  size: [number, number, number],
  [u0, v0, u1, v1]: [number, number, number, number],
  emissive = false,
  repeatU = 1,
  repeatV = 1,
): Buffer {
  const [sx, sy, sz] = size;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const faces = [
    // Front (+Z)
    { norm: [0, 0, 1], pos: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], uv: [u0, v1, u1, v1, u1, v0, u0, v0] },
    // Back (-Z)
    { norm: [0, 0, -1], pos: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], uv: [u0, v1, u1, v1, u1, v0, u0, v0] },
    // Top (+Y)
    { norm: [0, 1, 0], pos: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], uv: [u0, v0 + (v1 - v0) * repeatV, u0 + (u1 - u0) * repeatU, v0 + (v1 - v0) * repeatV, u0 + (u1 - u0) * repeatU, v0, u0, v0] },
    // Bottom (-Y)
    { norm: [0, -1, 0], pos: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], uv: [u0, v1, u1, v1, u1, v0, u0, v0] },
    // Right (+X)
    { norm: [1, 0, 0], pos: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], uv: [u0, v1, u1, v1, u1, v0, u0, v0] },
    // Left (-X)
    { norm: [-1, 0, 0], pos: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, -hy, -hz]], uv: [u0, v1, u1, v1, u1, v0, u0, v0] },
  ];

  for (const face of faces) {
    const offset = positions.length / 3;
    for (const p of face.pos) positions.push(...p);
    for (let i = 0; i < 4; i++) normals.push(...face.norm);
    uvs.push(...face.uv);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }

  const bPos = align(Buffer.from(new Float32Array(positions).buffer));
  const bNorm = align(Buffer.from(new Float32Array(normals).buffer));
  const bUv = align(Buffer.from(new Float32Array(uvs).buffer));
  const bIdx = align(Buffer.from(new Uint16Array(indices).buffer));
  const bPng = align(pngBuffer);

  let offset = 0;
  const bv: { offset: number; length: number }[] = [];
  const add = (b: Buffer): void => {
    bv.push({ offset, length: b.length });
    offset += b.length;
  };
  add(bPos); add(bNorm); add(bUv); add(bIdx); add(bPng);
  const bin = Buffer.concat([bPos, bNorm, bUv, bIdx, bPng]);

  const doc = {
    asset: { version: "2.0", generator: "Shattered Pixel Dungeon Textured Box" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: "spd_box_material",
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      ...(emissive ? { emissiveTexture: { index: 0 } } : {}),
      doubleSided: true,
    }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 4, mimeType: "image/png" }],
    samplers: [{
      wrapS: 10497, // REPEAT
      wrapT: 10497,
      magFilter: 9728, // NEAREST
      minFilter: 9728,
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: bv[0]!.offset, byteLength: bv[0]!.length },
      { buffer: 0, byteOffset: bv[1]!.offset, byteLength: bv[1]!.length },
      { buffer: 0, byteOffset: bv[2]!.offset, byteLength: bv[2]!.length },
      { buffer: 0, byteOffset: bv[3]!.offset, byteLength: bv[3]!.length },
      { buffer: 0, byteOffset: bv[4]!.offset, byteLength: bv[4]!.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-hx, -hy, -hz], max: [hx, hy, hz] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 24, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 36, type: "SCALAR" },
    ],
  };

  return glb(doc, bin);
}

// Use the same immutable source revision as the UI and application icon.
const spdFiles: Record<string, string> = {
  // Heroes
  "warrior.png": "sprites/warrior.png",
  "mage.png": "sprites/mage.png",
  "rogue.png": "sprites/rogue.png",
  "huntress.png": "sprites/huntress.png",
  "avatars.png": "sprites/avatars.png",
  "hero_icons.png": "interfaces/hero_icons.png",

  // Mobs
  "rat.png": "sprites/rat.png",
  "gnoll.png": "sprites/gnoll.png",
  "crab.png": "sprites/crab.png",
  "swarm.png": "sprites/swarm.png",
  "slime.png": "sprites/slime.png",
  "goo.png": "sprites/goo.png",
  "skeleton.png": "sprites/skeleton.png",
  "thief.png": "sprites/thief.png",

  // Items & environment
  "amulet.png": "sprites/amulet.png",
  "items.png": "sprites/items.png",
  "item_icons.png": "sprites/item_icons.png",
  "tiles_sewers.png": "environment/tiles_sewers.png",
  "terrain_features.png": "environment/terrain_features.png",
  "water0.png": "environment/water0.png",

  // UI
  "banners.png": "interfaces/banners.png",
  "badges.png": "interfaces/badges.png",
  "boss_hp.png": "interfaces/boss_hp.png",
  "buffs.png": "interfaces/buffs.png",
  "icons.png": "interfaces/icons.png",
  "status_pane.png": "interfaces/status_pane.png",
  "toolbar.png": "interfaces/toolbar.png",
  "menu_pane.png": "interfaces/menu_pane.png",

  // Splashes
  "sewers.jpg": "splashes/sewers.jpg",
  "warrior.jpg": "splashes/warrior.jpg",
  "mage.jpg": "splashes/mage.jpg",
  "rogue.jpg": "splashes/rogue.jpg",
  "huntress.jpg": "splashes/huntress.jpg",
};

const spdBase = `https://raw.githubusercontent.com/00-Evan/shattered-pixel-dungeon/${spdUiRevision}/core/src/main/assets`;
const sourceRecords: { file: string; source: string; sha256: string }[] = [];
const existingManifest = join(licensesDir, "sources.json");
const previous = existsSync(existingManifest) ? JSON.parse(readFileSync(existingManifest, "utf8")) as {
  revision?: string; sourceRecords?: { source: string; sha256: string }[];
} : null;
for (const [localName, remotePath] of Object.entries(spdFiles)) {
  const cached = join(cache, `spd-${spdUiRevision}-${localName}`);
  if (!existsSync(cached)) {
    const res = await fetch(`${spdBase}/${remotePath}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`SPD asset download failed: ${remotePath} (${res.status})`);
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  const bytes = readFileSync(cached);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected = previous?.revision === spdUiRevision ? previous.sourceRecords?.find((record) => record.source === `${spdBase}/${remotePath}`) : undefined;
  if (expected && expected.sha256 !== sha256) throw new Error(`SPD source checksum mismatch: ${localName}`);
  writeFileSync(join(spdAssetsDir, localName), bytes);
  sourceRecords.push({ file: `sprites/spd/${localName}`, source: `${spdBase}/${remotePath}`, sha256 });
}

// Read needed image buffers
const sewersPng = readFileSync(join(spdAssetsDir, "tiles_sewers.png"));
const terrainPng = readFileSync(join(spdAssetsDir, "terrain_features.png"));
const amuletPng = readFileSync(join(spdAssetsDir, "amulet.png"));
const warriorPng = readFileSync(join(spdAssetsDir, "warrior.png"));
const magePng = readFileSync(join(spdAssetsDir, "mage.png"));
const roguePng = readFileSync(join(spdAssetsDir, "rogue.png"));
const huntressPng = readFileSync(join(spdAssetsDir, "huntress.png"));
const ratPng = readFileSync(join(spdAssetsDir, "rat.png"));
const gnollPng = readFileSync(join(spdAssetsDir, "gnoll.png"));
const crabPng = readFileSync(join(spdAssetsDir, "crab.png"));
const gooPng = readFileSync(join(spdAssetsDir, "goo.png"));

// ---------------------------------------------------------------------------
// Extract Authentic Hero Avatars (32x32 PNG) from avatars.png for UI
// ---------------------------------------------------------------------------
function decodePngRgba(buf: Buffer): { w: number; h: number; pixels: Buffer } {
  let pos = 8;
  const idatChunks: Buffer[] = [];
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf[25];
  const bitDepth = buf[24]!;
  if (!((colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) || (colorType === 6 && bitDepth === 8)) || buf[28] !== 0) {
    throw new Error("Expected non-interlaced indexed/RGBA PNG");
  }
  let palette: Buffer = Buffer.alloc(0), alpha: Buffer = Buffer.alloc(0);
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    if (type === "PLTE") palette = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "tRNS") alpha = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
  }
  const decompressed = inflateSync(Buffer.concat(idatChunks));
  const channels = colorType === 3 ? 1 : 4;
  const rowBytes = colorType === 3 ? Math.ceil(w * bitDepth / 8) : w * channels;
  const stride = rowBytes + 1;
  const decoded = Buffer.alloc(rowBytes * h);
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = decompressed[y * stride]!;
    const rowSrc = decompressed.subarray(y * stride + 1, (y + 1) * stride);
    const rowDst = decoded.subarray(y * rowBytes, (y + 1) * rowBytes);
    if (filter === 0) rowSrc.copy(rowDst);
    else if (filter === 1) {
      for (let x = 0; x < rowBytes; x++) {
        const left = x >= channels ? rowDst[x - channels]! : 0;
        rowDst[x] = (rowSrc[x]! + left) & 0xff;
      }
    } else if (filter === 2) {
      const prev = y > 0 ? decoded.subarray((y - 1) * rowBytes, y * rowBytes) : null;
      for (let x = 0; x < rowBytes; x++) {
        const up = prev ? prev[x]! : 0;
        rowDst[x] = (rowSrc[x]! + up) & 0xff;
      }
    } else if (filter === 3 || filter === 4) {
      const prev = y > 0 ? decoded.subarray((y - 1) * rowBytes, y * rowBytes) : null;
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= channels ? rowDst[x - channels]! : 0;
        const b = prev ? prev[x]! : 0;
        const c = (x >= channels && prev) ? prev[x - channels]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predictor = filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        rowDst[x] = (rowSrc[x]! + predictor) & 0xff;
      }
    } else throw new Error(`Unsupported PNG filter ${filter}`);
  }
  if (colorType === 6) decoded.copy(pixels);
  else for (let index = 0; index < w * h; index++) {
    const x = index % w, y = Math.floor(index / w);
    const entry = (decoded[y * rowBytes + Math.floor(x * bitDepth / 8)]! >>> (8 - bitDepth - (x * bitDepth % 8))) & ((1 << bitDepth) - 1);
    for (let channel = 0; channel < 3; channel++) pixels[index * 4 + channel] = palette[entry * 3 + channel]!;
    pixels[index * 4 + 3] = alpha[entry] ?? 255;
  }
  return { w, h, pixels };
}

function encodePngRgba(w: number, h: number, rgba: Buffer): Buffer {
  const rowLen = 1 + w * 4;
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0;
    rgba.copy(raw, y * rowLen + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idatData = deflateSync(raw);

  const crc32 = (type: string, data: Buffer): number => {
    let crc = 0xffffffff;
    const buf = Buffer.concat([Buffer.from(type), data]);
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i]!;
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, "ascii");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(type, data), 8 + data.length);
    return chunk;
  };

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const avatarsBuf = readFileSync(join(spdAssetsDir, "avatars.png"));
const avatarsDecoded = decodePngRgba(avatarsBuf);
const sliceAvatar = (x0: number): Buffer => {
  const dst = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const srcIdx = (y * avatarsDecoded.w + (x0 + x)) * 4;
      const dstIdx = (y * 32 + x) * 4;
      avatarsDecoded.pixels.copy(dst, dstIdx, srcIdx, srcIdx + 4);
    }
  }
  return encodePngRgba(32, 32, dst);
};

writeFileSync(join(spdAssetsDir, "avatar_warrior.png"), sliceAvatar(0));
writeFileSync(join(spdAssetsDir, "avatar_mage.png"), sliceAvatar(64));
writeFileSync(join(spdAssetsDir, "avatar_rogue.png"), sliceAvatar(128));
writeFileSync(join(spdAssetsDir, "avatar_huntress.png"), sliceAvatar(192));

// Native 2D sprites, cropped using upstream TextureFilm frame sizes and
// DungeonTileSheet indices. No sprite-sheet stretching or invented art.
const dungeonSpritesDir = join(assets, "sprites/dungeon");
mkdirSync(dungeonSpritesDir, { recursive: true });
const spriteRecords: { file: string; source: string; sha256: string }[] = [];
function cropSprite(name: string, source: string, x: number, y: number, width: number, height: number): void {
  const png = decodePngRgba(readFileSync(join(spdAssetsDir, source)));
  if (x + width > png.w || y + height > png.h) throw new Error(`Invalid crop: ${name}`);
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    png.pixels.copy(pixels, row * width * 4, ((y + row) * png.w + x) * 4, ((y + row) * png.w + x + width) * 4);
  }
  const bytes = encodePngRgba(width, height, pixels);
  writeFileSync(join(dungeonSpritesDir, `${name}.png`), bytes);
  spriteRecords.push({ file: `sprites/dungeon/${name}.png`, source: `${spdBase}/${spdFiles[source]}`, sha256: createHash("sha256").update(bytes).digest("hex") });
}
for (const hero of ["warrior", "mage", "rogue", "huntress"]) cropSprite(hero, `${hero}.png`, 0, 0, 12, 15);
cropSprite("rat", "rat.png", 0, 0, 16, 15);
cropSprite("gnoll", "gnoll.png", 0, 0, 12, 15);
cropSprite("crab", "crab.png", 0, 0, 16, 16);
cropSprite("goo", "goo.png", 0, 0, 20, 14);
for (const [name, index] of Object.entries({ floor: 0, entrance: 16, exit: 17, water: 32, wall: 48, door: 56, open_door: 57 })) {
  cropSprite(name, "tiles_sewers.png", (index % 16) * 16, Math.floor(index / 16) * 16, 16, 16);
}
// Fixed, identified appearances for the current seven-item subset. Upstream
// random potion/scroll identification is tracked separately in PARITY.md.
for (const [name, index] of Object.entries({ gold: 18, food_ration: 437, worn_key: 58, goo_blob: 471, potion_healing: 352, potion_liquid_flame: 353,
  potion_invisibility: 358, potion_strength: 355, scroll_upgrade: 304, scroll_magic_mapping: 305, spirit_bow: spiritBowImage })) {
  cropSprite(name, "items.png", (index % 16) * 16, Math.floor(index / 16) * 16, 16, 16);
}
const obsoleteKey = join(dungeonSpritesDir, "skeleton_key.png");
cropSprite("cloak_of_shadows", "items.png", (cloakImage % 16) * 16, Math.floor(cloakImage / 16) * 16, 9, 15);
if (existsSync(obsoleteKey)) unlinkSync(obsoleteKey);
for (const [name, spec] of Object.entries(gearDefinitions)) {
  cropSprite(name, "items.png", (spec.image % 16) * 16, Math.floor(spec.image / 16) * 16, 16, 16);
}
writeFileSync(join(dungeonSpritesDir, "fog.png"), encodePngRgba(1, 1, Buffer.from([0, 0, 0, 175])));
writeFileSync(join(dungeonSpritesDir, "void.png"), encodePngRgba(1, 1, Buffer.from([7, 7, 6, 255])));
// FlameParticle is procedural: 0xEE7722, initial size 4. This static marker
// exposes hazardous cells; the upstream shrinking particle emitter is pending.
const fireBytes = encodePngRgba(1, 1, Buffer.from([0xee, 0x77, 0x22, 255]));
writeFileSync(join(dungeonSpritesDir, "fire.png"), fireBytes);
spriteRecords.push({ file: "sprites/dungeon/fire.png",
  source: `https://raw.githubusercontent.com/00-Evan/shattered-pixel-dungeon/${spdUiRevision}/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/effects/particles/FlameParticle.java`,
  sha256: createHash("sha256").update(fireBytes).digest("hex") });
await prepareUiAssets(assets, cache, decodePngRgba, encodePngRgba);

// ---------------------------------------------------------------------------
// 1. Generate Textured Room & Obstacle Geometry
// ---------------------------------------------------------------------------
// Floor: repeating mossy sewer floor paving across 18x14
writeFileSync(join(modelsDir, "floor.glb"),
  buildTexturedBoxGlb(sewersPng, [18, 0.3, 14], [0, 5 / 16, 1 / 16, 6 / 16], false, 9, 7));

// Grid Tile: 16x16 sewer stone slab tile
writeFileSync(join(modelsDir, "tile.glb"),
  buildTexturedBoxGlb(sewersPng, [1.9, 0.04, 1.9], [1 / 16, 5 / 16, 2 / 16, 6 / 16]));

// Wall: mossy sewer brick wall
writeFileSync(join(modelsDir, "wall.glb"),
  buildTexturedBoxGlb(sewersPng, [1.9, 0.65, 0.35], [0, 1 / 16, 1 / 16, 2 / 16]));

// Pillar: ancient carved sewer stone column
writeFileSync(join(modelsDir, "pillar.glb"),
  buildTexturedBoxGlb(sewersPng, [1.1, 1.5, 1.1], [2 / 16, 0, 3 / 16, 1 / 16]));

// Beacon: dungeon torch brazier with flame
writeFileSync(join(modelsDir, "beacon.glb"),
  buildTexturedBoxGlb(terrainPng, [0.30, 1.2, 0.30], [0, 0, 1 / 16, 1 / 16], true));

// Crystal: the golden Amulet of Yendor standee
writeFileSync(join(modelsDir, "crystal.glb"),
  buildStandeeGlb(amuletPng, [0, 0, 1, 1], 0.75, 0.75));

// Ember: flying fiery magic missile projectile
writeFileSync(join(modelsDir, "ember.glb"),
  buildStandeeGlb(terrainPng, [0, 0, 1 / 16, 1 / 16], 0.5, 0.5));

// Hostile: caustic ooze slime projectile
writeFileSync(join(modelsDir, "hostile.glb"),
  buildStandeeGlb(gooPng, [0, 0, 1 / 16, 1], 0.5, 0.5));

// ---------------------------------------------------------------------------
// 2. Generate Authentic Shattered Pixel Dungeon Heroes
// ---------------------------------------------------------------------------
// Each hero has an embedded "Walking_A" clip and crisp pixel art with alpha mask
const records: { file: string; source: string; sha256: string; animation: string }[] = [];

const heroes = [
  { name: "Knight", file: "Knight.glb", png: warriorPng, uv: [0, 0, 16 / 256, 32 / 128] as [number, number, number, number], src: "sprites/warrior.png" },
  { name: "Mage", file: "Mage.glb", png: magePng, uv: [0, 0, 16 / 256, 32 / 128] as [number, number, number, number], src: "sprites/mage.png" },
  { name: "Rogue_Hooded", file: "Rogue_Hooded.glb", png: roguePng, uv: [0, 0, 16 / 256, 32 / 128] as [number, number, number, number], src: "sprites/rogue.png" },
  { name: "Barbarian", file: "Barbarian.glb", png: huntressPng, uv: [0, 0, 16 / 256, 32 / 128] as [number, number, number, number], src: "sprites/huntress.png" },
];

for (const hero of heroes) {
  const bytes = buildStandeeGlb(hero.png, hero.uv, 1.25, 1.45);
  writeFileSync(join(modelsDir, hero.file), bytes);
  records.push({
    file: `models/${hero.file}`,
    source: `${spdBase}/${hero.src}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    animation: "Walking_A",
  });
}

// Also write SPD-named hero models for direct usage
writeFileSync(join(modelsDir, "spd_warrior.glb"), readFileSync(join(modelsDir, "Knight.glb")));
writeFileSync(join(modelsDir, "spd_mage.glb"), readFileSync(join(modelsDir, "Mage.glb")));
writeFileSync(join(modelsDir, "spd_rogue.glb"), readFileSync(join(modelsDir, "Rogue_Hooded.glb")));
writeFileSync(join(modelsDir, "spd_huntress.glb"), readFileSync(join(modelsDir, "Barbarian.glb")));

// ---------------------------------------------------------------------------
// 3. Generate Authentic Shattered Pixel Dungeon Mobs
// ---------------------------------------------------------------------------
// Marsupial Rat (Depth 1 Chaser)
writeFileSync(join(modelsDir, "spd_rat.glb"),
  buildStandeeGlb(ratPng, [0, 0, 16 / 256, 16 / 64], 1.2, 0.95));

// Gnoll Scout (Depth 2 Ranger)
writeFileSync(join(modelsDir, "spd_gnoll.glb"),
  buildStandeeGlb(gnollPng, [0, 0, 16 / 256, 16 / 64], 1.2, 1.2));

// Sewer Crab (Depth 3 Charger)
writeFileSync(join(modelsDir, "spd_crab.glb"),
  buildStandeeGlb(crabPng, [0, 0, 16 / 256, 16 / 64], 1.3, 1.1));

// Goo Boss (Depth 5 Sewer Boss)
writeFileSync(join(modelsDir, "spd_goo.glb"),
  buildStandeeGlb(gooPng, [0, 0, 16 / 256, 1], 2.2, 1.8));

// License manifest
const manifest = {
  author: "Evan Debenham (00-Evan) & Watabou",
  license: "GPL-3.0 & CC-BY-NC-SA-4.0",
  source: "https://github.com/00-Evan/shattered-pixel-dungeon",
  revision: spdUiRevision,
  sourceRecords,
  records,
  spriteRecords,
};
const manifestPath = join(licensesDir, "sources.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Successfully generated all authentic Shattered Pixel Dungeon models:
- Sewer Room: floor.glb, tile.glb, wall.glb, pillar.glb, beacon.glb
- Heroes: Knight.glb (Warrior), Mage.glb (Mage), Rogue_Hooded.glb (Rogue), Barbarian.glb (Huntress)
- Mobs: spd_rat.glb (Rat), spd_gnoll.glb (Gnoll), spd_crab.glb (Crab), spd_goo.glb (Goo)
- Pickups & VFX: crystal.glb (Amulet of Yendor), ember.glb (Fire Bolt), hostile.glb (Caustic Ooze)`);
