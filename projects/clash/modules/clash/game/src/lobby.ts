import { clearScene, despawnSceneEntity, setGameState, setTransform } from "../../api/scene.js";
import { keyJustPressed, type PrimaryPointer } from "../../api/input.js";
import { requestExit } from "../../api/app.js";
import { cards, DESIGN_HEIGHT, DESIGN_WIDTH, sprites } from "./config.js";
import type { ScreenLayout } from "./layout.js";
import { colors, placeSprite, placeText, pointerInside, spawnSprite, spawnText } from "./ui.js";

export type LobbyTab = "shop" | "cards" | "battle" | "social" | "league";

export type LobbyAction =
  | { type: "none" }
  | { type: "start-matchmaking" }
  | { type: "layout" }
  | { type: "exit" };

const tabs: readonly LobbyTab[] = ["shop", "cards", "battle", "social", "league"];
const tabLabels: Record<LobbyTab, string> = {
  shop: "SHOP",
  cards: "CARDS",
  battle: "BATTLE",
  social: "CLAN",
  league: "LEAGUE",
};

const spriteIds = [
  "lobby_background",
  "lobby_profile_panel",
  "lobby_arena",
  "lobby_arena_king",
  "lobby_arena_king_local",
  "lobby_trophy_track",
  "lobby_chest_0",
  "lobby_chest_1",
  "lobby_chest_2",
  "lobby_chest_3",
  "lobby_battle_button",
  "lobby_nav",
  "lobby_level_panel",
  "lobby_gold_panel",
  "lobby_gems_panel",
  "lobby_avatar",
  "lobby_settings",
  "lobby_tab_panel",
  "lobby_tab_item_0",
  "lobby_tab_item_1",
  "lobby_tab_item_2",
  "lobby_tab_item_3",
];

const textIds = [
  "lobby_level",
  "lobby_gold",
  "lobby_gems",
  "lobby_player",
  "lobby_clan",
  "lobby_trophies",
  "lobby_arena_title",
  "lobby_arena_subtitle",
  "lobby_chest_badge",
  "lobby_battle_label",
  "lobby_battle_mode",
  "lobby_tab_title",
  "lobby_tab_subtitle",
  "lobby_tab_item_label_0",
  "lobby_tab_item_label_1",
  "lobby_tab_item_label_2",
  "lobby_tab_item_label_3",
  ...tabs.map((tab) => `lobby_tab_${tab}`),
];

const settingsIds = ["lobby_settings_panel", "lobby_settings_title", "lobby_settings_close", "lobby_settings_exit"];
const battleContentIds = [
  "lobby_arena",
  "lobby_arena_king",
  "lobby_arena_king_local",
  "lobby_trophy_track",
  "lobby_arena_title",
  "lobby_arena_subtitle",
  "lobby_chest_0",
  "lobby_chest_1",
  "lobby_chest_2",
  "lobby_chest_3",
  "lobby_chest_badge",
  "lobby_battle_button",
  "lobby_battle_label",
  "lobby_battle_mode",
];
const tabContentIds = [
  "lobby_tab_panel",
  "lobby_tab_title",
  "lobby_tab_subtitle",
  "lobby_tab_item_0",
  "lobby_tab_item_1",
  "lobby_tab_item_2",
  "lobby_tab_item_3",
  "lobby_tab_item_label_0",
  "lobby_tab_item_label_1",
  "lobby_tab_item_label_2",
  "lobby_tab_item_label_3",
];

export class LobbyController {
  private tab: LobbyTab = "battle";
  private settingsOpen = false;
  private layout: ScreenLayout | null = null;

  show(layout: ScreenLayout): void {
    clearScene();
    this.layout = layout;
    this.tab = "battle";
    this.settingsOpen = false;
    for (const id of spriteIds) spawnSprite(id, sprites.homeResource);
    for (const id of textIds) spawnText(id);
    this.applyLayout(layout);
    setGameState(0, 3, "LOBBY");
  }

  resize(layout: ScreenLayout): void {
    this.layout = layout;
    this.applyLayout(layout);
    if (this.settingsOpen) this.applySettingsLayout(layout);
  }

