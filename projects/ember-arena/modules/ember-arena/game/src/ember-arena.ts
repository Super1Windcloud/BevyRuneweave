const callbacks = globalThis as unknown as RuneweaveCallbacks;
import { actor, change, field, kind, position } from "./actors.js";
import { clamp, enemySpecs, getHungerStatus, heroClasses, heroClassList, lootKinds, mobCombat, seededRandom,
  type EnemyKind, type HeroClass, type ItemKind, type LootKind, type Point } from "./rules.js";
import { canStep, cellDistance, cellKey, findPath, generateFloor, lineOfSight, passable, reveal, sameCell, searchFloor, terrainAt, type DungeonFloor, type Terrain } from "./dungeon.js";
import { actorCellAt, actorSprite, advanceSpriteMotion, cellPosition, cellSize, clearDungeonVisuals, mobSprites, monsterIds, placeCell, renderedPosition, settleSpriteMotion, sprite, spriteVisibility } from "./dungeon-actors.js";
import { defaultProfile, parseProfile, type Profile } from "./profile.js";
import { message, renderMessage, type Message, type MessageKey } from "./i18n.js";
import { mountUi, unmountUi, updateUi } from "../../api/ui.js";
import { stepSeconds } from "./sprite-motion.js";
import { renderSpdUi, uiMetrics, type UiPhase } from "./spd-ui.js";
import { armorReduction, attackDelay, attackSkill, defenseSkill, equippedGear, gearDefinitions, isGearKind,
  moveDelay, startingEquipment, strengthDeficit, timeAfter, weaponDamage } from "./equipment.js";
import { applyBurning, applyHealing, applyInvisibility, applyLockedFloor, applyOoze, buffId, buffKind, buffTarget, effectPriority,
  fireRoot, fireVolume, hasBuff, healingStep, oozeDamage, playerBuff, remainingBuff, removeBuffs, seedFireCell, seedLiquidFlame, startVitals } from "./effects.js";
import { projectileImpact, type TargetKind } from "./projectiles.js";
import { spiritBowAccuracy, spiritBowDamage, spiritBowDelay, spiritBowStrength } from "./spirit-bow.js";
import { createStaffCharger, rechargeStaff, staffCapacity, staffChargeId, staffChargerKind, staffCharges, staffDamageRange, staffGearId, upgradeStaffCharge } from "./staff.js";
import { cloakActive, cloakCapacity, cloakEquipped, cloakId, cloakKind, cloakRechargeStep, cloakStealthStep, cloakValue, createCloak, startCloak, stopCloak } from "./cloak.js";
import { affixSeal, createSeal, detachSeal, ensureWarriorShield, maximumShield, sealArmor, sealId, sealValue, shieldDamage, shieldId, shieldStep, shieldValue } from "./seal.js";
import { affectHunger, extendLockedFloor, hungerStep, lockedFloorStep, regenerationStep, starvingAt, type HungerStep } from "./survival.js";
import { MobileControls, type MobileAction, type MobileHudState } from "./mobile-controls.js";

type Phase = UiPhase;

let phase: Phase = "menu";
let returnPhase: Phase = "menu";
let selectedClass: HeroClass = "warrior";
let elapsed = 0;
let score = 0;
let level = 1;
let experience = 0;
let maxHealth = 20;
let strength = 10;
let depth = 1;
let turns = 0;
let actionCooldown = 0;
let floor: DungeonFloor | null = null;
let queuedPath: Point[] = [];
const mobileEnabled = typeof app_platform === "function" && ["android", "ios"].includes(app_platform());
const mobileControls = new MobileControls();
const renderedTiles = new Map<number, Terrain>();
const renderedFog = new Set<number>();
let nextId = 0;
let viewport = "";
let networkRequests: { id: number; method: string; elapsed: number }[] = [];
let networkStatus = message("network.idle");
let networkLines: Message[] = [];
let checks: Message[] = [];
let profile: Profile = defaultProfile();
let saveNotice: Message | null = null;
let saveBlocked = false;
let resetPending = false;
let settingsReturn: Phase = "menu";
let runRecorded = false;
let random = seededRandom(profile.seed);
let checkPage = 0;
let selectedItem: ItemKind = "potion_healing";
let settingsTab = 0;
let overlayReturn: Phase = "playing";
let uiNotice: Message | null = null;
let previewPhase: Phase | null = null;
let examining = false;
let targeting: TargetKind | null = null;
let cameraShake = 0;
let cameraState = "";
let wornKeys = 0;
let gooBlobs = 0;
let gooDefeated = false;
let exitUnlocked = false;
let floorSealed = false;
let equipment = startingEquipment(selectedClass);
let selectedGear = 1;
let upgradePage = 0;

// Shattered Pixel Dungeon core state
let gold = 0;
let dungeonLogs: Message[] = [];
let inventory: Record<ItemKind, number> = {
  potion_healing: 1,
  potion_liquid_flame: 1,
  potion_invisibility: 1,
  potion_strength: 0,
  scroll_upgrade: 1,
  scroll_magic_mapping: 0,
  food_ration: 1,
  spirit_bow: 0,
  cloak_of_shadows: 0,
  broken_seal: 0,
};

const uid = (prefix: string): string => `${prefix}_${nextId++}`;
const health = (): number => Math.max(0, field("player", "health"));
const hungerLevel = (): number => remainingBuff("hunger", "player");
const isInvisible = (): boolean => hasBuff("invisibility", "player") || cloakActive();
const targetExperience = (): number => 5 + level * 5;

function mobileContacts(pointer = input_primary_pointer()): RuneweaveTouchContact[] {
  const contacts = input_touches();
  // Let a mouse operate the mobile overlay in device emulators as well.
  return contacts.length || !pointer.pressed ? contacts : [{ id: "mouse", justPressed: pointer.justPressed,
    x: pointer.x / pointer.viewportWidth + 0.5, y: 0.5 - pointer.y / pointer.viewportHeight }];
}

function adjacentEnemy(): string | undefined {
  if (!floor || !scene_actor("player")) return undefined;
  const hero = cellPosition("player");
  return monsterIds().find((id) => {
    const target = cellPosition(id);
    return field(id, "health") > 0 && floor!.visible.has(cellKey(floor!, target)) && canStep(floor!, hero, target);
  });
}

function mobileHudState(): MobileHudState {
  const t = (key: MessageKey): string => renderMessage(profile.language, message(key));
  let skill: MobileHudState["skill"] = { label: t("mobile.shield"), detail: t("mobile.passive"), enabled: false, active: shieldValue("health") > 0 };
  if (selectedClass === "mage") {
    const staff = equipment.find((gear) => gear.kind === "mages_staff");
    const charges = staff ? staffCharges(staff.id) : 0;
    skill = { label: t("mobile.staff"), detail: `${charges}/${staff ? staffCapacity(staff.level) : 0}`, enabled: charges > 0, active: false };
  } else if (selectedClass === "huntress") {
    skill = { label: t("mobile.bow"), detail: "", enabled: inventory.spirit_bow > 0, active: false };
  } else if (selectedClass === "rogue") {
    const active = cloakActive();
    skill = { label: t(active ? "mobile.reveal" : "mobile.cloak"), detail: `${cloakValue("health")}/${cloakCapacity(cloakValue("lifetime"))}`,
      enabled: inventory.cloak_of_shadows > 0 && cloakEquipped() && (active || cloakValue("health") > 0), active };
  }
  if (targeting) skill = { ...skill, label: t("mobile.cancel"), enabled: true, active: true };
  return { attack: adjacentEnemy() !== undefined, healing: inventory.potion_healing, skill };
}

