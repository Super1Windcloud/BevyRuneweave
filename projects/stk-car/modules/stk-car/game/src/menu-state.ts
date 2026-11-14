import { menuData } from "./menu-data.js";
import { sourceText, tr } from "./localization.js";
import type { PcSession } from "./session.js";

export interface MenuDialog { page: string; title: string; purpose?: string; }
export interface MenuChoice { value: string | number; label: string; }
export const optionPages = ["options_general", "options_display", "options_video", "options_audio", "options_ui", "user_screen_tab", "options_input", "options_language"];
export const optionTabs = ["tab_general", "tab_display", "tab_video", "tab_audio", "tab_ui", "tab_players", "tab_controls", "tab_language"];
export const modeChoices = [
  ["normal", "Normal Race", "mode_normal"], ["time-trial", "Time Trial", "mode_tt"], ["follow", "Follow the Leader", "mode_ftl"],
  ["battle", "Battle", "mode_weapons"], ["soccer", "Soccer", "mode_soccer"], ["eggs", "Egg Hunt", "mode_easter"], ["ghost", "Ghost Replay", "mode_ghost"], ["lap", "Lap Trial", "mode_laptrial"],
] as const;

export class MenuState {
  page = "";
  dialog: MenuDialog | null = null;
  values: Record<string, string | number | boolean> = {};
  fields: Record<string, string> = {};
  editing = "";
  status = "";
  track = "lighthouse";
  grandPrix = menuData.grandPrix[0]?.id ?? "";
  raceMode = "normal";
  scoreMode = "normal";
  profiles = ["Player"];
  player = 0;
  players = 1;
  achievement = 0;
  listPages: Record<string, number> = {};
  draftTracks: string[] = [];
  draftName = "";
  selectedRow = 0;
  show(page: string): void { this.page = page; this.status = ""; this.editing = ""; }
  popup(page: string, title: string, purpose = ""): void { this.dialog = { page, title, purpose }; this.editing = ""; this.status = ""; }
  close(): void { this.dialog = null; this.editing = ""; this.status = ""; }
  get activePage(): string { return this.dialog?.page ?? this.page; }
  get selectedTrack() { return menuData.tracks.find((track) => track.id === this.track) ?? menuData.tracks.find((track) => track.id === "lighthouse")!; }
  key(id: string): string { return `${this.activePage}:${id}`; }
  text(id: string, fallback = ""): string { return this.fields[this.key(id)] ?? fallback; }
  setText(id: string, value: string): void { this.fields[this.key(id)] = value.slice(0, 96); }
  checked(id: string, session: PcSession): boolean {
    if (id === "music_enabled") return session.settings.musicVolume > 0;
    if (id === "sfx_enabled") return session.settings.sfxVolume > 0;
    if (id === "option" || id === "reverse") return session.settings.reverse;
    return Boolean(this.values[this.key(id)]);
  }
  toggle(id: string, session: PcSession): void {
    if (id === "music_enabled" || id === "sfx_enabled") {
      const key = id === "music_enabled" ? "musicVolume" : "sfxVolume", last = `last-${key}`;
      if (session.settings[key]) { this.values[last] = session.settings[key]; session.settings[key] = 0; }
      else session.settings[key] = Number(this.values[last]) || 0.6;
    } else if (id === "option" || id === "reverse") session.settings.reverse = !session.settings.reverse;
    else this.values[this.key(id)] = !this.checked(id, session);
  }
  choices(id: string): MenuChoice[] {
    const options: Record<string, string[]> = {
      kart_class: ["All", "Light", "Medium", "Heavy"], base_skinchoice: ["Classic", "Cartoon"], variant_skinchoice: ["Default", "Ocean", "Forest", "Ruby"],
      minimap: ["Bottom-left", "Right", "Hidden"], camera_preset: ["Standard", "Close", "Far", "Custom"], splitscreen_method: ["Vertical", "Horizontal"],
      vsync: ["Off", "30", "60", "120", "Unlimited"], benchmarkSelect: ["Lighthouse", "Overworld"], render_driver: ["Automatic", "OpenGL", "Vulkan"],
      filter_date: ["Any time", "Last week", "Last month"], filter_rating: ["0", "1", "2", "3"], filter_installation: ["All", "Installed", "Not installed"], filter_featured: ["All", "Featured"],
      server_type: ["All", "Ranked", "Private", "Public"], "more-options-spinner": ["Normal Race", "Grand Prix"], "target-type-spinner": ["Laps", "Time"], "name-spinner": this.profiles,
    };
    return (options[id] ?? []).map((value) => ({ value, label: sourceText(value) }));
  }
  number(id: string, session: PcSession): number {
    if (id === "music_volume") return Math.round(session.settings.musicVolume * 10);
    if (id === "sfx_volume") return Math.round(session.settings.sfxVolume * 10);
    if (id === "target-value-spinner" || id === "laps") return session.settings.laps;
    if (id === "ai-spinner") return Number(this.values[this.key(id)] ?? session.settings.aiCount);
    const defaults: Record<string, number> = { scale_rtts: 100, gfx_level: 3, blur_level: 2, max_players: 8, font_size: 100, fov: 55, camera_distance: 4, camera_angle: 18, smooth_position: 5, smooth_rotation: 5, shadows: 2, image_quality: 2, geometry_detail: 2 };
    return Number(this.values[this.key(id)] ?? defaults[id] ?? 0);
  }
  adjust(id: string, direction: number, session: PcSession, min = 0, max = 10): void {
    const choices = this.choices(id);
    if (choices.length) {
      const current = this.values[this.key(id)] ?? choices[0].value, index = choices.findIndex((choice) => choice.value === current);
      this.values[this.key(id)] = choices[(index + direction + choices.length) % choices.length].value; return;
    }
    if (id === "target-value-spinner" || id === "laps") { min = 1; max = 20; }
    if (id === "ai-spinner") { min = 0; max = 20; }
    const step = id === "scale_rtts" || id === "font_size" ? 10 : 1;
    const value = Math.max(min, Math.min(max, this.number(id, session) + direction * step));
    if (id === "music_volume") session.settings.musicVolume = value / 10;
    else if (id === "sfx_volume") session.settings.sfxVolume = value / 10;
    else if (id === "target-value-spinner" || id === "laps") session.settings.laps = value;
    else { this.values[this.key(id)] = value; if (id === "ai-spinner" && value <= 3) session.settings.aiCount = value; }
  }
  display(id: string, session: PcSession): string {
    const choices = this.choices(id);
    if (choices.length) { const value = this.values[this.key(id)] ?? choices[0].value; return choices.find((choice) => choice.value === value)?.label ?? `${value}`; }
    return `${this.number(id, session)}`;
  }
  preview(): void { this.status = tr("Interface preview. This service or game mode is not connected yet.", "界面预览：此服务或游戏模式暂未接入。"); }
}
