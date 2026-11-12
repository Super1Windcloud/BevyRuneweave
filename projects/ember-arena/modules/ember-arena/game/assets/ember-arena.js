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
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
      const center = { x: 4 + column * 8, z: 4 + row * 8 };
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
  var cellSize = 16;
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
  function text(id, value, options = {}) {
    return { kind: "text", id, value, style: options.style, fontSize: options.fontSize ?? 16, color: options.color ?? defaultTextColor, font: options.font };
  }
  function image(id, path, style = {}) {
    return { kind: "image", id, path, style };
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
      if (element.font) requireUi(ui_set_font(element.id, element.font), "font", element.id);
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
    if (pointerActionHandled) return false;
    for (const [id, callback] of [...buttonCallbacks]) {
      if (ui_button_just_pressed(id)) {
        pointerActionHandled = pointerPressed;
        callback();
        return true;
      }
    }
    return false;
  }

  // modules/ember-arena/game/src/spd-ui-atlas.ts
  var chromeFrames = {
    window: { rect: [0, 0, 20, 20], border: 6 },
    silver: { rect: [86, 0, 22, 22], border: 7 },
    toast: { rect: [20, 9, 9, 9], border: 4 },
    red: { rect: [38, 0, 6, 6], border: 2 },
    grey: { rect: [38, 6, 6, 6], border: 2 },
    tab: { rect: [65, 22, 8, 13], border: 3 },
    tabOff: { rect: [75, 22, 8, 13], border: 3 }
  };
  var uiFrames = {
    title_land: { source: "banners.png", rect: [0, 100, 240, 57] },
    title_port: { source: "banners.png", rect: [0, 0, 139, 100] },
    boss_slain: { source: "banners.png", rect: [0, 157, 127, 68] },
    game_over: { source: "banners.png", rect: [128, 157, 128, 35] },
    status: { source: "status_pane.png", rect: [0, 0, 82, 38] },
    status_large: { source: "status_pane.png", rect: [0, 64, 41, 39] },
    status_left: { source: "status_pane.png", rect: [0, 64, 33, 39] },
    status_middle: { source: "status_pane.png", rect: [33, 64, 4, 39] },
    status_right: { source: "status_pane.png", rect: [37, 64, 4, 39] },
    hp: { source: "status_pane.png", rect: [0, 40, 50, 4] },
    hp_large: { source: "status_pane.png", rect: [0, 103, 128, 9] },
    xp: { source: "status_pane.png", rect: [0, 48, 17, 4] },
    xp_large: { source: "status_pane.png", rect: [0, 121, 128, 7] },
    bag_tool: { source: "toolbar.png", rect: [0, 0, 24, 26] },
    wait_tool: { source: "toolbar.png", rect: [24, 0, 20, 26] },
    search_tool: { source: "toolbar.png", rect: [44, 0, 20, 26] },
    quick_tool: { source: "toolbar.png", rect: [64, 0, 22, 24] },
    quick_left: { source: "toolbar.png", rect: [86, 0, 20, 24] },
    quick_middle: { source: "toolbar.png", rect: [88, 0, 18, 24] },
    quick_right: { source: "toolbar.png", rect: [106, 0, 19, 24] },
    bag_icon: { source: "icons.png", rect: [0, 48, 16, 16] },
    enter: { source: "icons.png", rect: [0, 0, 16, 16] },
    support: { source: "icons.png", rect: [17, 0, 17, 16] },
    rankings: { source: "icons.png", rect: [34, 0, 17, 16] },
    news: { source: "icons.png", rect: [68, 0, 16, 15] },
    changes: { source: "icons.png", rect: [85, 0, 15, 15] },
    settings: { source: "icons.png", rect: [102, 0, 14, 14] },
    about: { source: "icons.png", rect: [119, 0, 16, 16] },
    journal: { source: "icons.png", rect: [136, 0, 17, 15] },
    exit: { source: "icons.png", rect: [0, 16, 15, 11] },
    display: { source: "icons.png", rect: [32, 16, 16, 12] },
    data: { source: "icons.png", rect: [48, 16, 14, 15] },
    audio: { source: "icons.png", rect: [64, 16, 14, 14] },
    langs: { source: "icons.png", rect: [80, 16, 14, 11] },
    input: { source: "icons.png", rect: [112, 16, 15, 12] },
    stats: { source: "icons.png", rect: [128, 16, 16, 13] },
    info: { source: "icons.png", rect: [16, 32, 14, 14] },
    unchecked: { source: "icons.png", rect: [48, 32, 12, 12] },
    checked: { source: "icons.png", rect: [64, 32, 12, 12] },
    close: { source: "icons.png", rect: [80, 32, 11, 11] },
    stairs: { source: "icons.png", rect: [0, 64, 15, 16] },
    menu: { source: "menu_button.png", rect: [17, 2, 12, 11] },
    menu_pane: { source: "menu_pane.png", rect: [1, 0, 31, 21] },
    journal_button: { source: "menu_button.png", rect: [2, 2, 13, 11] },
    journal_button_icon: { source: "menu_button.png", rect: [31, 0, 11, 6] },
    bag_tool_icon: { source: "toolbar.png", rect: [160, 0, 16, 16] },
    wait_tool_icon: { source: "toolbar.png", rect: [176, 0, 16, 16] },
    search_tool_icon: { source: "toolbar.png", rect: [192, 0, 16, 16] },
    hero_warrior: { source: "warrior.png", rect: [0, 90, 12, 15] },
    hero_mage: { source: "mage.png", rect: [0, 90, 12, 15] },
    hero_rogue: { source: "rogue.png", rect: [0, 90, 12, 15] },
    hero_huntress: { source: "huntress.png", rect: [0, 90, 12, 15] },
    hero_duelist: { source: "duelist.png", rect: [0, 90, 12, 15] },
    hero_cleric: { source: "cleric.png", rect: [0, 90, 12, 15] },
    avatar_warrior: { source: "warrior.png", rect: [1, 15, 11, 15] },
    avatar_mage: { source: "mage.png", rect: [1, 15, 11, 15] },
    avatar_rogue: { source: "rogue.png", rect: [1, 15, 11, 15] },
    avatar_huntress: { source: "huntress.png", rect: [1, 15, 11, 15] },
    sword: { source: "items.png", rect: [0, 96, 16, 16] },
    weapon_mage: { source: "items.png", rect: [80, 96, 16, 16] },
    weapon_rogue: { source: "items.png", rect: [64, 96, 16, 16] },
    weapon_huntress: { source: "items.png", rect: [32, 96, 16, 16] },
    armor: { source: "items.png", rect: [0, 176, 16, 16] },
    empty_weapon: { source: "items.png", rect: [16, 0, 16, 16] },
    empty_armor: { source: "items.png", rect: [32, 0, 16, 16] },
    empty_artifact: { source: "items.png", rect: [64, 0, 16, 16] },
    empty_ring: { source: "items.png", rect: [96, 0, 16, 16] }
  };

  // modules/ember-arena/game/assets/fonts/spd-pixel-metrics.json
  var spd_pixel_metrics_default = { "0": 0.537109375, "1": 0.341796875, "2": 0.537109375, "3": 0.537109375, "4": 0.537109375, "5": 0.537109375, "6": 0.537109375, "7": 0.537109375, "8": 0.537109375, "9": 0.537109375, " ": 0.244140625, "!": 0.1953125, '"': 0.390625, "#": 0.537109375, $: 0.5859375, "%": 0.68359375, "&": 0.634765625, "'": 0.1953125, "(": 0.390625, ")": 0.390625, "*": 0.634765625, "+": 0.48828125, ",": 0.1953125, "-": 0.390625, ".": 0.1953125, "/": 0.48828125, ":": 0.1953125, ";": 0.1953125, "<": 0.439453125, "=": 0.390625, ">": 0.439453125, "?": 0.48828125, "@": 0.537109375, A: 0.537109375, B: 0.537109375, C: 0.537109375, D: 0.537109375, E: 0.537109375, F: 0.537109375, G: 0.537109375, H: 0.537109375, I: 0.29296875, J: 0.48828125, K: 0.537109375, L: 0.48828125, M: 0.634765625, N: 0.537109375, O: 0.537109375, P: 0.537109375, Q: 0.537109375, R: 0.537109375, S: 0.537109375, T: 0.48828125, U: 0.537109375, V: 0.537109375, W: 0.634765625, X: 0.537109375, Y: 0.48828125, Z: 0.537109375, "[": 0.29296875, "\\": 0.634765625, "]": 0.29296875, "^": 0.537109375, _: 0.48828125, "`": 0.29296875, a: 0.48828125, b: 0.48828125, c: 0.48828125, d: 0.48828125, e: 0.48828125, f: 0.390625, g: 0.48828125, h: 0.48828125, i: 0.1953125, j: 0.29296875, k: 0.48828125, l: 0.29296875, m: 0.5859375, n: 0.48828125, o: 0.48828125, p: 0.48828125, q: 0.48828125, r: 0.390625, s: 0.48828125, t: 0.390625, u: 0.48828125, v: 0.48828125, w: 0.5859375, x: 0.48828125, y: 0.48828125, z: 0.537109375, "{": 0.390625, "|": 0.1953125, "}": 0.390625, "~": 0.68359375 };

  // modules/ember-arena/game/src/spd-ui.ts
  var glyphAdvances = spd_pixel_metrics_default;
  function textWidth(value, size) {
    let width = 0;
    for (const glyph of value) width += (glyphAdvances[glyph] ?? glyphAdvances["?"]) * size;
    return width;
  }
  function wrappedText(value, width, size) {
    const lines = [];
    for (const paragraph of value.split("\n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && textWidth(next, size) > width) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }
  function uiMetrics() {
    const size = window_metrics(), pointer = input_primary_pointer(), safe = window_safe_area();
    const sx = size.width / pointer.viewportWidth, sy = size.height / pointer.viewportHeight;
    const width = safe.width * sx, height = safe.height * sy;
    const landscape = width > height, large = landscape && width >= 960;
    const minWidth = large ? 360 : landscape ? 240 : 135, minHeight = large ? 200 : landscape ? 160 : 225;
    const maximum = Math.max(1, Math.floor(Math.min(width / minWidth, height / minHeight)));
    const scale = Math.min(large ? 4 : 3, maximum);
    return { scale, width: width / scale, height: height / scale, left: safe.leftInset * sx, top: safe.topInset * sy, landscape, large };
  }
  var titleColor = [1, 1, 68 / 255, 1];
  var white = [1, 1, 1, 1];
  var grey = [0.67, 0.67, 0.67, 1];
  var font = "fonts/spd-pixel.ttf";
  function renderSpdUi(state, on) {
    const m = uiMetrics(), s = m.scale, w = m.width, h = m.height;
    const elements = [];
    const rect = (x, y, width, height) => ({ position: "absolute", left: Math.round(x * s), top: Math.round(y * s), width: Math.round(width * s), height: Math.round(height * s) });
    function label(id, value, x, y, width, size = 8, color = white, height = size * 1.5) {
      return text(id, value, { font, fontSize: size * s, color, style: rect(x, y, width, height) });
    }
    function art(id, name, x, y, width, height, tint) {
      const f = uiFrames[name];
      return image(id, `sprites/spd-ui/${name}.png`, { ...rect(x, y, width ?? f?.rect[2] ?? 16, height ?? f?.rect[3] ?? 16), imageMode: "stretch", imageTint: tint });
    }
    function patch(id, type, x, y, width, height) {
      const b = chromeFrames[type].border;
      const xs = [x, x + b, x + width - b], ys = [y, y + b, y + height - b];
      const widths = [b, width - b * 2, b], heights = [b, height - b * 2, b];
      return ys.flatMap((py, row) => xs.map((px, column) => image(`${id}_${row}_${column}`, `sprites/spd-ui/${type}_${row}_${column}.png`, { ...rect(px, py, Math.max(1, widths[column]), Math.max(1, heights[row])), imageMode: "stretch" })));
    }
    function control(id, value, x, y, width, height = 20, type = "red", icon, action = id, enabled = true, size = 9) {
      const children = type ? patch(`${id}_chrome`, type, 0, 0, width, height) : [];
      const labelWidth = textWidth(value, size), iconWidth = icon ? uiFrames[icon]?.rect[2] ?? 14 : 0;
      const groupWidth = labelWidth + (icon ? iconWidth + (value ? 2 : 0) : 0), groupLeft = (width - groupWidth) / 2;
      if (icon) children.push(art(`${id}_icon`, icon, groupLeft, (height - (uiFrames[icon]?.rect[3] ?? 14)) / 2));
      if (value) children.push(text(`${id}__label`, value, {
        font,
        fontSize: size * s,
        color: !enabled ? grey : id === "begin_run" || id.startsWith("use_") ? titleColor : white,
        style: rect(groupLeft + (icon ? iconWidth + 2 : 0), (height - size * 1.2) / 2, labelWidth + 1, size * 1.5)
      }));
      return {
        kind: "button",
        id,
        onClick: enabled ? () => on(action) : void 0,
        style: { ...rect(x, y, width, height), alignItems: "center", justifyContent: "center", padding: icon ? 3 * s : 0 },
        children
      };
    }
    function iconControl(id, icon, x, y, width = 20, height = 20, action = id) {
      return { kind: "button", id, onClick: () => on(action), style: rect(x, y, width, height), children: [art(`${id}_image`, icon, (width - 14) / 2, (height - 14) / 2, 14, 14)] };
    }
    function window(id, width, height, content, close = true, centerY = h / 2) {
      if (close) elements.push({ kind: "button", id: `${id}_outside`, onClick: () => on("modal_close"), style: rect(0, 0, w, h), children: [] });
      const x = (w - width - 12) / 2, y = centerY - (height + 12) / 2;
      elements.push(node(`${id}_shadow`, { ...rect(x - 2, y - 2, width + 16, height + 16), background: [0, 0, 0, 0.5] }));
      elements.push(node(id, rect(x, y, width + 12, height + 12), [
        ...patch(`${id}_frame`, "window", 0, 0, width + 12, height + 12),
        node(`${id}_content`, rect(6, 6, width, height), content)
      ]));
    }
    function titleBackground() {
      elements.push(node("title_void", { ...rect(0, 0, w, h), background: [0.01, 0.012, 0.018, 1] }));
      const scale = h / 450;
      for (let index = 0; index < Math.ceil(w / (333 * scale)); index++) elements.push(art(`title_arch_${index}`, "title_arch", index * 333 * scale, 0, 333 * scale, 100 * scale));
      elements.push(art("title_cluster", "title_cluster", w * 0.42, h * 0.18, 450 * scale, 250 * scale));
      elements.push(art("title_mid", "title_mid", w * 0.05, h * 0.3, 273 * scale, 242 * scale));
      elements.push(art("title_front", "title_front", w * 0.75, h * 0.62, 112 * scale, 116 * scale));
    }
    function titleScreen() {
      titleBackground();
      const land = m.landscape, bannerW = land ? 240 : 139, bannerH = land ? 57 : 100;
      const top = Math.max(bannerH - 6, h * 0.45);
      elements.push(art("spd_banner", land ? "title_land" : "title_port", (w - bannerW) / 2, 2 + (top - bannerH) / 2));
      const area = land ? 234 : 133, left = (w - area) / 2;
      const gap = Math.max(2, Math.floor((h - top - (land ? 3 : 4) * 20) / 3 / (land ? 3 : 5)));
      const y = top + gap;
      if (land) {
        elements.push(control("start", "Enter the Dungeon", left, y, area / 2 - 1, 20, "toast", "enter"));
        elements.push(control("support", "Support the Game", left + area / 2 + 1, y, area / 2 - 1, 20, "toast", "support"));
        for (const [index, id] of ["rankings", "journal", "news", "settings", "changes", "about"].entries()) {
          const cw = Math.floor(area / 3) - 1;
          elements.push(control(id, id[0].toUpperCase() + id.slice(1), left + index % 3 * (cw + 2), y + (1 + Math.floor(index / 3)) * (20 + gap), cw, 20, "toast", id));
        }
      } else {
        elements.push(control("start", "Enter the Dungeon", left, y, area, 20, "toast", "enter"));
        elements.push(control("support", "Support the Game", left, y + 20 + gap, area, 20, "toast", "support"));
        for (const [index, id] of ["rankings", "journal", "news", "changes", "settings", "about"].entries()) {
          elements.push(control(id, id[0].toUpperCase() + id.slice(1), left + index % 2 * (area / 2 + 1), y + (2 + Math.floor(index / 2)) * (20 + gap), area / 2 - 1, 20, "toast", id));
        }
      }
      elements.push(label("version", "v0.1.0", w - 26, h - 8, 24, 5, grey));
      elements.push(iconControl("exit", "exit", w - 20, 0));
    }
    function heroScreen() {
      titleBackground();
      const spec = heroClasses[state.selectedClass];
      const leftArea = m.landscape ? Math.max(100, w / 3) : w;
      const backgroundWidth = h * 800 / 450;
      const backgroundLeft = (w - backgroundWidth) / 2 + (m.landscape ? leftArea / 6 : 0);
      elements.push(image("hero_splash", `sprites/spd/${state.selectedClass}.jpg`, { ...rect(backgroundLeft, 0, backgroundWidth, h), imageMode: "stretch" }));
      if (m.landscape) elements.push(art("hero_text_shade", "hero_fade", 0, 0, leftArea + 8, h));
      const uiHeight = Math.min(h - 20, 300), uiTop = (h - uiHeight) / 2;
      const spacing = (uiHeight - 120) / 2 - (uiHeight >= 160 ? 5 : 0) - (uiHeight >= 180 ? 6 : 0);
      if (m.landscape) elements.push(label("hero_select_title", "Choose Your Hero", (leftArea - 110) / 2, uiTop, 110, 12, titleColor));
      const selectorY = m.landscape ? uiTop + 16 + spacing : h - 24;
      const heroButtons = ["warrior", "mage", "rogue", "huntress", "duelist", "cleric"];
      const portraitWidth = Math.min(35, w / 6);
      heroButtons.forEach((hero, index) => {
        const bx = m.landscape ? (leftArea - 107) / 2 + index % 3 * 36 : (w - portraitWidth * 6) / 2 + index * portraitWidth;
        const by = m.landscape ? selectorY + Math.floor(index / 3) * 31 : selectorY;
        const button = control(`hero_${hero}`, "", bx, by, m.landscape ? 35 : portraitWidth, m.landscape ? 30 : 24, "toast", void 0, `select:${hero}`);
        const iconX = ((m.landscape ? 35 : portraitWidth) - 12) / 2;
        const brightness = hero === state.selectedClass ? 1 : heroClassList.includes(hero) ? 0.6 : 0.1;
        button.children = [...button.children ?? [], art(`hero_icon_${hero}`, `hero_${hero}`, iconX, m.landscape ? 7.5 : 4.5, 12, 15, [brightness, brightness, brightness, 1])];
        elements.push(button);
      });
      const nameY = m.landscape ? selectorY + 66 : h - 95;
      const nameWidth = textWidth(spec.name[0] + spec.name.slice(1).toLowerCase(), 9), nameLeft = (leftArea - nameWidth - 20) / 2;
      if (m.landscape) elements.push(label("hero_class_label", spec.name[0] + spec.name.slice(1).toLowerCase(), nameLeft, nameY, nameWidth + 4, 9, titleColor));
      if (m.landscape) elements.push(label("hero_description", spec.description, (leftArea - 80) / 2, nameY + 16, 80, 6, white, 56));
      elements.push(control("begin_run", m.landscape ? "Start" : spec.name[0] + spec.name.slice(1).toLowerCase(), m.landscape ? (leftArea - 64) / 2 : (w - 64) / 2, m.landscape ? uiTop + uiHeight - 21 : h - 43, 64, 21, "toast", "enter"));
      elements.push(iconControl("hero_info", "info", m.landscape ? nameLeft + nameWidth : (w + 64) / 2, m.landscape ? nameY : h - 43));
      elements.push(iconControl("back", "exit", w - 20, 0));
    }
    function inventoryContent() {
      let slotWidth = 28, slotHeight = 28;
      if (m.landscape) {
        while (slotHeight >= 24 && 14 + slotHeight * 5 + 4 + 20 + 6 > h) slotHeight--;
      } else {
        while (slotWidth >= 26 && slotWidth * 5 + 4 + 12 > w) slotWidth--;
      }
      const width = slotWidth * 5 + 4, height = 14 + slotHeight * 5 + 4;
      const children = [label("bag_title", "Backpack", 0, 2, width - 25, 8, titleColor), image("bag_gold", "sprites/dungeon/gold.png", rect(width - 15, 0, 12, 12)), label("bag_gold_count", `${state.gold}`, width - 38, 3, 23, 6, titleColor)];
      const items = Object.keys(itemCatalog).filter((key) => state.inventory[key] > 0);
      for (let index = 0; index < 25; index++) {
        const x = index % 5 * (slotWidth + 1), y = 14 + Math.floor(index / 5) * (slotHeight + 1);
        const key = items[index - 5];
        const equipped = index < 5;
        const childrenSlot = [];
        if (equipped) {
          childrenSlot.push(art(`equipment_${index}`, [state.selectedClass === "warrior" ? "sword" : `weapon_${state.selectedClass}`, "armor", "empty_artifact", "empty_ring", "empty_ring"][index], (slotWidth - 16) / 2, (slotHeight - 16) / 2));
        } else if (key) {
          childrenSlot.push(image(`item_ico_${key}`, `sprites/dungeon/${key}.png`, rect((slotWidth - 16) / 2, (slotHeight - 16) / 2, 16, 16)));
          childrenSlot.push(label(`item_count_${key}`, `${state.inventory[key]}`, 1, 1, slotWidth - 2, 6));
        }
        children.push({
          kind: "button",
          id: key ? `slot_${key}` : `bag_slot_${index}`,
          onClick: key ? () => on("item", key) : equipped ? () => on("hero_info") : void 0,
          style: { ...rect(x, y, slotWidth, slotHeight), background: equipped ? [145 / 255, 147 / 255, 140 / 255, 153 / 255] : [83 / 255, 86 / 255, 77 / 255, 153 / 255] },
          children: childrenSlot
        });
      }
      children.push(control("close_bag", "", -3, height + 2, 25, 17, "toast", "bag_icon"));
      return { width, height, children };
    }
    function hud() {
      const large = m.large;
      if (large) {
        elements.push(art("status_avatar_back", "status_left", 0, 0));
        elements.push(art("status_middle", "status_middle", 33, 0, 123, 39));
        elements.push(art("status_right", "status_right", 156, 0));
        elements.push(art("health_fill", "hp_large", 30, 19, Math.max(0, 128 * state.health / state.maxHealth), 9));
        elements.push(art("experience_fill", "xp_large", 30, 30, Math.max(0, 128 * state.experience / state.targetExperience), 7));
        const hpText = `${Math.ceil(state.health)}/${state.maxHealth}`, xpText = `${state.experience}/${state.targetExperience}`;
        elements.push(label("hud_health", hpText, 30 + (128 - textWidth(hpText, 6)) / 2, 20, 128, 6, [1, 1, 1, 0.6]));
        elements.push(label("hud_experience", xpText, 30 + (128 - textWidth(xpText, 6)) / 2, 30, 128, 6, [1, 1, 170 / 255, 0.6]));
      } else {
        elements.push(art("status_back", "status", 0, 0));
        elements.push(art("health_fill", "hp", 30, 2, Math.max(0, 50 * state.health / state.maxHealth), 4));
        elements.push(art("experience_fill", "xp", 2, 30, Math.max(0, 17 * state.experience / state.targetExperience), 4));
        elements.push(label("hud_health", `${Math.ceil(state.health)}/${state.maxHealth}`, 31, 2, 48, 3, [1, 1, 1, 0.6]));
        elements.push(label("hud_experience", `${state.experience}/${state.targetExperience}`, 3, 30, 17, 3, [1, 1, 170 / 255, 0.6]));
      }
      elements.push(art("hud_hero_icon", `avatar_${state.selectedClass}`, 9.5, 8.5, 11, 15));
      const levelText = large ? `lv. ${state.level}` : `${state.level}`;
      elements.push(label("hud_level", levelText, large ? (30 - textWidth(levelText, 6)) / 2 : 25.5 - textWidth(levelText, 6) / 2, large ? 30 : 28, 30, 6, [1, 1, 170 / 255, 1]));
      elements.push({ kind: "button", id: "hero_info", onClick: () => on("hero_info"), style: rect(0, 0, 30, 36), children: [] });
      elements.push({ kind: "button", id: "hero_info_bar", onClick: () => on("hero_info"), style: large ? rect(30, 19, 130, 20) : rect(30, 0, 50, 9), children: [] });
      elements.push(art("menu_pane", "menu_pane", w - 31, 0));
      elements.push(label("hud_version", "v0.1.0", w - 28, 1, 27, 5, grey));
      elements.push({ kind: "button", id: "pause", onClick: () => on("pause"), style: rect(w - 16, 0, 16, 21), children: [art("menu_icon", "menu", 2, 8)] });
      elements.push({ kind: "button", id: "game_journal", onClick: () => on("game_journal"), style: rect(w - 31, 0, 17, 21), children: [art("journal_button", "journal_button", 2, 8), art("journal_button_icon", "journal_button_icon", 3, 10.5)] });
      elements.push(art("hud_stairs", "stairs", w - 38, 8, 7, 8));
      elements.push(label("hud_wave", `${state.depth}`, w - 38, 16, 7, 4));
      if (state.hunger !== "satiated") elements.push(label("hud_hunger", state.hunger === "starving" ? "Starving" : "Hungry", large ? 32 : 33, large ? 4 : 10, 80, 6, titleColor));
      if (state.invisible) elements.push(label("hud_invisible", "Invisible", 33, large ? 10 : 18, 70, 6, titleColor));
      const toolbarX = !m.large && m.landscape ? w - 64 : w - 24, toolbarY = h - 26;
      const waitX = m.large ? w - 44 : m.landscape ? w - 20 : 0;
      const searchX = m.large ? w - 64 : m.landscape ? w - 40 : 20;
      elements.push({ kind: "button", id: "bag_btn", onClick: () => on("bag_btn"), style: rect(toolbarX, toolbarY, 24, 26), children: [art("bag_tool", "bag_tool", 0, 0), art("bag_tool_icon", "bag_tool_icon", 4, 5)] });
      elements.push({ kind: "button", id: "wait", onClick: () => on("wait"), style: rect(waitX, toolbarY, 20, 26), children: [art("wait_tool", "wait_tool", 0, 0), art("wait_tool_icon", "wait_tool_icon", 2, 5)] });
      elements.push({ kind: "button", id: "descend", onClick: () => on("descend"), style: rect(searchX, toolbarY, 20, 26), children: [art("search_tool", "search_tool", 0, 0), art("search_tool_icon", "search_tool_icon", 2, 5)] });
      const quick = ["potion_healing", "potion_liquid_flame", "potion_invisibility", "scroll_upgrade", null, null];
      const count = 4 + Number(w > 152) + Number(w > 170);
      let quickRight = m.large ? searchX : toolbarX;
      for (let offset = 0; offset < count; offset++) {
        const index = m.large ? count - 1 - offset : offset, item = quick[index];
        const side = m.large ? index === 0 ? "left" : index === count - 1 ? "right" : "middle" : index === 0 ? "right" : index === count - 1 ? "left" : "middle";
        const width = side === "left" ? 20 : side === "right" ? 19 : 18;
        quickRight -= width;
        elements.push({ kind: "button", id: item ? `quick_${item}` : `quick_empty_${index}`, onClick: item ? () => on("quick", item) : void 0, style: rect(quickRight, h - 24, width, 24), children: [
          art(`quick_frame_${index}`, `quick_${side}`, 0, 0),
          ...item ? [image(`quick_icon_${index}`, `sprites/dungeon/${item}.png`, rect((width - 16) / 2, 3, 16, 16)), label(`quick_count_${index}`, `${state.inventory[item]}`, 2, 2, 14, 5)] : []
        ] });
      }
      state.logs.slice(0, 3).reverse().forEach((entry, index) => elements.push(label(`log_line_${index}`, entry, 2, h - 62 + index * 10, Math.max(90, w - 90), 6, index === 2 ? white : grey, 10)));
      if (state.bossHealth !== null) elements.push(node("boss_panel", rect((w - 100) / 2, 2, 100, 10), [
        node("boss_track", { ...rect(0, 5, 100, 3), background: [0.1, 0.03, 0.03, 1] }),
        node("boss_fill", { ...rect(0, 5, Math.max(0, state.bossHealth), 3), background: [0.65, 0.05, 0.04, 1] }),
        label("boss_label", "Goo", 0, -2, 100, 6, titleColor)
      ]));
    }
    const menuPhases = ["menu", "rankings", "journal", "news", "changes", "about", "support"];
    if (state.phase === "heroes") heroScreen();
    else if ((state.phase === "hero" || state.phase === "message") && !state.gameBehind) heroScreen();
    else if (state.phase === "journal" && state.gameBehind) hud();
    else if (menuPhases.includes(state.phase) || state.phase === "settings" && !state.gameBehind) titleScreen();
    else hud();
    if (state.phase === "message") {
      const lines = wrappedText(state.notice, 120, 6), height = Math.max(8, Math.ceil(lines.length * 7.2));
      window("message_window", 120, height, [label("message_text", lines.join("\n"), 0, 0, 120, 6, white, height)]);
    } else if (state.phase === "paused") window("pause_window", 120, 42, [
      control("settings", "Settings", 0, 0, 120, 20, "red", "settings"),
      control("home", "Main Menu", 0, 22, 120, 20, "red", "display")
    ]);
    else if (state.phase === "inventory" || state.phase === "item") {
      const bag = inventoryContent();
      window("bag_window", bag.width, bag.height, bag.children);
      if (state.phase === "item") {
        const def = itemCatalog[state.item];
        const lines = wrappedText(def.description, 120, 6), descriptionHeight = Math.ceil(lines.length * 7.2);
        const buttonY = 20 + descriptionHeight;
        window("item_window", 120, buttonY + 16, [
          image("item_detail_icon", `sprites/dungeon/${state.item}.png`, rect(0, 0, 16, 16)),
          label("item_detail_title", def.name, 20, 1, 100, 9, titleColor, 26),
          label("item_detail_desc", lines.join("\n"), 0, 18, 120, 6, white, descriptionHeight),
          control(`use_${state.item}`, def.category === "food" ? "Eat" : def.category === "scroll" ? "Read" : "Drink", 0, buttonY, 120, 16, "red", void 0, `use_${state.item}`, true, 8)
        ]);
      }
    } else if (state.phase === "hero") {
      window("hero_window", 120, 126, [
        art("hero_detail_icon", `avatar_${state.selectedClass}`, 0, 0, 22, 30),
        label("hero_detail_title", `Level ${state.level} ${state.selectedClass}`, 28, 4, 92, 9, titleColor, 22),
        label("hero_stats", `Health: ${Math.ceil(state.health)}/${state.maxHealth}
Strength: ${state.strength}
Experience: ${state.experience}/${state.targetExperience}
Gold: ${state.gold}`, 0, 34, 120, 8, white, 60),
        control("hero_stats_tab", "Stats", 0, 108, 58, 16, "grey"),
        control("hero_talents_tab", "Talents", 60, 108, 60, 16, "toast", void 0, "hero_talents_tab", false)
      ]);
    } else if (state.phase === "settings") {
      const width = m.landscape ? 223 : 122, height = Math.min(156, h - 36), content = [];
      const headings = ["Display", "UI", "Input", "Data", "Audio", "Language"];
      content.push(label("settings_title", headings[state.settingsTab], 0, 0, width, 9, titleColor));
      const names = ["display", "settings", "input", "data", "audio", "langs"];
      names.forEach((name, index) => content.push(control(`settings_tab_${index}`, "", index * (width / 6), height - 18, width / 6 - 1, 18, state.settingsTab === index ? "grey" : "toast", name, `tab:${index}`)));
      if (state.settingsTab === 0) {
        content.push(label("display_scale_label", "Display scale", 0, 22, width, 8));
        content.push(control("window_landscape", "Landscape", 0, 38, width, 18));
        content.push(control("window_portrait", "Portrait", 0, 58, width, 18));
      } else if (state.settingsTab === 1) {
        content.push(control("hints", `Hints: ${state.profile.showHints ? "On" : "Off"}`, 0, 24, width, 18, "grey"));
        content.push(control("motion", `Reduced effects: ${state.profile.reducedMotion ? "On" : "Off"}`, 0, 45, width, 18, "grey"));
      } else if (state.settingsTab === 2) {
        content.push(control("sensitivity", `Pointer sensitivity: ${state.profile.sensitivity.toFixed(2)}x`, 0, 24, width, 18, "grey"));
        content.push(label("input_bindings", "WASD / Arrows: Move\nSpace: Wait   I: Inventory\nEscape: Menu", 0, 49, width, 7, white, 50));
      } else if (state.settingsTab === 3) {
        content.push(label("saved_stats", `Best: ${state.profile.bestScore}   Wins: ${state.profile.wins}
Runs: ${state.profile.runs}`, 0, 18, width, 7, white, 24));
        content.push(label("save_notice", state.saveNotice || "Your progress is saved on this device.", 0, 43, width, 6, grey, 25));
        content.push(control("seed", `Seed: ${state.profile.seed}`, 0, 71, width, 16, "grey"));
        content.push(control("retry_save", "Save", 0, 90, width / 2 - 1, 16));
        content.push(control("reset_save", "Clear data", width / 2 + 1, 90, width / 2 - 1, 16));
      } else if (state.settingsTab === 4) {
        content.push(label("audio_music", "Music volume", 0, 26, width, 8, grey), label("audio_sfx", "SFX volume", 0, 62, width, 8, grey));
        content.push(node("music_slider", { ...rect(0, 43, width, 3), background: [0.3, 0.3, 0.3, 1] }), node("sfx_slider", { ...rect(0, 79, width, 3), background: [0.3, 0.3, 0.3, 1] }));
      } else content.push(control("language_english", "English", 0, 24, width, 20, "grey"));
      window("settings_window", width, height, content);
      if (state.resetPending) window("reset_window", 120, 60, [label("reset_warning", "Erase saved progress?", 0, 0, 120, 8, titleColor, 22), control("confirm_reset", "Yes", 0, 40, 59, 18), control("cancel_reset", "No", 61, 40, 59, 18)]);
    } else if (state.phase === "won" || state.phase === "lost") {
      elements.push(art("result_banner", state.phase === "won" ? "boss_slain" : "game_over", (w - 128) / 2, h * 0.12));
      window("result_window", 120, 88, [
        label("result_title", state.phase === "won" ? "Goo defeated!" : "You died...", 0, 0, 120, 9, titleColor),
        label("result_stats", `Score: ${state.score}
Depth: ${state.depth}    Level: ${state.level}`, 0, 18, 120, 7, white, 26),
        control("restart", "Start New Game", 0, 46, 120, 20, "red", "enter"),
        control("home", "Main Menu", 0, 68, 120, 20, "red", "display")
      ], true, h * 0.66);
    } else if (state.phase === "checks") {
      const lines = state.checks.slice(state.checkPage * 6, state.checkPage * 6 + 6);
      window("checks_window", 190, 146, [
        label("checks_title", "Runtime checks", 0, 0, 190, 9, titleColor),
        ...lines.map((line, index) => label(`check_${index}`, line, 0, 16 + index * 13, 190, 6, white, 12)),
        label("network_status", state.networkStatus, 0, 96, 190, 6, grey, 18),
        control("check_page", "Next", 0, 124, 60, 18),
        control("network", "HTTP", 64, 124, 60, 18),
        control("back", "Back", 128, 124, 60, 18)
      ]);
    } else if (menuPhases.includes(state.phase) && state.phase !== "menu") {
      const page = state.phase;
      const contents = {
        rankings: `Best score: ${state.profile.bestScore}
Games played: ${state.profile.runs}
Victories: ${state.profile.wins}`,
        journal: "Guide\n\nExplore the dungeon. Collect items and defeat enemies.\n\nPotions   Scrolls   Equipment\n\nAlchemy",
        news: "Shattered Pixel Dungeon\n\nNews from ShatteredPixel.com\n\nshatteredpixel.com/blog/",
        changes: "Changes\n\nTurn-based dungeon exploration\nSewer encounters and Goo\nOriginal interface assets",
        about: "Shattered Pixel Dungeon\n\nEvan Debenham\n\nBased on Pixel Dungeon\nby Oleg Dolya (Watabou)\n\nEmber Arena runtime port",
        support: "Support Shattered Pixel Dungeon\n\nCreated by Evan Debenham\n\nshatteredpixel.com\npatreon.com/ShatteredPixel"
      };
      window(`${page}_window`, 170, 132, [label(`${page}_title`, page[0].toUpperCase() + page.slice(1), 0, 0, 170, 9, titleColor), label(`${page}_content`, contents[page], 0, 18, 170, 7, white, 94), control("back", "Close", 0, 114, 170, 18)]);
    }
    return node("safe_root", { position: "absolute", left: m.left, top: m.top, width: Math.round(w * s), height: Math.round(h * s) }, elements);
  }

  // modules/ember-arena/game/src/ember-arena.ts
  var callbacks = globalThis;
  var muted = [0.55, 0.69, 0.71, 1];
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
  var selectedItem = "potion_healing";
  var settingsTab = 0;
  var overlayReturn = "playing";
  var uiNotice = "";
  var previewPhase = null;
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
    settingsReturn = phase === "paused" ? "playing" : phase;
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
  function drawUi() {
    const pointer = input_primary_pointer(), safe = window_safe_area(), metrics = window_metrics();
    if (metrics.width <= 0 || metrics.height <= 0) return;
    viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
    mountUi(renderSpdUi({
      phase: previewPhase ?? phase,
      selectedClass,
      item: selectedItem,
      health: previewPhase === "lost" ? 0 : health(),
      maxHealth,
      level,
      strength,
      experience,
      targetExperience: targetExperience(),
      depth,
      gold,
      score,
      turns,
      hunger: getHungerStatus(hungerTimer),
      invisible: invisTimer,
      ooze: causticOozeTimer,
      bossHealth: scene_actor("warden") ? field("warden", "health") : null,
      inventory,
      logs: dungeonLogs,
      profile,
      settingsTab,
      gameBehind: phase === "settings" ? !["menu", "heroes"].includes(settingsReturn) : phase === "journal" ? overlayReturn !== "menu" : ["hero", "message"].includes(phase) ? overlayReturn !== "heroes" : true,
      saveNotice,
      resetPending,
      checks,
      checkPage,
      networkStatus,
      notice: uiNotice
    }, uiAction));
  }
  function closeModal() {
    if (phase === "settings" && resetPending) {
      resetPending = false;
      drawUi();
      return;
    }
    if (phase === "item") setPhase("inventory");
    else if (phase === "settings") setPhase(settingsReturn);
    else if (phase === "hero" || phase === "message" || phase === "journal") setPhase(overlayReturn);
    else if (phase === "checks") setPhase(returnPhase);
    else if (["inventory", "paused"].includes(phase)) setPhase("playing");
    else loadMenu();
  }
  function uiAction(id, value) {
    if (previewPhase) {
      previewPhase = null;
      drawUi();
      return;
    }
    if (id.startsWith("select:")) {
      const hero = id.slice(7);
      if (!heroClassList.includes(hero)) {
        uiNotice = hero === "duelist" ? "To unlock the Duelist equip a tier 2 or higher weapon with no strength penalty." : "To unlock the Cleric fully cleanse the curse on any piece of cursed equipment.";
        overlayReturn = "heroes";
        setPhase("message");
        return;
      }
      selectedClass = hero;
      room();
      setPhase("heroes");
      return;
    }
    if (id.startsWith("tab:")) {
      settingsTab = Number(id.slice(4));
      drawUi();
      return;
    }
    if (id.startsWith("use_")) {
      phase = "inventory";
      useInventoryItem(id.slice(4));
      return;
    }
    if (id === "journal" || id === "game_journal") {
      overlayReturn = phase === "menu" ? "menu" : "playing";
      setPhase("journal");
      return;
    }
    if (["rankings", "journal", "news", "changes", "about", "support"].includes(id)) {
      setPhase(id);
      return;
    }
    switch (id) {
      case "start":
        setPhase("heroes");
        return;
      case "begin_run":
        startRun();
        return;
      case "restart":
        setPhase("heroes");
        return;
      case "home":
        loadMenu();
        return;
      case "pause":
        setPhase("paused");
        return;
      case "bag_btn":
        setPhase("inventory");
        return;
      case "item":
        selectedItem = value;
        setPhase("item");
        return;
      case "quick":
        useInventoryItem(value);
        return;
      case "hero_info":
        overlayReturn = phase;
        setPhase("hero");
        return;
      case "settings":
        openSettings();
        return;
      case "checks":
        openChecks();
        return;
      case "check_page":
        checkPage = (checkPage + 1) % Math.ceil(checks.length / 6);
        drawUi();
        return;
      case "network":
        checkNetwork();
        return;
      case "wait":
        queuedPath = [];
        spendTurns();
        return;
      case "descend":
        descend();
        return;
      case "modal_close":
      case "close_bag":
      case "settings_back":
        closeModal();
        return;
      case "back":
        if (phase === "heroes") loadMenu();
        else closeModal();
        return;
      case "exit":
        app_request_exit();
        return;
      case "window_landscape":
        window_set_size(1280, 800);
        return;
      case "window_portrait":
        window_set_size(450, 800);
        return;
      case "hints":
        profile.showHints = !profile.showHints;
        break;
      case "motion":
        profile.reducedMotion = !profile.reducedMotion;
        break;
      case "sensitivity": {
        const values = [0.75, 1, 1.25, 1.5];
        profile.sensitivity = values[(values.indexOf(profile.sensitivity) + 1) % values.length];
        break;
      }
      case "seed":
        profile.seed = profile.seed + 1 >>> 0;
        break;
      case "retry_save":
        persistProfile();
        drawUi();
        return;
      case "reset_save":
        resetPending = true;
        drawUi();
        return;
      case "cancel_reset":
        resetPending = false;
        drawUi();
        return;
      case "confirm_reset":
        resetProfile();
        return;
      default:
        return;
    }
    persistProfile();
    drawUi();
  }
  function publish() {
    game_state_set(score, Math.ceil(health()), phase.toUpperCase());
  }
  function setPhase(next) {
    previewPhase = null;
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
    floor = null;
    scene_clear();
    ui_clear();
    scene_set_3d_enabled(false);
    scene_set_camera_2d(0, 0, 800);
    paintBackdrop();
    renderedTiles.clear();
    renderedFog.clear();
    sprite("player", selectedClass, { x: 12, z: 12 }, 2);
    scene_actor_set("player", "player", heroClasses[selectedClass].baseHealth, 1, 0.35);
  }
  function paintBackdrop() {
    const pointer = input_primary_pointer();
    if (!scene_transform("dungeon_backdrop")) scene_spawn("dungeon_backdrop", 0, 0, -10);
    if (floor) {
      const translation = scene_transform("player").get("translation");
      scene_set_transform("dungeon_backdrop", translation.get("x"), translation.get("y") + 10, -10);
      const metrics = window_metrics(), scale = uiMetrics().scale;
      scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", metrics.width / scale, metrics.height / scale);
    } else scene_set_sprite("dungeon_backdrop", "sprites/dungeon/void.png", pointer.viewportWidth, pointer.viewportHeight);
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
    if (!floor) return;
    reveal(floor, cellPosition("player"));
    const hero = scene_transform("player").get("translation");
    scene_set_camera_2d(hero.get("x"), hero.get("y") + 10, window_metrics().height / uiMetrics().scale);
    paintBackdrop();
    for (const key of floor.explored) {
      const point = { x: key % floor.width, z: Math.floor(key / floor.width) };
      const tile = terrainAt(floor, point);
      if (renderedTiles.get(key) !== tile) {
        sprite(`terrain_${key}`, tile, point);
        renderedTiles.set(key, tile);
      }
      if (!floor.visible.has(key)) {
        if (!renderedFog.has(key)) sprite(`fog_${key}`, "fog", point, 3);
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
      change("player", "lifetime", turns);
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
    change("player", "lifetime", turns);
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
      const translation = scene_transform("player").get("translation");
      const pointerScale = pointer.viewportHeight / window_metrics().height * uiMetrics().scale;
      const worldX = translation.get("x") + pointer.x / pointerScale;
      const worldY = translation.get("y") + 10 + pointer.y / pointerScale;
      const target = { x: Math.round(worldX / cellSize + 12), z: Math.round(12 - (worldY + 40) / cellSize) };
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
    if (metrics.width <= 0 || metrics.height <= 0) return;
    const signature = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
    if (viewport !== signature) {
      viewport = signature;
      refreshDungeon();
      drawUi();
    }
    const previousPhase = phase;
    const previousTurns = turns;
    const uiActivated = updateUi();
    pollNetwork(dt);
    if (uiActivated || phase !== previousPhase || turns !== previousTurns) return;
    if (input_key_just_pressed("F12")) {
      if (phase === "checks") setPhase(returnPhase);
      else openChecks();
      return;
    }
    if (phase === "checks") {
      const previews = ["hero", "menu", "heroes", "playing", "inventory", "item", "paused", "settings", "won", "lost"];
      for (let index = 0; index < previews.length; index++) {
        if (input_key_just_pressed(`Digit${index}`)) {
          previewPhase = previews[index];
          drawUi();
          return;
        }
      }
      if (previewPhase === "settings" && input_key_just_pressed("ArrowRight")) {
        settingsTab = (settingsTab + 1) % 6;
        drawUi();
        return;
      }
    }
    if (input_key_just_pressed("Escape")) {
      if (phase === "playing") setPhase("paused");
      else if (phase === "inventory" || phase === "item" || phase === "hero" || phase === "message") closeModal();
      else if (phase === "paused") setPhase("playing");
      else if (phase === "checks") setPhase(returnPhase);
      else if (phase === "settings") setPhase(settingsReturn);
      else if (phase !== "menu") loadMenu();
      return;
    }
    if (phase === "menu" && input_key_just_pressed("Space")) {
      setPhase("heroes");
      return;
    }
    if (phase === "inventory" && (input_key_just_pressed("KeyI") || input_key_just_pressed("KeyB"))) {
      setPhase("playing");
      return;
    }
    if (phase === "heroes" && input_key_just_pressed("Space")) {
      startRun();
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