function mobileAction(action: MobileAction): void {
  if (phase !== "playing") return;
  if (action === "mobile_skill" && targeting) { targeting = null; drawUi(); return; }
  if (actionCooldown > 0) return;
  if (action === "mobile_skill" && !mobileHudState().skill.enabled) return;
  if (action === "mobile_attack" && !adjacentEnemy()) return;
  if (action === "mobile_heal" && inventory.potion_healing <= 0) return;
  queuedPath = []; examining = false; targeting = null;
  if (action === "mobile_attack") {
    const enemy = adjacentEnemy();
    if (!enemy) return;
    const hero = cellPosition("player"), target = cellPosition(enemy);
    movePlayer(target.x - hero.x, target.z - hero.z);
  } else if (action === "mobile_heal") {
    if (!useInventoryItem("potion_healing")) return;
  } else if (action === "mobile_wait") spendTurns();
  else if (selectedClass === "mage") {
    const staff = equipment.find((gear) => gear.kind === "mages_staff");
    if (staff) beginStaffZap(staff.id);
  } else if (selectedClass === "huntress") useInventoryItem("spirit_bow");
  else if (selectedClass === "rogue") toggleCloak();
  actionCooldown = stepSeconds;
}

function pushLog(entry: Message): void {
  dungeonLogs.unshift(entry);
  if (dungeonLogs.length > 3) dungeonLogs.pop();
}

function loadProfile(): void {
  saveBlocked = false;
  saveNotice = null;
  const locale = typeof app_locale === "function" ? app_locale() : "en-US";
  profile = defaultProfile(locale);
  const result = storage_read("profile");
  if (result.state === "error") {
    saveNotice = message("save.unavailable", { error: result.error });
    saveBlocked = result.error === "invalid_data" || result.error === "too_large";
  } else if (result.state === "ok") {
    try {
      profile = parseProfile(result.value, locale);
    } catch {
      saveBlocked = true;
      saveNotice = message("save.incompatible");
    }
  }
}

function persistProfile(): void {
  if (saveBlocked) return;
  const result = storage_write("profile", JSON.stringify(profile));
  saveNotice = result.state === "ok" ? message("save.saved") : message("save.failed", { error: result.error });
}

function openSettings(): void {
  settingsReturn = phase === "paused" ? "playing" : phase;
  resetPending = false;
  setPhase("settings");
}

function resetProfile(): void {
  const result = storage_remove("profile");
  if (result.state === "error") {
    saveNotice = message("save.resetFailed", { error: result.error });
  } else {
    profile = defaultProfile(typeof app_locale === "function" ? app_locale() : "en-US");
    saveBlocked = false;
    saveNotice = message("save.reset");
  }
  resetPending = false;
  drawUi();
}

function drawUi(): void {
  const pointer = input_primary_pointer(), safe = window_safe_area(), metrics = window_metrics();
  if (metrics.width <= 0 || metrics.height <= 0) return;
  viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  const localized = (value: Message): string => renderMessage(profile.language, value);
  mountUi(renderSpdUi({
    phase: previewPhase ?? phase, selectedClass, item: selectedItem, health: previewPhase === "lost" ? 0 : health(), maxHealth, level, strength, experience,
    targetExperience: targetExperience(), depth, gold, score, turns, hunger: getHungerStatus(hungerLevel()),
    invisible: isInvisible() ? 1 : 0, ooze: remainingBuff("ooze", "player"),
    healing: remainingBuff("healing", "player"), burning: remainingBuff("burning", "player"), targeting,
    lockedFloor: hasBuff("locked_floor", "player") ? remainingBuff("locked_floor", "player") : null,
    bossHealth: scene_actor("warden") ? field("warden", "health") : null,
    inventory, equipment, selectedGear, upgradePage, wornKeys, gooBlobs, examining, logs: dungeonLogs.map(localized), profile, settingsTab, gameBehind: phase === "settings" ? !["menu", "heroes"].includes(settingsReturn) : phase === "journal" ? overlayReturn !== "menu" : ["hero", "message"].includes(phase) ? overlayReturn !== "heroes" : true,
    saveNotice: saveNotice ? localized(saveNotice) : "", resetPending, checks: checks.map(localized), checkPage,
    networkStatus: networkLines.length ? networkLines.map(localized).join("\n") : localized(networkStatus),
    notice: uiNotice ? localized(uiNotice) : "",
    mobile: mobileEnabled ? mobileHudState() : undefined,
  }, uiAction));
}

function closeModal(): void {
  if (phase === "seal_transfer") return; // The equipment action must resolve before actors resume.
  if (phase === "settings" && resetPending) { resetPending = false; drawUi(); return; }
  if (phase === "item" || phase === "equipment" || phase === "upgrade" || phase === "affix") setPhase("inventory");
  else if (phase === "settings") setPhase(settingsReturn);
  else if (phase === "hero" || phase === "message" || phase === "journal") setPhase(overlayReturn);
  else if (phase === "checks") setPhase(returnPhase);
  else if (["inventory", "paused"].includes(phase)) setPhase("playing");
  else loadMenu();
}

function uiAction(id: string, value?: string | number): void {
  if (previewPhase) { previewPhase = null; drawUi(); return; }
  if (id.startsWith("mobile_")) { mobileAction(id as MobileAction); return; }
  if (id.startsWith("select:")) {
    const hero = id.slice(7) as HeroClass;
    if (!heroClassList.includes(hero)) {
      uiNotice = hero === ("duelist" as HeroClass)
        ? message("hero.unlockDuelist") : message("hero.unlockCleric");
      overlayReturn = "heroes"; setPhase("message"); return;
    }
    selectedClass = hero; room(); setPhase("heroes"); return;
  }
  if (id.startsWith("tab:")) { settingsTab = Number(id.slice(4)); drawUi(); return; }
  if (id.startsWith("gear:")) {
    const idNumber = Number(id.slice(5));
    if (!equipment.some((item) => item.id === idNumber)) return;
    selectedGear = idNumber; setPhase("equipment"); return;
  }
  if (id.startsWith("upgrade:")) { upgradeEquipment(Number(id.slice(8))); return; }
  if (id.startsWith("affix:")) { affixArmor(Number(id.slice(6))); return; }
  if (id.startsWith("zap:")) { beginStaffZap(Number(id.slice(4))); return; }
  if (id.startsWith("use_")) { phase = "inventory"; useInventoryItem(id.slice(4) as ItemKind); return; }
  if (id === "journal" || id === "game_journal") { overlayReturn = phase === "menu" ? "menu" : "playing"; setPhase("journal"); return; }
  if (["rankings", "journal", "news", "changes", "about", "support"].includes(id)) { setPhase(id as Phase); return; }
  switch (id) {
    case "start": setPhase("heroes"); return;
    case "begin_run": startRun(); return;
    case "restart": setPhase("heroes"); return;
    case "home": loadMenu(); return;
    case "pause": setPhase("paused"); return;
    case "bag_btn": setPhase("inventory"); return;
    case "item": selectedItem = value as ItemKind; setPhase("item"); return;
    case "toggle_equipment": changeEquipment(); return;
    case "toggle_cloak_equipment": changeCloakEquipment(); return;
    case "detach_seal":
      if (phase !== "equipment" || selectedGear !== sealArmor()) return;
      detachSeal(equipment); pushLog(message("seal.detached")); drawUi(); return;
    case "seal_transfer_yes": case "seal_transfer_no":
      if (phase !== "seal_transfer") return;
      if (id === "seal_transfer_yes") affixArmor(selectedGear);
      phase = "playing"; spendTurns(2); return;
    case "upgrade_page": upgradePage++; drawUi(); return;
    case "quick": useInventoryItem(value as ItemKind); return;
    case "hero_info": overlayReturn = phase; setPhase("hero"); return;
    case "settings": openSettings(); return;
    case "checks": openChecks(); return;
    case "check_page": checkPage = (checkPage + 1) % Math.ceil(checks.length / 6); drawUi(); return;
    case "network": checkNetwork(); return;
    case "wait": queuedPath = []; spendTurns(); return;
    case "search": toggleExamine(); return;
    case "cancel_examine": examining = false; drawUi(); return;
    case "cancel_target": targeting = null; drawUi(); return;
    case "worn_key": uiNotice = message("item.worn_key.description"); overlayReturn = "inventory"; setPhase("message"); return;
    case "goo_blob": uiNotice = message("item.goo_blob.description"); overlayReturn = "inventory"; setPhase("message"); return;
    case "descend": descend(); return;
    case "modal_close": case "close_bag": case "settings_back": closeModal(); return;
    case "back": if (phase === "heroes") loadMenu(); else closeModal(); return;
    case "exit": app_request_exit(); return;
    case "window_landscape": window_set_size(1280, 800); return;
    case "window_portrait": window_set_size(450, 800); return;
    case "language_english": profile.language = "en"; profile.followSystemLanguage = false; break;
    case "language_chinese": profile.language = "zh-CN"; profile.followSystemLanguage = false; break;
    case "hints": profile.showHints = !profile.showHints; break;
    case "motion": profile.reducedMotion = !profile.reducedMotion; cameraShake = 0; updateCamera(); break;
    case "seed": profile.seed = (profile.seed + 1) >>> 0; break;
    case "retry_save": persistProfile(); drawUi(); return;
    case "reset_save": resetPending = true; drawUi(); return;
    case "cancel_reset": resetPending = false; drawUi(); return;
    case "confirm_reset": resetProfile(); return;
    default: return;
  }
  persistProfile(); drawUi();
}

