import {
  clearScene,
  despawnSceneEntity,
  setGameState,
  setSprite,
  setText,
  setTransform,
  spawnSceneEntity,
} from "../../api/scene.js";
import { requestExit } from "../../api/app.js";
import {
  keyJustPressed,
  keyPressed,
  primaryPointer,
  type PrimaryPointer,
} from "../../api/input.js";

type EntityId = string;
type Role = "player" | "bullet" | "enemy";

interface Vec2 {
  x: number;
  y: number;
}

interface ScriptTransform extends Vec2 {
  z: number;
}

interface SpriteSpec {
  path: string;
  width: number;
  height: number;
}

interface SpawnBundle {
  role: Role;
  sprite: SpriteSpec;
  transform: ScriptTransform;
  collider: Vec2;
  velocity?: Vec2;
}

interface World {
  entities: Set<EntityId>;
  transforms: Map<EntityId, ScriptTransform>;
  velocities: Map<EntityId, Vec2>;
  colliders: Map<EntityId, Vec2>;
  sprites: Map<EntityId, SpriteSpec>;
  players: Set<EntityId>;
  bullets: Set<EntityId>;
  enemies: Set<EntityId>;
  pendingDespawn: Set<EntityId>;
}

interface GameResources {
  score: number;
  lives: number;
  nextId: number;
  fireTimer: number;
  spawnTimer: number;
  damageTimer: number;
  seed: number;
  gameOver: boolean;
  restartWasPressed: boolean;
  started: boolean;
  settingsOpen: boolean;
  pointerWasPressed: boolean;
  pointerX: number;
  pointerY: number;
  playWidth: number;
}

interface FrameContext {
  dt: number;
  inputX: number;
  inputY: number;
  pointer: PrimaryPointer;
  pointerDeltaX: number;
  pointerDeltaY: number;
}

type GameSystem = (frame: FrameContext) => void;

const PLAYER_SPEED = 330;
const DESIGN_WIDTH = 600;
const DESIGN_HEIGHT = 800;
const BULLET_SPEED = 570;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;
const DAMAGE_DELAY = 1.0;
const SETTINGS_ICON_ID = "settings_icon";
const SETTINGS_MENU_IDS = ["settings_panel", "settings_title", "settings_restart", "settings_exit"];
const sprites = {
  background: { path: "sprites/background.png", width: 600, height: 800 },
  player: { path: "sprites/player.png", width: 72, height: 88 },
  enemy: { path: "sprites/enemy.png", width: 66, height: 70 },
  bullet: { path: "sprites/bullet.png", width: 14, height: 34 },
  settingsIcon: { path: "sprites/settings-icon.png", width: 64, height: 64 },
  settingsPanel: { path: "sprites/settings-panel.png", width: 440, height: 320 },
} satisfies Record<string, SpriteSpec>;

function createWorld(): World {
  return {
    entities: new Set(),
    transforms: new Map(),
    velocities: new Map(),
    colliders: new Map(),
    sprites: new Map(),
    players: new Set(),
    bullets: new Set(),
    enemies: new Set(),
    pendingDespawn: new Set(),
  };
}

function createResources(): GameResources {
  return {
    score: 0,
    lives: 3,
    nextId: 1,
    fireTimer: 0,
    spawnTimer: 0.35,
    damageTimer: 0,
    seed: 73129,
    gameOver: false,
    restartWasPressed: false,
    started: false,
    settingsOpen: false,
    pointerWasPressed: false,
    pointerX: 0,
    pointerY: 0,
    playWidth: DESIGN_WIDTH,
  };
}

let world = createWorld();
let resources = createResources();

function spawnEntity(id: EntityId, bundle: SpawnBundle): void {
  world.entities.add(id);
  world.transforms.set(id, bundle.transform);
  world.colliders.set(id, bundle.collider);
  world.sprites.set(id, bundle.sprite);
  if (bundle.velocity) world.velocities.set(id, bundle.velocity);
  if (bundle.role === "player") world.players.add(id);
  if (bundle.role === "bullet") world.bullets.add(id);
  if (bundle.role === "enemy") world.enemies.add(id);

  spawnSceneEntity(id, bundle.transform);
  setSprite(id, bundle.sprite);
}

function queueDespawn(id: EntityId): void {
  if (world.entities.has(id)) world.pendingDespawn.add(id);
}

function isActive(id: EntityId): boolean {
  return world.entities.has(id) && !world.pendingDespawn.has(id);
}

