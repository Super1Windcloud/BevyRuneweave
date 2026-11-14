import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { halfFloat, readSpm } from "./spm.ts";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";

const assets = resolve(import.meta.dirname, "../modules/stk-car/game/assets");
test("original menu and race music and effect resources are included in the asset manifest", () => {
  const manifest = JSON.parse(readFileSync(join(assets, "asset-manifest.json"), "utf8")) as { files: string[] };
  for (const path of [...Object.values(trackData.audio), "audio/sfx/engine_small.ogg", "audio/sfx/nitro.ogg", "audio/sfx/start_race.ogg", "audio/sfx/skid.ogg"]) {
    assert.ok(manifest.files.includes(path)); assert.equal(readFileSync(join(assets, path)).subarray(0, 4).toString(), "OggS");
  }
  for (const path of ["licenses/music.txt", "licenses/sfx.txt", "ui/bottom_bar.png", "ui/menu_story.png", "ui/menu_multi.png"]) assert.ok(manifest.files.includes(path));
});
test("SPM decoding rejects unsupported headers and truncated buffers", () => {
  assert.equal(halfFloat(0x3c00), 1);
  assert.equal(halfFloat(0xc000), -2);
  assert.equal(halfFloat(1), 2 ** -24);
  assert.ok(Number.isNaN(halfFloat(0x7e00)));
  assert.throws(() => readSpm(Buffer.from("SP")), /Truncated/);
  assert.throws(() => readSpm(Buffer.from([0x53, 0x50, 0x10, 0])), /Unsupported/);
});

test("all converted GLBs are self-contained with valid bounds, triangle indices and image signatures", () => {
  const paths = [trackData.trackModel, trackData.kartModel, ...trackData.wheels.map((wheel) => wheel.path),
    trackData.skyModel, trackData.menuSkyModel, ...Object.values(trackData.pickupModels), ...trackData.karts.flatMap((kart) => [kart.model, ...kart.wheels.map((wheel) => wheel.path)])];
  for (const path of paths) {
    const data = readFileSync(join(assets, path));
    assert.equal(data.readUInt32LE(), 0x46546c67);
    assert.equal(data.readUInt32LE(4), 2);
    assert.equal(data.readUInt32LE(8), data.length);
    const jsonSize = data.readUInt32LE(12);
    assert.equal(data.readUInt32LE(16), 0x4e4f534a);
    const gltf = JSON.parse(data.subarray(20, 20 + jsonSize).toString()) as {
      asset: { version: string }; buffers: { byteLength: number; uri?: string }[];
      bufferViews: { byteOffset: number; byteLength: number }[];
      accessors: { bufferView: number; count: number; type: string; componentType: number }[];
      meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
      images: { bufferView: number; mimeType: string; uri?: string }[];
    };
    assert.equal(gltf.asset.version, "2.0");
    const binary = data.subarray(28 + jsonSize);
    assert.equal(binary.length, gltf.buffers[0].byteLength);
    assert.equal(gltf.buffers[0].uri, undefined);
    for (const view of gltf.bufferViews) assert.ok(view.byteOffset % 4 === 0 && view.byteOffset + view.byteLength <= binary.length);
    for (const image of gltf.images) {
      assert.equal(image.uri, undefined);
      const view = gltf.bufferViews[image.bufferView];
      assert.ok(image.mimeType === "image/png" ? binary[view.byteOffset] === 0x89 : image.mimeType === "image/jpeg" && binary[view.byteOffset] === 0xff);
    }
    for (const primitive of gltf.meshes[0].primitives) {
      const positions = gltf.accessors[primitive.attributes.POSITION];
      const indices = gltf.accessors[primitive.indices];
      assert.equal(indices.componentType, 5123);
      assert.equal(indices.count % 3, 0);
      const view = gltf.bufferViews[indices.bufferView];
      for (let i = 0; i < indices.count; i++) assert.ok(binary.readUInt16LE(view.byteOffset + i * 2) < positions.count);
      const vertices = gltf.bufferViews[positions.bufferView];
      for (let i = 0; i < positions.count * 3; i++) assert.ok(Number.isFinite(binary.readFloatLE(vertices.byteOffset + i * 4)));
    }
    if (path === trackData.trackModel) {
      assert.equal(gltf.meshes[0].primitives.reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0), trackData.sceneMetadata.triangles);
      assert.ok(gltf.meshes[0].primitives.length < 200, "static batching reduces the original 285 draw primitives without removing triangles");
    }
  }
  for (const file of ["fonts/wqy-microhei.ttf", "branding/tux.png", "licenses/tux.txt", "licenses/lighthouse.txt", "licenses/stk-assets.txt"]) assert.ok(existsSync(join(assets, file)));
});