function publish(): void {
  game_state_set(score, Math.ceil(health()), phase.toUpperCase());
}

function setPhase(next: Phase): void {
  settleSpriteMotion();
  if (mobileEnabled) mobileControls.reset(mobileContacts());
  previewPhase = null;
  examining = false;
  targeting = null;
  cameraShake = 0;
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
  updateCamera();
  publish();
  drawUi();
}

function room(): void {
  floor = null;
  examining = false; targeting = null; cameraShake = 0;
  scene_clear();
  clearDungeonVisuals();
  unmountUi();
  cameraState = "";
  scene_set_3d_enabled(false);
  scene_set_camera_2d(0, 0, 800);
  paintBackdrop();
  renderedTiles.clear(); renderedFog.clear();
  sprite("player", selectedClass, { x: 12, z: 12 }, 2);
  scene_actor_set("player", "player", heroClasses[selectedClass].baseHealth, 1, 0.35);
}

function paintBackdrop(): void {
  const pointer = input_primary_pointer();
  if (!scene_transform("dungeon_backdrop")) scene_spawn("dungeon_backdrop", 0, 0, -10);
  if (floor) {
    const position = renderedPosition("player");
    scene_set_transform("dungeon_backdrop", position.x, position.y + 10, -10);
    const metrics = window_metrics(), scale = uiMetrics().scale;
    scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", metrics.width / scale, metrics.height / scale);
  } else scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", pointer.viewportWidth, pointer.viewportHeight);
}

function loadMenu(): void {
  room();
  setPhase("menu");
}

function startRun(): void {
  elapsed = score = experience = nextId = gold = turns = 0;
  level = depth = 1;
  strength = 10;
  equipment = startingEquipment(selectedClass); selectedGear = 1;
  wornKeys = gooBlobs = 0;
  gooDefeated = exitUnlocked = floorSealed = false;
  maxHealth = heroClasses[selectedClass].baseHealth;
  runRecorded = false;
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
    spirit_bow: selectedClass === "huntress" ? 1 : 0,
    cloak_of_shadows: selectedClass === "rogue" ? 1 : 0,
    broken_seal: selectedClass === "warrior" ? 1 : 0,
  };
  dungeonLogs = [message("log.welcome", { hero: message(`hero.${selectedClass}.name`) })];
  room();
  startVitals("player", 0);
  for (const gear of equipment) createStaffCharger(gear, 0);
  if (inventory.cloak_of_shadows) createCloak(true, 0);
  if (inventory.broken_seal) createSeal(equippedGear(equipment, "armor")!.id, equipment, 0);
  enterFloor();
  setPhase("playing");
}

function enterFloor(): void {
  examining = false; targeting = null; unsealFloor();
  clearDungeonVisuals();
  for (const id of scene_actor_ids()) if (id !== "player" && !playerBuff(id) && kind(id) !== staffChargerKind && id !== cloakId && id !== sealId) scene_despawn(id);
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
  if (depth >= 2 && depth < 5) {
    spawnLoot(rooms[5]!, "leather_armor"); spawnLoot(rooms[6]!, "shortsword");
  }
  refreshDungeon();
}

function spawnMonster(id: string, type: EnemyKind, point: Point): void {
  const spec = enemySpecs[type];
  sprite(id, mobSprites[type], point, 2, type === "boss" ? 1.4 : 1);
  scene_actor_set(id, type, spec.health, spec.speed, spec.radius);
  // lifetime = awareness, cooldown = next action time, power = Goo charge.
  change(id, "lifetime", 0); change(id, "cooldown", field("player", "cooldown")); change(id, "power", 0);
}

function spawnLoot(point: Point, item?: LootKind): void {
  const id = uid("loot");
  sprite(id, item ?? "gold", point, 1, 0.7);
  scene_actor_set(id, "loot", 1, 0, 0.2);
  change(id, "power", item ? lootKinds.indexOf(item) + 1 : 0);
}

function shakeOffset(): number { return cameraShake > 0 ? Math.sin(cameraShake * 80) * 3 * cameraShake / 0.2 : 0; }

function updateCamera(): void {
  const metrics = window_metrics();
  if (!floor || metrics.height <= 0) return;
  const hero = renderedPosition("player"), x = hero.x + shakeOffset(), y = hero.y + 10;
  const height = metrics.height / uiMetrics().scale, signature = `${x}:${y}:${height}`;
  if (signature === cameraState) return;
  cameraState = signature;
  scene_set_camera_2d(x, y, height);
  scene_set_transform("dungeon_backdrop", x, y, -10);
}

function refreshDungeon(): void {
  if (!floor) return;
  reveal(floor, cellPosition("player"));
  updateCamera();
  paintBackdrop();
  for (const key of floor.explored) {
    const point = { x: key % floor.width, z: Math.floor(key / floor.width) };
    const tile = terrainAt(floor, point);
    if (renderedTiles.get(key) !== tile) {
      sprite(`terrain_${key}`, tile === "secret_door" ? "wall" : tile, point); renderedTiles.set(key, tile);
    }
    if (!floor.visible.has(key)) {
      if (!renderedFog.has(key)) sprite(`fog_${key}`, "fog", point, 3);
      renderedFog.add(key);
    } else if (renderedFog.delete(key)) scene_despawn(`fog_${key}`);
  }
  for (const id of scene_actor_ids()) {
    if (kind(id) === "loot") {
      const item = lootKinds[field(id, "power") - 1];
      sprite(id, item ?? "gold", cellPosition(id), 1, 0.7);
      const visible = floor.visible.has(cellKey(floor, cellPosition(id)));
      spriteVisibility(id, visible);
    } else if (kind(id) === "fire_cell") {
      sprite(id, "fire", cellPosition(id), 2.5);
      const visible = floor.visible.has(cellKey(floor, cellPosition(id)));
      spriteVisibility(id, visible);
    } else actorSprite(id, selectedClass, id === "player" || floor.visible.has(cellKey(floor, cellPosition(id))));
  }
}

