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
  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = Math.imul(value, 1664525) + 1013904223 >>> 0;
      return value / 4294967296;
    };
  }
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
  var heroClasses = {
    warrior: {
      id: "warrior",
      name: "WARRIOR",
      title: "Vanguard of the Sewers",
      model: "Knight",
      description: "Equipped with iron mail and a tempered blade. Sturdy and resilient in direct melee.",
      baseHealth: 100,
      baseSpeed: 3.7,
      baseDamage: 18,
      fireDelay: 0.48,
      perks: "+1 Potion of Healing, higher base strike power"
    },
    mage: {
      id: "mage",
      name: "MAGE",
      title: "Scholar of Arcana",
      model: "Mage",
      description: "Channels magic missile bolts from an ancient staff. Rapid ranged firepower.",
      baseHealth: 100,
      baseSpeed: 3.7,
      baseDamage: 16,
      fireDelay: 0.4,
      perks: "+1 Scroll of Upgrade, 16% faster wand casting"
    },
    rogue: {
      id: "rogue",
      name: "ROGUE",
      title: "Shadow Stalker",
      model: "Rogue_Hooded",
      description: "Shrouded in a cloak of shadows. Swift movement and deadly surprise attacks.",
      baseHealth: 100,
      baseSpeed: 4.1,
      baseDamage: 15,
      fireDelay: 0.46,
      perks: "+1 Potion of Invisibility, +10% move speed"
    },
    huntress: {
      id: "huntress",
      name: "HUNTRESS",
      title: "Seeker of the Slums",
      model: "Barbarian",
      description: "Armed with a spirit bow and fiery alchemy. Masters area damage.",
      baseHealth: 100,
      baseSpeed: 3.8,
      baseDamage: 19,
      fireDelay: 0.48,
      perks: "+1 Potion of Liquid Flame & Food Ration"
    }
  };
  var heroClassList = ["warrior", "mage", "rogue", "huntress"];
  var dungeonMonsters = {
    chaser: {
      name: "Marsupial Rat",
      depth: 1,
      lore: "Fast, scurrying pest native to the upper sewer conduits.",
      drops: "Dew Drops, Gold Coins, Mystery Meat"
    },
    ranger: {
      name: "Gnoll Scout",
      depth: 2,
      lore: "Wild hyena scout slinging poisoned darts from afar.",
      drops: "Gold, Healing Potions, Darts"
    },
    charger: {
      name: "Sewer Crab",
      depth: 3,
      lore: "Heavy chitin carapace charging with crushing claws.",
      drops: "Armor Plates, Dew Drops, Meat"
    },
    boss: {
      name: "Goo (The Warden)",
      depth: 5,
      lore: "The colossal caustic slime ruling the sewer depths. Pumps itself up before explosive blasts!",
      drops: "Amulet of Yendor, 500 Gold"
    }
  };
  var itemCatalog = {
    potion_healing: {
      id: "potion_healing",
      name: "Potion of Healing",
      category: "potion",
      description: "Restores 45 Vitality and cures caustic ooze.",
      effectText: "A warm soothing energy flows through you (+45 HP)."
    },
    potion_liquid_flame: {
      id: "potion_liquid_flame",
      name: "Liquid Flame",
      category: "potion",
      description: "Hurls volatile fire that deals 35 damage to surrounding foes.",
      effectText: "The flask shatters into a roaring blaze (35 damage)! "
    },
    potion_invisibility: {
      id: "potion_invisibility",
      name: "Potion of Invisibility",
      category: "potion",
      description: "Cloaks hero in shadows for 6s. Grants guaranteed surprise attacks.",
      effectText: "You vanish from enemy sight. Surprise attacks ready!"
    },
    potion_strength: {
      id: "potion_strength",
      name: "Potion of Strength",
      category: "potion",
      description: "Permanently enhances hero strike power by +4.",
      effectText: "Your muscles surge with power (+4 Base Damage)!"
    },
    scroll_upgrade: {
      id: "scroll_upgrade",
      name: "Scroll of Upgrade",
      category: "scroll",
      description: "Upgrades equipped gear (+8 Damage, +20 Max Vitality).",
      effectText: "Ancient runes infuse your weaponry (+8 DMG, +20 HP)!"
    },
    scroll_magic_mapping: {
      id: "scroll_magic_mapping",
      name: "Magic Mapping",
      category: "scroll",
      description: "Reveals the sewer currents and draws all crystals to you.",
      effectText: "The dungeon layout clears in your mind! Crystals magnetic!"
    },
    food_ration: {
      id: "food_ration",
      name: "Food Ration",
      category: "food",
      description: "Wholesome subterranean bread. Resets hunger and restores 15 HP.",
      effectText: "You feast on the ration. Hunger fully satisfied (+15 HP)!"
    }
  };
  function getHungerStatus(hungerTime) {
    if (hungerTime < 60) return "satiated";
    if (hungerTime < 120) return "hungry";
    return "starving";
  }
  function isSurpriseStrike(heroPos, targetPos, isInvisible, obstaclePillars = pillars) {
    if (isInvisible) return true;
    for (const pillar of obstaclePillars) {
      if (distance(heroPos, pillar) < 1.4 && distance(targetPos, pillar) > 1.3) {
        return true;
      }
    }
    return false;
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

  // modules/ember-arena/game/src/profile.ts
  function defaultProfile() {
    return {
      schemaVersion: 1,
      bestScore: 0,
      runs: 0,
      wins: 0,
      bestTime: 0,
      seed: 1337,
      sensitivity: 1,
      showHints: true,
      reducedMotion: false
    };
  }
  function parseProfile(raw) {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid profile");
    const data = value;
    if (data.schemaVersion !== 1) throw new Error("unsupported save version");
    for (const key of ["bestScore", "runs", "wins", "seed"]) {
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error(`invalid ${key}`);
    }
    if (data.wins > data.runs || data.seed > 4294967295 || typeof data.bestTime !== "number" || !Number.isFinite(data.bestTime) || data.bestTime < 0 || ![0.75, 1, 1.25, 1.5].includes(data.sensitivity) || typeof data.showHints !== "boolean" || typeof data.reducedMotion !== "boolean") throw new Error("invalid settings");
    return {
      schemaVersion: 1,
      bestScore: data.bestScore,
      runs: data.runs,
      wins: data.wins,
      bestTime: data.bestTime,
      seed: data.seed,
      sensitivity: data.sensitivity,
      showHints: data.showHints,
      reducedMotion: data.reducedMotion
    };
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
  var crimson = [0.95, 0.25, 0.2, 1];
  var phase = "menu";
  var returnPhase = "menu";
  var selectedClass = "warrior";
  var elapsed = 0;
  var score = 0;
  var wave = 0;
  var level = 1;
  var experience = 0;
  var damage = 18;
  var maxHealth = 100;
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
  var profile = defaultProfile();
  var saveNotice = "";
  var saveBlocked = false;
  var resetPending = false;
  var settingsReturn = "menu";
  var runRecorded = false;
  var random = seededRandom(profile.seed);
  var hurtTimer = 0;
  var lastDamage = 0;
  var checkPage = 0;
  var gold = 0;
  var hungerTimer = 0;
  var invisTimer = 0;
  var causticOozeTimer = 0;
  var surpriseNoticeTimer = 0;
  var dungeonLogs = [];
  var inventory = {
    potion_healing: 1,
    potion_liquid_flame: 1,
    potion_invisibility: 1,
    potion_strength: 0,
    scroll_upgrade: 1,
    scroll_magic_mapping: 0,
    food_ration: 1
  };
  var compactUi = () => window_metrics().height > 0 && window_metrics().height < 650;
  var uid = (prefix) => `${prefix}_${nextId++}`;
  var health = () => Math.max(0, field("player", "health"));
  var targetExperience = () => 4 + level * 3;
  function pushLog(entry) {
    dungeonLogs.unshift(entry);
    if (dungeonLogs.length > 3) dungeonLogs.pop();
  }
  function loadProfile() {
    saveBlocked = false;
    saveNotice = "";
    profile = defaultProfile();
    const result = storage_read("profile");
    if (result.state === "error") {
      saveNotice = `Save unavailable (${result.error}). Playing in this session is safe.`;
      saveBlocked = result.error === "invalid_data" || result.error === "too_large";
    } else if (result.state === "ok") {
      try {
        profile = parseProfile(result.value);
      } catch {
        saveBlocked = true;
        saveNotice = "Existing save is incompatible. It will not be overwritten.";
      }
    }
  }
  function persistProfile() {
    if (saveBlocked) return;
    const result = storage_write("profile", JSON.stringify(profile));
    saveNotice = result.state === "ok" ? "Progress and settings saved." : `Save failed (${result.error}). You can retry in settings.`;
  }
  function openSettings() {
    settingsReturn = phase;
    resetPending = false;
    setPhase("settings");
  }
  function resetProfile() {
    const result = storage_remove("profile");
    if (result.state === "error") {
      saveNotice = `Reset failed (${result.error}). Existing save retained.`;
    } else {
      profile = defaultProfile();
      saveBlocked = false;
      saveNotice = "Saved progress reset. Your current run is unchanged.";
    }
    resetPending = false;
    drawUi();
  }
  function action(id, label, callback, primary = false) {
    return button(id, label, {
      onClick: callback,
      fontSize: compactUi() ? 12 : 16,
      color: primary ? [0.06, 0.08, 0.08, 1] : [0.9, 0.95, 0.95, 1],
      style: {
        width: "100%",
        height: compactUi() ? 36 : 48,
        borderRadius: 8,
        background: primary ? amber : [0.1, 0.17, 0.19, 1]
      }
    });
  }
  function itemAction(kindKey) {
    const def = itemCatalog[kindKey];
    const count = inventory[kindKey];
    const disabled = count <= 0;
    return row(`item_row_${kindKey}`, { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
      column(`item_info_${kindKey}`, { flexGrow: 1 }, [
        text(`item_title_${kindKey}`, `${def.name}  x${count}`, { fontSize: 14, color: disabled ? muted : teal }),
        text(`item_desc_${kindKey}`, def.description, { fontSize: 11, color: muted })
      ]),
      button(`use_${kindKey}`, disabled ? "EMPTY" : `USE [${def.id.slice(0, 3).toUpperCase()}]`, {
        onClick: () => {
          useInventoryItem(kindKey);
          drawUi();
        },
        fontSize: 12,
        style: {
          width: 100,
          height: 36,
          borderRadius: 6,
          background: disabled ? [0.08, 0.12, 0.14, 0.6] : amber
        },
        color: disabled ? muted : [0.06, 0.08, 0.08, 1]
      })
    ]);
  }
  function useInventoryItem(kindKey) {
    if (inventory[kindKey] <= 0) return false;
    inventory[kindKey]--;
    const def = itemCatalog[kindKey];
    if (kindKey === "potion_healing") {
      change("player", "health", Math.min(maxHealth, health() + 45));
      causticOozeTimer = 0;
      pushLog(def.effectText);
    } else if (kindKey === "potion_liquid_flame") {
      const heroPos = position("player");
      for (const id of scene_actor_ids()) {
        if (!scene_actor(id) || !(kind(id) in enemySpecs)) continue;
        const targetPos = position(id);
        if (distance(heroPos, targetPos) <= 4.2) {
          impact(targetPos);
          change(id, "health", field(id, "health") - 35);
          if (field(id, "health") <= 0) {
            score += kind(id) === "boss" ? 500 : 10;
            pickup(targetPos);
            scene_despawn(id);
            if (kind(id) === "boss") setPhase("won");
          }
        }
      }
      pushLog(def.effectText);
    } else if (kindKey === "potion_invisibility") {
      invisTimer = 6;
      pushLog(def.effectText);
    } else if (kindKey === "potion_strength") {
      damage += 4;
      pushLog(def.effectText);
    } else if (kindKey === "scroll_upgrade") {
      damage += 8;
      maxHealth += 20;
      change("player", "health", Math.min(maxHealth, health() + 20));
      pushLog(def.effectText);
    } else if (kindKey === "scroll_magic_mapping") {
      const heroPos = position("player");
      for (const id of scene_actor_ids()) {
        if (scene_actor(id) && kind(id) === "crystal") {
          move(id, { x: heroPos.x + (random() - 0.5) * 0.4, z: heroPos.z + (random() - 0.5) * 0.4 });
        }
      }
      pushLog(def.effectText);
    } else if (kindKey === "food_ration") {
      hungerTimer = 0;
      change("player", "health", Math.min(maxHealth, health() + 15));
      pushLog(def.effectText);
    }
    return true;
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
      padding: compactUi() ? 12 : 24,
      gap: compactUi() ? 6 : 12,
      background: ink,
      borderRadius: 16
    }, [
      text("panel_kicker", "SHATTERED PIXEL DUNGEON", { fontSize: 12, color: amber }),
      text("panel_title", title, { fontSize: compactUi() ? 22 : 32 }),
      text("panel_subtitle", subtitle, {
        fontSize: compactUi() ? 11 : 14,
        color: muted,
        style: { display: compactUi() ? "none" : "flex" }
      }),
      ...content
    ]);
  }
  function drawUi() {
    const pointer = input_primary_pointer();
    const safe = window_safe_area();
    const metrics = window_metrics();
    viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
    const children = [];
    if (phase === "playing") {
      const hunger = getHungerStatus(hungerTimer);
      const hungerColor = hunger === "satiated" ? teal : hunger === "hungry" ? amber : crimson;
      children.push(column("hud", { width: "100%", padding: 16, gap: 6 }, [
        row("hud_top", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
          column("hud_stats", { gap: 2, flexGrow: 1 }, [
            text("hud_health", `VITALITY  ${Math.ceil(health())}`, { fontSize: 16, color: teal }),
            text("hud_score", `LV ${level} / ${score} PTS / ${gold} G`, { fontSize: 12, color: muted })
          ]),
          column("hud_center", { alignItems: "center", gap: 2 }, [
            text("hud_wave", wave < 3 ? `SEWERS: DEPTH ${wave + 1}` : "DEPTH 5: GOO'S LAIR", { fontSize: 15, color: amber }),
            text("hud_hunger", hunger.toUpperCase(), { fontSize: 11, color: hungerColor })
          ]),
          row("hud_controls", { gap: 4 }, [
            button("bag_btn", "BAG [I]", {
              onClick: () => setPhase("inventory"),
              fontSize: 12,
              style: { width: 56, height: 40, background: [0.12, 0.22, 0.24, 1], borderRadius: 6 }
            }),
            button("pause", "II", {
              onClick: () => setPhase("paused"),
              fontSize: 18,
              style: { width: 44, height: 40, background: ink, borderRadius: 6 }
            })
          ])
        ]),
        node("health_track", { width: "100%", height: 4, background: [0.1, 0.2, 0.2, 0.7] }, [
          node("health_fill", { width: `${clamp(health() / maxHealth * 100, 0, 100)}%`, height: 4, background: teal })
        ]),
        text("hud_info", statusLine(), { fontSize: 12, color: muted }),
        column("boss_panel", { width: "100%", gap: 4, display: scene_actor("warden") ? "flex" : "none" }, [
          row("boss_title_row", { gap: 8, alignItems: "center" }, [
            image("boss_icon", "sprites/spd/goo.png", { width: 20, height: 20 }),
            text("boss_label", "GOO (THE WARDEN)", { fontSize: 14, color: amber })
          ]),
          node("boss_track", { width: "100%", height: 5, background: ink }, [
            node("boss_fill", { width: "100%", height: 5, background: crimson })
          ])
        ]),
        text("combat_notice", "", { fontSize: 15, color: amber }),
        column("hud_logs", { width: "100%", gap: 2, padding: 4 }, [
          ...dungeonLogs.map(
            (entry, idx) => text(`log_line_${idx}`, entry, { fontSize: 11, color: idx === 0 ? teal : muted })
          )
        ])
      ]));
      children.push(text("hint", "WASD/DRAG MOVE | I: BAG | SPACE: REST | 1-7: QUICK ITEMS | ESC: PAUSE", {
        fontSize: 11,
        color: muted,
        style: { position: "absolute", bottom: 12, left: 16, right: 16, display: profile.showHints ? "flex" : "none" }
      }));
    } else if (phase === "inventory") {
      children.push(panel("Hero's Backpack", `SEWERS / GOLD ${gold} / HUNGER: ${getHungerStatus(hungerTimer).toUpperCase()}`, [
        row("bag_header", { gap: 10, alignItems: "center" }, [
          image("bag_icon", "sprites/spd/items.png", { width: 32, height: 32 }),
          text("bag_title", "SEWER SATCHEL & ALCHEMY", { fontSize: 14, color: amber })
        ]),
        itemAction("potion_healing"),
        itemAction("potion_liquid_flame"),
        itemAction("potion_invisibility"),
        itemAction("potion_strength"),
        itemAction("scroll_upgrade"),
        itemAction("scroll_magic_mapping"),
        itemAction("food_ration"),
        action("close_bag", "CLOSE BACKPACK [ESC / I]", () => setPhase("playing"), true)
      ]));
    } else if (phase === "menu") {
      const heroSpec = heroClasses[selectedClass];
      children.push(panel("Descent into the Sewers", "Recreation of Shattered Pixel Dungeon.\nFight through 5 sewer depths, defeat Goo, and claim the Amulet.", [
        row("menu_art", { gap: 12, alignItems: "center" }, [
          image("menu_icon", "sprites/spd/amulet.png", { width: 32, height: 32 }),
          text("menu_controls", "Defeat sewer vermin, find potions & scrolls.\nDefeat Goo on Depth 5 to claim the Amulet.", { fontSize: 13, color: muted })
        ]),
        row("hero_select_row", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
          column("hero_desc_col", { flexGrow: 1, gap: 2 }, [
            text("hero_class_label", `CLASS: ${heroSpec.name}`, { fontSize: 16, color: amber }),
            text("hero_title_label", heroSpec.title, { fontSize: 12, color: teal }),
            text("hero_perks_label", heroSpec.perks, { fontSize: 11, color: muted })
          ]),
          button("hero_class", "CYCLE HERO", {
            onClick: () => {
              const nextIdx = (heroClassList.indexOf(selectedClass) + 1) % heroClassList.length;
              selectedClass = heroClassList[nextIdx];
              room();
              drawUi();
            },
            fontSize: 12,
            style: { width: 110, height: 42, background: [0.15, 0.25, 0.28, 1], borderRadius: 8 }
          })
        ]),
        action("start", "DESCEND INTO THE SEWERS", startRun, true),
        text("saved_stats", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}  /  SEED ${profile.seed}`, { fontSize: 12, color: teal }),
        action("settings", "SETTINGS & PROGRESS", openSettings),
        action("checks", "RUNTIME CHECKS", openChecks),
        action("exit", "RETURN TO LAUNCHER", () => {
          app_request_exit();
        }),
        text("credits", "Based on Shattered Pixel Dungeon (00-Evan/Watabou). KayKit 3D Models (CC0).", { fontSize: 11, color: muted })
      ]));
    } else if (phase === "paused") {
      children.push(panel("Sewer Rest Camp", "The subterranean conduits grow quiet. Prepare your next move.", [
        action("resume", "KEEP EXPLORING", () => setPhase("playing"), true),
        action("settings", "SETTINGS & PROGRESS", openSettings),
        action("checks", "RUNTIME CHECKS", openChecks),
        action("restart", "RESTART DESCENT", startRun),
        action("home", "MAIN MENU", loadMenu),
        action("exit", "RETURN TO LAUNCHER", () => {
          app_request_exit();
        })
      ]));
    } else if (phase === "settings") {
      const changeSetting = (changeFn) => {
        changeFn();
        persistProfile();
        drawUi();
      };
      const pair = (id, first, second) => row(id, { width: "100%", justifyContent: "space-between" }, [
        column(`${id}_left`, { width: "49%" }, [first]),
        column(`${id}_right`, { width: "49%" }, [second])
      ]);
      children.push(panel("Make it your arena.", `BEST ${profile.bestScore} / ${profile.wins} WINS / ${profile.runs} FINISHED RUNS`, [
        pair("settings_input", action("sensitivity", `DRAG  /  ${profile.sensitivity.toFixed(2)}x`, () => changeSetting(() => {
          const values = [0.75, 1, 1.25, 1.5];
          profile.sensitivity = values[(values.indexOf(profile.sensitivity) + 1) % values.length];
        })), action("hints", `HINTS  /  ${profile.showHints ? "ON" : "OFF"}`, () => changeSetting(() => {
          profile.showHints = !profile.showHints;
        }))),
        pair(
          "settings_effects",
          action("motion", `REDUCED FX  /  ${profile.reducedMotion ? "ON" : "OFF"}`, () => changeSetting(() => {
            profile.reducedMotion = !profile.reducedMotion;
          })),
          action("seed", `SEED  /  ${profile.seed}`, () => changeSetting(() => {
            profile.seed = profile.seed + 1 >>> 0;
          }))
        ),
        text("save_notice", saveNotice || "Your settings and finished-run records are saved locally.", { fontSize: 12, color: muted }),
        ...resetPending ? [
          text("reset_warning", "Clear this game's saved records and settings?", { fontSize: 13, color: amber }),
          pair(
            "reset_actions",
            action("confirm_reset", "CONFIRM RESET", resetProfile),
            action("cancel_reset", "KEEP MY DATA", () => {
              resetPending = false;
              drawUi();
            })
          )
        ] : [
          pair(
            "save_actions",
            action("retry_save", "RETRY SAVE", () => {
              persistProfile();
              drawUi();
            }),
            action("reset_save", "RESET SAVED PROGRESS", () => {
              resetPending = true;
              drawUi();
            })
          )
        ],
        action("settings_back", "BACK", () => setPhase(settingsReturn), true)
      ]));
    } else if (phase === "upgrade") {
      children.push(panel("Dungeon Empowerment", `LEVEL ${level} / Harness the dungeon embers to enhance your hero.`, [
        action("upgrade_power", "EMBER  /  +8 strike damage", () => upgrade("power"), true),
        action("upgrade_haste", "TEMPO  /  16% faster attacks", () => upgrade("haste")),
        action("upgrade_vigor", "VIGOR  /  heal 30, move faster", () => upgrade("vigor"))
      ]));
    } else if (phase === "won" || phase === "lost") {
      children.push(panel(
        phase === "won" ? "The Amulet of Yendor is Yours!" : "You Perished in the Sewers.",
        `${score} POINTS / LEVEL ${level} / ${Math.floor(elapsed)} SECONDS`,
        [
          ...phase === "won" ? [
            row("won_art", { gap: 12, alignItems: "center", justifyContent: "center" }, [
              image("victory_amulet", "sprites/spd/amulet.png", { width: 44, height: 44 }),
              text("victory_amulet_label", "AMULET OF YENDOR CLAIMED", { fontSize: 13, color: amber })
            ])
          ] : [],
          text(
            "result_note",
            phase === "won" ? "Goo has dissolved into primordial sludge. You have conquered the Sewers and recovered the Amulet!" : "The treacherous sewers claim another daring adventurer. Try another class and venture forth again!",
            { fontSize: 14, color: muted }
          ),
          text("result_record", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}`, { fontSize: 14, color: teal }),
          text("result_save", saveNotice, { fontSize: 12, color: muted }),
          action("restart", "DESCENT AGAIN", startRun, true),
          action("home", "MAIN MENU", loadMenu),
          action("exit", "RETURN TO LAUNCHER", () => {
            app_request_exit();
          })
        ]
      ));
    } else {
      const pageSize = compactUi() ? 3 : 6;
      const pages = Math.max(1, Math.ceil(checks.length / pageSize));
      checkPage = Math.min(checkPage, pages - 1);
      children.push(panel("Runtime checks", "Contract checks run in the live script context.", [
        ...checks.slice(checkPage * pageSize, (checkPage + 1) * pageSize).map(
          (line, index) => text(`check_${index}`, line, { fontSize: compactUi() ? 11 : 12, color: line.startsWith("FAIL") ? [1, 0.3, 0.3, 1] : muted })
        ),
        action("check_page", `NEXT PAGE  /  ${checkPage + 1} OF ${pages}`, () => {
          checkPage = (checkPage + 1) % pages;
          drawUi();
        }),
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
    const statusEffects = [
      invisTimer > 0 ? `CLOAKED(${invisTimer.toFixed(1)}s)` : "",
      causticOozeTimer > 0 ? `OOZE(${causticOozeTimer.toFixed(1)}s)` : ""
    ].filter(Boolean).join(" ");
    return `${Math.max(0, Math.ceil(remaining))}s  /  CRYSTALS ${experience}/${targetExperience()}  /  ${scene_actor_ids().length} ACTORS${statusEffects ? `  /  ${statusEffects}` : ""}`;
  }
  function publish() {
    game_state_set(score, Math.ceil(health()), phase.toUpperCase());
  }
  function setPhase(next) {
    if ((next === "won" || next === "lost") && !runRecorded) {
      runRecorded = true;
      profile.runs++;
      profile.bestScore = Math.max(profile.bestScore, score);
      if (next === "won") {
        profile.wins++;
        profile.bestTime = profile.bestTime > 0 ? Math.min(profile.bestTime, elapsed) : elapsed;
      }
      persistProfile();
    }
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
    const heroSpec = heroClasses[selectedClass];
    model("player", heroSpec.model, { x: 0, z: 0 }, 0.65);
    scene_actor_set("player", "player", 100, heroSpec.baseSpeed, 0.35);
    scene_play_animation("player", `models/${heroSpec.model}.glb`, true);
  }
  function loadMenu() {
    room();
    setPhase("menu");
  }
  function startRun() {
    elapsed = score = wave = experience = fireTimer = spawnTimer = nextId = uiTimer = 0;
    gold = 0;
    hungerTimer = 0;
    invisTimer = 0;
    causticOozeTimer = 0;
    surpriseNoticeTimer = 0;
    level = 1;
    const heroSpec = heroClasses[selectedClass];
    damage = heroSpec.baseDamage;
    maxHealth = 100;
    fireDelay = heroSpec.fireDelay;
    bossSpawned = false;
    runRecorded = false;
    hurtTimer = 0;
    random = seededRandom(profile.seed);
    inventory = {
      potion_healing: selectedClass === "warrior" ? 2 : 1,
      potion_liquid_flame: selectedClass === "huntress" ? 2 : 1,
      potion_invisibility: selectedClass === "rogue" ? 2 : 1,
      potion_strength: 0,
      scroll_upgrade: selectedClass === "mage" ? 2 : 1,
      scroll_magic_mapping: selectedClass === "mage" ? 1 : 0,
      food_ration: 1
    };
    dungeonLogs = [
      `Welcome to the Sewers, ${heroSpec.name}.`,
      "Descend the 5 depths, defeat Goo, and claim the Amulet."
    ];
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
    const angle = random() * Math.PI * 2;
    const point = constrain({ x: Math.cos(angle) * (halfWidth - 0.5), z: Math.sin(angle) * 5 }, 0.45, halfWidth);
    const pickedType = types[Math.floor(random() * types.length)];
    enemy(uid("enemy"), pickedType, point);
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
  function impact(point) {
    if (profile.reducedMotion) return;
    const id = uid("impact");
    model(id, "ember", point, 1.7, 0.7);
    scene_actor_set(id, "effect", 1, 0, 0.1);
  }
  function effectsStep(dt, ids) {
    for (const id of ids) {
      if (!scene_actor(id) || kind(id) !== "effect") continue;
      const age = field(id, "lifetime") + dt;
      if (age > 0.18) scene_despawn(id);
      else {
        change(id, "lifetime", age);
        const scale = scene_transform(id).get("scale");
        for (const axis of ["x", "y", "z"]) scale.set(axis, Math.max(0.1, 1.7 * (1 - age / 0.18)));
      }
    }
  }
  function hurtPlayer(power) {
    if (field("player", "cooldown") > 0) return;
    change("player", "health", Math.max(0, health() - power));
    change("player", "cooldown", 0.65);
    lastDamage = power;
    hurtTimer = 0.65;
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
      dx += (pointer.x - lastPointer.x) * 22 / 800 * profile.sensitivity;
      dz -= (pointer.y - lastPointer.y) * 22 / 800 / 0.7474 * profile.sensitivity;
    }
    const length = Math.hypot(dx, dz);
    const factor = length > speed * dt * 2 ? speed * dt * 2 / length : 1;
    const next = constrain({ x: current.x + dx * factor, z: current.z + dz * factor }, 0.35, halfWidth);
    move("player", next, length > 1e-3 ? Math.atan2(dx, dz) : Math.PI);
    change("player", "cooldown", Math.max(0, field("player", "cooldown") - dt));
    if (invisTimer > 0) invisTimer = Math.max(0, invisTimer - dt);
    if (surpriseNoticeTimer > 0) surpriseNoticeTimer = Math.max(0, surpriseNoticeTimer - dt);
    hungerTimer += dt;
    if (hungerTimer > 120 && field("player", "cooldown") <= 0) {
      change("player", "health", Math.max(0, health() - dt * 1.5));
      if (health() <= 0) setPhase("lost");
    }
    if (causticOozeTimer > 0) {
      causticOozeTimer = Math.max(0, causticOozeTimer - dt);
      change("player", "health", Math.max(0, health() - dt * 2));
      if (health() <= 0) setPhase("lost");
    }
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
        for (const angle of type === "boss" ? [-0.55, -0.28, 0, 0.28, 0.55] : [0]) {
          projectile(next, player, true, 12, angle);
        }
        change(id, "cooldown", type === "boss" ? 2.2 : 2.8);
      }
      if (distance(next, player) < field(id, "radius") + 0.35) {
        if (type === "boss") causticOozeTimer = 3.5;
        hurtPlayer(type === "boss" ? 25 : 15);
      }
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
          const targetPos = position(target);
          const heroPos = position("player");
          const surprise = isSurpriseStrike(heroPos, targetPos, invisTimer > 0);
          const effectiveDamage = surprise ? Math.round(field(id, "power") * 1.5) : field(id, "power");
          if (surprise) {
            surpriseNoticeTimer = 0.8;
            pushLog(`Surprise attack! 100% Hit on ${dungeonMonsters[kind(target)].name} (-${effectiveDamage})!`);
          }
          const hp = field(target, "health") - effectiveDamage;
          impact(targetPos);
          change(target, "health", hp);
          if (hp <= 0) {
            const targetType = kind(target);
            pickup(targetPos);
            score += targetType === "boss" ? 500 : 10;
            gold += targetType === "boss" ? 100 : Math.floor(random() * 8) + 3;
            const roll = random();
            if (roll < 0.2 && inventory.potion_healing < 5) inventory.potion_healing++;
            else if (roll < 0.35 && inventory.food_ration < 4) inventory.food_ration++;
            else if (roll < 0.45 && inventory.potion_liquid_flame < 4) inventory.potion_liquid_flame++;
            pushLog(`${dungeonMonsters[targetType].name} defeated! (+${targetType === "boss" ? 500 : 10} pts)`);
            scene_despawn(target);
            if (targetType === "boss") setPhase("won");
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
    checkPage = 0;
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
    check(
      "Invalid values / missing entities rejected",
      () => !scene_actor_set("missing", "probe", 1, 1, 1) && !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1) && !scene_set_model("probe", "../forbidden.glb") && !window_set_size(NaN, 100)
    );
    check("2D sprite / text / transform / camera toggle", () => {
      const sprite = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
      const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
      const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
      const camera = scene_set_3d_enabled(false) && scene_set_3d_enabled(true);
      return sprite && label && transformed && camera;
    });
    check("Despawn invalidates lookup", () => scene_despawn("probe") && scene_actor("probe") == null && scene_transform("probe") == null);
    check("UI validation + child cleanup", () => {
      ui_spawn("probe_ui", "", "node");
      ui_spawn("probe_child", "probe_ui", "text");
      ui_spawn("probe_image", "probe_ui", "image");
      const img = ui_set_image("probe_image", "sprites/settings-icon.png");
      const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
      return img && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
    });
    check("Keyboard / touch / pointer / safe-area reads", () => {
      input_key_pressed("KeyW");
      input_key_just_pressed("KeyW");
      input_key_just_released("KeyW");
      input_primary_touch();
      return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0 && window_metrics().width > 0;
    });
    check("Unknown HTTP request state", () => http_poll(2147483647).state === "unknown");
    const storage = storage_read("_acceptance_probe");
    if (storage.state === "error" && storage.error === "unavailable") checks.push("NOT_RUN  Persistent storage (no private data directory)");
    else {
      check("Persistent write / read / remove", () => {
        if (storage.state !== "missing") return false;
        const written = storage_write("_acceptance_probe", "ember-arena-probe");
        const read = storage_read("_acceptance_probe");
        const removed = storage_remove("_acceptance_probe");
        return written.state === "ok" && read.state === "ok" && read.value === "ember-arena-probe" && removed.state === "ok";
      });
    }
    checks.push("REQUESTED  GLB models + walking animation (visual check)");
    checks.push("NOT_RUN  Audio / native physics: API gaps");
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
    loadProfile();
    loadMenu();
  };
  callbacks.on_script_reloaded = () => {
    networkRequests = [];
    loadProfile();
    loadMenu();
  };
  callbacks.on_update = (delta) => {
    const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.05);
    const pointer = input_primary_pointer();
    const safe = window_safe_area();
    halfWidth = clamp(Math.min(safe.right, -safe.left) / 800 * 22 - 0.4, 2.8, 8);
    const metrics = window_metrics();
    const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
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
      else if (phase === "inventory") setPhase("playing");
      else if (phase === "paused") setPhase("playing");
      else if (phase === "checks") setPhase(returnPhase);
      else if (phase === "settings") setPhase(settingsReturn);
      return;
    }
    if (phase === "menu" && input_key_just_pressed("Space")) {
      startRun();
      return;
    }
    if (phase === "playing") {
      if (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB")) {
        setPhase("inventory");
        return;
      }
      if (input_key_just_pressed("Digit1")) useInventoryItem("potion_healing");
      if (input_key_just_pressed("Digit2")) useInventoryItem("potion_liquid_flame");
      if (input_key_just_pressed("Digit3")) useInventoryItem("potion_invisibility");
      if (input_key_just_pressed("Digit4")) useInventoryItem("potion_strength");
      if (input_key_just_pressed("Digit5")) useInventoryItem("scroll_upgrade");
      if (input_key_just_pressed("Digit6")) useInventoryItem("scroll_magic_mapping");
      if (input_key_just_pressed("Digit7")) useInventoryItem("food_ration");
      if (input_key_just_pressed("Space")) {
        change("player", "health", Math.min(maxHealth, health() + 2));
        pushLog("You take a brief rest in the shadows (+2 HP).");
      }
    }
    if (phase !== "playing") return;
    elapsed += dt;
    hurtTimer = Math.max(0, hurtTimer - dt);
    const nextWave = waveAt(elapsed);
    if (nextWave !== wave) {
      wave = nextWave;
      if (wave < 3) {
        level++;
        pushLog(`Descended deeper into Sewer Depth ${wave + 1}!`);
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
      pushLog("ALERT: Goo (The Warden of the Sewers) has emerged!");
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
    effectsStep(dt, ids);
    publish();
    uiTimer += dt;
    if (uiTimer > 0.15) {
      uiTimer = 0;
      const hurtColor = hurtTimer > 0 && !profile.reducedMotion ? amber : teal;
      const [red, green, blue, alpha] = hurtColor;
      ui_set_text("hud_health", `VITALITY  ${Math.ceil(health())}`, 16, red, green, blue, alpha);
      ui_set_text("hud_score", `LV ${level} / ${score} PTS / ${gold} G`, 12, ...muted);
      ui_set_text("hud_wave", wave < 3 ? `SEWERS: DEPTH ${wave + 1}` : "DEPTH 5: GOO'S LAIR", 16, ...amber);
      ui_set_text("hud_info", statusLine(), 12, ...muted);
      ui_set_style("health_fill", JSON.stringify({ width: `${clamp(health() / maxHealth * 100, 0, 100)}%` }));
      const boss = scene_actor("warden");
      ui_set_style("boss_panel", JSON.stringify({ display: boss ? "flex" : "none" }));
      const casting = boss && field("warden", "cooldown") <= 0.6;
      const combatMessage = hurtTimer > 0 ? `HIT -${lastDamage}` : surpriseNoticeTimer > 0 ? "SURPRISE ATTACK! 100% HIT" : casting ? "GOO IS PUMPING UP! RETREAT BEHIND PILLARS!" : "";
      ui_set_text("combat_notice", combatMessage, 16, ...amber);
      if (boss) {
        ui_set_text("boss_label", `GOO (THE WARDEN) ${Math.max(0, Math.ceil(field("warden", "health")))} / ${enemySpecs.boss.health}`, 14, ...amber);
        ui_set_style("boss_fill", JSON.stringify({ width: `${clamp(field("warden", "health") / enemySpecs.boss.health * 100, 0, 100)}%` }));
      }
    }
  };
})();
