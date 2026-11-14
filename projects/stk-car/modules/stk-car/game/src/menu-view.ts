import type { Layout } from "./controls.js";
import { guiLayout, guiLength, type GuiBox, type Rect } from "./gui-layout.js";
import { menuData } from "./menu-data.js";
import type { GuiNode } from "./menu-data-types.js";
import { menuAction, menuPageFor } from "./menu-actions.js";
import { modeChoices, optionPages, optionTabs } from "./menu-state.js";
import { isChinese, sourceText, tr } from "./localization.js";
import { formatTime } from "./race.js";
import type { PcSession } from "./session.js";
import { trackData } from "./track-data.js";

export interface MenuButton {
  id: string; action: () => void; base: number[]; hint?: string;
  face?: { id: string; normal: string; focused: string; selected: boolean };
  caption?: { id: string; text: string; size: number };
}
export interface MenuHost { register(button: MenuButton): void; modal(): void; focus(id: string): void; }
export const menuWidgetId = (page: string, id: string): string => `gui:${page}:${id}`;
const transparent = [0, 0, 0, 0], ink = [0, 0, 0, 1], blue = [0, 0, 0.7, 1];
const containerTags = new Set(["stkgui", "div", "box", "bottombar"]);
const gridTags = new Set(["ribbon_grid", "scrollable_ribbon", "scrollable_toolbar", "ribbon", "buttonbar", "tabs", "vertical-tabs"]);

