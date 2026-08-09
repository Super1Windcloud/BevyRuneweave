const PLAYER_SPEED = 530;
const BULLET_SPEED = 770;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;
const DAMAGE_DELAY = 1.0;
const SPRITES = {
  background: { path: "sprites/background.png", width: 600, height: 800 },
  player: { path: "sprites/player.png", width: 72, height: 88 },
  enemy: { path: "sprites/enemy.png", width: 66, height: 70 },
  bullet: { path: "sprites/bullet.png", width: 14, height: 34 },
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

  ecs_entity_spawn(id);
  ecs_component_insert(id, "sprite", bundle.sprite);
  ecs_component_insert(id, "transform", bundle.transform);
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
    ecs_entity_despawn(id);
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
  spawnEntity(`enemy_${resources.nextId++}`, {
    role: "enemy",
    sprite: SPRITES.enemy,
    transform: { x: -250 + random01() * 500, y: 350, z: 2 },
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
    transform.x = Math.max(-260, Math.min(260, transform.x + frame.inputX * PLAYER_SPEED * frame.dt));
    transform.y = Math.max(-335, Math.min(300, transform.y + frame.inputY * PLAYER_SPEED * frame.dt));
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
    if (isActive(id)) ecs_component_insert(id, "transform", transform);
  }
}

function updateGameState(message) {
  ecs_resource_set("game_state", { score: resources.score, lives: resources.lives, message });
  const status = `SCORE ${String(resources.score).padStart(5, "0")}    LIVES ${resources.lives}`;
  ecs_component_insert("hud", "text", {
    value: message ? `${status}\n${message}` : status,
    fontSize: 25,
    red: 0.82,
    green: 0.94,
    blue: 1.0,
    alpha: 1.0,
    anchor: "top_center",
  });
}

function gameStateSystem() {
  if (resources.lives <= 0) {
    resources.lives = 0;
    resources.gameOver = true;
    updateGameState("GAME OVER - TAP SPACE TO RESTART");
  } else {
    updateGameState("");
  }
}

function spawnScene() {
  ecs_entity_spawn("background");
  ecs_component_insert("background", "sprite", SPRITES.background);
  ecs_component_insert("background", "transform", { x: 0, y: 0, z: -10 });
  ecs_entity_spawn("hud");
  ecs_component_insert("hud", "transform", { x: 0, y: 382, z: 20 });
}

const updateSchedule = [
  playerMovementSystem,
  weaponSystem,
  enemySpawnSystem,
  movementSystem,
  boundsSystem,
  collisionSystem,
];

function resetGame() {
  ecs_world_clear();
  world = createWorld();
  resources = createResources();
  spawnScene();
  spawnPlayer();
  updateGameState("ARROWS/WASD - AUTO FIRE");
}

globalThis.on_script_loaded = resetGame;
globalThis.on_script_reloaded = resetGame;
globalThis.on_update = function (dt) {
  const inputX = Number(input_key_pressed("ArrowRight") || input_key_pressed("KeyD"))
    - Number(input_key_pressed("ArrowLeft") || input_key_pressed("KeyA"));
  const inputY = Number(input_key_pressed("ArrowUp") || input_key_pressed("KeyW"))
    - Number(input_key_pressed("ArrowDown") || input_key_pressed("KeyS"));
  const restartPressed = input_key_pressed("Space");
  if (!resources.started) {
    if (restartPressed && !resources.restartWasPressed) {
      resources.started = true;
      updateGameState("ARROWS/WASD - AUTO FIRE");
    } else {
      resources.restartWasPressed = restartPressed;
      updateGameState("PRESS SPACE TO START");
      return;
    }
  }
  if (resources.gameOver) {
    if (restartPressed && !resources.restartWasPressed) resetGame();
    resources.restartWasPressed = restartPressed;
    return;
  }

  const frame = { dt, inputX, inputY };
  for (const system of updateSchedule) system(frame);
  flushEntityCommands();
  gameStateSystem();
  renderSyncSystem();
  resources.restartWasPressed = restartPressed;
};
