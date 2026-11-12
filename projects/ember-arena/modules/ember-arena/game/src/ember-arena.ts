const callbacks = globalThis as unknown as RuneweaveCallbacks;
import { actor, change, field, kind, position } from "./actors.js";
import { clamp, dungeonMonsters, enemySpecs, getHungerStatus, heroClasses, heroClassList, itemCatalog, mobCombat, seededRandom,
  type EnemyKind, type HeroClass, type ItemKind, type Point } from "./rules.js";
import { canStep, cellDistance, cellKey, findPath, generateFloor, lineOfSight, reveal, sameCell, terrainAt, type DungeonFloor, type Terrain } from "./dungeon.js";
import { actorSprite, cellPosition, cellSize, mobSprites, monsterIds, placeCell, resizeGrid, sprite } from "./dungeon-actors.js";
import { defaultProfile, parseProfile, type Profile } from "./profile.js";
import { button, column, image, mountUi, node, row, text, updateUi, type UiElement, type UiStyle } from "../../api/ui.js";

type Phase = "menu" | "playing" | "paused" | "won" | "lost" | "checks" | "settings" | "inventory";

const ink = [0.055, 0.05, 0.04, 0.97] as const;
const amber = [1, 0.60, 0.20, 1] as const;
const muted = [0.55, 0.69, 0.71, 1] as const;
const teal = [0.17, 0.83, 0.65, 1] as const;
const crimson = [0.95, 0.25, 0.20, 1] as const;

let phase: Phase = "menu";
let returnPhase: Phase = "menu";
let selectedClass: HeroClass = "warrior";
let elapsed = 0;
let score = 0;
let level = 1;
let experience = 0;
let damage = 6;
let maxHealth = 20;
let strength = 10;
let depth = 1;
let turns = 0;
let actionCooldown = 0;
let floor: DungeonFloor | null = null;
let queuedPath: Point[] = [];
const renderedTiles = new Map<number, Terrain>();
const renderedFog = new Set<number>();
let nextId = 0;
let viewport = "";
let networkRequests: { id: number; method: string; elapsed: number }[] = [];
let networkStatus = "HTTP: NOT_RUN (use the network check button)";
let checks: string[] = [];
let profile: Profile = defaultProfile();
let saveNotice = "";
let saveBlocked = false;
let resetPending = false;
let settingsReturn: Phase = "menu";
let runRecorded = false;
let random = seededRandom(profile.seed);
let checkPage = 0;
let bagPage = 0;

// Shattered Pixel Dungeon core state
let gold = 0;
let hungerTimer = 0;
let invisTimer = 0;
let causticOozeTimer = 0;
let dungeonLogs: string[] = [];
let inventory: Record<ItemKind, number> = {
  potion_healing: 1,
  potion_liquid_flame: 1,
  potion_invisibility: 1,
  potion_strength: 0,
  scroll_upgrade: 1,
  scroll_magic_mapping: 0,
  food_ration: 1,
};

const compactUi = (): boolean => window_metrics().height > 0 && window_metrics().height < 650;
const uid = (prefix: string): string => `${prefix}_${nextId++}`;
const health = (): number => Math.max(0, field("player", "health"));
const targetExperience = (): number => 5 + level * 5;

function pushLog(entry: string): void {
  dungeonLogs.unshift(entry);
  if (dungeonLogs.length > 3) dungeonLogs.pop();
}

function loadProfile(): void {
  saveBlocked = false;
  saveNotice = "";
  profile = defaultProfile();
  const result = storage_read("profile");
  if (result.state === "error") {
    saveNotice = `Save unavailable (${result.error}). Playing in this session is safe.`;
    saveBlocked = result.error === "invalid_data" || result.error === "too_large";
  } else if (result.state === "ok") {
    try {
      profile = parseProfile(result.value);
    } catch {
      saveBlocked = true;
      saveNotice = "Existing save is incompatible. It will not be overwritten.";
    }
  }
}

function persistProfile(): void {
  if (saveBlocked) return;
  const result = storage_write("profile", JSON.stringify(profile));
  saveNotice = result.state === "ok" ? "Progress and settings saved." : `Save failed (${result.error}). You can retry in settings.`;
}

function openSettings(): void {
  settingsReturn = phase;
  resetPending = false;
  setPhase("settings");
}

function resetProfile(): void {
  const result = storage_remove("profile");
  if (result.state === "error") {
    saveNotice = `Reset failed (${result.error}). Existing save retained.`;
  } else {
    profile = defaultProfile();
    saveBlocked = false;
    saveNotice = "Saved progress reset. Your current run is unchanged.";
  }
  resetPending = false;
  drawUi();
}

function action(id: string, label: string, callback: () => void, primary = false): UiElement {
  return button(id, label, {
    onClick: callback,
    fontSize: compactUi() ? 12 : 16,
    color: primary ? [0.06, 0.08, 0.08, 1] : [0.9, 0.95, 0.95, 1],
    style: {
      width: "100%",
      height: compactUi() ? 36 : 48,
      borderRadius: 2,
      background: primary ? amber : [0.16, 0.14, 0.11, 1],
    },
  });
}

