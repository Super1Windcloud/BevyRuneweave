import { image, node, text, type UiElement, type UiStyle, type UiColor } from "../../api/ui.js";
import { chromeFrames, uiFrames } from "./spd-ui-atlas.js";
import { heroClassList, itemCatalog, type HeroClass, type ItemKind } from "./rules.js";
import { armorRange, attackDelay, attackSkill, defenseSkill, equippedGear, gearDefinitions, strengthRequired, weaponRange, type GearItem } from "./equipment.js";
import type { Profile } from "./profile.js";
import { translate, type MessageKey, type MessageParameters } from "./i18n.js";
import { fontForText, measureText, wrapText } from "./text-layout.js";
import { spiritBowDelay, spiritBowLevel, spiritBowRange, spiritBowStrength } from "./spirit-bow.js";
import type { TargetKind } from "./projectiles.js";
import { staffCapacity, staffCharges, staffDamageRange } from "./staff.js";

export type UiPhase = "menu" | "heroes" | "playing" | "paused" | "won" | "lost" | "inventory" | "item" | "equipment" | "upgrade" | "hero" | "settings" | "checks" | "rankings" | "journal" | "news" | "changes" | "about" | "support" | "message";
export interface SpdUiState {
  phase: UiPhase;
  selectedClass: HeroClass;
  item: ItemKind;
  health: number;
  maxHealth: number;
  level: number;
  strength: number;
  experience: number;
  targetExperience: number;
  depth: number;
  gold: number;
  score: number;
  turns: number;
  hunger: string;
  invisible: number;
  ooze: number;
  healing: number;
  burning: number;
  lockedFloor: number | null;
  targeting: TargetKind | null;
  bossHealth: number | null;
  inventory: Record<ItemKind, number>;
  equipment: readonly GearItem[];
  selectedGear: number;
  upgradePage: number;
  wornKeys: number;
  gooBlobs: number;
  examining: boolean;
  logs: readonly string[];
  profile: Profile;
  settingsTab: number;
  gameBehind: boolean;
  saveNotice: string;
  resetPending: boolean;
  checks: readonly string[];
  checkPage: number;
  networkStatus: string;
  notice: string;
}
export interface UiMetrics { scale: number; width: number; height: number; left: number; top: number; landscape: boolean; large: boolean }
export function uiMetrics(): UiMetrics {
  const size = window_metrics(), pointer = input_primary_pointer(), safe = window_safe_area();
  const sx = size.width / pointer.viewportWidth, sy = size.height / pointer.viewportHeight;
  const width = safe.width * sx, height = safe.height * sy;
  const landscape = width > height, large = landscape && width >= 960;
  const minWidth = large ? 360 : landscape ? 240 : 135, minHeight = large ? 200 : landscape ? 160 : 225;
  const maximum = Math.max(1, Math.floor(Math.min(width / minWidth, height / minHeight)));
  const scale = Math.min(large ? 4 : 3, maximum);
  return { scale, width: width / scale, height: height / scale, left: safe.leftInset * sx, top: safe.topInset * sy, landscape, large };
}

const titleColor: UiColor = [1, 1, 68 / 255, 1];
const white: UiColor = [1, 1, 1, 1];
const grey: UiColor = [0.67, 0.67, 0.67, 1];
type Action = (id: string, value?: string | number) => void;

