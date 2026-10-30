const callbacks = globalThis as unknown as RuneweaveCallbacks;
import { actor, change, enemy, field, kind, model, move, position } from "./actors.js";
import { clamp, constrain, direction, distance, enemySpecs, pillars, seededRandom, segmentHits, waveAt, type EnemyKind, type Point } from "./rules.js";
import { defaultProfile, parseProfile, type Profile } from "./profile.js";
import { button, column, image, mountUi, node, row, text, updateUi, type UiElement, type UiStyle } from "../../api/ui.js";

type Phase = "menu" | "playing" | "paused" | "upgrade" | "won" | "lost" | "checks" | "settings";
const ink = [0.025, 0.045, 0.055, 0.97] as const;
const amber = [1, 0.60, 0.20, 1] as const;
const muted = [0.55, 0.69, 0.71, 1] as const;
const teal = [0.17, 0.83, 0.65, 1] as const;
let phase: Phase = "menu";
let returnPhase: Phase = "menu";
let elapsed = 0;
let score = 0;
let wave = 0;
let level = 1;
let experience = 0;
let damage = 16;
let fireDelay = 0.48;
let fireTimer = 0;
let spawnTimer = 0;
let nextId = 0;
let bossSpawned = false;
let halfWidth = 8;
let uiTimer = 0;
let viewport = "";
let lastPointer = { x: 0, y: 0, pressed: false };
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
let hurtTimer = 0;
let lastDamage = 0;
let checkPage = 0;
const compactUi = (): boolean => window_metrics().height > 0 && window_metrics().height < 650;
const uid = (prefix: string): string => `${prefix}_${nextId++}`;
const health = (): number => Math.max(0, field("player", "health"));
const targetExperience = (): number => 4 + level * 3;

