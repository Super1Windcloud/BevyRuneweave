import type { Layout, TouchControls } from "./controls.js";
import { clamp, formatTime, type Race } from "./race.js";

const chinese = /^zh(?:[-_]|$)/i.test(app_locale());
export const tr = (en: string, zh: string): string => chinese ? zh : en;
const blue = [0.03, 0.07, 0.12, 0.9];
const labels = new Map<string, string>();
const buttons = new Map<string, () => void>();
export const style = (id: string, value: Record<string, unknown>): void => { ui_set_style(id, JSON.stringify(value)); };

function node(id: string, parent: string, value: Record<string, unknown>, kind: "node" | "button" = "node"): void {
  if (!ui_spawn(id, parent, kind)) throw new Error(`Cannot create UI ${id}`);
  style(id, value);
}
function label(id: string, parent: string, value: string, size = 18, valueStyle: Record<string, unknown> = {}): void {
  if (!ui_spawn(id, parent, "text")) throw new Error(`Cannot create text ${id}`);
  style(id, valueStyle);
  ui_set_text(id, value, size, 0.93, 0.96, 1, 1);
  ui_set_font(id, "fonts/wqy-microhei.ttf");
  labels.set(id, value);
}
function setLabel(id: string, value: string, size = 18): void {
  if (labels.get(id) === value) return;
  ui_set_text(id, value, size, 0.93, 0.96, 1, 1);
  labels.set(id, value);
}
function button(id: string, parent: string, value: string, valueStyle: Record<string, unknown>, action?: () => void): void {
  node(id, parent, { alignItems: "center", justifyContent: "center", borderRadius: 12, background: blue, ...valueStyle }, "button");
  label(`${id}-label`, id, value, 17);
  if (action) buttons.set(id, action);
}
export function readLayout(): Layout {
  const size = window_metrics();
  const safe = window_safe_area();
  const pointer = input_primary_pointer();
  const factor = size.height / Math.max(1, pointer.viewportHeight);
  const unit = clamp(size.height / 720, 0.65, 1.2);
  const layout = {
    width: size.width, height: size.height,
    left: Math.max(16, safe.leftInset * factor + 12), right: Math.max(16, safe.rightInset * factor + 12),
    top: Math.max(12, safe.topInset * factor + 10), bottom: Math.max(14, safe.bottomInset * factor + 12),
    stickX: 0, stickY: 0, radius: 60 * unit, controlSize: 64 * unit,
  };
  layout.stickX = layout.left + layout.radius + 12;
  layout.stickY = layout.height - layout.bottom - layout.radius - 12;
  return layout;
}
export function pollButtons(): void {
  for (const [id, action] of buttons) if (ui_button_just_pressed(id)) { action(); break; }
}
export function mountHud(race: Race, mode: string, best: number, layout: Layout, primary: () => void, pause: () => void): void {
  ui_clear(); labels.clear(); buttons.clear();
  const { left, right, top, bottom, radius, controlSize } = layout;
  node("root", "", { width: "100%", height: "100%", position: "absolute" });
  node("hud", "root", { position: "absolute", top, left, right: right + 95, padding: 12, borderRadius: 12, background: blue, flexDirection: "row", gap: 20, alignItems: "center" });
  label("brand", "hud", "STK CAR", 21);
  for (const id of ["lap", "rank", "speed", "time"]) label(id, "hud", "");
  button("pause", "root", tr("Pause", "暂停"), { position: "absolute", right, top, width: 84, height: 48 }, pause);
  label("leaderboard", "root", "", 15, { position: "absolute", left, top: top + 72 });
  node("nitro-bar", "root", { position: "absolute", left: "40%", bottom: bottom + 16, width: "20%", height: 10, borderRadius: 5, background: [0.1, 0.15, 0.2, 0.9] });
  node("nitro-fill", "nitro-bar", { width: "35%", height: "100%", background: [0.1, 0.8, 1, 1], borderRadius: 5 });
  label("nitro", "root", "", 16, { position: "absolute", left: "40%", bottom: bottom + 34 });
  label("status", "root", "", 18, { position: "absolute", left: "35%", top: "23%" });
  node("stick", "root", { position: "absolute", left: layout.stickX - radius, top: layout.stickY - radius, width: radius * 2, height: radius * 2, borderRadius: radius, background: [0.08, 0.16, 0.24, 0.65], alignItems: "center", justifyContent: "center" });
  label("stick-hint", "stick", tr("STEER", "转向"), 14);
  node("stick-thumb", "root", { position: "absolute", left: layout.stickX - radius * 0.32, top: layout.stickY - radius * 0.32, width: radius * 0.64, height: radius * 0.64, borderRadius: radius, background: [0.3, 0.8, 1, 0.65] });
  const gap = controlSize + 9;
  button("gas", "root", tr("GAS", "油门"), { position: "absolute", right, bottom: bottom + gap, width: controlSize, height: controlSize, background: [0.07, 0.48, 0.33, 0.85] });
  button("brake", "root", tr("BRAKE", "刹车"), { position: "absolute", right, bottom, width: controlSize, height: controlSize });
  button("boost", "root", tr("NITRO", "氮气"), { position: "absolute", right: right + gap, bottom: bottom + gap, width: controlSize, height: controlSize, background: [0.03, 0.35, 0.55, 0.9] });
  button("drift", "root", tr("DRIFT", "漂移"), { position: "absolute", right: right + gap, bottom, width: controlSize, height: controlSize });
  button("item", "root", tr("ITEM", "道具"), { position: "absolute", right: right + gap * 2, bottom: bottom + gap, width: controlSize, height: controlSize });
  button("rescue", "root", tr("RESET", "救援"), { position: "absolute", right: right + gap * 2, bottom, width: controlSize, height: controlSize });
  if (mode !== "race") {
    node("shade", "root", { position: "absolute", width: "100%", height: "100%", background: [0.01, 0.025, 0.05, 0.72], alignItems: "center", justifyContent: "center" });
    node("panel", "shade", { width: "76%", maxWidth: 690, padding: 22, gap: 12, flexDirection: "column", background: [0.025, 0.07, 0.12, 0.96], borderRadius: 18, alignItems: "center" });
    label("title", "panel", mode === "ready" ? "STK CAR" : mode === "paused" ? tr("Paused", "比赛暂停") : tr("Race finished", "比赛完成"), 30);
    label("subtitle", "panel", tr("Around the Lighthouse · 3 laps · 4 racers", "环绕灯塔 · 三圈竞速 · 四辆赛车"), 18);
    label("instructions", "panel", mode === "finished" ? `${tr("Position", "名次")} ${race.rank}/4    ${formatTime(race.elapsed)}\n${race.lapTimes.map((time, index) => `${index + 1}. ${formatTime(time)}`).join("    ")}`
      : tr("WASD / arrows: drive · Space: drift · Shift: nitro\nE: drop banana · R: rescue · P / Esc: pause\nTouch: hold steering pad to drive; combine with action buttons.", "WASD / 方向键驾驶 · 空格漂移 · Shift 氮气\nE 放置香蕉 · R 救援 · P / Esc 暂停\n触屏按住左侧摇杆驾驶，可同时按右侧技能按钮。"), 16);
    label("best", "panel", best > 0 ? `${tr("Best time", "最佳成绩")}: ${formatTime(best)}` : tr("Build drift charge, then release for a mini turbo.", "持续漂移后松开，触发短时加速。"), 16);
    button("primary", "panel", mode === "ready" ? tr("Start race", "开始比赛") : mode === "paused" ? tr("Resume", "继续比赛") : tr("Race again", "再来一局"), { width: 210, height: 48, background: [0.08, 0.5, 0.42, 1] }, primary);
    button("exit", "panel", tr("Return to launcher", "返回启动器"), { width: 210, height: 38 }, () => { app_request_exit(); });
  }
  updateHud(race);
}
export function updateStick(touch: TouchControls, layout: Layout): void {
  const radius = layout.radius * 0.32;
  style("stick-thumb", { left: layout.stickX + touch.dx * layout.radius * 0.7 - radius, top: layout.stickY + touch.dy * layout.radius * 0.7 - radius });
}
export function updateHud(race: Race): void {
  setLabel("lap", `${tr("LAP", "圈数")} ${Math.min(3, Math.floor(Math.max(0, race.player.progress) / race.circuit.length) + 1)}/3`);
  setLabel("rank", `${tr("POS", "排名")} ${race.rank}/4`);
  setLabel("speed", `${Math.round(Math.abs(race.player.speed) * 3.6)} km/h`);
  setLabel("time", formatTime(race.elapsed));
  setLabel("nitro", `${tr("NITRO", "氮气")} ${Math.floor(race.player.nitro)}%`, 16);
  setLabel("leaderboard", race.ranking.map((racer, index) => `${index + 1}  ${racer.id === "tux" ? tr("TUX · YOU", "TUX · 你") : racer.id.toUpperCase()}`).join("\n"), 15);
  setLabel("status", race.phase === "countdown" ? `${Math.max(1, Math.ceil(race.countdown))}` : race.player.offRoad > 0.3 ? tr("OFF ROAD", "驶离赛道") : race.player.driftCharge >= 0.8 ? tr("TURBO READY", "松开漂移加速") : race.player.stun > 0 ? tr("SLIPPING!", "打滑！") : "");
  setLabel("item-label", race.player.item ? tr("DROP", "放香蕉") : tr("ITEM", "道具"), 17);
  style("nitro-fill", { width: `${race.player.nitro}%` });
}