export function sourceImage(name: string): string { return menuData.images[name]?.path ?? name; }
function skin(name: string): string { return sourceImage(`skins/classic/${name}.png`) !== `skins/classic/${name}.png` ? sourceImage(`skins/classic/${name}.png`) : sourceImage(`skins/common/${name}.png`); }
function spawn(id: string, kind: "node" | "button" | "image" | "text", parent: string, style: Record<string, unknown>): void {
  if (!ui_spawn(id, parent, kind) || !ui_set_style(id, JSON.stringify(style))) throw new Error(`Cannot create menu widget ${id}`);
}
function position(rect: Rect): Record<string, unknown> { return { position: "absolute", left: rect.x, top: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) }; }
function picture(id: string, path: string, rect: Rect, stretch = false, parent = "root"): void {
  const image = menuData.images[path];
  if (image && !stretch) {
    const ratio = Math.min(rect.width / image.width, rect.height / image.height), width = image.width * ratio, height = image.height * ratio;
    rect = { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
  }
  spawn(id, "image", parent, { ...position(rect), imageMode: "stretch" });
  if (!ui_set_image(id, sourceImage(path))) throw new Error(`Missing menu image ${path}`);
}
function text(id: string, value: string, rect: Rect, size: number, color = ink, align = "center", parent = "root"): void {
  spawn(id, "node", parent, { ...position(rect), flexDirection: "column", alignItems: align === "left" ? "flex-start" : "center", justifyContent: "center" });
  spawn(`${id}:text`, "text", id, { maxWidth: "100%", flexShrink: 1 });
  ui_set_text(`${id}:text`, value, size, color[0], color[1], color[2], color[3]);
  ui_set_font(`${id}:text`, isChinese() ? "fonts/wqy-microhei.ttf" : "fonts/Cantarell-Regular.otf");
}
interface Item { id: string; text: string; image?: string; selected?: boolean; }

export function mountSourceMenu(session: PcSession, layout: Layout, host: MenuHost, changed: () => void, start: () => void): boolean {
  if (!["kart", "setup", "tracks", "track-info", "menu", "options", "help"].includes(session.screen)) return false;
  const m = session.menu, page = menuPageFor(session);
  m.page = page;
  const scale = Math.max(0.5, Math.min(1.4, layout.width / 1280, layout.height / 720));
  const counts = new Map<string, number>();
  const uid = (key: string) => { const count = counts.get(key) ?? 0; counts.set(key, count + 1); return count ? `${key}:${count}` : key; };
  const action = (id: string) => () => { m.editing = ""; menuAction(session, id, changed, start); };

  function button(id: string, rect: Rect, label: string, click: () => void, options: { image?: string; normal?: string; focused?: string; selected?: boolean; horizontal?: boolean } = {}): void {
    spawn(id, "button", "root", { ...position(rect), background: transparent });
    const normal = options.normal ?? skin("glassbutton"), focused = options.focused ?? skin("glassbutton_focused");
    if (normal) picture(`${id}:face`, normal, { x: 0, y: 0, width: rect.width, height: rect.height }, true, id);
    const captionHeight = label ? Math.min(rect.height * (options.image && !options.horizontal ? 0.31 : 1), 42 * scale) : 0;
    if (options.image) {
      const imageRect = options.horizontal ? { x: 6 * scale, y: 3 * scale, width: Math.min(rect.height - 6 * scale, rect.width * 0.28), height: rect.height - 6 * scale }
        : { x: 4 * scale, y: 2 * scale, width: rect.width - 8 * scale, height: rect.height - captionHeight - 4 * scale };
      picture(`${id}:icon`, options.image, imageRect, false, id);
    }
    if (label) text(`${id}:label`, label, options.horizontal && options.image ? { x: rect.width * 0.25, y: 0, width: rect.width * 0.74, height: rect.height }
      : { x: 4 * scale, y: rect.height - captionHeight, width: rect.width - 8 * scale, height: captionHeight }, Math.max(13, 18 * scale), ink, "center", id);
    host.register({ id, action: click, base: transparent, face: normal ? { id: `${id}:face`, normal, focused, selected: !!options.selected } : undefined,
      caption: label ? { id: `${id}:label:text`, text: label, size: Math.max(13, 18 * scale) } : undefined });
  }
  function items(id: string, currentPage: string): Item[] {
    if (id === "karts") return trackData.karts.map((kart) => ({ id: `choose-${kart.id}`, text: kart.name, image: kart.icon, selected: session.settings.kartId === kart.id }));
    if (id === "gamemode") return modeChoices.map(([mode, name, icon]) => ({ id: `mode-${mode}`, text: sourceText(name), image: `gui/icons/${icon}.png`, selected: m.raceMode === mode }));
    if (id === "kartgroups") return ["All", "Standard", "Favorites"].map((name) => ({ id: `group:${name}`, text: sourceText(name) }));
    if (id === "trackgroups" || id === "gpgroups") return ["All", "Standard", "Favorites"].map((name) => ({ id: `group:${name}`, text: sourceText(name) }));
    if (id === "gps" || id === "gplist") return menuData.grandPrix.map((gp) => ({ id: `gp:${gp.id}`, text: sourceText(gp.name), image: menuData.tracks.find((track) => track.id === gp.tracks[0])?.image, selected: gp.id === m.grandPrix }));
    if (id === "tracks" && currentPage !== "edit_gp") {
      const gp = currentPage === "grand_prix_editor" || currentPage === "gp_info" ? menuData.grandPrix.find((gp) => gp.id === m.grandPrix) : undefined;
      return menuData.tracks.filter((track) => track.id !== "overworld" && (gp ? gp.tracks.includes(track.id) : true)).map((track) => ({ id: `track:${track.id}`, text: sourceText(track.name), image: track.image, selected: track.id === m.track }));
    }
    if (id === "players") return m.profiles.map((name, index) => ({ id: `profile:${index}`, text: name === "Player" ? tr("Player", "玩家") : name, image: trackData.karts[index % trackData.karts.length].icon, selected: m.player === index }));
    if (id === "resolutions") return ["1280 × 720", "1600 × 900", "1920 × 1080"].map((label) => ({ id: `resolution:${label}`, text: label, selected: label === (m.values["resolution"] ?? "1280 × 720") }));
    return [];
  }
  function rows(id: string, currentPage: string): Item[] {
    if (id === "language") return [{ id: "language:system", text: tr("System Language (default)", "系统语言（默认）"), selected: session.settings.language === "system" }, { id: "language:en-US", text: "English", selected: session.settings.language === "en-US" }, { id: "language:zh-CN", text: "简体中文", selected: session.settings.language === "zh-CN" }];
    if (id === "devices") return [{ id: "device:keyboard", text: tr("Keyboard 0", "键盘 0"), image: "gui/icons/options_input.png" }];
    if (id === "actions") return [["Accelerate", "↑"], ["Brake", "↓"], ["Steer Left", "←"], ["Steer Right", "→"], ["Fire", "Space"], ["Nitro", "N"], ["Drift", "V"], ["Rescue", "Backspace"], ["Look Back", "B"]].map(([name, key]) => ({ id: `binding:${name}`, text: `${sourceText(name)}                         ${key}` }));
    if (id === "achievements_list") return menuData.achievements.map((item, index) => ({ id: `achievement:${index}`, text: `${sourceText(item.name)}                           0%` }));
    if (id === "tracks" && currentPage === "edit_gp") return m.draftTracks.map((id, index) => ({ id: `draft-row:${index}`, text: `${index + 1}.  ${sourceText(menuData.tracks.find((track) => track.id === id)?.name ?? id)}`, selected: m.selectedRow === index }));
    if (["high_scores_list", "highscore_entries", "high_score_list"].includes(id)) {
      const stored = storage_read(session.bestKey), best = stored.state === "ok" ? Number(stored.value) : 0;
      return Number.isFinite(best) && best > 0 ? [{ id: "score:lighthouse", text: `${tr("Around the Lighthouse", "环绕灯塔")}     ${sourceText(session.settings.mode === "normal" ? "Normal Race" : "Time Trial")}     ${formatTime(best)}` }] : [];
    }
    if (id === "player-list" || id === "players-list") return [{ id: "local-player", text: tr("Local interface preview — not connected", "本地界面预览——尚未连接") }];
    return [];
  }
  function labelValue(id: string, fallback: string, currentPage: string): string {
    if (m.dialog && id === "title") return m.dialog.title;
    if (id === "name" && currentPage === "track_info" || id === "selected_track") return sourceText(m.selectedTrack.name);
    if (id === "author") return m.selectedTrack.designer;
    if (id === "title" && currentPage === "options_device") return tr("Keyboard 0", "键盘 0");
    if (id === "title" && currentPage.startsWith("profile_")) return `${sourceText(currentPage === "profile_friends" ? "Friends" : currentPage === "profile_settings" ? "Account Settings" : "Achievements")} — ${m.profiles[m.player]}`;
    if (id === "highscores") return sourceText("High Scores");
    if (id === "target-type-text") return sourceText("Race target");
    if (id === "option-text") return sourceText("Reverse");
    if (id === "gpname") return m.draftName || sourceText(menuData.grandPrix.find((gp) => gp.id === m.grandPrix)?.name ?? "Grand Prix");
    if (id === "challenge_info") return `${sourceText(m.selectedTrack.name)}\n${tr("Win the race to earn a trophy.", "赢得比赛以获得奖杯。")}\n${tr("Challenge progress is not connected in this preview.", "此预览尚未接入挑战进度。")}`;
    const achievement = menuData.achievements[m.achievement];
    if (currentPage === "achievement_progress_dialog") {
      if (id === "description" || id === "main-goal-description") return sourceText(achievement?.description ?? "");
      if (id === "main-goal-progress") return tr("Not tracked in this preview", "此预览尚未记录进度");
    }
    if (id === "message" || id === "info") return m.status;
    if (id === "terms") return tr("Account registration is not connected. No account or password will be sent from this interface preview.", "账号注册尚未接入，此界面预览不会发送账号或密码。");
    return sourceText(fallback);
  }
  function drawPage(currentPage: string, rect: Rect): void {
    const source = menuData.pages[currentPage];
    if (!source) { drawStory(rect); return; }
    const draw = (box: GuiBox) => {
      const { node, path } = box, a = node.attributes, logical = a.id ?? `node-${path}`, r = box.rect;
      if (r.width < 1 || r.height < 1 || node.tag === "spacer" || logical.startsWith("test_")) return;
      const id = uid(menuWidgetId(currentPage, logical));
      if (containerTags.has(node.tag)) {
        if (node.tag === "box") picture(`${id}:box`, skin("generic"), r, true);
        if (logical === "animated_area") { drawCredits(id, r); return; }
        box.children.forEach(draw); return;
      }
      if (gridTags.has(node.tag)) {
        let list = items(logical, currentPage);
        if (!list.length && node.children.length) list = node.children.map((child, index) => ({ id: child.attributes.id ?? `item-${index}`, text: sourceText(child.attributes.text ?? ""), image: child.attributes.icon, selected: selected(child.attributes.id ?? "", currentPage) }));
        if (currentPage === "race_setup" && logical === "difficulty") list = list.map((item, index) => ({ ...item, selected: session.settings.difficulty === index }));
        drawItems(id, logical, list, node, r, currentPage); return;
      }
      if (node.tag === "list") { drawList(id, logical, rows(logical, currentPage), r, currentPage); return; }
      if (node.tag === "placeholder") {
        const kart = trackData.karts.find((kart) => kart.id === session.settings.kartId)!;
        text(`${id}:player`, `${m.profiles[m.player]} — ${kart.name}`, { x: r.x, y: r.y + r.height * 0.8, width: r.width, height: r.height * 0.18 }, 24 * scale, blue); return;
      }
      if (node.tag === "checkbox") {
        const checked = m.checked(logical, session), side = Math.min(r.height, r.width, 30 * scale), square = { x: r.x, y: r.y + (r.height - side) / 2, width: side, height: side };
        button(id, square, "", () => { m.editing = ""; m.toggle(logical, session); changed(); }, { normal: skin(checked ? "glasscheckbox_checked" : "glasscheckbox"), focused: skin(checked ? "glasscheckbox_checked_focus" : "glasscheckbox_focus") }); return;
      }
      if (node.tag === "gauge" || node.tag === "spinner") { drawSpinner(id, logical, node, r); return; }
      if (node.tag === "progressbar" || node.tag === "ratingbar") {
        picture(id, skin("glassspinner"), r, true); text(`${id}:value`, node.tag === "ratingbar" ? "☆☆☆☆☆" : "0%", r, 17 * scale); return;
      }
      if (node.tag === "textbox") {
        const value = m.text(logical), display = logical.includes("password") ? "●".repeat(value.length) : value;
        button(id, r, `${display}${m.editing === logical ? "|" : ""}`, () => { m.editing = logical; changed(); }, { selected: m.editing === logical }); return;
      }
      if (node.tag === "icon" || node.tag === "icon-button") {
        let icon = a.icon;
        if (!icon && ["screenshot", "track_screenshot"].includes(logical)) icon = m.selectedTrack.image;
        if (node.tag === "icon" && icon) picture(id, icon, r);
        if (node.tag === "icon-button") button(id, r, sourceText(a.text ?? ""), action(logical), { image: icon, normal: "", focused: "" });
        return;
      }
      if (node.tag === "button") { button(id, r, logical === "user-id" ? m.profiles[m.player] : sourceText(a.text ?? ""), action(logical)); return; }
      if (node.tag === "bubble") picture(`${id}:bubble`, skin("textbubble"), r, true);
      const header = ["header", "small-header", "tiny-header"].includes(node.tag);
      const size = (node.tag === "header" ? 32 : node.tag === "small-header" ? 24 : node.tag === "bubble" ? 15.5 : 18) * scale;
      text(id, labelValue(logical, a.text ?? "", currentPage), r, Math.max(12, size), header ? blue : ink, a.text_align ?? (node.tag === "bubble" ? "left" : "center"));
    };
    draw(guiLayout(source, rect, scale));
  }
  function selected(id: string, currentPage: string): boolean {
    const index = optionTabs.indexOf(id);
    if (index >= 0) return optionPages[index] === currentPage;
    if (/page[1-7]/.test(id)) return currentPage === `help${id.slice(4)}`;
    return false;
  }
  function drawSpinner(id: string, logical: string, node: GuiNode, r: Rect): void {
    const choices = m.choices(logical), min = Number(node.attributes.min_value ?? 0), max = Number(node.attributes.max_value ?? (logical === "scale_rtts" || logical === "font_size" ? 150 : 10));
    picture(`${id}:background`, skin("glassspinner"), r, true);
    const arrow = Math.min(30 * scale, r.width * 0.18), size = Math.min(r.height, 32 * scale), y = r.y + (r.height - size) / 2;
    button(`${id}:down`, { x: r.x, y, width: arrow, height: size }, "", () => { m.editing = ""; m.adjust(logical, -1, session, min, max); changed(); }, { image: "skins/common/left_arrow.png", normal: "", focused: "" });
    button(`${id}:up`, { x: r.x + r.width - arrow, y, width: arrow, height: size }, "", () => { m.editing = ""; m.adjust(logical, 1, session, min, max); changed(); }, { image: "skins/common/right_arrow.png", normal: "", focused: "" });
    if (node.tag === "gauge" && !choices.length) {
      const value = m.number(logical, session), width = Math.max(0, (r.width - arrow * 2) * Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min))));
      if (width) picture(`${id}:fill`, skin("glasssgauge_fill"), { x: r.x + arrow, y: y + size * 0.5, width, height: size * 0.25 }, true);
    }
    text(`${id}:value`, m.display(logical, session), { x: r.x + arrow, y, width: r.width - arrow * 2, height: size }, 18 * scale);
  }
  function drawItems(id: string, logical: string, list: Item[], node: GuiNode, r: Rect, currentPage: string): void {
    const vertical = node.tag === "vertical-tabs", tabs = node.tag === "tabs" || vertical;
    const width = guiLength(node.attributes.child_width, r.width, scale) ?? (tabs ? r.width / Math.max(1, list.length) : 128 * scale);
    const height = guiLength(node.attributes.child_height, r.height, scale) ?? (tabs ? 46 * scale : width + 32 * scale);
    const columns = vertical ? 1 : tabs || ["ribbon", "buttonbar", "scrollable_toolbar", "scrollable_ribbon"].includes(node.tag) ? Math.max(1, list.length) : Math.max(1, Math.floor(r.width / (width + 8 * scale)));
    const rows = vertical ? list.length : tabs || ["ribbon", "buttonbar", "scrollable_toolbar", "scrollable_ribbon"].includes(node.tag) ? 1 : Math.max(1, Math.floor(r.height / Math.max(height, 1)));
    const capacity = Math.max(1, columns * rows), offset = (m.listPages[id] ?? 0) * capacity, visible = list.slice(offset, offset + capacity);
    visible.forEach((item, index) => {
      const cellWidth = r.width / columns, cellHeight = r.height / Math.max(1, rows), gap = 5 * scale;
      const cell = { x: r.x + (index % columns) * cellWidth + gap, y: r.y + Math.floor(index / columns) * cellHeight + gap,
        width: cellWidth - gap * 2, height: Math.min(cellHeight - gap * 2, tabs ? cellHeight : height) };
      const normal = tabs ? skin(vertical ? "glasstab_vert" : "glasstab") : "", focused = tabs ? skin(vertical ? "glasstab_vert_focus" : "glasstab_focus") : "";
      button(menuWidgetId(currentPage, item.id), cell, item.text, action(item.id), { image: item.image, normal, focused, selected: item.selected, horizontal: tabs });
    });
    if (list.length > capacity) pagination(id, r, Math.ceil(list.length / capacity));
    if (logical === "gamemode") host.focus(menuWidgetId(currentPage, `mode-${session.settings.mode}`));
    if (logical === "karts") host.focus(menuWidgetId(currentPage, `choose-${session.settings.kartId}`));
  }
  function drawList(id: string, logical: string, list: Item[], r: Rect, currentPage: string): void {
    spawn(`${id}:background`, "node", "root", { ...position(r), background: [1, 1, 1, 0.3] });
    const rowHeight = 38 * scale, capacity = Math.max(1, Math.floor((r.height - (list.length * rowHeight > r.height ? 28 * scale : 0)) / rowHeight));
    const offset = (m.listPages[id] ?? 0) * capacity;
    list.slice(offset, offset + capacity).forEach((item, index) => button(menuWidgetId(currentPage, item.id), { x: r.x + 5 * scale, y: r.y + index * rowHeight, width: r.width - 10 * scale, height: rowHeight }, item.text, action(item.id), { selected: item.selected, horizontal: true, image: item.image }));
    if (!list.length) text(`${id}:empty`, sourceText(logical.includes("score") ? "No high scores yet" : ["server_list", "friends_list", "users"].includes(logical) ? "Not connected" : "No items available"), r, 18 * scale);
    if (list.length > capacity) pagination(id, r, Math.ceil(list.length / capacity));
  }
  function pagination(id: string, r: Rect, total: number): void {
    const pageNumber = m.listPages[id] ?? 0, side = 26 * scale, y = r.y + r.height - side;
    for (const direction of [-1, 1]) button(`${id}:page-${direction}`, { x: r.x + r.width - (direction < 0 ? 110 : 30) * scale, y, width: side, height: side }, direction < 0 ? "‹" : "›", () => { m.listPages[id] = (pageNumber + direction + total) % total; changed(); });
    text(`${id}:page-number`, `${pageNumber + 1}/${total}`, { x: r.x + r.width - 82 * scale, y, width: 50 * scale, height: side }, 14 * scale);
  }
  function drawCredits(id: string, r: Rect): void {
    const pageNumber = m.listPages[id] ?? 0, lines = Math.max(1, Math.floor((r.height - 34 * scale) / (26 * scale)));
    text(`${id}:credits`, menuData.credits.slice(pageNumber * lines, (pageNumber + 1) * lines).map((line) => line.replace(/\$STKVERSION\$/g, "PC Edition")).join("\n"), { ...r, height: r.height - 34 * scale }, 18 * scale, [0.25, 0.06, 0, 1]);
    pagination(id, r, Math.ceil(menuData.credits.length / lines));
  }
  function drawStory(r: Rect): void {
    const map = menuData.tracks.find((track) => track.id === "overworld");
    if (map) picture("story-map", map.image, { x: r.width * 0.1, y: r.height * 0.12, width: r.width * 0.8, height: r.height * 0.72 }, true);
    text("story-title", sourceText("Story Mode"), { x: 0, y: 0, width: r.width, height: r.height * 0.1 }, 32 * scale, blue);
    button("story-back", { x: 15, y: 10, width: 64 * scale, height: 54 * scale }, "", action("back"), { image: "gui/icons/back.png", normal: "", focused: "" });
    text("story-progress", tr("0 trophies · Challenge map preview", "0 奖杯 · 挑战地图预览"), { x: r.width * 0.3, y: r.height * 0.86, width: r.width * 0.5, height: r.height * 0.08 }, 22 * scale);
    ["lighthouse", "olivermath", "hacienda"].forEach((track, index) => button(`challenge-${track}`, { x: r.width * (0.25 + index * 0.2), y: r.height * (0.4 + (index % 2) * 0.2), width: 80 * scale, height: 75 * scale }, "", action(`challenge:${track}`), { image: "gui/icons/story_mode_book.png" }));
  }

  drawPage(page, { x: 0, y: 0, width: layout.width, height: layout.height });
  if (m.dialog) {
    spawn("menu-dialog-shade", "node", "root", { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: [0, 0, 0, 0.55] });
    host.modal();
    const large = ["custom_video_settings", "custom_camera_settings", "select_challenge"].includes(m.dialog.page);
    const r = { x: layout.width * (large ? 0.1 : 0.2), y: layout.height * (large ? 0.1 : 0.18), width: layout.width * (large ? 0.8 : 0.6), height: layout.height * (large ? 0.8 : 0.64) };
    picture("menu-dialog-frame", skin("dialog"), r, true);
    drawPage(m.dialog.page, { x: r.x + 18 * scale, y: r.y + 15 * scale, width: r.width - 36 * scale, height: r.height - 30 * scale });
  }
  if (m.status) text("menu-status", m.status, { x: layout.width * 0.22, y: layout.height * 0.94, width: layout.width * 0.75, height: layout.height * 0.05 }, 15 * scale, [0.55, 0.05, 0, 1]);
  return true;
}
