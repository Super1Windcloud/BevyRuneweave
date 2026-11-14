import type { Layout } from "./controls.js";

/** Keep instruments above the two thumb zones on landscape phones. */
export function raceHudLayout(layout: Layout) {
  const mobile = !!layout.mobile, unit = Math.max(0.6, Math.min(1.5, layout.height / 720));
  const mapSize = Math.round((mobile ? 100 : 180) * (mobile ? Math.max(0.85, unit) : unit));
  const mapBottom = mobile ? layout.bottom + layout.radius * 2 + 24 : layout.bottom;
  const speedUnit = mobile ? 0.65 : unit;
  const speedBottom = mobile ? layout.bottom + layout.controlSize * 2 + 24 : layout.bottom;
  return { mapSize, mapBottom, speedUnit, speedBottom };
}
