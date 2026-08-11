import {
  clearScene,
  despawnSceneEntity,
  setGameState,
  setSprite,
  setText,
  setTransform,
  spawnSceneEntity,
  type SpriteSpec,
} from "../../api/scene.js";
import { requestExit } from "../../api/app.js";
import {
  setWindowSize,
  windowSafeArea,
  type WindowSafeArea,
} from "../../api/window.js";
import {
  keyJustPressed,
  primaryPointer,
  type PrimaryPointer,
} from "../../api/input.js";

type Team = "blue" | "red";
type TowerKind = "king" | "princess";
type Lane = "left" | "right";
type MatchOutcome = Team | "draw" | null;

interface Vec2 {
  x: number;
  y: number;
}

interface CardDefinition {
  id: string;
  name: string;
  cost: number;
  art: SpriteSpec;
  unit: {
    hp: number;
    damage: number;
    speed: number;
    range: number;
    attackDelay: number;
    width: number;
    height: number;
  };
}

interface BattleUnit extends Vec2 {
  id: string;
  team: Team;
  lane: Lane;
  card: CardDefinition;
  hp: number;
  attackTimer: number;
}

interface Tower extends Vec2 {
  id: string;
  team: Team;
  kind: TowerKind;
  lane?: Lane;
  hp: number;
  maxHp: number;
  attackTimer: number;
  alive: boolean;
}

interface Layout {
  scale: number;
  fieldLeft: number;
  fieldRight: number;
  fieldTop: number;
  fieldBottom: number;
  riverY: number;
  cardWidth: number;
  cardHeight: number;
  cardY: number;
  elixirY: number;
  settingsX: number;
  settingsY: number;
  settingsSize: number;
  menuCenterX: number;
  menuCenterY: number;
  menuScale: number;
}

interface MatchResources {
  safeArea: WindowSafeArea;
  playLeft: number;
  playRight: number;
  playWidth: number;
  selectedCard: number;
  elixir: number;
  enemyElixir: number;
  matchSeconds: number;
  enemyDeployTimer: number;
  nextId: number;
  seed: number;
  blueCrowns: number;
  redCrowns: number;
  settingsOpen: boolean;
  outcome: MatchOutcome;
}

const DESKTOP_WINDOW_WIDTH = 540;
const DESKTOP_WINDOW_HEIGHT = 960;
const DESIGN_WIDTH = 450;
const DESIGN_HEIGHT = 800;
const MATCH_DURATION = 180;
const MAX_ELIXIR = 10;
const ELIXIR_PER_SECOND = 0.72;
const SETTINGS_ICON_ID = "settings_icon";
const SETTINGS_MENU_IDS = [
  "settings_panel",
  "settings_title",
  "settings_restart",
  "settings_exit",
];
const RESULT_IDS = ["result_panel", "result_title", "result_score", "result_restart"];
const FULL_SAFE_AREA: WindowSafeArea = {
  left: -DESIGN_WIDTH * 0.5,
  right: DESIGN_WIDTH * 0.5,
  bottom: -DESIGN_HEIGHT * 0.5,
  top: DESIGN_HEIGHT * 0.5,
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  leftInset: 0,
  rightInset: 0,
  bottomInset: 0,
  topInset: 0,
};

