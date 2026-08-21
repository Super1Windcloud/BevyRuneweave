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
  function set3dEnabled(enabled) {
    return scene_set_3d_enabled(enabled);
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

  // modules/clash/api/input.ts
  function keyJustPressed(key) {
    return input_key_just_pressed(key);
  }
  function primaryPointer() {
    return input_primary_pointer();
  }

  // modules/clash/api/window.ts
  function setWindowSize(width, height) {
    return window_set_size(width, height);
  }
  function windowSafeArea() {
    return window_safe_area();
  }

  // modules/clash/api/app.ts
  function requestExit() {
    return app_request_exit();
  }

  // modules/clash/game/src/config.ts
  var DESIGN_WIDTH = 450;
  var DESIGN_HEIGHT = 800;
  var DESKTOP_WINDOW_WIDTH = 540;
  var DESKTOP_WINDOW_HEIGHT = 960;
  var sprites = {
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
    homeBackground: { path: "sprites/royale/home-bg.png", width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
    homeReference: { path: "sprites/royale/home-reference.png", width: DESIGN_WIDTH, height: 1003 },
    homePlatform: { path: "sprites/royale/home-platform.png", width: 360, height: 260 },
    homeBattleButton: { path: "sprites/royale/home-battle-button.png", width: 310, height: 92 },
    homeResource: { path: "sprites/royale/home-resource.png", width: 136, height: 46 },
    homeDeck: { path: "sprites/royale/home-deck.png", width: 326, height: 82 },
    homeNav: { path: "sprites/royale/home-nav.png", width: DESIGN_WIDTH, height: 84 }
  };
  var cards = [
    {
      id: "knight",
      name: "KNIGHT",
      cost: 3,
      art: { path: "sprites/royale/knight.png", width: 74, height: 62 },
      unit: { hp: 430, damage: 70, speed: 47, range: 31, attackDelay: 0.95, width: 56, height: 48 }
    },
    {
      id: "archers",
      name: "ARCHERS",
      cost: 3,
      art: { path: "sprites/royale/archers.png", width: 74, height: 58 },
      unit: { hp: 255, damage: 52, speed: 44, range: 92, attackDelay: 1.05, width: 57, height: 45 }
    },
    {
      id: "giant",
      name: "GIANT",
      cost: 5,
      art: { path: "sprites/royale/giant.png", width: 76, height: 58 },
      unit: { hp: 760, damage: 94, speed: 28, range: 35, attackDelay: 1.25, width: 66, height: 50 }
    },
    {
      id: "goblins",
      name: "GOBLINS",
      cost: 2,
      art: { path: "sprites/royale/goblins.png", width: 68, height: 62 },
      unit: { hp: 210, damage: 46, speed: 61, range: 29, attackDelay: 0.72, width: 51, height: 47 }
    }
  ];

  // modules/clash/game/src/layout.ts
  var FALLBACK_SAFE_AREA = {
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
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }
  function createScreenLayout(viewportWidth, safeArea) {
    const contentWidth = Math.min(DESIGN_WIDTH, viewportWidth, safeArea.width);
    const left = Math.max(-contentWidth * 0.5, safeArea.left);
    const right = Math.min(contentWidth * 0.5, safeArea.right);
    const width = Math.max(1, right - left);
    const height = Math.max(1, safeArea.height);
    return {
      viewportWidth,
      safeArea,
      left,
      right,
      top: safeArea.top,
      bottom: safeArea.bottom,
      width,
      height,
      centerX: (left + right) * 0.5,
      centerY: (safeArea.top + safeArea.bottom) * 0.5,
      scale: clamp(Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT), 0.68, 1)
    };
  }
  function layoutKey(layout2) {
    return [
      layout2.viewportWidth,
      layout2.left,
      layout2.right,
      layout2.top,
      layout2.bottom
    ].map((value) => value.toFixed(1)).join(":");
  }

  // modules/clash/game/src/ui.ts
  function spawnSprite(id, sprite, x = 0, y = 0, z = 0) {
    spawnSceneEntity(id, { x, y, z });
    setSprite(id, sprite);
  }
  function spawnText(id, x = 0, y = 0, z = 0) {
    spawnSceneEntity(id, { x, y, z });
  }
  function placeSprite(id, sprite, x, y, z) {
    setTransform(id, { x, y, z });
    setSprite(id, sprite);
  }
  function placeText(id, value, x, y, z, fontSize, color) {
    setTransform(id, { x, y, z });
    setText(id, { value, fontSize, ...color, alpha: 1, anchor: "center" });
  }
  function pointerInside(pointer, centerX, centerY, width, height) {
    return Math.abs(pointer.x - centerX) <= width * 0.5 && Math.abs(pointer.y - centerY) <= height * 0.5;
  }
  var colors = {
    white: { red: 0.96, green: 0.98, blue: 1 },
    muted: { red: 0.66, green: 0.78, blue: 0.87 },
    gold: { red: 1, green: 0.82, blue: 0.22 },
    dark: { red: 0.16, green: 0.11, blue: 0.03 },
    blue: { red: 0.5, green: 0.83, blue: 1 },
    red: { red: 1, green: 0.61, blue: 0.64 }
  };

  // modules/clash/game/src/battle.ts
  var MATCH_DURATION = 180;
  var MAX_ELIXIR = 10;
  var SETTINGS_IDS = ["battle_menu_panel", "battle_menu_title", "battle_menu_restart", "battle_menu_exit"];
  var BattleController = class {
    screen = null;
    units = /* @__PURE__ */ new Map();
    towers = /* @__PURE__ */ new Map();
    selectedCard = 0;
    elixir = 5;
    enemyElixir = 5;
    seconds = MATCH_DURATION;
    enemyTimer = 2.25;
    nextId = 1;
    seed = 92317;
    blueCrowns = 0;
    redCrowns = 0;
    paused = false;
    outcome = null;
    show(layout2) {
      clearScene();
      this.screen = layout2;
      this.units.clear();
      this.towers.clear();
      this.selectedCard = 0;
      this.elixir = 5;
      this.enemyElixir = 5;
      this.seconds = MATCH_DURATION;
      this.enemyTimer = 2.25;
      this.nextId = 1;
      this.blueCrowns = 0;
      this.redCrowns = 0;
      this.paused = false;
      this.outcome = null;
      this.spawnStaticScene();
      this.createTowers();
      this.resize(layout2);
      this.updateHud();
    }
    resize(layout2) {
      this.screen = layout2;
      const battle2 = this.layout();
      placeSprite("battle_arena", {
        path: sprites.arena.path,
        width: Math.max(DESIGN_WIDTH, layout2.viewportWidth),
        height: DESIGN_HEIGHT
      }, 0, 0, -100);
      this.applyTowers(battle2);
      this.applyCards(battle2);
      this.applyHud(battle2);
      if (this.paused) this.applyMenu(layout2);
      if (this.outcome) this.applyResult(layout2);
    }
    update(dt, pointer) {
      const screen = this.screen;
      if (!screen) return "none";
      const battle2 = this.layout();
      if (this.handleMenu(pointer, screen, battle2)) {
        this.updateHud();
        return "none";
      }
      if (this.handleResult(pointer, screen)) {
        this.updateHud();
        return "none";
      }
      if (this.paused || this.outcome) {
        this.updateHud();
        return "none";
      }
      this.handleCards(pointer, battle2);
      const frameTime = Math.min(Math.max(dt, 0), 0.05);
      this.elixir = Math.min(MAX_ELIXIR, this.elixir + 0.72 * frameTime);
      this.enemyElixir = Math.min(MAX_ELIXIR, this.enemyElixir + 0.72 * frameTime);
      this.seconds = Math.max(0, this.seconds - frameTime);
      this.enemyAi(frameTime, battle2);
      this.updateUnits(frameTime);
      this.updateTowers(frameTime);
      this.checkTimeLimit();
      this.updateHud();
      return "none";
    }
    spawnStaticScene() {
      spawnSprite("battle_arena", sprites.arena, 0, 0, -100);
      for (const id of ["battle_enemy", "battle_player", "battle_timer", "battle_score", "battle_elixir_text"]) spawnText(id);
      spawnSprite("battle_settings", sprites.settingsIcon, 0, 0, 60);
      for (let index = 0; index < cards.length; index += 1) {
        spawnSprite(`battle_card_frame_${index}`, sprites.cardFrame);
        spawnSprite(`battle_card_art_${index}`, cards[index].art);
        spawnText(`battle_card_name_${index}`);
        spawnText(`battle_card_cost_${index}`);
      }
      for (let index = 0; index < MAX_ELIXIR; index += 1) spawnSprite(`battle_elixir_${index}`, sprites.elixirEmpty);
    }
    createTowers() {
      const definitions = [
        { id: "red_king", team: "red", kind: "king", maxHp: 2600 },
        { id: "red_left", team: "red", kind: "princess", lane: "left", maxHp: 1600 },
        { id: "red_right", team: "red", kind: "princess", lane: "right", maxHp: 1600 },
        { id: "blue_king", team: "blue", kind: "king", maxHp: 2600 },
        { id: "blue_left", team: "blue", kind: "princess", lane: "left", maxHp: 1600 },
        { id: "blue_right", team: "blue", kind: "princess", lane: "right", maxHp: 1600 }
      ];
      for (const definition of definitions) {
        const tower = { ...definition, x: 0, y: 0, hp: definition.maxHp, attackTimer: 0, alive: true };
        this.towers.set(tower.id, tower);
        spawnSprite(tower.id, tower.team === "blue" ? sprites.towerBlue : sprites.towerRed);
        spawnText(`${tower.id}_hp`);
      }
    }
    layout() {
      const screen = this.screen;
      const scale = clamp(Math.min(screen.width / DESIGN_WIDTH, screen.height / 740), 0.68, 1);
      const fieldLeft = screen.left + 10 * scale;
      const fieldRight = screen.right - 10 * scale;
      const fieldTop = screen.top - 52 * scale;
      const fieldBottom = screen.bottom + 144 * scale;
      const cardWidth = Math.min(82 * scale, (screen.width - 28 * scale) / 4);
      return {
        scale,
        fieldLeft,
        fieldRight,
        fieldTop,
        fieldBottom,
        riverY: fieldBottom + (fieldTop - fieldBottom) * 0.5,
        cardWidth,
        cardHeight: cardWidth * 1.22,
        cardY: screen.bottom + 74 * scale,
        elixirY: screen.bottom + 15 * scale,
        settingsX: screen.right - 28 * scale,
        settingsY: screen.top - 27 * scale
      };
    }
    cardX(index, layout2) {
      const screen = this.screen;
      const gap = 6 * layout2.scale;
      const total = layout2.cardWidth * cards.length + gap * (cards.length - 1);
      return screen.left + (screen.width - total) * 0.5 + layout2.cardWidth * 0.5 + index * (layout2.cardWidth + gap);
    }
    applyTowers(layout2) {
      const laneInset = Math.min(102 * layout2.scale, (layout2.fieldRight - layout2.fieldLeft) * 0.25);
      const positions = {
        red_king: { x: 0, y: layout2.fieldTop - 47 * layout2.scale },
        red_left: { x: layout2.fieldLeft + laneInset, y: layout2.riverY + (layout2.fieldTop - layout2.riverY) * 0.42 },
        red_right: { x: layout2.fieldRight - laneInset, y: layout2.riverY + (layout2.fieldTop - layout2.riverY) * 0.42 },
        blue_king: { x: 0, y: layout2.fieldBottom + 47 * layout2.scale },
        blue_left: { x: layout2.fieldLeft + laneInset, y: layout2.riverY - (layout2.riverY - layout2.fieldBottom) * 0.42 },
        blue_right: { x: layout2.fieldRight - laneInset, y: layout2.riverY - (layout2.riverY - layout2.fieldBottom) * 0.42 }
      };
      for (const tower of this.towers.values()) {
        Object.assign(tower, positions[tower.id]);
        if (!tower.alive) continue;
        const width = (tower.kind === "king" ? 82 : 68) * layout2.scale;
        const height = (tower.kind === "king" ? 90 : 75) * layout2.scale;
        placeSprite(tower.id, {
          path: tower.team === "blue" ? sprites.towerBlue.path : sprites.towerRed.path,
          width,
          height
        }, tower.x, tower.y, 10);
        setTransform(`${tower.id}_hp`, { x: tower.x, y: tower.y + (tower.team === "red" ? -1 : 1) * height * 0.58, z: 14 });
      }
    }
    applyCards(layout2) {
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const x = this.cardX(index, layout2);
        const y = layout2.cardY + (index === this.selectedCard ? 8 * layout2.scale : 0);
        placeSprite(`battle_card_frame_${index}`, {
          path: index === this.selectedCard ? sprites.cardSelected.path : sprites.cardFrame.path,
          width: layout2.cardWidth,
          height: layout2.cardHeight
        }, x, y, 20);
        placeSprite(`battle_card_art_${index}`, {
          path: card.art.path,
          width: layout2.cardWidth * 0.78,
          height: layout2.cardHeight * 0.58
        }, x, y + layout2.cardHeight * 0.1, 21);
        placeText(`battle_card_name_${index}`, card.name, x, y - layout2.cardHeight * 0.33, 22, Math.max(9, 11 * layout2.scale), colors.white);
        placeText(`battle_card_cost_${index}`, String(card.cost), x - layout2.cardWidth * 0.34, y + layout2.cardHeight * 0.35, 23, 16 * layout2.scale, colors.white);
      }
    }
    applyHud(layout2) {
      const screen = this.screen;
      placeSprite("battle_settings", { path: sprites.settingsIcon.path, width: 48 * layout2.scale, height: 48 * layout2.scale }, layout2.settingsX, layout2.settingsY, 60);
      placeText("battle_enemy", "TRAINING BOT", screen.left + 63 * layout2.scale, screen.top - 18 * layout2.scale, 40, 13 * layout2.scale, colors.red);
      placeText("battle_player", "BLUE KING", screen.left + 52 * layout2.scale, layout2.fieldBottom + 20 * layout2.scale, 40, 13 * layout2.scale, colors.blue);
      const cellWidth = Math.min(31 * layout2.scale, (screen.width - 80 * layout2.scale) / 10);
      const gap = 3 * layout2.scale;
      const total = cellWidth * 10 + gap * 9;
      const start = screen.centerX - total * 0.5 + cellWidth * 0.5;
      for (let index = 0; index < MAX_ELIXIR; index += 1) {
        placeSprite(`battle_elixir_${index}`, {
          path: index < Math.floor(this.elixir) ? sprites.elixirFull.path : sprites.elixirEmpty.path,
          width: cellWidth,
          height: 17 * layout2.scale
        }, start + index * (cellWidth + gap), layout2.elixirY, 20);
      }
      placeText("battle_elixir_text", String(Math.floor(this.elixir)), start - cellWidth, layout2.elixirY, 42, 15 * layout2.scale, colors.white);
    }
    updateHud() {
      const layout2 = this.layout();
      const minutes = Math.floor(this.seconds / 60);
      const seconds = Math.max(0, Math.ceil(this.seconds) % 60).toString().padStart(2, "0");
      placeText("battle_timer", `${minutes}:${seconds}`, this.screen.centerX, this.screen.top - 18 * layout2.scale, 40, 18 * layout2.scale, colors.gold);
      placeText("battle_score", `${this.redCrowns} - ${this.blueCrowns}`, this.screen.right - 76 * layout2.scale, this.screen.top - 18 * layout2.scale, 40, 17 * layout2.scale, colors.gold);
      this.applyHud(layout2);
      for (const tower of this.towers.values()) if (tower.alive) placeText(`${tower.id}_hp`, String(Math.max(0, Math.ceil(tower.hp))), tower.x, tower.y + (tower.team === "red" ? -1 : 1) * 46 * layout2.scale, 14, 11 * layout2.scale, colors.white);
      setGameState(this.blueCrowns, 3 - this.redCrowns, this.paused ? "PAUSED" : this.outcome ? "RESULT" : "BATTLE");
    }
    handleCards(pointer, layout2) {
      for (let index = 0; index < cards.length; index += 1) {
        if (keyJustPressed(`Digit${index + 1}`)) {
          this.selectedCard = index;
          this.applyCards(layout2);
          return;
        }
      }
      if (!pointer.justPressed) return;
      for (let index = 0; index < cards.length; index += 1) {
        if (pointerInside(pointer, this.cardX(index, layout2), layout2.cardY, layout2.cardWidth, layout2.cardHeight + 14 * layout2.scale)) {
          this.selectedCard = index;
          this.applyCards(layout2);
          return;
        }
      }
      const card = cards[this.selectedCard];
      if (pointer.x >= layout2.fieldLeft && pointer.x <= layout2.fieldRight && pointer.y >= layout2.fieldBottom + 24 * layout2.scale && pointer.y <= layout2.riverY - 24 * layout2.scale && this.elixir >= card.cost) {
        this.spawnUnit("blue", card, pointer.x, pointer.y, layout2);
        this.elixir -= card.cost;
      }
    }
    spawnUnit(team, card, x, y, layout2) {
      const id = `${team}_${card.id}_${this.nextId++}`;
      const unit = {
        id,
        team,
        lane: x < 0 ? "left" : "right",
        card,
        x: clamp(x, layout2.fieldLeft + 24, layout2.fieldRight - 24),
        y: clamp(y, layout2.fieldBottom + 25, layout2.fieldTop - 25),
        hp: card.unit.hp,
        attackTimer: 0
      };
      this.units.set(id, unit);
      spawnSprite(id, { path: card.art.path, width: card.unit.width * layout2.scale, height: card.unit.height * layout2.scale }, unit.x, unit.y, 7);
      spawnSprite(`${id}_team`, unit.team === "blue" ? sprites.teamBlue : sprites.teamRed, unit.x, unit.y, 6);
    }
    despawnUnit(unit) {
      this.units.delete(unit.id);
      despawnSceneEntity(unit.id);
      despawnSceneEntity(`${unit.id}_team`);
    }
    distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    nearestEnemy(unit, maxDistance) {
      let nearest;
      for (const candidate of this.units.values()) {
        if (candidate.team === unit.team || candidate.hp <= 0 || this.distance(unit, candidate) >= maxDistance) continue;
        nearest = candidate;
        maxDistance = this.distance(unit, candidate);
      }
      return nearest;
    }
    targetTower(unit) {
      const enemy = unit.team === "blue" ? "red" : "blue";
      const lane = this.towers.get(`${enemy}_${unit.lane}`);
      if (lane?.alive) return lane;
      const king = this.towers.get(`${enemy}_king`);
      return king?.alive ? king : void 0;
    }
    move(unit, target, dt) {
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const length = Math.max(1e-3, Math.hypot(dx, dy));
      const step = Math.min(length, unit.card.unit.speed * dt);
      unit.x += dx / length * step;
      unit.y += dy / length * step;
    }
    updateUnits(dt) {
      const scale = this.layout().scale;
      for (const unit of [...this.units.values()]) {
        if (!this.units.has(unit.id)) continue;
        unit.attackTimer = Math.max(0, unit.attackTimer - dt);
        const enemy = this.nearestEnemy(unit, unit.card.unit.range + 34);
        const target = enemy ?? this.targetTower(unit);
        if (!target) continue;
        if (this.distance(unit, target) <= unit.card.unit.range + (enemy ? 10 : 32)) {
          if (unit.attackTimer <= 0) {
            if (enemy) {
              enemy.hp -= unit.card.unit.damage;
              if (enemy.hp <= 0) this.despawnUnit(enemy);
            } else this.damageTower(target, unit.card.unit.damage, unit.team);
            unit.attackTimer = unit.card.unit.attackDelay;
          }
        } else this.move(unit, target, dt);
        if (!this.units.has(unit.id)) continue;
        setTransform(unit.id, { x: unit.x, y: unit.y, z: 7 });
        setTransform(`${unit.id}_team`, { x: unit.x, y: unit.y - unit.card.unit.height * scale * 0.42, z: 6 });
      }
    }
    updateTowers(dt) {
      for (const tower of this.towers.values()) {
        if (!tower.alive) continue;
        tower.attackTimer = Math.max(0, tower.attackTimer - dt);
        let target;
        let range = tower.kind === "king" ? 138 : 152;
        for (const unit of this.units.values()) {
          const distance = this.distance(tower, unit);
          if (unit.team !== tower.team && distance < range) {
            target = unit;
            range = distance;
          }
        }
        if (target && tower.attackTimer <= 0) {
          target.hp -= tower.kind === "king" ? 72 : 58;
          if (target.hp <= 0) this.despawnUnit(target);
          tower.attackTimer = tower.kind === "king" ? 0.82 : 0.95;
        }
      }
    }
    damageTower(tower, amount, team) {
      if (!tower.alive) return;
      tower.hp -= amount;
      if (tower.hp > 0) return;
      tower.alive = false;
      despawnSceneEntity(tower.id);
      despawnSceneEntity(`${tower.id}_hp`);
      if (team === "blue") this.blueCrowns += 1;
      else this.redCrowns += 1;
      if (tower.kind === "king") this.finish(team);
    }
    random() {
      this.seed = this.seed * 48271 % 2147483647;
      return this.seed / 2147483647;
    }
    enemyAi(dt, layout2) {
      this.enemyTimer -= dt;
      if (this.enemyTimer > 0) return;
      const affordable = cards.filter((card2) => card2.cost <= this.enemyElixir);
      if (affordable.length === 0) {
        this.enemyTimer = 0.6;
        return;
      }
      const card = affordable[Math.floor(this.random() * affordable.length)];
      const laneX = this.random() < 0.5 ? layout2.fieldLeft + (layout2.fieldRight - layout2.fieldLeft) * 0.27 : layout2.fieldRight - (layout2.fieldRight - layout2.fieldLeft) * 0.27;
      this.spawnUnit("red", card, laneX, layout2.riverY + 52 * layout2.scale, layout2);
      this.enemyElixir -= card.cost;
      this.enemyTimer = 1.35 + this.random() * 1.35;
    }
    checkTimeLimit() {
      if (this.seconds > 0 || this.outcome) return;
      if (this.blueCrowns !== this.redCrowns) return this.finish(this.blueCrowns > this.redCrowns ? "blue" : "red");
      const blueHp = [...this.towers.values()].filter((tower) => tower.team === "blue" && tower.alive).reduce((sum, tower) => sum + tower.hp, 0);
      const redHp = [...this.towers.values()].filter((tower) => tower.team === "red" && tower.alive).reduce((sum, tower) => sum + tower.hp, 0);
      this.finish(blueHp === redHp ? "draw" : blueHp > redHp ? "blue" : "red");
    }
    handleMenu(pointer, screen, battle2) {
      const toggle = keyJustPressed("Escape") || pointer.justPressed && pointerInside(pointer, battle2.settingsX, battle2.settingsY, 48 * battle2.scale, 48 * battle2.scale);
      if (toggle) {
        this.paused = !this.paused;
        if (this.paused) {
          spawnSprite("battle_menu_panel", sprites.settingsPanel);
          for (const id of ["battle_menu_title", "battle_menu_restart", "battle_menu_exit"]) spawnText(id);
          this.applyMenu(screen);
        } else for (const id of SETTINGS_IDS) despawnSceneEntity(id);
        return true;
      }
      if (!this.paused) return false;
      if (!pointer.justPressed) return true;
      if (pointerInside(pointer, screen.centerX, screen.centerY + 18 * screen.scale, 340 * screen.scale, 70 * screen.scale)) {
        this.show(screen);
      } else if (pointerInside(pointer, screen.centerX, screen.centerY - 82 * screen.scale, 340 * screen.scale, 70 * screen.scale)) requestExit();
      return true;
    }
    applyMenu(screen) {
      placeSprite("battle_menu_panel", { path: sprites.settingsPanel.path, width: 420 * screen.scale, height: 300 * screen.scale }, screen.centerX, screen.centerY, 70);
      placeText("battle_menu_title", "BATTLE MENU", screen.centerX, screen.centerY + 104 * screen.scale, 72, 27 * screen.scale, colors.white);
      placeText("battle_menu_restart", "RESTART", screen.centerX, screen.centerY + 18 * screen.scale, 72, 24 * screen.scale, colors.blue);
      placeText("battle_menu_exit", "EXIT GAME", screen.centerX, screen.centerY - 82 * screen.scale, 72, 24 * screen.scale, colors.red);
    }
    finish(outcome) {
      if (this.outcome) return;
      this.outcome = outcome;
      spawnSprite("battle_result_panel", sprites.settingsPanel);
      for (const id of ["battle_result_title", "battle_result_score", "battle_result_again"]) spawnText(id);
      this.applyResult(this.screen);
    }
    applyResult(screen) {
      const title = this.outcome === "blue" ? "VICTORY" : this.outcome === "red" ? "DEFEAT" : "DRAW";
      placeSprite("battle_result_panel", { path: sprites.settingsPanel.path, width: 420 * screen.scale, height: 300 * screen.scale }, screen.centerX, screen.centerY, 65);
      placeText("battle_result_title", title, screen.centerX, screen.centerY + 94 * screen.scale, 66, 32 * screen.scale, title === "DEFEAT" ? colors.red : colors.gold);
      placeText("battle_result_score", `${this.blueCrowns} CROWNS ${this.redCrowns}`, screen.centerX, screen.centerY + 15 * screen.scale, 66, 21 * screen.scale, colors.white);
      placeText("battle_result_again", "PLAY AGAIN", screen.centerX, screen.centerY - 78 * screen.scale, 66, 24 * screen.scale, colors.blue);
    }
    handleResult(pointer, screen) {
      if (!this.outcome) return false;
      if (pointer.justPressed && pointerInside(pointer, screen.centerX, screen.centerY - 78 * screen.scale, 340 * screen.scale, 70 * screen.scale)) this.show(screen);
      return true;
    }
  };

  // modules/clash/game/src/lobby.ts
  var tabs = ["shop", "cards", "battle", "social", "league"];
  var tabLabels = {
    shop: "SHOP",
    cards: "CARDS",
    battle: "BATTLE",
    social: "CLAN",
    league: "LEAGUE"
  };
  var spriteIds = [
    "lobby_reference",
    "lobby_tab_panel",
    "lobby_tab_item_0",
    "lobby_tab_item_1",
    "lobby_tab_item_2",
    "lobby_tab_item_3"
  ];
  var textIds = [
    "lobby_tab_selection",
    "lobby_tab_title",
    "lobby_tab_subtitle",
    "lobby_tab_item_label_0",
    "lobby_tab_item_label_1",
    "lobby_tab_item_label_2",
    "lobby_tab_item_label_3"
  ];
  var settingsIds = ["lobby_settings_panel", "lobby_settings_title", "lobby_settings_close", "lobby_settings_exit"];
  var tabContentIds = [
    "lobby_tab_panel",
    "lobby_tab_title",
    "lobby_tab_subtitle",
    "lobby_tab_item_0",
    "lobby_tab_item_1",
    "lobby_tab_item_2",
    "lobby_tab_item_3",
    "lobby_tab_item_label_0",
    "lobby_tab_item_label_1",
    "lobby_tab_item_label_2",
    "lobby_tab_item_label_3"
  ];
  var settingsHitArea = {
    centerX: 0.912,
    centerY: 0.141,
    width: 0.12,
    height: 0.065
  };
  var battleHitArea = {
    centerX: 0.505,
    centerY: 0.827,
    width: 0.35,
    height: 0.09
  };
  var navigationTop = 0.924;
  var navigationHitArea = {
    centerX: 0.5,
    centerY: (navigationTop + 1) * 0.5,
    width: 1,
    height: 1 - navigationTop
  };
  function frameX(layout2, normalizedX) {
    return layout2.left + layout2.width * normalizedX;
  }
  function frameY(layout2, normalizedY) {
    return layout2.top - layout2.height * normalizedY;
  }
  function pointerInsideHitArea(pointer, layout2, area) {
    return pointerInside(
      pointer,
      frameX(layout2, area.centerX),
      frameY(layout2, area.centerY),
      layout2.width * area.width,
      layout2.height * area.height
    );
  }
  var LobbyController = class {
    tab = "battle";
    settingsOpen = false;
    layout = null;
    show(layout2) {
      clearScene();
      this.layout = layout2;
      this.tab = "battle";
      this.settingsOpen = false;
      for (const id of spriteIds) spawnSprite(id, sprites.homeResource);
      for (const id of textIds) spawnText(id);
      this.applyLayout(layout2);
      setGameState(0, 3, "LOBBY");
    }
    resize(layout2) {
      this.layout = layout2;
      this.applyLayout(layout2);
      if (this.settingsOpen) this.applySettingsLayout(layout2);
    }
    update(pointer) {
      const layout2 = this.layout;
      if (!layout2) return { type: "none" };
      if (this.settingsOpen) return this.handleSettings(pointer, layout2);
      const tabWidth = layout2.width / tabs.length;
      if (pointer.justPressed && pointerInsideHitArea(pointer, layout2, settingsHitArea)) {
        this.openSettings(layout2);
        return { type: "layout" };
      }
      const battlePressed = pointer.justPressed && pointerInsideHitArea(pointer, layout2, battleHitArea);
      if (this.tab === "battle" && (battlePressed || keyJustPressed("Space") || keyJustPressed("Enter"))) {
        return { type: "start-matchmaking" };
      }
      if (pointer.justPressed && pointerInsideHitArea(pointer, layout2, navigationHitArea)) {
        const index = Math.max(0, Math.min(tabs.length - 1, Math.floor((pointer.x - layout2.left) / tabWidth)));
        this.tab = tabs[index];
        this.applyLayout(layout2);
        setGameState(0, 3, `LOBBY:${this.tab.toUpperCase()}`);
        return { type: "layout" };
      }
      return { type: "none" };
    }
    applyLayout(layout2) {
      placeSprite("lobby_reference", {
        path: sprites.homeReference.path,
        width: layout2.width,
        height: layout2.height
      }, layout2.centerX, layout2.centerY, -100);
      this.applyNavigation(layout2);
      this.applyTabContent(layout2);
    }
    applyNavigation(layout2) {
      if (this.tab === "battle") {
        setTransform("lobby_tab_selection", { x: layout2.right + 1e4, y: 0, z: 0 });
        return;
      }
      const tabWidth = layout2.width / tabs.length;
      const index = tabs.indexOf(this.tab);
      placeText(
        "lobby_tab_selection",
        `[${tabLabels[this.tab]}]`,
        layout2.left + tabWidth * (index + 0.5),
        frameY(layout2, 0.967),
        20,
        12 * layout2.scale,
        colors.gold
      );
    }
    applyTabContent(layout2) {
      const hiddenX = layout2.right + 1e4;
      if (this.tab === "battle") {
        for (const id of tabContentIds) setTransform(id, { x: hiddenX, y: 0, z: 0 });
        return;
      }
      const scale = layout2.scale;
      const panelY = layout2.centerY - 31 * scale;
      placeSprite("lobby_tab_panel", {
        path: sprites.settingsPanel.path,
        width: layout2.width - 24 * scale,
        height: Math.min(450 * scale, layout2.height - 260 * scale)
      }, layout2.centerX, panelY, 6);
      const titles = {
        shop: ["DAILY SHOP", "REFRESH IN 4H"],
        cards: ["BATTLE DECK", "4 / 8 CARDS"],
        social: ["RUNEWEAVE CLAN", "3 MEMBERS ONLINE"],
        league: ["TROPHY ROAD", "0 / 400 TROPHIES"]
      };
      const [title, subtitle] = titles[this.tab];
      placeText("lobby_tab_title", title, layout2.centerX, panelY + 168 * scale, 9, 25 * scale, colors.gold);
      placeText("lobby_tab_subtitle", subtitle, layout2.centerX, panelY + 137 * scale, 9, 12 * scale, colors.muted);
      const itemLabels = this.tab === "shop" ? ["KNIGHT  40", "ARCHERS  40", "GIANT  100", "FREE GIFT"] : this.tab === "cards" ? cards.map((card) => `${card.name}  LV 1`) : this.tab === "social" ? ["BLUE KING", "ARCHER 01", "GIANT 02", "INVITE"] : ["TRAINING", "BRONZE", "SILVER", "GOLD"];
      const itemY = [panelY + 72 * scale, panelY - 22 * scale, panelY - 116 * scale, panelY - 116 * scale];
      const itemX = [layout2.centerX - 94 * scale, layout2.centerX + 94 * scale, layout2.centerX - 94 * scale, layout2.centerX + 94 * scale];
      for (let index = 0; index < 4; index += 1) {
        const art = this.tab === "league" ? index < 2 ? sprites.towerBlue : sprites.towerRed : cards[index].art;
        placeSprite(`lobby_tab_item_${index}`, {
          path: art.path,
          width: 74 * scale,
          height: 68 * scale
        }, itemX[index], itemY[index] + 13 * scale, 9);
        placeText(`lobby_tab_item_label_${index}`, itemLabels[index], itemX[index], itemY[index] - 35 * scale, 10, 11 * scale, colors.white);
      }
    }
    openSettings(layout2) {
      this.settingsOpen = true;
      spawnSprite("lobby_settings_panel", sprites.settingsPanel, layout2.centerX, layout2.centerY, 70);
      spawnText("lobby_settings_title");
      spawnText("lobby_settings_close");
      spawnText("lobby_settings_exit");
      this.applySettingsLayout(layout2);
    }
    closeSettings() {
      this.settingsOpen = false;
      for (const id of settingsIds) despawnSceneEntity(id);
    }
    applySettingsLayout(layout2) {
      const scale = Math.min(layout2.scale, (layout2.height - 24) / 320);
      placeSprite("lobby_settings_panel", { path: sprites.settingsPanel.path, width: 420 * scale, height: 300 * scale }, layout2.centerX, layout2.centerY, 70);
      placeText("lobby_settings_title", "SETTINGS", layout2.centerX, layout2.centerY + 102 * scale, 72, 27 * scale, colors.white);
      placeText("lobby_settings_close", "CLOSE", layout2.centerX, layout2.centerY + 10 * scale, 72, 24 * scale, colors.blue);
      placeText("lobby_settings_exit", "EXIT GAME", layout2.centerX, layout2.centerY - 82 * scale, 72, 24 * scale, colors.red);
    }
    handleSettings(pointer, layout2) {
      if (keyJustPressed("Escape")) {
        this.closeSettings();
        return { type: "layout" };
      }
      if (!pointer.justPressed) return { type: "none" };
      const scale = layout2.scale;
      if (pointerInside(pointer, layout2.centerX, layout2.centerY + 10 * scale, 340 * scale, 70 * scale)) {
        this.closeSettings();
        return { type: "layout" };
      }
      if (pointerInside(pointer, layout2.centerX, layout2.centerY - 82 * scale, 340 * scale, 70 * scale)) {
        requestExit();
        return { type: "exit" };
      }
      return { type: "none" };
    }
  };
  var MatchmakingController = class {
    elapsed = 0;
    layout = null;
    show(layout2) {
      clearScene();
      this.elapsed = 0;
      this.layout = layout2;
      spawnSprite("matchmaking_background", sprites.homeBackground);
      spawnSprite("matchmaking_panel", sprites.settingsPanel);
      spawnText("matchmaking_title");
      spawnText("matchmaking_status");
      spawnText("matchmaking_cancel");
      this.resize(layout2);
      setGameState(0, 3, "MATCHMAKING");
    }
    resize(layout2) {
      this.layout = layout2;
      const scale = layout2.scale;
      placeSprite("matchmaking_background", { path: sprites.homeBackground.path, width: Math.max(DESIGN_WIDTH, layout2.viewportWidth), height: DESIGN_HEIGHT }, 0, 0, -100);
      placeSprite("matchmaking_panel", { path: sprites.settingsPanel.path, width: 420 * scale, height: 300 * scale }, layout2.centerX, layout2.centerY, 10);
      placeText("matchmaking_title", "FINDING OPPONENT", layout2.centerX, layout2.centerY + 78 * scale, 12, 25 * scale, colors.gold);
      placeText("matchmaking_cancel", "CANCEL", layout2.centerX, layout2.centerY - 83 * scale, 12, 20 * scale, colors.blue);
      this.updateStatus();
    }
    update(dt, pointer) {
      const layout2 = this.layout;
      if (!layout2) return "waiting";
      this.elapsed += Math.min(Math.max(dt, 0), 0.05);
      this.updateStatus();
      if (keyJustPressed("Escape") || pointer.justPressed && pointerInside(
        pointer,
        layout2.centerX,
        layout2.centerY - 83 * layout2.scale,
        320 * layout2.scale,
        70 * layout2.scale
      )) return "cancel";
      return this.elapsed >= 1.2 ? "ready" : "waiting";
    }
    updateStatus() {
      const layout2 = this.layout;
      if (!layout2) return;
      const dots = ".".repeat(Math.floor(this.elapsed * 3) % 4);
      placeText("matchmaking_status", `TRAINING BOT${dots}`, layout2.centerX, layout2.centerY, 12, 17 * layout2.scale, colors.white);
    }
  };

  // modules/clash/game/src/clash.ts
  var lobby = new LobbyController();
  var matchmaking = new MatchmakingController();
  var battle = new BattleController();
  var route = "lobby";
  var layout = createScreenLayout(DESKTOP_WINDOW_WIDTH, FALLBACK_SAFE_AREA);
  var currentLayoutKey = "";
  function readLayout() {
    const pointer = primaryPointer();
    return createScreenLayout(pointer.viewportWidth, windowSafeArea());
  }
  function applyLayout(nextLayout) {
    layout = nextLayout;
    currentLayoutKey = layoutKey(nextLayout);
    if (route === "lobby") lobby.resize(nextLayout);
    else if (route === "matchmaking") matchmaking.resize(nextLayout);
    else battle.resize(nextLayout);
  }
  function showLobby() {
    route = "lobby";
    set3dEnabled(false);
    lobby.show(layout);
    currentLayoutKey = layoutKey(layout);
  }
  function showMatchmaking() {
    route = "matchmaking";
    set3dEnabled(false);
    matchmaking.show(layout);
    currentLayoutKey = layoutKey(layout);
  }
  function showBattle() {
    route = "battle";
    set3dEnabled(false);
    battle.show(layout);
    currentLayoutKey = layoutKey(layout);
  }
  function initialize() {
    setWindowSize(DESKTOP_WINDOW_WIDTH, DESKTOP_WINDOW_HEIGHT);
    layout = readLayout();
    showLobby();
  }
  var callbacks = globalThis;
  callbacks.on_script_loaded = initialize;
  callbacks.on_script_reloaded = initialize;
  callbacks.on_update = function(dt) {
    const pointer = primaryPointer();
    const nextLayout = createScreenLayout(pointer.viewportWidth, windowSafeArea());
    if (layoutKey(nextLayout) !== currentLayoutKey) applyLayout(nextLayout);
    if (route === "lobby") {
      const action = lobby.update(pointer);
      if (action.type === "start-matchmaking") showMatchmaking();
      return;
    }
    if (route === "matchmaking") {
      const result = matchmaking.update(dt, pointer);
      if (result === "cancel") showLobby();
      else if (result === "ready") showBattle();
      return;
    }
    battle.update(dt, pointer);
  };
})();
