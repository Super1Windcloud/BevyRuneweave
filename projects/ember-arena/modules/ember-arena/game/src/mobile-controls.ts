import type { UiStyle } from "../../api/ui.js";

export type MobileAction = "mobile_attack" | "mobile_skill" | "mobile_heal" | "mobile_wait";
interface Point { x: number; y: number }
export interface ControlRect extends Point { width: number; height: number }
interface Metrics { width: number; height: number; scale: number; left: number; top: number }
export interface MobileLayout {
  joystick: Point & { radius: number };
  buttons: Record<MobileAction, ControlRect>;
  actionLeft: number;
}
export interface MobileHudState {
  stick: Point & { active: boolean };
  attack: boolean;
  healing: number;
  skill: { label: string; detail: string; enabled: boolean; active: boolean };
}
export interface MobileFrame {
  consumed: boolean;
  engaged: boolean;
  direction: Point;
  actions: MobileAction[];
  worldTap: RuneweaveTouchContact | null;
}

// Geometry is shared by the retained UI and hit testing. Sizes are logical
// screen pixels divided by UI zoom, so touch targets do not shrink with zoom.
export function mobileLayout(m: Metrics): MobileLayout {
  const s = m.scale, gap = 8 / s, margin = 12 / s;
  const bottom = m.height - 26 - gap;
  const radius = Math.max(12 / s, Math.min(56 / s, (m.height - 26) * 0.28, (m.width - 144 / s) / 2));
  const attack = { x: m.width - margin - 56 / s, y: bottom - 56 / s, width: 56 / s, height: 56 / s };
  const skill = { x: attack.x - gap - 48 / s, y: bottom - 48 / s, width: 48 / s, height: 48 / s };
  return {
    joystick: { x: margin + radius, y: bottom - radius, radius },
    buttons: {
      mobile_attack: attack,
      mobile_skill: skill,
      mobile_heal: { x: attack.x + 12 / s, y: attack.y - gap - 44 / s, width: 44 / s, height: 44 / s },
      mobile_wait: { x: skill.x + 4 / s, y: attack.y - gap - 44 / s, width: 44 / s, height: 44 / s },
    },
    actionLeft: skill.x,
  };
}

export function joystickThumbStyle(m: Metrics, stick: MobileHudState["stick"]): UiStyle {
  const radius = mobileLayout(m).joystick.radius, thumb = 36 / m.scale;
  return {
    position: "absolute", left: (radius + stick.x * radius * 0.55 - thumb / 2) * m.scale,
    top: (radius + stick.y * radius * 0.55 - thumb / 2) * m.scale, width: 36, height: 36,
    borderRadius: 18, background: stick.active ? [0.91, 0.67, 0.26, 0.95] : [0.75, 0.75, 0.66, 0.75],
  };
}

export class MobileControls {
  private captures = new Map<string, MobileAction | "joystick" | "ignore">();
  private blocked = new Set<string>();
  readonly stick = { x: 0, y: 0, active: false };

  reset(contacts: readonly RuneweaveTouchContact[] = []): void {
    this.captures.clear();
    this.blocked = new Set(contacts.map((contact) => contact.id));
    this.stick.x = 0; this.stick.y = 0; this.stick.active = false;
  }

  sample(contacts: readonly RuneweaveTouchContact[], m: Metrics, size: Point, active: boolean): MobileFrame {
    const frame: MobileFrame = { consumed: false, engaged: false, direction: { x: 0, y: 0 }, actions: [], worldTap: null };
    const live = new Set(contacts.map((contact) => contact.id));
    for (const id of this.captures.keys()) if (!live.has(id)) this.captures.delete(id);
    for (const id of this.blocked) if (!live.has(id)) this.blocked.delete(id);
    if (!active) {
      for (const id of this.captures.keys()) this.blocked.add(id);
      this.captures.clear();
      this.stick.x = 0; this.stick.y = 0; this.stick.active = false;
      frame.consumed = this.blocked.size > 0;
      return frame;
    }
    const layout = mobileLayout(m);
    this.stick.x = 0; this.stick.y = 0; this.stick.active = false;
    for (const contact of contacts) {
      if (this.blocked.has(contact.id)) continue;
      const point = { x: (contact.x * size.x - m.left) / m.scale, y: (contact.y * size.y - m.top) / m.scale };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      let capture = this.captures.get(contact.id);
      if (!capture && contact.justPressed) {
        if (Math.hypot(point.x - layout.joystick.x, point.y - layout.joystick.y) <= layout.joystick.radius) {
          capture = [...this.captures.values()].includes("joystick") ? "ignore" : "joystick";
        } else {
          capture = (Object.entries(layout.buttons) as [MobileAction, ControlRect][]).find(([, rect]) =>
            point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height)?.[0];
        }
        if (capture) this.captures.set(contact.id, capture);
        else frame.worldTap ??= contact;
      }
      if (capture === "joystick") {
        frame.engaged = true;
        this.stick.active = true;
        const dx = (point.x - layout.joystick.x) / layout.joystick.radius;
        const dy = (point.y - layout.joystick.y) / layout.joystick.radius;
        const distance = Math.hypot(dx, dy), divisor = Math.max(1, distance);
        this.stick.x = dx / divisor; this.stick.y = dy / divisor;
        if (distance >= 0.24) {
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
          frame.direction = { x: Math.round(Math.cos(angle)), y: Math.round(Math.sin(angle)) };
        }
      } else if (capture && capture !== "ignore" && contact.justPressed) frame.actions.push(capture);
    }
    // A secondary finger owns its own action. Rebuilding UI never transfers a
    // held contact to a replacement button or lets it become a ground click.
    frame.consumed = this.captures.size > 0 || this.blocked.size > 0;
    return frame;
  }
}