  update(pointer: PrimaryPointer): LobbyAction {
    const layout = this.layout;
    if (!layout) return { type: "none" };
    if (this.settingsOpen) return this.handleSettings(pointer, layout);

    const scale = layout.scale;
    const navY = layout.bottom + 39 * scale;
    const tabWidth = layout.width / tabs.length;
    if (pointer.justPressed && pointerInside(
      pointer,
      layout.right - 27 * scale,
      layout.top - 83 * scale,
      50 * scale,
      50 * scale,
    )) {
      this.openSettings(layout);
      return { type: "layout" };
    }

    const battlePressed = pointer.justPressed && pointerInside(
      pointer,
      layout.centerX,
      layout.bottom + 136 * scale,
      Math.min(300 * scale, layout.width - 92 * scale),
      82 * scale,
    );
    if (this.tab === "battle" && (battlePressed || keyJustPressed("Space") || keyJustPressed("Enter"))) {
      return { type: "start-matchmaking" };
    }

    if (pointer.justPressed && pointerInside(pointer, layout.centerX, navY, layout.width, 78 * scale)) {
      const index = Math.max(0, Math.min(tabs.length - 1, Math.floor((pointer.x - layout.left) / tabWidth)));
      this.tab = tabs[index];
      this.applyLayout(layout);
      setGameState(0, 3, `LOBBY:${this.tab.toUpperCase()}`);
      return { type: "layout" };
    }
    return { type: "none" };
  }

  private applyLayout(layout: ScreenLayout): void {
    const scale = layout.scale;
    const top = layout.top;
    const bottom = layout.bottom;
    const centerX = layout.centerX;
    placeSprite("lobby_background", {
      path: sprites.homeBackground.path,
      width: Math.max(DESIGN_WIDTH, layout.viewportWidth),
      height: DESIGN_HEIGHT,
    }, 0, 0, -100);

    const resourceY = top - 27 * scale;
    const resourceGap = 7 * scale;
    const resourceWidth = Math.min(126 * scale, (layout.width - 2 * resourceGap) / 3);
    const resourceXs = [
      centerX - resourceWidth - resourceGap,
      centerX,
      centerX + resourceWidth + resourceGap,
    ];
    for (const [index, id] of ["lobby_level_panel", "lobby_gold_panel", "lobby_gems_panel"].entries()) {
      placeSprite(id, { path: sprites.homeResource.path, width: resourceWidth, height: 43 * scale }, resourceXs[index], resourceY, 20);
    }
    placeText("lobby_level", "18", resourceXs[0], resourceY, 22, 17 * scale, colors.white);
    placeText("lobby_gold", "113 +", resourceXs[1], resourceY, 22, 16 * scale, colors.white);
    placeText("lobby_gems", "100 +", resourceXs[2], resourceY, 22, 16 * scale, colors.white);

    const profileY = top - 90 * scale;
    placeSprite("lobby_profile_panel", { path: sprites.homeDeck.path, width: layout.width - 18 * scale, height: 88 * scale }, centerX, profileY, 8);
    placeSprite("lobby_avatar", { path: cards[0].art.path, width: 66 * scale, height: 60 * scale }, layout.left + 48 * scale, profileY + 3 * scale, 11);
    placeText("lobby_player", "BLUE KING", layout.left + 142 * scale, profileY + 14 * scale, 12, 19 * scale, colors.white);
    placeText("lobby_clan", "RUNEWEAVE CLAN", layout.left + 151 * scale, profileY - 14 * scale, 12, 11 * scale, colors.muted);
    placeText("lobby_trophies", "0 TROPHIES", layout.right - 84 * scale, profileY - 13 * scale, 12, 13 * scale, colors.gold);
    placeSprite("lobby_settings", { path: sprites.settingsIcon.path, width: 50 * scale, height: 50 * scale }, layout.right - 27 * scale, profileY + 9 * scale, 14);

    const arenaY = top - 316 * scale;
    placeSprite("lobby_arena", { path: sprites.homePlatform.path, width: Math.min(354 * scale, layout.width - 34 * scale), height: 254 * scale }, centerX, arenaY, 2);
    placeSprite("lobby_arena_king", { path: cards[2].art.path, width: 126 * scale, height: 98 * scale }, centerX, arenaY + 38 * scale, 5);
    placeSprite("lobby_arena_king_local", { path: "local-clash/chr_king.png", width: 116 * scale, height: 134 * scale }, centerX, arenaY + 30 * scale, 6);
    placeText("lobby_arena_title", "TRAINING CAMP", centerX, arenaY - 74 * scale, 9, 20 * scale, colors.white);
    placeText("lobby_arena_subtitle", "ARENA 1", centerX, arenaY - 99 * scale, 9, 13 * scale, colors.gold);
    placeSprite("lobby_trophy_track", { path: sprites.homeResource.path, width: 250 * scale, height: 26 * scale }, centerX, arenaY - 127 * scale, 8);

    const chestY = bottom + 242 * scale;
    const chestGap = 7 * scale;
    const chestWidth = Math.min(72 * scale, (layout.width - 56 * scale) / 4);
    const chestStart = centerX - (chestWidth * 3 + chestGap * 3) * 0.5;
    for (let index = 0; index < 4; index += 1) {
      placeSprite(`lobby_chest_${index}`, {
        path: index === 0 ? sprites.cardSelected.path : sprites.cardFrame.path,
        width: chestWidth,
        height: 68 * scale,
      }, chestStart + index * (chestWidth + chestGap), chestY, 12);
    }
    placeText("lobby_chest_badge", "1", chestStart + 3 * (chestWidth + chestGap) + chestWidth * 0.38, chestY + 30 * scale, 15, 16 * scale, colors.white);

    const buttonY = bottom + 136 * scale;
    placeSprite("lobby_battle_button", {
      path: sprites.homeBattleButton.path,
      width: Math.min(300 * scale, layout.width - 92 * scale),
      height: 82 * scale,
    }, centerX, buttonY, 12);
    placeText("lobby_battle_label", "BATTLE", centerX, buttonY + 7 * scale, 14, 32 * scale, colors.dark);
    placeText("lobby_battle_mode", "1v1  TROPHY ROAD", centerX, buttonY - 27 * scale, 14, 10 * scale, colors.dark);

    this.applyNavigation(layout);
    this.applyTabContent(layout);
  }

