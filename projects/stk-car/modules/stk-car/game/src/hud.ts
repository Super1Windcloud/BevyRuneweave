import { makeLayout, touchControlRects, type Layout, type TouchControls } from "./controls.js";
import { clamp, formatTime, nitroCapacity } from "./race.js";
import type { PcSession } from "./session.js";
import { trackData } from "./track-data.js";
import type { FrameMetrics } from "./performance.js";
import { menuSound } from "./sound.js";
import { isChinese, tr } from "./localization.js";
import { mountSourceMenu, type MenuButton, type MenuHost } from "./menu-view.js";
import { pollMenuText } from "./menu-actions.js";
import { raceHudLayout } from "./hud-layout.js";

export { tr } from "./localization.js";
const labels = new Map<string, string>();
const buttons: (MenuButton & { icon?: string; focusIcon?: string })[] = [];
const panel = [0.09, 0.055, 0.025, 0.86];
const cream = [1, 0.93, 0.7, 1];
let focus = 0;
let previousScreen = "";
let pointerPosition = "";
let focused: (id: string) => void = () => {};
let dimensions: Layout;
let menuSession: PcSession;
let menuChanged = () => {};
export const style = (id: string, value: Record<string, unknown>): void => { ui_set_style(id, JSON.stringify(value)); };
function node(id: string, parent: string, spec: Record<string, unknown>, kind: "node" | "button" = "node"): void {
  if (!ui_spawn(id, parent, kind)) throw new Error(`Cannot create UI ${id}`);
  style(id, spec);
}
function label(id: string, parent: string, value: string, size = 20, spec: Record<string, unknown> = {}, color = cream): void {
  if (!ui_spawn(id, parent, "text")) throw new Error(`Cannot create label ${id}`);
  style(id, spec); ui_set_text(id, value, size, color[0], color[1], color[2], color[3]); ui_set_font(id, isChinese() ? "fonts/wqy-microhei.ttf" : size >= 29 ? "fonts/SigmarOne.otf" : "fonts/Cantarell-Regular.otf"); labels.set(id, value);
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
  if (!small) label(`${id}-label`, id, value, dimensions.mobile ? 16 : 21, { height: dimensions.mobile ? 42 : 50 }, [0, 0, 0, 1]);
  buttons.push({ id, action, base: [0, 0, 0, 0], icon: `ui/${icon}.png`, focusIcon: small ? undefined : `ui/${icon}_focus.png`, hint: small ? value : undefined });
}
function mountMainMenu(session: PcSession, act: (action: () => void) => () => void, layout: Layout): void {
  const parent = "main-surface";
  node(parent, "root", { position: "absolute", left: layout.mobile ? layout.left : 0, top: layout.mobile ? layout.top : 0, width: layout.mobile ? layout.width - layout.left - layout.right : layout.width, height: layout.mobile ? layout.height - layout.top - layout.bottom : layout.height });
  const unit = clamp(layout.height / 720, 0.5, 1.5);
  const open = (page: string) => act(() => session.openMenu(page));
  const chooseKarts = (players: number) => act(() => { session.menu.players = players; session.menu.raceMode = "normal"; session.settings.mode = "normal"; session.openMenu("karts", "kart"); if (players > 1) session.menu.popup("splitscreen_player_dialog", tr("Splitscreen Multiplayer", "分屏多人游戏"), "splitscreen"); });
  image("logo", parent, "ui/logo.png", { position: "absolute", left: "33%", top: "0%", width: "34%", height: "44%" });
  node("main-cards", parent, { position: "absolute", top: "51%", left: "5%", width: "90%", height: "31%", justifyContent: "space-between", flexDirection: "row" });
  const size = Math.min(layout.width * 0.127, 166 * unit);
  mainIcon("story", "main-cards", tr("Story Mode", "故事模式"), "menu_story", open("story"), size);
  mainIcon("singleplayer", "main-cards", tr("Singleplayer", "单人游戏"), "menu_race", chooseKarts(1), size);
  mainIcon("multiplayer", "main-cards", tr("Splitscreen Multiplayer", "分屏多人游戏"), "menu_multi", chooseKarts(2), size);
  mainIcon("online", "main-cards", tr("Online", "在线"), "menu_online", open("online"), size);
  mainIcon("addons", "main-cards", tr("Addons", "附加组件"), "menu_addons", open("addons_screen"), size);
  focus = 1;
  node("profile", parent, { position: "absolute", top: 2, right: 2, width: "27%", height: 30 * unit, alignItems: "center", justifyContent: "center" }, "button");
  buttons.push({ id: "profile", action: open("user_screen"), base: [0, 0, 0, 0] });
  image("profile-background", "profile", "ui/profile.png", { position: "absolute", width: "100%", height: "100%", imageMode: "stretch" });
  label("profile-name", "profile", session.menu.profiles[session.menu.player] === "Player" ? tr("Player", "玩家") : session.menu.profiles[session.menu.player], 21, {}, [0, 0, 0, 1]);
  image("bottom-bar", parent, "ui/bottom_bar.png", { position: "absolute", bottom: 0, width: "100%", height: "8.5%", imageMode: "stretch" });
  label("news", parent, layout.mobile ? "SuperTuxKart" : tr("SuperTuxKart · PC Singleplayer", "SuperTuxKart · PC 单人竞速"), 18, { position: "absolute", bottom: "2%", left: layout.mobile ? "1%" : "20%" }, [0, 0, 0, 1]);
  node("main-bottom", parent, { position: "absolute", bottom: 0, right: "1%", width: layout.mobile ? "60%" : "42%", height: layout.mobile ? 48 : "8%", flexDirection: "row", justifyContent: "space-between" });
  const tools: [string, string, string, () => void][] = [
    ["options", tr("Options", "选项"), "main_options", act(() => session.open("options"))],
    ["help", tr("Help", "帮助"), "main_help", act(() => session.open("help"))],
    ["tutorial", tr("Tutorial", "教程"), "tutorial", act(() => session.open("help"))],
    ["highscores", tr("High Scores", "最高成绩"), "crown", open("high_score_selection")],
    ["achievements", tr("Achievements", "成就"), "gp_copy", open("profile_achievements")],
    ["gpeditor", tr("Grand Prix Editor", "大奖赛编辑器"), "gpeditor", open("grand_prix_editor")],
    ["about", tr("About", "关于"), "main_about", open("credits")],
    ["quit", tr("Quit", "退出"), "main_quit", act(() => session.menu.popup("confirm_dialog", tr("Quit SuperTuxKart?", "退出 SuperTuxKart？"), "quit"))],
  ];
  for (const [id, name, icon, action] of tools) mainIcon(id, "main-bottom", name, icon, action, layout.mobile ? 44 : Math.min(layout.width * 0.047, 54 * unit), true);
  label("tool-tip", parent, "", 18, { position: "absolute", bottom: "9%", right: "1%", background: [1, 0.93, 0.7, 0.95], padding: 6, display: "none" }, [0, 0, 0, 1]);
}
function heading(title: string, subtitle: string): void {
  label("title", "root", title, dimensions.mobile ? 26 : 38, { position: "absolute", top: dimensions.top, left: "16%" });
  label("subtitle", "root", subtitle, dimensions.mobile ? 16 : 18, { position: "absolute", top: dimensions.top + (dimensions.mobile ? 34 : 58), left: "16%" });
}
function centeredPanel(id: string, spec: Record<string, unknown> = {}): void {
  node(id, "root", { position: "absolute", left: "14%", top: "23%", width: "72%", height: "62%", padding: 22, gap: 16, background: panel, borderRadius: 18, flexDirection: "column", ...spec });
}
function highlight(): void {
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    if (button.face) {
      const active = i === focus || button.face.selected;
      ui_set_image(button.face.id, active ? button.face.focused || button.face.normal : button.face.normal);
      if (button.caption) { const c = button.caption; ui_set_text(c.id, c.text, c.size, active ? 1 : 0, active ? 1 : 0, active ? 1 : 0, 1); }
    } else if (button.icon) ui_set_image(`${button.id}-icon`, i === focus ? button.focusIcon ?? button.icon : button.icon);
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
  if (pollMenuText(menuSession, menuChanged)) return;
  const previous = input_key_just_pressed("ArrowLeft") || input_key_just_pressed("ArrowUp");
  const next = input_key_just_pressed("ArrowRight") || input_key_just_pressed("ArrowDown") || input_key_just_pressed("Tab");
  if (buttons.length && (previous || next)) { focus = (focus + (previous ? -1 : 1) + buttons.length) % buttons.length; highlight(); menuSound("plopp"); focused(buttons[focus].id); }
  if (input_key_just_pressed("Enter")) { menuSound("appear"); buttons[focus]?.action(); }
}
export function readLayout(mobile = false): Layout {
  const size = window_metrics(), safe = window_safe_area(), pointer = input_primary_pointer();
  const factor = size.height / Math.max(1, pointer.viewportHeight);
  return makeLayout(size.width, size.height, { left: safe.leftInset * factor, right: safe.rightInset * factor, top: safe.topInset * factor, bottom: safe.bottomInset * factor }, mobile);
}
export function mountHud(session: PcSession, layout: Layout, changed: () => void, start: () => void, mobile = false, focusChanged: (id: string) => void = () => {}): void {
  const screenKey = `${session.screen}:${session.menu.page}:${session.menu.dialog?.page ?? ""}`;
  const focusedId = previousScreen === screenKey ? buttons[focus]?.id : undefined;
  ui_clear(); labels.clear(); buttons.length = 0; focus = 0; dimensions = layout;
  focused = focusChanged;
  menuSession = session; menuChanged = changed;
  const screen = session.screen;
  let preferredFocus = "";
  const host: MenuHost = { register: (button) => buttons.push(button), modal: () => { buttons.length = 0; focus = 0; preferredFocus = ""; }, focus: (id) => { preferredFocus = id; } };
  const finish = () => {
    const wanted = focusedId ?? preferredFocus, index = buttons.findIndex((button) => button.id === wanted);
    if (index >= 0) focus = index;
    previousScreen = `${session.screen}:${session.menu.page}:${session.menu.dialog?.page ?? ""}`; highlight(); performanceLabel();
  };
  node("root", "", { width: "100%", height: "100%", position: "absolute" });
  const act = (action: () => void) => () => { action(); changed(); };
  const back = act(() => session.back());
  const racing = screen === "race" || screen === "paused" || screen === "finished" || (screen === "options" || screen === "help") && session.returnScreen === "paused";
  if (!racing && screen !== "kart") {
    image("menu-background", "root", "ui/background.jpg", { position: "absolute", width: "100%", height: "100%", imageMode: "stretch" });
  } else if (racing) mountRaceHud(session, layout, mobile, changed);
  if (screen === "race") { performanceLabel(); updateHud(session); return; }
  if (racing) node("shade", "root", { position: "absolute", width: "100%", height: "100%", background: [0, 0.01, 0.02, 0.65] });
  if (screen !== "main" && mountSourceMenu(session, layout, host, changed, start)) { finish(); return; }
  if (screen === "main") {
    mountMainMenu(session, act, layout);
    if (session.menu.dialog) mountSourceMenu(session, layout, host, changed, start);
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
  } else if (screen === "notice") {
    heading(session.noticeTitle, ""); centeredPanel("notice-panel");
    label("notice-text", "notice-panel", session.noticeText, 22);
    button("notice-done", "notice-panel", tr("Back", "返回"), back, { height: 48 });
  }
  if (!["main", "paused", "finished"].includes(screen)) button("back", "root", tr("Back", "返回"), back, { position: "absolute", left: 18, top: 18, width: 110, height: 60 });
  finish();
}
function performanceLabel(): void {
  label("performance", "root", "", 14, { position: "absolute", left: "40%", bottom: 6, display: "none", background: [0, 0, 0, 0.65] });
}
export function updatePerformance(metrics: FrameMetrics | null, visible: boolean): void {
  style("performance", { display: visible && metrics ? "flex" : "none" });
  if (metrics) setLabel("performance", `FPS ${metrics.fps.toFixed(1)}  |  ${tr("Script", "脚本")} ${metrics.scriptMeanMs.toFixed(1)} ms  |  P95 ${metrics.frameP95Ms.toFixed(0)} ms  [F3]`, 14);
}

