"use strict";
const PLAYER_SPEED = 330;
const BULLET_SPEED = 570;
const ENEMY_SPEED = 145;
const FIRE_DELAY = 0.18;
const SPAWN_DELAY = 0.72;
let player = { x: 0, y: -300 };
let bullets = [];
let enemies = [];
let score = 0;
let lives = 3;
let nextId = 1;
let fireTimer = 0;
let spawnTimer = 0;
let seed = 73129;
let gameOver = false;
let wasFiring = false;
function spawnEntity(kind, id, x, y) {
    ecs_spawn_entity(id);
    ecs_insert_sprite(id, kind);
    ecs_set_transform(id, x, y);
}
function random01() {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
}
function resetGame() {
    ecs_clear_world();
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
    spawnEntity("player", "player", player.x, player.y);
    ecs_set_game_state(score, lives, "ARROWS/WASD + HOLD SPACE");
}
function spawnEnemy() {
    const enemy = {
        id: `enemy_${nextId++}`,
        x: -250 + random01() * 500,
        y: 350,
        alive: true,
    };
    enemies.push(enemy);
    spawnEntity("enemy", enemy.id, enemy.x, enemy.y);
}
function shoot() {
    const bullet = {
        id: `bullet_${nextId++}`,
        x: player.x,
        y: player.y + 50,
        alive: true,
    };
    bullets.push(bullet);
    spawnEntity("bullet", bullet.id, bullet.x, bullet.y);
}
function hit(a, b, halfWidth, halfHeight) {
    return Math.abs(a.x - b.x) < halfWidth && Math.abs(a.y - b.y) < halfHeight;
}
function on_script_loaded() {
    resetGame();
}
function on_script_reloaded() {
    resetGame();
}
function on_update(dt, inputX, inputY, firing) {
    if (gameOver) {
        if (firing && !wasFiring)
            resetGame();
        wasFiring = firing;
        return;
    }
    player.x = Math.max(-260, Math.min(260, player.x + inputX * PLAYER_SPEED * dt));
    player.y = Math.max(-335, Math.min(300, player.y + inputY * PLAYER_SPEED * dt));
    ecs_set_transform("player", player.x, player.y);
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
            ecs_despawn_entity(bullet.id);
        }
        else {
            ecs_set_transform(bullet.id, bullet.x, bullet.y);
        }
    }
    for (const enemy of enemies) {
        enemy.y -= ENEMY_SPEED * dt;
        if (enemy.y < -420) {
            enemy.alive = false;
            lives -= 1;
            ecs_despawn_entity(enemy.id);
        }
        else {
            ecs_set_transform(enemy.id, enemy.x, enemy.y);
        }
    }
    for (const bullet of bullets) {
        if (!bullet.alive)
            continue;
        for (const enemy of enemies) {
            if (enemy.alive && hit(bullet, enemy, 36, 42)) {
                bullet.alive = false;
                enemy.alive = false;
                score += 100;
                ecs_despawn_entity(bullet.id);
                ecs_despawn_entity(enemy.id);
                break;
            }
        }
    }
    for (const enemy of enemies) {
        if (enemy.alive && hit(player, enemy, 55, 65)) {
            enemy.alive = false;
            lives -= 1;
            ecs_despawn_entity(enemy.id);
        }
    }
    bullets = bullets.filter((item) => item.alive);
    enemies = enemies.filter((item) => item.alive);
    if (lives <= 0) {
        lives = 0;
        gameOver = true;
        ecs_set_game_state(score, lives, "GAME OVER - TAP SPACE TO RESTART");
    }
    else {
        ecs_set_game_state(score, lives, "");
    }
    wasFiring = firing;
}