function itemAction(kindKey: ItemKind): UiElement {
  const def = itemCatalog[kindKey];
  const count = inventory[kindKey];
  const disabled = count <= 0;
  return row(`item_row_${kindKey}`, { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
    image(`item_ico_${kindKey}`, `sprites/dungeon/${kindKey}.png`, { width: compactUi() ? 20 : 24, height: compactUi() ? 20 : 24 }),
    column(`item_info_${kindKey}`, { flexGrow: 1 }, [
      text(`item_title_${kindKey}`, `${def.name}  x${count}`, { fontSize: compactUi() ? 12 : 14, color: disabled ? muted : teal }),
      text(`item_desc_${kindKey}`, def.description, { fontSize: 11, color: muted, style: { display: compactUi() ? "none" : "flex" } }),
    ]),
    button(`use_${kindKey}`, disabled ? "EMPTY" : `USE`, {
      onClick: () => { useInventoryItem(kindKey); drawUi(); },
      fontSize: 12,
      style: {
        width: 80,
        height: compactUi() ? 30 : 36,
        borderRadius: 2,
        background: disabled ? [0.08, 0.12, 0.14, 0.6] : amber,
      },
      color: disabled ? muted : [0.06, 0.08, 0.08, 1],
    }),
  ]);
}

function safeStyle(): UiStyle {
  const safe = window_safe_area();
  const pointer = input_primary_pointer();
  return {
    position: "absolute",
    left: `${(safe.leftInset / pointer.viewportWidth) * 100}%`,
    top: `${(safe.topInset / pointer.viewportHeight) * 100}%`,
    width: `${(safe.width / pointer.viewportWidth) * 100}%`,
    height: `${(safe.height / pointer.viewportHeight) * 100}%`,
  };
}

function panel(title: string, subtitle: string, content: UiElement[]): UiElement {
  return column("panel", {
    width: "90%",
    maxWidth: 470,
    padding: compactUi() ? 12 : 24,
    gap: compactUi() ? 6 : 12,
    background: ink,
    borderRadius: 2,
  }, [
    text("panel_kicker", "SHATTERED PIXEL DUNGEON", { fontSize: 12, color: amber }),
    text("panel_title", title, { fontSize: compactUi() ? 22 : 32 }),
    text("panel_subtitle", subtitle, {
      fontSize: compactUi() ? 11 : 14,
      color: muted,
      style: { display: compactUi() ? "none" : "flex" },
    }),
    ...content,
  ]);
}

