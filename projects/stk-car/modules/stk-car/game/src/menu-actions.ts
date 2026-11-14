import { menuData } from "./menu-data.js";
import { setUiLanguage, sourceText, tr } from "./localization.js";
import { optionPages, optionTabs } from "./menu-state.js";
import type { PcSession, Screen } from "./session.js";
import { courseFor, defaultCourse } from "./courses.js";

export function menuPageFor(session: PcSession): string {
  const pages: Partial<Record<Screen, string>> = { kart: "karts", setup: "race_setup", tracks: "tracks_and_gp", "track-info": "track_info" };
  return pages[session.screen] ?? session.menu.page;
}
export function menuAction(session: PcSession, id: string, changed: () => void, start: () => void): void {
  const m = session.menu, page = m.activePage;
  const go = (target: string, screen: Screen = "menu") => session.openMenu(target, screen);
  const popup = (target: string, title: string, purpose = "") => m.popup(target, title, purpose);
  if (id === "back" || id === "cancel" || id === "backbtn" || id === "back_to_device_list") {
    if (id === "back_to_device_list") m.show("options_input"); else session.back();
  } else if (id.startsWith("page") && /^page[1-7]$/.test(id)) m.show(`help${id.slice(4)}`);
  else if (optionTabs.includes(id)) m.show(optionPages[optionTabs.indexOf(id)]);
  else if (id === "tab_achievements") m.show("profile_achievements");
  else if (id === "tab_friends") m.show("profile_friends");
  else if (id === "tab_settings") m.show("profile_settings");
  else if (id.startsWith("choose-")) {
    const kart = id.slice(7);
    if (session.settings.kartId === kart) go("race_setup", "setup");
    else session.settings.kartId = kart;
  } else if (page === "karts" && id === "continue") go("race_setup", "setup");
  else if (["novice", "intermediate", "expert", "best", "supertux"].includes(id)) session.settings.difficulty = Math.min(3, ["novice", "intermediate", "expert", "best", "supertux"].indexOf(id));
  else if (id.startsWith("mode-")) {
    m.raceMode = id.slice(5);
    if (m.raceMode === "normal" || m.raceMode === "time-trial") session.settings.mode = m.raceMode;
    go("tracks_and_gp", "tracks");
  } else if (id.startsWith("track:")) {
    const trackId = id.slice(6), course = courseFor(trackId); m.track = trackId;
    if (course && session.settings.trackId !== trackId) { session.settings.trackId = trackId; session.settings.laps = course.defaultLaps; }
    if (page !== "edit_track") go("track_info", "track-info");
  }
  else if (id.startsWith("gp:")) {
    m.grandPrix = id.slice(3);
    if (page !== "grand_prix_editor") go("gp_info");
  } else if (page === "gp_info" && id === "single-race") {
    m.track = defaultCourse.id; session.settings.trackId = defaultCourse.id; session.settings.laps = defaultCourse.defaultLaps;
    m.raceMode = "normal"; m.players = 1; session.settings.mode = "normal"; go("track_info", "track-info");
  } else if (page === "gp_info" && ["start", "continue"].includes(id)) {
    popup("confirm_dialog", tr("Grand Prix is currently a menu preview. Choose a single race to play.", "大奖赛当前为菜单预览，请选择单场比赛进入游戏。"), "preview");
  } else if (id === "start" && page === "track_info") {
    if (courseFor(m.track) && m.players === 1 && (m.raceMode === "time-trial" || m.raceMode === "normal" && m.number("ai-spinner", session) <= 3)) { session.settings.trackId = m.track; start(); }
    else { popup("confirm_dialog", tr("This configuration is a menu preview. Playable tracks: Hacienda and Lighthouse; singleplayer with up to three AI karts.", "此配置目前仅供菜单预览；可玩庄园和灯塔赛道，支持单人及最多三名 AI。"), "preview"); }
  } else if (id === "random_track") { m.track = menuData.tracks.find((track) => !track.arena)?.id ?? "lighthouse"; go("track_info", "track-info"); }
  else if (id === "rand-gp") { m.grandPrix = menuData.grandPrix[0].id; go("gp_info"); }
  else if (id.startsWith("group:") || id.startsWith("filter:")) { m.values[m.key("group")] = id.split(":")[1]; m.listPages = {}; }
  else if (id.startsWith("score-mode:")) { m.scoreMode = id.slice(11); }
  else if (id.startsWith("tab_") && page === "high_score_selection") { m.scoreMode = id; }
  else if (id.startsWith("tab_") && page === "addons_screen") { m.values["addon-category"] = id; }
  else if (id.startsWith("resolution:")) { m.values.resolution = id.slice(11); m.preview(); }
  else if (id.startsWith("score:")) popup("high_score_info_dialog", sourceText(m.selectedTrack.name));
  else if (id === "remove-all") popup("confirm_dialog", tr("Clear high scores?", "清空最高成绩？"), "clear-scores");
  else if (id.startsWith("achievement:")) { m.achievement = Number(id.slice(12)); popup("achievement_progress_dialog", sourceText(menuData.achievements[m.achievement]?.name ?? "Achievements")); }
  else if (id.startsWith("language:")) {
    session.settings.language = id.slice(9) as typeof session.settings.language; setUiLanguage(session.settings.language);
  } else if (id.startsWith("profile:")) { m.player = Number(id.slice(8)); }
  else if (id === "new_user" || id === "rename" && ["user_screen", "user_screen_tab"].includes(page)) {
    popup("general_text_field_dialog", sourceText(id === "new_user" ? "Add player" : "Rename"), id === "new_user" ? "new-player" : "rename-player");
    m.setText("textfield", id === "new_user" ? `${tr("Player", "玩家")} ${m.profiles.length + 1}` : m.profiles[m.player]);
  } else if (id === "delete" && ["user_screen", "user_screen_tab"].includes(page)) popup("confirm_dialog", tr("Remove this local player from the menu?", "从菜单中移除此本地玩家？"), "delete-player");
  else if (id === "default_kart_color") { popup("custom_camera_settings", sourceText("Kart color"), "kart-color"); m.preview(); }
  else if (id === "ok" && page === "user_screen") session.back();
  else if (id === "password_reset") popup("recovery_input", sourceText("Account Recovery"));
  else if (id === "user-id") go("user_screen");
  else if (id === "register" || id === "register_button") go("register");
  else if (id === "lan") go("lan");
  else if (id === "wan") go("profile_servers");
  else if (id === "online") go("profile_friends");
  else if (id === "find_lan_server" || id === "find_wan_server") go("server_selection");
  else if (id === "create_lan_server" || id === "create_wan_server") go("create_server");
  else if (id === "quick_wan_play") { go("server_selection"); m.preview(); }
  else if (id === "enter-address") popup("enter_address_dialog", sourceText("Enter server address"));
  else if (id === "create" && page === "create_server") { go("networking_lobby"); m.preview(); }
  else if (id === "join" || id === "ok" && page === "enter_address_dialog") { m.close(); go("networking_lobby"); m.preview(); }
  else if (id === "change_password_button") popup("change_password", sourceText("Password Change"));
  else if (id === "change_email_button") { popup("general_text_field_dialog", sourceText("Email Address"), "email"); }
  else if (id === "search_button") go("user_search");
  else if (id.startsWith("tab_new_") || id === "tab_existing_online" || id === "tab_offline") m.values["account-mode"] = id;
  else if (id === "next" && page === "register") popup("registration_terms", sourceText("Terms and Agreement"));
  else if (id === "custom" && page === "options_video") popup("custom_video_settings", sourceText("Graphics Settings"));
  else if (id === "custom_camera") popup("custom_camera_settings", sourceText("Camera Settings"));
  else if (id === "device:keyboard") m.show("options_device");
  else if (id === "device:touch") go("touch_controls");
  else if (id === "add_device" || id.startsWith("binding:")) popup("press_a_key_dialog", sourceText("Press fully and release..."), id);
  else if (id === "startTutorial") { go("help1", "help"); m.status = tr("Tutorial interface preview. Driving instructions are shown below.", "教程界面预览，驾驶说明见下方。"); }
  else if (page === "splitscreen_player_dialog" && id === "add") { m.players = Math.min(4, m.players + 1); m.status = tr(`${m.players} local players (preview)`, `${m.players} 名本地玩家（预览）`); }
  else if (page === "splitscreen_player_dialog" && id === "reset") { m.players = 2; m.preview(); }
  else if (page === "splitscreen_player_dialog" && id === "connect") { m.close(); m.preview(); }
  else if (id === "selectkart") go("karts", "kart");
  else if (id === "options") session.open("options");
  else if (id === "help") session.open("help");
  else if (id === "exit") { session.screen = "main"; m.close(); }
  else if (id.startsWith("challenge:")) { m.track = id.slice(10); popup("select_challenge", sourceText(m.selectedTrack.name)); }
  else if (id === "new" && page === "grand_prix_editor" || id === "rename" && page === "grand_prix_editor") {
    popup("general_text_field_dialog", sourceText(id === "new" ? "New Grand Prix" : "Rename"), "gp-name"); m.setText("textfield", m.draftName || sourceText("New Grand Prix"));
  } else if (id === "edit" && page === "grand_prix_editor" || id === "copy" && page === "grand_prix_editor") {
    const gp = menuData.grandPrix.find((gp) => gp.id === m.grandPrix)!;
    m.draftTracks = [...gp.tracks]; m.draftName = sourceText(gp.name); go("edit_gp");
  } else if (page === "edit_gp" && id === "add") go("edit_track");
  else if (page === "edit_gp" && id === "edit") go("edit_track");
  else if (page === "edit_gp" && id === "remove") { m.draftTracks.splice(m.selectedRow, 1); m.selectedRow = Math.max(0, m.selectedRow - 1); }
  else if (page === "edit_gp" && (id === "up" || id === "down")) {
    const next = Math.max(0, Math.min(m.draftTracks.length - 1, m.selectedRow + (id === "up" ? -1 : 1)));
    [m.draftTracks[m.selectedRow], m.draftTracks[next]] = [m.draftTracks[next], m.draftTracks[m.selectedRow]]; m.selectedRow = next;
  } else if (id.startsWith("draft-row:")) m.selectedRow = Number(id.slice(10));
  else if (page === "edit_track" && id === "ok") { m.draftTracks.push(m.track); session.back(); }
  else if (page === "edit_gp" && id === "save") { m.status = tr("Draft updated locally. Grand Prix racing is not connected yet.", "草稿已在本次会话更新，大奖赛竞赛逻辑暂未接入。"); }
  else if (m.dialog && id === "ok" && page === "general_text_field_dialog") {
    const name = m.text("textfield").trim().slice(0, 32), purpose = m.dialog.purpose;
    if (!name) m.status = tr("Please enter a name.", "请输入名称。");
    else {
      if (purpose === "new-player") { m.profiles.push(name); m.player = m.profiles.length - 1; }
      if (purpose === "rename-player") m.profiles[m.player] = name;
      if (purpose === "gp-name") { m.draftName = name; m.draftTracks = []; m.close(); go("edit_gp"); }
      else m.close();
    }
  } else if (m.dialog && id === "confirm") {
    const purpose = m.dialog.purpose;
    if (purpose === "quit") { app_request_exit(); m.close(); }
    else if (purpose === "delete-player" && m.profiles.length > 1) { m.profiles.splice(m.player, 1); m.player = 0; m.close(); }
    else { m.close(); m.preview(); }
  } else if (m.dialog && ["apply", "accept", "assignEsc", "assignNone", "ok"].includes(id)) { m.close(); }
  else m.preview();
  changed();
}

export function pollMenuText(session: PcSession, changed: () => void): boolean {
  const m = session.menu;
  if (!m.editing) return false;
  if (input_key_just_pressed("Enter") || input_key_just_pressed("Escape")) { m.editing = ""; changed(); return true; }
  let value = m.text(m.editing), next = value;
  if (input_key_just_pressed("Backspace")) next = value.slice(0, -1);
  const shift = input_key_pressed("ShiftLeft") || input_key_pressed("ShiftRight");
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (input_key_just_pressed(`Key${letter}`)) next += shift ? letter : letter.toLowerCase();
  for (const digit of "0123456789") if (input_key_just_pressed(`Digit${digit}`)) next += shift ? ")!@#$%^&*("[Number(digit)] : digit;
  for (const [code, character] of [["Space", " "], ["Period", "."], ["Minus", shift ? "_" : "-"], ["Semicolon", shift ? ":" : ";"], ["Slash", "/"]]) {
    if (input_key_just_pressed(code)) next += character;
  }
  if (next !== value) { m.setText(m.editing, next); changed(); }
  return true;
}
