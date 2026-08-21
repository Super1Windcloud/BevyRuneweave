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
  "lobby_reference",
  "lobby_tab_panel",
  "lobby_tab_item_0",
  "lobby_tab_item_1",
  "lobby_tab_item_2",
  "lobby_tab_item_3",
];

const textIds = [
  "lobby_tab_selection",
  "lobby_tab_title",
  "lobby_tab_subtitle",
  "lobby_tab_item_label_0",
  "lobby_tab_item_label_1",
  "lobby_tab_item_label_2",
  "lobby_tab_item_label_3",
];

const settingsIds = ["lobby_settings_panel", "lobby_settings_title", "lobby_settings_close", "lobby_settings_exit"];
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

interface NormalizedHitArea {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

const settingsHitArea: NormalizedHitArea = {
  centerX: 0.912,
  centerY: 0.141,
  width: 0.12,
  height: 0.065,
};
const battleHitArea: NormalizedHitArea = {
  centerX: 0.505,
  centerY: 0.827,
  width: 0.35,
  height: 0.09,
};
const navigationTop = 0.924;
const navigationHitArea: NormalizedHitArea = {
  centerX: 0.5,
  centerY: (navigationTop + 1) * 0.5,
  width: 1,
  height: 1 - navigationTop,
};

function frameX(layout: ScreenLayout, normalizedX: number): number {
  return layout.left + layout.width * normalizedX;
}

function frameY(layout: ScreenLayout, normalizedY: number): number {
  return layout.top - layout.height * normalizedY;
}

function pointerInsideHitArea(
  pointer: PrimaryPointer,
  layout: ScreenLayout,
  area: NormalizedHitArea,
): boolean {
  return pointerInside(
    pointer,
    frameX(layout, area.centerX),
    frameY(layout, area.centerY),
    layout.width * area.width,
    layout.height * area.height,
  );
}

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

    const tabWidth = layout.width / tabs.length;
    if (pointer.justPressed && pointerInsideHitArea(pointer, layout, settingsHitArea)) {
      this.openSettings(layout);
      return { type: "layout" };
    }

    const battlePressed = pointer.justPressed && pointerInsideHitArea(pointer, layout, battleHitArea);
    if (this.tab === "battle" && (battlePressed || keyJustPressed("Space") || keyJustPressed("Enter"))) {
      return { type: "start-matchmaking" };
    }

    if (pointer.justPressed && pointerInsideHitArea(pointer, layout, navigationHitArea)) {
      const index = Math.max(0, Math.min(tabs.length - 1, Math.floor((pointer.x - layout.left) / tabWidth)));
      this.tab = tabs[index];
      this.applyLayout(layout);
      setGameState(0, 3, `LOBBY:${this.tab.toUpperCase()}`);
      return { type: "layout" };
    }
    return { type: "none" };
  }

  private applyLayout(layout: ScreenLayout): void {
    placeSprite("lobby_reference", {
      path: sprites.homeReference.path,
      width: layout.width,
      height: layout.height,
    }, layout.centerX, layout.centerY, -100);

    this.applyNavigation(layout);
    this.applyTabContent(layout);
  }

  private applyNavigation(layout: ScreenLayout): void {
    if (this.tab === "battle") {
      setTransform("lobby_tab_selection", { x: layout.right + 10_000, y: 0, z: 0 });
      return;
    }
    const tabWidth = layout.width / tabs.length;
    const index = tabs.indexOf(this.tab);
    placeText(
      "lobby_tab_selection",
      `[${tabLabels[this.tab]}]`,
      layout.left + tabWidth * (index + 0.5),
      frameY(layout, 0.967),
      20,
      12 * layout.scale,
      colors.gold,
    );
  }

  private applyTabContent(layout: ScreenLayout): void {
    const hiddenX = layout.right + 10_000;
    if (this.tab === "battle") {
      for (const id of tabContentIds) setTransform(id, { x: hiddenX, y: 0, z: 0 });
      return;
    }

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