function drawUi(): void {
  const pointer = input_primary_pointer();
  const safe = window_safe_area();
  const metrics = window_metrics();
  viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  const children: UiElement[] = [];

  if (phase === "playing") {
    const hunger = getHungerStatus(hungerTimer);
    const hungerColor = hunger === "satiated" ? teal : hunger === "hungry" ? amber : crimson;
    children.push(column("hud", { width: "100%", padding: 16, gap: 6 }, [
      row("hud_top", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
        row("hud_hero_box", { gap: 8, alignItems: "center" }, [
          image("hud_hero_icon", heroClasses[selectedClass].splash, { width: 28, height: 28 }),
          column("hud_stats", { gap: 2, flexGrow: 1 }, [
            text("hud_health", `VITALITY  ${Math.ceil(health())}`, { fontSize: 16, color: teal }),
            text("hud_score", `LV ${level} / ${score} PTS / ${gold} G`, { fontSize: 12, color: muted }),
          ]),
        ]),
        column("hud_center", { alignItems: "center", gap: 2 }, [
          row("hud_depth_row", { gap: 4, alignItems: "center" }, [
            image("hud_badge_icon", "sprites/spd/badges.png", { width: 16, height: 16 }),
            text("hud_wave", `SEWERS: DEPTH ${depth}`, { fontSize: 15, color: amber }),
          ]),
          text("hud_hunger", hunger.toUpperCase(), { fontSize: 11, color: hungerColor }),
        ]),
        row("hud_controls", { gap: 4 }, [
          button("bag_btn", "BAG [I]", {
            onClick: () => setPhase("inventory"),
            fontSize: 12,
            style: { width: 56, height: 40, background: [0.12, 0.22, 0.24, 1], borderRadius: 2 },
          }),
          button("pause", "II", {
            onClick: () => setPhase("paused"),
            fontSize: 18,
            style: { width: 44, height: 40, background: ink, borderRadius: 2 },
          }),
        ]),
      ]),
      node("health_track", { width: "100%", height: 4, background: [0.1, 0.2, 0.2, 0.7] }, [
        node("health_fill", { width: `${clamp((health() / maxHealth) * 100, 0, 100)}%`, height: 4, background: teal }),
      ]),
      text("hud_info", statusLine(), { fontSize: 12, color: muted }),
      column("boss_panel", { width: "100%", gap: 4, display: scene_actor("warden") ? "flex" : "none" }, [
        row("boss_title_row", { gap: 8, alignItems: "center" }, [
          image("boss_icon", "sprites/spd/goo.png", { width: 20, height: 20 }),
          image("boss_hp_frame", "sprites/spd/boss_hp.png", { width: 16, height: 16 }),
          text("boss_label", `GOO ${scene_actor("warden") ? Math.ceil(field("warden", "health")) : 0} / 100`, { fontSize: 14, color: amber }),
        ]),
        node("boss_track", { width: "100%", height: 5, background: ink }, [
          node("boss_fill", { width: `${scene_actor("warden") ? clamp(field("warden", "health"), 0, 100) : 0}%`, height: 5, background: crimson }),
        ]),
      ]),
      text("combat_notice", "", { fontSize: 15, color: amber }),
      column("hud_logs", { width: "100%", gap: 2, padding: 4 }, [
        ...dungeonLogs.map((entry, idx) =>
          text(`log_line_${idx}`, entry, { fontSize: 11, color: idx === 0 ? teal : muted })
        ),
      ]),
    ]));
    children.push(row("turn_controls", { position: "absolute", bottom: 36, left: 16, right: 16, gap: 8 }, [
      button("wait", "WAIT [SPACE]", { onClick: () => { queuedPath = []; spendTurns(); }, style: { width: "48%", height: 36, background: ink }, fontSize: 12 }),
      button("descend", "DESCEND [E]", { onClick: descend, style: { width: "48%", height: 36, background: ink }, fontSize: 12 }),
    ]));
    children.push(text("hint", "WASD/ARROWS: STEP OR ATTACK | CLICK: WALK | SPACE: WAIT | E: DESCEND | I: BAG", {
      fontSize: 11,
      color: muted,
      style: { position: "absolute", bottom: 12, left: 16, right: 16, display: profile.showHints ? "flex" : "none" },
    }));
  } else if (phase === "inventory") {
    children.push(panel("Hero's Backpack", `SEWERS / GOLD ${gold} / HUNGER: ${getHungerStatus(hungerTimer).toUpperCase()}`, [
      row("bag_header", { gap: 10, alignItems: "center" }, [
        image("bag_icon", "sprites/spd/items.png", { width: 32, height: 32 }),
        text("bag_title", "SEWER SATCHEL & ALCHEMY", { fontSize: 14, color: amber }),
      ]),
      ...(Object.keys(itemCatalog) as ItemKind[]).filter((_, index) => !compactUi() || Math.floor(index / 4) === bagPage).map(itemAction),
      ...(compactUi() ? [action("bag_page", `PAGE ${bagPage + 1} / 2 / NEXT`, () => { bagPage = (bagPage + 1) % 2; drawUi(); })] : []),
      action("close_bag", "CLOSE BACKPACK [ESC / I]", () => setPhase("playing"), true),
    ]));
  } else if (phase === "menu") {
    const heroSpec = heroClasses[selectedClass];
    children.push(panel("Descent into the Sewers", "Turn-based sewer expedition.\nExplore five depths and defeat Goo to complete this milestone.", [
      image("spd_banner", "sprites/spd/banners.png", { width: compactUi() ? 180 : 220, height: compactUi() ? 34 : 42 }),
      row("menu_art", { gap: 12, alignItems: "center" }, [
        image("menu_icon", "sprites/spd/amulet.png", { width: 32, height: 32 }),
        text("menu_controls", "Explore rooms, open doors and find the stairs.\nThe world waits until you take a turn.", { fontSize: 13, color: muted }),
      ]),
      row("hero_select_row", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
        image("hero_splash", heroSpec.splash, { width: compactUi() ? 46 : 56, height: compactUi() ? 46 : 56, borderRadius: 2 }),
        column("hero_desc_col", { flexGrow: 1, gap: 2 }, [
          text("hero_class_label", `CLASS: ${heroSpec.name}`, { fontSize: 16, color: amber }),
          text("hero_title_label", heroSpec.title, { fontSize: 12, color: teal }),
          text("hero_perks_label", heroSpec.perks, { fontSize: 11, color: muted }),
        ]),
        button("hero_class", "CYCLE HERO", {
          onClick: () => {
            const nextIdx = (heroClassList.indexOf(selectedClass) + 1) % heroClassList.length;
            selectedClass = heroClassList[nextIdx]!;
            room();
            drawUi();
          },
          fontSize: 12,
          style: { width: 110, height: 42, background: [0.15, 0.25, 0.28, 1], borderRadius: 2 },
        }),
      ]),
      action("start", "DESCEND INTO THE SEWERS", startRun, true),
      text("saved_stats", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}  /  SEED ${profile.seed}`, { fontSize: 12, color: teal }),
      action("settings", "SETTINGS & PROGRESS", openSettings),
      action("checks", "RUNTIME CHECKS", openChecks),
      action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
      text("credits", "In progress: Shattered Pixel Dungeon port (00-Evan / Watabou). See asset licenses.", { fontSize: 11, color: muted }),
    ]));
  } else if (phase === "paused") {
    children.push(panel("Sewer Rest Camp", "The subterranean conduits grow quiet. Prepare your next move.", [
      action("resume", "KEEP EXPLORING", () => setPhase("playing"), true),
      action("settings", "SETTINGS & PROGRESS", openSettings),
      action("checks", "RUNTIME CHECKS", openChecks),
      action("restart", "RESTART DESCENT", startRun),
      action("home", "MAIN MENU", loadMenu),
      action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
    ]));
  } else if (phase === "settings") {
    const changeSetting = (changeFn: () => void): void => { changeFn(); persistProfile(); drawUi(); };
    const pair = (id: string, first: UiElement, second: UiElement): UiElement => row(id, { width: "100%", justifyContent: "space-between" }, [
      column(`${id}_left`, { width: "49%" }, [first]), column(`${id}_right`, { width: "49%" }, [second]),
    ]);
    children.push(panel("Dungeon settings", `BEST ${profile.bestScore} / ${profile.wins} WINS / ${profile.runs} FINISHED RUNS`, [
      pair("settings_input", action("sensitivity", `DRAG  /  ${profile.sensitivity.toFixed(2)}x`, () => changeSetting(() => {
        const values = [0.75, 1, 1.25, 1.5]; profile.sensitivity = values[(values.indexOf(profile.sensitivity) + 1) % values.length]!;
      })), action("hints", `HINTS  /  ${profile.showHints ? "ON" : "OFF"}`, () => changeSetting(() => { profile.showHints = !profile.showHints; }))),
      pair("settings_effects", action("motion", `REDUCED FX  /  ${profile.reducedMotion ? "ON" : "OFF"}`, () => changeSetting(() => { profile.reducedMotion = !profile.reducedMotion; })),
        action("seed", `SEED  /  ${profile.seed}`, () => changeSetting(() => { profile.seed = (profile.seed + 1) >>> 0; }))),
      text("save_notice", saveNotice || "Your settings and finished-run records are saved locally.", { fontSize: 12, color: muted }),
      ...(resetPending ? [
        text("reset_warning", "Clear this game's saved records and settings?", { fontSize: 13, color: amber }),
        pair("reset_actions", action("confirm_reset", "CONFIRM RESET", resetProfile),
          action("cancel_reset", "KEEP MY DATA", () => { resetPending = false; drawUi(); })),
      ] : [
        pair("save_actions", action("retry_save", "RETRY SAVE", () => { persistProfile(); drawUi(); }),
          action("reset_save", "RESET SAVED PROGRESS", () => { resetPending = true; drawUi(); })),
      ]),
      action("settings_back", "BACK", () => setPhase(settingsReturn), true),
    ]));
  } else if (phase === "won" || phase === "lost") {
    children.push(panel(
      phase === "won" ? "The Sewers Are Cleared!" : "You Perished in the Sewers.",
      `${score} POINTS / LEVEL ${level} / ${turns} TURNS / DEPTH ${depth}`, [
        ...(phase === "won" ? [
          row("won_art", { gap: 12, alignItems: "center", justifyContent: "center" }, [
            image("victory_banner", "sprites/spd/banners.png", { width: 180, height: 36 }),
            image("victory_key", "sprites/dungeon/skeleton_key.png", { width: 44, height: 44 }),
            text("victory_key_label", "SKELETON KEY FOUND / SEWER MILESTONE", { fontSize: 13, color: amber }),
          ]),
        ] : [
          row("lost_art", { gap: 8, alignItems: "center", justifyContent: "center" }, [
            image("defeat_badge", "sprites/spd/badges.png", { width: 36, height: 36 }),
            text("defeat_label", "PERISHED IN THE SEWERS", { fontSize: 13, color: crimson }),
          ]),
        ]),
        text("result_note", phase === "won"
          ? "Goo has dissolved into primordial sludge. You have conquered the Sewers and recovered the Amulet!"
          : "The treacherous sewers claim another daring adventurer. Try another class and venture forth again!",
          { fontSize: 14, color: muted }),
        text("result_record", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}`, { fontSize: 14, color: teal }),
        text("result_save", saveNotice, { fontSize: 12, color: muted }),
        action("restart", "DESCENT AGAIN", startRun, true),
        action("home", "MAIN MENU", loadMenu),
        action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
      ]));
  } else {
    const pageSize = compactUi() ? 3 : 6;
    const pages = Math.max(1, Math.ceil(checks.length / pageSize));
    checkPage = Math.min(checkPage, pages - 1);
    children.push(panel("Runtime checks", "Contract checks run in the live script context.", [
      ...checks.slice(checkPage * pageSize, (checkPage + 1) * pageSize).map((line, index) =>
        text(`check_${index}`, line, { fontSize: compactUi() ? 11 : 12, color: line.startsWith("FAIL") ? [1, 0.3, 0.3, 1] : muted })
      ),
      action("check_page", `NEXT PAGE  /  ${checkPage + 1} OF ${pages}`, () => { checkPage = (checkPage + 1) % pages; drawUi(); }),
      text("network_status", networkStatus, { fontSize: 12, color: muted }),
      action("network", "CHECK HTTP (PUBLIC ECHO SERVICE)", checkNetwork),
      action("back", "BACK", () => setPhase(returnPhase), true),
    ]));
  }

  mountUi(column("safe_root", {
    ...safeStyle(),
    alignItems: "center",
    justifyContent: phase === "playing" ? "start" : "center",
  }, children));
}

