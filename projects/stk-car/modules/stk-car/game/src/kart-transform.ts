import type { Pose, Vec3 } from "./race.js";

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];
type Euler = readonly [number, number, number];
export interface KartFrame { position: Vec3; rotation: Euler; basis: Matrix3; mountBasis: Matrix3; }

/** The runtime consumes intrinsic XYZ angles (Rx * Ry * Rz). */
function eulerXyz(m: Matrix3): Euler {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])));
  return Math.abs(m[2]) < 1 - 1e-12
    ? [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]
    : [Math.atan2(m[7], m[4]), y, 0];
}

/** Heading is about world Y; slope and lean are about the kart's local axes. */
export function kartFrame(pose: Pose, lean = 0, lift = 0.1): KartFrame {
  const cy = Math.cos(-pose.heading), sy = Math.sin(-pose.heading);
  const cx = Math.cos(pose.pitch), sx = Math.sin(pose.pitch), cz = Math.cos(lean), sz = Math.sin(lean);
  const basis: Matrix3 = [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx, -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx];
  // STK compensates wheel positions for visual body lean, keeping their mounting plane on the road.
  const mountBasis: Matrix3 = [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx];
  return { position: { x: pose.x, y: pose.y + lift, z: pose.z }, basis, mountBasis, rotation: eulerXyz(basis) };
}

/** Keep the XML axle pivot; compose parent * steering(Y) * rolling(X). */
export function wheelTransform(frame: KartFrame, mount: readonly number[], spin: number, steering: number): { position: Vec3; rotation: Euler } {
  const m = frame.basis, p = frame.mountBasis, [x, y, z] = mount, cy = Math.cos(steering), sy = Math.sin(steering), cx = Math.cos(spin), sx = Math.sin(spin);
  const local: Matrix3 = [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx];
  const rotation: [...Matrix3] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    rotation[row * 3 + column] = m[row * 3] * local[column] + m[row * 3 + 1] * local[3 + column] + m[row * 3 + 2] * local[6 + column];
  }
  return { position: { x: frame.position.x + p[0] * x + p[1] * y + p[2] * z,
    y: frame.position.y + p[3] * x + p[4] * y + p[5] * z, z: frame.position.z + p[6] * x + p[7] * y + p[8] * z },
  rotation: eulerXyz(rotation) };
}

export function advanceWheelSpin(previous: number, speed: number, dt: number, radius: number): number {
  // Forward in the converted GLB is -Z, so forward wheel rotation is about -X.
  return (previous - speed * dt / radius) % (Math.PI * 2);
}
