"use strict";
(() => {
  // modules/shooter/api/scene.ts
  function clearScene() {
    scene_clear();
  }
  function spawnSceneEntity(id, transform) {
    return scene_spawn(id, transform.x, transform.y, transform.z);
  }
  function setSprite(id, sprite) {
    return scene_set_sprite(id, sprite.path, sprite.width, sprite.height);
  }
  function setTransform(id, transform) {
    return scene_set_transform(id, transform.x, transform.y, transform.z);
  }
  function setText(id, text) {
    return scene_set_text(
      id,
      text.value,
      text.fontSize,
      text.red,
      text.green,
      text.blue,
      text.alpha,
      text.anchor
    );
  }
  function despawnSceneEntity(id) {
    return scene_despawn(id);
  }
  function setGameState(score, lives, message) {
    game_state_set(score, lives, message);
  }

  // modules/shooter/api/input.ts
  function keyPressed(key) {
    return input_key_pressed(key);
  }
  function primaryTouch() {
    return input_primary_touch();
  }

  // modules/shooter/game/src/shooter.ts
  var PLAYER_SPEED = 330;
  var TOUCH_WIDTH = 600;
  var TOUCH_HEIGHT = 800;
  var BULLET_SPEED = 570;
  var ENEMY_SPEED = 145;
  var FIRE_DELAY = 0.18;
  var SPAWN_DELAY = 0.72;
  var DAMAGE_DELAY = 1;
  var sprites = {
    background: { path: "sprites/background.png", width: 600, height: 800 },
    player: { path: "sprites/player.png", width: 72, height: 88 },
    enemy: { path: "sprites/enemy.png", width: 66, height: 70 },
    bullet: { path: "sprites/bullet.png", width: 14, height: 34 }
  };
  function createWorld() {
    return {
      entities: /* @__PURE__ */ new Set(),
      transforms: /* @__PURE__ */ new Map(),
      velocities: /* @__PURE__ */ new Map(),
      colliders: /* @__PURE__ */ new Map(),
      sprites: /* @__PURE__ */ new Map(),
      players: /* @__PURE__ */ new Set(),
      bullets: /* @__PURE__ */ new Set(),
      enemies: /* @__PURE__ */ new Set(),
      pendingDespawn: /* @__PURE__ */ new Set()
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
      started: false
    };
  }
  var world = createWorld();
  var resources = createResources();
  function spawnEntity(id, bundle) {
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
      despawnSceneEntity(id);
    }
    world.pendingDespawn.clear();
  }
  function random01() {
    resources.seed = resources.seed * 48271 % 2147483647;
    return resources.seed / 2147483647;
  }
  function spawnPlayer() {
    spawnEntity("player", {
      role: "player",
      sprite: sprites.player,
      transform: { x: 0, y: -300, z: 3 },
      collider: { x: 25, y: 35 }
    });
  }
  function spawnEnemy() {
    spawnEntity(`enemy_${resources.nextId++}`, {
      role: "enemy",
      sprite: sprites.enemy,
      transform: { x: -250 + random01() * 500, y: 350, z: 2 },
      velocity: { x: 0, y: -ENEMY_SPEED },
      collider: { x: 30, y: 30 }
    });
  }
  function spawnBullet(playerTransform) {
    spawnEntity(`bullet_${resources.nextId++}`, {
      role: "bullet",
      sprite: sprites.bullet,
      transform: { x: playerTransform.x, y: playerTransform.y + 50, z: 1 },
      velocity: { x: 0, y: BULLET_SPEED },
      collider: { x: 6, y: 12 }
    });
  }
  function playerMovementSystem(frame) {
    for (const id of world.players) {
      const transform = world.transforms.get(id);
      if (!transform || !isActive(id)) continue;
      const movementX = frame.touch.pressed ? frame.touch.deltaX * TOUCH_WIDTH : frame.inputX * PLAYER_SPEED * frame.dt;
      const movementY = frame.touch.pressed ? frame.touch.deltaY * TOUCH_HEIGHT : frame.inputY * PLAYER_SPEED * frame.dt;
      transform.x = Math.max(-260, Math.min(260, transform.x + movementX));
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
    return Math.abs(leftTransform.x - rightTransform.x) < leftCollider.x + rightCollider.x && Math.abs(leftTransform.y - rightTransform.y) < leftCollider.y + rightCollider.y;
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
      if (isActive(id)) setTransform(id, transform);
    }
  }
  function updateGameState(message) {
    setGameState(resources.score, resources.lives, message);
    const status = `SCORE ${`00000${resources.score}`.slice(-5)}    LIVES ${resources.lives}`;
    setText("hud", {
      value: message ? `${status}
${message}` : status,
      fontSize: 25,
      red: 0.82,
      green: 0.94,
      blue: 1,
      alpha: 1,
      anchor: "top_center"
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
    spawnSceneEntity("background", { x: 0, y: 0, z: -10 });
    setSprite("background", sprites.background);
    spawnSceneEntity("hud", { x: 0, y: 382, z: 20 });
  }
  var updateSchedule = [
    playerMovementSystem,
    weaponSystem,
    enemySpawnSystem,
    movementSystem,
    boundsSystem,
    collisionSystem
  ];
  function resetGame() {
    clearScene();
    world = createWorld();
    resources = createResources();
    spawnScene();
    spawnPlayer();
    updateGameState("DRAG OR ARROWS/WASD - AUTO FIRE");
  }
  var callbacks = globalThis;
  callbacks.on_script_loaded = function() {
    resetGame();
  };
  callbacks.on_script_reloaded = function() {
    resetGame();
  };
  callbacks.on_update = function(dt) {
    const touch = primaryTouch();
    const inputX = Number(keyPressed("ArrowRight") || keyPressed("KeyD")) - Number(keyPressed("ArrowLeft") || keyPressed("KeyA"));
    const inputY = Number(keyPressed("ArrowUp") || keyPressed("KeyW")) - Number(keyPressed("ArrowDown") || keyPressed("KeyS"));
    const restartPressed = keyPressed("Space") || touch.justPressed;
    if (!resources.started) {
      if (restartPressed && !resources.restartWasPressed) {
        resources.started = true;
        updateGameState("DRAG OR ARROWS/WASD - AUTO FIRE");
      } else {
        resources.restartWasPressed = restartPressed;
        updateGameState("TOUCH OR PRESS SPACE TO START");
        return;
      }
    }
    if (resources.gameOver) {
      if (restartPressed && !resources.restartWasPressed) resetGame();
      resources.restartWasPressed = restartPressed;
      return;
    }
    const frame = { dt, inputX, inputY, touch };
    for (const system of updateSchedule) system(frame);
    flushEntityCommands();
    gameStateSystem();
    renderSyncSystem();
    resources.restartWasPressed = restartPressed;
  };
})();
