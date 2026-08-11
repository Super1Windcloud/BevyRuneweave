"use strict";
(() => {
  // modules/clash/api/scene.ts
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

  // modules/clash/api/app.ts
  function requestExit() {
    return app_request_exit();
  }

  // modules/clash/api/window.ts
  function setWindowSize(width, height) {
    return window_set_size(width, height);
  }
  function windowSafeArea() {
    return window_safe_area();
  }

  // modules/clash/api/input.ts
  function keyPressed(key) {
    return input_key_pressed(key);
  }
  function keyJustPressed(key) {
    return input_key_just_pressed(key);
  }
  function primaryPointer() {
    return input_primary_pointer();
  }

  // modules/clash/game/src/clash.ts
  var PLAYER_SPEED = 330;
  var DESKTOP_WINDOW_WIDTH = 540;
  var DESKTOP_WINDOW_HEIGHT = 960;
  var DESIGN_WIDTH = 450;
  var DESIGN_HEIGHT = 800;
  var BULLET_SPEED = 570;
  var ENEMY_SPEED = 145;
  var FIRE_DELAY = 0.18;
  var SPAWN_DELAY = 0.72;
  var DAMAGE_DELAY = 1;
  var SETTINGS_ICON_ID = "settings_icon";
  var SETTINGS_MENU_IDS = ["settings_panel", "settings_title", "settings_restart", "settings_exit"];
  var FULL_SAFE_AREA = {
    left: -DESIGN_WIDTH * 0.5,
    right: DESIGN_WIDTH * 0.5,
    bottom: -DESIGN_HEIGHT * 0.5,
    top: DESIGN_HEIGHT * 0.5,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    leftInset: 0,
    rightInset: 0,
    bottomInset: 0,
    topInset: 0
  };
  var sprites = {
    background: { path: "sprites/background.png", width: 600, height: 800 },
    player: { path: "sprites/player.png", width: 72, height: 88 },
    enemy: { path: "sprites/enemy.png", width: 66, height: 70 },
    bullet: { path: "sprites/bullet.png", width: 14, height: 34 },
    settingsIcon: { path: "sprites/settings-icon.png", width: 64, height: 64 },
    settingsPanel: { path: "sprites/settings-panel.png", width: 440, height: 320 }
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
      started: false,
      settingsOpen: false,
      pointerWasPressed: false,
      pointerX: 0,
      pointerY: 0,
      playLeft: FULL_SAFE_AREA.left,
      playRight: FULL_SAFE_AREA.right,
      playWidth: DESIGN_WIDTH,
      safeArea: FULL_SAFE_AREA
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
    const minY = resources.safeArea.bottom + sprites.player.height * 0.5 + 8;
    const maxY = resources.safeArea.top - sprites.player.height * 0.5 - 8;
    spawnEntity("player", {
      role: "player",
      sprite: sprites.player,
      transform: { x: 0, y: Math.max(minY, Math.min(maxY, -300)), z: 3 },
      collider: { x: 25, y: 35 }
    });
  }
  function spawnEnemy() {
    const minX = resources.playLeft + 50;
    const maxX = resources.playRight - 50;
    spawnEntity(`enemy_${resources.nextId++}`, {
      role: "enemy",
      sprite: sprites.enemy,
      transform: {
        x: minX + random01() * Math.max(0, maxX - minX),
        y: resources.safeArea.top - sprites.enemy.height * 0.5 - 8,
        z: 2
      },
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
      const movementX = frame.pointer.pressed ? frame.pointerDeltaX : frame.inputX * PLAYER_SPEED * frame.dt;
      const movementY = frame.pointer.pressed ? frame.pointerDeltaY : frame.inputY * PLAYER_SPEED * frame.dt;
      const minX = resources.playLeft + sprites.player.width * 0.5;
      const maxX = resources.playRight - sprites.player.width * 0.5;
      const minY = resources.safeArea.bottom + sprites.player.height * 0.5 + 8;
      const maxY = resources.safeArea.top - sprites.player.height * 0.5 - 8;
      transform.x = Math.max(minX, Math.min(maxX, transform.x + movementX));
      transform.y = Math.max(minY, Math.min(maxY, transform.y + movementY));
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
      if (transform && transform.y + sprites.bullet.height * 0.5 >= resources.safeArea.top) {
        queueDespawn(id);
      }
    }
    for (const id of world.enemies) {
      const transform = world.transforms.get(id);
      if (transform && transform.y - sprites.enemy.height * 0.5 <= resources.safeArea.bottom) {
        queueDespawn(id);
      }
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
      fontSize: Math.max(18, Math.min(25, resources.playWidth / 18)),
      red: 0.82,
      green: 0.94,
      blue: 1,
      alpha: 1,
      anchor: "top_left"
    });
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
    spawnSceneEntity("background", { x: 0, y: 0, z: -10 });
    setSprite("background", sprites.background);
    spawnSceneEntity("hud", { x: 0, y: 382, z: 20 });
    spawnSceneEntity(SETTINGS_ICON_ID, { x: 0, y: 350, z: 50 });
    setSprite(SETTINGS_ICON_ID, sprites.settingsIcon);
    applyResponsiveLayout();
  }
  function responsiveLayout() {
    const iconSize = Math.max(44, Math.min(64, resources.playWidth * 0.17));
    const iconX = resources.playRight - iconSize * 0.5 - 12;
    const iconY = resources.safeArea.top - iconSize * 0.5 - 12;
    const menuScale = Math.max(0.1, Math.min(
      1,
      (resources.playWidth - 24) / 440,
      (resources.safeArea.height - 24) / 320
    ));
    const menuCenterX = (resources.playLeft + resources.playRight) * 0.5;
    const menuCenterY = (resources.safeArea.top + resources.safeArea.bottom) * 0.5;
    return {
      iconSize,
      iconX,
      iconY,
      menuCenterX,
      menuCenterY,
      menuWidth: 440 * menuScale,
      menuHeight: 320 * menuScale,
      menuScale,
      buttonWidth: 356 * menuScale,
      buttonHeight: 72 * menuScale,
      restartY: menuCenterY + 20 * menuScale,
      exitY: menuCenterY - 86 * menuScale
    };
  }
  function applyResponsiveLayout() {
    const layout = responsiveLayout();
    setTransform("hud", { x: resources.playLeft + 12, y: resources.safeArea.top - 12, z: 20 });
    setTransform(SETTINGS_ICON_ID, { x: layout.iconX, y: layout.iconY, z: 50 });
    setSprite(SETTINGS_ICON_ID, {
      path: sprites.settingsIcon.path,
      width: layout.iconSize,
      height: layout.iconSize
    });
    if (!resources.settingsOpen) return;
    setSprite("settings_panel", {
      path: sprites.settingsPanel.path,
      width: layout.menuWidth,
      height: layout.menuHeight
    });
    setTransform("settings_panel", { x: layout.menuCenterX, y: layout.menuCenterY, z: 40 });
    setTransform("settings_title", {
      x: layout.menuCenterX,
      y: layout.menuCenterY + 125 * layout.menuScale,
      z: 41
    });
    setTransform("settings_restart", { x: layout.menuCenterX, y: layout.restartY, z: 41 });
    setTransform("settings_exit", { x: layout.menuCenterX, y: layout.exitY, z: 41 });
    const titleSize = Math.max(16, 28 * layout.menuScale);
    const buttonSize = Math.max(15, 25 * layout.menuScale);
    setText("settings_title", {
      value: "SETTINGS",
      fontSize: titleSize,
      red: 0.91,
      green: 0.97,
      blue: 0.98,
      alpha: 1,
      anchor: "center"
    });
    setText("settings_restart", {
      value: "RESTART",
      fontSize: buttonSize,
      red: 0.91,
      green: 0.97,
      blue: 0.98,
      alpha: 1,
      anchor: "center"
    });
    setText("settings_exit", {
      value: "EXIT GAME",
      fontSize: buttonSize,
      red: 1,
      green: 0.72,
      blue: 0.74,
      alpha: 1,
      anchor: "center"
    });
  }
  function syncResponsiveLayout(viewportWidth, safeArea) {
    const nextLeft = Math.max(-Math.min(DESIGN_WIDTH, viewportWidth) * 0.5, safeArea.left);
    const nextRight = Math.min(Math.min(DESIGN_WIDTH, viewportWidth) * 0.5, safeArea.right);
    const unchanged = Math.abs(resources.playLeft - nextLeft) < 0.5 && Math.abs(resources.playRight - nextRight) < 0.5 && Math.abs(resources.safeArea.top - safeArea.top) < 0.5 && Math.abs(resources.safeArea.bottom - safeArea.bottom) < 0.5;
    if (unchanged) return;
    resources.playLeft = nextLeft;
    resources.playRight = Math.max(nextLeft + 1, nextRight);
    resources.playWidth = resources.playRight - resources.playLeft;
    resources.safeArea = safeArea;
    constrainForegroundToSafeArea();
    applyResponsiveLayout();
    if (resources.settingsOpen) updateGameState("PAUSED");
  }
  function constrainForegroundToSafeArea() {
    for (const [id, transform] of world.transforms) {
      const sprite = world.sprites.get(id);
      if (!sprite) continue;
      transform.x = Math.max(
        resources.playLeft + sprite.width * 0.5,
        Math.min(resources.playRight - sprite.width * 0.5, transform.x)
      );
      transform.y = Math.max(
        resources.safeArea.bottom + sprite.height * 0.5,
        Math.min(resources.safeArea.top - sprite.height * 0.5, transform.y)
      );
    }
  }
  function setSettingsOpen(open) {
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
  function pointerInside(pointer, centerX, centerY, width, height) {
    return Math.abs(pointer.x - centerX) <= width * 0.5 && Math.abs(pointer.y - centerY) <= height * 0.5;
  }
  function handleSettingsInput(pointer) {
    const layout = responsiveLayout();
    const togglePressed = keyJustPressed("Escape") || pointer.justPressed && pointerInside(pointer, layout.iconX, layout.iconY, layout.iconSize, layout.iconSize);
    if (togglePressed) {
      setSettingsOpen(!resources.settingsOpen);
      return true;
    }
    if (!resources.settingsOpen) return false;
    if (!pointer.justPressed) return true;
    if (pointerInside(
      pointer,
      layout.menuCenterX,
      layout.restartY,
      layout.buttonWidth,
      layout.buttonHeight
    )) {
      resetGame(true, pointer.viewportWidth, resources.safeArea);
    } else if (pointerInside(
      pointer,
      layout.menuCenterX,
      layout.exitY,
      layout.buttonWidth,
      layout.buttonHeight
    )) {
      requestExit();
    }
    return true;
  }
  var updateSchedule = [
    playerMovementSystem,
    weaponSystem,
    enemySpawnSystem,
    movementSystem,
    boundsSystem,
    collisionSystem
  ];
  function resetGame(started = false, viewportWidth = DESIGN_WIDTH, safeArea = FULL_SAFE_AREA) {
    clearScene();
    world = createWorld();
    resources = createResources();
    resources.started = started;
    resources.safeArea = safeArea;
    resources.playLeft = Math.max(-Math.min(DESIGN_WIDTH, viewportWidth) * 0.5, safeArea.left);
    resources.playRight = Math.max(
      resources.playLeft + 1,
      Math.min(Math.min(DESIGN_WIDTH, viewportWidth) * 0.5, safeArea.right)
    );
    resources.playWidth = resources.playRight - resources.playLeft;
    spawnScene();
    spawnPlayer();
    updateGameState(started ? "DRAG OR ARROWS/WASD - AUTO FIRE" : "CLICK / TOUCH / SPACE TO START");
  }
  var callbacks = globalThis;
  callbacks.on_script_loaded = function() {
    setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
    const safeArea = windowSafeArea();
    resetGame(false, safeArea.width, safeArea);
  };
  callbacks.on_script_reloaded = function() {
    setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
    const safeArea = windowSafeArea();
    resetGame(false, safeArea.width, safeArea);
  };
  callbacks.on_update = function(dt) {
    const pointer = primaryPointer();
    const safeArea = windowSafeArea();
    syncResponsiveLayout(pointer.viewportWidth, safeArea);
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
    const inputX = Number(keyPressed("ArrowRight") || keyPressed("KeyD")) - Number(keyPressed("ArrowLeft") || keyPressed("KeyA"));
    const inputY = Number(keyPressed("ArrowUp") || keyPressed("KeyW")) - Number(keyPressed("ArrowDown") || keyPressed("KeyS"));
    const pointerInPlayfield = pointer.x >= resources.playLeft && pointer.x <= resources.playRight && pointer.y >= resources.safeArea.bottom && pointer.y <= resources.safeArea.top;
    const restartPressed = keyPressed("Space") || pointer.justPressed && pointerInPlayfield;
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
      if (restartPressed && !resources.restartWasPressed) {
        resetGame(true, pointer.viewportWidth, resources.safeArea);
      }
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
})();
