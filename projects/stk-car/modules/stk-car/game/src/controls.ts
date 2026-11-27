import { angleDelta, clamp, emptyControls, type Controls, type Race } from "./race.js";

export interface Layout {
  width: number; height: number; left: number; right: number; top: number; bottom: number;
  controlSize: number;
  mobile?: boolean;
}
export interface Contact { id: string; justPressed: boolean; x: number; y: number; }
export interface ControlRect { x: number; y: number; width: number; height: number; }
interface SteeringAssist { steer: number; speed: number; speedLimit: number; }
export type TouchAction = "left" | "right" | "boost" | "drift" | "item" | "rescue" | "look-back";
export function touchControlRects(layout: Layout): Record<TouchAction, ControlRect> {
  const size = layout.controlSize, y = layout.height - layout.bottom - size, small = clamp(size * 0.68, 44, 60), steerWidth = size * 1.15;
  return {
    left: { x: layout.left, y, width: steerWidth, height: size },
    right: { x: layout.left + steerWidth + 10, y, width: steerWidth, height: size },
    boost: { x: layout.width - layout.right - size, y, width: size, height: size },
    drift: { x: layout.width - layout.right - size * 2 - 14, y, width: size, height: size },
    item: { x: layout.width - layout.right - small, y: y - small - 12, width: small, height: small },
    rescue: { x: layout.left + 52, y: layout.top + 44, width: 44, height: 44 },
    "look-back": { x: layout.left + 104, y: layout.top + 44, width: 44, height: 44 },
  };
}
export function makeLayout(width: number, height: number, insets: { left: number; right: number; top: number; bottom: number }, mobile = false): Layout {
  const unit = clamp(height / 720, 0.65, 1.2);
  return { width, height, mobile, left: Math.max(16, insets.left + 12), right: Math.max(16, insets.right + 12), top: Math.max(12, insets.top + 10), bottom: Math.max(14, insets.bottom + 12),
    controlSize: mobile ? clamp(Math.min(height * 0.18, (width - insets.left - insets.right) / 10), 52, 88) : 64 * unit };
}

export class TouchControls {
  braking = false;
  drifting = false;
  readonly active = new Set<TouchAction>();
  private blocked = new Set<string>();
  private capture = new Map<string, TouchAction>();
  private rearm = false;
  reset(): void { this.braking = false; this.drifting = false; this.active.clear(); this.capture.clear(); this.rearm = true; }
  apply(input: Controls, contacts: Contact[], layout: Layout, driving = true, assist?: SteeringAssist): void {
    this.active.clear(); this.braking = false; this.drifting = false;
    input.allowReverse = false;
    contacts = contacts.filter((contact) => Number.isFinite(contact.x) && Number.isFinite(contact.y));
    if (this.rearm) { this.blocked = new Set(contacts.map((contact) => contact.id)); this.rearm = false; }
    for (const id of this.blocked) if (!contacts.some((contact) => contact.id === id)) this.blocked.delete(id);
    if (this.blocked.size) {
      Object.assign(input, emptyControls());
      input.lookBack = false;
      return;
    }
    for (const id of this.capture.keys()) if (!contacts.some((contact) => contact.id === id)) this.capture.delete(id);
    const rects = touchControlRects(layout);
    const contains = (r: ControlRect, c: Contact) => c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height;
    for (const contact of contacts) {
      if (contact.justPressed) for (const action of Object.keys(rects) as TouchAction[]) if (contains(rects[action], contact)) { this.capture.set(contact.id, action); break; }
      const action = this.capture.get(contact.id);
      // A captured steering finger may slide between arrows without lifting or activating another action.
      if (action === "left" || action === "right") {
        for (const direction of ["left", "right"] as const) if (contains(rects[direction], contact)) this.active.add(direction);
        continue;
      }
      if (!action || !contains(rects[action], contact)) continue;
      this.active.add(action);
      if (action === "boost") input.nitro = true;
      if (action === "look-back") input.lookBack = true;
      if (action === "item" && contact.justPressed) input.useItem = true;
      if (action === "rescue" && contact.justPressed) input.rescue = true;
    }
    const manualTouch = this.active.has("left") || this.active.has("right");
    if (manualTouch) input.steer = Number(this.active.has("right")) - Number(this.active.has("left"));
    if (this.active.has("drift")) {
      if (Math.abs(input.steer) > 0.12) input.drift = true;
      else input.brake = true;
    }
    input.throttle = driving && !input.brake ? 1 : 0;
    this.braking = input.brake; this.drifting = input.drift;
    if (assist && driving && !manualTouch && !input.steer) {
      input.steer = assist.steer;
      if (!input.brake && !input.nitro && !input.useItem) {
        if (assist.speed >= assist.speedLimit) input.throttle = 0;
        if (assist.speed > assist.speedLimit + 0.8) input.brake = true;
      }
    }
  }
}

