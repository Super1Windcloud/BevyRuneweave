import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { advanceWheelSpin, kartFrame, wheelTransform } from "../modules/stk-car/game/src/kart-transform.ts";
import { trackData } from "../modules/stk-car/game/src/track-data.ts";
import { wheelRadius } from "./spm.ts";

type Point = readonly number[];
const rotateX = ([x, y, z]: Point, a: number) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const rotateY = ([x, y, z]: Point, a: number) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotateZ = ([x, y, z]: Point, a: number) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
// Independently reconstruct the runtime's Rx * Ry * Rz transform.
const runtimeRotate = (point: Point, [x, y, z]: Point) => rotateX(rotateY(rotateZ(point, z), y), x);
function close(actual: Point, expected: Point, message = "vector") {
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-8, `${message}, axis ${axis}: ${actual[axis]} != ${expected[axis]}`);
}

test("wheel axle stays aligned with the kart at every rolling phase, heading, slope and steering angle", () => {
  for (const heading of [0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 2, 5.3]) for (const pitch of [-0.3, 0, 0.4]) for (const lean of [-0.09, 0, 0.09]) {
    const pose = { x: 10, y: 3, z: -4, heading, pitch }, frame = kartFrame(pose, lean);
    const parentRotate = (point: Point) => rotateY(rotateX(rotateZ(point, lean), pitch), -heading);
    for (const vector of [[1, 0, 0], [0, 1, 0], [0, 0, -1]]) close(runtimeRotate(vector, frame.rotation), parentRotate(vector), "body basis");
    for (const steering of [-0.35, 0, 0.35]) for (const spin of [-5.8, -Math.PI / 2, 0, 1.4, Math.PI, 5.5]) {
      const wheel = wheelTransform(frame, [-0.32, 0.14, 0.34], spin, steering);
      for (const vector of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        close(runtimeRotate(vector, wheel.rotation), parentRotate(rotateY(rotateX(vector, spin), steering)), "wheel basis");
      }
      close(runtimeRotate([1, 0, 0], wheel.rotation), parentRotate(rotateY([1, 0, 0], steering)), "spin must not change the axle");
    }
  }
});

test("all kart wheel mounts retain STK's lean-compensated plane and never orbit when rolling or steering", () => {
  const frame = kartFrame({ x: -8, y: 2, z: 5, heading: 1.1, pitch: 0.28 }, -0.09);
  for (const kart of trackData.karts) for (const source of kart.wheels) {
    const offset = rotateY(rotateX(source.position, 0.28), -1.1);
    const expected = [frame.position.x + offset[0], frame.position.y + offset[1], frame.position.z + offset[2]];
    for (const spin of [-Math.PI, -0.9, 0, 2.7]) {
      const wheel = wheelTransform(frame, source.position, spin, source.front ? 0.35 : 0);
      close([wheel.position.x, wheel.position.y, wheel.position.z], expected);
      const upright = wheelTransform(kartFrame({ x: -8, y: 2, z: 5, heading: 1.1, pitch: 0.28 }), source.position, spin, 0);
      close([wheel.position.x, wheel.position.y, wheel.position.z], [upright.position.x, upright.position.y, upright.position.z], "body lean must not lift wheel centers");
    }
  }
});

test("forward rolling cancels ground contact velocity; reverse, pause and per-wheel radii are respected", () => {
  const dt = 1e-6, radius = 0.14, speed = 7;
  const spin = advanceWheelSpin(0, speed, dt, radius), contact = rotateX([0, -radius, 0], spin);
  assert.ok(Math.abs(-speed * dt + contact[2]) < 1e-12, "wheel must roll forward instead of spinning backward");
  assert.equal(advanceWheelSpin(spin, speed, 0, radius), spin);
  assert.ok(Math.abs(advanceWheelSpin(spin, -speed, dt, radius)) < 1e-12);
  assert.equal(advanceWheelSpin(0, 1, 0.01, radius / 2), 2 * advanceWheelSpin(0, 1, 0.01, radius));
});

test("prepared wheel radii match the actual GLB vertical bounds and reject empty or flat meshes", () => {
  for (const kart of trackData.karts) for (const wheel of kart.wheels) {
    const data = readFileSync(resolve(import.meta.dirname, "../modules/stk-car/game/assets", wheel.path));
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString()) as {
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
      accessors: { min: number[]; max: number[] }[];
    };
    const positions = gltf.meshes[0].primitives.map((primitive) => gltf.accessors[primitive.attributes.POSITION]);
    const expected = (Math.max(...positions.map((p) => p.max[1])) - Math.min(...positions.map((p) => p.min[1]))) / 2;
    assert.ok(Math.abs(wheel.radius - expected) < 1e-8, `${kart.id}: ${wheel.path}`);
    assert.ok(wheel.radius > 0.05 && wheel.radius < 0.3);
  }
  assert.throws(() => wheelRadius({ materials: [], primitives: [] }), /Invalid wheel/);
  assert.throws(() => wheelRadius({ materials: [], primitives: [{ material: 0, positions: [0, 0, 0], normals: [], uvs: [], colors: [], indices: [] }] }), /Invalid wheel/);
});