function statusLine(): string {
  return `TURN ${turns} / STR ${strength} / XP ${experience}/${targetExperience()}${invisTimer > 0 ? ` / INVISIBLE ${invisTimer}` : ""}${causticOozeTimer > 0 ? ` / OOZE ${causticOozeTimer}` : ""}`;
}

function publish(): void {
  game_state_set(score, Math.ceil(health()), phase.toUpperCase());
}

function setPhase(next: Phase): void {
  if ((next === "won" || next === "lost") && !runRecorded) {
    runRecorded = true;
    profile.runs++;
    profile.bestScore = Math.max(profile.bestScore, score);
    if (next === "won") {
      profile.wins++;
      profile.bestTime = profile.bestTime > 0 ? Math.min(profile.bestTime, elapsed) : elapsed;
    }
    persistProfile();
  }
  phase = next;
  queuedPath = [];
  publish();
  drawUi();
}

function room(): void {
  scene_clear();
  ui_clear();
  scene_set_3d_enabled(false);
  paintBackdrop();
  floor = null;
  renderedTiles.clear(); renderedFog.clear();
  sprite("player", selectedClass, { x: 12, z: 12 }, 2);
  scene_actor_set("player", "player", heroClasses[selectedClass].baseHealth, 1, 0.35);
}

function paintBackdrop(): void {
  const pointer = input_primary_pointer();
  if (!scene_transform("dungeon_backdrop")) scene_spawn("dungeon_backdrop", 0, 0, -10);
  scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", pointer.viewportWidth, pointer.viewportHeight);
}

function loadMenu(): void {
  room();
  setPhase("menu");
}

