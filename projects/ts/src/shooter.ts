declare function clear_game(): void;
declare function spawn_sprite(kind: string, id: string, x: number, y: number): void;
declare function set_position(id: string, x: number, y: number): void;
declare function despawn_sprite(id: string): void;
declare function set_hud(score: number, lives: number, message: string): void;

interface Point {
  x: number;
  y: number;
}

interface Actor extends Point {
  id: string;
  alive: boolean;
}

const PLAYER_SPEED = 330;
const BULLET_SPEED = 570;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;

let player: Point = { x: 0, y: -300 };
let bullets: Actor[] = [];
let enemies: Actor[] = [];
let score = 0;
let lives = 3;
let nextId = 1;
let fireTimer = 0;
let spawnTimer = 0;
let seed = 73129;
let gameOver = false;
let wasFiring = false;

function random01(): number {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
}

function resetGame(): void {
  clear_game();
  player = { x: 0, y: -300 };
  bullets = [];
  enemies = [];
  score = 0;
  lives = 3;
  nextId = 1;
  fireTimer = 0;
  spawnTimer = 0.35;
  seed = 73129;
  gameOver = false;
  spawn_sprite("player", "player", player.x, player.y);
  set_hud(score, lives, "ARROWS/WASD + HOLD SPACE");
}

function spawnEnemy(): void {
  const enemy: Actor = {
    id: `enemy_${nextId++}`,
    x: -250 + random01() * 500,
    y: 350,
    alive: true,
  };
  enemies.push(enemy);
  spawn_sprite("enemy", enemy.id, enemy.x, enemy.y);
}

function shoot(): void {
  const bullet: Actor = {
    id: `bullet_${nextId++}`,
    x: player.x,
    y: player.y + 50,
    alive: true,
  };
  bullets.push(bullet);
  spawn_sprite("bullet", bullet.id, bullet.x, bullet.y);
}

function hit(a: Point, b: Point, halfWidth: number, halfHeight: number): boolean {
  return Math.abs(a.x - b.x) < halfWidth && Math.abs(a.y - b.y) < halfHeight;
}

function on_script_loaded(): void {
  resetGame();
}

function on_script_reloaded(): void {
  resetGame();
}

function on_update(dt: number, inputX: number, inputY: number, firing: boolean): void {
  if (gameOver) {
    if (firing && !wasFiring) resetGame();
    wasFiring = firing;
    return;
  }

  player.x = Math.max(-260, Math.min(260, player.x + inputX * PLAYER_SPEED * dt));
  player.y = Math.max(-335, Math.min(300, player.y + inputY * PLAYER_SPEED * dt));
  set_position("player", player.x, player.y);

  fireTimer -= dt;
  if (firing && fireTimer <= 0) {
    shoot();
    fireTimer = FIRE_DELAY;
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = SPAWN_DELAY;
  }

  for (const bullet of bullets) {
    bullet.y += BULLET_SPEED * dt;
    if (bullet.y > 420) {
      bullet.alive = false;
      despawn_sprite(bullet.id);
    } else {
      set_position(bullet.id, bullet.x, bullet.y);
    }
  }

  for (const enemy of enemies) {
    enemy.y -= ENEMY_SPEED * dt;
    if (enemy.y < -420) {
      enemy.alive = false;
      lives -= 1;
      despawn_sprite(enemy.id);
    } else {
      set_position(enemy.id, enemy.x, enemy.y);
    }
  }

  for (const bullet of bullets) {
    if (!bullet.alive) continue;
    for (const enemy of enemies) {
      if (enemy.alive && hit(bullet, enemy, 36, 42)) {
        bullet.alive = false;
        enemy.alive = false;
        score += 100;
        despawn_sprite(bullet.id);
        despawn_sprite(enemy.id);
        break;
      }
    }
  }

  for (const enemy of enemies) {
    if (enemy.alive && hit(player, enemy, 55, 65)) {
      enemy.alive = false;
      lives -= 1;
      despawn_sprite(enemy.id);
    }
  }

  bullets = bullets.filter((item) => item.alive);
  enemies = enemies.filter((item) => item.alive);
  if (lives <= 0) {
    lives = 0;
    gameOver = true;
    set_hud(score, lives, "GAME OVER - TAP SPACE TO RESTART");
  } else {
    set_hud(score, lives, "");
  }
  wasFiring = firing;
}
