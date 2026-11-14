import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { MenuData, GuiNode } from "../modules/stk-car/game/src/menu-data-types.js";
import { parseXml } from "./scene-source.ts";

export const menuSources = [
  "screens/main_menu", "screens/karts", "screens/race_setup", "screens/tracks_and_gp", "screens/track_info", "screens/gp_info",
  "screens/user_screen", "screens/addons_screen", "screens/high_score_selection", "screens/grand_prix_editor", "screens/edit_gp", "screens/edit_track", "screens/credits",
  ...["general", "display", "video", "audio", "ui", "input", "language", "device"].map((name) => `screens/options/options_${name}`), "screens/options/user_screen_tab",
  ...Array.from({ length: 7 }, (_, index) => `screens/help/help${index + 1}`),
  ...["online", "lan", "server_selection", "create_server", "register", "user_search", "profile_achievements", "profile_friends", "profile_servers", "profile_settings", "networking_lobby"].map((name) => `screens/online/${name}`),
  ...["confirm_dialog", "general_text_field_dialog", "custom_video_settings", "custom_camera_settings", "press_a_key_dialog", "high_score_info_dialog", "overworld_dialog", "select_challenge", "addons_loading", "enter_address_dialog"].map((name) => `dialogs/${name}`),
  ...["recovery_input", "recovery_info", "change_password", "registration_terms", "server_info_dialog", "user_info_dialog", "achievement_progress_dialog", "splitscreen_player_dialog"].map((name) => `dialogs/online/${name}`),
];

export function gettextTranslations(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let id = "", translation = "", field = "";
  const finish = () => { if (id && translation) values.set(id, translation); id = ""; translation = ""; field = ""; };
  for (const line of `${text}\n\n`.split(/\r?\n/)) {
    if (!line.trim()) { finish(); continue; }
    if (line.startsWith("#")) continue;
    const match = /^(msgid|msgstr(?:\[0\])?)\s+(".*")$/.exec(line);
    if (match) { field = match[1].startsWith("msgstr") ? "translation" : "id"; }
    const quoted = match?.[2] ?? (line.startsWith('"') ? line : null);
    if (!quoted) { field = ""; continue; }
    const value: string = JSON.parse(quoted);
    if (field === "id") id += value;
    if (field === "translation") translation += value;
  }
  return values;
}

function imageSize(data: Buffer): { width: number; height: number } {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1], length = data.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  throw new Error("Unsupported menu image header");
}

export function prepareMenus(source: string, code: string, record: (path: string) => Buffer, write: (relative: string, data: Buffer | string) => void): MenuData {
  const data: MenuData = { pages: {}, sources: {}, translations: {}, images: {}, tracks: [], grandPrix: [], credits: [], achievements: [] };
  const texts = new Set<string>();
  const translations = gettextTranslations(record(join(code, "data/po/zh_CN.po")).toString("utf8"));
  function image(name: string): void {
    if (!name || data.images[name]) return;
    const input = join(code, "data", name);
    const bytes = record(input), path = `ui/source/${name}`;
    data.images[name] = { path, ...imageSize(bytes) }; write(path, bytes);
  }
  function collect(node: GuiNode): void {
    for (const name of ["icon", "focus_icon"]) if (node.attributes[name]) image(node.attributes[name]);
    if (node.attributes.text) texts.add(node.attributes.text);
    node.children.forEach(collect);
  }
  for (const name of menuSources) {
    const file = `data/gui/${name}.stkgui`, id = basename(name);
    const tree = parseXml(record(join(code, file)).toString("utf8"));
    data.pages[id] = tree; data.sources[id] = `stk-code/${file}`; collect(tree);
  }
  for (const name of ["glassbutton", "glassbutton_focused", "glasstab", "glasstab_focus", "glasstab_vert", "glasstab_vert_focus", "glasscheckbox", "glasscheckbox_focus", "glasscheckbox_checked", "glasscheckbox_checked_focus", "glassspinner", "glassspinner_focus", "glasssgauge_fill", "generic"]) {
    const scope = existsSync(join(code, `data/skins/classic/${name}.png`)) ? "classic" : "common";
    image(`skins/${scope}/${name}.png`);
  }
  for (const name of ["dialog", "textbubble", "table_header", "scrollbar_bg", "scrollbar_thumb", "left_arrow", "right_arrow", "bottom_bar"]) {
    const scope = existsSync(join(code, `data/skins/classic/${name}.png`)) ? "classic" : "common";
    image(`skins/${scope}/${name}.png`);
  }
  for (const name of ["blue_plus", "remove", "rename", "gp_new", "gp_copy", "gp_edit", "gp_remove", "green_check", "red_x", "track_random", "logo_slim", "karts", "mode_normal", "mode_tt", "mode_ftl", "mode_weapons", "mode_soccer", "mode_easter", "mode_ghost", "mode_laptrial", "story_mode_book"]) image(`gui/icons/${name}.png`);
  for (const entry of readdirSync(join(source, "tracks"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(source, "tracks", entry.name), config = join(directory, "track.xml");
    if (!existsSync(config)) continue;
    const attrs = parseXml(record(config).toString("utf8")).attributes;
    if (attrs.internal === "Y" && entry.name !== "overworld") continue;
    const screenshot = [attrs.screenshot, "screenshot.jpg", "screenshot.png"].filter(Boolean).map((name) => join(directory, name)).find(existsSync);
    let path = "ui/branding/lighthouse.jpg";
    if (screenshot) { path = `ui/catalog/${entry.name}${extname(screenshot)}`; write(path, record(screenshot)); }
    else path = data.images["gui/icons/track_random.png"].path;
    data.tracks.push({ id: entry.name, name: attrs.name ?? entry.name, designer: attrs.designer ?? "", image: path, laps: Number(attrs["default-number-of-laps"] ?? 3), arena: attrs.arena === "Y" || attrs.soccer === "Y", groups: attrs.groups ?? "standard" });
    texts.add(attrs.name ?? entry.name);
  }
  for (const name of readdirSync(join(code, "data/grandprix")).filter((name) => name.endsWith(".grandprix")).sort()) {
    const tree = parseXml(record(join(code, "data/grandprix", name)).toString("utf8"));
    data.grandPrix.push({ id: basename(name, ".grandprix"), name: tree.attributes.name, tracks: tree.children.filter((node) => node.tag === "track").map((node) => node.attributes.id) });
    texts.add(tree.attributes.name);
  }
  data.credits = record(join(code, "data/CREDITS")).toString("utf8").split(/\r?\n/).filter((line) => line.trim());
  const achievements = parseXml(record(join(code, "data/achievements.xml")).toString("utf8"));
  for (const node of achievements.children) if (node.tag === "achievement") {
    const a = node.attributes;
    data.achievements.push({ id: a.id, name: a.name, description: a.description }); texts.add(a.name); texts.add(a.description);
  }
  for (const text of texts) { const translated = translations.get(text); if (translated) data.translations[text] = translated; }
  console.log(`Prepared ${Object.keys(data.pages).length} original menu screens/dialogs, ${Object.keys(data.images).length} UI images and ${data.tracks.length} track previews.`);
  return data;
}