function startRun(): void {
  elapsed = score = experience = nextId = gold = hungerTimer = invisTimer = causticOozeTimer = turns = 0;
  level = depth = 1;
  strength = 10;
  damage = heroClasses[selectedClass].baseDamage;
  maxHealth = heroClasses[selectedClass].baseHealth;
  runRecorded = false;
  bagPage = 0;
  actionCooldown = 0;
  queuedPath = [];
  random = seededRandom(profile.seed);
  inventory = {
    potion_healing: selectedClass === "warrior" ? 2 : 1,
    potion_liquid_flame: selectedClass === "huntress" ? 2 : 1,
    potion_invisibility: selectedClass === "rogue" ? 2 : 1,
    potion_strength: 0,
    scroll_upgrade: selectedClass === "mage" ? 2 : 1,
    scroll_magic_mapping: selectedClass === "mage" ? 1 : 0,
    food_ration: selectedClass === "huntress" ? 2 : 1,
  };
  dungeonLogs = [`Welcome to the sewers, ${heroClasses[selectedClass].name}.`, "Move one tile at a time. Find the stairs to descend."];
  room();
  enterFloor();
  setPhase("playing");
}

function enterFloor(): void {
  for (const id of scene_actor_ids()) if (id !== "player") scene_despawn(id);
  for (const key of renderedTiles.keys()) scene_despawn(`terrain_${key}`);
  for (const key of renderedFog) scene_despawn(`fog_${key}`);
  renderedTiles.clear(); renderedFog.clear(); queuedPath = [];
  floor = generateFloor(profile.seed, depth);
  placeCell("player", floor.entrance);
  const rooms = floor.rooms.filter((point) => !sameCell(point, floor!.entrance));
  if (depth === 5) spawnMonster("warden", "boss", floor.exit);
  else for (let index = 0; index < rooms.length; index++) {
    const type: EnemyKind = depth < 2 ? "chaser" : depth < 3 ? (index % 2 ? "ranger" : "chaser")
      : (["chaser", "ranger", "charger"] as const)[index % 3]!;
    spawnMonster(uid("enemy"), type, rooms[index]!);
  }
  // Loot is stored in real ScriptActor components, including the item index.
  for (const [index, item] of ["food_ration", "potion_healing", "scroll_upgrade", "potion_strength", "scroll_magic_mapping"].entries()) {
    const room = rooms[index]!;
    spawnLoot({ x: room.x + 1, z: room.z }, item as ItemKind);
  }
  refreshDungeon();
}

function spawnMonster(id: string, type: EnemyKind, point: Point): void {
  const spec = enemySpecs[type];
  sprite(id, mobSprites[type], point, 2, type === "boss" ? 1.4 : 1);
  scene_actor_set(id, type, spec.health, spec.speed, spec.radius);
  // lifetime = awareness, cooldown = accumulated movement credit, power = Goo charge.
  change(id, "lifetime", 0); change(id, "cooldown", 0); change(id, "power", 0);
}

function spawnLoot(point: Point, item?: ItemKind): void {
  const id = uid("loot");
  sprite(id, item ?? "gold", point, 1, 0.7);
  scene_actor_set(id, "loot", 1, 0, 0.2);
  change(id, "power", item ? Object.keys(itemCatalog).indexOf(item) + 1 : 0);
}

function refreshDungeon(): void {
  paintBackdrop();
  if (!floor) return;
  reveal(floor, cellPosition("player"));
  const safe = window_safe_area();
  const size = Math.max(6, Math.min(22, safe.width / 27, (safe.height - 210) / 25));
  const resized = size !== cellSize;
  resizeGrid(size);
  for (const key of floor.explored) {
    const point = { x: key % floor.width, z: Math.floor(key / floor.width) };
    const tile = terrainAt(floor, point);
    if (resized || renderedTiles.get(key) !== tile) {
      sprite(`terrain_${key}`, tile, point); renderedTiles.set(key, tile);
    }
    if (!floor.visible.has(key)) {
      if (resized || !renderedFog.has(key)) sprite(`fog_${key}`, "fog", point, 3);
      renderedFog.add(key);
    } else if (renderedFog.delete(key)) scene_despawn(`fog_${key}`);
  }
  for (const id of scene_actor_ids()) {
    if (kind(id) === "loot") {
      const item = (Object.keys(itemCatalog) as ItemKind[])[field(id, "power") - 1];
      sprite(id, item ?? "gold", cellPosition(id), 1, 0.7);
      const scale = scene_transform(id)!.get("scale") as BmsReflectReference;
      const visible = floor.visible.has(cellKey(floor, cellPosition(id)));
      for (const axis of ["x", "y"]) scale.set(axis, visible ? 1 : 0);
    } else actorSprite(id, selectedClass, id === "player" || floor.visible.has(cellKey(floor, cellPosition(id))));
  }
}

function collectLoot(): void {
  const point = cellPosition("player");
  for (const id of scene_actor_ids()) {
    if (kind(id) !== "loot" || !sameCell(point, cellPosition(id))) continue;
    const item = (Object.keys(itemCatalog) as ItemKind[])[field(id, "power") - 1];
    if (item) { inventory[item]++; pushLog(`You pick up ${itemCatalog[item].name}.`); }
    else { const coins = 3 + Math.floor(random() * 8); gold += coins; pushLog(`You pick up ${coins} gold.`); }
    scene_despawn(id);
  }
}