function flushEntityCommands(): void {
  for (const id of world.pendingDespawn) {
    world.entities.delete(id);
    world.transforms.delete(id);
    world.velocities.delete(id);
    world.colliders.delete(id);
    world.sprites.delete(id);
    world.players.delete(id);
    world.bullets.delete(id);
    world.enemies.delete(id);
    despawnSceneEntity(id);
  }
  world.pendingDespawn.clear();
}

function random01(): number {
  resources.seed = (resources.seed * 48271) % 2147483647;
  return resources.seed / 2147483647;
}

function spawnPlayer(): void {
  spawnEntity("player", {
    role: "player",
    sprite: sprites.player,
    transform: { x: 0, y: -300, z: 3 },
    collider: { x: 25, y: 35 },
  });
}

function spawnEnemy(): void {
  const horizontalLimit = Math.max(0, resources.playWidth * 0.5 - 50);
  spawnEntity(`enemy_${resources.nextId++}`, {
    role: "enemy",
    sprite: sprites.enemy,
    transform: { x: -horizontalLimit + random01() * horizontalLimit * 2, y: 350, z: 2 },
    velocity: { x: 0, y: -ENEMY_SPEED },
    collider: { x: 30, y: 30 },
  });
}

function spawnBullet(playerTransform: Vec2): void {
  spawnEntity(`bullet_${resources.nextId++}`, {
    role: "bullet",
    sprite: sprites.bullet,
    transform: { x: playerTransform.x, y: playerTransform.y + 50, z: 1 },
    velocity: { x: 0, y: BULLET_SPEED },
    collider: { x: 6, y: 12 },
  });
}

function playerMovementSystem(frame: FrameContext): void {
  for (const id of world.players) {
    const transform = world.transforms.get(id);
    if (!transform || !isActive(id)) continue;
    const movementX = frame.pointer.pressed
      ? frame.pointerDeltaX
      : frame.inputX * PLAYER_SPEED * frame.dt;
    const movementY = frame.pointer.pressed
      ? frame.pointerDeltaY
      : frame.inputY * PLAYER_SPEED * frame.dt;
    const horizontalLimit = Math.max(0, resources.playWidth * 0.5 - 40);
    transform.x = Math.max(-horizontalLimit, Math.min(horizontalLimit, transform.x + movementX));
    transform.y = Math.max(-335, Math.min(300, transform.y + movementY));
  }
}

function weaponSystem(frame: FrameContext): void {
  resources.fireTimer -= frame.dt;
  if (resources.fireTimer > 0) return;
  for (const id of world.players) {
    const transform = world.transforms.get(id);
    if (transform && isActive(id)) spawnBullet(transform);
  }
  resources.fireTimer = FIRE_DELAY;
}

function enemySpawnSystem(frame: FrameContext): void {
  resources.spawnTimer -= frame.dt;
  if (resources.spawnTimer <= 0) {
    spawnEnemy();
    resources.spawnTimer = SPAWN_DELAY;
  }
}

function movementSystem(frame: FrameContext): void {
  for (const [id, velocity] of world.velocities) {
    const transform = world.transforms.get(id);
    if (!transform || !isActive(id)) continue;
    transform.x += velocity.x * frame.dt;
    transform.y += velocity.y * frame.dt;
  }
}

function boundsSystem(): void {
  for (const id of world.bullets) {
    const transform = world.transforms.get(id);
    if (transform && transform.y > 420) queueDespawn(id);
  }
  for (const id of world.enemies) {
    const transform = world.transforms.get(id);
    if (transform && transform.y < -420) queueDespawn(id);
  }
}

function entitiesOverlap(left: EntityId, right: EntityId): boolean {
  const leftTransform = world.transforms.get(left);
  const rightTransform = world.transforms.get(right);
  const leftCollider = world.colliders.get(left);
  const rightCollider = world.colliders.get(right);
  if (!leftTransform || !rightTransform || !leftCollider || !rightCollider) return false;
  return (
    Math.abs(leftTransform.x - rightTransform.x) < leftCollider.x + rightCollider.x &&
    Math.abs(leftTransform.y - rightTransform.y) < leftCollider.y + rightCollider.y
  );
}

function collisionSystem(frame: FrameContext): void {
  for (const bullet of world.bullets) {
    if (!isActive(bullet)) continue;
    for (const enemy of world.enemies) {
      if (isActive(enemy) && entitiesOverlap(bullet, enemy)) {
        queueDespawn(bullet);
        queueDespawn(enemy);
        resources.score += 100;
        break;
      }
    }
  }

  resources.damageTimer = Math.max(0, resources.damageTimer - frame.dt);
  if (resources.damageTimer > 0) return;
  for (const player of world.players) {
    if (!isActive(player)) continue;
    for (const enemy of world.enemies) {
      if (isActive(enemy) && entitiesOverlap(player, enemy)) {
        queueDespawn(enemy);
        resources.lives -= 1;
        resources.damageTimer = DAMAGE_DELAY;
        return;
      }
    }
  }
}