function collectLoot(): void {
  const point = cellPosition("player");
  for (const id of scene_actor_ids()) {
    if (kind(id) !== "loot" || !sameCell(point, cellPosition(id))) continue;
    const item = lootKinds[field(id, "power") - 1];
    if (item) {
      if (item === "worn_key") wornKeys++;
      else if (item === "goo_blob") gooBlobs++;
      else if (isGearKind(item)) {
        const gear = { id: Math.max(0, ...equipment.map((gear) => gear.id)) + 1, kind: item, level: 0, equipped: false };
        equipment.push(gear); createStaffCharger(gear, field("player", "cooldown"));
      }
      else if (item === "spirit_bow") inventory.spirit_bow = 1;
      else if (item === "cloak_of_shadows") { inventory.cloak_of_shadows = 1; createCloak(false, field("player", "cooldown")); }
      else if (item === "broken_seal") { inventory.broken_seal = 1; createSeal(0, equipment, field("player", "cooldown")); }
      else inventory[item]++;
      pushLog(message("log.item", { item: message(`item.${item}.name`) }));
    }
    else { const coins = 3 + Math.floor(random() * 8); gold += coins; pushLog(message("log.gold", { gold: coins })); }
    scene_despawn(id);
  }
}

function useInventoryItem(kindKey: ItemKind): boolean {
  if ((phase !== "playing" && phase !== "inventory") || inventory[kindKey] <= 0) return false;
  if (kindKey === "cloak_of_shadows") { toggleCloak(); return true; }
  if (kindKey === "broken_seal") { upgradePage = 0; setPhase("affix"); return true; }
  if (kindKey === "scroll_upgrade") { upgradePage = 0; setPhase("upgrade"); return true; }
  if (kindKey === "potion_liquid_flame" || kindKey === "spirit_bow") {
    queuedPath = []; examining = false; phase = "playing"; targeting = kindKey === "spirit_bow" ? "bow" : "flame";
    publish(); drawUi(); return true;
  }
  inventory[kindKey]--;
  pushLog(message(`item.${kindKey}.effect`));
  if (kindKey === "potion_healing") {
    applyHealing("player", maxHealth, field("player", "cooldown"));
  } else if (kindKey === "potion_invisibility") applyInvisibility("player", field("player", "cooldown"));
  else if (kindKey === "potion_strength") strength++;
  else if (kindKey === "scroll_magic_mapping") {
    for (let key = 0; key < floor!.tiles.length; key++) {
      floor!.explored.add(key);
      if (floor!.tiles[key] === "secret_door") floor!.tiles[key] = "door";
    }
  } else if (kindKey === "food_ration") changeHunger(300);
  if ((phase as Phase) !== "won") {
    phase = "playing";
    spendTurns(kindKey === "food_ration" ? 3 : 1);
  }
  return true;
}

function toggleCloak(): void {
  if (!inventory.cloak_of_shadows) return;
  queuedPath = []; targeting = null; examining = false;
  if (cloakActive()) { stopCloak(); phase = "playing"; publish(); drawUi(); return; }
  if (!cloakEquipped()) { pushLog(message("cloak.needEquip")); drawUi(); return; }
  if (cloakValue("health") <= 0) { pushLog(message("cloak.empty")); drawUi(); return; }
  startCloak(field("player", "cooldown")); pushLog(message("item.cloak_of_shadows.effect"));
  phase = "playing"; spendTurns();
}

function changeCloakEquipment(): void {
  if (!inventory.cloak_of_shadows) return;
  const takingOff = cloakEquipped();
  if (takingOff) stopCloak();
  change(cloakId, "velocity_x", takingOff ? 0 : 1);
  if (!takingOff) change(cloakId, "cooldown", field("player", "cooldown"));
  phase = "playing"; spendTurns();
}

function dispelInvisibility(): void {
  scene_despawn(buffId("invisibility", "player")); stopCloak(true);
}

function changeEquipment(): void {
  if (phase !== "equipment") return;
  const item = equipment.find((gear) => gear.id === selectedGear);
  if (!item) return;
  const slot = gearDefinitions[item.kind].slot, old = equippedGear(equipment, slot);
  const takingOff = item.equipped;
  // EquipableItem.timeToEquip is one tick; replacing an occupied slot also
  // spends the old item's unequip tick. Talents and cursed items are pending.
  const cost = !takingOff && old ? 2 : 1;
  if (old) old.equipped = false;
  item.equipped = !takingOff;
  ensureWarriorShield(equipment, field("player", "cooldown"));
  pushLog(message(takingOff ? "log.gearRemoved" : "log.gearEquipped", { item: message(`item.${item.kind}.name`) }));
  if (selectedClass === "warrior" && slot === "armor" && !takingOff && old?.id === sealArmor()) {
    setPhase("seal_transfer"); return;
  }
  phase = "playing"; spendTurns(cost);
}

function affixArmor(id: number): void {
  if ((phase !== "affix" && phase !== "seal_transfer") || !inventory.broken_seal) return;
  const armor = equipment.find((item) => item.id === id && gearDefinitions[item.kind].slot === "armor");
  if (!armor || armor.id === sealArmor()) return;
  affixSeal(armor, equipment, field("player", "cooldown")); pushLog(message("item.broken_seal.effect"));
  if (phase === "affix") { selectedGear = id; setPhase("equipment"); }
}

function upgradeEquipment(id: number): void {
  if (phase !== "upgrade" || inventory.scroll_upgrade <= 0) return;
  if (id === 0) {
    if (!inventory.broken_seal || sealArmor() !== 0 || sealValue("lifetime") !== 0) return;
    change(sealId, "lifetime", 1); inventory.scroll_upgrade--;
    pushLog(message("log.gearUpgraded", { item: message("item.broken_seal.name"), level: 1 }));
    phase = "playing"; spendTurns(); return;
  }
  const item = equipment.find((gear) => gear.id === id);
  if (!item) return;
  item.level++; inventory.scroll_upgrade--;
  if (item.id === sealArmor() && sealValue("lifetime") === 0) change(sealId, "lifetime", 1);
  upgradeStaffCharge(item);
  pushLog(message("log.gearUpgraded", { item: message(`item.${item.kind}.name`), level: item.level }));
  phase = "playing"; spendTurns();
}

function sealFloor(now: number): void {
  if (floorSealed) return;
  floorSealed = true; applyLockedFloor("player", now);
}

function unsealFloor(): void {
  floorSealed = false; scene_despawn(buffId("locked_floor", "player"));
}

function damageMonster(id: string, power: number, now = field("player", "cooldown")): void {
  const type = kind(id) as EnemyKind;
  if (type === "boss") {
    sealFloor(now);
    const lock = buffId("locked_floor", "player");
    change(lock, "health", extendLockedFloor(field(lock, "health"), power));
  }
  const hp = field(id, "health") - power;
  change(id, "health", hp);
  if (hp > 0) return;
  const point = cellPosition(id), spec = mobCombat[type];
  removeBuffs(id);
  scene_despawn(id);
  score += type === "boss" ? 500 : 10;
  if (level <= spec.maxLevel) experience += spec.experience;
  pushLog(message("log.defeated", { monster: message(`monster.${type}`) }));
  if (type === "boss") {
    gooDefeated = true; unsealFloor();
    spawnLoot(point, "worn_key");
    const chance = random(), count = chance < 0.6 ? 2 : chance < 0.9 ? 3 : 4;
    const neighbours: Point[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cell = { x: point.x + dx, z: point.z + dz };
      if ((dx || dz) && passable(floor!, cell)) neighbours.push(cell);
    }
    for (let index = 0; index < count; index++) spawnLoot(neighbours[Math.floor(random() * neighbours.length)] ?? point, "goo_blob");
    pushLog(message("log.sewersCleared"));
  } else if (random() < 0.5) spawnLoot(point);
  while (experience >= targetExperience()) {
    experience -= targetExperience(); level++; maxHealth += 5;
    change("player", "health", Math.min(maxHealth, health() + 5));
    pushLog(message("log.level", { level }));
  }
}

