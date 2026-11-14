import type { Layout, TouchControls } from "./controls.js";
import { clamp, formatTime, nitroCapacity } from "./race.js";
import type { PcSession } from "./session.js";
import { trackData } from "./track-data.js";
import type { FrameMetrics } from "./performance.js";
import { menuSound } from "./sound.js";

const chinese = /^zh(?:[-_]|$)/i.test(app_locale());
export const tr = (en: string, zh: string): string => chinese ? zh : en;
const labels = new Map<string, string>();
const buttons: { id: string; action: () => void; base: number[]; icon?: string; focusIcon?: string; hint?: string }[] = [];
const panel = [0.09, 0.055, 0.025, 0.86];
const cream = [1, 0.93, 0.7, 1];
let focus = 0;
let previousScreen = "";
let pointerPosition = "";
let focused: (id: string) => void = () => {};
let dimensions: Layout;
export const style = (id: string, value: Record<string, unknown>): void => { ui_set_style(id, JSON.stringify(value)); };
function node(id: string, parent: string, spec: Record<string, unknown>, kind: "node" | "button" = "node"): void {
  if (!ui_spawn(id, parent, kind)) throw new Error(`Cannot create UI ${id}`);
  style(id, spec);
}
function label(id: string, parent: string, value: string, size = 20, spec: Record<string, unknown> = {}, color = cream): void {
  if (!ui_spawn(id, parent, "text")) throw new Error(`Cannot create label ${id}`);
  style(id, spec); ui_set_text(id, value, size, color[0], color[1], color[2], color[3]); ui_set_font(id, chinese ? "fonts/wqy-microhei.ttf" : size >= 29 ? "fonts/SigmarOne.otf" : "fonts/Cantarell-Regular.otf"); labels.set(id, value);
}
function image(id: string, parent: string, path: string, spec: Record<string, unknown>): void {
  if (!ui_spawn(id, parent, "image") || !ui_set_image(id, path)) throw new Error(`Cannot create image ${id}`);
  style(id, spec);
}
function setLabel(id: string, value: string, size = 20): void {
  if (labels.get(id) === value) return;
  ui_set_text(id, value, size, cream[0], cream[1], cream[2], 1); labels.set(id, value);
}
function button(id: string, parent: string, value: string, action: () => void, spec: Record<string, unknown> = {}, icon?: string): void {
  node(id, parent, { background: panel, borderRadius: 12, padding: 12, gap: 8, flexDirection: icon && typeof spec.height === "number" && spec.height < 100 ? "row" : "column", alignItems: "center", justifyContent: "center", ...spec }, "button");
  if (icon) image(`${id}-icon`, id, icon, { width: typeof spec.height === "number" && spec.height < 100 ? 30 : 78, height: typeof spec.height === "number" && spec.height < 100 ? 30 : 78 });
  label(`${id}-label`, id, value, 20);
  buttons.push({ id, action, base: panel });
}
function mainIcon(id: string, parent: string, value: string, icon: string, action: () => void, size: number, small = false): void {
  node(id, parent, { width: small ? size : "18%", height: "100%", flexDirection: "column", alignItems: "center", gap: 2, background: [0, 0, 0, 0] }, "button");
  image(`${id}-icon`, id, `ui/${icon}.png`, { width: size, height: size, flexShrink: 0 });
  if (!small) label(`${id}-label`, id, value, 21, { height: 50 }, [0, 0, 0, 1]);
  buttons.push({ id, action, base: [0, 0, 0, 0], icon: `ui/${icon}.png`, focusIcon: small ? undefined : `ui/${icon}_focus.png`, hint: small ? value : undefined });
}
function mountMainMenu(session: PcSession, act: (action: () => void) => () => void, layout: Layout): void {
  const unit = clamp(layout.height / 720, 0.5, 1.5), settings = session.settings;
  image("logo", "root", "ui/logo.png", { position: "absolute", left: "33%", top: "0%", width: "34%", height: "44%" });
  const unavailable = (name: string, details: string) => act(() => session.notice(name, details));
  const localOnly = tr("This PC edition currently supports singleplayer racing. This original menu entry is not implemented yet.", "当前 PC 版本支持单人竞速，此原版菜单功能尚未实现。");
  node("main-cards", "root", { position: "absolute", top: "51%", left: "5%", width: "90%", height: "31%", justifyContent: "space-between", flexDirection: "row" });
  const size = Math.min(layout.width * 0.127, 166 * unit);
  mainIcon("story", "main-cards", tr("Story Mode", "故事模式"), "menu_story", unavailable(tr("Story Mode", "故事模式"), localOnly), size);
  mainIcon("singleplayer", "main-cards", tr("Singleplayer", "单人游戏"), "menu_race", act(() => { settings.mode = "normal"; session.screen = "kart"; }), size);
  mainIcon("multiplayer", "main-cards", tr("Splitscreen Multiplayer", "分屏多人游戏"), "menu_multi", unavailable(tr("Splitscreen Multiplayer", "分屏多人游戏"), localOnly), size);
  mainIcon("online", "main-cards", tr("Online", "在线"), "menu_online", unavailable(tr("Online", "在线"), localOnly), size);
  mainIcon("addons", "main-cards", tr("Addons", "附加组件"), "menu_addons", unavailable(tr("Addons", "附加组件"), localOnly), size);
  focus = 1;
  node("profile", "root", { position: "absolute", top: 2, right: 2, width: "27%", height: 30 * unit, alignItems: "center", justifyContent: "center" });
  image("profile-background", "profile", "ui/profile.png", { position: "absolute", width: "100%", height: "100%", imageMode: "stretch" });
  label("profile-name", "profile", tr("Player", "玩家"), 21, {}, [0, 0, 0, 1]);
  image("bottom-bar", "root", "ui/bottom_bar.png", { position: "absolute", bottom: 0, width: "100%", height: "8.5%", imageMode: "stretch" });
  label("news", "root", tr("SuperTuxKart · PC Singleplayer", "SuperTuxKart · PC 单人竞速"), 18, { position: "absolute", bottom: "2%", left: "20%" }, [0, 0, 0, 1]);
  node("main-bottom", "root", { position: "absolute", bottom: 0, right: "1%", width: "42%", height: "8%", flexDirection: "row", justifyContent: "space-between" });
  const tools: [string, string, string, () => void][] = [
    ["options", tr("Options", "选项"), "main_options", act(() => session.open("options"))],
    ["help", tr("Help", "帮助"), "main_help", act(() => session.open("help"))],
    ["tutorial", tr("Tutorial", "教程"), "tutorial", act(() => session.open("help"))],
    ["highscores", tr("High Scores", "最高成绩"), "crown", act(() => { session.screen = "track-info"; })],
    ["achievements", tr("Achievements", "成就"), "gp_copy", unavailable(tr("Achievements", "成就"), localOnly)],
    ["gpeditor", tr("Grand Prix Editor", "大奖赛编辑器"), "gpeditor", unavailable(tr("Grand Prix Editor", "大奖赛编辑器"), localOnly)],
    ["about", tr("About", "关于"), "main_about", unavailable(tr("About", "关于"), tr("STK Car uses original SuperTuxKart artwork, music and sound effects. Credits and licenses are included with the game package.", "STK Car 使用 SuperTuxKart 原版美术、音乐和音效，作者与许可证随游戏资源包提供。"))],
    ["quit", tr("Quit", "退出"), "main_quit", () => { app_request_exit(); }],
  ];
  for (const [id, name, icon, action] of tools) mainIcon(id, "main-bottom", name, icon, action, Math.min(layout.width * 0.047, 54 * unit), true);
  label("tool-tip", "root", "", 18, { position: "absolute", bottom: "9%", right: "1%", background: [1, 0.93, 0.7, 0.95], padding: 6, display: "none" }, [0, 0, 0, 1]);
}
function heading(title: string, subtitle: string): void {
  label("title", "root", title, 38, { position: "absolute", top: "4%", left: "16%" });
  label("subtitle", "root", subtitle, 18, { position: "absolute", top: "13%", left: "16%" });
}
function centeredPanel(id: string, spec: Record<string, unknown> = {}): void {
  node(id, "root", { position: "absolute", left: "14%", top: "23%", width: "72%", height: "62%", padding: 22, gap: 16, background: panel, borderRadius: 18, flexDirection: "column", ...spec });
}
function highlight(): void {
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    if (button.icon) ui_set_image(`${button.id}-icon`, i === focus ? button.focusIcon ?? button.icon : button.icon);
    else style(button.id, { background: i === focus ? [0.52, 0.3, 0.045, 0.95] : button.base });
  }
  if (labels.has("tool-tip")) {
    const hint = buttons[focus]?.hint;
    style("tool-tip", { display: hint ? "flex" : "none" });
    if (hint) { ui_set_text("tool-tip", hint, 18, 0, 0, 0, 1); labels.set("tool-tip", hint); }
  }
}
export function pollButtons(): void {
  if (!buttons.length) return;
  const pointer = input_primary_pointer(), position = `${pointer.x}:${pointer.y}`;
  if (position !== pointerPosition) {
    pointerPosition = position;
    const hovered = buttons.findIndex((button) => ui_button_hovered(button.id));
    if (hovered >= 0 && hovered !== focus) { focus = hovered; highlight(); menuSound("plopp"); focused(buttons[focus].id); }
  }
  for (let i = 0; i < buttons.length; i++) if (ui_button_just_pressed(buttons[i].id)) { focus = i; menuSound("appear"); buttons[i].action(); return; }
  const previous = input_key_just_pressed("ArrowLeft") || input_key_just_pressed("ArrowUp");
  const next = input_key_just_pressed("ArrowRight") || input_key_just_pressed("ArrowDown") || input_key_just_pressed("Tab");
  if (buttons.length && (previous || next)) { focus = (focus + (previous ? -1 : 1) + buttons.length) % buttons.length; highlight(); menuSound("plopp"); focused(buttons[focus].id); }
  if (input_key_just_pressed("Enter")) { menuSound("appear"); buttons[focus]?.action(); }
}
export function readLayout(): Layout {
  const size = window_metrics(), safe = window_safe_area(), pointer = input_primary_pointer();
  const factor = size.height / Math.max(1, pointer.viewportHeight), unit = clamp(size.height / 720, 0.65, 1.2);
  const layout = { width: size.width, height: size.height, left: Math.max(16, safe.leftInset * factor + 12), right: Math.max(16, safe.rightInset * factor + 12),
    top: Math.max(12, safe.topInset * factor + 10), bottom: Math.max(14, safe.bottomInset * factor + 12), stickX: 0, stickY: 0, radius: 60 * unit, controlSize: 64 * unit };
  layout.stickX = layout.left + layout.radius + 12; layout.stickY = layout.height - layout.bottom - layout.radius - 12;
  return layout;
}
export function mountHud(session: PcSession, layout: Layout, changed: () => void, start: () => void, mobile = false, focusChanged: (id: string) => void = () => {}): void {
  const focusedId = previousScreen === session.screen ? buttons[focus]?.id : undefined;
  ui_clear(); labels.clear(); buttons.length = 0; focus = 0; dimensions = layout;
  focused = focusChanged;
  const settings = session.settings, screen = session.screen;
  node("root", "", { width: "100%", height: "100%", position: "absolute" });
  const act = (action: () => void) => () => { action(); changed(); };
  const back = act(() => session.back());
  const racing = screen === "race" || screen === "paused" || screen === "finished" || (screen === "options" || screen === "help") && session.returnScreen === "paused";
  if (!racing && screen !== "kart") {
    image("menu-background", "root", "ui/background.jpg", { position: "absolute", width: "100%", height: "100%", imageMode: "stretch" });
  } else mountRaceHud(session, layout, mobile, changed);
  if (screen === "race") { performanceLabel(); updateHud(session); return; }
  if (racing) node("shade", "root", { position: "absolute", width: "100%", height: "100%", background: [0, 0.01, 0.02, 0.65] });
  if (screen === "main") {
    mountMainMenu(session, act, layout);
  } else if (screen === "kart") {
    heading(tr("Choose a Kart", "选择赛车"), tr("Arrows: select · Enter: confirm · Esc: back", "方向键选择 · Enter 确认 · Esc 返回"));
    centeredPanel("kart-panel", { flexDirection: "row", alignItems: "center", justifyContent: "space-between", top: "65%", height: "29%", padding: 12 });
    for (const kart of trackData.karts) button(`choose-${kart.id}`, "kart-panel", `${kart.name}\n${kart.type === "heavy" ? tr("Heavy", "重型") : kart.type === "light" ? tr("Light", "轻型") : tr("Medium", "中型")}`,
      act(() => { settings.kartId = kart.id; session.screen = "setup"; }), { width: "23%", height: "100%" }, kart.icon);
    focus = Math.max(0, trackData.karts.findIndex((kart) => kart.id === settings.kartId));
  } else if (screen === "setup") {
    heading(tr("Race Setup", "比赛设置"), tr("Select a difficulty and a game mode", "选择难度和比赛模式"));
    centeredPanel("setup-panel");
    node("difficulties", "setup-panel", { width: "100%", flexDirection: "row", gap: 16, justifyContent: "space-between" });
    const names = [tr("Novice", "新手"), tr("Intermediate", "中级"), tr("Expert", "专家"), "SuperTux"];
    for (let i = 0; i < 4; i++) button(`difficulty-${i}`, "difficulties", `${settings.difficulty === i ? "✓ " : ""}${names[i]}`, act(() => { settings.difficulty = i; }), { width: "23%", height: 130 }, `ui/difficulty_${["easy", "medium", "hard", "best"][i]}.png`);
    node("modes", "setup-panel", { flexDirection: "row", width: "100%", gap: 16, justifyContent: "center" });
    for (const mode of ["normal", "time-trial"] as const) button(`mode-${mode}`, "modes", `${settings.mode === mode ? "✓ " : ""}${mode === "normal" ? tr("Normal Race", "普通竞速") : tr("Time Trial", "计时赛")}`,
      act(() => { settings.mode = mode; }), { width: "40%", height: 125 }, `ui/${mode === "normal" ? "mode_normal" : "mode_tt"}.png`);
    button("continue", "setup-panel", tr("Continue", "继续"), act(() => { session.screen = "tracks"; }), { height: 44 });
    focus = buttons.length - 1;
  } else if (screen === "tracks") {
    heading(tr("Choose a Track", "选择赛道"), tr("Standard tracks", "标准赛道"));
    centeredPanel("tracks-panel", { alignItems: "center" });
    image("track-preview", "tracks-panel", "branding/lighthouse.jpg", { width: "70%", height: "66%" });
    button("choose-lighthouse", "tracks-panel", tr("Around the Lighthouse", "环绕灯塔"), act(() => { session.screen = "track-info"; }), { width: "70%", height: 54 });
  } else if (screen === "track-info") {
    heading(tr("Around the Lighthouse", "环绕灯塔"), tr("Jean-Manuel Clémençon · Original STK track", "Jean-Manuel Clémençon · STK 原版赛道"));
    centeredPanel("track-options", { flexDirection: "row", gap: 24 });
    node("race-settings", "track-options", { width: "52%", gap: 12, flexDirection: "column" });
    label("best", "race-settings", session.best > 0 ? `${tr("Best time", "最佳成绩")}  ${formatTime(session.best)}` : tr("No high score yet", "暂无最高成绩"), 20);
    node("lap-controls", "race-settings", { flexDirection: "row", gap: 16, alignItems: "center" });
    button("fewer-laps", "lap-controls", "−", act(() => { settings.laps = Math.max(1, settings.laps - 1); }), { width: 50, height: 44 });
    label("lap-count", "lap-controls", `${tr("Laps", "圈数")}  ${settings.laps}`, 21);
    button("more-laps", "lap-controls", "+", act(() => { settings.laps = Math.min(20, settings.laps + 1); }), { width: 50, height: 44 });
    if (settings.mode === "normal") button("ai-count", "race-settings", `${tr("AI karts", "AI 赛车")}  ${settings.aiCount}  ›`, act(() => { settings.aiCount = (settings.aiCount + 1) % 4; }), { height: 44 });
    button("reverse", "race-settings", `${settings.reverse ? "☑" : "☐"} ${tr("Reverse track", "反向赛道")}`, act(() => { settings.reverse = !settings.reverse; }), { height: 44 });
    button("start-race", "race-settings", tr("Start Race", "开始比赛"), start, { height: 64 }, "ui/green_check.png");
    image("track-picture", "track-options", "branding/lighthouse.jpg", { width: "44%", height: "74%" });
    focus = buttons.length - 1;
  } else if (screen === "paused") {
    heading(tr("Paused", "已暂停"), tr("Race clock is stopped", "比赛计时已暂停"));
    centeredPanel("pause-panel", { flexDirection: "row", alignItems: "center", height: "50%", top: "30%", justifyContent: "space-between" });
    button("resume", "pause-panel", tr("Resume Race", "继续比赛"), act(() => { session.screen = "race"; }), { width: "24%" }, "ui/back.png");
    button("restart-race", "pause-panel", tr("Restart Race", "重新比赛"), start, { width: "24%" }, "ui/restart.png");
    button("new-race", "pause-panel", tr("New Race", "新的比赛"), act(() => { session.screen = "kart"; }), { width: "24%" }, "ui/menu_race.png");
    button("leave-race", "pause-panel", tr("Exit to Menu", "返回主菜单"), act(() => { session.screen = "main"; }), { width: "24%" }, "ui/main_quit.png");
  } else if (screen === "finished") {
    heading(tr("Race Results", "比赛结果"), tr("Position · Kart · Time", "名次 · 赛车 · 时间"));
    centeredPanel("results-panel");
    for (const [index, racer] of session.race.ranking.entries()) {
      const name = trackData.karts.find((kart) => kart.id === racer.kartId)?.name ?? racer.kartId;
      label(`result-${index}`, "results-panel", `${index + 1}.  ${name}${racer === session.race.player ? tr(" (You)", "（你）") : ""}    ${racer.finishedAt === null ? tr("Racing", "比赛中") : formatTime(racer.finishedAt)}`, 23);
    }
    label("lap-splits", "results-panel", session.race.lapTimes.map((time, index) => `${tr("Lap", "圈")} ${index + 1}: ${formatTime(time)}`).join("    "), 18);
    node("result-actions", "results-panel", { flexDirection: "row", gap: 20 });
    button("race-again", "result-actions", tr("Race Again", "再来一局"), start, { height: 54 });
    button("choose-new-race", "result-actions", tr("New Race", "新的比赛"), act(() => { session.screen = "kart"; }), { height: 54 });
    button("result-menu", "result-actions", tr("Main Menu", "主菜单"), act(() => { session.screen = "main"; }), { height: 54 });
  } else if (screen === "options") {
    heading(tr("Options", "选项"), tr("Audio and keyboard controls", "声音和键盘操作")); centeredPanel("options-panel", { gap: 12 });
    for (const [key, name] of [["musicVolume", tr("Music", "背景音乐")], ["sfxVolume", tr("Sound effects", "音效")]] as const) {
      node(key, "options-panel", { flexDirection: "row", alignItems: "center", gap: 18 });
      label(`${key}-label`, key, `${name}  ${Math.round(settings[key] * 100)}%`, 22, { width: 240 });
      button(`${key}-down`, key, "−", act(() => { settings[key] = clamp(Math.round((settings[key] - 0.1) * 10) / 10, 0, 1); }), { width: 54 });
      button(`${key}-up`, key, "+", act(() => { settings[key] = clamp(Math.round((settings[key] + 0.1) * 10) / 10, 0, 1); }), { width: 54 });
      button(`${key}-mute`, key, settings[key] ? tr("Mute", "静音") : tr("Enable", "开启"), act(() => { settings[key] = settings[key] ? 0 : 0.6; }), { width: 110 });
    }
    button("wasd", "options-panel", `${settings.wasd ? "☑" : "☐"} ${tr("Also use WASD to drive", "同时使用 WASD 驾驶")}`, act(() => { settings.wasd = !settings.wasd; }), { height: 54 });
    label("bindings", "options-panel", controlsText(), 20);
    button("options-done", "options-panel", tr("Done", "完成"), back, { height: 48 });
  } else if (screen === "notice") {
    heading(session.noticeTitle, ""); centeredPanel("notice-panel");
    label("notice-text", "notice-panel", session.noticeText, 22);
    button("notice-done", "notice-panel", tr("Back", "返回"), back, { height: 48 });
  } else {
    heading(tr("Help", "帮助"), tr("Driving and racing", "驾驶与比赛")); centeredPanel("help-panel");
    label("help-controls", "help-panel", controlsText(), 20);
    label("help-rules", "help-panel", tr("Wait for GO before accelerating.\nCollect nitro bottles; hold N to boost. Drift with V, then release for a turbo.\nTime Trial: no AI or bonus boxes; one zipper per lap. Esc pauses.", "等待“开始”后再加速。\n拾取氮气瓶后按住 N 加速；按住 V 漂移，松开触发加速。\n计时赛没有 AI 和礼盒，按圈数配给加速道具；Esc 暂停。"), 20);
    button("help-done", "help-panel", tr("Back", "返回"), back, { height: 48 });
  }
  if (!["main", "paused", "finished"].includes(screen)) button("back", "root", tr("Back", "返回"), back, { position: "absolute", left: 18, top: 18, width: 110, height: 60 });
  if (focusedId) { const index = buttons.findIndex((button) => button.id === focusedId); if (index >= 0) focus = index; }
  previousScreen = screen; highlight(); performanceLabel();
}
function performanceLabel(): void {
  label("performance", "root", "", 14, { position: "absolute", left: "40%", bottom: 6, display: "none", background: [0, 0, 0, 0.65] });
}
export function updatePerformance(metrics: FrameMetrics | null, visible: boolean): void {
  style("performance", { display: visible && metrics ? "flex" : "none" });
  if (metrics) setLabel("performance", `FPS ${metrics.fps.toFixed(1)}  |  ${tr("Script", "脚本")} ${metrics.scriptMeanMs.toFixed(1)} ms  |  P95 ${metrics.frameP95Ms.toFixed(0)} ms  [F3]`, 14);
}
function controlsText(): string {
  return tr("↑ Accelerate  ↓ Brake / Reverse  ← → Steer\nN Nitro   V Drift   Space Fire   Backspace Rescue   B Look Back\nMenu: Arrows / Tab select · Enter confirm · Esc back", "↑ 加速  ↓ 刹车 / 倒车  ← → 转向\nN 氮气   V 漂移   空格发射   Backspace 救援   B 回看\n菜单：方向键 / Tab 选择 · Enter 确认 · Esc 返回");
}
function mountRaceHud(session: PcSession, layout: Layout, mobile: boolean, changed: () => void): void {
  const unit = clamp(layout.height / 720, 0.6, 1.5);
  const mapSize = Math.round(180 * unit);
  label("time", "root", "", 25, { position: "absolute", top: layout.top, left: "45%" });
  image("lap-flag", "root", "ui/lap_flag.png", { position: "absolute", top: layout.top, right: layout.right + 115, width: 42, height: 42 });
  label("lap", "root", "", 30, { position: "absolute", top: layout.top + 3, right: layout.right });
  label("status", "root", "", 48, { position: "absolute", top: "30%", left: "43%" });
  image("item-icon", "root", "ui/power.png", { position: "absolute", top: layout.top, left: "34%", width: 48, height: 48 });
  label("item-hint", "root", "", 16, { position: "absolute", top: layout.top + 50, left: "32%" });
  node("positions", "root", { position: "absolute", top: layout.top + 12, left: layout.left, flexDirection: "column", gap: 8 });
  for (let i = 0; i < session.race.racers.length; i++) {
    node(`position-${i}`, "positions", { flexDirection: "row", alignItems: "center", gap: 8, padding: 5, borderRadius: 10, background: [0, 0.01, 0.02, 0.5] });
    label(`position-number-${i}`, `position-${i}`, `${i + 1}`, 23);
    image(`position-icon-${i}`, `position-${i}`, trackData.karts[0].icon, { width: 36, height: 36 });
    label(`position-name-${i}`, `position-${i}`, "", 17);
  }
  image("map", "root", "ui/minimap.png", { position: "absolute", left: layout.left, bottom: layout.bottom, width: mapSize, height: mapSize });
  for (const racer of session.race.racers) image(`map-${racer.id}`, "root", trackData.karts.find((kart) => kart.id === racer.kartId)!.icon, { position: "absolute", width: racer === session.race.player ? 22 : 16, height: racer === session.race.player ? 22 : 16 });
  image("speed-meter", "root", "ui/speedback.png", { position: "absolute", right: layout.right + 28, bottom: layout.bottom, width: 145 * unit, height: 145 * unit });
  label("speed", "root", "", 29, { position: "absolute", right: layout.right + 57 * unit, bottom: layout.bottom + 52 * unit });
  label("speed-unit", "root", "km/h", 14, { position: "absolute", right: layout.right + 60 * unit, bottom: layout.bottom + 30 * unit });
  image("nitro-bottle", "root", "ui/nitro.png", { position: "absolute", right: layout.right + 5, bottom: layout.bottom + 13, width: 29 * unit, height: 40 * unit });
  node("nitro-bar", "root", { position: "absolute", right: layout.right + 5, bottom: layout.bottom + 62 * unit, width: 16 * unit, height: 90 * unit, background: [0, 0.03, 0.06, 0.8], borderRadius: 6 });
  node("nitro-fill", "nitro-bar", { position: "absolute", bottom: 0, width: "100%", height: "0%", background: [0.2, 0.75, 1, 1], borderRadius: 6 });
  if (mobile) {
    node("stick", "root", { position: "absolute", left: layout.stickX - layout.radius, top: layout.stickY - layout.radius, width: layout.radius * 2, height: layout.radius * 2, borderRadius: layout.radius, background: [0, 0.1, 0.2, 0.6] });
    node("stick-thumb", "root", { position: "absolute", width: layout.radius * 0.64, height: layout.radius * 0.64, borderRadius: layout.radius, background: [0.2, 0.8, 1, 0.8] });
    for (const [id, name] of [["gas", "↑"], ["brake", "↓"], ["boost", "N"], ["drift", "V"], ["item", "Space"], ["rescue", "↶"]]) {
      const index = ["gas", "brake", "boost", "drift", "item", "rescue"].indexOf(id), size = layout.controlSize, gap = size + 9;
      button(id, "root", name, () => {}, { position: "absolute", right: layout.right + Math.floor(index / 2) * gap, bottom: layout.bottom + (1 - index % 2) * gap, width: size, height: size, padding: 0 });
    }
    button("pause", "root", "Ⅱ", () => { session.screen = "paused"; changed(); }, { position: "absolute", right: layout.right, top: layout.top + 60, width: 50, height: 44 });
  }
}
export function updateStick(touch: TouchControls, layout: Layout): void {
  const radius = layout.radius * 0.32;
  style("stick-thumb", { left: layout.stickX + touch.dx * layout.radius * 0.7 - radius, top: layout.stickY + touch.dy * layout.radius * 0.7 - radius });
}
export function updateHud(session: PcSession): void {
  const race = session.race, player = race.player;
  setLabel("lap", `${Math.min(race.laps, Math.floor(Math.max(0, player.progress) / race.circuit.length) + 1)} / ${race.laps}`, 30);
  setLabel("time", formatTime(race.elapsed), 25);
  setLabel("speed", `${Math.round(Math.abs(player.speed) * 3.6)}`, 29);
  setLabel("status", race.phase === "countdown" ? race.countdown > 1.5 ? tr("Ready!", "预备！") : tr("Set!", "准备！")
    : player.falseStart && race.elapsed < 1 ? tr("False start!", "抢跑！") : player.offRoad > 0.3 ? tr("Off Road", "驶离赛道") : player.driftCharge >= 1 ? tr("Turbo Ready", "加速就绪") : race.elapsed < 1 ? tr("GO!", "开始！") : "", 48);
  setLabel("item-hint", player.zipperCount > 0 ? `${tr("Space: zipper", "空格：加速")} ×${player.zipperCount}` : player.item ? tr("Space: drop banana", "空格：放置香蕉") : "", 16);
  style("item-icon", { display: player.item || player.zipperCount > 0 ? "flex" : "none" });
  const itemPath = player.zipperCount > 0 ? "ui/zipper_collect.png" : "ui/banana.png";
  if (labels.get("item-icon") !== itemPath) { ui_set_image("item-icon", itemPath); labels.set("item-icon", itemPath); }
  style("nitro-fill", { height: `${player.nitro / nitroCapacity * 100}%` });
  const ranking = race.ranking;
  for (let i = 0; i < ranking.length; i++) {
    const kart = trackData.karts.find((kart) => kart.id === ranking[i].kartId)!;
    setLabel(`position-name-${i}`, `${kart.name}${ranking[i] === player ? tr(" · You", " · 你") : ""}`, 17);
    const key = `position-icon-${i}`;
    if (labels.get(key) !== kart.icon) { ui_set_image(key, kart.icon); labels.set(key, kart.icon); }
  }
  const size = Math.round(180 * clamp(dimensions.height / 720, 0.6, 1.5));
  for (const racer of race.racers) {
    const iconSize = racer === player ? 22 : 16;
    const left = dimensions.left + (racer.x - trackData.minimap.minX) / trackData.minimap.size * size - iconSize / 2;
    const bottom = dimensions.bottom + (1 - (racer.z - trackData.minimap.minZ) / trackData.minimap.size) * size - iconSize / 2;
    style(`map-${racer.id}`, { left, bottom });
  }
}
