import { readFileSync } from "node:fs";

/** SPM v1 layout: stk-code/src/graphics/sp_mesh_loader.cpp. Bake its stored straight pose. */
export interface SpmMaterial { texture: string; secondary: string; }
export interface SpmPrimitive {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
  material: number;
}
export interface SpmMesh { materials: SpmMaterial[]; primitives: SpmPrimitive[]; }

export function halfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const fraction = bits & 1023;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : exponent === 31
    ? fraction ? Number.NaN : Number.POSITIVE_INFINITY : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

export function readSpm(data: Buffer): SpmMesh {
  let offset = 0;
  function take(count: number): Buffer {
    if (count < 0 || offset + count > data.length) throw new Error(`Truncated SPM at ${offset}`);
    const value = data.subarray(offset, offset + count);
    offset += count;
    return value;
  }
  const u8 = () => take(1).readUInt8();
  const u16 = () => take(2).readUInt16LE();
  const u32 = () => take(4).readUInt32LE();
  const f32 = () => {
    const value = take(4).readFloatLE();
    if (!Number.isFinite(value)) throw new Error("Non-finite SPM position");
    return value;
  };
  const string = () => take(u8()).toString("utf8");
  if (take(2).toString() !== "SP") throw new Error("Not an SPM file");
  const versionAndType = u8();
  const meshType = versionAndType & 7;
  if (versionAndType >> 3 !== 1 || ![1, 2].includes(meshType)) throw new Error("Unsupported SPM version/type");
  const flags = u8();
  take(24); // Source bounding box; GLB bounds are recomputed after handedness conversion.
  const materials: SpmMaterial[] = [];
  const materialCount = u16();
  for (let i = 0; i < materialCount; i++) materials.push({ texture: string(), secondary: string() });
  const primitives: SpmPrimitive[] = [];
  const sectors = u16();
  for (let sector = 0; sector < sectors; sector++) {
    const buffers = u16();
    for (let index = 0; index < buffers; index++) {
      const vertices = u32();
      const indexCount = u32();
      const material = u16();
      if (!vertices || vertices > 65535 || !indexCount || indexCount % 3 || !materials[material]) throw new Error("Invalid SPM mesh buffer");
      const primitive: SpmPrimitive = { positions: [], normals: [], colors: [], uvs: [], indices: [], material };
      const spec = materials[material];
      for (let vertex = 0; vertex < vertices; vertex++) {
        primitive.positions.push(f32(), f32(), -f32()); // Irrlicht left-handed -> glTF right-handed.
        if (flags & 1) {
          const packed = u32();
          const component = (shift: number) => {
            const value = (packed >>> shift) & 1023;
            return Math.max(-1, (value > 511 ? value - 1024 : value) / 511);
          };
          primitive.normals.push(component(0), component(10), -component(20));
        }
        let color = [255, 255, 255];
        if (flags & 2 && u8() !== 128) color = [u8(), u8(), u8()];
        primitive.colors.push(...color.map((value) => {
          const srgb = value / 255;
          return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        }), 1);
        if (spec.texture) {
          primitive.uvs.push(halfFloat(u16()), halfFloat(u16()));
          if (spec.secondary) take(4);
          if (flags & 4) take(4);
        }
        if (meshType === 1) take(16); // Joint indices/weights; no skeletal animation in the baked output.
      }
      for (let triangle = 0; triangle < indexCount / 3; triangle++) {
        const a = vertices > 255 ? u16() : u8();
        const b = vertices > 255 ? u16() : u8();
        const c = vertices > 255 ? u16() : u8();
        if (Math.max(a, b, c) >= vertices) throw new Error("SPM index outside vertex buffer");
        primitive.indices.push(a, c, b);
      }
      if (!primitive.uvs.every(Number.isFinite)) throw new Error("Non-finite SPM UV");
      if (!primitive.normals.length) {
        primitive.normals = new Array(vertices * 3).fill(0);
        for (let i = 0; i < primitive.indices.length; i += 3) {
          const [a, b, c] = primitive.indices.slice(i, i + 3).map((v) => v * 3);
          const p = primitive.positions;
          const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
          const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
          const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
          for (const v of [a, b, c]) for (let axis = 0; axis < 3; axis++) primitive.normals[v + axis] += normal[axis];
        }
      }
      for (let i = 0; i < primitive.normals.length; i += 3) {
        const length = Math.hypot(...primitive.normals.slice(i, i + 3)) || 1;
        for (let axis = 0; axis < 3; axis++) primitive.normals[i + axis] /= length;
      }
      primitives.push(primitive);
    }
  }
  return { materials, primitives };
}