function roll(min: number, max: number): number {
  // Upstream Random.NormalIntRange averages two uniform samples.
  return Math.round(min + (random() + random()) * (max - min) / 2);
}

function attackMonster(id: string, ranged = false): void {
  const type = kind(id) as EnemyKind, spec = mobCombat[type];
  const weapon = equippedGear(equipment, "weapon");
  const encumbrance = ranged ? Math.max(0, spiritBowStrength(level) - strength) : strengthDeficit(weapon, strength);
  const surprised = (isInvisible() || field(id, "lifetime") === 0) && encumbrance === 0;
  const enraged = type === "boss" && field(id, "health") <= enemySpecs.boss.health / 2;
  const accuracy = ranged ? spiritBowAccuracy(level, strength, cellDistance(cellPosition("player"), cellPosition(id))) : attackSkill(weapon, strength, level);
  const hit = surprised || random() * accuracy >= random() * Math.floor(spec.defense * (enraged ? 1.5 : 1));
  dispelInvisibility(); change(id, "lifetime", 1);
  if (hit) {
    const damage = ranged ? spiritBowDamage(level, strength, roll) : weaponDamage(weapon, strength, surprised, roll);
    const power = Math.max(0, damage - roll(0, spec.armor));
    pushLog(message(surprised ? "log.surprise" : "log.hit", { monster: message(`monster.${type}`), damage: power }));
    damageMonster(id, power);
  } else pushLog(message("log.enemyDodged", { monster: message(`monster.${type}`) }));
}

function hurtPlayer(power: number, hunger = false): void {
  if (scene_actor(shieldId)) {
    const capacity = maximumShield(equipment), result = shieldDamage(health(), maxHealth, power, field(shieldId, "health"), field(shieldId, "power"), capacity, hunger);
    change(shieldId, "health", result.shield); change(shieldId, "power", result.cooldown);
    if (result.activated) { change(shieldId, "speed", 0); change(shieldId, "lifetime", capacity); }
    power = result.damage;
  }
  change("player", "health", Math.max(0, health() - power));
  queuedPath = [];
  if (health() <= 0) {
    removeBuffs("player");
    for (const id of scene_actor_ids()) if (kind(id) === staffChargerKind) scene_despawn(id);
    scene_despawn(cloakId);
    scene_despawn(sealId);
    setPhase("lost");
  }
}

function damageActor(target: string, amount: number, now: number): void {
  if (target === "player") hurtPlayer(amount);
  else if (scene_actor(target) && kind(target) in mobSprites) damageMonster(target, amount, now);
}

function flammable(point: Point): boolean {
  return ["door", "open_door", "secret_door"].includes(terrainAt(floor!, point));
}

function exposeToFire(target: string, now: number): void {
  if (scene_actor(target) && field(target, "health") > 0 && fireVolume(floor!, cellPosition(target)) > 0) applyBurning(target, now);
}

function fireAction(now: number): void {
  const cells = scene_actor_ids().filter((id) => kind(id) === "fire_cell" && field(id, "health") > 0);
  // Freeze just this tick's occupied cell keys before mutating the real field.
  // Like Fire.evolve's cur/off arrays, new cells cannot cascade in this tick.
  const current = new Set(cells.map((id) => cellKey(floor!, cellPosition(id))));
  const spread = new Set<number>();
  for (const id of cells) {
    const point = cellPosition(id);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const neighbour = { x: point.x + dx, z: point.z + dz }, key = cellKey(floor!, neighbour);
      if (!current.has(key) && flammable(neighbour)) spread.add(key);
    }
  }
  const igniteOccupants = (point: Point): void => {
    for (const target of ["player", ...monsterIds()]) if (sameCell(cellPosition(target), point)) applyBurning(target, now);
  };
  for (const id of cells) {
    const point = cellPosition(id); igniteOccupants(point);
    const left = field(id, "health") - 1;
    if (left <= 0) {
      if (flammable(point)) floor!.tiles[cellKey(floor!, point)] = "floor";
      scene_despawn(id);
    } else change(id, "health", left);
  }
  for (const key of spread) {
    const point = { x: key % floor!.width, z: Math.floor(key / floor!.width) };
    seedFireCell(floor!, point, 4, now); igniteOccupants(point);
  }
  if (!scene_actor_ids().some((id) => kind(id) === "fire_cell")) scene_despawn(fireRoot);
}

function effectAction(id: string, now: number): number {
  if (kind(id) === "blob_fire") { fireAction(now); return 1; }
  if (id === cloakId) {
    const regenOn = !hasBuff("locked_floor", "player") || remainingBuff("locked_floor", "player") >= 1;
    const next = cloakRechargeStep(cloakValue("health"), cloakValue("power"), cloakValue("lifetime"), cloakActive(), regenOn);
    change(cloakId, "health", next.charges); change(cloakId, "power", next.partial); return 1;
  }
  if (kind(id) === staffChargerKind) {
    const gear = equipment.find((gear) => gear.id === staffGearId(id) && gear.kind === "mages_staff");
    if (!gear || health() <= 0) { scene_despawn(id); return 1; }
    const regenOn = !hasBuff("locked_floor", "player") || remainingBuff("locked_floor", "player") >= 1;
    const next = rechargeStaff(field(id, "health"), field(id, "power"), staffCapacity(gear.level), regenOn);
    change(id, "health", next.charges); change(id, "power", next.partial); return 1;
  }
  const type = buffKind(kind(id)), target = buffTarget(id);
  if (!type || !scene_actor(target) || field(target, "health") <= 0) { scene_despawn(id); return 1; }
  if (type === "warrior_shield") {
    const regenOn = !hasBuff("locked_floor", target) || remainingBuff("locked_floor", target) >= 1;
    // Visibility must reflect the hero's current action, including movement and door changes.
    reveal(floor!, cellPosition("player"));
    const visible = monsterIds().some((enemy) => floor!.visible.has(cellKey(floor!, cellPosition(enemy))));
    const step = shieldStep(field(id, "health"), field(id, "power"), field(id, "speed"), field(id, "lifetime"), visible, regenOn, maximumShield(equipment));
    change(id, "health", step.shield); change(id, "power", step.cooldown); change(id, "speed", step.absent);
    if (step.detach) scene_despawn(id);
    return 1;
  }
  if (type === "cloak") {
    if (!cloakEquipped()) { stopCloak(); return 1; }
    const oldLevel = cloakValue("lifetime"), step = cloakStealthStep(cloakValue("health"), oldLevel, cloakValue("speed"), field(id, "health"), level);
    change(cloakId, "health", step.charges); change(cloakId, "lifetime", step.level); change(cloakId, "speed", step.experience);
    if (step.level > oldLevel) pushLog(message("cloak.levelup"));
    if (!step.active) { stopCloak(); queuedPath = []; pushLog(message("cloak.empty")); }
    else change(id, "health", step.left);
    return 1;
  }
  if (type === "invisibility") { scene_despawn(id); return 1; }
  if (type === "hunger") {
    if (!floorSealed) recordHunger(hungerStep(field(id, "health"), field(id, "power"), maxHealth));
    return 1;
  }
  if (type === "regeneration") {
    const regenOn = !hasBuff("locked_floor", target) || remainingBuff("locked_floor", target) >= 1;
    if (regenOn && hungerLevel() < starvingAt && health() < maxHealth) {
      const step = regenerationStep(field(id, "power"));
      change(id, "power", step.partial); change(target, "health", Math.min(maxHealth, health() + step.healing));
    }
    return 1;
  }
  if (type === "locked_floor") {
    if (!floorSealed) scene_despawn(id);
    else change(id, "health", lockedFloorStep(field(id, "health")));
    return 1;
  }
  const left = field(id, "health");
  if (type === "healing") {
    const amount = healingStep(left, field(id, "power"));
    const maximum = target === "player" ? maxHealth : enemySpecs[kind(target) as EnemyKind].health;
    change(target, "health", Math.min(maximum, field(target, "health") + amount));
    if (left <= amount) scene_despawn(id); else change(id, "health", left - amount);
    return 1;
  }
  const point = cellPosition(target), water = terrainAt(floor!, point) === "water";
  if (water && field(id, "lifetime") > 0) { scene_despawn(id); return 1; }
  change(id, "lifetime", 1);
  let damage = oozeDamage(depth, left);
  if (type === "burning") {
    damage = field(id, "power") || roll(1, 3 + Math.floor(depth / 4));
    change(id, "power", roll(1, 3 + Math.floor(depth / 4)));
  }
  if (damage > 0) damageActor(target, damage, now);
  if (!scene_actor(id)) return 1; // Death may have removed this target's buffs.
  if (type === "burning" && flammable(point) && fireVolume(floor!, point) === 0) seedFireCell(floor!, point, 4, now);
  if (water || left <= 1) scene_despawn(id); else change(id, "health", left - 1);
  return 1;
}

