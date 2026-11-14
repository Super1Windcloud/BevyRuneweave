export type MobileAction = "mobile_attack" | "mobile_skill" | "mobile_heal" | "mobile_wait";
interface Point { x: number; y: number }
export interface ControlRect extends Point { width: number; height: number }
interface Metrics { width: number; height: number; scale: number; left: number; top: number }
export interface MobileLayout {
  buttons: Record<MobileAction, ControlRect>;
  actionLeft: number;
}
export interface MobileHudState {
  attack: boolean;
  healing: number;
  skill: { label: string; detail: string; enabled: boolean; active: boolean };
}
export interface MobileFrame {
  consumed: boolean;
  actions: MobileAction[];
  worldTap: RuneweaveTouchContact | null;
}

// Geometry is shared by the retained UI and hit testing. Sizes are logical
// screen pixels divided by UI zoom, so touch targets do not shrink with zoom.
export function mobileLayout(m: Metrics): MobileLayout {
  const s = m.scale, gap = 8 / s, margin = 12 / s;
  const bottom = m.height - 26 - gap;
  const attack = { x: m.width - margin - 56 / s, y: bottom - 56 / s, width: 56 / s, height: 56 / s };
  const skill = { x: attack.x - gap - 48 / s, y: bottom - 48 / s, width: 48 / s, height: 48 / s };
  return {
    buttons: {
      mobile_attack: attack,
      mobile_skill: skill,
      mobile_heal: { x: attack.x + 12 / s, y: attack.y - gap - 44 / s, width: 44 / s, height: 44 / s },
      mobile_wait: { x: skill.x + 4 / s, y: attack.y - gap - 44 / s, width: 44 / s, height: 44 / s },
    },
    actionLeft: skill.x,
  };
}

export class MobileControls {
  private captures = new Map<string, MobileAction>();
  private blocked = new Set<string>();

  reset(contacts: readonly RuneweaveTouchContact[] = []): void {
    this.captures.clear();
    this.blocked = new Set(contacts.map((contact) => contact.id));
  }

  sample(contacts: readonly RuneweaveTouchContact[], m: Metrics, size: Point, active: boolean): MobileFrame {
    const frame: MobileFrame = { consumed: false, actions: [], worldTap: null };
    const live = new Set(contacts.map((contact) => contact.id));
    for (const id of this.captures.keys()) if (!live.has(id)) this.captures.delete(id);
    for (const id of this.blocked) if (!live.has(id)) this.blocked.delete(id);
    if (!active) {
      for (const id of this.captures.keys()) this.blocked.add(id);
      this.captures.clear();
      frame.consumed = this.blocked.size > 0;
      return frame;
    }
    const layout = mobileLayout(m);
    for (const contact of contacts) {
      if (!contact.justPressed || this.blocked.has(contact.id) || this.captures.has(contact.id)) continue;
      const point = { x: (contact.x * size.x - m.left) / m.scale, y: (contact.y * size.y - m.top) / m.scale };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const capture = (Object.entries(layout.buttons) as [MobileAction, ControlRect][]).find(([, rect]) =>
        point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height)?.[0];
      if (capture) { this.captures.set(contact.id, capture); frame.actions.push(capture); }
      else frame.worldTap ??= contact;
    }
    // A secondary finger owns its own action. Rebuilding UI never transfers a
    // held contact to a replacement button or lets it become a ground click.
    frame.consumed = this.captures.size > 0 || this.blocked.size > 0;
    return frame;
  }
}
