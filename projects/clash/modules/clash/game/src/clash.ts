import { set3dEnabled } from "../../api/scene.js";
import { primaryPointer } from "../../api/input.js";
import { setWindowSize, windowSafeArea } from "../../api/window.js";
import { BattleController } from "./battle.js";
import {
  DESKTOP_WINDOW_HEIGHT,
  DESKTOP_WINDOW_WIDTH,
} from "./config.js";
import {
  createScreenLayout,
  FALLBACK_SAFE_AREA,
  layoutKey,
  type ScreenLayout,
} from "./layout.js";
import { LobbyController, MatchmakingController } from "./lobby.js";

type AppRoute = "lobby" | "matchmaking" | "battle";

const lobby = new LobbyController();
const matchmaking = new MatchmakingController();
const battle = new BattleController();

let route: AppRoute = "lobby";
let layout: ScreenLayout = createScreenLayout(DESKTOP_WINDOW_WIDTH, FALLBACK_SAFE_AREA);
let currentLayoutKey = "";

function readLayout(): ScreenLayout {
  const pointer = primaryPointer();
  return createScreenLayout(pointer.viewportWidth, windowSafeArea());
}

function applyLayout(nextLayout: ScreenLayout): void {
  layout = nextLayout;
  currentLayoutKey = layoutKey(nextLayout);
  if (route === "lobby") lobby.resize(nextLayout);
  else if (route === "matchmaking") matchmaking.resize(nextLayout);
  else battle.resize(nextLayout);
}

function showLobby(): void {
  route = "lobby";
  set3dEnabled(false);
  lobby.show(layout);
  currentLayoutKey = layoutKey(layout);
}

function showMatchmaking(): void {
  route = "matchmaking";
  set3dEnabled(false);
  matchmaking.show(layout);
  currentLayoutKey = layoutKey(layout);
}

function showBattle(): void {
  route = "battle";
  set3dEnabled(false);
  battle.show(layout);
  currentLayoutKey = layoutKey(layout);
}

function initialize(): void {
  setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
  layout = readLayout();
  showLobby();
}

const callbacks = globalThis as typeof globalThis & RuneweaveCallbacks;

callbacks.on_script_loaded = initialize;
callbacks.on_script_reloaded = initialize;

callbacks.on_update = function (dt: number): void {
  const pointer = primaryPointer();
  const nextLayout = createScreenLayout(pointer.viewportWidth, windowSafeArea());
  if (layoutKey(nextLayout) !== currentLayoutKey) applyLayout(nextLayout);

  if (route === "lobby") {
    const action = lobby.update(pointer);
    if (action.type === "start-matchmaking") showMatchmaking();
    return;
  }

  if (route === "matchmaking") {
    const result = matchmaking.update(dt, pointer);
    if (result === "cancel") showLobby();
    else if (result === "ready") showBattle();
    return;
  }

  battle.update(dt, pointer);
};
