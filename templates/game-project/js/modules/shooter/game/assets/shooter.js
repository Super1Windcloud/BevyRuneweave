const PLAYER_SPEED = 530;
const DESIGN_WIDTH = 600;
const DESIGN_HEIGHT = 800;
const BULLET_SPEED = 770;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;
const DAMAGE_DELAY = 1.0;
const SETTINGS_ICON_ID = "settings_icon";
const SETTINGS_MENU_IDS = ["settings_panel", "settings_title", "settings_restart", "settings_exit"];
const SPRITES = {
  background: { path: "sprites/background.png", width: 600, height: 800 },
  player: { path: "sprites/player.png", width: 72, height: 88 },
  enemy: { path: "sprites/enemy.png", width: 66, height: 70 },
  bullet: { path: "sprites/bullet.png", width: 14, height: 34 },
  settingsIcon: { path: "sprites/settings-icon.png", width: 64, height: 64 },
  settingsPanel: { path: "sprites/settings-panel.png", width: 440, height: 320 },
};

function createWorld() {
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

function createResources() {
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

function spawnEntity(id, bundle) {
  world.entities.add(id);
  world.transforms.set(id, bundle.transform);
  world.colliders.set(id, bundle.collider);
  world.sprites.set(id, bundle.sprite);
  if (bundle.velocity) world.velocities.set(id, bundle.velocity);
  if (bundle.role === "player") world.players.add(id);
  if (bundle.role === "bullet") world.bullets.add(id);
  if (bundle.role === "enemy") world.enemies.add(id);

  scene_spawn(id, bundle.transform.x, bundle.transform.y, bundle.transform.z);
  scene_set_sprite(id, bundle.sprite.path, bundle.sprite.width, bundle.sprite.height);
}

function queueDespawn(id) {
  if (world.entities.has(id)) world.pendingDespawn.add(id);
}

function isActive(id) {
  return world.entities.has(id) && !world.pendingDespawn.has(id);
}

function flushEntityCommands() {
  for (const id of world.pendingDespawn) {
    world.entities.delete(id);
    world.transforms.delete(id);
    world.velocities.delete(id);
    world.colliders.delete(id);
    world.sprites.delete(id);
    world.players.delete(id);
    world.bullets.delete(id);
    world.enemies.delete(id);
    scene_despawn(id);
  }
  world.pendingDespawn.clear();
}

function random01() {
  resources.seed = (resources.seed * 48271) % 2147483647;
  return resources.seed / 2147483647;
}

function spawnPlayer() {
  spawnEntity("player", {
    role: "player",
    sprite: SPRITES.player,
    transform: { x: 0, y: -300, z: 3 },
    collider: { x: 25, y: 35 },
  });
}

function spawnEnemy() {
  const horizontalLimit = Math.max(0, resources.playWidth * 0.5 - 50);
  spawnEntity(`enemy_${resources.nextId++}`, {
    role: "enemy",
    sprite: SPRITES.enemy,
    transform: { x: -horizontalLimit + random01() * horizontalLimit * 2, y: 350, z: 2 },
    velocity: { x: 0, y: -ENEMY_SPEED },
    collider: { x: 30, y: 30 },
  });
}

function spawnBullet(playerTransform) {
  spawnEntity(`bullet_${resources.nextId++}`, {
    role: "bullet",
    sprite: SPRITES.bullet,
    transform: { x: playerTransform.x, y: playerTransform.y + 50, z: 1 },
    velocity: { x: 0, y: BULLET_SPEED },
    collider: { x: 6, y: 12 },
  });
}

function playerMovementSystem(frame) {
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

function weaponSystem(frame) {
  resources.fireTimer -= frame.dt;
  if (resources.fireTimer > 0) return;
  for (const id of world.players) {
    const transform = world.transforms.get(id);
    if (transform && isActive(id)) spawnBullet(transform);
  }
  resources.fireTimer = FIRE_DELAY;
}

function enemySpawnSystem(frame) {
  resources.spawnTimer -= frame.dt;
  if (resources.spawnTimer <= 0) {
    spawnEnemy();
    resources.spawnTimer = SPAWN_DELAY;
  }
}

function movementSystem(frame) {
  for (const [id, velocity] of world.velocities) {
    const transform = world.transforms.get(id);
    if (!transform || !isActive(id)) continue;
    transform.x += velocity.x * frame.dt;
    transform.y += velocity.y * frame.dt;
  }
}

function boundsSystem() {
  for (const id of world.bullets) {
    const transform = world.transforms.get(id);
    if (transform && transform.y > 420) queueDespawn(id);
  }
  for (const id of world.enemies) {
    const transform = world.transforms.get(id);
    if (transform && transform.y < -420) queueDespawn(id);
  }
}

function entitiesOverlap(left, right) {
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

function collisionSystem(frame) {
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

function renderSyncSystem() {
  for (const [id, transform] of world.transforms) {
    if (isActive(id)) scene_set_transform(id, transform.x, transform.y, transform.z);
  }
}

function updateGameState(message) {
  game_state_set(resources.score, resources.lives, message);
  const status = `SCORE ${(`00000${resources.score}`).slice(-5)}    LIVES ${resources.lives}`;
  scene_set_text(
    "hud",
    message ? `${status}\n${message}` : status,
    Math.max(18, Math.min(25, resources.playWidth / 18)),
    0.82,
    0.94,
    1.0,
    1.0,
    "top_left",
  );
}

function gameStateSystem() {
  if (resources.lives <= 0) {
    resources.lives = 0;
    resources.gameOver = true;
    updateGameState("CLICK / TOUCH / SPACE TO RESTART");
  } else {
    updateGameState("");
  }
}

function spawnScene() {
  scene_spawn("background", 0, 0, -10);
  scene_set_sprite(
    "background",
    SPRITES.background.path,
    SPRITES.background.width,
    SPRITES.background.height,
  );
  scene_spawn("hud", 0, 382, 20);
  scene_spawn(SETTINGS_ICON_ID, 0, 350, 50);
  scene_set_sprite(
    SETTINGS_ICON_ID,
    SPRITES.settingsIcon.path,
    SPRITES.settingsIcon.width,
    SPRITES.settingsIcon.height,
  );
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

function applyResponsiveLayout() {
  const layout = responsiveLayout();
  scene_set_transform("hud", -resources.playWidth * 0.5 + 12, 382, 20);
  scene_set_transform(SETTINGS_ICON_ID, layout.iconX, 350, 50);
  scene_set_sprite(
    SETTINGS_ICON_ID,
    SPRITES.settingsIcon.path,
    layout.iconSize,
    layout.iconSize,
  );
  if (!resources.settingsOpen) return;
  scene_set_sprite(
    "settings_panel",
    SPRITES.settingsPanel.path,
    layout.menuWidth,
    layout.menuHeight,
  );
  scene_set_transform("settings_title", 0, 125 * layout.menuScale, 41);
  scene_set_transform("settings_restart", 0, layout.restartY, 41);
  scene_set_transform("settings_exit", 0, layout.exitY, 41);
  const titleSize = Math.max(16, 28 * layout.menuScale);
  const buttonSize = Math.max(15, 25 * layout.menuScale);
  scene_set_text("settings_title", "SETTINGS", titleSize, 0.91, 0.97, 0.98, 1, "center");
  scene_set_text("settings_restart", "RESTART", buttonSize, 0.91, 0.97, 0.98, 1, "center");
  scene_set_text("settings_exit", "EXIT GAME", buttonSize, 1, 0.72, 0.74, 1, "center");
}

function syncResponsiveLayout(viewportWidth) {
  const nextWidth = Math.min(DESIGN_WIDTH, Math.max(1, viewportWidth));
  if (Math.abs(resources.playWidth - nextWidth) < 0.5) return;
  resources.playWidth = nextWidth;
  applyResponsiveLayout();
  if (resources.settingsOpen) updateGameState("PAUSED");
}

function setSettingsOpen(open) {
  if (resources.settingsOpen === open) return;
  resources.settingsOpen = open;
  if (!open) {
    for (const id of SETTINGS_MENU_IDS) scene_despawn(id);
    return;
  }
  scene_spawn("settings_panel", 0, 0, 40);
  scene_set_sprite(
    "settings_panel",
    SPRITES.settingsPanel.path,
    SPRITES.settingsPanel.width,
    SPRITES.settingsPanel.height,
  );
  scene_spawn("settings_title", 0, 0, 41);
  scene_spawn("settings_restart", 0, 0, 41);
  scene_spawn("settings_exit", 0, 0, 41);
  applyResponsiveLayout();
  updateGameState("PAUSED");
}

function pointerInside(pointer, centerX, centerY, width, height) {
  return Math.abs(pointer.x - centerX) <= width * 0.5
    && Math.abs(pointer.y - centerY) <= height * 0.5;
}

function handleSettingsInput(pointer) {
  const layout = responsiveLayout();
  const togglePressed = input_key_just_pressed("Escape")
    || (pointer.justPressed
      && pointerInside(pointer, layout.iconX, 350, layout.iconSize, layout.iconSize));
  if (togglePressed) {
    setSettingsOpen(!resources.settingsOpen);
    return true;
  }
  if (!resources.settingsOpen) return false;
  if (!pointer.justPressed) return true;
  if (pointerInside(pointer, 0, layout.restartY, layout.buttonWidth, layout.buttonHeight)) {
    resetGame(true, pointer.viewportWidth);
  } else if (pointerInside(pointer, 0, layout.exitY, layout.buttonWidth, layout.buttonHeight)) {
    app_request_exit();
  }
  return true;
}

const updateSchedule = [
  playerMovementSystem,
  weaponSystem,
  enemySpawnSystem,
  movementSystem,
  boundsSystem,
  collisionSystem,
];

function resetGame(started = false, viewportWidth = DESIGN_WIDTH) {
  scene_clear();
  world = createWorld();
  resources = createResources();
  resources.started = started;
  resources.playWidth = Math.min(DESIGN_WIDTH, Math.max(1, viewportWidth));
  spawnScene();
  spawnPlayer();
  updateGameState(started ? "DRAG OR ARROWS/WASD - AUTO FIRE" : "CLICK / TOUCH / SPACE TO START");
}

globalThis.on_script_loaded = function () {
  window_set_size(DESIGN_WIDTH, DESIGN_HEIGHT);
  resetGame();
};
globalThis.on_script_reloaded = function () {
  window_set_size(DESIGN_WIDTH, DESIGN_HEIGHT);
  resetGame();
};
globalThis.on_update = function (dt) {
  const pointer = input_primary_pointer();
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
  const inputX = Number(input_key_pressed("ArrowRight") || input_key_pressed("KeyD"))
    - Number(input_key_pressed("ArrowLeft") || input_key_pressed("KeyA"));
  const inputY = Number(input_key_pressed("ArrowUp") || input_key_pressed("KeyW"))
    - Number(input_key_pressed("ArrowDown") || input_key_pressed("KeyS"));
  const pointerInPlayfield = Math.abs(pointer.x) <= resources.playWidth * 0.5
    && Math.abs(pointer.y) <= DESIGN_HEIGHT * 0.5;
  const restartPressed = input_key_pressed("Space")
    || (pointer.justPressed && pointerInPlayfield);
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
