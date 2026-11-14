import { clamp, emptyControls, type Controls } from "./race.js";

export interface Layout {
  width: number; height: number; left: number; right: number; top: number; bottom: number;
  stickX: number; stickY: number; radius: number; controlSize: number;
  mobile?: boolean;
}
export interface Contact { id: string; justPressed: boolean; x: number; y: number; }
export interface ControlRect { x: number; y: number; width: number; height: number; }
export type TouchAction = "gas" | "brake" | "boost" | "drift" | "item" | "rescue" | "look-back";
export function touchControlRects(layout: Layout): Record<TouchAction, ControlRect> {
  const size = layout.controlSize, gap = size + 9;
  const rect = (column: number, row: number) => ({ x: layout.width - layout.right - column * gap - size, y: layout.height - layout.bottom - row * gap - size, width: size, height: size });
  return { gas: rect(0, 1), brake: rect(0, 0), boost: rect(1, 1), drift: rect(1, 0), item: rect(2, 1), rescue: rect(2, 0),
    "look-back": { x: layout.stickX + layout.radius + 14, y: layout.height - layout.bottom - size, width: size, height: size } };
}
export function makeLayout(width: number, height: number, insets: { left: number; right: number; top: number; bottom: number }, mobile = false): Layout {
  const unit = clamp(height / 720, 0.65, 1.2);
  const layout: Layout = { width, height, mobile, left: Math.max(16, insets.left + 12), right: Math.max(16, insets.right + 12), top: Math.max(12, insets.top + 10), bottom: Math.max(14, insets.bottom + 12),
    stickX: 0, stickY: 0, radius: mobile ? clamp(height * 0.145, 44, 72) : 60 * unit,
    controlSize: mobile ? clamp(Math.min(height * 0.145, (width - insets.left - insets.right) / 12), 44, 72) : 64 * unit };
  layout.stickX = layout.left + layout.radius + 8; layout.stickY = height - layout.bottom - layout.radius - 8;
  return layout;
}

export class TouchControls {
  stickId: string | null = null;
  dx = 0;
  dy = 0;
  readonly active = new Set<TouchAction>();
  private blocked = new Set<string>();
  private capture = new Map<string, TouchAction>();
  private rearm = false;
  reset(): void { this.stickId = null; this.dx = 0; this.dy = 0; this.active.clear(); this.capture.clear(); this.rearm = true; }
  apply(input: Controls, contacts: Contact[], layout: Layout): void {
    this.active.clear();
    if (this.rearm) { this.blocked = new Set(contacts.map((contact) => contact.id)); this.rearm = false; }
    for (const id of this.blocked) if (!contacts.some((contact) => contact.id === id)) this.blocked.delete(id);
    contacts = contacts.filter((contact) => !this.blocked.has(contact.id));
    for (const id of this.capture.keys()) if (!contacts.some((contact) => contact.id === id)) this.capture.delete(id);
    const rects = touchControlRects(layout);
    const contains = (r: ControlRect, c: Contact) => c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height;
    if (this.stickId && !contacts.some((contact) => contact.id === this.stickId)) this.stickId = null;
    for (const contact of contacts) {
      if (!this.stickId && contact.justPressed && Math.hypot(contact.x - layout.stickX, contact.y - layout.stickY) <= layout.radius * 1.4) this.stickId = contact.id;
      if (contact.id === this.stickId) continue;
      if (contact.justPressed) for (const action of Object.keys(rects) as TouchAction[]) if (contains(rects[action], contact)) { this.capture.set(contact.id, action); break; }
      const action = this.capture.get(contact.id);
      if (!action || !contains(rects[action], contact)) continue;
      this.active.add(action);
      if (action === "gas") input.throttle = 1;
      if (action === "brake") input.brake = true;
      if (action === "boost") input.nitro = true;
      if (action === "drift") input.drift = true;
      if (action === "look-back") input.lookBack = true;
      if (action === "item" && contact.justPressed) input.useItem = true;
      if (action === "rescue" && contact.justPressed) input.rescue = true;
    }
    const stick = contacts.find((contact) => contact.id === this.stickId);
    const x = stick ? (stick.x - layout.stickX) / layout.radius : 0, y = stick ? (stick.y - layout.stickY) / layout.radius : 0, length = Math.max(1, Math.hypot(x, y));
    this.dx = x / length; this.dy = y / length;
    if (stick) {
      input.steer = Math.abs(this.dx) > 0.12 ? this.dx : 0;
      if (this.dy > 0.4) input.brake = true; else input.throttle = 1;
    }
    if (input.brake) input.throttle = 0;
  }
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
export function readControls(touch: TouchControls, layout: Layout, mobile = false, wasd = false): Controls {
  const input = keyboardControls(input_key_pressed, input_key_just_pressed, wasd);
  if (!mobile) return input;
  const contacts = input_touches().map((contact) => ({ id: contact.id, justPressed: contact.justPressed, x: contact.x * layout.width, y: contact.y * layout.height }));
  const pointer = input_primary_pointer();
  if (!contacts.length && pointer.pressed) contacts.push({ id: "mouse", justPressed: pointer.justPressed,
    x: (pointer.x / pointer.viewportWidth + 0.5) * layout.width, y: (0.5 - pointer.y / pointer.viewportHeight) * layout.height });
  touch.apply(input, contacts, layout);
  return input;
}