function renderSyncSystem(): void {
  for (const [id, transform] of world.transforms) {
    if (isActive(id)) setTransform(id, transform);
  }
}

function updateGameState(message: string): void {
  setGameState(resources.score, resources.lives, message);
  const status = `SCORE ${(`00000${resources.score}`).slice(-5)}    LIVES ${resources.lives}`;
  setText("hud", {
    value: message ? `${status}\n${message}` : status,
    fontSize: Math.max(18, Math.min(25, resources.playWidth / 18)),
    red: 0.82,
    green: 0.94,
    blue: 1.0,
    alpha: 1.0,
    anchor: "top_left",
  });
}

function gameStateSystem(): void {
  if (resources.lives <= 0) {
    resources.lives = 0;
    resources.gameOver = true;
    updateGameState("CLICK / TOUCH / SPACE TO RESTART");
  } else {
    updateGameState("");
  }
}

function spawnScene(): void {
  spawnSceneEntity("background", { x: 0, y: 0, z: -10 });
  setSprite("background", sprites.background);
  spawnSceneEntity("hud", { x: 0, y: 382, z: 20 });
  spawnSceneEntity(SETTINGS_ICON_ID, { x: 0, y: 350, z: 50 });
  setSprite(SETTINGS_ICON_ID, sprites.settingsIcon);
  applyResponsiveLayout();
}

function responsiveLayout() {
  const iconSize = Math.max(44, Math.min(64, resources.playWidth * 0.17));
  const iconX = resources.playWidth * 0.5 - iconSize * 0.5 - 12;
  const menuWidth = Math.max(1, Math.min(440, resources.playWidth - 24));
  const menuScale = menuWidth / 440;
  return {
    iconSize,
    iconX,
    menuWidth,
    menuHeight: 320 * menuScale,
    menuScale,
    buttonWidth: 356 * menuScale,
    buttonHeight: 72 * menuScale,
    restartY: 20 * menuScale,
    exitY: -86 * menuScale,
  };
}

function applyResponsiveLayout(): void {
  const layout = responsiveLayout();
  setTransform("hud", { x: -resources.playWidth * 0.5 + 12, y: 382, z: 20 });
  setTransform(SETTINGS_ICON_ID, { x: layout.iconX, y: 350, z: 50 });
  setSprite(SETTINGS_ICON_ID, {
    path: sprites.settingsIcon.path,
    width: layout.iconSize,
    height: layout.iconSize,
  });
  if (!resources.settingsOpen) return;

  setSprite("settings_panel", {
    path: sprites.settingsPanel.path,
    width: layout.menuWidth,
    height: layout.menuHeight,
  });
  setTransform("settings_title", { x: 0, y: 125 * layout.menuScale, z: 41 });
  setTransform("settings_restart", { x: 0, y: layout.restartY, z: 41 });
  setTransform("settings_exit", { x: 0, y: layout.exitY, z: 41 });
  const titleSize = Math.max(16, 28 * layout.menuScale);
  const buttonSize = Math.max(15, 25 * layout.menuScale);
  setText("settings_title", {
    value: "SETTINGS",
    fontSize: titleSize,
    red: 0.91,
    green: 0.97,
    blue: 0.98,
    alpha: 1,
    anchor: "center",
  });
  setText("settings_restart", {
    value: "RESTART",
    fontSize: buttonSize,
    red: 0.91,
    green: 0.97,
    blue: 0.98,
    alpha: 1,
    anchor: "center",
  });
  setText("settings_exit", {
    value: "EXIT GAME",
    fontSize: buttonSize,
    red: 1,
    green: 0.72,
    blue: 0.74,
    alpha: 1,
    anchor: "center",
  });
}

function syncResponsiveLayout(viewportWidth: number): void {
  const nextWidth = Math.min(DESIGN_WIDTH, Math.max(1, viewportWidth));
  if (Math.abs(resources.playWidth - nextWidth) < 0.5) return;
  resources.playWidth = nextWidth;
  applyResponsiveLayout();
  if (resources.settingsOpen) updateGameState("PAUSED");
}

