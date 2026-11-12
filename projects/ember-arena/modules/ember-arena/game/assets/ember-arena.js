"use strict";
(() => {
  // modules/ember-arena/game/src/rules.ts
  var enemySpecs = {
    chaser: { model: "spd_rat", health: 8, speed: 1, radius: 0.4, scale: 0.9 },
    ranger: { model: "spd_gnoll", health: 12, speed: 1, radius: 0.35, scale: 1 },
    charger: { model: "spd_crab", health: 15, speed: 2, radius: 0.45, scale: 1 },
    boss: { model: "spd_goo", health: 100, speed: 1, radius: 0.9, scale: 1.6 }
  };
  var mobCombat = {
    chaser: { attack: 8, defense: 2, minDamage: 1, maxDamage: 4, armor: 1, experience: 1, maxLevel: 5 },
    ranger: { attack: 10, defense: 4, minDamage: 1, maxDamage: 6, armor: 2, experience: 2, maxLevel: 8 },
    charger: { attack: 12, defense: 5, minDamage: 1, maxDamage: 7, armor: 4, experience: 4, maxLevel: 9 },
    boss: { attack: 10, defense: 8, minDamage: 1, maxDamage: 8, armor: 2, experience: 10, maxLevel: 30 }
  };
  var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = Math.imul(value, 1664525) + 1013904223 >>> 0;
      return value / 4294967296;
    };
  }
  var heroClasses = {
    warrior: {
      id: "warrior",
      name: "WARRIOR",
      title: "Vanguard of the Sewers",
      model: "Knight",
      splash: "sprites/spd/avatar_warrior.png",
      sprite: "sprites/spd/warrior.png",
      icon: "sprites/spd/hero_icons.png",
      description: "A sturdy melee fighter. Starts with a stronger blade and an extra healing potion.",
      baseHealth: 20,
      baseSpeed: 1,
      baseDamage: 6,
      perks: "Worn shortsword / cloth armor / extra healing potion"
    },
    mage: {
      id: "mage",
      name: "MAGE",
      title: "Scholar of Arcana",
      model: "Mage",
      splash: "sprites/spd/avatar_mage.png",
      sprite: "sprites/spd/mage.png",
      icon: "sprites/spd/hero_icons.png",
      description: "A scholar carrying an ancient staff. Starts with an extra upgrade and mapping scroll.",
      baseHealth: 20,
      baseSpeed: 1,
      baseDamage: 5,
      perks: "Mage's staff / cloth armor / magic mapping scroll"
    },
    rogue: {
      id: "rogue",
      name: "ROGUE",
      title: "Shadow Stalker",
      model: "Rogue_Hooded",
      splash: "sprites/spd/avatar_rogue.png",
      sprite: "sprites/spd/rogue.png",
      icon: "sprites/spd/hero_icons.png",
      description: "A stealthy fighter. Starts with an extra invisibility potion for surprise attacks.",
      baseHealth: 20,
      baseSpeed: 1,
      baseDamage: 5,
      perks: "Dagger / cloth armor / extra invisibility potion"
    },
    huntress: {
      id: "huntress",
      name: "HUNTRESS",
      title: "Seeker of the Slums",
      model: "Barbarian",
      splash: "sprites/spd/avatar_huntress.png",
      sprite: "sprites/spd/huntress.png",
      icon: "sprites/spd/hero_icons.png",
      description: "A wilderness explorer. Starts with extra food and liquid flame. Bow abilities are pending.",
      baseHealth: 20,
      baseSpeed: 1,
      baseDamage: 5,
      perks: "Gloves / cloth armor / extra food ration"
    }
  };
  var heroClassList = ["warrior", "mage", "rogue", "huntress"];
  var dungeonMonsters = {
    chaser: {
      name: "Marsupial Rat",
      depth: 1,
      lore: "Fast, scurrying pest native to the upper sewer conduits.",
      drops: "Dew Drops, Gold Coins, Mystery Meat",
      sprite: "sprites/spd/rat.png"
    },
    ranger: {
      name: "Gnoll Scout",
      depth: 2,
      lore: "A sewer-dwelling gnoll scout that attacks in melee.",
      drops: "Gold, Healing Potions, Darts",
      sprite: "sprites/spd/gnoll.png"
    },
    charger: {
      name: "Sewer Crab",
      depth: 3,
      lore: "Heavy chitin carapace charging with crushing claws.",
      drops: "Armor Plates, Dew Drops, Meat",
      sprite: "sprites/spd/crab.png"
    },
    boss: {
      name: "Goo",
      depth: 5,
      lore: "The colossal caustic slime ruling the sewer depths. Pumps itself up before explosive blasts!",
      drops: "Skeleton Key (sewer milestone; the Amulet lies much deeper)",
      sprite: "sprites/spd/goo.png"
    }
  };
  var itemCatalog = {
    potion_healing: {
      id: "potion_healing",
      name: "Potion of Healing",
      category: "potion",
      description: "Restores vitality and cures caustic ooze. Costs 1 turn.",
      effectText: "A warm soothing energy flows through you.",
      sprite: "sprites/spd/items.png"
    },
    potion_liquid_flame: {
      id: "potion_liquid_flame",
      name: "Liquid Flame",
      category: "potion",
      description: "Deals 12 damage to nearby visible foes. Costs 1 turn.",
      effectText: "The flask shatters into a roaring blaze!",
      sprite: "sprites/spd/items.png"
    },
    potion_invisibility: {
      id: "potion_invisibility",
      name: "Potion of Invisibility",
      category: "potion",
      description: "Cloaks the hero for 20 turns. Attacking breaks invisibility.",
      effectText: "You vanish from enemy sight. Surprise attacks ready!",
      sprite: "sprites/spd/items.png"
    },
    potion_strength: {
      id: "potion_strength",
      name: "Potion of Strength",
      category: "potion",
      description: "Permanently increases strength by 1. Costs 1 turn.",
      effectText: "Your muscles surge with power (+1 Strength)!",
      sprite: "sprites/spd/items.png"
    },
    scroll_upgrade: {
      id: "scroll_upgrade",
      name: "Scroll of Upgrade",
      category: "scroll",
      description: "Upgrades the equipped weapon by 1. Costs 1 turn.",
      effectText: "Ancient runes infuse your weapon (+1 upgrade)!",
      sprite: "sprites/spd/items.png"
    },
    scroll_magic_mapping: {
      id: "scroll_magic_mapping",
      name: "Magic Mapping",
      category: "scroll",
      description: "Reveals this floor's terrain, without revealing its inhabitants.",
      effectText: "The dungeon layout clears in your mind!",
      sprite: "sprites/spd/items.png"
    },
    food_ration: {
      id: "food_ration",
      name: "Food Ration",
      category: "food",
      description: "Satisfies 300 hunger. Eating takes 3 turns; it does not heal.",
      effectText: "You eat the ration. Your hunger subsides.",
      sprite: "sprites/spd/items.png"
    }
  };
  function getHungerStatus(hungerTime) {
    if (hungerTime < 300) return "satiated";
    if (hungerTime < 450) return "hungry";
    return "starving";
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

  // modules/ember-arena/game/src/dungeon.ts
  var cellKey = (floor2, point) => point.z * floor2.width + point.x;
  var sameCell = (a, b) => a.x === b.x && a.z === b.z;
  var cellDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  function terrainAt(floor2, point) {
    if (point.x < 0 || point.z < 0 || point.x >= floor2.width || point.z >= floor2.height) return "wall";
    return floor2.tiles[cellKey(floor2, point)];
  }
  var passable = (floor2, point) => terrainAt(floor2, point) !== "wall";
  var opaque = (floor2, point) => ["wall", "door"].includes(terrainAt(floor2, point));
  function canStep(floor2, from, to) {
    if (cellDistance(from, to) !== 1 || !passable(floor2, to)) return false;
    return from.x === to.x || from.z === to.z || !opaque(floor2, { x: from.x, z: to.z }) && !opaque(floor2, { x: to.x, z: from.z });
  }
  function generateFloor(seed, depth2) {
    const random2 = seededRandom((seed ^ Math.imul(depth2, 2654435769)) >>> 0);
    const width = 25;
    const floor2 = {
      width,
      height: width,
      depth: depth2,
      tiles: Array(width * width).fill("wall"),
      entrance: { x: 12, z: 12 },
      exit: { x: 4, z: 4 },
      rooms: [],
      explored: /* @__PURE__ */ new Set(),
      visible: /* @__PURE__ */ new Set()
    };
    const bounds = [];
    const set = (point, tile) => {
      floor2.tiles[cellKey(floor2, point)] = tile;
    };
    for (let row2 = 0; row2 < 3; row2++) for (let column2 = 0; column2 < 3; column2++) {
      const center = { x: 4 + column2 * 8, z: 4 + row2 * 8 };
      floor2.rooms.push(center);
      const left = center.x - 2, top = center.z - 2;
      const right = center.x + 1 + Math.floor(random2() * 2), bottom = center.z + 1 + Math.floor(random2() * 2);
      bounds.push({ left, right, top, bottom });
      for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++) {
        set({ x, z }, random2() < 0.1 ? "water" : "floor");
      }
    }
    const visited = /* @__PURE__ */ new Set([4]);
    const connections = [];
    while (visited.size < 9) {
      const edges = [];
      for (const room2 of visited) for (const next of [room2 - 3, room2 + 3, room2 - 1, room2 + 1]) {
        if (next < 0 || next >= 9 || visited.has(next)) continue;
        if (Math.abs(next - room2) === 1 && Math.floor(next / 3) !== Math.floor(room2 / 3)) continue;
        edges.push([room2, next]);
      }
      const edge = edges[Math.floor(random2() * edges.length)];
      connections.push(edge);
      visited.add(edge[1]);
    }
    for (const [a, b] of connections) {
      const start = floor2.rooms[a], end = floor2.rooms[b];
      const dx = Math.sign(end.x - start.x), dz = Math.sign(end.z - start.z);
      for (let point = { ...start }; !sameCell(point, end); point = { x: point.x + dx, z: point.z + dz }) {
        if (terrainAt(floor2, point) === "wall") set(point, "floor");
      }
      for (const index of [a, b]) {
        const room2 = floor2.rooms[index], box = bounds[index];
        const toward = index === a ? end : start;
        const door = room2.x === toward.x ? { x: room2.x, z: toward.z < room2.z ? box.top - 1 : box.bottom + 1 } : { x: toward.x < room2.x ? box.left - 1 : box.right + 1, z: room2.z };
        set(door, "door");
      }
    }
    let longest = -1;
    for (const room2 of floor2.rooms) {
      const path = findPath(floor2, floor2.entrance, room2);
      if (path.length > longest) {
        longest = path.length;
        floor2.exit = { ...room2 };
      }
    }
    set(floor2.entrance, "entrance");
    set(floor2.exit, "exit");
    set({ x: floor2.entrance.x + 1, z: floor2.entrance.z }, "floor");
    return floor2;
  }
  function findPath(floor2, start, end, blocked = /* @__PURE__ */ new Set(), knownOnly = false) {
    if (!passable(floor2, start) || !passable(floor2, end) || sameCell(start, end)) return [];
    const startKey = cellKey(floor2, start), endKey = cellKey(floor2, end);
    const previous = /* @__PURE__ */ new Map([[startKey, -1]]);
    const queue = [startKey];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const key = queue[cursor], point = { x: key % floor2.width, z: Math.floor(key / floor2.width) };
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
        const next = { x: point.x + dx, z: point.z + dz }, nextKey = cellKey(floor2, next);
        if (!canStep(floor2, point, next) || previous.has(nextKey) || blocked.has(nextKey) || knownOnly && !floor2.explored.has(nextKey)) continue;
        previous.set(nextKey, key);
        if (nextKey === endKey) {
          const path = [];
          for (let current = endKey; current !== startKey; current = previous.get(current)) {
            path.unshift({ x: current % floor2.width, z: Math.floor(current / floor2.width) });
          }
          return path;
        }
        queue.push(nextKey);
      }
    }
    return [];
  }
  function lineOfSight(floor2, start, end) {
    let x = start.x, z = start.z;
    const dx = Math.abs(end.x - x), dz = Math.abs(end.z - z), sx = Math.sign(end.x - x), sz = Math.sign(end.z - z);
    let error = dx - dz;
    while (x !== end.x || z !== end.z) {
      const twice = error * 2;
      const previous = { x, z };
      if (twice > -dz) {
        error -= dz;
        x += sx;
      }
      if (twice < dx) {
        error += dx;
        z += sz;
      }
      if (x !== previous.x && z !== previous.z && opaque(floor2, { x, z: previous.z }) && opaque(floor2, { x: previous.x, z })) return false;
      if (x === end.x && z === end.z) return true;
      if (opaque(floor2, { x, z })) return false;
    }
    return true;
  }
  function reveal(floor2, origin, radius = 7) {
    floor2.visible.clear();
    for (let z = Math.max(0, origin.z - radius); z <= Math.min(floor2.height - 1, origin.z + radius); z++) {
      for (let x = Math.max(0, origin.x - radius); x <= Math.min(floor2.width - 1, origin.x + radius); x++) {
        if (Math.hypot(x - origin.x, z - origin.z) > radius || !lineOfSight(floor2, origin, { x, z })) continue;
        const key = cellKey(floor2, { x, z });
        floor2.visible.add(key);
        floor2.explored.add(key);
      }
    }
  }

  // modules/ember-arena/game/src/dungeon-actors.ts
  var cellSize = 22;
  var mobSprites = { chaser: "rat", ranger: "gnoll", charger: "crab", boss: "goo" };
  var frameSizes = {
    warrior: [12, 15],
    mage: [12, 15],
    rogue: [12, 15],
    huntress: [12, 15],
    rat: [16, 15],
    gnoll: [12, 15],
    crab: [16, 16],
    goo: [20, 14]
  };
  function cellPosition(id) {
    const translation = scene_transform(id).get("translation");
    return {
      x: Math.round(translation.get("x") / cellSize + 12),
      z: Math.round(12 - (translation.get("y") + 40) / cellSize)
    };
  }
  function placeCell(id, point, layer = 2) {
    const translation = scene_transform(id).get("translation");
    translation.set("x", (point.x - 12) * cellSize);
    translation.set("y", (12 - point.z) * cellSize - 40);
    translation.set("z", layer);
  }
  function sprite(id, name, point, layer = 0, factor = 1) {
    if (!scene_transform(id) && !scene_spawn(id, 0, 0, layer)) throw new Error(`Could not create sprite ${id}`);
    const [width, height] = frameSizes[name] ?? [16, 16];
    if (!scene_set_sprite(id, `sprites/dungeon/${name}.png`, cellSize * factor * width / 16, cellSize * factor * height / 16)) {
      throw new Error(`Could not set sprite ${id}`);
    }
    placeCell(id, point, layer);
  }
  function actorSprite(id, hero, visible = true) {
    const type = kind(id);
    const name = type === "player" ? hero : mobSprites[type];
    if (!name) return;
    sprite(id, name, cellPosition(id), 2);
    const scale = scene_transform(id).get("scale");
    for (const axis of ["x", "y"]) scale.set(axis, visible ? 1 : 0);
  }
  function resizeGrid(size) {
    if (size === cellSize) return;
    const ratio = size / cellSize;
    for (const id of scene_actor_ids()) {
      if (kind(id) === "effect") {
        scene_despawn(id);
        continue;
      }
      const translation = scene_transform(id).get("translation");
      translation.set("x", translation.get("x") * ratio);
      translation.set("y", (translation.get("y") + 40) * ratio - 40);
    }
    cellSize = size;
  }
  function monsterIds() {
    return scene_actor_ids().filter((id) => kind(id) in mobSprites && field(id, "health") > 0);
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
  var pointerActionHandled = false;
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
    const pointerPressed = input_primary_pointer().pressed;
    if (!pointerPressed) pointerActionHandled = false;
    if (pointerActionHandled) return;
    for (const [id, callback] of [...buttonCallbacks]) {
      if (ui_button_just_pressed(id)) {
        pointerActionHandled = pointerPressed;
        callback();
        break;
      }
    }
  }

  // modules/ember-arena/game/src/ember-arena.ts
  var callbacks = globalThis;
  var ink = [0.055, 0.05, 0.04, 0.97];
  var amber = [1, 0.6, 0.2, 1];
  var muted = [0.55, 0.69, 0.71, 1];
  var teal = [0.17, 0.83, 0.65, 1];
  var crimson = [0.95, 0.25, 0.2, 1];
  var phase = "menu";
  var returnPhase = "menu";
  var selectedClass = "warrior";
  var elapsed = 0;
  var score = 0;
  var level = 1;
  var experience = 0;
  var damage = 6;
  var maxHealth = 20;
  var strength = 10;
  var depth = 1;
  var turns = 0;
  var actionCooldown = 0;
  var floor = null;
  var queuedPath = [];
  var renderedTiles = /* @__PURE__ */ new Map();
  var renderedFog = /* @__PURE__ */ new Set();
  var nextId = 0;
  var viewport = "";
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
  var checkPage = 0;
  var bagPage = 0;
  var gold = 0;
  var hungerTimer = 0;
  var invisTimer = 0;
  var causticOozeTimer = 0;
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
  var targetExperience = () => 5 + level * 5;
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
        borderRadius: 2,
        background: primary ? amber : [0.16, 0.14, 0.11, 1]
      }
    });
  }
  function itemAction(kindKey) {
    const def = itemCatalog[kindKey];
    const count = inventory[kindKey];
    const disabled = count <= 0;
    return row(`item_row_${kindKey}`, { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
      image(`item_ico_${kindKey}`, `sprites/dungeon/${kindKey}.png`, { width: compactUi() ? 20 : 24, height: compactUi() ? 20 : 24 }),
      column(`item_info_${kindKey}`, { flexGrow: 1 }, [
        text(`item_title_${kindKey}`, `${def.name}  x${count}`, { fontSize: compactUi() ? 12 : 14, color: disabled ? muted : teal }),
        text(`item_desc_${kindKey}`, def.description, { fontSize: 11, color: muted, style: { display: compactUi() ? "none" : "flex" } })
      ]),
      button(`use_${kindKey}`, disabled ? "EMPTY" : `USE`, {
        onClick: () => {
          useInventoryItem(kindKey);
          drawUi();
        },
        fontSize: 12,
        style: {
          width: 80,
          height: compactUi() ? 30 : 36,
          borderRadius: 2,
          background: disabled ? [0.08, 0.12, 0.14, 0.6] : amber
        },
        color: disabled ? muted : [0.06, 0.08, 0.08, 1]
      })
    ]);
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
      borderRadius: 2
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
          row("hud_hero_box", { gap: 8, alignItems: "center" }, [
            image("hud_hero_icon", heroClasses[selectedClass].splash, { width: 28, height: 28 }),
            column("hud_stats", { gap: 2, flexGrow: 1 }, [
              text("hud_health", `VITALITY  ${Math.ceil(health())}`, { fontSize: 16, color: teal }),
              text("hud_score", `LV ${level} / ${score} PTS / ${gold} G`, { fontSize: 12, color: muted })
            ])
          ]),
          column("hud_center", { alignItems: "center", gap: 2 }, [
            row("hud_depth_row", { gap: 4, alignItems: "center" }, [
              image("hud_badge_icon", "sprites/spd/badges.png", { width: 16, height: 16 }),
              text("hud_wave", `SEWERS: DEPTH ${depth}`, { fontSize: 15, color: amber })
            ]),
            text("hud_hunger", hunger.toUpperCase(), { fontSize: 11, color: hungerColor })
          ]),
          row("hud_controls", { gap: 4 }, [
            button("bag_btn", "BAG [I]", {
              onClick: () => setPhase("inventory"),
              fontSize: 12,
              style: { width: 56, height: 40, background: [0.12, 0.22, 0.24, 1], borderRadius: 2 }
            }),
            button("pause", "II", {
              onClick: () => setPhase("paused"),
              fontSize: 18,
              style: { width: 44, height: 40, background: ink, borderRadius: 2 }
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
            image("boss_hp_frame", "sprites/spd/boss_hp.png", { width: 16, height: 16 }),
            text("boss_label", `GOO ${scene_actor("warden") ? Math.ceil(field("warden", "health")) : 0} / 100`, { fontSize: 14, color: amber })
          ]),
          node("boss_track", { width: "100%", height: 5, background: ink }, [
            node("boss_fill", { width: `${scene_actor("warden") ? clamp(field("warden", "health"), 0, 100) : 0}%`, height: 5, background: crimson })
          ])
        ]),
        text("combat_notice", "", { fontSize: 15, color: amber }),
        column("hud_logs", { width: "100%", gap: 2, padding: 4 }, [
          ...dungeonLogs.map(
            (entry, idx) => text(`log_line_${idx}`, entry, { fontSize: 11, color: idx === 0 ? teal : muted })
          )
        ])
      ]));
      children.push(row("turn_controls", { position: "absolute", bottom: 36, left: 16, right: 16, gap: 8 }, [
        button("wait", "WAIT [SPACE]", { onClick: () => {
          queuedPath = [];
          spendTurns();
        }, style: { width: "48%", height: 36, background: ink }, fontSize: 12 }),
        button("descend", "DESCEND [E]", { onClick: descend, style: { width: "48%", height: 36, background: ink }, fontSize: 12 })
      ]));
      children.push(text("hint", "WASD/ARROWS: STEP OR ATTACK | CLICK: WALK | SPACE: WAIT | E: DESCEND | I: BAG", {
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
        ...Object.keys(itemCatalog).filter((_, index) => !compactUi() || Math.floor(index / 4) === bagPage).map(itemAction),
        ...compactUi() ? [action("bag_page", `PAGE ${bagPage + 1} / 2 / NEXT`, () => {
          bagPage = (bagPage + 1) % 2;
          drawUi();
        })] : [],
        action("close_bag", "CLOSE BACKPACK [ESC / I]", () => setPhase("playing"), true)
      ]));
    } else if (phase === "menu") {
      const heroSpec = heroClasses[selectedClass];
      children.push(panel("Descent into the Sewers", "Turn-based sewer expedition.\nExplore five depths and defeat Goo to complete this milestone.", [
        image("spd_banner", "sprites/spd/banners.png", { width: compactUi() ? 180 : 220, height: compactUi() ? 34 : 42 }),
        row("menu_art", { gap: 12, alignItems: "center" }, [
          image("menu_icon", "sprites/spd/amulet.png", { width: 32, height: 32 }),
          text("menu_controls", "Explore rooms, open doors and find the stairs.\nThe world waits until you take a turn.", { fontSize: 13, color: muted })
        ]),
        row("hero_select_row", { width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8 }, [
          image("hero_splash", heroSpec.splash, { width: compactUi() ? 46 : 56, height: compactUi() ? 46 : 56, borderRadius: 2 }),
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
            style: { width: 110, height: 42, background: [0.15, 0.25, 0.28, 1], borderRadius: 2 }
          })
        ]),
        action("start", "DESCEND INTO THE SEWERS", startRun, true),
        text("saved_stats", `BEST ${profile.bestScore}  /  WINS ${profile.wins} / ${profile.runs}  /  SEED ${profile.seed}`, { fontSize: 12, color: teal }),
        action("settings", "SETTINGS & PROGRESS", openSettings),
        action("checks", "RUNTIME CHECKS", openChecks),
        action("exit", "RETURN TO LAUNCHER", () => {
          app_request_exit();
        }),
        text("credits", "In progress: Shattered Pixel Dungeon port (00-Evan / Watabou). See asset licenses.", { fontSize: 11, color: muted })
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
      children.push(panel("Dungeon settings", `BEST ${profile.bestScore} / ${profile.wins} WINS / ${profile.runs} FINISHED RUNS`, [
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
    } else if (phase === "won" || phase === "lost") {
      children.push(panel(
        phase === "won" ? "The Sewers Are Cleared!" : "You Perished in the Sewers.",
        `${score} POINTS / LEVEL ${level} / ${turns} TURNS / DEPTH ${depth}`,
        [
          ...phase === "won" ? [
            row("won_art", { gap: 12, alignItems: "center", justifyContent: "center" }, [
              image("victory_banner", "sprites/spd/banners.png", { width: 180, height: 36 }),
              image("victory_key", "sprites/dungeon/skeleton_key.png", { width: 44, height: 44 }),
              text("victory_key_label", "SKELETON KEY FOUND / SEWER MILESTONE", { fontSize: 13, color: amber })
            ])
          ] : [
            row("lost_art", { gap: 8, alignItems: "center", justifyContent: "center" }, [
              image("defeat_badge", "sprites/spd/badges.png", { width: 36, height: 36 }),
              text("defeat_label", "PERISHED IN THE SEWERS", { fontSize: 13, color: crimson })
            ])
          ],
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
    return `TURN ${turns} / STR ${strength} / XP ${experience}/${targetExperience()}${invisTimer > 0 ? ` / INVISIBLE ${invisTimer}` : ""}${causticOozeTimer > 0 ? ` / OOZE ${causticOozeTimer}` : ""}`;
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
    queuedPath = [];
    publish();
    drawUi();
  }
  function room() {
    scene_clear();
    ui_clear();
    scene_set_3d_enabled(false);
    paintBackdrop();
    floor = null;
    renderedTiles.clear();
    renderedFog.clear();
    sprite("player", selectedClass, { x: 12, z: 12 }, 2);
    scene_actor_set("player", "player", heroClasses[selectedClass].baseHealth, 1, 0.35);
  }
  function paintBackdrop() {
    const pointer = input_primary_pointer();
    if (!scene_transform("dungeon_backdrop")) scene_spawn("dungeon_backdrop", 0, 0, -10);
    scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", pointer.viewportWidth, pointer.viewportHeight);
  }
  function loadMenu() {
    room();
    setPhase("menu");
  }
  function startRun() {
    elapsed = score = experience = nextId = gold = hungerTimer = invisTimer = causticOozeTimer = turns = 0;
    level = depth = 1;
    strength = 10;
    damage = heroClasses[selectedClass].baseDamage;
    maxHealth = heroClasses[selectedClass].baseHealth;
    runRecorded = false;
    bagPage = 0;
    actionCooldown = 0;
    queuedPath = [];
    random = seededRandom(profile.seed);
    inventory = {
      potion_healing: selectedClass === "warrior" ? 2 : 1,
      potion_liquid_flame: selectedClass === "huntress" ? 2 : 1,
      potion_invisibility: selectedClass === "rogue" ? 2 : 1,
      potion_strength: 0,
      scroll_upgrade: selectedClass === "mage" ? 2 : 1,
      scroll_magic_mapping: selectedClass === "mage" ? 1 : 0,
      food_ration: selectedClass === "huntress" ? 2 : 1
    };
    dungeonLogs = [`Welcome to the sewers, ${heroClasses[selectedClass].name}.`, "Move one tile at a time. Find the stairs to descend."];
    room();
    enterFloor();
    setPhase("playing");
  }
  function enterFloor() {
    for (const id of scene_actor_ids()) if (id !== "player") scene_despawn(id);
    for (const key of renderedTiles.keys()) scene_despawn(`terrain_${key}`);
    for (const key of renderedFog) scene_despawn(`fog_${key}`);
    renderedTiles.clear();
    renderedFog.clear();
    queuedPath = [];
    floor = generateFloor(profile.seed, depth);
    placeCell("player", floor.entrance);
    const rooms = floor.rooms.filter((point) => !sameCell(point, floor.entrance));
    if (depth === 5) spawnMonster("warden", "boss", floor.exit);
    else for (let index = 0; index < rooms.length; index++) {
      const type = depth < 2 ? "chaser" : depth < 3 ? index % 2 ? "ranger" : "chaser" : ["chaser", "ranger", "charger"][index % 3];
      spawnMonster(uid("enemy"), type, rooms[index]);
    }
    for (const [index, item] of ["food_ration", "potion_healing", "scroll_upgrade", "potion_strength", "scroll_magic_mapping"].entries()) {
      const room2 = rooms[index];
      spawnLoot({ x: room2.x + 1, z: room2.z }, item);
    }
    refreshDungeon();
  }
  function spawnMonster(id, type, point) {
    const spec = enemySpecs[type];
    sprite(id, mobSprites[type], point, 2, type === "boss" ? 1.4 : 1);
    scene_actor_set(id, type, spec.health, spec.speed, spec.radius);
    change(id, "lifetime", 0);
    change(id, "cooldown", 0);
    change(id, "power", 0);
  }
  function spawnLoot(point, item) {
    const id = uid("loot");
    sprite(id, item ?? "gold", point, 1, 0.7);
    scene_actor_set(id, "loot", 1, 0, 0.2);
    change(id, "power", item ? Object.keys(itemCatalog).indexOf(item) + 1 : 0);
  }
  function refreshDungeon() {
    paintBackdrop();
    if (!floor) return;
    reveal(floor, cellPosition("player"));
    const safe = window_safe_area();
    const size = Math.max(6, Math.min(22, safe.width / 27, (safe.height - 210) / 25));
    const resized = size !== cellSize;
    resizeGrid(size);
    for (const key of floor.explored) {
      const point = { x: key % floor.width, z: Math.floor(key / floor.width) };
      const tile = terrainAt(floor, point);
      if (resized || renderedTiles.get(key) !== tile) {
        sprite(`terrain_${key}`, tile, point);
        renderedTiles.set(key, tile);
      }
      if (!floor.visible.has(key)) {
        if (resized || !renderedFog.has(key)) sprite(`fog_${key}`, "fog", point, 3);
        renderedFog.add(key);
      } else if (renderedFog.delete(key)) scene_despawn(`fog_${key}`);
    }
    for (const id of scene_actor_ids()) {
      if (kind(id) === "loot") {
        const item = Object.keys(itemCatalog)[field(id, "power") - 1];
        sprite(id, item ?? "gold", cellPosition(id), 1, 0.7);
        const scale = scene_transform(id).get("scale");
        const visible = floor.visible.has(cellKey(floor, cellPosition(id)));
        for (const axis of ["x", "y"]) scale.set(axis, visible ? 1 : 0);
      } else actorSprite(id, selectedClass, id === "player" || floor.visible.has(cellKey(floor, cellPosition(id))));
    }
  }
  function collectLoot() {
    const point = cellPosition("player");
    for (const id of scene_actor_ids()) {
      if (kind(id) !== "loot" || !sameCell(point, cellPosition(id))) continue;
      const item = Object.keys(itemCatalog)[field(id, "power") - 1];
      if (item) {
        inventory[item]++;
        pushLog(`You pick up ${itemCatalog[item].name}.`);
      } else {
        const coins = 3 + Math.floor(random() * 8);
        gold += coins;
        pushLog(`You pick up ${coins} gold.`);
      }
      scene_despawn(id);
    }
  }
  function useInventoryItem(kindKey) {
    if (phase !== "playing" && phase !== "inventory" || inventory[kindKey] <= 0) return false;
    inventory[kindKey]--;
    pushLog(itemCatalog[kindKey].effectText);
    if (kindKey === "potion_healing") {
      change("player", "health", maxHealth);
      causticOozeTimer = 0;
    } else if (kindKey === "potion_liquid_flame") {
      for (const id of monsterIds()) {
        if (floor.visible.has(cellKey(floor, cellPosition(id))) && cellDistance(cellPosition("player"), cellPosition(id)) <= 2) damageMonster(id, 12);
      }
    } else if (kindKey === "potion_invisibility") invisTimer = 21;
    else if (kindKey === "potion_strength") strength++;
    else if (kindKey === "scroll_upgrade") damage++;
    else if (kindKey === "scroll_magic_mapping") {
      for (let key = 0; key < floor.tiles.length; key++) floor.explored.add(key);
    } else if (kindKey === "food_ration") hungerTimer = Math.max(0, hungerTimer - 300);
    if (phase !== "won") {
      phase = "playing";
      spendTurns(kindKey === "food_ration" ? 3 : 1);
    }
    return true;
  }
  function damageMonster(id, power) {
    const type = kind(id);
    const hp = field(id, "health") - power;
    change(id, "health", hp);
    if (hp > 0) return;
    const point = cellPosition(id), spec = mobCombat[type];
    scene_despawn(id);
    score += type === "boss" ? 500 : 10;
    if (level <= spec.maxLevel) experience += spec.experience;
    pushLog(`${dungeonMonsters[type].name} defeated.`);
    if (type === "boss") {
      pushLog("Goo drops the Skeleton Key. The sewers are cleared!");
      setPhase("won");
      return;
    }
    if (random() < 0.5) spawnLoot(point);
    while (experience >= targetExperience()) {
      experience -= targetExperience();
      level++;
      maxHealth += 5;
      change("player", "health", Math.min(maxHealth, health() + 5));
      pushLog(`You reached level ${level} (+5 maximum HP).`);
    }
  }
  function roll(min, max) {
    return Math.round(min + (random() + random()) * (max - min) / 2);
  }
  function attackMonster(id) {
    const type = kind(id), spec = mobCombat[type];
    const surprised = invisTimer > 0 || field(id, "lifetime") === 0;
    const enraged = type === "boss" && field(id, "health") <= enemySpecs.boss.health / 2;
    const hit = surprised || random() * (9 + level) >= random() * spec.defense * (enraged ? 1.5 : 1);
    invisTimer = 0;
    change(id, "lifetime", 1);
    if (hit) {
      const power = Math.max(0, roll(1, damage + Math.max(0, strength - 10)) - roll(0, spec.armor));
      pushLog(`${surprised ? "Surprise attack! " : ""}You hit ${dungeonMonsters[type].name} for ${power}.`);
      damageMonster(id, power);
    } else pushLog(`${dungeonMonsters[type].name} dodges your attack.`);
  }
  function hurtPlayer(power) {
    change("player", "health", Math.max(0, health() - power));
    queuedPath = [];
    if (health() <= 0) setPhase("lost");
  }
  function monstersTurn() {
    const hero = cellPosition("player");
    for (const id of monsterIds()) {
      const type = kind(id), spec = mobCombat[type];
      let current = cellPosition(id);
      const seesHero = invisTimer <= 0 && cellDistance(current, hero) <= 7 && lineOfSight(floor, current, hero);
      if (seesHero) {
        change(id, "lifetime", 1);
        change(id, "velocity_x", hero.x);
        change(id, "velocity_z", hero.z);
      }
      if (type === "boss" && terrainAt(floor, current) === "water") change(id, "health", Math.min(100, field(id, "health") + 1));
      if (!field(id, "lifetime")) continue;
      const charged = type === "boss" && field(id, "power") >= 2;
      const canAttack = seesHero && cellDistance(current, hero) <= (charged ? 2 : 1) && (charged || canStep(floor, current, hero));
      if (canAttack) {
        if (type === "boss") {
          if (field(id, "power") === 1) {
            change(id, "power", 2);
            pushLog("Goo swells further! Get out of reach!");
            continue;
          }
          const enraged2 = field(id, "health") <= 50;
          if (!charged && random() < (enraged2 ? 0.5 : 0.2)) {
            change(id, "power", 1);
            pushLog("Goo is pumping up! Retreat!");
            continue;
          }
        }
        const enraged = type === "boss" && field(id, "health") <= 50;
        const attack = (enraged ? 15 : spec.attack) * (charged ? 2 : 1);
        if (random() * attack >= random() * (4 + level)) {
          const max = enraged ? 12 : spec.maxDamage;
          const power = Math.max(0, roll(spec.minDamage * (charged ? 3 : 1), max * (charged ? 3 : 1)) - roll(0, 2));
          pushLog(`${dungeonMonsters[type].name}${charged ? " bursts" : " hits you"} for ${power}.`);
          hurtPlayer(power);
          if (type === "boss" && random() < 1 / 3) causticOozeTimer = 5;
        } else pushLog(`You dodge ${dungeonMonsters[type].name}.`);
        change(id, "power", 0);
        if (phase !== "playing") return;
        continue;
      }
      change(id, "power", 0);
      const destination = seesHero ? hero : { x: field(id, "velocity_x"), z: field(id, "velocity_z") };
      for (let step = 0; step < field(id, "speed"); step++) {
        const blocked = new Set(monsterIds().filter((other) => other !== id).map((other) => cellKey(floor, cellPosition(other))));
        blocked.add(cellKey(floor, hero));
        blocked.delete(cellKey(floor, destination));
        const next = findPath(floor, current, destination, blocked)[0];
        if (!next || sameCell(next, hero) || monsterIds().some((other) => other !== id && sameCell(cellPosition(other), next))) break;
        if (terrainAt(floor, next) === "door") {
          floor.tiles[cellKey(floor, next)] = "open_door";
          break;
        }
        placeCell(id, next);
        current = next;
      }
      if (!seesHero && sameCell(current, destination)) change(id, "lifetime", 0);
    }
  }
  function spendTurns(count = 1) {
    queuedPath = count > 1 ? [] : queuedPath;
    for (let turn = 0; turn < count && phase === "playing"; turn++) {
      turns++;
      hungerTimer++;
      if (invisTimer > 0) invisTimer--;
      if (terrainAt(floor, cellPosition("player")) === "water") causticOozeTimer = 0;
      if (causticOozeTimer > 0) {
        causticOozeTimer--;
        hurtPlayer(1);
      }
      if (phase !== "playing") break;
      if (hungerTimer >= 450 && turns % 10 === 0) hurtPlayer(1);
      else if (hungerTimer < 450 && turns % 10 === 0) change("player", "health", Math.min(maxHealth, health() + 1));
      if (phase !== "playing") break;
      monstersTurn();
    }
    refreshDungeon();
    publish();
    drawUi();
  }
  function movePlayer(dx, dz) {
    if (!floor || phase !== "playing") return false;
    const current = cellPosition("player"), next = { x: current.x + dx, z: current.z + dz };
    if (!canStep(floor, current, next)) return false;
    const target = monsterIds().find((id) => sameCell(cellPosition(id), next));
    if (target) {
      attackMonster(target);
      queuedPath = [];
    } else if (terrainAt(floor, next) === "door") {
      floor.tiles[cellKey(floor, next)] = "open_door";
      pushLog("You open the door.");
    } else {
      placeCell("player", next);
      collectLoot();
    }
    if (phase === "playing") spendTurns();
    return true;
  }
  function descend() {
    queuedPath = [];
    if (!floor || !sameCell(cellPosition("player"), floor.exit)) {
      pushLog("Stand on the downward stairs to descend.");
      drawUi();
      return;
    }
    if (depth === 5) {
      pushLog("Goo guards the way forward. Defeat it first.");
      drawUi();
      return;
    }
    depth++;
    turns++;
    hungerTimer++;
    pushLog(`You descend to depth ${depth}${depth === 5 ? ": Goo's lair" : ": sewers"}.`);
    enterFloor();
    publish();
    drawUi();
  }
  function playerInput(dt, pointer) {
    actionCooldown = Math.max(0, actionCooldown - dt);
    if (input_key_just_pressed("KeyE") || input_key_just_pressed("Period")) {
      descend();
      return;
    }
    if (input_key_just_pressed("Space")) {
      queuedPath = [];
      spendTurns();
      return;
    }
    const shortcuts = ["potion_healing", "potion_liquid_flame", "potion_invisibility", "potion_strength", "scroll_upgrade", "scroll_magic_mapping", "food_ration"];
    for (const [index, item] of shortcuts.entries()) if (input_key_just_pressed(`Digit${index + 1}`)) {
      queuedPath = [];
      useInventoryItem(item);
      return;
    }
    const dx = Number(input_key_pressed("KeyD") || input_key_pressed("ArrowRight")) - Number(input_key_pressed("KeyA") || input_key_pressed("ArrowLeft"));
    const dz = Number(input_key_pressed("KeyS") || input_key_pressed("ArrowDown")) - Number(input_key_pressed("KeyW") || input_key_pressed("ArrowUp"));
    if (dx || dz) {
      queuedPath = [];
      if (actionCooldown <= 0) {
        movePlayer(dx, dz);
        actionCooldown = 0.16;
      }
      return;
    }
    if (pointer.justPressed) {
      queuedPath = [];
      if (pointer.y > window_safe_area().top - 150 || pointer.y < window_safe_area().bottom + 80) return;
      const target = { x: Math.round(pointer.x / cellSize + 12), z: Math.round(12 - (pointer.y + 40) / cellSize) };
      if (!floor.explored.has(cellKey(floor, target))) return;
      if (sameCell(target, cellPosition("player"))) {
        if (sameCell(target, floor.exit)) descend();
        return;
      }
      const blocked = new Set(monsterIds().filter((id) => !sameCell(cellPosition(id), target)).map((id) => cellKey(floor, cellPosition(id))));
      queuedPath = findPath(floor, cellPosition("player"), target, blocked, true);
    }
    if (queuedPath.length && actionCooldown <= 0) {
      const current = cellPosition("player"), next = queuedPath[0];
      const before = floor.visible;
      const visibleEnemies = new Set(monsterIds().filter((id) => before.has(cellKey(floor, cellPosition(id)))));
      if (!movePlayer(next.x - current.x, next.z - current.z)) queuedPath = [];
      else {
        if (sameCell(cellPosition("player"), next)) queuedPath.shift();
        if (monsterIds().some((id) => floor.visible.has(cellKey(floor, cellPosition(id))) && !visibleEnemies.has(id))) queuedPath = [];
      }
      actionCooldown = 0.16;
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
      const sprite2 = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
      const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
      const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
      const camera = scene_set_3d_enabled(true) && scene_set_3d_enabled(false);
      return sprite2 && label && transformed && camera;
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
    checks.push("NOT_RUN  Full upstream content / sprite animation / native visual parity");
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
    const metrics = window_metrics();
    const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
    if (viewport !== signature) {
      viewport = signature;
      refreshDungeon();
      drawUi();
    }
    const previousPhase = phase;
    const previousTurns = turns;
    updateUi();
    pollNetwork(dt);
    if (phase !== previousPhase || turns !== previousTurns) return;
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
    if (phase === "inventory" && (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB"))) {
      setPhase("playing");
      return;
    }
    if (phase === "playing") {
      if (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB")) {
        setPhase("inventory");
        return;
      }
    }
    if (phase !== "playing") return;
    elapsed += dt;
    playerInput(dt, pointer);
  };
})();