  private applyNavigation(layout: ScreenLayout): void {
    const scale = layout.scale;
    const navY = layout.bottom + 39 * scale;
    placeSprite("lobby_nav", { path: sprites.homeNav.path, width: layout.width, height: 76 * scale }, layout.centerX, navY, 10);
    const tabWidth = layout.width / tabs.length;
    for (const [index, tab] of tabs.entries()) {
      const selected = tab === this.tab;
      const x = layout.left + tabWidth * (index + 0.5);
      placeText(
        `lobby_tab_${tab}`,
        selected ? `[${tabLabels[tab]}]` : tabLabels[tab],
        x,
        navY,
        13,
        (selected ? 13 : 10) * scale,
        selected ? colors.gold : colors.muted,
      );
    }
  }

  private applyTabContent(layout: ScreenLayout): void {
    const hiddenX = layout.right + 10_000;
    if (this.tab === "battle") {
      for (const id of tabContentIds) setTransform(id, { x: hiddenX, y: 0, z: 0 });
      return;
    }
    for (const id of battleContentIds) setTransform(id, { x: hiddenX, y: 0, z: 0 });

    const scale = layout.scale;
    const panelY = layout.centerY - 31 * scale;
    placeSprite("lobby_tab_panel", {
      path: sprites.settingsPanel.path,
      width: layout.width - 24 * scale,
      height: Math.min(450 * scale, layout.height - 260 * scale),
    }, layout.centerX, panelY, 6);

    const titles: Record<Exclude<LobbyTab, "battle">, [string, string]> = {
      shop: ["DAILY SHOP", "REFRESH IN 4H"],
      cards: ["BATTLE DECK", "4 / 8 CARDS"],
      social: ["RUNEWEAVE CLAN", "3 MEMBERS ONLINE"],
      league: ["TROPHY ROAD", "0 / 400 TROPHIES"],
    };
    const [title, subtitle] = titles[this.tab];
    placeText("lobby_tab_title", title, layout.centerX, panelY + 168 * scale, 9, 25 * scale, colors.gold);
    placeText("lobby_tab_subtitle", subtitle, layout.centerX, panelY + 137 * scale, 9, 12 * scale, colors.muted);

    const itemLabels = this.tab === "shop"
      ? ["KNIGHT  40", "ARCHERS  40", "GIANT  100", "FREE GIFT"]
      : this.tab === "cards"
        ? cards.map((card) => `${card.name}  LV 1`)
        : this.tab === "social"
          ? ["BLUE KING", "ARCHER 01", "GIANT 02", "INVITE"]
          : ["TRAINING", "BRONZE", "SILVER", "GOLD"];
    const itemY = [panelY + 72 * scale, panelY - 22 * scale, panelY - 116 * scale, panelY - 116 * scale];
    const itemX = [layout.centerX - 94 * scale, layout.centerX + 94 * scale, layout.centerX - 94 * scale, layout.centerX + 94 * scale];
    for (let index = 0; index < 4; index += 1) {
      const art = this.tab === "league"
        ? (index < 2 ? sprites.towerBlue : sprites.towerRed)
        : cards[index].art;
      placeSprite(`lobby_tab_item_${index}`, {
        path: art.path,
        width: 74 * scale,
        height: 68 * scale,
      }, itemX[index], itemY[index] + 13 * scale, 9);
      placeText(`lobby_tab_item_label_${index}`, itemLabels[index], itemX[index], itemY[index] - 35 * scale, 10, 11 * scale, colors.white);
    }
  }