function setSettingsOpen(open: boolean): void {
  if (resources.settingsOpen === open) return;
  resources.settingsOpen = open;
  if (!open) {
    for (const id of SETTINGS_MENU_IDS) despawnSceneEntity(id);
    return;
  }

  spawnSceneEntity("settings_panel", { x: 0, y: 0, z: 40 });
  setSprite("settings_panel", sprites.settingsPanel);
  spawnSceneEntity("settings_title", { x: 0, y: 0, z: 41 });
  spawnSceneEntity("settings_restart", { x: 0, y: 0, z: 41 });
  spawnSceneEntity("settings_exit", { x: 0, y: 0, z: 41 });
  applyResponsiveLayout();
  updateGameState("PAUSED");
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

function handleSettingsInput(pointer: PrimaryPointer): boolean {
  const layout = responsiveLayout();
  const togglePressed = keyJustPressed("Escape")
    || (pointer.justPressed
      && pointerInside(pointer, layout.iconX, 350, layout.iconSize, layout.iconSize));
  if (togglePressed) {
    setSettingsOpen(!resources.settingsOpen);
    return true;
  }
  if (!resources.settingsOpen) return false;
  if (!pointer.justPressed) return true;
  if (pointerInside(
    pointer,
    0,
    layout.restartY,
    layout.buttonWidth,
    layout.buttonHeight,
  )) {
    resetGame(true, pointer.viewportWidth);
  } else if (pointerInside(
    pointer,
    0,
    layout.exitY,
    layout.buttonWidth,
    layout.buttonHeight,
  )) {
    requestExit();
  }
  return true;
}

const updateSchedule: GameSystem[] = [
  playerMovementSystem,
  weaponSystem,
  enemySpawnSystem,
  movementSystem,
  boundsSystem,
  collisionSystem,
];

function resetGame(started = false, viewportWidth = DESIGN_WIDTH): void {
  clearScene();
  world = createWorld();
  resources = createResources();
  resources.started = started;
  resources.playWidth = Math.min(DESIGN_WIDTH, Math.max(1, viewportWidth));
  spawnScene();
  spawnPlayer();
  updateGameState(started ? "DRAG OR ARROWS/WASD - AUTO FIRE" : "CLICK / TOUCH / SPACE TO START");
}

const callbacks = globalThis as typeof globalThis & RuneweaveCallbacks;

callbacks.on_script_loaded = function (): void {
  resetGame();
};

callbacks.on_script_reloaded = function (): void {
  resetGame();
};

callbacks.on_update = function (dt: number): void {
  const pointer = primaryPointer();
  syncResponsiveLayout(pointer.viewportWidth);
  if (handleSettingsInput(pointer)) {
    resources.pointerWasPressed = false;
    return;
  }
  let pointerDeltaX = 0;
  let pointerDeltaY = 0;
  if (pointer.pressed && resources.pointerWasPressed) {
    pointerDeltaX = pointer.x - resources.pointerX;
    pointerDeltaY = pointer.y - resources.pointerY;
  }
  resources.pointerWasPressed = pointer.pressed;
  if (pointer.pressed) {
    resources.pointerX = pointer.x;
    resources.pointerY = pointer.y;
  }
  const inputX = Number(keyPressed("ArrowRight") || keyPressed("KeyD"))
    - Number(keyPressed("ArrowLeft") || keyPressed("KeyA"));
  const inputY = Number(keyPressed("ArrowUp") || keyPressed("KeyW"))
    - Number(keyPressed("ArrowDown") || keyPressed("KeyS"));
  const pointerInPlayfield = Math.abs(pointer.x) <= resources.playWidth * 0.5
    && Math.abs(pointer.y) <= DESIGN_HEIGHT * 0.5;
  const restartPressed = keyPressed("Space") || (pointer.justPressed && pointerInPlayfield);
  if (!resources.started) {
    if (restartPressed && !resources.restartWasPressed) {
      resources.started = true;
      updateGameState("DRAG OR ARROWS/WASD - AUTO FIRE");
    } else {
      resources.restartWasPressed = restartPressed;
      updateGameState("CLICK / TOUCH / SPACE TO START");
      return;
    }
  }
  if (resources.gameOver) {
    if (restartPressed && !resources.restartWasPressed) resetGame(true, pointer.viewportWidth);
    resources.restartWasPressed = restartPressed;
    return;
  }

  const frame = { dt, inputX, inputY, pointer, pointerDeltaX, pointerDeltaY };
  for (const system of updateSchedule) system(frame);
  flushEntityCommands();
  gameStateSystem();
  renderSyncSystem();
  resources.restartWasPressed = restartPressed;
};