export function steeringAssist(race: Race): SteeringAssist {
  const { player, circuit } = race, distance = player.routeDistance;
  const target = circuit.sample(distance + Math.max(4.5, player.speed * 0.37));
  const error = angleDelta(Math.atan2(target.x - player.x, -(target.z - player.z)) - player.heading);
  const cruiseSpeed = 19, cornerSpeed = 7;
  let speedLimit = clamp(cruiseSpeed - Math.abs(error) * 30, cornerSpeed, cruiseSpeed);
  let heading = circuit.sample(distance + 3).heading;
  for (const lookAhead of [7, 11, 15, 19, 24, 30]) {
    const nextHeading = circuit.sample(distance + lookAhead).heading;
    const turn = Math.abs(angleDelta(nextHeading - heading));
    const targetSpeed = clamp(cruiseSpeed - turn * 45, cornerSpeed, cruiseSpeed);
    // Leave enough distance to brake before reaching the bend.
    speedLimit = Math.min(speedLimit, Math.sqrt(targetSpeed ** 2 + 18 * Math.max(0, lookAhead - 9)));
    heading = nextHeading;
  }
  return { steer: clamp(error * 3.4, -1, 1), speed: player.speed, speedLimit };
}

export function keyboardControls(held: (key: string) => boolean, pressed: (key: string) => boolean, wasd = false): Controls {
  const input = emptyControls();
  input.throttle = held("ArrowUp") || wasd && held("KeyW") ? 1 : 0;
  input.brake = held("ArrowDown") || wasd && held("KeyS");
  input.steer = (held("ArrowRight") || wasd && held("KeyD") ? 1 : 0) - (held("ArrowLeft") || wasd && held("KeyA") ? 1 : 0);
  input.drift = held("KeyV"); input.nitro = held("KeyN"); input.lookBack = held("KeyB");
  input.rescue = pressed("Backspace"); input.useItem = pressed("Space");
  return input;
}
export function readControls(touch: TouchControls, layout: Layout, mobile = false, wasd = false, driving?: { race: Race; steeringAssist: boolean }): Controls {
  const input = keyboardControls(input_key_pressed, input_key_just_pressed, wasd);
  if (!mobile) return input;
  const contacts = input_touches().map((contact) => ({ id: contact.id, justPressed: contact.justPressed, x: contact.x * layout.width, y: contact.y * layout.height }));
  const pointer = input_primary_pointer();
  if (!contacts.length && pointer.pressed) contacts.push({ id: "mouse", justPressed: pointer.justPressed,
    x: (pointer.x / pointer.viewportWidth + 0.5) * layout.width, y: (0.5 - pointer.y / pointer.viewportHeight) * layout.height });
  const active = driving ? driving.race.phase === "racing" : true;
  const assist = active && driving?.steeringAssist ? steeringAssist(driving.race) : undefined;
  touch.apply(input, contacts, layout, active, assist);
  return input;
}