/** A self-contained GLB with embedded PNG/JPEG textures; no machine-local URIs. */
export function writeGlb(mesh: SpmMesh, resolveTexture: (name: string) => string, shaders: Map<string, string>): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let byteLength = 0;
  function append(data: Buffer, target?: number): number {
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, ...(target ? { target } : {}) });
    const aligned = Buffer.alloc(Math.ceil(data.length / 4) * 4);
    data.copy(aligned);
    chunks.push(aligned);
    byteLength += aligned.length;
    return view;
  }
  function attribute(values: number[], size: number, type: string, componentType = 5126): number {
    const data = Buffer.alloc(values.length * (componentType === 5123 ? 2 : 4));
    values.forEach((value, index) => {
      if (componentType === 5123) data.writeUInt16LE(value, index * 2);
      else data.writeFloatLE(value, index * 4);
    });
    const accessor = accessors.length;
    const bounds: Record<string, number[]> = {};
    if (type === "VEC3") {
      bounds.min = [Infinity, Infinity, Infinity];
      bounds.max = [-Infinity, -Infinity, -Infinity];
      values.forEach((value, index) => {
        bounds.min[index % 3] = Math.min(bounds.min[index % 3], value);
        bounds.max[index % 3] = Math.max(bounds.max[index % 3], value);
      });
    }
    accessors.push({ bufferView: append(data, componentType === 5123 ? 34963 : 34962), componentType, count: values.length / size, type, ...bounds });
    return accessor;
  }
  const images: Record<string, unknown>[] = [];
  const textures: Record<string, number>[] = [];
  const textureCache = new Map<string, number>();
  const materials = mesh.materials.map((spec) => {
    let texture: number | undefined;
    if (spec.texture) {
      const path = resolveTexture(spec.texture);
      texture = textureCache.get(path);
      if (texture === undefined) {
        const image = readFileSync(path);
        const mimeType = image[0] === 0x89 ? "image/png" : image[0] === 0xff ? "image/jpeg" : "";
        if (!mimeType) throw new Error(`Unsupported texture format: ${path}`);
        texture = textures.length;
        textures.push({ source: images.length, sampler: 0 });
        images.push({ bufferView: append(image), mimeType });
        textureCache.set(path, texture);
      }
    }
    const shader = shaders.get(spec.texture) ?? "solid";
    return {
      name: spec.texture.split(/[\\/]/).at(-1) || "untextured",
      doubleSided: true,
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.85, ...(texture === undefined ? {} : { baseColorTexture: { index: texture } }) },
      alphaMode: ["alphablend", "additive"].includes(shader) ? "BLEND" : ["alphatest", "grass"].includes(shader) ? "MASK" : "OPAQUE",
      ...(shader === "additive" ? { emissiveFactor: [0.8, 0.8, 0.8], ...(texture === undefined ? {} : { emissiveTexture: { index: texture } }) } : {}),
      ...(shader === "unlit" ? { extensions: { KHR_materials_unlit: {} } } : {}),
    };
  });
  const primitives = mesh.primitives.map((primitive) => ({
    attributes: {
      POSITION: attribute(primitive.positions, 3, "VEC3"),
      NORMAL: attribute(primitive.normals, 3, "VEC3"),
      COLOR_0: attribute(primitive.colors, 4, "VEC4"),
      ...(primitive.uvs.length ? { TEXCOORD_0: attribute(primitive.uvs, 2, "VEC2") } : {}),
    },
    indices: attribute(primitive.indices, 1, "SCALAR", 5123),
    material: primitive.material,
  }));
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "RuneWeave stk-car SPM converter" },
    ...(materials.some((material) => "extensions" in material) ? { extensionsUsed: ["KHR_materials_unlit"] } : {}),
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials, images, textures,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors, bufferViews, buffers: [{ byteLength }],
  }));
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(paddedJson);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + byteLength, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, paddedJson, binHeader, ...chunks]);
}
