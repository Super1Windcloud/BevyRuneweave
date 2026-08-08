"use strict";
(() => {
  // projects/ts/src/ecs.ts
  function clearWorld() {
    ecs_world_clear();
  }
  function spawnEntity(id) {
    ecs_entity_spawn(id);
  }
  function despawnEntity(id) {
    return ecs_entity_despawn(id);
  }
  function insertComponent(id, name, value) {
    return ecs_component_insert(id, name, value);
  }
  function setResource(name, value) {
    ecs_resource_set(name, value);
  }

  // projects/ts/src/shooter.ts
  var PLAYER_SPEED = 330;
  var BULLET_SPEED = 570;
  var ENEMY_SPEED = 145;
  var FIRE_DELAY = 0.18;
  var SPAWN_DELAY = 0.72;
  var DAMAGE_DELAY = 1;
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
  function spawnEntity2(id, bundle) {
    world.entities.add(id);
    world.transforms.set(id, bundle.transform);
    world.colliders.set(id, bundle.collider);
    world.sprites.set(id, bundle.sprite);
    if (bundle.velocity) world.velocities.set(id, bundle.velocity);
    if (bundle.role === "player") world.players.add(id);
    if (bundle.role === "bullet") world.bullets.add(id);
    if (bundle.role === "enemy") world.enemies.add(id);
    spawnEntity(id);
    insertComponent(id, "sprite", { kind: bundle.sprite });
    insertComponent(id, "transform", {
      x: bundle.transform.x,
      y: bundle.transform.y
    });
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
      despawnEntity(id);
    }
    world.pendingDespawn.clear();
  }
  function random01() {
    resources.seed = resources.seed * 48271 % 2147483647;
    return resources.seed / 2147483647;
  }
  function spawnPlayer() {
    spawnEntity2("player", {
      role: "player",
      sprite: "player",
      transform: { x: 0, y: -300 },
      collider: { x: 25, y: 35 }
    });
  }
  function spawnEnemy() {
    spawnEntity2(`enemy_${resources.nextId++}`, {
      role: "enemy",
      sprite: "enemy",
      transform: { x: -250 + random01() * 500, y: 350 },
      velocity: { x: 0, y: -ENEMY_SPEED },
      collider: { x: 30, y: 30 }
    });
  }
  function spawnBullet(playerTransform) {
    spawnEntity2(`bullet_${resources.nextId++}`, {
      role: "bullet",
      sprite: "bullet",
      transform: { x: playerTransform.x, y: playerTransform.y + 50 },
      velocity: { x: 0, y: BULLET_SPEED },
      collider: { x: 6, y: 12 }
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
      if (isActive(id)) insertComponent(id, "transform", transform);
    }
  }
  function gameStateSystem() {
    if (resources.lives <= 0) {
      resources.lives = 0;
      resources.gameOver = true;
      setResource("game_state", {
        score: resources.score,
        lives: resources.lives,
        message: "GAME OVER - TAP SPACE TO RESTART"
      });
    } else {
      setResource("game_state", {
        score: resources.score,
        lives: resources.lives,
        message: ""
      });
    }
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
    clearWorld();
    world = createWorld();
    resources = createResources();
    spawnPlayer();
    setResource("game_state", {
      score: resources.score,
      lives: resources.lives,
      message: "ARROWS/WASD - AUTO FIRE"
    });
  }
  var callbacks = globalThis;
  callbacks.on_script_loaded = function() {
    resetGame();
  };
  callbacks.on_script_reloaded = function() {
    resetGame();
  };
  callbacks.on_update = function(dt, inputX, inputY, restartPressed) {
    if (!resources.started) {
      if (restartPressed && !resources.restartWasPressed) {
        resources.started = true;
        setResource("game_state", {
          score: resources.score,
          lives: resources.lives,
          message: "ARROWS/WASD - AUTO FIRE"
        });
      } else {
        resources.restartWasPressed = restartPressed;
        setResource("game_state", {
          score: resources.score,
          lives: resources.lives,
          message: "PRESS SPACE TO START"
        });
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
})();
