export interface Vec3 { x: number; y: number; z: number; }
export interface RouteNode { center: readonly number[]; width: number; }
export interface Controls { throttle: number; steer: number; brake: boolean; drift: boolean; nitro: boolean; rescue: boolean; useItem: boolean; }
export interface Pose extends Vec3 { heading: number; pitch: number; }
export interface Racer extends Pose {
  previous: Pose;
  id: string;
  speed: number;
  progress: number;
  routeDistance: number;
  segment: number;
  lane: number;
  nitro: number;
  boost: number;
  driftCharge: number;
  steering: number;
  offRoad: number;
  stun: number;
  item: boolean;
  finishedAt: number | null;
}
export interface Pickup { kind: string; position: readonly number[]; cooldown: number; }
export const fixedStep = 1 / 120;
export const emptyControls = (): Controls => ({ throttle: 0, steer: 0, brake: false, drift: false, nitro: false, rescue: false, useItem: false });
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
export function angleDelta(value: number): number { return Math.atan2(Math.sin(value), Math.cos(value)); }
export function formatTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.floor(seconds * 1000));
  return `${Math.floor(milliseconds / 60000)}:${`${Math.floor(milliseconds / 1000) % 60}`.padStart(2, "0")}.${`${milliseconds % 1000}`.padStart(3, "0")}`;
}
export function interpolate(racer: Racer, alpha: number): Pose {
  return {
    x: racer.previous.x + (racer.x - racer.previous.x) * alpha,
    y: racer.previous.y + (racer.y - racer.previous.y) * alpha,
    z: racer.previous.z + (racer.z - racer.previous.z) * alpha,
    heading: racer.previous.heading + angleDelta(racer.heading - racer.previous.heading) * alpha,
    pitch: racer.previous.pitch + (racer.pitch - racer.previous.pitch) * alpha,
  };
}