export function renderSpdUi(state: SpdUiState, on: Action): UiElement {
  const language = state.profile.language;
  const t = (key: MessageKey, parameters?: MessageParameters): string => translate(language, key, parameters);
  const textWidth = (value: string, size: number): number => measureText(language, value, size);
  const wrappedText = (value: string, width: number, size: number): string[] => wrapText(language, value, width, size);
  const m = uiMetrics(), s = m.scale, w = m.width, h = m.height;
  const elements: UiElement[] = [];
  const rect = (x: number, y: number, width: number, height: number): UiStyle => ({ position: "absolute", left: Math.round(x * s), top: Math.round(y * s), width: Math.round(width * s), height: Math.round(height * s) });
  function label(id: string, value: string, x: number, y: number, width: number, size = 8, color: UiColor = white, height = size * 1.5): UiElement {
    return text(id, value, { font: fontForText(language, value), fontSize: size * s, color, style: rect(x, y, width, height) });
  }
  function art(id: string, name: string, x: number, y: number, width?: number, height?: number, tint?: UiColor): UiElement {
    const f = uiFrames[name];
    return image(id, `sprites/spd-ui/${name}.png`, { ...rect(x, y, width ?? f?.rect[2] ?? 16, height ?? f?.rect[3] ?? 16), imageMode: "stretch", imageTint: tint });
  }
  function patch(id: string, type: keyof typeof chromeFrames, x: number, y: number, width: number, height: number): UiElement[] {
    const b = chromeFrames[type].border;
    const xs = [x, x + b, x + width - b], ys = [y, y + b, y + height - b];
    const widths = [b, width - b * 2, b], heights = [b, height - b * 2, b];
    return ys.flatMap((py, row) => xs.map((px, column) => image(`${id}_${row}_${column}`, `sprites/spd-ui/${type}_${row}_${column}.png`, { ...rect(px, py, Math.max(1, widths[column]!), Math.max(1, heights[row]!)), imageMode: "stretch" })));
  }
  function control(id: string, value: string, x: number, y: number, width: number, height = 20, type: "red" | "grey" | "toast" | null = "red", icon?: string, action = id, enabled = true, size = 9): UiElement {
    const children: UiElement[] = type ? patch(`${id}_chrome`, type, 0, 0, width, height) : [];
    const iconWidth = icon ? uiFrames[icon]?.rect[2] ?? 14 : 0;
    size = value ? Math.min(size, size * Math.max(1, width - iconWidth - (icon ? 6 : 4)) / textWidth(value, size)) : size;
    const labelWidth = textWidth(value, size);
    const groupWidth = labelWidth + (icon ? iconWidth + (value ? 2 : 0) : 0), groupLeft = (width - groupWidth) / 2;
    if (icon) children.push(art(`${id}_icon`, icon, groupLeft, (height - (uiFrames[icon]?.rect[3] ?? 14)) / 2));
    if (value) children.push(text(`${id}__label`, value, { font: fontForText(language, value), fontSize: size * s,
      color: !enabled ? grey : id === "begin_run" || id.startsWith("use_") ? titleColor : white,
      style: rect(groupLeft + (icon ? iconWidth + 2 : 0), (height - size * 1.2) / 2, labelWidth + 1, size * 1.5) }));
    return { kind: "button", id, onClick: enabled ? () => on(action) : undefined,
      style: { ...rect(x, y, width, height), alignItems: "center", justifyContent: "center", padding: icon ? 3 * s : 0 }, children };
  }
  function iconControl(id: string, icon: string, x: number, y: number, width = 20, height = 20, action = id): UiElement {
    return { kind: "button", id, onClick: () => on(action), style: rect(x, y, width, height), children: [art(`${id}_image`, icon, (width - 14) / 2, (height - 14) / 2, 14, 14)] };
  }
  function window(id: string, width: number, height: number, content: UiElement[], close = true, centerY = h / 2): void {
    if (close) elements.push({ kind: "button", id: `${id}_outside`, onClick: () => on("modal_close"), style: rect(0, 0, w, h), children: [] });
    const x = (w - width - 12) / 2, y = centerY - (height + 12) / 2;
    elements.push(node(`${id}_shadow`, { ...rect(x - 2, y - 2, width + 16, height + 16), background: [0, 0, 0, 0.5] }));
    elements.push(node(id, rect(x, y, width + 12, height + 12), [
      ...patch(`${id}_frame`, "window", 0, 0, width + 12, height + 12),
      node(`${id}_content`, rect(6, 6, width, height), content),
    ]));
  }
  function titleBackground(): void {
    elements.push(node("title_void", { ...rect(0, 0, w, h), background: [0.01, 0.012, 0.018, 1] }));
    const scale = h / 450;
    for (let index = 0; index < Math.ceil(w / (333 * scale)); index++) elements.push(art(`title_arch_${index}`, "title_arch", index * 333 * scale, 0, 333 * scale, 100 * scale));
    elements.push(art("title_cluster", "title_cluster", w * 0.42, h * 0.18, 450 * scale, 250 * scale));
    elements.push(art("title_mid", "title_mid", w * 0.05, h * 0.3, 273 * scale, 242 * scale));
    elements.push(art("title_front", "title_front", w * 0.75, h * 0.62, 112 * scale, 116 * scale));
  }
  function titleScreen(): void {
    titleBackground();
    const land = m.landscape, bannerW = land ? 240 : 139, bannerH = land ? 57 : 100;
    const top = Math.max(bannerH - 6, h * 0.45);
    if (language === "en") elements.push(art("spd_banner", land ? "title_land" : "title_port", (w - bannerW) / 2, 2 + (top - bannerH) / 2));
    else {
      const title = t(land ? "title.name" : "title.portrait");
      const titleWidth = Math.max(...title.split("\n").map((line) => textWidth(line, 18)));
      elements.push(label("spd_banner", title, (w - titleWidth) / 2, 2 + (top - (land ? 24 : 48)) / 2, titleWidth + 1, 18, titleColor, 54));
    }
    const area = land ? 234 : 133, left = (w - area) / 2;
    const gap = Math.max(2, Math.floor((h - top - (land ? 3 : 4) * 20) / 3 / (land ? 3 : 5)));
    const y = top + gap;
    if (land) {
      elements.push(control("start", t("menu.start"), left, y, area / 2 - 1, 20, "toast", "enter"));
      elements.push(control("support", t("menu.support"), left + area / 2 + 1, y, area / 2 - 1, 20, "toast", "support"));
      for (const [index, id] of ["rankings", "journal", "news", "settings", "changes", "about"].entries()) {
        const cw = Math.floor(area / 3) - 1;
        elements.push(control(id, t(`menu.${id}` as MessageKey), left + index % 3 * (cw + 2), y + (1 + Math.floor(index / 3)) * (20 + gap), cw, 20, "toast", id));
      }
    } else {
      elements.push(control("start", t("menu.start"), left, y, area, 20, "toast", "enter"));
      elements.push(control("support", t("menu.support"), left, y + 20 + gap, area, 20, "toast", "support"));
      for (const [index, id] of ["rankings", "journal", "news", "changes", "settings", "about"].entries()) {
        elements.push(control(id, t(`menu.${id}` as MessageKey), left + index % 2 * (area / 2 + 1), y + (2 + Math.floor(index / 2)) * (20 + gap), area / 2 - 1, 20, "toast", id));
      }
    }
    elements.push(label("version", "v0.1.0", w - 26, h - 8, 24, 5, grey));
    elements.push(iconControl("exit", "exit", w - 20, 0));
  }
  function heroScreen(): void {
    titleBackground();
    const heroName = t(`hero.${state.selectedClass}.name`);
    const leftArea = m.landscape ? Math.max(100, w / 3) : w;
    const backgroundWidth = h * 800 / 450;
    const backgroundLeft = (w - backgroundWidth) / 2 + (m.landscape ? leftArea / 6 : 0);
    elements.push(image("hero_splash", `sprites/spd/${state.selectedClass}.jpg`, { ...rect(backgroundLeft, 0, backgroundWidth, h), imageMode: "stretch" }));
    if (m.landscape) elements.push(art("hero_text_shade", "hero_fade", 0, 0, leftArea + 8, h));
    const uiHeight = Math.min(h - 20, 300), uiTop = (h - uiHeight) / 2;
    const spacing = (uiHeight - 120) / 2 - (uiHeight >= 160 ? 5 : 0) - (uiHeight >= 180 ? 6 : 0);
    if (m.landscape) elements.push(label("hero_select_title", t("hero.choose"), (leftArea - 110) / 2, uiTop, 110, 12, titleColor));
    const selectorY = m.landscape ? uiTop + 16 + spacing : h - 24;
    const heroButtons = ["warrior", "mage", "rogue", "huntress", "duelist", "cleric"] as const;
    const portraitWidth = Math.min(35, w / 6);
    heroButtons.forEach((hero, index) => {
      const bx = m.landscape ? (leftArea - 107) / 2 + index % 3 * 36 : (w - portraitWidth * 6) / 2 + index * portraitWidth;
      const by = m.landscape ? selectorY + Math.floor(index / 3) * 31 : selectorY;
      const button = control(`hero_${hero}`, "", bx, by, m.landscape ? 35 : portraitWidth, m.landscape ? 30 : 24, "toast", undefined, `select:${hero}`);
      const iconX = ((m.landscape ? 35 : portraitWidth) - 12) / 2;
      const brightness = hero === state.selectedClass ? 1 : heroClassList.includes(hero as HeroClass) ? 0.6 : 0.1;
      button.children = [...(button.children ?? []), art(`hero_icon_${hero}`, `hero_${hero}`, iconX, m.landscape ? 7.5 : 4.5, 12, 15, [brightness, brightness, brightness, 1])];
      elements.push(button);
    });
    const nameY = m.landscape ? selectorY + 66 : h - 95;
    const nameWidth = textWidth(heroName, 9), nameLeft = (leftArea - nameWidth - 20) / 2;
    if (m.landscape) elements.push(label("hero_class_label", heroName, nameLeft, nameY, nameWidth + 4, 9, titleColor));
    if (m.landscape) elements.push(label("hero_description", wrappedText(t(`hero.${state.selectedClass}.description`), 80, 6).join("\n"), (leftArea - 80) / 2, nameY + 16, 80, 6, white, 56));
    elements.push(control("begin_run", m.landscape ? t("common.start") : heroName, m.landscape ? (leftArea - 64) / 2 : (w - 64) / 2, m.landscape ? uiTop + uiHeight - 21 : h - 43, 64, 21, "toast", "enter"));
    elements.push(iconControl("hero_info", "info", m.landscape ? nameLeft + nameWidth : (w + 64) / 2, m.landscape ? nameY : h - 43));
    elements.push(iconControl("back", "exit", w - 20, 0));
  }
  function inventoryContent(): { width: number; height: number; children: UiElement[] } {
    let slotWidth = 28, slotHeight = 28;
    if (m.landscape) {
      while (slotHeight >= 24 && 14 + slotHeight * 5 + 4 + 20 + 6 > h) slotHeight--;
    } else {
      while (slotWidth >= 26 && slotWidth * 5 + 4 + 12 > w) slotWidth--;
    }
    const width = slotWidth * 5 + 4, height = 14 + slotHeight * 5 + 4;
    const children: UiElement[] = [label("bag_title", t("bag.title"), 0, 2, width - 25, 8, titleColor), image("bag_gold", "sprites/dungeon/gold.png", rect(width - 15, 0, 12, 12)), label("bag_gold_count", `${state.gold}`, width - 38, 3, 23, 6, titleColor)];
    type Supply = ItemKind | "worn_key" | "goo_blob";
    type Entry = { type: "supply"; key: Supply } | { type: "gear"; item: GearItem };
    const quantity = (key: Supply): number => key === "worn_key" ? state.wornKeys : key === "goo_blob" ? state.gooBlobs : state.inventory[key];
    const items: Supply[] = [...Object.keys(itemCatalog) as ItemKind[], "worn_key", "goo_blob"];
    const carried: Entry[] = [...items.filter((key) => quantity(key) > 0).map((key): Entry => ({ type: "supply", key })),
      ...state.equipment.filter((item) => !item.equipped).map((item): Entry => ({ type: "gear", item }))];
    for (let index = 0; index < 25; index++) {
      const x = index % 5 * (slotWidth + 1), y = 14 + Math.floor(index / 5) * (slotHeight + 1);
      const entry = carried[index - 5];
      const key = entry?.type === "supply" ? entry.key : undefined;
      const equipped = index < 5;
      const worn = index === 0 ? equippedGear(state.equipment, "weapon") : index === 1 ? equippedGear(state.equipment, "armor") : undefined;
      const gear = worn ?? (entry?.type === "gear" ? entry.item : undefined);
      const childrenSlot: UiElement[] = [];
      if (gear) {
        childrenSlot.push(image(`gear_icon_${gear.id}`, `sprites/dungeon/${gear.kind}.png`, rect((slotWidth - 16) / 2, (slotHeight - 16) / 2, 16, 16)));
        if (gear.level) childrenSlot.push(label(`gear_level_${gear.id}`, `+${gear.level}`, 1, 1, slotWidth - 2, 6, titleColor));
        if (gear.kind === "mages_staff") childrenSlot.push(label(`gear_charge_${gear.id}`, `${staffCharges(gear.id)}/${staffCapacity(gear.level)}`, 1, slotHeight - 8, slotWidth - 2, 5));
      } else if (equipped) {
        childrenSlot.push(art(`equipment_${index}`, ["empty_weapon", "empty_armor", "empty_artifact", "empty_ring", "empty_ring"][index]!, (slotWidth - 16) / 2, (slotHeight - 16) / 2));
      } else if (key) {
        childrenSlot.push(image(`item_ico_${key}`, `sprites/dungeon/${key}.png`, rect((slotWidth - 16) / 2, (slotHeight - 16) / 2, 16, 16)));
        if (key === "spirit_bow") {
          if (spiritBowLevel(state.level)) childrenSlot.push(label("item_level_spirit_bow", `+${spiritBowLevel(state.level)}`, 1, 1, slotWidth - 2, 6));
        } else childrenSlot.push(label(`item_count_${key}`, `${quantity(key)}`, 1, 1, slotWidth - 2, 6));
      }
      children.push({ kind: "button", id: gear ? `gear_slot_${gear.id}` : key ? `slot_${key}` : `bag_slot_${index}`, onClick: gear ? () => on(`gear:${gear.id}`) : key ? () => on(key === "worn_key" || key === "goo_blob" ? key : "item", key) : undefined,
        style: { ...rect(x, y, slotWidth, slotHeight), background: equipped ? [145 / 255, 147 / 255, 140 / 255, 153 / 255] : [83 / 255, 86 / 255, 77 / 255, 153 / 255] }, children: childrenSlot });
    }
    children.push(control("close_bag", "", -3, height + 2, 25, 17, "toast", "bag_icon"));
    return { width, height, children };
  }
  function hud(): void {
    const large = m.large;
    if (large) {
      // StatusPane large: background has fixed 33px left and 4px right margins.
      elements.push(art("status_avatar_back", "status_left", 0, 0));
      elements.push(art("status_middle", "status_middle", 33, 0, 123, 39));
      elements.push(art("status_right", "status_right", 156, 0));
      elements.push(art("health_fill", "hp_large", 30, 19, Math.max(0, 128 * state.health / state.maxHealth), 9));
      elements.push(art("experience_fill", "xp_large", 30, 30, Math.max(0, 128 * state.experience / state.targetExperience), 7));
      const hpText = `${Math.ceil(state.health)}/${state.maxHealth}`, xpText = `${state.experience}/${state.targetExperience}`;
      elements.push(label("hud_health", hpText, 30 + (128 - textWidth(hpText, 6)) / 2, 20, 128, 6, [1, 1, 1, 0.6]));
      elements.push(label("hud_experience", xpText, 30 + (128 - textWidth(xpText, 6)) / 2, 30, 128, 6, [1, 1, 170 / 255, 0.6]));
    } else {
      elements.push(art("status_back", "status", 0, 0));
      elements.push(art("health_fill", "hp", 30, 2, Math.max(0, 50 * state.health / state.maxHealth), 4));
      elements.push(art("experience_fill", "xp", 2, 30, Math.max(0, 17 * state.experience / state.targetExperience), 4));
      elements.push(label("hud_health", `${Math.ceil(state.health)}/${state.maxHealth}`, 31, 2, 48, 3, [1, 1, 1, 0.6]));
      elements.push(label("hud_experience", `${state.experience}/${state.targetExperience}`, 3, 30, 17, 3, [1, 1, 170 / 255, 0.6]));
    }
    elements.push(art("hud_hero_icon", `avatar_${state.selectedClass}`, 9.5, 8.5, 11, 15));
    const levelText = large ? t("hud.level", { level: state.level }) : `${state.level}`;
    elements.push(label("hud_level", levelText, large ? (30 - textWidth(levelText, 6)) / 2 : 25.5 - textWidth(levelText, 6) / 2, large ? 30 : 28, 30, 6, [1, 1, 170 / 255, 1]));
    elements.push({ kind: "button", id: "hero_info", onClick: () => on("hero_info"), style: rect(0, 0, 30, 36), children: [] });
    elements.push({ kind: "button", id: "hero_info_bar", onClick: () => on("hero_info"), style: large ? rect(30, 19, 130, 20) : rect(30, 0, 50, 9), children: [] });
    elements.push(art("menu_pane", "menu_pane", w - 31, 0));
    elements.push(label("hud_version", "v0.1.0", w - 28, 1, 27, 5, grey));
    elements.push({ kind: "button", id: "pause", onClick: () => on("pause"), style: rect(w - 16, 0, 16, 21), children: [art("menu_icon", "menu", 2, 8)] });
    elements.push({ kind: "button", id: "game_journal", onClick: () => on("game_journal"), style: rect(w - 31, 0, 17, 21), children: [art("journal_button", "journal_button", 2, 8), art("journal_button_icon", "journal_button_icon", 3, 10.5)] });
    elements.push({ kind: "button", id: "descend", onClick: () => on("descend"), style: rect(w - 43, 4, 12, 24), children: [art("hud_stairs", "stairs", 5, 4, 7, 8)] });
    elements.push(label("hud_wave", `${state.depth}`, w - 38, 16, 7, 4));
    if (state.hunger !== "satiated") elements.push(label("hud_hunger", state.hunger === "starving" ? t("hud.starving") : t("hud.hungry"), large ? 32 : 33, large ? 4 : 10, 80, 6, titleColor));
    if (state.invisible) elements.push(label("hud_invisible", t("hud.invisible"), 33, large ? 10 : 18, 70, 6, titleColor));
    const statuses = [
      ["healing", state.healing], ["burning", state.burning], ["ooze", state.ooze],
    ] as const;
    statuses.filter(([, amount]) => amount > 0).forEach(([name, amount], index) => {
      elements.push(label(`hud_${name}`, t(`hud.${name}`, { amount }), large ? 162 : 86, 2 + index * 9, large ? 82 : 40, 6, titleColor, 9));
    });
    if (state.lockedFloor !== null) elements.push(label("hud_locked_floor", state.lockedFloor >= 1
      ? t("hud.lockedFloor", { amount: Math.ceil(state.lockedFloor) }) : t("hud.lockedFloorOff"),
      large ? 162 : 86, 29, large ? 82 : 40, 6, titleColor, 9));
    const toolbarX = !m.large && m.landscape ? w - 64 : w - 24, toolbarY = h - 26;
    const waitX = m.large ? w - 44 : m.landscape ? w - 20 : 0;
    const searchX = m.large ? w - 64 : m.landscape ? w - 40 : 20;
    elements.push({ kind: "button", id: "bag_btn", onClick: () => on("bag_btn"), style: rect(toolbarX, toolbarY, 24, 26), children: [art("bag_tool", "bag_tool", 0, 0), art("bag_tool_icon", "bag_tool_icon", 4, 5)] });
    elements.push({ kind: "button", id: "wait", onClick: () => on("wait"), style: rect(waitX, toolbarY, 20, 26), children: [art("wait_tool", "wait_tool", 0, 0), art("wait_tool_icon", "wait_tool_icon", 2, 5)] });
    elements.push({ kind: "button", id: "search", onClick: () => on("search"), style: rect(searchX, toolbarY, 20, 26), children: [art("search_tool", "search_tool", 0, 0), art("search_tool_icon", "search_tool_icon", 2, 5)] });
    if (state.targeting) {
      const promptWidth = Math.max(90, w - 30), lines = wrappedText(t(state.targeting === "staff" ? "target.staff" : state.targeting === "bow" ? "target.bow" : "target.flame"), promptWidth, 6);
      elements.push(label("target_prompt", lines.join("\n"), 2, 44, promptWidth, 6, titleColor, lines.length * 8));
      elements.push(control("cancel_target", t("common.close"), w - 28, 44, 26, 14, "toast", undefined, "cancel_target", true, 6));
    } else if (state.examining) {
      const promptWidth = Math.max(90, w - 30), lines = wrappedText(t("examine.prompt"), promptWidth, 6);
      elements.push(label("examine_prompt", lines.join("\n"), 2, 44, promptWidth, 6, titleColor, lines.length * 8));
      elements.push(control("cancel_examine", t("common.close"), w - 28, 44, 26, 14, "toast", undefined, "cancel_examine", true, 6));
    } else if (state.profile.showHints) {
      const lines = wrappedText(t("log.guide"), w - 4, 6);
      elements.push(label("hud_hint", lines.join("\n"), 2, 44, w - 4, 6, grey, lines.length * 8));
    }
    const staff = state.equipment.find((gear) => gear.kind === "mages_staff");
    const quick: (ItemKind | GearItem | null)[] = staff
      ? [staff, "potion_healing", "potion_liquid_flame", "potion_invisibility", "scroll_upgrade", null]
      : state.inventory.spirit_bow > 0
      ? ["spirit_bow", "potion_healing", "potion_liquid_flame", "potion_invisibility", "scroll_upgrade", null]
      : ["potion_healing", "potion_liquid_flame", "potion_invisibility", "scroll_upgrade", null, null];
    const count = 4 + Number(w > 152) + Number(w > 170);
    let quickRight = m.large ? searchX : toolbarX;
    for (let offset = 0; offset < count; offset++) {
      const index = m.large ? count - 1 - offset : offset, entry = quick[index];
      const gear = entry && typeof entry === "object" ? entry : undefined, item = typeof entry === "string" ? entry : undefined;
      const name = gear?.kind ?? item;
      const quantity = gear ? `${staffCharges(gear.id)}/${staffCapacity(gear.level)}` : item === "spirit_bow"
        ? (spiritBowLevel(state.level) ? `+${spiritBowLevel(state.level)}` : "") : item ? `${state.inventory[item]}` : "";
      const side = m.large ? (index === 0 ? "left" : index === count - 1 ? "right" : "middle") : (index === 0 ? "right" : index === count - 1 ? "left" : "middle");
      const width = side === "left" ? 20 : side === "right" ? 19 : 18;
      quickRight -= width;
      elements.push({ kind: "button", id: gear ? `quick_staff_${gear.id}` : item ? `quick_${item}` : `quick_empty_${index}`,
        onClick: gear ? () => on(`zap:${gear.id}`) : item ? () => on("quick", item) : undefined, style: rect(quickRight, h - 24, width, 24), children: [
        art(`quick_frame_${index}`, `quick_${side}`, 0, 0), ...(name ? [image(`quick_icon_${index}`, `sprites/dungeon/${name}.png`, rect((width - 16) / 2, 3, 16, 16)), label(`quick_count_${index}`, quantity, 2, 2, 14, 5)] : []),
      ] });
    }
    const logWidth = Math.max(90, w - 90);
    const logLines = state.logs.slice(0, 3).reverse().map((entry) => wrappedText(entry, logWidth, 6));
    const logHeights = logLines.map((lines) => Math.max(10, Math.ceil(lines.length * 7.2) + 2));
    let logY = h - 32 - logHeights.reduce((sum, height) => sum + height, 0);
    logLines.forEach((lines, index) => {
      elements.push(label(`log_line_${index}`, lines.join("\n"), 2, logY, logWidth, 6, index === logLines.length - 1 ? white : grey, logHeights[index]!));
      logY += logHeights[index]!;
    });
    if (state.bossHealth !== null) elements.push(node("boss_panel", rect((w - 100) / 2, 2, 100, 10), [
      node("boss_track", { ...rect(0, 5, 100, 3), background: [0.1, 0.03, 0.03, 1] }),
      node("boss_fill", { ...rect(0, 5, Math.max(0, state.bossHealth), 3), background: [0.65, 0.05, 0.04, 1] }), label("boss_label", t("monster.boss"), 0, -2, 100, 6, titleColor),
    ]));
  }

  const menuPhases: UiPhase[] = ["menu", "rankings", "journal", "news", "changes", "about", "support"];
  if (state.phase === "heroes") heroScreen();
  else if ((state.phase === "hero" || state.phase === "message") && !state.gameBehind) heroScreen();
  else if (state.phase === "journal" && state.gameBehind) hud();
  else if (menuPhases.includes(state.phase) || (state.phase === "settings" && !state.gameBehind)) titleScreen();
  else hud();

  if (state.phase === "message") {
    const lines = wrappedText(state.notice, 120, 6), height = Math.max(8, Math.ceil(lines.length * 7.2));
    window("message_window", 120, height, [label("message_text", lines.join("\n"), 0, 0, 120, 6, white, height)]);
  }
  else if (state.phase === "paused") window("pause_window", 120, 42, [
    control("settings", t("menu.settings"), 0, 0, 120, 20, "red", "settings"),
    control("home", t("menu.home"), 0, 22, 120, 20, "red", "display"),
  ]);
  else if (state.phase === "inventory" || state.phase === "item" || state.phase === "equipment" || state.phase === "upgrade") {
    const bag = inventoryContent(); window("bag_window", bag.width, bag.height, bag.children);
    if (state.phase === "item") {
      const def = itemCatalog[state.item];
      const bowStats = state.item === "spirit_bow" ? `\n${t("bow.stats", { min: spiritBowRange(state.level)[0], max: spiritBowRange(state.level)[1],
        strength: spiritBowStrength(state.level), delay: spiritBowDelay(state.level, state.strength, true).toFixed(2), level: spiritBowLevel(state.level) })}` : "";
      const lines = wrappedText(t(`item.${state.item}.description`) + bowStats, 120, 6), descriptionHeight = Math.ceil(lines.length * 7.2);
      const buttonY = 20 + descriptionHeight;
      window("item_window", 120, buttonY + 16, [
        image("item_detail_icon", `sprites/dungeon/${state.item}.png`, rect(0, 0, 16, 16)),
        label("item_detail_title", t(`item.${state.item}.name`), 20, 1, 100, 9, titleColor, 26),
        label("item_detail_desc", lines.join("\n"), 0, 18, 120, 6, white, descriptionHeight),
        control(`use_${state.item}`, state.item === "spirit_bow" ? t("item.shoot") : state.item === "potion_liquid_flame" ? t("item.throw") : def.category === "food" ? t("item.eat") : def.category === "scroll" ? t("item.read") : t("item.drink"), 0, buttonY, 120, 16, "red", undefined, `use_${state.item}`, true, 8),
      ]);
    } else if (state.phase === "equipment") {
      const gear = state.equipment.find((item) => item.id === state.selectedGear);
      if (gear) {
        const spec = gearDefinitions[gear.kind], range = spec.slot === "weapon" ? weaponRange(gear) : armorRange(gear);
        const description = t(spec.slot === "weapon" ? "gear.weaponStats" : "gear.armorStats", {
          min: range[0], max: range[1], strength: strengthRequired(gear), delay: attackDelay(gear, state.strength).toFixed(2),
        }) + (state.strength < strengthRequired(gear) ? `\n${t("gear.tooHeavy")}` : "")
          + (gear.kind === "mages_staff" ? `\n${t("gear.staffMagic", { min: staffDamageRange(gear.level)[0], max: staffDamageRange(gear.level)[1],
            charges: staffCharges(gear.id), capacity: staffCapacity(gear.level) })}` : "");
        const lines = wrappedText(description, 132, 6), buttonY = 26 + Math.ceil(lines.length * 7.2);
        const cost = !gear.equipped && equippedGear(state.equipment, spec.slot) ? 2 : 1;
        window("equipment_window", 132, buttonY + 30, [
          image("gear_detail_icon", `sprites/dungeon/${gear.kind}.png`, rect(0, 0, 16, 16)),
          label("gear_detail_title", `${t(`item.${gear.kind}.name`)}${gear.level ? ` +${gear.level}` : ""}`, 20, 1, 112, 8, titleColor, 24),
          label("gear_detail_stats", lines.join("\n"), 0, 24, 132, 6, white, buttonY - 24),
          control("toggle_equipment", t(gear.equipped ? "gear.remove" : "gear.equip"), 0, buttonY, gear.kind === "mages_staff" ? 64 : 132, 16),
          ...(gear.kind === "mages_staff" ? [control("zap_staff", t("item.zap"), 68, buttonY, 64, 16, "red", undefined, `zap:${gear.id}`, staffCharges(gear.id) > 0)] : []),
          label("gear_action_cost", t("gear.cost", { cost }), 0, buttonY + 19, 132, 6, grey, 10),
        ]);
      }
    } else if (state.phase === "upgrade") {
      const perPage = Math.max(1, Math.min(5, Math.floor((h - 60) / 18)));
      const pages = Math.max(1, Math.ceil(state.equipment.length / perPage));
      const page = state.upgradePage % pages, choices = state.equipment.slice(page * perPage, (page + 1) * perPage);
      window("upgrade_window", 132, 34 + choices.length * 18, [
        label("upgrade_title", t("gear.chooseUpgrade"), 0, 0, 132, 8, titleColor),
        ...choices.map((item, index) => control(`upgrade_${item.id}`, `${t(`item.${item.kind}.name`)} +${item.level}`, 0, 14 + index * 18, 132, 16, "red", undefined, `upgrade:${item.id}`, true, 7)),
        control("upgrade_cancel", t("common.close"), 0, 16 + choices.length * 18, pages > 1 ? 64 : 132, 16, "toast", undefined, "modal_close"),
        ...(pages > 1 ? [control("upgrade_page", t("common.next"), 68, 16 + choices.length * 18, 64, 16, "toast")] : []),
      ]);
    }
  } else if (state.phase === "hero") {
    window("hero_window", 120, 126, [
      art("hero_detail_icon", `avatar_${state.selectedClass}`, 0, 0, 22, 30),
      label("hero_detail_title", t("hero.level", { level: state.level, hero: t(`hero.${state.selectedClass}.name`) }), 28, 4, 92, 9, titleColor, 22),
      label("hero_stats", t("hero.stats", { health: Math.ceil(state.health), maxHealth: state.maxHealth, strength: state.strength, experience: state.experience, target: state.targetExperience, gold: state.gold }), 0, 34, 120, 8, white, 60),
      label("hero_combat", t("gear.heroCombat", { attack: attackSkill(equippedGear(state.equipment, "weapon"), state.strength, state.level), defense: defenseSkill(equippedGear(state.equipment, "armor"), state.strength, state.level), delay: attackDelay(equippedGear(state.equipment, "weapon"), state.strength).toFixed(2) }), 0, 96, 120, 6, grey, 10),
      control("hero_stats_tab", t("hero.statsTab"), 0, 108, 58, 16, "grey"), control("hero_talents_tab", t("hero.talents"), 60, 108, 60, 16, "toast", undefined, "hero_talents_tab", false),
    ]);
  } else if (state.phase === "settings") {
    const width = m.landscape ? 223 : 122, height = Math.min(156, h - 36), content: UiElement[] = [];
    const headings = ["settings.display", "settings.ui", "settings.input", "settings.data", "settings.audio", "settings.language"] as const;
    content.push(label("settings_title", t(headings[state.settingsTab]!), 0, 0, width, 9, titleColor));
    const names = ["display", "settings", "input", "data", "audio", "langs"];
    names.forEach((name, index) => { content.push(control(`settings_tab_${index}`, "", index * (width / 6), height - 18, width / 6 - 1, 18, state.settingsTab === index ? "grey" : "toast", name, `tab:${index}`)); });
    if (state.settingsTab === 0) {
      content.push(label("display_scale_label", t("settings.scale"), 0, 22, width, 8));
      content.push(control("window_landscape", t("settings.landscape"), 0, 38, width, 18));
      content.push(control("window_portrait", t("settings.portrait"), 0, 58, width, 18));
    } else if (state.settingsTab === 1) {
      content.push(control("hints", t("settings.hints", { value: t(state.profile.showHints ? "common.on" : "common.off") }), 0, 24, width, 18, "grey"));
      content.push(control("motion", t("settings.motion", { value: t(state.profile.reducedMotion ? "common.on" : "common.off") }), 0, 45, width, 18, "grey"));
    } else if (state.settingsTab === 2) {
      content.push(control("sensitivity", t("settings.sensitivity", { value: state.profile.sensitivity.toFixed(2) }), 0, 24, width, 18, "toast", undefined, "sensitivity", false));
      content.push(label("input_bindings", wrappedText(t("settings.bindings"), width, 7).join("\n"), 0, 49, width, 7, white, 50));
      content.push(label("sensitivity_unavailable", wrappedText(t("settings.absolutePointer"), width, 6).join("\n"), 0, 102, width, 6, grey, 28));
    } else if (state.settingsTab === 3) {
      content.push(label("saved_stats", t("settings.stats", { best: state.profile.bestScore, wins: state.profile.wins, runs: state.profile.runs }), 0, 18, width, 7, white, 24));
      content.push(label("save_notice", state.saveNotice || t("save.device"), 0, 43, width, 6, grey, 25));
      content.push(control("seed", t("settings.seed", { seed: state.profile.seed }), 0, 71, width, 16, "grey"));
      content.push(control("retry_save", t("settings.save"), 0, 90, width / 2 - 1, 16));
      content.push(control("reset_save", t("settings.clear"), width / 2 + 1, 90, width / 2 - 1, 16));
    } else if (state.settingsTab === 4) {
      content.push(label("audio_music", t("settings.music"), 0, 26, width, 8, grey), label("audio_sfx", t("settings.sfx"), 0, 62, width, 8, grey));
      content.push(node("music_slider", { ...rect(0, 43, width, 3), background: [0.3, 0.3, 0.3, 1] }), node("sfx_slider", { ...rect(0, 79, width, 3), background: [0.3, 0.3, 0.3, 1] }));
    } else {
      content.push(control("language_english", language === "en" ? `${t("language.en")} (${t("settings.current")})` : t("language.en"), 0, 24, width, 20, language === "en" ? "grey" : "red"));
      content.push(control("language_chinese", language === "zh-CN" ? `${t("language.zh-CN")}（${t("settings.current")}）` : t("language.zh-CN"), 0, 48, width, 20, language === "zh-CN" ? "grey" : "red"));
      content.push(label("language_hint", wrappedText(t("settings.languageHint"), width, 6).join("\n"), 0, 76, width, 6, grey, 30));
    }
    window("settings_window", width, height, content);
    if (state.resetPending) window("reset_window", 120, 60, [label("reset_warning", t("settings.reset"), 0, 0, 120, 8, titleColor, 22), control("confirm_reset", t("common.yes"), 0, 40, 59, 18), control("cancel_reset", t("common.no"), 61, 40, 59, 18)]);
  } else if (state.phase === "won" || state.phase === "lost") {
    if (language === "en") elements.push(art("result_banner", state.phase === "won" ? "boss_slain" : "game_over", (w - 128) / 2, h * 0.12));
    else {
      const title = t(state.phase === "won" ? "result.bannerWin" : "result.bannerLose"), width = textWidth(title, 16);
      elements.push(label("result_banner", title, (w - width) / 2, h * 0.12, width + 1, 16, titleColor, 24));
    }
    window("result_window", 120, 100, [
      label("result_title", state.phase === "won" ? t("result.win") : t("result.lose"), 0, 0, 120, 9, titleColor),
      label("result_stats", t("result.stats", { score: state.score, depth: state.depth, level: state.level }), 0, 18, 120, 7, white, 26),
      ...(state.phase === "won" ? [label("result_boundary", wrappedText(t("result.boundary"), 120, 6).join("\n"), 0, 40, 120, 6, grey, 16)] : []),
      control("restart", t("result.restart"), 0, 58, 120, 20, "red", "enter"),
      control("home", t("menu.home"), 0, 80, 120, 20, "red", "display"),
    ], true, Math.min(h * 0.66, h - 58));
  } else if (state.phase === "checks") {
    const lines = state.checks.slice(state.checkPage * 6, state.checkPage * 6 + 6);
    window("checks_window", 190, 146, [label("checks_title", t("checks.title"), 0, 0, 190, 9, titleColor),
      ...lines.map((line, index) => label(`check_${index}`, line, 0, 16 + index * 13, 190, 6, white, 12)),
      label("network_status", state.networkStatus, 0, 96, 190, 6, grey, 18),
      control("check_page", t("common.next"), 0, 124, 60, 18), control("network", "HTTP", 64, 124, 60, 18), control("back", t("common.back"), 128, 124, 60, 18),
    ]);
  } else if (menuPhases.includes(state.phase) && state.phase !== "menu") {
    const page = state.phase;

    window(`${page}_window`, 170, 132, [label(`${page}_title`, t(`menu.${page}` as MessageKey), 0, 0, 170, 9, titleColor), label(`${page}_content`, t(`page.${page}` as MessageKey, { best: state.profile.bestScore, runs: state.profile.runs, wins: state.profile.wins }), 0, 18, 170, 7, white, 94), control("back", t("common.close"), 0, 114, 170, 18)]);
  }
  return node("safe_root", { position: "absolute", left: m.left, top: m.top, width: Math.round(w * s), height: Math.round(h * s) }, elements);
}