function useInventoryItem(kindKey: ItemKind): boolean {
  if ((phase !== "playing" && phase !== "inventory") || inventory[kindKey] <= 0) return false;
  inventory[kindKey]--;
  pushLog(itemCatalog[kindKey].effectText);
  if (kindKey === "potion_healing") {
    change("player", "health", maxHealth); causticOozeTimer = 0;
  } else if (kindKey === "potion_liquid_flame") {
    for (const id of monsterIds()) {
      if (floor!.visible.has(cellKey(floor!, cellPosition(id))) && cellDistance(cellPosition("player"), cellPosition(id)) <= 2) damageMonster(id, 12);
    }
  } else if (kindKey === "potion_invisibility") invisTimer = 21;
  else if (kindKey === "potion_strength") strength++;
  else if (kindKey === "scroll_upgrade") damage++;
  else if (kindKey === "scroll_magic_mapping") {
    for (let key = 0; key < floor!.tiles.length; key++) floor!.explored.add(key);
  } else if (kindKey === "food_ration") hungerTimer = Math.max(0, hungerTimer - 300);
  if ((phase as Phase) !== "won") {
    phase = "playing";
    spendTurns(kindKey === "food_ration" ? 3 : 1);
  }
  return true;
}

function damageMonster(id: string, power: number): void {
  const type = kind(id) as EnemyKind;
  const hp = field(id, "health") - power;
  change(id, "health", hp);
  if (hp > 0) return;
  const point = cellPosition(id), spec = mobCombat[type];
  scene_despawn(id);
  score += type === "boss" ? 500 : 10;
  if (level <= spec.maxLevel) experience += spec.experience;
  pushLog(`${dungeonMonsters[type].name} defeated.`);
  if (type === "boss") {
    pushLog("Goo drops the Skeleton Key. The sewers are cleared!");
    setPhase("won"); return;
  }
  if (random() < 0.5) spawnLoot(point);
  while (experience >= targetExperience()) {
    experience -= targetExperience(); level++; maxHealth += 5;
    change("player", "health", Math.min(maxHealth, health() + 5));
    pushLog(`You reached level ${level} (+5 maximum HP).`);
  }
}

function roll(min: number, max: number): number {
  // Upstream Random.NormalIntRange averages two uniform samples.
  return Math.round(min + (random() + random()) * (max - min) / 2);
}

function attackMonster(id: string): void {
  const type = kind(id) as EnemyKind, spec = mobCombat[type];
  const surprised = invisTimer > 0 || field(id, "lifetime") === 0;
  const enraged = type === "boss" && field(id, "health") <= enemySpecs.boss.health / 2;
  const hit = surprised || random() * (9 + level) >= random() * spec.defense * (enraged ? 1.5 : 1);
  invisTimer = 0; change(id, "lifetime", 1);
  if (hit) {
    const power = Math.max(0, roll(1, damage + Math.max(0, strength - 10)) - roll(0, spec.armor));
    pushLog(`${surprised ? "Surprise attack! " : ""}You hit ${dungeonMonsters[type].name} for ${power}.`);
    damageMonster(id, power);
  } else pushLog(`${dungeonMonsters[type].name} dodges your attack.`);
}

function hurtPlayer(power: number): void {
  change("player", "health", Math.max(0, health() - power));
  queuedPath = [];
  if (health() <= 0) setPhase("lost");
}

function monstersTurn(): void {
  const hero = cellPosition("player");
  for (const id of monsterIds()) {
    const type = kind(id) as EnemyKind, spec = mobCombat[type];
    let current = cellPosition(id);
    const seesHero = invisTimer <= 0 && cellDistance(current, hero) <= 7 && lineOfSight(floor!, current, hero);
    if (seesHero) {
      change(id, "lifetime", 1); change(id, "velocity_x", hero.x); change(id, "velocity_z", hero.z);
    }
    if (type === "boss" && terrainAt(floor!, current) === "water") change(id, "health", Math.min(100, field(id, "health") + 1));
    if (!field(id, "lifetime")) continue;
    const charged = type === "boss" && field(id, "power") >= 2;
    const canAttack = seesHero && cellDistance(current, hero) <= (charged ? 2 : 1)
      && (charged || canStep(floor!, current, hero));
    if (canAttack) {
      if (type === "boss") {
        if (field(id, "power") === 1) { change(id, "power", 2); pushLog("Goo swells further! Get out of reach!"); continue; }
        const enraged = field(id, "health") <= 50;
        if (!charged && random() < (enraged ? 0.5 : 0.2)) {
          change(id, "power", 1); pushLog("Goo is pumping up! Retreat!"); continue;
        }
      }
      const enraged = type === "boss" && field(id, "health") <= 50;
      const attack = (enraged ? 15 : spec.attack) * (charged ? 2 : 1);
      if (random() * attack >= random() * (4 + level)) {
        const max = enraged ? 12 : spec.maxDamage;
        const power = Math.max(0, roll(spec.minDamage * (charged ? 3 : 1), max * (charged ? 3 : 1)) - roll(0, 2));
        pushLog(`${dungeonMonsters[type].name}${charged ? " bursts" : " hits you"} for ${power}.`);
        hurtPlayer(power);
        if (type === "boss" && random() < 1 / 3) causticOozeTimer = 5;
      } else pushLog(`You dodge ${dungeonMonsters[type].name}.`);
      change(id, "power", 0);
      if (phase !== "playing") return;
      continue; // Crab moves twice, but its attack delay is still one turn.
    }
    change(id, "power", 0);
    const destination = seesHero ? hero : { x: field(id, "velocity_x"), z: field(id, "velocity_z") };
    for (let step = 0; step < field(id, "speed"); step++) {
      const blocked = new Set(monsterIds().filter((other) => other !== id).map((other) => cellKey(floor!, cellPosition(other))));
      blocked.add(cellKey(floor!, hero));
      // Path to the last seen cell; the hero's cell may terminate the path.
      blocked.delete(cellKey(floor!, destination));
      const next = findPath(floor!, current, destination, blocked)[0];
      if (!next || sameCell(next, hero) || monsterIds().some((other) => other !== id && sameCell(cellPosition(other), next))) break;
      if (terrainAt(floor!, next) === "door") { floor!.tiles[cellKey(floor!, next)] = "open_door"; break; }
      placeCell(id, next); current = next;
    }
    if (!seesHero && sameCell(current, destination)) change(id, "lifetime", 0);
  }
}