function beginStaffZap(gearId: number): void {
  if (!["playing", "equipment", "inventory"].includes(phase)) return;
  const gear = equipment.find((item) => item.id === gearId && item.kind === "mages_staff");
  if (!gear) return;
  if (staffCharges(gear.id) < 1) { pushLog(message("staff.empty")); drawUi(); return; }
  selectedGear = gear.id; queuedPath = []; examining = false; phase = "playing"; targeting = "staff";
  publish(); drawUi();
}

function fireAtTarget(target: Point): void {
  if (!floor || !targeting || phase !== "playing") return;
  if (!floor.visible.has(cellKey(floor, target))) { pushLog(message("target.notVisible")); drawUi(); return; }
  if (targeting === "staff") {
    const gear = equipment.find((gear) => gear.id === selectedGear && gear.kind === "mages_staff");
    if (!gear) { targeting = null; drawUi(); return; }
    const hero = cellPosition("player"), impact = projectileImpact(floor, hero, target,
      (point) => monsterIds().some((id) => sameCell(cellPosition(id), point)), false);
    if (sameCell(hero, target) || sameCell(hero, impact)) { pushLog(message("staff.selfTarget")); drawUi(); return; }
    if (staffCharges(gear.id) < 1) { targeting = null; pushLog(message("staff.empty")); drawUi(); return; }
    change(staffChargeId(gear.id), "health", staffCharges(gear.id) - 1);
    const enemy = monsterIds().find((id) => sameCell(cellPosition(id), impact));
    if (enemy) {
      const [min, max] = staffDamageRange(gear.level), damage = roll(min, max);
      change(enemy, "lifetime", 1); pushLog(message("staff.hit", { damage })); damageMonster(enemy, damage);
    } else pushLog(message("staff.miss"));
    dispelInvisibility(); spendTurns(); return;
  }
  const item = targeting === "bow" ? "spirit_bow" : "potion_liquid_flame";
  if (inventory[item] <= 0) { targeting = null; drawUi(); return; }
  const impact = projectileImpact(floor, cellPosition("player"), target,
    (point) => monsterIds().some((id) => sameCell(cellPosition(id), point)));
  if (targeting === "bow") {
    const enemy = monsterIds().find((id) => sameCell(cellPosition(id), impact));
    const delay = spiritBowDelay(level, strength, enemy !== undefined);
    if (enemy) attackMonster(enemy, true);
    else pushLog(message("item.spirit_bow.effect"));
    spendTurns(delay); return;
  }
  inventory.potion_liquid_flame--;
  pushLog(message("item.potion_liquid_flame.effect"));
  seedLiquidFlame(floor, impact, field("player", "cooldown"));
  spendTurns();
}

function monsterAction(id: string, now: number): number {
  const hero = cellPosition("player");
  const type = kind(id) as EnemyKind, spec = mobCombat[type];
  let current = cellPosition(id);
  const seesHero = !isInvisible() && cellDistance(current, hero) <= 7 && lineOfSight(floor!, current, hero);
  if (seesHero) {
    change(id, "lifetime", 1); change(id, "velocity_x", hero.x); change(id, "velocity_z", hero.z);
  }
  if (type === "boss" && field(id, "lifetime")) sealFloor(now);
  if (type === "boss" && terrainAt(floor!, current) === "water") change(id, "health", Math.min(100, field(id, "health") + 1));
  if (!field(id, "lifetime")) return 1;
  const charged = type === "boss" && field(id, "power") >= 2;
  const canAttack = seesHero && cellDistance(current, hero) <= (charged ? 2 : 1)
    && (charged || canStep(floor!, current, hero));
  if (canAttack) {
    if (type === "boss") {
      if (field(id, "power") === 1) { change(id, "power", 2); pushLog(message("log.gooSwells")); return 1; }
      const enraged = field(id, "health") <= 50;
      if (!charged && random() < (enraged ? 0.5 : 0.2)) {
        change(id, "power", 1); pushLog(message("log.gooCharging")); return 1;
      }
    }
    const enraged = type === "boss" && field(id, "health") <= 50;
    const attack = (enraged ? 15 : spec.attack) * (charged ? 2 : 1);
    const armor = equippedGear(equipment, "armor");
    if (random() * attack >= random() * defenseSkill(armor, strength, level)) {
      const max = enraged ? 12 : spec.maxDamage;
      const power = Math.max(0, roll(spec.minDamage * (charged ? 3 : 1), max * (charged ? 3 : 1)) - armorReduction(armor, strength, roll));
      pushLog(message(charged ? "log.enemyBurst" : "log.enemyHit", { monster: message(`monster.${type}`), damage: power }));
      hurtPlayer(power);
      if (phase === "playing" && type === "boss" && random() < 1 / 3) applyOoze("player", now);
    } else pushLog(message("log.dodged", { monster: message(`monster.${type}`) }));
    if (charged && !profile.reducedMotion) cameraShake = 0.2;
    change(id, "power", 0);
    return 1; // Crab attacks use one tick; only its movement uses half ticks.
  }
  change(id, "power", 0);
  const destination = seesHero ? hero : { x: field(id, "velocity_x"), z: field(id, "velocity_z") };
  {
    const blocked = new Set(monsterIds().filter((other) => other !== id).map((other) => cellKey(floor!, cellPosition(other))));
    blocked.add(cellKey(floor!, hero));
    // Path to the last seen cell; the hero's cell may terminate the path.
    blocked.delete(cellKey(floor!, destination));
    const next = findPath(floor!, current, destination, blocked)[0];
    if (!next || sameCell(next, hero) || monsterIds().some((other) => other !== id && sameCell(cellPosition(other), next))) return 1;
    if (terrainAt(floor!, next) === "door") { floor!.tiles[cellKey(floor!, next)] = "open_door"; return 1; }
    placeCell(id, next, 2, true); current = next;
    exposeToFire(id, now);
  }
  if (!seesHero && sameCell(current, destination)) change(id, "lifetime", 0);
  return 1 / Math.max(0.1, field(id, "speed"));
}

function recordHunger(step: HungerStep): void {
  const id = buffId("hunger", "player");
  change(id, "health", step.level); change(id, "power", step.partialDamage);
  if (step.notice) pushLog(message(`log.${step.notice}`));
  if (step.damage) hurtPlayer(step.damage, true);
}

function changeHunger(energy: number): void {
  const id = buffId("hunger", "player");
  recordHunger(affectHunger(field(id, "health"), field(id, "power"), energy, maxHealth));
}