export class Circuit {
  readonly distances = [0];
  readonly length: number;
  constructor(readonly nodes: readonly RouteNode[]) {
    if (nodes.length < 3) throw new Error("A circuit needs at least three route nodes");
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].center;
      const b = nodes[(i + 1) % nodes.length].center;
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (!Number.isFinite(length) || length < 0.001 || !a.every(Number.isFinite) || !Number.isFinite(nodes[i].width) || nodes[i].width < 1) throw new Error("Invalid circuit geometry");
      this.distances.push(this.distances[i] + length);
    }
    this.length = this.distances.at(-1)!;
  }
  wrap(distance: number): number { return ((distance % this.length) + this.length) % this.length; }
  sample(distance: number, lane = 0): Pose & { segment: number; width: number } {
    const s = this.wrap(distance);
    let segment = 0;
    while (segment + 1 < this.nodes.length && this.distances[segment + 1] <= s) segment++;
    const a = this.nodes[segment];
    const b = this.nodes[(segment + 1) % this.nodes.length];
    const length = this.distances[segment + 1] - this.distances[segment];
    const t = (s - this.distances[segment]) / length;
    const dx = b.center[0] - a.center[0];
    const dz = b.center[2] - a.center[2];
    const heading = Math.atan2(dx, -dz);
    return {
      x: a.center[0] + dx * t + Math.cos(heading) * lane,
      y: a.center[1] + (b.center[1] - a.center[1]) * t,
      z: a.center[2] + dz * t + Math.sin(heading) * lane,
      heading, pitch: Math.atan2(b.center[1] - a.center[1], length), segment,
      width: a.width + (b.width - a.width) * t,
    };
  }
  project(x: number, z: number, previousSegment: number): { distance: number; lateral: number; width: number; segment: number; y: number } {
    let best = { distance: 0, lateral: Infinity, width: 0, segment: previousSegment, y: 0 };
    let bestSquared = Infinity;
    // Local topology prevents snapping to another stretch of track at crossings.
    for (let offset = -4; offset <= 4; offset++) {
      const segment = (previousSegment + offset + this.nodes.length) % this.nodes.length;
      const a = this.nodes[segment];
      const b = this.nodes[(segment + 1) % this.nodes.length];
      const dx = b.center[0] - a.center[0];
      const dz = b.center[2] - a.center[2];
      const t = clamp(((x - a.center[0]) * dx + (z - a.center[2]) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = a.center[0] + dx * t;
      const pz = a.center[2] + dz * t;
      const squared = (x - px) ** 2 + (z - pz) ** 2;
      if (squared >= bestSquared) continue;
      bestSquared = squared;
      best = {
        segment, distance: this.distances[segment] + t * (this.distances[segment + 1] - this.distances[segment]),
        lateral: Math.sqrt(squared), width: a.width + (b.width - a.width) * t,
        y: a.center[1] + (b.center[1] - a.center[1]) * t,
      };
    }
    return best;
  }
}

export class Race {
  readonly racers: Racer[];
  readonly pickups: Pickup[];
  readonly traps: { x: number; z: number; y: number; lifetime: number; owner: string }[] = [];
  phase: "ready" | "countdown" | "racing" | "finished" = "ready";
  countdown = 3;
  elapsed = 0;
  lapTime = 0;
  readonly lapTimes: number[] = [];
  constructor(readonly circuit: Circuit, pickups: readonly { kind: string; position: readonly number[] }[], readonly laps = 3) {
    this.pickups = pickups.map((pickup) => ({ ...pickup, cooldown: 0 }));
    this.racers = ["tux", "comet", "pepper", "ocean"].map((id, index) => {
      const progress = 5 - Math.floor(index / 2) * 3;
      const lane = index % 2 ? 1.4 : -1.4;
      const pose = circuit.sample(progress, lane);
      return { ...pose, previous: { ...pose }, id, progress: progress - 5, routeDistance: circuit.wrap(progress), lane,
        speed: 0, nitro: 35, boost: 0, driftCharge: 0, steering: 0, offRoad: 0, stun: 0, item: false, finishedAt: null };
    });
  }
  get player(): Racer { return this.racers[0]; }
  get rank(): number { return this.ranking.indexOf(this.player) + 1; }
  get ranking(): Racer[] {
    return [...this.racers].sort((a, b) => a.finishedAt !== null && b.finishedAt !== null ? a.finishedAt - b.finishedAt
      : a.finishedAt !== null ? -1 : b.finishedAt !== null ? 1 : b.progress - a.progress);
  }
  start(): void { if (this.phase === "ready") this.phase = "countdown"; }
  rescue(racer = this.player): void {
    const pose = this.circuit.sample(racer.routeDistance, racer.lane);
    Object.assign(racer, pose, { previous: { ...pose }, speed: 0, offRoad: 0, boost: 0, driftCharge: 0 });
  }
  step(dt: number, controls: Controls): void {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05) return;
    for (const racer of this.racers) racer.previous = { x: racer.x, y: racer.y, z: racer.z, heading: racer.heading, pitch: racer.pitch };
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = "racing";
      return;
    }
    if (this.phase !== "racing") return;
    this.elapsed += dt;
    const player = this.player;
    const previousLap = Math.floor(player.progress / this.circuit.length);
    for (let i = 0; i < this.racers.length; i++) {
      const racer = this.racers[i];
      if (racer.finishedAt !== null) { racer.speed = 0; continue; }
      racer.stun = Math.max(0, racer.stun - dt);
      racer.boost = Math.max(0, racer.boost - dt);
      if (i === 0) this.drive(racer, dt, controls);
      else this.driveAi(racer, i, dt);
      if (racer.progress >= this.circuit.length * this.laps) racer.finishedAt = this.elapsed;
      for (const pickup of this.pickups) {
        if (pickup.cooldown > 0 || Math.abs(racer.y - pickup.position[1]) > 4 || Math.hypot(racer.x - pickup.position[0], racer.z - pickup.position[2]) > 1.7) continue;
        if (pickup.kind.includes("nitro")) racer.nitro = Math.min(100, racer.nitro + (pickup.kind === "big-nitro" ? 28 : 14));
        else if (pickup.kind === "banana") { racer.stun = 1; racer.speed *= 0.35; }
        else racer.item = true;
        pickup.cooldown = 7;
      }
    }
    for (const pickup of this.pickups) pickup.cooldown = Math.max(0, pickup.cooldown - dt);
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      trap.lifetime -= dt;
      for (const racer of this.racers) if (racer.id !== trap.owner && Math.abs(racer.y - trap.y) < 3 && Math.hypot(racer.x - trap.x, racer.z - trap.z) < 1.2) {
        racer.stun = 1.2; racer.speed *= 0.4; trap.lifetime = 0;
      }
      if (trap.lifetime <= 0) this.traps.splice(i, 1);
    }
    for (const rival of this.racers.slice(1)) {
      if (Math.abs(player.y - rival.y) < 1 && Math.hypot(player.x - rival.x, player.z - rival.z) < 0.85 && player.speed > rival.speed) {
        const transfer = (player.speed - rival.speed) * 0.45;
        player.speed -= transfer;
        rival.speed += transfer;
      }
    }
    const lap = Math.floor(player.progress / this.circuit.length);
    if (lap > previousLap && this.lapTimes.length < lap) {
      this.lapTimes.push(this.elapsed - this.lapTime);
      this.lapTime = this.elapsed;
    }
    if (player.finishedAt !== null) this.phase = "finished";
  }
  private drive(racer: Racer, dt: number, controls: Controls): void {
    if (controls.rescue) this.rescue(racer);
    if (controls.useItem && racer.item) {
      this.traps.push({ x: racer.x - Math.sin(racer.heading) * 2.5, z: racer.z + Math.cos(racer.heading) * 2.5, y: racer.y, lifetime: 18, owner: racer.id });
      racer.item = false;
    }
    const steering = clamp(controls.steer, -1, 1);
    racer.steering += (steering - racer.steering) * (1 - Math.exp(-dt * 12));
    const drifting = controls.drift && Math.abs(racer.steering) > 0.25 && racer.speed > 10;
    if (drifting) racer.driftCharge = Math.min(3, racer.driftCharge + dt);
    else {
      if (racer.driftCharge >= 0.8) racer.boost = Math.min(1.5, racer.driftCharge * 0.65);
      racer.driftCharge = 0;
    }
    const nitro = controls.nitro && racer.nitro > 0 && racer.speed > 3 && controls.throttle > 0;
    if (nitro) racer.nitro = Math.max(0, racer.nitro - 23 * dt);
    const boosting = nitro || racer.boost > 0;
    const maxSpeed = racer.stun > 0 ? 9 : boosting ? 42 : 30;
    const acceleration = clamp(controls.throttle, -1, 1) * (boosting ? 17 : 11) - 0.07 * racer.speed;
    racer.speed = clamp(racer.speed + acceleration * dt, -8, Math.max(maxSpeed, racer.speed - 20 * dt));
    if (controls.brake) racer.speed = Math.max(0, racer.speed - 24 * dt);
    if (controls.throttle === 0) racer.speed *= Math.exp(-dt * 0.5);
    racer.heading += racer.steering * clamp(racer.speed / 11, -0.6, 1.9) * (drifting ? 1.2 : 0.92) * dt;
    racer.x += Math.sin(racer.heading) * racer.speed * dt;
    racer.z -= Math.cos(racer.heading) * racer.speed * dt;
    const road = this.circuit.project(racer.x, racer.z, racer.segment);
    let delta = road.distance - racer.routeDistance;
    if (delta > this.circuit.length / 2) delta -= this.circuit.length;
    if (delta < -this.circuit.length / 2) delta += this.circuit.length;
    if (Math.abs(delta) <= Math.abs(racer.speed) * dt * 3 + 0.5 && road.lateral < road.width * 0.8) {
      racer.progress = Math.max(-10, racer.progress + delta);
      racer.routeDistance = this.circuit.wrap(road.distance);
    }
    racer.segment = road.segment;
    racer.y += (road.y - racer.y) * (1 - Math.exp(-dt * 25));
    racer.pitch = this.circuit.sample(road.distance).pitch;
    if (road.lateral > road.width * 0.48) {
      racer.speed *= Math.exp(-dt * 1.5);
      racer.offRoad += dt;
    } else racer.offRoad = 0;
    if (road.lateral > road.width * 1.5 || racer.offRoad > 3) this.rescue(racer);
  }
  private driveAi(racer: Racer, index: number, dt: number): void {
    const ahead = this.circuit.sample(racer.routeDistance + 12);
    const turn = Math.abs(angleDelta(ahead.heading - racer.heading));
    const targetSpeed = racer.stun > 0 ? 8 : 23 + index * 0.8 - Math.min(9, turn * 8);
    racer.speed += clamp(targetSpeed - racer.speed, -16 * dt, 9 * dt);
    const distance = racer.speed * dt;
    racer.progress += distance;
    racer.routeDistance = this.circuit.wrap(racer.routeDistance + distance);
    const pose = this.circuit.sample(racer.routeDistance, racer.lane + Math.sin(this.elapsed * 0.7 + index) * 0.3);
    racer.x = pose.x; racer.y = pose.y; racer.z = pose.z; racer.segment = pose.segment;
    racer.heading += angleDelta(pose.heading - racer.heading) * (1 - Math.exp(-dt * 9));
    racer.pitch = pose.pitch;
  }
}