function spendTurns(count = 1): void {
  queuedPath = count > 1 ? [] : queuedPath;
  for (let turn = 0; turn < count && phase === "playing"; turn++) {
    turns++;
    hungerTimer++;
    if (invisTimer > 0) invisTimer--;
    if (terrainAt(floor!, cellPosition("player")) === "water") causticOozeTimer = 0;
    if (causticOozeTimer > 0) { causticOozeTimer--; hurtPlayer(1); }
    if (phase !== "playing") break;
    if (hungerTimer >= 450 && turns % 10 === 0) hurtPlayer(1);
    else if (hungerTimer < 450 && turns % 10 === 0) change("player", "health", Math.min(maxHealth, health() + 1));
    if (phase !== "playing") break;
    monstersTurn();
  }
  refreshDungeon();
  publish(); drawUi();
}

function movePlayer(dx: number, dz: number): boolean {
  if (!floor || phase !== "playing") return false;
  const current = cellPosition("player"), next = { x: current.x + dx, z: current.z + dz };
  if (!canStep(floor, current, next)) return false;
  const target = monsterIds().find((id) => sameCell(cellPosition(id), next));
  if (target) { attackMonster(target); queuedPath = []; }
  else if (terrainAt(floor, next) === "door") {
    floor.tiles[cellKey(floor, next)] = "open_door";
    pushLog("You open the door.");
  } else { placeCell("player", next); collectLoot(); }
  if (phase === "playing") spendTurns();
  return true;
}

function descend(): void {
  queuedPath = [];
  if (!floor || !sameCell(cellPosition("player"), floor.exit)) { pushLog("Stand on the downward stairs to descend."); drawUi(); return; }
  if (depth === 5) { pushLog("Goo guards the way forward. Defeat it first."); drawUi(); return; }
  depth++; turns++; hungerTimer++;
  pushLog(`You descend to depth ${depth}${depth === 5 ? ": Goo's lair" : ": sewers"}.`);
  enterFloor(); publish(); drawUi();
}

function playerInput(dt: number, pointer: RuneweavePointerState): void {
  actionCooldown = Math.max(0, actionCooldown - dt);
  if (input_key_just_pressed("KeyE") || input_key_just_pressed("Period")) { descend(); return; }
  if (input_key_just_pressed("Space")) { queuedPath = []; spendTurns(); return; }
  const shortcuts: ItemKind[] = ["potion_healing", "potion_liquid_flame", "potion_invisibility", "potion_strength", "scroll_upgrade", "scroll_magic_mapping", "food_ration"];
  for (const [index, item] of shortcuts.entries()) if (input_key_just_pressed(`Digit${index + 1}`)) { queuedPath = []; useInventoryItem(item); return; }
  const dx = Number(input_key_pressed("KeyD") || input_key_pressed("ArrowRight")) - Number(input_key_pressed("KeyA") || input_key_pressed("ArrowLeft"));
  const dz = Number(input_key_pressed("KeyS") || input_key_pressed("ArrowDown")) - Number(input_key_pressed("KeyW") || input_key_pressed("ArrowUp"));
  if (dx || dz) {
    queuedPath = [];
    if (actionCooldown <= 0) { movePlayer(dx, dz); actionCooldown = 0.16; }
    return;
  }
  if (pointer.justPressed) {
    queuedPath = [];
    if (pointer.y > window_safe_area().top - 150 || pointer.y < window_safe_area().bottom + 80) return;
    const target = { x: Math.round(pointer.x / cellSize + 12), z: Math.round(12 - (pointer.y + 40) / cellSize) };
    if (!floor!.explored.has(cellKey(floor!, target))) return;
    if (sameCell(target, cellPosition("player"))) { if (sameCell(target, floor!.exit)) descend(); return; }
    const blocked = new Set(monsterIds().filter((id) => !sameCell(cellPosition(id), target)).map((id) => cellKey(floor!, cellPosition(id))));
    queuedPath = findPath(floor!, cellPosition("player"), target, blocked, true);
  }
  if (queuedPath.length && actionCooldown <= 0) {
    const current = cellPosition("player"), next = queuedPath[0]!;
    const before = floor!.visible;
    const visibleEnemies = new Set(monsterIds().filter((id) => before.has(cellKey(floor!, cellPosition(id)))));
    if (!movePlayer(next.x - current.x, next.z - current.z)) queuedPath = [];
    else {
      if (sameCell(cellPosition("player"), next)) queuedPath.shift();
      if (monsterIds().some((id) => floor!.visible.has(cellKey(floor!, cellPosition(id))) && !visibleEnemies.has(id))) queuedPath = [];
    }
    actionCooldown = 0.16;
  }
}


