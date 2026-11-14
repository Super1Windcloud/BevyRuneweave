import assert from "node:assert/strict";
import test from "node:test";
import { FrameProfiler, type FrameMetrics } from "../modules/stk-car/game/src/performance.ts";
import { batchScene } from "./batch-scene.ts";
import type { SpmPrimitive } from "./spm.ts";

test("frame rate uses wall time even when gameplay delta is capped, and resets after clock rollback", () => {
  const profiler = new FrameProfiler();
  let metrics: FrameMetrics | null = null;
  for (let time = 0; time <= 2000; time += 100) { profiler.begin(time); metrics = profiler.end(time + 4); }
  assert.ok(metrics); assert.ok(metrics.fps >= 10 && metrics.fps < 11);
  assert.equal(metrics.scriptMeanMs, 4); assert.equal(metrics.frameP95Ms, 100);
  profiler.begin(500); assert.equal(profiler.end(504), null);
  for (let time = 600; time <= 2500; time += 100) { profiler.begin(time); metrics = profiler.end(time + 2); }
  assert.ok(metrics); assert.ok(metrics.scriptMeanMs > 2 && metrics.scriptMeanMs < 2.2);
});

function triangle(material = 0, x = 0, vertices = 3): SpmPrimitive {
  return { material, positions: Array.from({ length: vertices * 3 }, (_, index) => index % 3 === 0 ? x : 0),
    normals: new Array(vertices * 3).fill(0), colors: new Array(vertices * 4).fill(1), uvs: [], indices: [0, 1, 2] };
}
test("static batching preserves attributes and triangle order, separates materials, cells and transparent objects", () => {
  const a = triangle(), b = triangle(0, 1), far = triangle(0, 200), other = triangle(1), glass = triangle(2);
  const materials = ["road", "grass", "glass"].map((texture) => ({ texture, secondary: "" }));
  const output = batchScene({ materials, primitives: [a, b, far, other, glass, glass] }, new Map([["glass", "alphablend"]]));
  assert.equal(output.primitives.length, 5);
  assert.deepEqual(output.primitives[0].positions, [...a.positions, ...b.positions]);
  assert.deepEqual(output.primitives[0].normals, [...a.normals, ...b.normals]);
  assert.deepEqual(output.primitives[0].colors, [...a.colors, ...b.colors]);
  assert.deepEqual(output.primitives[0].indices, [0, 1, 2, 3, 4, 5]);
  assert.equal(output.primitives[3], glass); assert.equal(output.primitives[4], glass);
  assert.equal(a.positions.length, 9); // Source geometry is reusable.
});
test("static batching splits before the GLB uint16 vertex limit and keeps UV layouts separate", () => {
  const full = triangle(0, 0, 65535), small = triangle();
  const textured = { ...triangle(), uvs: [0, 0, 0, 1, 1, 1] };
  const output = batchScene({ materials: [{ texture: "road", secondary: "" }], primitives: [full, small, textured] }, new Map());
  assert.equal(output.primitives.length, 3);
  assert.ok(output.primitives.every((primitive) => primitive.positions.length / 3 <= 65535));
  assert.deepEqual(output.primitives[2].uvs, textured.uvs);
});
