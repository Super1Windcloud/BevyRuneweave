declare function ecs_clear_world(): void;
declare function ecs_spawn_entity(id: string): void;
declare function ecs_insert_sprite(id: string, kind: string): void;
declare function ecs_set_transform(id: string, x: number, y: number): void;
declare function ecs_despawn_entity(id: string): void;
declare function ecs_set_game_state(score: number, lives: number, message: string): void;

type EntityId = string;
type Role = "player" | "bullet" | "enemy";

interface Vec2 {
  x: number;
  y: number;
}

interface SpawnBundle {
  role: Role;
  sprite: string;
  transform: Vec2;
  collider: Vec2;
  velocity?: Vec2;
}

interface World {
  entities: Set<EntityId>;
  transforms: Map<EntityId, Vec2>;
  velocities: Map<EntityId, Vec2>;
  colliders: Map<EntityId, Vec2>;
  sprites: Map<EntityId, string>;
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
}

interface FrameContext {
  dt: number;
  inputX: number;
  inputY: number;
}

type GameSystem = (frame: FrameContext) => void;

const PLAYER_SPEED = 330;
const BULLET_SPEED = 570;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;
const DAMAGE_DELAY = 1.0;

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

  ecs_spawn_entity(id);
  ecs_insert_sprite(id, bundle.sprite);
  ecs_set_transform(id, bundle.transform.x, bundle.transform.y);
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
    ecs_despawn_entity(id);
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
    sprite: "player",
    transform: { x: 0, y: -300 },
    collider: { x: 25, y: 35 },
  });
}

function spawnEnemy(): void {
  spawnEntity(`enemy_${resources.nextId++}`, {
    role: "enemy",
    sprite: "enemy",
    transform: { x: -250 + random01() * 500, y: 350 },
    velocity: { x: 0, y: -ENEMY_SPEED },
    collider: { x: 30, y: 30 },
  });
}

function spawnBullet(playerTransform: Vec2): void {
  spawnEntity(`bullet_${resources.nextId++}`, {
    role: "bullet",
    sprite: "bullet",
    transform: { x: playerTransform.x, y: playerTransform.y + 50 },
    velocity: { x: 0, y: BULLET_SPEED },
    collider: { x: 6, y: 12 },
  });
}

function playerMovementSystem(frame: FrameContext): void {
  for (const id of world.players) {
    const transform = world.transforms.get(id);
    if (!transform || !isActive(id)) continue;
    transform.x = Math.max(-260, Math.min(260, transform.x + frame.inputX * PLAYER_SPEED * frame.dt));
    transform.y = Math.max(-335, Math.min(300, transform.y + frame.inputY * PLAYER_SPEED * frame.dt));
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
    if (isActive(id)) ecs_set_transform(id, transform.x, transform.y);
  }
}

function gameStateSystem(): void {
  if (resources.lives <= 0) {
    resources.lives = 0;
    resources.gameOver = true;
    ecs_set_game_state(resources.score, resources.lives, "GAME OVER - TAP SPACE TO RESTART");
  } else {
    ecs_set_game_state(resources.score, resources.lives, "");
  }
}

const updateSchedule: GameSystem[] = [
  playerMovementSystem,
  weaponSystem,
  enemySpawnSystem,
  movementSystem,
  boundsSystem,
  collisionSystem,
];

function resetGame(): void {
  ecs_clear_world();
  world = createWorld();
  resources = createResources();
  spawnPlayer();
  ecs_set_game_state(resources.score, resources.lives, "ARROWS/WASD - AUTO FIRE");
}

function on_script_loaded(): void {
  resetGame();
}

function on_script_reloaded(): void {
  resetGame();
}

function on_update(dt: number, inputX: number, inputY: number, restartPressed: boolean): void {
  if (!resources.started) {
    if (restartPressed && !resources.restartWasPressed) {
      resources.started = true;
      ecs_set_game_state(resources.score, resources.lives, "ARROWS/WASD - AUTO FIRE");
    } else {
      resources.restartWasPressed = restartPressed;
      ecs_set_game_state(resources.score, resources.lives, "PRESS SPACE TO START");
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
}
