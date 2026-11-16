import { kartBodies } from "./kart-bodies.js";
import type { Racer } from "./race.js";

export interface KartContact { x: number; z: number; depth: number; }

function body(racer: Racer) {
  const { min, max } = kartBodies[racer.kartId as keyof typeof kartBodies] ?? kartBodies.tux;
  const cos = Math.cos(racer.heading), sin = Math.sin(racer.heading), x = (min[0] + max[0]) / 2, z = (min[2] + max[2]) / 2;
  return { x: racer.x + cos * x - sin * z, z: racer.z + sin * x + cos * z,
    right: { x: cos, z: sin }, back: { x: -sin, z: cos },
    width: (max[0] - min[0]) / 2, length: (max[2] - min[2]) / 2,
    bottom: racer.y + min[1], top: racer.y + max[1] };
}

/** Oriented chassis footprints, using the packaged body/wheel bounds rather than center distance. */
export function kartContact(a: Racer, b: Racer): KartContact | null {
  if (a.finishedAt !== null || b.finishedAt !== null) return null;
  const first = body(a), second = body(b);
  if (first.top <= second.bottom || second.top <= first.bottom) return null;
  const dx = second.x - first.x, dz = second.z - first.z;
  if (Math.hypot(dx, dz) > Math.hypot(first.width, first.length) + Math.hypot(second.width, second.length)) return null;
  let contact = { x: 0, z: 0, depth: Infinity };
  for (const axis of [first.right, first.back, second.right, second.back]) {
    const extent = (box: typeof first) => box.width * Math.abs(box.right.x * axis.x + box.right.z * axis.z) + box.length * Math.abs(box.back.x * axis.x + box.back.z * axis.z);
    const distance = dx * axis.x + dz * axis.z, depth = extent(first) + extent(second) - Math.abs(distance);
    if (depth <= 0) return null;
    if (depth < contact.depth) {
      const sign = distance < 0 ? -1 : 1;
      contact = { x: axis.x * sign, z: axis.z * sign, depth };
    }
  }
  return contact;
}

function velocity(racer: Racer): { x: number; z: number } {
  return { x: Math.sin(racer.heading) * racer.speed + Math.cos(racer.heading) * racer.sideSpeed,
    z: -Math.cos(racer.heading) * racer.speed + Math.sin(racer.heading) * racer.sideSpeed };
}

/** Resolve every pair symmetrically; lateral impulses remain on each existing racer until grip damps them. */
export function resolveKartContacts(racers: Racer[]): Set<Racer> {
  const moved = new Set<Racer>();
  // Revisit earlier pairs when a third kart pushes them back together.
  for (let iteration = 0; iteration < 16; iteration++) {
    let overlap = false;
    for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j], contact = kartContact(a, b);
      if (!contact) continue;
      overlap = true; moved.add(a); moved.add(b);
      const { x, z, depth } = contact, separation = (depth + 0.0001) / 2;
      a.x -= x * separation; a.z -= z * separation; b.x += x * separation; b.z += z * separation;
      const av = velocity(a), bv = velocity(b), closing = (bv.x - av.x) * x + (bv.z - av.z) * z;
      if (closing >= 0) continue;
      // Equal-mass arcade response with low restitution; separating contacts receive no extra kick.
      const impulse = -closing * 1.1 / 2;
      for (const [racer, v, sign] of [[a, av, -1], [b, bv, 1]] as const) {
        const vx = v.x + sign * impulse * x, vz = v.z + sign * impulse * z;
        racer.speed = vx * Math.sin(racer.heading) - vz * Math.cos(racer.heading);
        racer.sideSpeed = vx * Math.cos(racer.heading) + vz * Math.sin(racer.heading);
      }
    }
    if (!overlap) break;
  }
  return moved;
}