function mountRaceHud(session: PcSession, layout: Layout, mobile: boolean, changed: () => void): void {
  const { mapSize, mapBottom, speedUnit: unit, speedBottom } = raceHudLayout(layout);
  label("time", "root", "", 25, { position: "absolute", top: layout.top, left: "45%" });
  image("lap-flag", "root", "ui/lap_flag.png", { position: "absolute", top: layout.top, right: layout.right + 115, width: 42, height: 42 });
  label("lap", "root", "", 30, { position: "absolute", top: layout.top + 3, right: layout.right });
  label("status", "root", "", 48, { position: "absolute", top: "30%", left: "43%" });
  image("item-icon", "root", "ui/power.png", { position: "absolute", top: layout.top, left: "34%", width: 48, height: 48 });
  label("item-hint", "root", "", 16, { position: "absolute", top: layout.top + 50, left: "32%" });
  node("positions", "root", { position: "absolute", top: layout.top + (mobile ? 0 : 12), left: layout.left, flexDirection: mobile ? "row" : "column", gap: mobile ? 4 : 8 });
  for (let i = 0; i < session.race.racers.length; i++) {
    node(`position-${i}`, "positions", { flexDirection: "row", alignItems: "center", gap: 8, padding: 5, borderRadius: 10, background: [0, 0.01, 0.02, 0.5] });
    label(`position-number-${i}`, `position-${i}`, `${i + 1}`, mobile ? 16 : 23);
    image(`position-icon-${i}`, `position-${i}`, trackData.karts[0].icon, { width: mobile ? 26 : 36, height: mobile ? 26 : 36 });
    if (!mobile) label(`position-name-${i}`, `position-${i}`, "", 17);
  }
  image("map", "root", "ui/minimap.png", { position: "absolute", left: layout.left, bottom: mapBottom, width: mapSize, height: mapSize });
  for (const racer of session.race.racers) image(`map-${racer.id}`, "root", trackData.karts.find((kart) => kart.id === racer.kartId)!.icon, { position: "absolute", width: racer === session.race.player ? 22 : 16, height: racer === session.race.player ? 22 : 16 });
  image("speed-meter", "root", "ui/speedback.png", { position: "absolute", right: layout.right + 28, bottom: speedBottom, width: 145 * unit, height: 145 * unit });
  label("speed", "root", "", 29, { position: "absolute", right: layout.right + 57 * unit, bottom: speedBottom + 52 * unit });
  label("speed-unit", "root", "km/h", 14, { position: "absolute", right: layout.right + 60 * unit, bottom: speedBottom + 30 * unit });
  image("nitro-bottle", "root", "ui/nitro.png", { position: "absolute", right: layout.right + 5, bottom: speedBottom + 13, width: 29 * unit, height: 40 * unit });
  node("nitro-bar", "root", { position: "absolute", right: layout.right + 5, bottom: speedBottom + 62 * unit, width: 16 * unit, height: 90 * unit, background: [0, 0.03, 0.06, 0.8], borderRadius: 6 });
  node("nitro-fill", "nitro-bar", { position: "absolute", bottom: 0, width: "100%", height: "0%", background: [0.2, 0.75, 1, 1], borderRadius: 6 });
  if (mobile && session.screen === "race") {
    node("stick", "root", { position: "absolute", left: layout.stickX - layout.radius, top: layout.stickY - layout.radius, width: layout.radius * 2, height: layout.radius * 2, borderRadius: layout.radius, background: [0, 0.1, 0.2, 0.6] });
    node("stick-thumb", "root", { position: "absolute", width: layout.radius * 0.64, height: layout.radius * 0.64, borderRadius: layout.radius, background: [0.2, 0.8, 1, 0.8] });
    const rects = touchControlRects(layout);
    for (const [id, name] of [["gas", tr("Gas", "油门")], ["brake", tr("Brake", "刹车")], ["boost", tr("Nitro", "氮气")], ["drift", tr("Drift", "漂移")], ["item", tr("Fire", "道具")], ["rescue", tr("Rescue", "救援")], ["look-back", tr("Rear", "回看")]] as const) {
      const r = rects[id];
      node(id, "root", { position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height, borderRadius: r.width / 2, background: panel, alignItems: "center", justifyContent: "center" });
      label(`${id}-label`, id, name, 15);
    }
    button("pause", "root", "Ⅱ", () => { session.screen = "paused"; changed(); }, { position: "absolute", left: layout.left, top: layout.top + 52, width: 50, height: 44 });
  }
}
export function updateStick(touch: TouchControls, layout: Layout): void {
  const radius = layout.radius * 0.32;
  style("stick-thumb", { left: layout.stickX + touch.dx * layout.radius * 0.7 - radius, top: layout.stickY + touch.dy * layout.radius * 0.7 - radius });
  for (const id of Object.keys(touchControlRects(layout))) style(id, { background: touch.active.has(id as Parameters<typeof touch.active.has>[0]) ? [0.1, 0.65, 0.75, 0.85] : panel });
}
export function updateHud(session: PcSession): void {
  const race = session.race, player = race.player;
  setLabel("lap", `${Math.min(race.laps, Math.floor(Math.max(0, player.progress) / race.circuit.length) + 1)} / ${race.laps}`, 30);
  setLabel("time", formatTime(race.elapsed), 25);
  setLabel("speed", `${Math.round(Math.abs(player.speed) * 3.6)}`, 29);
  setLabel("status", race.phase === "countdown" ? race.countdown > 1.5 ? tr("Ready!", "预备！") : tr("Set!", "准备！")
    : player.falseStart && race.elapsed < 1 ? tr("False start!", "抢跑！") : player.offRoad > 0.3 ? tr("Off Road", "驶离赛道") : player.driftCharge >= 1 ? tr("Turbo Ready", "加速就绪") : race.elapsed < 1 ? tr("GO!", "开始！") : "", 48);
  setLabel("item-hint", player.zipperCount > 0 ? `${dimensions.mobile ? tr("Fire: zipper", "道具：加速") : tr("Space: zipper", "空格：加速")} ×${player.zipperCount}` : player.item ? dimensions.mobile ? tr("Fire: banana", "道具：香蕉") : tr("Space: drop banana", "空格：放置香蕉") : "", 16);
  style("item-icon", { display: player.item || player.zipperCount > 0 ? "flex" : "none" });
  const itemPath = player.zipperCount > 0 ? "ui/zipper_collect.png" : "ui/banana.png";
  if (labels.get("item-icon") !== itemPath) { ui_set_image("item-icon", itemPath); labels.set("item-icon", itemPath); }
  style("nitro-fill", { height: `${player.nitro / nitroCapacity * 100}%` });
  const ranking = race.ranking;
  for (let i = 0; i < ranking.length; i++) {
    const kart = trackData.karts.find((kart) => kart.id === ranking[i].kartId)!;
    if (!dimensions.mobile) setLabel(`position-name-${i}`, `${kart.name}${ranking[i] === player ? tr(" · You", " · 你") : ""}`, 17);
    const key = `position-icon-${i}`;
    if (labels.get(key) !== kart.icon) { ui_set_image(key, kart.icon); labels.set(key, kart.icon); }
  }
  const { mapSize: size, mapBottom } = raceHudLayout(dimensions);
  for (const racer of race.racers) {
    const iconSize = racer === player ? 22 : 16;
    const left = dimensions.left + (racer.x - trackData.minimap.minX) / trackData.minimap.size * size - iconSize / 2;
    const bottom = mapBottom + (1 - (racer.z - trackData.minimap.minZ) / trackData.minimap.size) * size - iconSize / 2;
    style(`map-${racer.id}`, { left, bottom });
  }
}