  private openSettings(layout: ScreenLayout): void {
    this.settingsOpen = true;
    spawnSprite("lobby_settings_panel", sprites.settingsPanel, layout.centerX, layout.centerY, 70);
    spawnText("lobby_settings_title");
    spawnText("lobby_settings_close");
    spawnText("lobby_settings_exit");
    this.applySettingsLayout(layout);
  }

  private closeSettings(): void {
    this.settingsOpen = false;
    for (const id of settingsIds) despawnSceneEntity(id);
  }

  private applySettingsLayout(layout: ScreenLayout): void {
    const scale = Math.min(layout.scale, (layout.height - 24) / 320);
    placeSprite("lobby_settings_panel", { path: sprites.settingsPanel.path, width: 420 * scale, height: 300 * scale }, layout.centerX, layout.centerY, 70);
    placeText("lobby_settings_title", "SETTINGS", layout.centerX, layout.centerY + 102 * scale, 72, 27 * scale, colors.white);
    placeText("lobby_settings_close", "CLOSE", layout.centerX, layout.centerY + 10 * scale, 72, 24 * scale, colors.blue);
    placeText("lobby_settings_exit", "EXIT GAME", layout.centerX, layout.centerY - 82 * scale, 72, 24 * scale, colors.red);
  }

  private handleSettings(pointer: PrimaryPointer, layout: ScreenLayout): LobbyAction {
    if (keyJustPressed("Escape")) {
      this.closeSettings();
      return { type: "layout" };
    }
    if (!pointer.justPressed) return { type: "none" };
    const scale = layout.scale;
    if (pointerInside(pointer, layout.centerX, layout.centerY + 10 * scale, 340 * scale, 70 * scale)) {
      this.closeSettings();
      return { type: "layout" };
    }
    if (pointerInside(pointer, layout.centerX, layout.centerY - 82 * scale, 340 * scale, 70 * scale)) {
      requestExit();
      return { type: "exit" };
    }
    return { type: "none" };
  }
}

export class MatchmakingController {
  private elapsed = 0;
  private layout: ScreenLayout | null = null;

  show(layout: ScreenLayout): void {
    clearScene();
    this.elapsed = 0;
    this.layout = layout;
    spawnSprite("matchmaking_background", sprites.homeBackground);
    spawnSprite("matchmaking_panel", sprites.settingsPanel);
    spawnText("matchmaking_title");
    spawnText("matchmaking_status");
    spawnText("matchmaking_cancel");
    this.resize(layout);
    setGameState(0, 3, "MATCHMAKING");
  }

  resize(layout: ScreenLayout): void {
    this.layout = layout;
    const scale = layout.scale;
    placeSprite("matchmaking_background", { path: sprites.homeBackground.path, width: Math.max(DESIGN_WIDTH, layout.viewportWidth), height: DESIGN_HEIGHT }, 0, 0, -100);
    placeSprite("matchmaking_panel", { path: sprites.settingsPanel.path, width: 420 * scale, height: 300 * scale }, layout.centerX, layout.centerY, 10);
    placeText("matchmaking_title", "FINDING OPPONENT", layout.centerX, layout.centerY + 78 * scale, 12, 25 * scale, colors.gold);
    placeText("matchmaking_cancel", "CANCEL", layout.centerX, layout.centerY - 83 * scale, 12, 20 * scale, colors.blue);
    this.updateStatus();
  }

  update(dt: number, pointer: PrimaryPointer): "waiting" | "ready" | "cancel" {
    const layout = this.layout;
    if (!layout) return "waiting";
    this.elapsed += Math.min(Math.max(dt, 0), 0.05);
    this.updateStatus();
    if (keyJustPressed("Escape") || (pointer.justPressed && pointerInside(
      pointer,
      layout.centerX,
      layout.centerY - 83 * layout.scale,
      320 * layout.scale,
      70 * layout.scale,
    ))) return "cancel";
    return this.elapsed >= 1.2 ? "ready" : "waiting";
  }

  private updateStatus(): void {
    const layout = this.layout;
    if (!layout) return;
    const dots = ".".repeat(Math.floor(this.elapsed * 3) % 4);
    placeText("matchmaking_status", `TRAINING BOT${dots}`, layout.centerX, layout.centerY, 12, 17 * layout.scale, colors.white);
  }
}