const sprites = {
  arena: { path: "sprites/royale/arena.png", width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
  towerBlue: { path: "sprites/royale/tower-blue.png", width: 86, height: 94 },
  towerRed: { path: "sprites/royale/tower-red.png", width: 86, height: 94 },
  cardFrame: { path: "sprites/royale/card-frame.png", width: 82, height: 100 },
  cardSelected: { path: "sprites/royale/card-selected.png", width: 82, height: 100 },
  elixirFull: { path: "sprites/royale/elixir-full.png", width: 31, height: 17 },
  elixirEmpty: { path: "sprites/royale/elixir-empty.png", width: 31, height: 17 },
  teamBlue: { path: "sprites/royale/team-blue.png", width: 26, height: 14 },
  teamRed: { path: "sprites/royale/team-red.png", width: 26, height: 14 },
  settingsIcon: { path: "sprites/settings-icon.png", width: 54, height: 54 },
  settingsPanel: { path: "sprites/settings-panel.png", width: 440, height: 320 },
} satisfies Record<string, SpriteSpec>;

const cards: CardDefinition[] = [
  {
    id: "knight",
    name: "KNIGHT",
    cost: 3,
    art: { path: "sprites/royale/knight.png", width: 74, height: 62 },
    unit: { hp: 430, damage: 70, speed: 47, range: 31, attackDelay: 0.95, width: 56, height: 48 },
  },
  {
    id: "archers",
    name: "ARCHERS",
    cost: 3,
    art: { path: "sprites/royale/archers.png", width: 74, height: 58 },
    unit: { hp: 255, damage: 52, speed: 44, range: 92, attackDelay: 1.05, width: 57, height: 45 },
  },
  {
    id: "giant",
    name: "GIANT",
    cost: 5,
    art: { path: "sprites/royale/giant.png", width: 76, height: 58 },
    unit: { hp: 760, damage: 94, speed: 28, range: 35, attackDelay: 1.25, width: 66, height: 50 },
  },
  {
    id: "goblins",
    name: "GOBLINS",
    cost: 2,
    art: { path: "sprites/royale/goblins.png", width: 68, height: 62 },
    unit: { hp: 210, damage: 46, speed: 61, range: 29, attackDelay: 0.72, width: 51, height: 47 },
  },
];

let units = new Map<string, BattleUnit>();
let towers = new Map<string, Tower>();
let resources = createResources();

function createResources(): MatchResources {
  return {
    safeArea: FULL_SAFE_AREA,
    playLeft: FULL_SAFE_AREA.left,
    playRight: FULL_SAFE_AREA.right,
    playWidth: DESIGN_WIDTH,
    selectedCard: 0,
    elixir: 5,
    enemyElixir: 5,
    matchSeconds: MATCH_DURATION,
    enemyDeployTimer: 2.25,
    nextId: 1,
    seed: 92317,
    blueCrowns: 0,
    redCrowns: 0,
    settingsOpen: false,
    outcome: null,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function random01(): number {
  resources.seed = (resources.seed * 48271) % 2147483647;
  return resources.seed / 2147483647;
}

function currentLayout(): Layout {
  const scale = clamp(
    Math.min(resources.playWidth / DESIGN_WIDTH, resources.safeArea.height / 740),
    0.72,
    1,
  );
  const handHeight = 144 * scale;
  const fieldLeft = resources.playLeft + 10 * scale;
  const fieldRight = resources.playRight - 10 * scale;
  const fieldTop = resources.safeArea.top - 52 * scale;
  const fieldBottom = resources.safeArea.bottom + handHeight;
  const cardWidth = Math.min(82 * scale, (resources.playWidth - 28 * scale) / 4);
  return {
    scale,
    fieldLeft,
    fieldRight,
    fieldTop,
    fieldBottom,
    riverY: fieldBottom + (fieldTop - fieldBottom) * 0.5,
    cardWidth,
    cardHeight: cardWidth * 1.22,
    cardY: resources.safeArea.bottom + 74 * scale,
    elixirY: resources.safeArea.bottom + 15 * scale,
    settingsX: resources.playRight - 28 * scale,
    settingsY: resources.safeArea.top - 27 * scale,
    settingsSize: 48 * scale,
    menuCenterX: (resources.playLeft + resources.playRight) * 0.5,
    menuCenterY: (resources.safeArea.top + resources.safeArea.bottom) * 0.5,
    menuScale: clamp(
      Math.min((resources.playWidth - 24) / 440, (resources.safeArea.height - 24) / 320),
      0.72,
      1,
    ),
  };
}

function spawnText(id: string, x: number, y: number, z: number): void {
  spawnSceneEntity(id, { x, y, z });
}

function setCenteredText(
  id: string,
  value: string,
  fontSize: number,
  color: { red: number; green: number; blue: number },
): void {
  setText(id, { value, fontSize, ...color, alpha: 1, anchor: "center" });
}

function spawnStaticScene(): void {
  spawnSceneEntity("arena", { x: 0, y: 0, z: -100 });
  setSprite("arena", sprites.arena);

  spawnText("enemy_name", 0, 0, 40);
  spawnText("blue_name", 0, 0, 40);
  spawnText("match_timer", 0, 0, 40);
  spawnText("crown_score", 0, 0, 40);
  spawnText("elixir_text", 0, 0, 42);

  spawnSceneEntity(SETTINGS_ICON_ID, { x: 0, y: 0, z: 60 });
  setSprite(SETTINGS_ICON_ID, sprites.settingsIcon);

  for (let index = 0; index < cards.length; index += 1) {
    spawnSceneEntity(`card_frame_${index}`, { x: 0, y: 0, z: 20 });
    spawnSceneEntity(`card_art_${index}`, { x: 0, y: 0, z: 21 });
    spawnText(`card_name_${index}`, 0, 0, 22);
    spawnText(`card_cost_${index}`, 0, 0, 23);
  }
  for (let index = 0; index < MAX_ELIXIR; index += 1) {
    spawnSceneEntity(`elixir_${index}`, { x: 0, y: 0, z: 20 });
  }
}

function createTowers(): void {
  const definitions: Array<Pick<Tower, "id" | "team" | "kind" | "lane" | "maxHp">> = [
    { id: "red_king", team: "red", kind: "king", maxHp: 2600 },
    { id: "red_left", team: "red", kind: "princess", lane: "left", maxHp: 1600 },
    { id: "red_right", team: "red", kind: "princess", lane: "right", maxHp: 1600 },
    { id: "blue_king", team: "blue", kind: "king", maxHp: 2600 },
    { id: "blue_left", team: "blue", kind: "princess", lane: "left", maxHp: 1600 },
    { id: "blue_right", team: "blue", kind: "princess", lane: "right", maxHp: 1600 },
  ];
  for (const definition of definitions) {
    const tower: Tower = {
      ...definition,
      x: 0,
      y: 0,
      hp: definition.maxHp,
      attackTimer: 0,
      alive: true,
    };
    towers.set(tower.id, tower);
    spawnSceneEntity(tower.id, { x: 0, y: 0, z: 10 });
    setSprite(tower.id, tower.team === "blue" ? sprites.towerBlue : sprites.towerRed);
    spawnText(`${tower.id}_hp`, 0, 0, 14);
  }
}

function cardCenterX(index: number, layout: Layout): number {
  const gap = 6 * layout.scale;
  const totalWidth = layout.cardWidth * cards.length + gap * (cards.length - 1);
  return resources.playLeft + (resources.playWidth - totalWidth) * 0.5
    + layout.cardWidth * 0.5
    + index * (layout.cardWidth + gap);
}

function applyTowerLayout(layout: Layout): void {
  const laneInset = Math.min(102 * layout.scale, (layout.fieldRight - layout.fieldLeft) * 0.25);
  const upperPrincessY = layout.riverY + (layout.fieldTop - layout.riverY) * 0.42;
  const lowerPrincessY = layout.riverY - (layout.riverY - layout.fieldBottom) * 0.42;
  const positions: Record<string, Vec2> = {
    red_king: { x: 0, y: layout.fieldTop - 47 * layout.scale },
    red_left: { x: layout.fieldLeft + laneInset, y: upperPrincessY },
    red_right: { x: layout.fieldRight - laneInset, y: upperPrincessY },
    blue_king: { x: 0, y: layout.fieldBottom + 47 * layout.scale },
    blue_left: { x: layout.fieldLeft + laneInset, y: lowerPrincessY },
    blue_right: { x: layout.fieldRight - laneInset, y: lowerPrincessY },
  };
  for (const tower of towers.values()) {
    const position = positions[tower.id];
    tower.x = position.x;
    tower.y = position.y;
    if (!tower.alive) continue;
    const width = (tower.kind === "king" ? 82 : 68) * layout.scale;
    const height = (tower.kind === "king" ? 90 : 75) * layout.scale;
    setTransform(tower.id, { x: tower.x, y: tower.y, z: tower.kind === "king" ? 11 : 10 });
    setSprite(tower.id, {
      path: tower.team === "blue" ? sprites.towerBlue.path : sprites.towerRed.path,
      width,
      height,
    });
    setTransform(`${tower.id}_hp`, {
      x: tower.x,
      y: tower.y - (tower.team === "red" ? height * 0.58 : -height * 0.58),
      z: 14,
    });
  }
}

function applyCardLayout(layout: Layout): void {
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const selectedOffset = index === resources.selectedCard ? 8 * layout.scale : 0;
    const x = cardCenterX(index, layout);
    const y = layout.cardY + selectedOffset;
    setTransform(`card_frame_${index}`, { x, y, z: 20 });
    setSprite(`card_frame_${index}`, {
      path: index === resources.selectedCard
        ? sprites.cardSelected.path
        : sprites.cardFrame.path,
      width: layout.cardWidth,
      height: layout.cardHeight,
    });
    setTransform(`card_art_${index}`, {
      x,
      y: y + layout.cardHeight * 0.1,
      z: 21,
    });
    setSprite(`card_art_${index}`, {
      path: card.art.path,
      width: layout.cardWidth * 0.78,
      height: layout.cardHeight * 0.58,
    });
    setTransform(`card_name_${index}`, {
      x,
      y: y - layout.cardHeight * 0.33,
      z: 22,
    });
    setCenteredText(
      `card_name_${index}`,
      card.name,
      Math.max(9, 11 * layout.scale),
      { red: 0.94, green: 0.96, blue: 1 },
    );
    setTransform(`card_cost_${index}`, {
      x: x - layout.cardWidth * 0.34,
      y: y + layout.cardHeight * 0.35,
      z: 23,
    });
    setCenteredText(
      `card_cost_${index}`,
      String(card.cost),
      Math.max(13, 16 * layout.scale),
      { red: 1, green: 0.84, blue: 1 },
    );
  }
}

function applyHudLayout(layout: Layout): void {
  setTransform(SETTINGS_ICON_ID, { x: layout.settingsX, y: layout.settingsY, z: 60 });
  setSprite(SETTINGS_ICON_ID, {
    path: sprites.settingsIcon.path,
    width: layout.settingsSize,
    height: layout.settingsSize,
  });
  const topTextY = resources.safeArea.top - 17 * layout.scale;
  setTransform("enemy_name", { x: resources.playLeft + 48 * layout.scale, y: topTextY, z: 40 });
  setTransform("match_timer", { x: 0, y: topTextY, z: 40 });
  setTransform("crown_score", { x: resources.playRight - 75 * layout.scale, y: topTextY, z: 40 });
  setTransform("blue_name", {
    x: resources.playLeft + 50 * layout.scale,
    y: layout.fieldBottom + 20 * layout.scale,
    z: 40,
  });
  setCenteredText("enemy_name", "RED KING", 14 * layout.scale, {
    red: 1,
    green: 0.72,
    blue: 0.72,
  });
  setCenteredText("blue_name", "BLUE KING", 13 * layout.scale, {
    red: 0.66,
    green: 0.86,
    blue: 1,
  });

  const cellWidth = Math.min(31 * layout.scale, (resources.playWidth - 80 * layout.scale) / 10);
  const cellGap = 3 * layout.scale;
  const totalWidth = cellWidth * 10 + cellGap * 9;
  const startX = -totalWidth * 0.5 + cellWidth * 0.5;
  for (let index = 0; index < MAX_ELIXIR; index += 1) {
    setTransform(`elixir_${index}`, {
      x: startX + index * (cellWidth + cellGap),
      y: layout.elixirY,
      z: 20,
    });
    setSprite(`elixir_${index}`, {
      path: index < Math.floor(resources.elixir)
        ? sprites.elixirFull.path
        : sprites.elixirEmpty.path,
      width: cellWidth,
      height: 17 * layout.scale,
    });
  }
  setTransform("elixir_text", {
    x: startX - cellWidth * 0.95,
    y: layout.elixirY,
    z: 42,
  });
  setCenteredText("elixir_text", String(Math.floor(resources.elixir)), 15 * layout.scale, {
    red: 0.96,
    green: 0.7,
    blue: 1,
  });
}

function applyResponsiveLayout(): void {
  const layout = currentLayout();
  setSprite("arena", {
    path: sprites.arena.path,
    width: Math.max(DESIGN_WIDTH, resources.safeArea.width),
    height: DESIGN_HEIGHT,
  });
  applyTowerLayout(layout);
  applyCardLayout(layout);
  applyHudLayout(layout);
  if (resources.settingsOpen) applySettingsLayout(layout);
  if (resources.outcome) applyResultLayout(layout);
  for (const unit of units.values()) {
    unit.x = clamp(unit.x, layout.fieldLeft + 18, layout.fieldRight - 18);
    unit.y = clamp(unit.y, layout.fieldBottom + 22, layout.fieldTop - 22);
  }
}

function syncResponsiveLayout(viewportWidth: number, safeArea: WindowSafeArea): void {
  const width = Math.min(DESIGN_WIDTH, viewportWidth);
  const nextLeft = Math.max(-width * 0.5, safeArea.left);
  const nextRight = Math.min(width * 0.5, safeArea.right);
  const unchanged = Math.abs(resources.playLeft - nextLeft) < 0.5
    && Math.abs(resources.playRight - nextRight) < 0.5
    && Math.abs(resources.safeArea.top - safeArea.top) < 0.5
    && Math.abs(resources.safeArea.bottom - safeArea.bottom) < 0.5;
  if (unchanged) return;
  resources.safeArea = safeArea;
  resources.playLeft = nextLeft;
  resources.playRight = Math.max(nextLeft + 1, nextRight);
  resources.playWidth = resources.playRight - resources.playLeft;
  applyResponsiveLayout();
}

function updateTowerText(): void {
  const layout = currentLayout();
  for (const tower of towers.values()) {
    if (!tower.alive) continue;
    setCenteredText(
      `${tower.id}_hp`,
      `${Math.max(0, Math.ceil(tower.hp))}`,
      Math.max(10, 12 * layout.scale),
      { red: 1, green: 1, blue: 0.9 },
    );
  }
}

function updateHud(): void {
  const minutes = Math.floor(resources.matchSeconds / 60);
  const seconds = Math.max(0, Math.ceil(resources.matchSeconds) % 60);
  setCenteredText(
    "match_timer",
    `${minutes}:${seconds.toString().padStart(2, "0")}`,
    18 * currentLayout().scale,
    { red: 1, green: 0.96, blue: 0.75 },
  );
  setCenteredText(
    "crown_score",
    `${resources.redCrowns}  -  ${resources.blueCrowns}`,
    17 * currentLayout().scale,
    { red: 1, green: 0.85, blue: 0.36 },
  );
  applyHudLayout(currentLayout());
  updateTowerText();
  setGameState(resources.blueCrowns, 3 - resources.redCrowns, resources.settingsOpen ? "PAUSED" : "");
}

function laneForX(x: number): Lane {
  return x < 0 ? "left" : "right";
}

function spawnUnit(team: Team, card: CardDefinition, x: number, y: number): void {
  const layout = currentLayout();
  const id = `${team}_${card.id}_${resources.nextId++}`;
  const unit: BattleUnit = {
    id,
    team,
    lane: laneForX(x),
    card,
    x: clamp(x, layout.fieldLeft + 24, layout.fieldRight - 24),
    y: clamp(y, layout.fieldBottom + 25, layout.fieldTop - 25),
    hp: card.unit.hp,
    attackTimer: 0,
  };
  units.set(id, unit);
  spawnSceneEntity(id, { x: unit.x, y: unit.y, z: 7 });
  setSprite(id, {
    path: card.art.path,
    width: card.unit.width * layout.scale,
    height: card.unit.height * layout.scale,
  });
  spawnSceneEntity(`${id}_team`, { x: unit.x, y: unit.y, z: 6 });
  setSprite(`${id}_team`, unit.team === "blue" ? sprites.teamBlue : sprites.teamRed);
}

function despawnUnit(id: string): void {
  units.delete(id);
  despawnSceneEntity(id);
  despawnSceneEntity(`${id}_team`);
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function targetTower(unit: BattleUnit): Tower | undefined {
  const laneTower = towers.get(`${unit.team === "blue" ? "red" : "blue"}_${unit.lane}`);
  if (laneTower?.alive) return laneTower;
  const kingTower = towers.get(`${unit.team === "blue" ? "red" : "blue"}_king`);
  return kingTower?.alive ? kingTower : undefined;
}

function nearestEnemyUnit(unit: BattleUnit, maximumDistance: number): BattleUnit | undefined {
  let nearest: BattleUnit | undefined;
  let nearestDistance = maximumDistance;
  for (const candidate of units.values()) {
    if (candidate.team === unit.team || candidate.hp <= 0) continue;
    const candidateDistance = distance(unit, candidate);
    if (candidateDistance < nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}

function moveToward(unit: BattleUnit, target: Vec2, speed: number, dt: number): void {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const step = Math.min(length, speed * dt);
  unit.x += dx / length * step;
  unit.y += dy / length * step;
}

function damageUnit(unit: BattleUnit, amount: number): void {
  unit.hp -= amount;
  if (unit.hp <= 0) despawnUnit(unit.id);
}

function damageTower(tower: Tower, amount: number, attackingTeam: Team): void {
  if (!tower.alive) return;
  tower.hp -= amount;
  if (tower.hp > 0) return;
  tower.alive = false;
  tower.hp = 0;
  despawnSceneEntity(tower.id);
  despawnSceneEntity(`${tower.id}_hp`);
  if (attackingTeam === "blue") resources.blueCrowns += 1;
  else resources.redCrowns += 1;
  if (tower.kind === "king") finishMatch(attackingTeam);
}

function unitSystem(dt: number): void {
  for (const unit of [...units.values()]) {
    if (!units.has(unit.id)) continue;
    unit.attackTimer = Math.max(0, unit.attackTimer - dt);
    const nearbyEnemy = nearestEnemyUnit(unit, unit.card.unit.range + 34);
    const target = nearbyEnemy ?? targetTower(unit);
    if (!target) continue;
    const attackDistance = unit.card.unit.range + (nearbyEnemy ? 10 : 32);
    if (distance(unit, target) <= attackDistance) {
      if (unit.attackTimer <= 0) {
        if (nearbyEnemy) damageUnit(nearbyEnemy, unit.card.unit.damage);
        else damageTower(target as Tower, unit.card.unit.damage, unit.team);
        unit.attackTimer = unit.card.unit.attackDelay;
      }
    } else {
      moveToward(unit, target, unit.card.unit.speed, dt);
    }
    if (!units.has(unit.id)) continue;
    const scale = currentLayout().scale;
    setTransform(unit.id, { x: unit.x, y: unit.y, z: 7 });
    setTransform(`${unit.id}_team`, {
      x: unit.x,
      y: unit.y - unit.card.unit.height * scale * 0.42,
      z: 6,
    });
  }
}

function towerCombatSystem(dt: number): void {
  for (const tower of towers.values()) {
    if (!tower.alive) continue;
    tower.attackTimer = Math.max(0, tower.attackTimer - dt);
    let target: BattleUnit | undefined;
    let targetDistance = tower.kind === "king" ? 138 : 152;
    for (const unit of units.values()) {
      if (unit.team === tower.team) continue;
      const unitDistance = distance(tower, unit);
      if (unitDistance < targetDistance) {
        target = unit;
        targetDistance = unitDistance;
      }
    }
    if (target && tower.attackTimer <= 0) {
      damageUnit(target, tower.kind === "king" ? 72 : 58);
      tower.attackTimer = tower.kind === "king" ? 0.82 : 0.95;
    }
  }
}

function enemyAiSystem(dt: number): void {
  resources.enemyDeployTimer -= dt;
  if (resources.enemyDeployTimer > 0) return;
  const affordable = cards.filter((card) => card.cost <= resources.enemyElixir);
  if (affordable.length === 0) {
    resources.enemyDeployTimer = 0.6;
    return;
  }
  const card = affordable[Math.floor(random01() * affordable.length)];
  const layout = currentLayout();
  const laneX = random01() < 0.5
    ? layout.fieldLeft + (layout.fieldRight - layout.fieldLeft) * 0.27
    : layout.fieldRight - (layout.fieldRight - layout.fieldLeft) * 0.27;
  const y = layout.riverY + 50 * layout.scale + random01() * 42 * layout.scale;
  spawnUnit("red", card, laneX, y);
  resources.enemyElixir -= card.cost;
  resources.enemyDeployTimer = 1.35 + random01() * 1.35;
}

function matchSystem(dt: number): void {
  resources.elixir = Math.min(MAX_ELIXIR, resources.elixir + ELIXIR_PER_SECOND * dt);
  resources.enemyElixir = Math.min(MAX_ELIXIR, resources.enemyElixir + ELIXIR_PER_SECOND * dt);
  resources.matchSeconds = Math.max(0, resources.matchSeconds - dt);
  if (resources.matchSeconds > 0) return;
  if (resources.blueCrowns !== resources.redCrowns) {
    finishMatch(resources.blueCrowns > resources.redCrowns ? "blue" : "red");
    return;
  }
  const blueHealth = [...towers.values()]
    .filter((tower) => tower.team === "blue" && tower.alive)
    .reduce((total, tower) => total + tower.hp, 0);
  const redHealth = [...towers.values()]
    .filter((tower) => tower.team === "red" && tower.alive)
    .reduce((total, tower) => total + tower.hp, 0);
  finishMatch(blueHealth === redHealth ? "draw" : blueHealth > redHealth ? "blue" : "red");
}

function pointerInside(
  pointer: PrimaryPointer,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): boolean {
  return Math.abs(pointer.x - centerX) <= width * 0.5
    && Math.abs(pointer.y - centerY) <= height * 0.5;
}

function setSelectedCard(index: number): void {
  if (resources.selectedCard === index) return;
  resources.selectedCard = index;
  applyCardLayout(currentLayout());
}

function handleCardInput(pointer: PrimaryPointer): boolean {
  for (let index = 0; index < cards.length; index += 1) {
    if (keyJustPressed(`Digit${index + 1}`)) {
      setSelectedCard(index);
      return true;
    }
  }
  if (!pointer.justPressed) return false;
  const layout = currentLayout();
  for (let index = 0; index < cards.length; index += 1) {
    if (pointerInside(
      pointer,
      cardCenterX(index, layout),
      layout.cardY,
      layout.cardWidth,
      layout.cardHeight + 14 * layout.scale,
    )) {
      setSelectedCard(index);
      return true;
    }
  }
  const inDeployZone = pointer.x >= layout.fieldLeft
    && pointer.x <= layout.fieldRight
    && pointer.y >= layout.fieldBottom + 24 * layout.scale
    && pointer.y <= layout.riverY - 24 * layout.scale;
  const card = cards[resources.selectedCard];
  if (inDeployZone && resources.elixir >= card.cost) {
    spawnUnit("blue", card, pointer.x, pointer.y);
    resources.elixir -= card.cost;
    return true;
  }
  return false;
}

function setSettingsOpen(open: boolean): void {
  if (resources.settingsOpen === open) return;
  resources.settingsOpen = open;
  if (!open) {
    for (const id of SETTINGS_MENU_IDS) despawnSceneEntity(id);
    return;
  }
  spawnSceneEntity("settings_panel", { x: 0, y: 0, z: 70 });
  setSprite("settings_panel", sprites.settingsPanel);
  spawnText("settings_title", 0, 0, 71);
  spawnText("settings_restart", 0, 0, 71);
  spawnText("settings_exit", 0, 0, 71);
  applySettingsLayout(currentLayout());
}

function applySettingsLayout(layout: Layout): void {
  const scale = layout.menuScale;
  setTransform("settings_panel", {
    x: layout.menuCenterX,
    y: layout.menuCenterY,
    z: 70,
  });
  setSprite("settings_panel", {
    path: sprites.settingsPanel.path,
    width: 440 * scale,
    height: 320 * scale,
  });
  setTransform("settings_title", {
    x: layout.menuCenterX,
    y: layout.menuCenterY + 124 * scale,
    z: 71,
  });
  setTransform("settings_restart", {
    x: layout.menuCenterX,
    y: layout.menuCenterY + 20 * scale,
    z: 71,
  });
  setTransform("settings_exit", {
    x: layout.menuCenterX,
    y: layout.menuCenterY - 86 * scale,
    z: 71,
  });
  setCenteredText("settings_title", "BATTLE MENU", 27 * scale, {
    red: 0.91,
    green: 0.97,
    blue: 1,
  });
  setCenteredText("settings_restart", "RESTART", 25 * scale, {
    red: 0.91,
    green: 0.97,
    blue: 1,
  });
  setCenteredText("settings_exit", "EXIT GAME", 25 * scale, {
    red: 1,
    green: 0.72,
    blue: 0.74,
  });
}

function handleSettingsInput(pointer: PrimaryPointer): boolean {
  const layout = currentLayout();
  const togglePressed = keyJustPressed("Escape")
    || (pointer.justPressed && pointerInside(
      pointer,
      layout.settingsX,
      layout.settingsY,
      layout.settingsSize,
      layout.settingsSize,
    ));
  if (togglePressed) {
    setSettingsOpen(!resources.settingsOpen);
    return true;
  }
  if (!resources.settingsOpen) return false;
  if (!pointer.justPressed) return true;
  const buttonWidth = 356 * layout.menuScale;
  const buttonHeight = 72 * layout.menuScale;
  if (pointerInside(
    pointer,
    layout.menuCenterX,
    layout.menuCenterY + 20 * layout.menuScale,
    buttonWidth,
    buttonHeight,
  )) {
    resetBattle(pointer.viewportWidth, resources.safeArea);
  } else if (pointerInside(
    pointer,
    layout.menuCenterX,
    layout.menuCenterY - 86 * layout.menuScale,
    buttonWidth,
    buttonHeight,
  )) {
    requestExit();
  }
  return true;
}

function finishMatch(outcome: Exclude<MatchOutcome, null>): void {
  if (resources.outcome) return;
  resources.outcome = outcome;
  spawnSceneEntity("result_panel", { x: 0, y: 0, z: 65 });
  setSprite("result_panel", sprites.settingsPanel);
  spawnText("result_title", 0, 0, 66);
  spawnText("result_score", 0, 0, 66);
  spawnText("result_restart", 0, 0, 66);
  applyResultLayout(currentLayout());
}

function applyResultLayout(layout: Layout): void {
  const scale = layout.menuScale;
  const title = resources.outcome === "blue"
    ? "VICTORY"
    : resources.outcome === "red"
      ? "DEFEAT"
      : "DRAW";
  setTransform("result_panel", { x: layout.menuCenterX, y: layout.menuCenterY, z: 65 });
  setSprite("result_panel", {
    path: sprites.settingsPanel.path,
    width: 440 * scale,
    height: 320 * scale,
  });
  setTransform("result_title", {
    x: layout.menuCenterX,
    y: layout.menuCenterY + 96 * scale,
    z: 66,
  });
  setTransform("result_score", {
    x: layout.menuCenterX,
    y: layout.menuCenterY + 18 * scale,
    z: 66,
  });
  setTransform("result_restart", {
    x: layout.menuCenterX,
    y: layout.menuCenterY - 78 * scale,
    z: 66,
  });
  setCenteredText("result_title", title, 33 * scale, {
    red: title === "DEFEAT" ? 1 : 1,
    green: title === "DEFEAT" ? 0.63 : 0.88,
    blue: title === "VICTORY" ? 0.38 : 0.58,
  });
  setCenteredText(
    "result_score",
    `${resources.blueCrowns}  CROWNS  ${resources.redCrowns}`,
    22 * scale,
    { red: 1, green: 0.93, blue: 0.7 },
  );
  setCenteredText("result_restart", "PLAY AGAIN", 24 * scale, {
    red: 0.85,
    green: 0.96,
    blue: 1,
  });
}

function handleResultInput(pointer: PrimaryPointer): boolean {
  if (!resources.outcome) return false;
  if (!pointer.justPressed) return true;
  const layout = currentLayout();
  if (pointerInside(
    pointer,
    layout.menuCenterX,
    layout.menuCenterY - 78 * layout.menuScale,
    356 * layout.menuScale,
    72 * layout.menuScale,
  )) {
    resetBattle(pointer.viewportWidth, resources.safeArea);
  }
  return true;
}

function resetBattle(viewportWidth = DESIGN_WIDTH, safeArea = FULL_SAFE_AREA): void {
  clearScene();
  units = new Map();
  towers = new Map();
  resources = createResources();
  resources.safeArea = safeArea;
  const width = Math.min(DESIGN_WIDTH, viewportWidth);
  resources.playLeft = Math.max(-width * 0.5, safeArea.left);
  resources.playRight = Math.max(
    resources.playLeft + 1,
    Math.min(width * 0.5, safeArea.right),
  );
  resources.playWidth = resources.playRight - resources.playLeft;
  spawnStaticScene();
  createTowers();
  applyResponsiveLayout();
  updateHud();
}

const callbacks = globalThis as typeof globalThis & RuneweaveCallbacks;

callbacks.on_script_loaded = function (): void {
  setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
  const safeArea = windowSafeArea();
  resetBattle(safeArea.width, safeArea);
};

callbacks.on_script_reloaded = function (): void {
  setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
  const safeArea = windowSafeArea();
  resetBattle(safeArea.width, safeArea);
};

callbacks.on_update = function (dt: number): void {
  const pointer = primaryPointer();
  syncResponsiveLayout(pointer.viewportWidth, windowSafeArea());
  if (handleSettingsInput(pointer)) {
    updateHud();
    return;
  }
  if (handleResultInput(pointer)) {
    updateHud();
    return;
  }
  handleCardInput(pointer);
  const frameTime = Math.min(Math.max(dt, 0), 0.05);
  matchSystem(frameTime);
  enemyAiSystem(frameTime);
  unitSystem(frameTime);
  towerCombatSystem(frameTime);
  updateHud();
};
