import { clamp, emptyControls, type Controls } from "./race.js";

export interface Layout {
  width: number; height: number; left: number; right: number; top: number; bottom: number;
  stickX: number; stickY: number; radius: number; controlSize: number;
}
export interface Contact { id: string; justPressed: boolean; x: number; y: number; }

export class TouchControls {
  stickId: string | null = null;
  dx = 0;
  dy = 0;
  apply(input: Controls, contacts: Contact[], layout: Layout): void {
    if (this.stickId && !contacts.some((contact) => contact.id === this.stickId)) this.stickId = null;
    for (const contact of contacts) {
      if (!this.stickId && contact.justPressed && Math.hypot(contact.x - layout.stickX, contact.y - layout.stickY) <= layout.radius * 1.4) this.stickId = contact.id;
      if (contact.id === this.stickId) continue;
      const right = layout.width - layout.right - contact.x;
      const bottom = layout.height - layout.bottom - contact.y;
      const size = layout.controlSize;
      const gap = size + 9;
      const hit = (column: number, row: number) => right >= column * gap && right <= column * gap + size && bottom >= row * gap && bottom <= row * gap + size;
      if (hit(0, 1)) input.throttle = 1;
      if (hit(0, 0)) input.brake = true;
      if (hit(1, 1)) input.nitro = true;
      if (hit(1, 0)) input.drift = true;
      if (hit(2, 1) && contact.justPressed) input.useItem = true;
      if (hit(2, 0) && contact.justPressed) input.rescue = true;
    }
    const stick = contacts.find((contact) => contact.id === this.stickId);
    this.dx = stick ? clamp((stick.x - layout.stickX) / layout.radius, -1, 1) : 0;
    this.dy = stick ? clamp((stick.y - layout.stickY) / layout.radius, -1, 1) : 0;
    if (stick) {
      input.steer = Math.abs(this.dx) > 0.12 ? this.dx : 0;
      input.throttle = this.dy > 0.4 ? -this.dy : 1;
    }
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
  input.rescue ||= ui_button_just_pressed("rescue");
  input.useItem ||= ui_button_just_pressed("item");
  const contacts = input_touches().map((contact) => ({ id: contact.id, justPressed: contact.justPressed, x: contact.x * layout.width, y: contact.y * layout.height }));
  const pointer = input_primary_pointer();
  if (!contacts.length && pointer.pressed) contacts.push({ id: "mouse", justPressed: pointer.justPressed,
    x: (pointer.x / pointer.viewportWidth + 0.5) * layout.width, y: (0.5 - pointer.y / pointer.viewportHeight) * layout.height });
  touch.apply(input, contacts, layout);
  return input;
}