function spendTurns(duration = 1): void {
  examining = false; targeting = null;
  queuedPath = duration > 1 ? [] : queuedPath;
  const start = field("player", "cooldown"), ready = timeAfter(start, duration);
  turns = ready; change("player", "lifetime", ready); change("player", "cooldown", ready);
  // Actor.process priorities: hero, healing, blobs, mobs, other buffs/status.
  // Every scheduled effect/mob timestamp is read from its real Bevy component.
  while (phase === "playing") {
    let next: string | null = null, earliest = ready, priority = 0;
    for (const id of scene_actor_ids()) {
      const tag = kind(id), candidatePriority = tag in mobSprites ? -20 : tag === staffChargerKind ? -30
        : tag === cloakKind ? (cloakEquipped() ? -30 : undefined) : effectPriority(tag);
      if (candidatePriority === undefined) continue;
      const time = Math.max(start, field(id, "cooldown"));
      if (time < earliest || (time === earliest && candidatePriority > priority)) {
        next = id; earliest = time; priority = candidatePriority;
      }
    }
    if (next !== null) {
      const delay = kind(next) in mobSprites ? monsterAction(next, earliest) : effectAction(next, earliest);
      if (scene_actor(next)) change(next, "cooldown", timeAfter(earliest, delay));
    } else break;
  }
  refreshDungeon();
  publish(); drawUi();
}

function movePlayer(dx: number, dz: number): boolean {
  if (!floor || phase !== "playing") return false;
  const current = cellPosition("player"), next = { x: current.x + dx, z: current.z + dz };
  if (!canStep(floor, current, next)) return false;
  const target = monsterIds().find((id) => sameCell(cellPosition(id), next));
  const duration = target ? attackDelay(equippedGear(equipment, "weapon"), strength)
    : terrainAt(floor, next) === "door" ? 1 : moveDelay(equippedGear(equipment, "armor"), strength);
  if (target) { attackMonster(target); queuedPath = []; }
  else if (terrainAt(floor, next) === "door") {
    floor.tiles[cellKey(floor, next)] = "open_door";
    pushLog(message("log.door"));
  } else { placeCell("player", next, 2, true); collectLoot(); exposeToFire("player", field("player", "cooldown")); }
  if (phase === "playing") spendTurns(duration);
  return true;
}

function descend(): void {
  queuedPath = [];
  examining = false; targeting = null;
  if (!floor || !sameCell(cellPosition("player"), floor.exit)) { pushLog(message("log.stairs")); drawUi(); return; }
  if (depth === 5) {
    if (!gooDefeated || floorSealed) { pushLog(message("log.gooBlocks")); drawUi(); return; }
    if (!exitUnlocked) {
      if (!wornKeys) { pushLog(message("log.keyNeeded")); drawUi(); return; }
      wornKeys--; exitUnlocked = true;
      pushLog(message("log.exitUnlocked")); spendTurns(); return;
    }
    // Explicit boundary for the current content package; the prison is not ported.
    pushLog(message("log.milestone")); setPhase("won"); return;
  }
  spendTurns();
  if (phase !== "playing") return;
  depth++;
  pushLog(message(depth === 5 ? "log.lair" : "log.descend", { depth }));
  enterFloor(); publish(); drawUi();
}

function toggleExamine(): void {
  if (!floor || phase !== "playing") return;
  targeting = null;
  queuedPath = [];
  if (!examining) { examining = true; drawUi(); return; }
  const found = searchFloor(floor, cellPosition("player"), selectedClass === "rogue" ? 2 : 1);
  // v4.0.2 Hero.search: two action ticks and six hunger units, before talents.
  if (!floorSealed) changeHunger(-4);
  pushLog(message(found ? "log.secretFound" : "log.searched"));
  if (phase === "playing") spendTurns(2);
}

function examineCell(point: Point): void {
  if (!floor) return;
  const tile = terrainAt(floor, point);
  let occupant: Message | string = "";
  if (floor.visible.has(cellKey(floor, point))) {
    const mob = monsterIds().find((id) => sameCell(point, cellPosition(id)));
    const loot = scene_actor_ids().find((id) => kind(id) === "loot" && sameCell(point, cellPosition(id)));
    const item = loot ? lootKinds[field(loot, "power") - 1] : undefined;
    if (mob) occupant = message("examine.monster", { monster: message(`monster.${kind(mob) as EnemyKind}`), health: field(mob, "health") });
    else if (loot) occupant = item ? message(`item.${item}.name`) : message("examine.gold");
  }
  const terrain = tile === "secret_door" ? "wall" : tile === "exit" && depth === 5 && !exitUnlocked ? "locked_exit" : tile;
  uiNotice = message("examine.cell", { terrain: message(`terrain.${terrain}`), occupant });
  overlayReturn = "playing"; setPhase("message");
}

function playerInput(dt: number, pointer: RuneweavePointerState): void {
  actionCooldown = Math.max(0, actionCooldown - dt);
  if (input_key_just_pressed("KeyF")) { toggleExamine(); return; }
  if (input_key_just_pressed("KeyE") || input_key_just_pressed("Period")) { descend(); return; }
  if (input_key_just_pressed("Space")) { queuedPath = []; spendTurns(); return; }
  if (input_key_just_pressed("KeyC")) { toggleCloak(); return; }
  if (input_key_just_pressed("KeyZ")) { const staff = equipment.find((gear) => gear.kind === "mages_staff"); if (staff) beginStaffZap(staff.id); return; }
  const shortcuts: ItemKind[] = ["potion_healing", "potion_liquid_flame", "potion_invisibility", "potion_strength", "scroll_upgrade", "scroll_magic_mapping", "food_ration", "spirit_bow"];
  for (const [index, item] of shortcuts.entries()) if (input_key_just_pressed(`Digit${index + 1}`)) { queuedPath = []; useInventoryItem(item); return; }
  const dx = Number(input_key_pressed("KeyD") || input_key_pressed("ArrowRight")) - Number(input_key_pressed("KeyA") || input_key_pressed("ArrowLeft"));
  const dz = Number(input_key_pressed("KeyS") || input_key_pressed("ArrowDown")) - Number(input_key_pressed("KeyW") || input_key_pressed("ArrowUp"));
  if (dx || dz) {
    if (examining || targeting) { examining = false; targeting = null; drawUi(); }
    queuedPath = [];
    if (actionCooldown <= 0) { movePlayer(dx, dz); actionCooldown = stepSeconds; }
    return;
  }
  if (pointer.justPressed) {
    queuedPath = [];
    if (pointer.y > window_safe_area().top - 150 || pointer.y < window_safe_area().bottom + 80) return;
    const hero = renderedPosition("player");
    const pointerScale = pointer.viewportHeight / window_metrics().height * uiMetrics().scale;
    const worldX = hero.x + shakeOffset() + pointer.x / pointerScale;
    const worldY = hero.y + 10 + pointer.y / pointerScale;
    const target = actorCellAt(worldX, worldY, selectedClass)
      ?? { x: Math.round(worldX / cellSize + 12), z: Math.round(12 - (worldY + 40) / cellSize) };
    if (target.x < 0 || target.z < 0 || target.x >= floor!.width || target.z >= floor!.height) return;
    if (targeting) { fireAtTarget(target); return; }
    if (!floor!.explored.has(cellKey(floor!, target))) return;
    if (examining) { examineCell(target); return; }
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
    actionCooldown = stepSeconds;
  }
}


