"use strict";
(() => {
  // modules/ember-arena/game/src/rules.ts
  var pillars = [{ x: -3, z: -1 }, { x: 3, z: 1 }, { x: 0, z: 3.5 }];
  var waveEnds = [40, 85, 130];
  var enemySpecs = {
    chaser: { model: "Knight", health: 24, speed: 1.4, radius: 0.4, scale: 0.62 },
    ranger: { model: "Rogue_Hooded", health: 18, speed: 1.1, radius: 0.35, scale: 0.6 },
    charger: { model: "Barbarian", health: 40, speed: 1.7, radius: 0.45, scale: 0.68 },
    boss: { model: "Knight", health: 500, speed: 0.85, radius: 0.9, scale: 1.25 }
  };
  var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  var distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function direction(a, b) {
    const length = distance(a, b);
    return length < 1e-4 ? { x: 0, z: 0 } : { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  }
  function constrain(point, radius, halfWidth2) {
    let x = clamp(point.x, -halfWidth2 + radius, halfWidth2 - radius);
    let z = clamp(point.z, -5.5 + radius, 5.5 - radius);
    for (const pillar of pillars) {
      const delta = direction(pillar, { x, z });
      const length = distance(pillar, { x, z });
      const minimum = radius + 0.8;
      if (length < minimum) {
        x = pillar.x + (length < 1e-4 ? 1 : delta.x) * minimum;
        z = pillar.z + delta.z * minimum;
      }
    }
    return { x: clamp(x, -halfWidth2 + radius, halfWidth2 - radius), z: clamp(z, -5.5 + radius, 5.5 - radius) };
  }
  function segmentHits(start, end, target, radius) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared < 1e-5 ? 0 : clamp(((target.x - start.x) * dx + (target.z - start.z) * dz) / lengthSquared, 0, 1);
    return distance({ x: start.x + dx * t, z: start.z + dz * t }, target) <= radius;
  }
  function waveAt(elapsed2) {
    return waveEnds.filter((end) => elapsed2 >= end).length;
  }

  // modules/ember-arena/game/src/actors.ts
  function actor(id) {
    const reference = scene_actor(id);
    if (!reference) throw new Error(`Actor no longer exists: ${id}`);
    return reference;
  }
  function field(id, key) {
    return actor(id).get(key);
  }
  function change(id, key, value) {
    actor(id).set(key, value);
  }
  function kind(id) {
    return actor(id).get("kind");
  }
  function position(id) {
    const transform = scene_transform(id);
    if (!transform) throw new Error(`Entity no longer exists: ${id}`);
    const translation = transform.get("translation");
    return { x: translation.get("x"), z: translation.get("z") };
  }
  function move(id, point, rotation = 0) {
    const transform = scene_transform(id);
    if (!transform) return;
    const translation = transform.get("translation");
    translation.set("x", point.x);
    translation.set("z", point.z);
    const quaternion = transform.get("rotation");
    quaternion.set("x", 0);
    quaternion.set("y", Math.sin(rotation / 2));
    quaternion.set("z", 0);
    quaternion.set("w", Math.cos(rotation / 2));
  }
  function model(id, name, point, scale = 1, y = 0, rotation = 0) {
    if (!scene_spawn(id, point.x, y, point.z) || !scene_set_model(id, `models/${name}.glb`) || !scene_set_transform_3d(id, point.x, y, point.z, 0, rotation, 0, scale)) {
      throw new Error(`Could not create model: ${id}`);
    }
  }
  function enemy(id, type, point) {
    const spec = enemySpecs[type];
    model(id, spec.model, point, spec.scale);
    if (!scene_actor_set(id, type, spec.health, spec.speed, spec.radius)) throw new Error(`Could not create actor: ${id}`);
    scene_play_animation(id, `models/${spec.model}.glb`, true);
    change(id, "cooldown", 1.5);
  }

  // modules/ember-arena/api/ui.ts
  var buttonCallbacks = /* @__PURE__ */ new Map();
  var defaultTextColor = [1, 1, 1, 1];
  function node(id, style = {}, children = []) {
    return { kind: "node", id, style, children };
  }
  function row(id, style = {}, children = []) {
    return node(id, { ...style, flexDirection: "row" }, children);
  }
  function column(id, style = {}, children = []) {
    return node(id, { ...style, flexDirection: "column" }, children);
  }
  function text(id, value, options = {}) {
    return { kind: "text", id, value, style: options.style, fontSize: options.fontSize ?? 16, color: options.color ?? defaultTextColor };
  }
  function image(id, path, style = {}) {
    return { kind: "image", id, path, style };
  }
  function button(id, label, options = {}) {
    return {
      kind: "button",
      id,
      style: { alignItems: "center", justifyContent: "center", ...options.style },
      onClick: options.onClick,
      children: [text(`${id}__label`, label, { style: options.textStyle, fontSize: options.fontSize, color: options.color })]
    };
  }
  function requireUi(result, operation, id) {
    if (!result) throw new Error(`Runeweave UI ${operation} failed for "${id}"`);
  }
  function mountElement(element, parentId) {
    requireUi(ui_spawn(element.id, parentId, element.kind), "spawn", element.id);
    if (element.style) requireUi(ui_set_style(element.id, JSON.stringify(element.style)), "style", element.id);
    if (element.kind === "text") {
      const [red, green, blue, alpha] = element.color;
      requireUi(ui_set_text(element.id, element.value, element.fontSize, red, green, blue, alpha), "text", element.id);
    } else if (element.kind === "image") {
      requireUi(ui_set_image(element.id, element.path), "image", element.id);
    } else if (element.kind === "button" && element.onClick) {
      buttonCallbacks.set(element.id, element.onClick);
    }
    for (const child of element.children ?? []) mountElement(child, element.id);
  }
  function mountUi(root) {
    ui_clear();
    buttonCallbacks.clear();
    mountElement(root, "");
  }
  function updateUi() {
    for (const [id, callback] of buttonCallbacks) if (ui_button_just_pressed(id)) callback();
  }

  // modules/ember-arena/game/src/ember-arena.ts
  var callbacks = globalThis;
  var ink = [0.025, 0.045, 0.055, 0.97];
  var amber = [1, 0.6, 0.2, 1];
  var muted = [0.55, 0.69, 0.71, 1];
  var teal = [0.17, 0.83, 0.65, 1];
  var phase = "menu";
  var returnPhase = "menu";
  var elapsed = 0;
  var score = 0;
  var wave = 0;
  var level = 1;
  var experience = 0;
  var damage = 16;
  var fireDelay = 0.48;
  var fireTimer = 0;
  var spawnTimer = 0;
  var nextId = 0;
  var bossSpawned = false;
  var halfWidth = 8;
  var uiTimer = 0;
  var viewport = "";
  var lastPointer = { x: 0, y: 0, pressed: false };
  var networkRequests = [];
  var networkStatus = "HTTP: NOT_RUN (use the network check button)";
  var checks = [];
  var uid = (prefix) => `${prefix}_${nextId++}`;
  var health = () => Math.max(0, field("player", "health"));
  var targetExperience = () => 4 + level * 3;
  function action(id, label, callback, primary = false) {
    return button(id, label, {
      onClick: callback,
      fontSize: 16,
      color: primary ? [0.06, 0.08, 0.08, 1] : [0.9, 0.95, 0.95, 1],
      style: {
        width: "100%",
        height: 48,
        borderRadius: 8,
        background: primary ? amber : [0.1, 0.17, 0.19, 1]
      }
    });
  }
  function safeStyle() {
    const safe = window_safe_area();
    const pointer = input_primary_pointer();
    return {
      position: "absolute",
      left: `${safe.leftInset / pointer.viewportWidth * 100}%`,
      top: `${safe.topInset / pointer.viewportHeight * 100}%`,
      width: `${safe.width / pointer.viewportWidth * 100}%`,
      height: `${safe.height / pointer.viewportHeight * 100}%`
    };
  }
  function panel(title, subtitle, content) {
    return column("panel", {
      width: "90%",
      maxWidth: 470,
      padding: 24,
      gap: 12,
      background: ink,
      borderRadius: 16
    }, [
      text("panel_kicker", "RUNEWEAVE / EMBER ARENA", { fontSize: 12, color: amber }),
      text("panel_title", title, { fontSize: 32 }),
      text("panel_subtitle", subtitle, { fontSize: 14, color: muted }),
      ...content
    ]);
  }
  function drawUi() {
    const children = [];
    if (phase === "playing") {
      children.push(column("hud", { width: "100%", padding: 16, gap: 8 }, [
        row("hud_top", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
          column("hud_stats", { gap: 4, flexGrow: 1 }, [
            text("hud_health", `VITALITY  ${Math.ceil(health())}`, { fontSize: 16, color: teal }),
            text("hud_score", `LV ${level}  /  ${score} POINTS`, { fontSize: 12, color: muted })
          ]),
          text("hud_wave", wave < 3 ? `WAVE ${wave + 1} / 3` : "THE WARDEN", { fontSize: 16, color: amber }),
          button("pause", "II", {
            onClick: () => setPhase("paused"),
            fontSize: 20,
            style: { width: 48, height: 44, margin: 4, background: ink, borderRadius: 8 }
          })
        ]),
        node("health_track", { width: "100%", height: 4, background: [0.1, 0.2, 0.2, 0.7] }, [
          node("health_fill", { width: `${clamp(health(), 0, 100)}%`, height: 4, background: teal })
        ]),
        text("hud_info", statusLine(), { fontSize: 12, color: muted })
      ]));
      children.push(text("hint", "WASD / ARROWS OR DRAG  |  AUTO FIRE  |  ESC TO PAUSE", {
        fontSize: 11,
        color: muted,
        style: { position: "absolute", bottom: 12, left: 16, right: 16 }
      }));
    } else if (phase === "menu") {
      children.push(panel("Guard the last ember.", "A tiny survival adventure in one room.\nThree waves. One warden. Make every upgrade count.", [
        row("menu_art", { gap: 12, alignItems: "center" }, [
          image("menu_icon", "sprites/settings-icon.png", { width: 32, height: 32 }),
          text("menu_controls", "Move with WASD, arrows or a drag.\nYour mage fires at the nearest enemy.", { fontSize: 14, color: muted })
        ]),
        action("start", "ENTER THE ARENA", startRun, true),
        action("checks", "RUNTIME CHECKS", openChecks),
        action("exit", "RETURN TO LAUNCHER", () => {
          app_request_exit();
        }),
        text("credits", "Characters by Kay Lousberg / KayKit (CC0)", { fontSize: 11, color: muted })
      ]));
    } else if (phase === "paused") {
      children.push(panel("Take a breath.", "The arena is paused. Your run is safe here.", [
        action("resume", "KEEP GOING", () => setPhase("playing"), true),
        action("checks", "RUNTIME CHECKS", openChecks),
        action("restart", "RESTART RUN", startRun),
        action("home", "MAIN MENU", loadMenu),
        action("exit", "RETURN TO LAUNCHER", () => {
          app_request_exit();
        })
      ]));
    } else if (phase === "upgrade") {
      children.push(panel("A spark of power.", `LEVEL ${level} / Choose one upgrade to continue.`, [
        action("upgrade_power", "EMBER  /  +8 attack damage", () => upgrade("power"), true),
        action("upgrade_haste", "TEMPO  /  16% faster attacks", () => upgrade("haste")),
        action("upgrade_vigor", "VIGOR  /  heal 30, move faster", () => upgrade("vigor"))
      ]));
    } else if (phase === "won" || phase === "lost") {
      children.push(panel(
        phase === "won" ? "The ember endures." : "One more spark?",
        `${score} POINTS / LEVEL ${level} / ${Math.floor(elapsed)} SECONDS`,
        [
          text("result_note", phase === "won" ? "The warden has fallen. The room is yours." : "Keep moving, collect crystals, and watch the red bolts.", { fontSize: 14, color: muted }),
          action("restart", "PLAY AGAIN", startRun, true),
          action("home", "MAIN MENU", loadMenu),
          action("exit", "RETURN TO LAUNCHER", () => {
            app_request_exit();
          })
        ]
      ));
    } else {
      children.push(panel("Runtime checks", "Contract checks run in the live script context.", [
        ...checks.map((line, index) => text(`check_${index}`, line, { fontSize: 12, color: line.startsWith("FAIL") ? [1, 0.3, 0.3, 1] : muted })),
        text("network_status", networkStatus, { fontSize: 12, color: muted }),
        action("network", "CHECK HTTP (PUBLIC ECHO SERVICE)", checkNetwork),
        action("back", "BACK", () => setPhase(returnPhase), true)
      ]));
    }
    mountUi(column("safe_root", {
      ...safeStyle(),
      alignItems: "center",
      justifyContent: phase === "playing" ? "start" : "center"
    }, children));
  }
  function statusLine() {
    const remaining = wave < 3 ? [40, 85, 130][wave] - elapsed : elapsed - 130;
    return `${Math.max(0, Math.ceil(remaining))}s  /  CRYSTALS ${experience}/${targetExperience()}  /  ${scene_actor_ids().length} ACTORS`;
  }
  function publish() {
    game_state_set(score, Math.ceil(health()), phase.toUpperCase());
  }
  function setPhase(next) {
    phase = next;
    lastPointer.pressed = false;
    publish();
    drawUi();
  }
  function room() {
    scene_clear();
    ui_clear();
    scene_set_3d_enabled(true);
    model("ground", "floor", { x: 0, z: 0 }, 1, -0.25);
    for (let x = -8; x <= 8; x += 2) {
      for (let z = -6; z <= 6; z += 2) model(`tile_${x}_${z}`, "tile", { x, z }, 1, -0.08);
      model(`wall_n_${x}`, "wall", { x, z: -6.5 });
      model(`wall_s_${x}`, "wall", { x, z: 6.5 });
    }
    for (const [index, pillar] of pillars.entries()) {
      model(`pillar_${index}`, "pillar", pillar, 1, 0.65);
      model(`beacon_${index}`, "beacon", pillar, 0.6, 1.7);
    }
    model("player", "Mage", { x: 0, z: 0 }, 0.65);
    scene_actor_set("player", "player", 100, 3.7, 0.35);
    scene_play_animation("player", "models/Mage.glb", true);
  }
  function loadMenu() {
    room();
    setPhase("menu");
  }
  function startRun() {
    elapsed = score = wave = experience = fireTimer = spawnTimer = nextId = uiTimer = 0;
    level = 1;
    damage = 16;
    fireDelay = 0.48;
    bossSpawned = false;
    room();
    setPhase("playing");
  }
  function upgrade(choice) {
    if (choice === "power") damage += 8;
    if (choice === "haste") fireDelay = Math.max(0.12, fireDelay * 0.84);
    if (choice === "vigor") {
      change("player", "health", Math.min(100, health() + 30));
      change("player", "speed", Math.min(6, field("player", "speed") + 0.35));
    }
    setPhase("playing");
  }
  function spawnEnemy() {
    const types = wave === 0 ? ["chaser"] : wave === 1 ? ["chaser", "ranger"] : ["chaser", "ranger", "charger"];
    const angle = Math.random() * Math.PI * 2;
    const point = constrain({ x: Math.cos(angle) * (halfWidth - 0.5), z: Math.sin(angle) * 5 }, 0.45, halfWidth);
    enemy(uid("enemy"), types[Math.floor(Math.random() * types.length)], point);
  }
  function projectile(start, target, hostile, power, angleOffset = 0) {
    const id = uid(hostile ? "hostile" : "ember");
    const aim = direction(start, target);
    const angle = Math.atan2(aim.x, aim.z) + angleOffset;
    const speed = hostile ? 4 : 14;
    model(id, hostile ? "hostile" : "ember", start, 1, 0.6, angle);
    scene_actor_set(id, hostile ? "hostile" : "ember", 1, speed, 0.16);
    change(id, "power", power);
    change(id, "velocity_x", Math.sin(angle) * speed);
    change(id, "velocity_z", Math.cos(angle) * speed);
  }
  function pickup(point) {
    const id = uid("crystal");
    model(id, "crystal", point, 1, 0.35);
    scene_actor_set(id, "crystal", 1, 0, 0.2);
  }
  function hurtPlayer(power) {
    if (field("player", "cooldown") > 0) return;
    change("player", "health", Math.max(0, health() - power));
    change("player", "cooldown", 0.65);
    if (health() <= 0) setPhase("lost");
  }
  function playerStep(dt, pointer) {
    const x = Number(input_key_pressed("KeyD") || input_key_pressed("ArrowRight")) - Number(input_key_pressed("KeyA") || input_key_pressed("ArrowLeft"));
    const z = Number(input_key_pressed("KeyS") || input_key_pressed("ArrowDown")) - Number(input_key_pressed("KeyW") || input_key_pressed("ArrowUp"));
    const current = position("player");
    const speed = field("player", "speed");
    const normal = Math.max(1, Math.hypot(x, z));
    let dx = x / normal * speed * dt;
    let dz = z / normal * speed * dt;
    if (pointer.pressed && lastPointer.pressed && pointer.y < window_safe_area().top - 90) {
      dx += (pointer.x - lastPointer.x) * 22 / 800;
      dz -= (pointer.y - lastPointer.y) * 22 / 800 / 0.7474;
    }
    const length = Math.hypot(dx, dz);
    const factor = length > speed * dt * 2 ? speed * dt * 2 / length : 1;
    const next = constrain({ x: current.x + dx * factor, z: current.z + dz * factor }, 0.35, halfWidth);
    move("player", next, length > 1e-3 ? Math.atan2(dx, dz) : Math.PI);
    change("player", "cooldown", Math.max(0, field("player", "cooldown") - dt));
  }
  function enemiesStep(dt, ids) {
    const player = position("player");
    for (const id of ids) {
      if (!scene_actor(id)) continue;
      const type = kind(id);
      if (!(type in enemySpecs)) continue;
      const current = position(id);
      const aim = direction(current, player);
      const age = field(id, "lifetime") + dt;
      change(id, "lifetime", age);
      let speed = field(id, "speed");
      if (type === "ranger" && distance(current, player) < 4) speed = 0;
      if (type === "charger") speed *= Math.sin(age * 2) > 0.5 ? 2.6 : 0.65;
      const next = constrain({ x: current.x + aim.x * speed * dt, z: current.z + aim.z * speed * dt }, field(id, "radius"), halfWidth);
      move(id, next, Math.atan2(aim.x, aim.z));
      const cooldown = field(id, "cooldown") - dt;
      change(id, "cooldown", cooldown);
      if (cooldown <= 0 && (type === "ranger" || type === "boss")) {
        for (const angle of type === "boss" ? [-0.55, -0.28, 0, 0.28, 0.55] : [0]) projectile(next, player, true, 12, angle);
        change(id, "cooldown", type === "boss" ? 2.2 : 2.8);
      }
      if (distance(next, player) < field(id, "radius") + 0.35) hurtPlayer(type === "boss" ? 25 : 15);
      if (phase !== "playing") return;
    }
  }
  function bulletsStep(dt, ids) {
    const targets = ids.filter((id) => scene_actor(id) && kind(id) in enemySpecs);
    for (const id of ids) {
      if (!scene_actor(id)) continue;
      const type = kind(id);
      if (type !== "ember" && type !== "hostile") continue;
      const current = position(id);
      const next = { x: current.x + field(id, "velocity_x") * dt, z: current.z + field(id, "velocity_z") * dt };
      const age = field(id, "lifetime") + dt;
      const obstacle = pillars.some((pillar) => segmentHits(current, next, pillar, 0.85));
      if (age > 4 || Math.abs(next.x) > halfWidth || Math.abs(next.z) > 6 || obstacle) {
        scene_despawn(id);
        continue;
      }
      let hit = false;
      if (type === "hostile") {
        if (segmentHits(current, next, position("player"), 0.51)) {
          hurtPlayer(field(id, "power"));
          hit = true;
        }
      } else {
        for (const target of targets) {
          if (!scene_actor(target) || !segmentHits(current, next, position(target), field(target, "radius") + 0.16)) continue;
          const hp = field(target, "health") - field(id, "power");
          change(target, "health", hp);
          if (hp <= 0) {
            const type2 = kind(target);
            pickup(position(target));
            score += type2 === "boss" ? 500 : 10;
            scene_despawn(target);
            if (type2 === "boss") setPhase("won");
          }
          hit = true;
          break;
        }
      }
      if (hit) scene_despawn(id);
      else {
        move(id, next, Math.atan2(field(id, "velocity_x"), field(id, "velocity_z")));
        change(id, "lifetime", age);
      }
      if (phase !== "playing") return;
    }
  }
  function crystalsStep(dt, ids) {
    const player = position("player");
    for (const id of ids) {
      if (!scene_actor(id) || kind(id) !== "crystal") continue;
      const current = position(id);
      const age = field(id, "lifetime") + dt;
      change(id, "lifetime", age);
      if (distance(current, player) < 1) {
        scene_despawn(id);
        experience++;
        if (experience >= targetExperience()) {
          experience -= targetExperience();
          level++;
          setPhase("upgrade");
          return;
        }
      } else if (age > 20) scene_despawn(id);
      else if (distance(current, player) < 2.5) {
        const aim = direction(current, player);
        move(id, { x: current.x + aim.x * dt * 4, z: current.z + aim.z * dt * 4 }, age);
      }
    }
  }
  function openChecks() {
    returnPhase = phase;
    checks = [];
    const check = (name, run) => {
      try {
        checks.push(`${run() ? "PASS" : "FAIL"}  ${name}`);
      } catch {
        checks.push(`FAIL  ${name}`);
      }
    };
    check("Owned entity + reflected component + query", () => {
      scene_spawn("probe", 0, 0, 0);
      scene_actor_set("probe", "probe", 5, 1, 0.3);
      actor("probe").set("health", 3);
      const reference = scene_transform("probe").get("translation");
      reference.set("x", 2);
      return field("probe", "health") === 3 && position("probe").x === 2 && scene_actor_ids().includes("probe");
    });
    check("Invalid values / missing entities rejected", () => !scene_actor_set("missing", "probe", 1, 1, 1) && !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1) && !scene_set_model("probe", "../forbidden.glb") && !window_set_size(NaN, 100));
    check("2D sprite / text / transform / camera toggle", () => {
      const sprite = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
      const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
      const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
      const camera = scene_set_3d_enabled(false) && scene_set_3d_enabled(true);
      return sprite && label && transformed && camera;
    });
    check("Despawn invalidates lookup", () => scene_despawn("probe") && scene_actor("probe") === null && scene_transform("probe") === null);
    check("UI validation + child cleanup", () => {
      ui_spawn("probe_ui", "", "node");
      ui_spawn("probe_child", "probe_ui", "text");
      ui_spawn("probe_image", "probe_ui", "image");
      const image2 = ui_set_image("probe_image", "sprites/settings-icon.png");
      const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
      return image2 && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
    });
    check("Keyboard / touch / pointer / safe-area reads", () => {
      input_key_pressed("KeyW");
      input_key_just_pressed("KeyW");
      input_key_just_released("KeyW");
      input_primary_touch();
      return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0;
    });
    check("Unknown HTTP request state", () => http_poll(2147483647).state === "unknown");
    checks.push("REQUESTED  GLB models + walking animation (visual check)");
    checks.push("NOT_RUN  Audio / save / native physics: API gaps");
    checks.push("NOT_RUN  Lua gameplay / other platforms / hot reload");
    setPhase("checks");
  }
  function checkNetwork() {
    if (networkRequests.length) return;
    networkStatus = "HTTP: PENDING (GET + POST to httpbin.org)";
    networkRequests = [
      { id: http_get("https://httpbin.org/get"), method: "GET", elapsed: 0 },
      { id: http_post("https://httpbin.org/post", JSON.stringify({ game: "ember-arena", probe: true }), "application/json"), method: "POST", elapsed: 0 }
    ];
    drawUi();
  }
  function pollNetwork(dt) {
    for (const request of [...networkRequests]) {
      request.elapsed += dt;
      const result = http_poll(request.id);
      if (result.state === "pending") continue;
      networkRequests = networkRequests.filter((candidate) => candidate !== request);
      const status = result.state === "complete" ? `${result.status >= 200 && result.status < 300 ? "PASS" : "FAIL"} ${request.method} ${result.status}` : `FAIL ${request.method} ${result.state === "error" ? result.error.slice(0, 90) : "unknown request"}`;
      networkStatus = networkStatus.startsWith("HTTP: PENDING") ? status : `${networkStatus}
${status}`;
      if (phase === "checks") ui_set_text("network_status", networkStatus, 12, ...muted);
    }
  }
  callbacks.on_script_loaded = () => {
    window_set_size(1280, 800);
    networkRequests = [];
    loadMenu();
  };
  callbacks.on_script_reloaded = () => {
    networkRequests = [];
    loadMenu();
  };
  callbacks.on_update = (delta) => {
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.05);
    const pointer = input_primary_pointer();
    const safe = window_safe_area();
    halfWidth = clamp(Math.min(safe.right, -safe.left) / 800 * 22 - 0.4, 2.8, 8);
    const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}`;
    if (viewport !== signature) {
      viewport = signature;
      drawUi();
    }
    const previousPhase = phase;
    updateUi();
    pollNetwork(dt);
    if (phase !== previousPhase) return;
    if (input_key_just_pressed("Escape")) {
      if (phase === "playing") setPhase("paused");
      else if (phase === "paused") setPhase("playing");
      else if (phase === "checks") setPhase(returnPhase);
      return;
    }
    if (phase === "menu" && input_key_just_pressed("Space")) {
      startRun();
      return;
    }
    if (phase !== "playing") return;
    elapsed += dt;
    const nextWave = waveAt(elapsed);
    if (nextWave !== wave) {
      wave = nextWave;
      if (wave < 3) {
        level++;
        setPhase("upgrade");
        return;
      }
    }
    playerStep(dt, pointer);
    lastPointer = { x: pointer.x, y: pointer.y, pressed: pointer.pressed };
    let ids = scene_actor_ids();
    if (wave >= 3 && !bossSpawned) {
      enemy("warden", "boss", { x: 0, z: -4.5 });
      bossSpawned = true;
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0 && ids.filter((id) => kind(id) in enemySpecs).length < (wave >= 3 ? 8 : 22)) {
      spawnEnemy();
      spawnTimer = wave >= 3 ? 3 : [1.35, 1.05, 0.8][wave];
    }
    ids = scene_actor_ids();
    fireTimer -= dt;
    const origin = position("player");
    const nearest = ids.filter((id) => kind(id) in enemySpecs).sort((a, b) => distance(position(a), origin) - distance(position(b), origin))[0];
    if (nearest && fireTimer <= 0) {
      projectile(origin, position(nearest), false, damage);
      fireTimer = fireDelay;
    }
    enemiesStep(dt, ids);
    if (phase !== "playing") return;
    bulletsStep(dt, ids);
    if (phase !== "playing") return;
    crystalsStep(dt, ids);
    if (phase !== "playing") return;
    publish();
    uiTimer += dt;
    if (uiTimer > 0.15) {
      uiTimer = 0;
      ui_set_text("hud_health", `VITALITY  ${Math.ceil(health())}`, 16, ...teal);
      ui_set_text("hud_score", `LV ${level}  /  ${score} POINTS`, 12, ...muted);
      ui_set_text("hud_wave", wave < 3 ? `WAVE ${wave + 1} / 3` : "THE WARDEN", 16, ...amber);
      ui_set_text("hud_info", statusLine(), 12, ...muted);
      ui_set_style("health_fill", JSON.stringify({ width: `${clamp(health(), 0, 100)}%` }));
    }
  };
})();