function openChecks(): void {
  returnPhase = phase;
  checks = [];
  checkPage = 0;
  const check = (name: string, run: () => boolean): void => {
    try {
      checks.push(`${run() ? "PASS" : "FAIL"}  ${name}`);
    } catch {
      checks.push(`FAIL  ${name}`);
    }
  };
  check("Owned entity + reflected component + query", () => {
    scene_spawn("probe", 0, 0, 0);
    scene_actor_set("probe", "probe", 5, 1, 0.3);
    actor("probe").set("health", 3);
    const reference = scene_transform("probe")!.get("translation") as BmsReflectReference;
    reference.set("x", 2);
    return field("probe", "health") === 3 && position("probe").x === 2 && scene_actor_ids().includes("probe");
  });
  check("Invalid values / missing entities rejected", () =>
    !scene_actor_set("missing", "probe", 1, 1, 1) &&
    !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1) &&
    !scene_set_model("probe", "../forbidden.glb") &&
    !window_set_size(NaN, 100)
  );
  check("2D sprite / text / transform / camera toggle", () => {
    const sprite = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
    const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
    const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
    const camera = scene_set_3d_enabled(true) && scene_set_3d_enabled(false);
    return sprite && label && transformed && camera;
  });
  check("Despawn invalidates lookup", () => scene_despawn("probe") && scene_actor("probe") == null && scene_transform("probe") == null);
  check("UI validation + child cleanup", () => {
    ui_spawn("probe_ui", "", "node");
    ui_spawn("probe_child", "probe_ui", "text");
    ui_spawn("probe_image", "probe_ui", "image");
    const img = ui_set_image("probe_image", "sprites/settings-icon.png");
    const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
    return img && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
  });
  check("Keyboard / touch / pointer / safe-area reads", () => {
    input_key_pressed("KeyW");
    input_key_just_pressed("KeyW");
    input_key_just_released("KeyW");
    input_primary_touch();
    return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0 && window_metrics().width > 0;
  });
  check("Unknown HTTP request state", () => http_poll(2147483647).state === "unknown");
  const storage = storage_read("_acceptance_probe");
  if (storage.state === "error" && storage.error === "unavailable") checks.push("NOT_RUN  Persistent storage (no private data directory)");
  else {
    check("Persistent write / read / remove", () => {
      if (storage.state !== "missing") return false;
      const written = storage_write("_acceptance_probe", "ember-arena-probe");
      const read = storage_read("_acceptance_probe");
      const removed = storage_remove("_acceptance_probe");
      return written.state === "ok" && read.state === "ok" && read.value === "ember-arena-probe" && removed.state === "ok";
    });
  }
  checks.push("NOT_RUN  Full upstream content / sprite animation / native visual parity");
  checks.push("NOT_RUN  Audio / native physics: API gaps");
  checks.push("NOT_RUN  Lua gameplay / other platforms / hot reload");
  setPhase("checks");
}

function checkNetwork(): void {
  if (networkRequests.length) return;
  networkStatus = "HTTP: PENDING (GET + POST to httpbin.org)";
  networkRequests = [
    { id: http_get("https://httpbin.org/get"), method: "GET", elapsed: 0 },
    { id: http_post("https://httpbin.org/post", JSON.stringify({ game: "ember-arena", probe: true }), "application/json"), method: "POST", elapsed: 0 },
  ];
  drawUi();
}

function pollNetwork(dt: number): void {
  for (const request of [...networkRequests]) {
    request.elapsed += dt;
    const result = http_poll(request.id);
    if (result.state === "pending") continue;
    networkRequests = networkRequests.filter((candidate) => candidate !== request);
    const status = result.state === "complete"
      ? `${result.status >= 200 && result.status < 300 ? "PASS" : "FAIL"} ${request.method} ${result.status}`
      : `FAIL ${request.method} ${result.state === "error" ? result.error.slice(0, 90) : "unknown request"}`;
    networkStatus = networkStatus.startsWith("HTTP: PENDING") ? status : `${networkStatus}\n${status}`;
    if (phase === "checks") ui_set_text("network_status", networkStatus, 12, ...muted);
  }
}

callbacks.on_script_loaded = (): void => {
  window_set_size(1280, 800);
  networkRequests = [];
  loadProfile();
  loadMenu();
};

callbacks.on_script_reloaded = (): void => {
  networkRequests = [];
  loadProfile();
  loadMenu();
};

callbacks.on_update = (delta: number): void => {
  const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.05);
  const pointer = input_primary_pointer();
  const safe = window_safe_area();
  const metrics = window_metrics();
  const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  if (viewport !== signature) {
    viewport = signature;
    refreshDungeon();
    drawUi();
  }
  const previousPhase = phase;
  const previousTurns = turns;
  updateUi();
  pollNetwork(dt);
  if (phase !== previousPhase || turns !== previousTurns) return;

  // Shortcut keys
  if (input_key_just_pressed("Escape")) {
    if (phase === "playing") setPhase("paused");
    else if (phase === "inventory") setPhase("playing");
    else if (phase === "paused") setPhase("playing");
    else if (phase === "checks") setPhase(returnPhase);
    else if (phase === "settings") setPhase(settingsReturn);
    return;
  }
  if (phase === "menu" && input_key_just_pressed("Space")) {
    startRun();
    return;
  }
  if (phase === "inventory" && (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB"))) {
    setPhase("playing"); return;
  }
  if (phase === "playing") {
    if (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB")) {
      setPhase("inventory");
      return;
    }
  }

  if (phase !== "playing") return;

  elapsed += dt;
  playerInput(dt, pointer);

};