function openChecks(): void {
  returnPhase = phase;
  checks = [];
  checkPage = 0;
  const check = (name: MessageKey, run: () => boolean): void => {
    try {
      checks.push(message("checks.line", { status: run() ? "PASS" : "FAIL", name: message(name) }));
    } catch {
      checks.push(message("checks.line", { status: "FAIL", name: message(name) }));
    }
  };
  check("checks.entity", () => {
    scene_spawn("probe", 0, 0, 0);
    scene_actor_set("probe", "probe", 5, 1, 0.3);
    actor("probe").set("health", 3);
    const reference = scene_transform("probe")!.get("translation") as BmsReflectReference;
    reference.set("x", 2);
    const actorOk = field("probe", "health") === 3 && position("probe").x === 2 && scene_actor_ids().includes("probe");
    try {
      actor("probe").set("kind", "chaser");
      applyHealing("probe", 8, 0);
      const effect = buffId("healing", "probe");
      const reflected = field(effect, "health") === 20 && field(effect, "power") === 0.25;
      effectAction(effect, 0);
      return actorOk && reflected && field("probe", "health") === 8 && field(effect, "health") === 15;
    } finally { removeBuffs("probe"); }
  });
  check("checks.values", () =>
    !scene_actor_set("missing", "probe", 1, 1, 1) &&
    !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1) &&
    !scene_set_model("probe", "../forbidden.glb") &&
    !window_set_size(NaN, 100)
  );
  check("checks.scene", () => {
    const sprite = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
    const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
    const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
    const camera = scene_set_3d_enabled(true) && scene_set_3d_enabled(false);
    return sprite && label && transformed && camera;
  });
  check("checks.despawn", () => scene_despawn("probe") && scene_actor("probe") == null && scene_transform("probe") == null);
  check("checks.ui", () => {
    ui_spawn("probe_ui", "", "node");
    ui_spawn("probe_child", "probe_ui", "text");
    ui_spawn("probe_image", "probe_ui", "image");
    const img = ui_set_image("probe_image", "sprites/settings-icon.png");
    const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
    return img && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
  });
  check("checks.input", () => {
    input_key_pressed("KeyW");
    input_key_just_pressed("KeyW");
    input_key_just_released("KeyW");
    input_primary_touch();
    return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0 && window_metrics().width > 0;
  });
  check("checks.unknownHttp", () => http_poll(2147483647).state === "unknown");
  const storage = storage_read("_acceptance_probe");
  if (storage.state === "error" && storage.error === "unavailable") checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.noStorage") }));
  else {
    check("checks.storage", () => {
      if (storage.state !== "missing") return false;
      const written = storage_write("_acceptance_probe", "ember-arena-probe");
      const read = storage_read("_acceptance_probe");
      const removed = storage_remove("_acceptance_probe");
      return written.state === "ok" && read.state === "ok" && read.value === "ember-arena-probe" && removed.state === "ok";
    });
  }
  checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.content") }));
  checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.apis") }));
  checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.platforms") }));
  setPhase("checks");
}

function checkNetwork(): void {
  if (networkRequests.length) return;
  networkStatus = message("network.pending");
  networkLines = [];
  networkRequests = [
    { id: http_get("https://httpbin.org/get"), method: "GET", elapsed: 0 },
    { id: http_post("https://httpbin.org/post", JSON.stringify({ game: "ember-arena", probe: true }), "application/json"), method: "POST", elapsed: 0 },
  ];
  drawUi();
}

function pollNetwork(dt: number): void {
  let changed = false;
  for (const request of [...networkRequests]) {
    request.elapsed += dt;
    const result = http_poll(request.id);
    if (result.state === "pending") continue;
    networkRequests = networkRequests.filter((candidate) => candidate !== request);
    networkLines.push(message("network.result", {
      status: result.state === "complete" && result.status >= 200 && result.status < 300 ? "PASS" : "FAIL",
      method: request.method,
      detail: result.state === "complete" ? result.status : result.state === "error" ? result.error.slice(0, 90) : message("network.unknown"),
    }));
    changed = true;
  }
  if (changed && phase === "checks") drawUi();
}

callbacks.on_script_loaded = (): void => {
  networkRequests = [];
  loadProfile();
  loadMenu();
};

callbacks.on_script_reloaded = (): void => {
  networkRequests = [];
  loadProfile();
  loadMenu();
};

callbacks.on_suspend = (): void => {
  settleSpriteMotion();
  if (mobileEnabled) mobileControls.reset(mobileContacts());
  queuedPath = []; targeting = null; examining = false;
  actionCooldown = 0; cameraShake = 0;
  if (phase === "playing") setPhase("paused");
};

callbacks.on_update = (delta: number): void => {
  const frameDelta = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.25);
  const dt = Math.min(frameDelta, 0.05);
  const pointer = input_primary_pointer();
  const safe = window_safe_area();
  const metrics = window_metrics();
  if (metrics.width <= 0 || metrics.height <= 0) return;
  const movingSprites = advanceSpriteMotion(frameDelta);
  const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
  if (viewport !== signature) {
    settleSpriteMotion();
    if (mobileEnabled) mobileControls.reset(mobileContacts(pointer));
    viewport = signature;
    refreshDungeon();
    drawUi();
  }
  const shaking = phase === "playing" && cameraShake > 0;
  if (shaking) cameraShake = Math.max(0, cameraShake - dt);
  if (movingSprites || shaking) updateCamera();
  const previousPhase = phase;
  const previousTurns = turns;
  const mobile = mobileEnabled ? mobileControls.sample(mobileContacts(pointer), uiMetrics(), { x: metrics.width, y: metrics.height }, phase === "playing") : undefined;
  if (mobile && phase === "playing") {
    const action = mobile.actions[0];
    if (action) { mobileAction(action); return; }
  }
  const uiActivated = mobile?.consumed ? false : updateUi();
  pollNetwork(dt);
  if (uiActivated || phase !== previousPhase || turns !== previousTurns) return;
  if (input_key_just_pressed("F12")) {
    if (phase === "checks") setPhase(returnPhase); else openChecks();
    return;
  }
  // Read-only layout fixtures are confined to the developer checks screen.
  // They never create a win/loss or mutate a run's persistent records.
  if (phase === "checks") {
    const previews: Phase[] = ["hero", "menu", "heroes", "playing", "inventory", "item", "paused", "settings", "won", "lost"];
    for (let index = 0; index < previews.length; index++) {
      if (input_key_just_pressed(`Digit${index}`)) { previewPhase = previews[index]!; drawUi(); return; }
    }
    if (previewPhase === "settings" && input_key_just_pressed("ArrowRight")) { settingsTab = (settingsTab + 1) % 6; drawUi(); return; }
  }

  // Shortcut keys
  if (input_key_just_pressed("Escape")) {
    if (phase === "playing" && targeting) { targeting = null; drawUi(); }
    else if (phase === "playing" && examining) { examining = false; drawUi(); }
    else if (phase === "playing") setPhase("paused");
    else if (phase === "inventory" || phase === "item" || phase === "equipment" || phase === "upgrade" || phase === "affix" || phase === "seal_transfer" || phase === "hero" || phase === "message") closeModal();
    else if (phase === "paused") setPhase("playing");
    else if (phase === "checks") setPhase(returnPhase);
    else if (phase === "settings") setPhase(settingsReturn);
    else if (phase !== "menu") loadMenu();
    return;
  }
  if (phase === "menu" && input_key_just_pressed("Space")) {
    setPhase("heroes");
    return;
  }
  if (phase === "inventory" && (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB"))) {
    setPhase("playing"); return;
  }
  if (phase === "heroes" && input_key_just_pressed("Space")) { startRun(); return; }
  if (phase === "playing") {
    if (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB")) {
      setPhase("inventory");
      return;
    }
  }

  if (phase !== "playing") return;

  elapsed += dt;
  const contact = mobile?.worldTap;
  const gamePointer = mobile ? { ...pointer, pressed: !!contact, justPressed: !!contact,
    x: contact ? (contact.x - 0.5) * pointer.viewportWidth : 0,
    y: contact ? (0.5 - contact.y) * pointer.viewportHeight : 0 } : pointer;
  playerInput(dt, gamePointer);

};