function loadProfile(): void {
  saveBlocked = false;
  saveNotice = "";
  profile = defaultProfile();
  const result = storage_read("profile");
  if (result.state === "error") {
    saveNotice = `Save unavailable (${result.error}). Playing in this session is safe.`;
    saveBlocked = result.error === "invalid_data" || result.error === "too_large";
  } else if (result.state === "ok") {
    try { profile = parseProfile(result.value); }
    catch { saveBlocked = true; saveNotice = "Existing save is incompatible. It will not be overwritten."; }
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
  if (result.state === "error") { saveNotice = `Reset failed (${result.error}). Existing save retained.`; }
  else { profile = defaultProfile(); saveBlocked = false; saveNotice = "Saved progress reset. Your current run is unchanged."; }
  resetPending = false;
  drawUi();
}

function action(id: string, label: string, callback: () => void, primary = false): UiElement {
  return button(id, label, { onClick: callback, fontSize: compactUi() ? 12 : 16,
    color: primary ? [0.06, 0.08, 0.08, 1] : [0.9, 0.95, 0.95, 1],
    style: { width: "100%", height: compactUi() ? 36 : 48, borderRadius: 8,
      background: primary ? amber : [0.10, 0.17, 0.19, 1] } });
}
function safeStyle(): UiStyle {
  const safe = window_safe_area();
  const pointer = input_primary_pointer();
  return { position: "absolute", left: `${safe.leftInset / pointer.viewportWidth * 100}%`,
    top: `${safe.topInset / pointer.viewportHeight * 100}%`,
    width: `${safe.width / pointer.viewportWidth * 100}%`,
    height: `${safe.height / pointer.viewportHeight * 100}%` };
}
function panel(title: string, subtitle: string, content: UiElement[]): UiElement {
  return column("panel", { width: "90%", maxWidth: 470, padding: compactUi() ? 12 : 24, gap: compactUi() ? 6 : 12,
    background: ink, borderRadius: 16 }, [
    text("panel_kicker", "RUNEWEAVE / EMBER ARENA", { fontSize: 12, color: amber }),
    text("panel_title", title, { fontSize: compactUi() ? 22 : 32 }),
    text("panel_subtitle", subtitle, { fontSize: compactUi() ? 11 : 14, color: muted,
      style: { display: compactUi() ? "none" : "flex" } }), ...content,
  ]);
}
function drawUi(): void {
  const pointer = input_primary_pointer();
  const safe = window_safe_area();
  const metrics = window_metrics();
  viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  const children: UiElement[] = [];
  if (phase === "playing") {
    children.push(column("hud", { width: "100%", padding: 16, gap: 8 }, [
      row("hud_top", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
        column("hud_stats", { gap: 4, flexGrow: 1 }, [
          text("hud_health", `VITALITY  ${Math.ceil(health())}`, { fontSize: 16, color: teal }),
          text("hud_score", `LV ${level}  /  ${score} POINTS`, { fontSize: 12, color: muted }),
        ]),
        text("hud_wave", wave < 3 ? `WAVE ${wave + 1} / 3` : "THE WARDEN", { fontSize: 16, color: amber }),
        button("pause", "II", { onClick: () => setPhase("paused"), fontSize: 20,
          style: { width: 48, height: 44, margin: 4, background: ink, borderRadius: 8 } }),
      ]),
      node("health_track", { width: "100%", height: 4, background: [0.1, 0.2, 0.2, 0.7] }, [
        node("health_fill", { width: `${clamp(health(), 0, 100)}%`, height: 4, background: teal }),
      ]),
      text("hud_info", statusLine(), { fontSize: 12, color: muted }),
      column("boss_panel", { width: "100%", gap: 4, display: scene_actor("warden") ? "flex" : "none" }, [
        text("boss_label", "THE WARDEN", { fontSize: 14, color: amber }),
        node("boss_track", { width: "100%", height: 5, background: ink }, [
          node("boss_fill", { width: "100%", height: 5, background: [0.95, 0.25, 0.2, 1] }),
        ]),
      ]),
      text("combat_notice", "", { fontSize: 16, color: amber }),
    ]));
    children.push(text("hint", "WASD / ARROWS OR DRAG  |  AUTO FIRE  |  ESC TO PAUSE", {
      fontSize: 11, color: muted,
      style: { position: "absolute", bottom: 12, left: 16, right: 16, display: profile.showHints ? "flex" : "none" },
    }));
  } else if (phase === "menu") {
    children.push(panel("Guard the last ember.", "A tiny survival adventure in one room.\nThree waves. One warden. Make every upgrade count.", [
      row("menu_art", { gap: 12, alignItems: "center" }, [
        image("menu_icon", "sprites/settings-icon.png", { width: 32, height: 32 }),
        text("menu_controls", "Move with WASD, arrows or a drag.\nYour mage fires at the nearest enemy.", { fontSize: 14, color: muted }),
      ]),
      action("start", "ENTER THE ARENA", startRun, true),
      text("saved_stats", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}  /  SEED ${profile.seed}`, { fontSize: 12, color: teal }),
      action("settings", "SETTINGS & PROGRESS", openSettings),
      action("checks", "RUNTIME CHECKS", openChecks),
      action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
      text("credits", "Characters by Kay Lousberg / KayKit (CC0)", { fontSize: 11, color: muted }),
    ]));
  } else if (phase === "paused") {
    children.push(panel("Take a breath.", "The arena is paused. Your run is safe here.", [
      action("resume", "KEEP GOING", () => setPhase("playing"), true),
      action("settings", "SETTINGS & PROGRESS", openSettings),
      action("checks", "RUNTIME CHECKS", openChecks),
      action("restart", "RESTART RUN", startRun),
      action("home", "MAIN MENU", loadMenu),
      action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
    ]));
  } else if (phase === "settings") {
    const changeSetting = (change: () => void): void => { change(); persistProfile(); drawUi(); };
    const pair = (id: string, first: UiElement, second: UiElement): UiElement => row(id, { width: "100%", justifyContent: "space-between" }, [
      column(`${id}_left`, { width: "49%" }, [first]), column(`${id}_right`, { width: "49%" }, [second]),
    ]);
    children.push(panel("Make it your arena.", `BEST ${profile.bestScore} / ${profile.wins} WINS / ${profile.runs} FINISHED RUNS`, [
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
  } else if (phase === "upgrade") {
    children.push(panel("A spark of power.", `LEVEL ${level} / Choose one upgrade to continue.`, [
      action("upgrade_power", "EMBER  /  +8 attack damage", () => upgrade("power"), true),
      action("upgrade_haste", "TEMPO  /  16% faster attacks", () => upgrade("haste")),
      action("upgrade_vigor", "VIGOR  /  heal 30, move faster", () => upgrade("vigor")),
    ]));
  } else if (phase === "won" || phase === "lost") {
    children.push(panel(phase === "won" ? "The ember endures." : "One more spark?",
      `${score} POINTS / LEVEL ${level} / ${Math.floor(elapsed)} SECONDS`, [
        text("result_note", phase === "won" ? "The warden has fallen. The room is yours." : "Keep moving, collect crystals, and watch the red bolts.", { fontSize: 14, color: muted }),
        text("result_record", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}`, { fontSize: 14, color: teal }),
        text("result_save", saveNotice, { fontSize: 12, color: muted }),
        action("restart", "PLAY AGAIN", startRun, true),
        action("home", "MAIN MENU", loadMenu),
        action("exit", "RETURN TO LAUNCHER", () => { app_request_exit(); }),
      ]));
  } else {
    const pageSize = compactUi() ? 3 : 6;
    const pages = Math.max(1, Math.ceil(checks.length / pageSize));
    checkPage = Math.min(checkPage, pages - 1);
    children.push(panel("Runtime checks", "Contract checks run in the live script context.", [
      ...checks.slice(checkPage * pageSize, (checkPage + 1) * pageSize).map((line, index) => text(`check_${index}`, line, { fontSize: compactUi() ? 11 : 12, color: line.startsWith("FAIL") ? [1, 0.3, 0.3, 1] : muted })),
      action("check_page", `NEXT PAGE  /  ${checkPage + 1} OF ${pages}`, () => { checkPage = (checkPage + 1) % pages; drawUi(); }),
      text("network_status", networkStatus, { fontSize: 12, color: muted }),
      action("network", "CHECK HTTP (PUBLIC ECHO SERVICE)", checkNetwork),
      action("back", "BACK", () => setPhase(returnPhase), true),
    ]));
  }
  mountUi(column("safe_root", { ...safeStyle(), alignItems: "center",
    justifyContent: phase === "playing" ? "start" : "center" }, children));
}
function statusLine(): string {
  const remaining = wave < 3 ? [40, 85, 130][wave]! - elapsed : elapsed - 130;
  return `${Math.max(0, Math.ceil(remaining))}s  /  CRYSTALS ${experience}/${targetExperience()}  /  ${scene_actor_ids().length} ACTORS`;
}
function publish(): void { game_state_set(score, Math.ceil(health()), phase.toUpperCase()); }
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
  lastPointer.pressed = false;
  publish();
  drawUi();
}
function room(): void {
  scene_clear();
  ui_clear();
  scene_set_3d_enabled(true);
  model("ground", "floor", { x: 0, z: 0 }, 1, -0.25);
  for (let x = -8; x <= 8; x += 2) {
    for (let z = -6; z <= 6; z += 2) model(`tile_${x}_${z}`, "tile", { x, z }, 1, -0.08);
    model(`wall_n_${x}`, "wall", { x, z: -6.5 });
    model(`wall_s_${x}`, "wall", { x, z: 6.5 });
  }
  for (const [index, pillar] of pillars.entries()) {
    model(`pillar_${index}`, "pillar", pillar, 1, 0.65);
    model(`beacon_${index}`, "beacon", pillar, 0.6, 1.7);
  }
  model("player", "Mage", { x: 0, z: 0 }, 0.65);
  scene_actor_set("player", "player", 100, 3.7, 0.35);
  scene_play_animation("player", "models/Mage.glb", true);
}
function loadMenu(): void {
  room();
  setPhase("menu");
}
function startRun(): void {
  elapsed = score = wave = experience = fireTimer = spawnTimer = nextId = uiTimer = 0;
  level = 1;
  damage = 16;
  fireDelay = 0.48;
  bossSpawned = false;
  runRecorded = false;
  hurtTimer = 0;
  random = seededRandom(profile.seed);
  room();
  setPhase("playing");
}
function upgrade(choice: "power" | "haste" | "vigor"): void {
  if (choice === "power") damage += 8;
  if (choice === "haste") fireDelay = Math.max(0.12, fireDelay * 0.84);
  if (choice === "vigor") {
    change("player", "health", Math.min(100, health() + 30));
    change("player", "speed", Math.min(6, field("player", "speed") + 0.35));
  }
  setPhase("playing");
}
function spawnEnemy(): void {
  const types: EnemyKind[] = wave === 0 ? ["chaser"] : wave === 1 ? ["chaser", "ranger"] : ["chaser", "ranger", "charger"];
  const angle = random() * Math.PI * 2;
  const point = constrain({ x: Math.cos(angle) * (halfWidth - 0.5), z: Math.sin(angle) * 5 }, 0.45, halfWidth);
  enemy(uid("enemy"), types[Math.floor(random() * types.length)]!, point);
}
function projectile(start: Point, target: Point, hostile: boolean, power: number, angleOffset = 0): void {
  const id = uid(hostile ? "hostile" : "ember");
  const aim = direction(start, target);
  const angle = Math.atan2(aim.x, aim.z) + angleOffset;
  const speed = hostile ? 4 : 14;
  model(id, hostile ? "hostile" : "ember", start, 1, 0.6, angle);
  scene_actor_set(id, hostile ? "hostile" : "ember", 1, speed, 0.16);
  change(id, "power", power);
  change(id, "velocity_x", Math.sin(angle) * speed);
  change(id, "velocity_z", Math.cos(angle) * speed);
}
function pickup(point: Point): void {
  const id = uid("crystal");
  model(id, "crystal", point, 1, 0.35);
  scene_actor_set(id, "crystal", 1, 0, 0.2);
}
function impact(point: Point): void {
  if (profile.reducedMotion) return;
  const id = uid("impact");
  model(id, "ember", point, 1.7, 0.7);
  scene_actor_set(id, "effect", 1, 0, 0.1);
}
function effectsStep(dt: number, ids: string[]): void {
  for (const id of ids) {
    if (!scene_actor(id) || kind(id) !== "effect") continue;
    const age = field(id, "lifetime") + dt;
    if (age > 0.18) scene_despawn(id);
    else {
      change(id, "lifetime", age);
      const scale = scene_transform(id)!.get("scale") as BmsReflectReference;
      for (const axis of ["x", "y", "z"]) scale.set(axis, Math.max(0.1, 1.7 * (1 - age / 0.18)));
    }
  }
}
function hurtPlayer(power: number): void {
  if (field("player", "cooldown") > 0) return;
  change("player", "health", Math.max(0, health() - power));
  change("player", "cooldown", 0.65);
  lastDamage = power;
  hurtTimer = 0.65;
  if (health() <= 0) setPhase("lost");
}
function playerStep(dt: number, pointer: RuneweavePointerState): void {
  const x = Number(input_key_pressed("KeyD") || input_key_pressed("ArrowRight")) - Number(input_key_pressed("KeyA") || input_key_pressed("ArrowLeft"));
  const z = Number(input_key_pressed("KeyS") || input_key_pressed("ArrowDown")) - Number(input_key_pressed("KeyW") || input_key_pressed("ArrowUp"));
  const current = position("player");
  const speed = field("player", "speed");
  const normal = Math.max(1, Math.hypot(x, z));
  let dx = x / normal * speed * dt;
  let dz = z / normal * speed * dt;
  if (pointer.pressed && lastPointer.pressed && pointer.y < window_safe_area().top - 90) {
    dx += (pointer.x - lastPointer.x) * 22 / 800 * profile.sensitivity;
    dz -= (pointer.y - lastPointer.y) * 22 / 800 / 0.7474 * profile.sensitivity;
  }
  // Bound unusually large cursor jumps and constrain motion against room pillars.
  const length = Math.hypot(dx, dz);
  const factor = length > speed * dt * 2 ? speed * dt * 2 / length : 1;
  const next = constrain({ x: current.x + dx * factor, z: current.z + dz * factor }, 0.35, halfWidth);
  move("player", next, length > 0.001 ? Math.atan2(dx, dz) : Math.PI);
  change("player", "cooldown", Math.max(0, field("player", "cooldown") - dt));
}
function enemiesStep(dt: number, ids: string[]): void {
  const player = position("player");
  for (const id of ids) {
    if (!scene_actor(id)) continue;
    const type = kind(id);
    if (!(type in enemySpecs)) continue;
    const current = position(id);
    const aim = direction(current, player);
    const age = field(id, "lifetime") + dt;
    change(id, "lifetime", age);
    let speed = field(id, "speed");
    if (type === "ranger" && distance(current, player) < 4) speed = 0;
    if (type === "charger") speed *= Math.sin(age * 2) > 0.5 ? 2.6 : 0.65;
    const next = constrain({ x: current.x + aim.x * speed * dt, z: current.z + aim.z * speed * dt }, field(id, "radius"), halfWidth);
    move(id, next, Math.atan2(aim.x, aim.z));
    const cooldown = field(id, "cooldown") - dt;
    change(id, "cooldown", cooldown);
    if (cooldown <= 0 && (type === "ranger" || type === "boss")) {
      for (const angle of type === "boss" ? [-0.55, -0.28, 0, 0.28, 0.55] : [0]) projectile(next, player, true, 12, angle);
      change(id, "cooldown", type === "boss" ? 2.2 : 2.8);
    }
    if (distance(next, player) < field(id, "radius") + 0.35) hurtPlayer(type === "boss" ? 25 : 15);
    if (phase !== "playing") return;
  }
}
function bulletsStep(dt: number, ids: string[]): void {
  const targets = ids.filter((id) => scene_actor(id) && kind(id) in enemySpecs);
  for (const id of ids) {
    if (!scene_actor(id)) continue;
    const type = kind(id);
    if (type !== "ember" && type !== "hostile") continue;
    const current = position(id);
    const next = { x: current.x + field(id, "velocity_x") * dt, z: current.z + field(id, "velocity_z") * dt };
    const age = field(id, "lifetime") + dt;
    const obstacle = pillars.some((pillar) => segmentHits(current, next, pillar, 0.85));
    if (age > 4 || Math.abs(next.x) > halfWidth || Math.abs(next.z) > 6 || obstacle) {
      scene_despawn(id);
      continue;
    }
    let hit = false;
    if (type === "hostile") {
      if (segmentHits(current, next, position("player"), 0.51)) { hurtPlayer(field(id, "power")); hit = true; }
    } else {
      for (const target of targets) {
        if (!scene_actor(target) || !segmentHits(current, next, position(target), field(target, "radius") + 0.16)) continue;
        const hp = field(target, "health") - field(id, "power");
        impact(position(target));
        change(target, "health", hp);
        if (hp <= 0) {
          const type = kind(target);
          pickup(position(target));
          score += type === "boss" ? 500 : 10;
          scene_despawn(target);
          if (type === "boss") setPhase("won");
        }
        hit = true;
        break;
      }
    }
    if (hit) scene_despawn(id);
    else { move(id, next, Math.atan2(field(id, "velocity_x"), field(id, "velocity_z"))); change(id, "lifetime", age); }
    if (phase !== "playing") return;
  }
}
function crystalsStep(dt: number, ids: string[]): void {
  const player = position("player");
  for (const id of ids) {
    if (!scene_actor(id) || kind(id) !== "crystal") continue;
    const current = position(id);
    const age = field(id, "lifetime") + dt;
    change(id, "lifetime", age);
    if (distance(current, player) < 1) {
      scene_despawn(id);
      experience++;
      if (experience >= targetExperience()) {
        experience -= targetExperience();
        level++;
        setPhase("upgrade");
        return;
      }
    } else if (age > 20) scene_despawn(id);
    else if (distance(current, player) < 2.5) {
      const aim = direction(current, player);
      move(id, { x: current.x + aim.x * dt * 4, z: current.z + aim.z * dt * 4 }, age);
    }
  }
}
function openChecks(): void {
  returnPhase = phase;
  checks = [];
  checkPage = 0;
  const check = (name: string, run: () => boolean): void => {
    try { checks.push(`${run() ? "PASS" : "FAIL"}  ${name}`); }
    catch { checks.push(`FAIL  ${name}`); }
  };
  check("Owned entity + reflected component + query", () => {
    scene_spawn("probe", 0, 0, 0);
    scene_actor_set("probe", "probe", 5, 1, 0.3);
    actor("probe").set("health", 3);
    const reference = scene_transform("probe")!.get("translation") as BmsReflectReference;
    reference.set("x", 2);
    return field("probe", "health") === 3 && position("probe").x === 2 && scene_actor_ids().includes("probe");
  });
  check("Invalid values / missing entities rejected", () => !scene_actor_set("missing", "probe", 1, 1, 1)
    && !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1)
    && !scene_set_model("probe", "../forbidden.glb") && !window_set_size(NaN, 100));
  check("2D sprite / text / transform / camera toggle", () => {
    const sprite = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
    const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
    const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
    const camera = scene_set_3d_enabled(false) && scene_set_3d_enabled(true);
    return sprite && label && transformed && camera;
  });
  check("Despawn invalidates lookup", () => scene_despawn("probe") && scene_actor("probe") == null && scene_transform("probe") == null);
  check("UI validation + child cleanup", () => {
    ui_spawn("probe_ui", "", "node");
    ui_spawn("probe_child", "probe_ui", "text");
    ui_spawn("probe_image", "probe_ui", "image");
    const image = ui_set_image("probe_image", "sprites/settings-icon.png");
    const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
    return image && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
  });
  check("Keyboard / touch / pointer / safe-area reads", () => {
    input_key_pressed("KeyW"); input_key_just_pressed("KeyW"); input_key_just_released("KeyW"); input_primary_touch();
    return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0 && window_metrics().width > 0;
  });
  check("Unknown HTTP request state", () => http_poll(2147483647).state === "unknown");
  const storage = storage_read("_acceptance_probe");
  if (storage.state === "error" && storage.error === "unavailable") checks.push("NOT_RUN  Persistent storage (no private data directory)");
  else check("Persistent write / read / remove", () => {
    if (storage.state !== "missing") return false;
    const written = storage_write("_acceptance_probe", "ember-arena-probe");
    const read = storage_read("_acceptance_probe");
    const removed = storage_remove("_acceptance_probe");
    return written.state === "ok" && read.state === "ok" && read.value === "ember-arena-probe" && removed.state === "ok";
  });
  checks.push("REQUESTED  GLB models + walking animation (visual check)");
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
    const status = result.state === "complete" ? `${result.status >= 200 && result.status < 300 ? "PASS" : "FAIL"} ${request.method} ${result.status}`
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
callbacks.on_script_reloaded = (): void => { networkRequests = []; loadProfile(); loadMenu(); };
callbacks.on_update = (delta: number): void => {
  const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.05);
  const pointer = input_primary_pointer();
  const safe = window_safe_area();
  halfWidth = clamp(Math.min(safe.right, -safe.left) / 800 * 22 - 0.4, 2.8, 8);
  const metrics = window_metrics();
  const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  if (viewport !== signature) { viewport = signature; drawUi(); }
  const previousPhase = phase;
  updateUi();
  pollNetwork(dt);
  if (phase !== previousPhase) return;
  if (input_key_just_pressed("Escape")) {
    if (phase === "playing") setPhase("paused");
    else if (phase === "paused") setPhase("playing");
    else if (phase === "checks") setPhase(returnPhase);
    else if (phase === "settings") setPhase(settingsReturn);
    return;
  }
  if (phase === "menu" && input_key_just_pressed("Space")) { startRun(); return; }
  if (phase !== "playing") return;
  elapsed += dt;
  hurtTimer = Math.max(0, hurtTimer - dt);
  const nextWave = waveAt(elapsed);
  if (nextWave !== wave) {
    wave = nextWave;
    if (wave < 3) { level++; setPhase("upgrade"); return; }
  }
  playerStep(dt, pointer);
  lastPointer = { x: pointer.x, y: pointer.y, pressed: pointer.pressed };
  let ids = scene_actor_ids();
  if (wave >= 3 && !bossSpawned) {
    enemy("warden", "boss", { x: 0, z: -4.5 });
    bossSpawned = true;
  }
  spawnTimer -= dt;
  if (spawnTimer <= 0 && ids.filter((id) => kind(id) in enemySpecs).length < (wave >= 3 ? 8 : 22)) {
    spawnEnemy();
    spawnTimer = wave >= 3 ? 3 : [1.35, 1.05, 0.8][wave]!;
  }
  ids = scene_actor_ids();
  fireTimer -= dt;
  const origin = position("player");
  const nearest = ids.filter((id) => kind(id) in enemySpecs)
    .sort((a, b) => distance(position(a), origin) - distance(position(b), origin))[0];
  if (nearest && fireTimer <= 0) {
    projectile(origin, position(nearest), false, damage);
    fireTimer = fireDelay;
  }
  enemiesStep(dt, ids);
  if (phase !== "playing") return;
  bulletsStep(dt, ids);
  if (phase !== "playing") return;
  crystalsStep(dt, ids);
  if (phase !== "playing") return;
  effectsStep(dt, ids);
  publish();
  uiTimer += dt;
  if (uiTimer > 0.15) {
    uiTimer = 0;
    const hurtColor = hurtTimer > 0 && !profile.reducedMotion ? amber : teal;
    const [red, green, blue, alpha] = hurtColor;
    ui_set_text("hud_health", `VITALITY  ${Math.ceil(health())}`, 16, red, green, blue, alpha);
    ui_set_text("hud_score", `LV ${level}  /  ${score} POINTS`, 12, ...muted);
    ui_set_text("hud_wave", wave < 3 ? `WAVE ${wave + 1} / 3` : "THE WARDEN", 16, ...amber);
    ui_set_text("hud_info", statusLine(), 12, ...muted);
    ui_set_style("health_fill", JSON.stringify({ width: `${clamp(health(), 0, 100)}%` }));
    const boss = scene_actor("warden");
    ui_set_style("boss_panel", JSON.stringify({ display: boss ? "flex" : "none" }));
    const casting = boss && field("warden", "cooldown") <= 0.5;
    ui_set_text("combat_notice", hurtTimer > 0 ? `HIT  -${lastDamage}` : casting ? "WARDEN IS CASTING  /  KEEP MOVING" : "", 16, ...amber);
    if (boss) {
      ui_set_text("boss_label", `THE WARDEN  ${Math.max(0, Math.ceil(field("warden", "health")))} / ${enemySpecs.boss.health}`, 14, ...amber);
      ui_set_style("boss_fill", JSON.stringify({ width: `${clamp(field("warden", "health") / enemySpecs.boss.health * 100, 0, 100)}%` }));
    }
  }
};
