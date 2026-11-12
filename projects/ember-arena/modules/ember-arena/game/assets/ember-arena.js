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

  // modules/ember-arena/game/src/i18n.ts
  var messages = {
    "title.name": ["Shattered Pixel Dungeon", "\u7834\u788E\u7684\u50CF\u7D20\u5730\u7262"],
    "title.portrait": ["Shattered Pixel Dungeon", "\u7834\u788E\u7684\n\u50CF\u7D20\u5730\u7262"],
    "language.en": ["English", "English"],
    "language.zh-CN": ["\u7B80\u4F53\u4E2D\u6587", "\u7B80\u4F53\u4E2D\u6587"],
    "menu.start": ["Enter the Dungeon", "\u8FDB\u5165\u5730\u7262"],
    "menu.support": ["Support the Game", "\u652F\u6301\u6E38\u620F"],
    "menu.rankings": ["Rankings", "\u6392\u884C\u699C"],
    "menu.journal": ["Journal", "\u65E5\u5FD7"],
    "menu.news": ["News", "\u65B0\u95FB"],
    "menu.settings": ["Settings", "\u8BBE\u7F6E"],
    "menu.changes": ["Changes", "\u66F4\u65B0\u8BB0\u5F55"],
    "menu.about": ["About", "\u5173\u4E8E"],
    "menu.home": ["Main Menu", "\u4E3B\u83DC\u5355"],
    "common.start": ["Start", "\u5F00\u59CB"],
    "common.close": ["Close", "\u5173\u95ED"],
    "common.back": ["Back", "\u8FD4\u56DE"],
    "common.next": ["Next", "\u4E0B\u4E00\u9875"],
    "common.yes": ["Yes", "\u662F"],
    "common.no": ["No", "\u5426"],
    "common.on": ["On", "\u5F00"],
    "common.off": ["Off", "\u5173"],
    "hero.choose": ["Choose Your Hero", "\u9009\u62E9\u4F60\u7684\u82F1\u96C4"],
    "hero.warrior.name": ["Warrior", "\u6218\u58EB"],
    "hero.mage.name": ["Mage", "\u6CD5\u5E08"],
    "hero.rogue.name": ["Rogue", "\u76D7\u8D3C"],
    "hero.huntress.name": ["Huntress", "\u5973\u730E\u624B"],
    "hero.warrior.description": [heroClasses.warrior.description, "\u575A\u97E7\u7684\u8FD1\u6218\u6218\u58EB\u3002\u521D\u59CB\u6B66\u5668\u66F4\u5F3A\uFF0C\u5E76\u989D\u5916\u643A\u5E26\u4E00\u74F6\u6CBB\u7597\u836F\u6C34\u3002"],
    "hero.mage.description": [heroClasses.mage.description, "\u6301\u6709\u53E4\u8001\u6CD5\u6756\u7684\u5B66\u8005\u3002\u521D\u59CB\u989D\u5916\u643A\u5E26\u5347\u7EA7\u5377\u8F74\u548C\u63A2\u5730\u5377\u8F74\u3002"],
    "hero.rogue.description": [heroClasses.rogue.description, "\u64C5\u957F\u6F5C\u884C\u7684\u6218\u6597\u8005\u3002\u521D\u59CB\u989D\u5916\u643A\u5E26\u4E00\u74F6\u9690\u5F62\u836F\u6C34\uFF0C\u7528\u4E8E\u53D1\u52A8\u4F0F\u51FB\u3002"],
    "hero.huntress.description": [heroClasses.huntress.description, "\u8352\u91CE\u4E2D\u7684\u63A2\u7D22\u8005\u3002\u521D\u59CB\u989D\u5916\u643A\u5E26\u98DF\u7269\u548C\u6DB2\u706B\u836F\u5242\u3002\u5F13\u7BAD\u80FD\u529B\u5C1A\u672A\u5B9E\u73B0\u3002"],
    "hero.unlockDuelist": ["To unlock the Duelist equip a tier 2 or higher weapon with no strength penalty.", "\u88C5\u5907\u4E00\u4EF6\u4E8C\u9636\u6216\u66F4\u9AD8\u9636\u7684\u6B66\u5668\uFF0C\u4E14\u4E0D\u53D7\u5230\u529B\u91CF\u4E0D\u8DB3\u7684\u60E9\u7F5A\uFF0C\u5373\u53EF\u89E3\u9501\u51B3\u6597\u5BB6\u3002"],
    "hero.unlockCleric": ["To unlock the Cleric fully cleanse the curse on any piece of cursed equipment.", "\u5F7B\u5E95\u51C0\u5316\u4EFB\u610F\u4E00\u4EF6\u53D7\u8BC5\u5492\u88C5\u5907\u4E0A\u7684\u8BC5\u5492\uFF0C\u5373\u53EF\u89E3\u9501\u7267\u5E08\u3002"],
    "hero.level": ["Level {level} {hero}", "{level}\u7EA7 {hero}"],
    "hero.stats": ["Health: {health}/{maxHealth}\nStrength: {strength}\nExperience: {experience}/{target}\nGold: {gold}", "\u751F\u547D\uFF1A{health}/{maxHealth}\n\u529B\u91CF\uFF1A{strength}\n\u7ECF\u9A8C\uFF1A{experience}/{target}\n\u91D1\u5E01\uFF1A{gold}"],
    "hero.statsTab": ["Stats", "\u5C5E\u6027"],
    "hero.talents": ["Talents", "\u5929\u8D4B"],
    "bag.title": ["Backpack", "\u80CC\u5305"],
    "item.eat": ["Eat", "\u98DF\u7528"],
    "item.read": ["Read", "\u9605\u8BFB"],
    "item.drink": ["Drink", "\u996E\u7528"],
    "item.potion_healing.name": [itemCatalog.potion_healing.name, "\u6CBB\u7597\u836F\u6C34"],
    "item.potion_healing.description": [itemCatalog.potion_healing.description, "\u6062\u590D\u751F\u547D\u5E76\u6E05\u9664\u8150\u8680\u9ECF\u6DB2\u3002\u6D88\u80171\u56DE\u5408\u3002"],
    "item.potion_healing.effect": [itemCatalog.potion_healing.effectText, "\u6E29\u6696\u800C\u8212\u7F13\u7684\u80FD\u91CF\u6D41\u904D\u4F60\u7684\u5168\u8EAB\u3002"],
    "item.potion_liquid_flame.name": [itemCatalog.potion_liquid_flame.name, "\u6DB2\u706B\u836F\u5242"],
    "item.potion_liquid_flame.description": [itemCatalog.potion_liquid_flame.description, "\u5BF9\u9644\u8FD1\u53EF\u89C1\u7684\u654C\u4EBA\u9020\u621012\u70B9\u4F24\u5BB3\u3002\u6D88\u80171\u56DE\u5408\u3002"],
    "item.potion_liquid_flame.effect": [itemCatalog.potion_liquid_flame.effectText, "\u836F\u74F6\u788E\u88C2\uFF0C\u5316\u4E3A\u718A\u718A\u70C8\u7130\uFF01"],
    "item.potion_invisibility.name": [itemCatalog.potion_invisibility.name, "\u9690\u5F62\u836F\u6C34"],
    "item.potion_invisibility.description": [itemCatalog.potion_invisibility.description, "\u4F7F\u82F1\u96C4\u9690\u5F6220\u56DE\u5408\u3002\u653B\u51FB\u4F1A\u89E3\u9664\u9690\u5F62\u3002"],
    "item.potion_invisibility.effect": [itemCatalog.potion_invisibility.effectText, "\u4F60\u4ECE\u654C\u4EBA\u7684\u89C6\u91CE\u4E2D\u6D88\u5931\u4E86\uFF0C\u51C6\u5907\u53D1\u52A8\u4F0F\u51FB\uFF01"],
    "item.potion_strength.name": [itemCatalog.potion_strength.name, "\u529B\u91CF\u836F\u6C34"],
    "item.potion_strength.description": [itemCatalog.potion_strength.description, "\u6C38\u4E45\u589E\u52A01\u70B9\u529B\u91CF\u3002\u6D88\u80171\u56DE\u5408\u3002"],
    "item.potion_strength.effect": [itemCatalog.potion_strength.effectText, "\u65B0\u7684\u529B\u91CF\u6D8C\u5165\u4F60\u7684\u808C\u8089\uFF01"],
    "item.scroll_upgrade.name": [itemCatalog.scroll_upgrade.name, "\u5347\u7EA7\u5377\u8F74"],
    "item.scroll_upgrade.description": [itemCatalog.scroll_upgrade.description, "\u4F7F\u88C5\u5907\u7684\u6B66\u5668\u5347\u7EA71\u6B21\u3002\u6D88\u80171\u56DE\u5408\u3002"],
    "item.scroll_upgrade.effect": [itemCatalog.scroll_upgrade.effectText, "\u53E4\u8001\u7684\u7B26\u6587\u878D\u5165\u4F60\u7684\u6B66\u5668\uFF0C\u5347\u7EA7+1\uFF01"],
    "item.scroll_magic_mapping.name": [itemCatalog.scroll_magic_mapping.name, "\u63A2\u5730\u5377\u8F74"],
    "item.scroll_magic_mapping.description": [itemCatalog.scroll_magic_mapping.description, "\u63ED\u793A\u672C\u5C42\u5730\u5F62\uFF0C\u4F46\u4E0D\u4F1A\u63ED\u793A\u5176\u4E2D\u7684\u654C\u4EBA\u3002"],
    "item.scroll_magic_mapping.effect": [itemCatalog.scroll_magic_mapping.effectText, "\u5730\u7262\u7684\u5E03\u5C40\u5728\u4F60\u7684\u8111\u6D77\u4E2D\u6E05\u6670\u8D77\u6765\uFF01"],
    "item.food_ration.name": [itemCatalog.food_ration.name, "\u53E3\u7CAE"],
    "item.food_ration.description": [itemCatalog.food_ration.description, "\u7F13\u89E3300\u70B9\u9965\u997F\u3002\u8FDB\u98DF\u6D88\u80173\u56DE\u5408\uFF0C\u4E0D\u4F1A\u6062\u590D\u751F\u547D\u3002"],
    "item.food_ration.effect": [itemCatalog.food_ration.effectText, "\u4F60\u5403\u4E0B\u4E86\u53E3\u7CAE\uFF0C\u9965\u997F\u611F\u6E10\u6E10\u6D88\u9000\u3002"],
    "monster.chaser": ["Marsupial Rat", "\u98DF\u8150\u8001\u9F20"],
    "monster.ranger": ["Gnoll Scout", "\u8C7A\u72FC\u4EBA\u4FA6\u5BDF\u5175"],
    "monster.charger": ["Sewer Crab", "\u4E0B\u6C34\u9053\u8783\u87F9"],
    "monster.boss": ["Goo", "\u7C98\u5495"],
    "hud.level": ["lv. {level}", "{level}\u7EA7"],
    "hud.hungry": ["Hungry", "\u9965\u997F"],
    "hud.starving": ["Starving", "\u6781\u5EA6\u9965\u997F"],
    "hud.invisible": ["Invisible", "\u9690\u5F62"],
    "settings.display": ["Display", "\u663E\u793A"],
    "settings.ui": ["UI", "\u754C\u9762"],
    "settings.input": ["Input", "\u8F93\u5165"],
    "settings.data": ["Data", "\u6570\u636E"],
    "settings.audio": ["Audio", "\u97F3\u9891"],
    "settings.language": ["Language", "\u8BED\u8A00"],
    "settings.scale": ["Display scale", "\u663E\u793A\u6BD4\u4F8B"],
    "settings.landscape": ["Landscape", "\u6A2A\u5C4F"],
    "settings.portrait": ["Portrait", "\u7AD6\u5C4F"],
    "settings.hints": ["Hints: {value}", "\u64CD\u4F5C\u63D0\u793A\uFF1A{value}"],
    "settings.motion": ["Reduced effects: {value}", "\u51CF\u5C11\u52A8\u6001\u6548\u679C\uFF1A{value}"],
    "settings.sensitivity": ["Pointer sensitivity: {value}x", "\u6307\u9488\u7075\u654F\u5EA6\uFF1A{value}\u500D"],
    "settings.bindings": ["WASD / Arrows: Move\nSpace: Wait   I: Inventory\nEscape: Menu", "WASD / \u65B9\u5411\u952E\uFF1A\u79FB\u52A8\n\u7A7A\u683C\uFF1A\u7B49\u5F85  I\uFF1A\u80CC\u5305\nEscape\uFF1A\u83DC\u5355"],
    "settings.stats": ["Best: {best}   Wins: {wins}\nRuns: {runs}", "\u6700\u9AD8\u5206\uFF1A{best}  \u80DC\u5229\uFF1A{wins}\n\u5192\u9669\u6B21\u6570\uFF1A{runs}"],
    "settings.seed": ["Seed: {seed}", "\u968F\u673A\u79CD\u5B50\uFF1A{seed}"],
    "settings.save": ["Save", "\u4FDD\u5B58"],
    "settings.clear": ["Clear data", "\u6E05\u9664\u6570\u636E"],
    "settings.reset": ["Erase saved progress?", "\u8981\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u8FDB\u5EA6\u5417\uFF1F"],
    "settings.music": ["Music volume", "\u97F3\u4E50\u97F3\u91CF"],
    "settings.sfx": ["SFX volume", "\u97F3\u6548\u97F3\u91CF"],
    "settings.current": ["Selected", "\u5DF2\u9009\u62E9"],
    "settings.languageHint": ["Applies immediately and is saved on this device.", "\u7ACB\u5373\u751F\u6548\uFF0C\u5E76\u4FDD\u5B58\u5230\u672C\u8BBE\u5907\u3002"],
    "save.device": ["Your progress is saved on this device.", "\u6E38\u620F\u8FDB\u5EA6\u4FDD\u5B58\u5728\u672C\u8BBE\u5907\u4E0A\u3002"],
    "save.unavailable": ["Save unavailable ({error}). Playing in this session is safe.", "\u5B58\u6863\u4E0D\u53EF\u7528\uFF08{error}\uFF09\uFF0C\u4ECD\u53EF\u5728\u672C\u6B21\u4F1A\u8BDD\u4E2D\u6B63\u5E38\u6E38\u73A9\u3002"],
    "save.incompatible": ["Existing save is incompatible. It will not be overwritten.", "\u73B0\u6709\u5B58\u6863\u4E0D\u517C\u5BB9\uFF0C\u4E0D\u4F1A\u8986\u76D6\u8BE5\u5B58\u6863\u3002"],
    "save.saved": ["Progress and settings saved.", "\u8FDB\u5EA6\u548C\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002"],
    "save.failed": ["Save failed ({error}). You can retry in settings.", "\u4FDD\u5B58\u5931\u8D25\uFF08{error}\uFF09\uFF0C\u53EF\u4EE5\u5728\u8BBE\u7F6E\u4E2D\u91CD\u8BD5\u3002"],
    "save.resetFailed": ["Reset failed ({error}). Existing save retained.", "\u91CD\u7F6E\u5931\u8D25\uFF08{error}\uFF09\uFF0C\u539F\u5B58\u6863\u5DF2\u4FDD\u7559\u3002"],
    "save.reset": ["Saved progress reset. Your current run is unchanged.", "\u5DF2\u91CD\u7F6E\u4FDD\u5B58\u7684\u8FDB\u5EA6\uFF0C\u5F53\u524D\u5192\u9669\u4E0D\u53D7\u5F71\u54CD\u3002"],
    "result.win": ["Goo defeated!", "\u51FB\u8D25\u7C98\u5495\uFF01"],
    "result.lose": ["You died...", "\u4F60\u6B7B\u4E86\u2026\u2026"],
    "result.bannerWin": ["Boss slain", "\u9996\u9886\u5DF2\u88AB\u51FB\u8D25"],
    "result.bannerLose": ["Game over", "\u5192\u9669\u7ED3\u675F"],
    "result.stats": ["Score: {score}\nDepth: {depth}    Level: {level}", "\u5206\u6570\uFF1A{score}\n\u6DF1\u5EA6\uFF1A{depth}  \u7B49\u7EA7\uFF1A{level}"],
    "result.restart": ["Start New Game", "\u5F00\u59CB\u65B0\u5192\u9669"],
    "page.rankings": ["Best score: {best}\nGames played: {runs}\nVictories: {wins}", "\u6700\u9AD8\u5206\uFF1A{best}\n\u5192\u9669\u6B21\u6570\uFF1A{runs}\n\u80DC\u5229\u6B21\u6570\uFF1A{wins}"],
    "page.journal": ["Guide\n\nExplore the dungeon. Collect items and defeat enemies.\n\nPotions   Scrolls   Equipment\n\nAlchemy", "\u6307\u5357\n\n\u63A2\u7D22\u5730\u7262\uFF0C\u6536\u96C6\u7269\u54C1\u5E76\u51FB\u8D25\u654C\u4EBA\u3002\n\n\u836F\u6C34  \u5377\u8F74  \u88C5\u5907\n\n\u70BC\u91D1\u672F"],
    "page.news": ["Shattered Pixel Dungeon\n\nNews from ShatteredPixel.com\n\nshatteredpixel.com/blog/", "\u7834\u788E\u7684\u50CF\u7D20\u5730\u7262\n\n\u6765\u81EA ShatteredPixel.com \u7684\u65B0\u95FB\n\nshatteredpixel.com/blog/"],
    "page.changes": ["Changes\n\nTurn-based dungeon exploration\nSewer encounters and Goo\nOriginal interface assets", "\u66F4\u65B0\u8BB0\u5F55\n\n\u56DE\u5408\u5236\u5730\u7262\u63A2\u7D22\n\u4E0B\u6C34\u9053\u906D\u9047\u6218\u4E0E\u7C98\u5495\n\u539F\u4F5C\u754C\u9762\u7D20\u6750"],
    "page.about": ["Shattered Pixel Dungeon\n\nEvan Debenham\n\nBased on Pixel Dungeon\nby Oleg Dolya (Watabou)\n\nEmber Arena runtime port", "\u7834\u788E\u7684\u50CF\u7D20\u5730\u7262\n\nEvan Debenham\n\n\u57FA\u4E8E Oleg Dolya (Watabou)\n\u521B\u4F5C\u7684\u50CF\u7D20\u5730\u7262\n\nEmber Arena \u8FD0\u884C\u65F6\u79FB\u690D\u7248"],
    "page.support": ["Support Shattered Pixel Dungeon\n\nCreated by Evan Debenham\n\nshatteredpixel.com\npatreon.com/ShatteredPixel", "\u652F\u6301\u7834\u788E\u7684\u50CF\u7D20\u5730\u7262\n\n\u7531 Evan Debenham \u521B\u4F5C\n\nshatteredpixel.com\npatreon.com/ShatteredPixel"],
    "log.welcome": ["Welcome to the sewers, {hero}.", "\u6B22\u8FCE\u6765\u5230\u4E0B\u6C34\u9053\uFF0C{hero}\u3002"],
    "log.guide": ["Move one tile at a time. Find the stairs to descend.", "\u6BCF\u6B21\u79FB\u52A8\u4E00\u683C\uFF0C\u627E\u5230\u697C\u68AF\u540E\u5411\u4E0B\u63A2\u7D22\u3002"],
    "log.item": ["You pick up {item}.", "\u4F60\u6361\u8D77\u4E86{item}\u3002"],
    "log.gold": ["You pick up {gold} gold.", "\u4F60\u6361\u8D77\u4E86{gold}\u679A\u91D1\u5E01\u3002"],
    "log.defeated": ["{monster} defeated.", "{monster}\u88AB\u51FB\u8D25\u4E86\u3002"],
    "log.sewersCleared": ["Goo drops the Skeleton Key. The sewers are cleared!", "\u7C98\u5495\u6389\u843D\u4E86\u9AB7\u9AC5\u94A5\u5319\uFF0C\u4E0B\u6C34\u9053\u5DF2\u88AB\u6E05\u7406\uFF01"],
    "log.level": ["You reached level {level} (+5 maximum HP).", "\u4F60\u5347\u5230\u4E86{level}\u7EA7\uFF0C\u751F\u547D\u4E0A\u9650\u589E\u52A05\u70B9\u3002"],
    "log.hit": ["You hit {monster} for {damage}.", "\u4F60\u51FB\u4E2D\u4E86{monster}\uFF0C\u9020\u6210{damage}\u70B9\u4F24\u5BB3\u3002"],
    "log.surprise": ["Surprise attack! You hit {monster} for {damage}.", "\u4F0F\u51FB\uFF01\u4F60\u51FB\u4E2D\u4E86{monster}\uFF0C\u9020\u6210{damage}\u70B9\u4F24\u5BB3\u3002"],
    "log.enemyDodged": ["{monster} dodges your attack.", "{monster}\u8EB2\u5F00\u4E86\u4F60\u7684\u653B\u51FB\u3002"],
    "log.gooSwells": ["Goo swells further! Get out of reach!", "\u7C98\u5495\u7EE7\u7EED\u81A8\u80C0\uFF0C\u5FEB\u79BB\u5F00\u5B83\u7684\u653B\u51FB\u8303\u56F4\uFF01"],
    "log.gooCharging": ["Goo is pumping up! Retreat!", "\u7C98\u5495\u6B63\u5728\u84C4\u529B\uFF0C\u5FEB\u64A4\u9000\uFF01"],
    "log.enemyHit": ["{monster} hits you for {damage}.", "{monster}\u51FB\u4E2D\u4E86\u4F60\uFF0C\u9020\u6210{damage}\u70B9\u4F24\u5BB3\u3002"],
    "log.enemyBurst": ["{monster} bursts for {damage}.", "{monster}\u7206\u53D1\u4E86\uFF0C\u9020\u6210{damage}\u70B9\u4F24\u5BB3\u3002"],
    "log.dodged": ["You dodge {monster}.", "\u4F60\u8EB2\u5F00\u4E86{monster}\u7684\u653B\u51FB\u3002"],
    "log.door": ["You open the door.", "\u4F60\u6253\u5F00\u4E86\u95E8\u3002"],
    "log.stairs": ["Stand on the downward stairs to descend.", "\u8BF7\u7AD9\u5230\u5411\u4E0B\u7684\u697C\u68AF\u4E0A\uFF0C\u518D\u8FDB\u5165\u4E0B\u4E00\u5C42\u3002"],
    "log.gooBlocks": ["Goo guards the way forward. Defeat it first.", "\u7C98\u5495\u6321\u4F4F\u4E86\u53BB\u8DEF\uFF0C\u5148\u51FB\u8D25\u5B83\u3002"],
    "log.descend": ["You descend to depth {depth}: sewers.", "\u4F60\u6765\u5230\u4E86\u7B2C{depth}\u5C42\uFF1A\u4E0B\u6C34\u9053\u3002"],
    "log.lair": ["You descend to depth {depth}: Goo's lair.", "\u4F60\u6765\u5230\u4E86\u7B2C{depth}\u5C42\uFF1A\u7C98\u5495\u7684\u5DE2\u7A74\u3002"],
    "checks.title": ["Runtime checks", "\u8FD0\u884C\u65F6\u68C0\u67E5"],
    "checks.entity": ["Owned entity + reflected component + query", "\u6240\u5C5E\u5B9E\u4F53\u3001\u53CD\u5C04\u7EC4\u4EF6\u4E0E\u67E5\u8BE2"],
    "checks.values": ["Invalid values / missing entities rejected", "\u62D2\u7EDD\u65E0\u6548\u503C\u4E0E\u4E0D\u5B58\u5728\u7684\u5B9E\u4F53"],
    "checks.scene": ["2D sprite / text / transform / camera toggle", "\u4E8C\u7EF4\u7CBE\u7075\u3001\u6587\u5B57\u3001\u53D8\u6362\u4E0E\u76F8\u673A\u5207\u6362"],
    "checks.despawn": ["Despawn invalidates lookup", "\u9500\u6BC1\u540E\u5B9E\u4F53\u67E5\u8BE2\u5931\u6548"],
    "checks.ui": ["UI validation + child cleanup", "\u754C\u9762\u6821\u9A8C\u4E0E\u5B50\u8282\u70B9\u6E05\u7406"],
    "checks.input": ["Keyboard / touch / pointer / safe-area reads", "\u952E\u76D8\u3001\u89E6\u6478\u3001\u6307\u9488\u4E0E\u5B89\u5168\u533A\u57DF\u8BFB\u53D6"],
    "checks.unknownHttp": ["Unknown HTTP request state", "\u672A\u77E5 HTTP \u8BF7\u6C42\u72B6\u6001"],
    "checks.storage": ["Persistent write / read / remove", "\u6301\u4E45\u5316\u5199\u5165\u3001\u8BFB\u53D6\u4E0E\u5220\u9664"],
    "checks.noStorage": ["Persistent storage (no private data directory)", "\u6301\u4E45\u5316\u5B58\u50A8\uFF08\u65E0\u79C1\u6709\u6570\u636E\u76EE\u5F55\uFF09"],
    "checks.content": ["Full upstream content / sprite animation / native visual parity", "\u5B8C\u6574\u539F\u4F5C\u5185\u5BB9\u3001\u7CBE\u7075\u52A8\u753B\u4E0E\u539F\u751F\u89C6\u89C9\u5BF9\u9F50"],
    "checks.apis": ["Audio / native physics: API gaps", "\u97F3\u9891\u4E0E\u539F\u751F\u7269\u7406\uFF1A\u63A5\u53E3\u5C1A\u7F3A"],
    "checks.platforms": ["Lua gameplay / other platforms / hot reload", "Lua \u73A9\u6CD5\u3001\u5176\u4ED6\u5E73\u53F0\u4E0E\u70ED\u91CD\u8F7D"],
    "checks.line": ["{status}  {name}", "{status}  {name}"],
    "network.idle": ["HTTP: NOT_RUN (use the network check button)", "HTTP: NOT_RUN\uFF08\u8BF7\u70B9\u51FB\u7F51\u7EDC\u68C0\u67E5\u6309\u94AE\uFF09"],
    "network.pending": ["HTTP: PENDING (GET + POST to httpbin.org)", "HTTP: PENDING\uFF08\u5411 httpbin.org \u53D1\u8D77 GET \u548C POST \u8BF7\u6C42\uFF09"],
    "network.unknown": ["unknown request", "\u672A\u77E5\u8BF7\u6C42"],
    "network.result": ["{status} {method} {detail}", "{status} {method} {detail}"]
  };
  function normalizeLanguage(value) {
    return value === "zh-CN" || value === "zh" ? "zh-CN" : "en";
  }
  function message(key, parameters) {
    return { key, parameters };
  }
  function translate(language, key, parameters = {}) {
    return messages[key][language === "zh-CN" ? 1 : 0].replace(/\{(\w+)\}/g, (placeholder, name) => {
      const value = parameters[name];
      return value === void 0 ? placeholder : typeof value === "object" ? renderMessage(language, value) : `${value}`;
    });
  }
  function renderMessage(language, value) {
    return translate(language, value.key, value.parameters);
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
      reducedMotion: false,
      language: "en"
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
      reducedMotion: data.reducedMotion,
      language: normalizeLanguage(data.language)
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

  // modules/ember-arena/game/assets/fonts/noto-sans-sc-metrics.json
  var noto_sans_sc_metrics_default = { "0": 0.555, "1": 0.555, "2": 0.555, "3": 0.555, "4": 0.555, "5": 0.555, "6": 0.555, "7": 0.555, "8": 0.555, "9": 0.555, " ": 0.224, "!": 0.323, '"': 0.474, "#": 0.555, $: 0.555, "%": 0.921, "&": 0.68, "'": 0.278, "(": 0.338, ")": 0.338, "*": 0.467, "+": 0.555, ",": 0.278, "-": 0.347, ".": 0.278, "/": 0.392, ":": 0.278, ";": 0.278, "<": 0.555, "=": 0.555, ">": 0.555, "?": 0.474, "@": 0.946, A: 0.608, B: 0.657, C: 0.638, D: 0.688, E: 0.589, F: 0.552, G: 0.689, H: 0.728, I: 0.293, J: 0.535, K: 0.646, L: 0.543, M: 0.812, N: 0.723, O: 0.742, P: 0.633, Q: 0.742, R: 0.635, S: 0.596, T: 0.599, U: 0.721, V: 0.575, W: 0.878, X: 0.573, Y: 0.531, Z: 0.603, "[": 0.338, "\\": 0.392, "]": 0.338, "^": 0.555, _: 0.559, "`": 0.606, a: 0.563, b: 0.618, c: 0.51, d: 0.62, e: 0.554, f: 0.325, g: 0.564, h: 0.607, i: 0.275, j: 0.275, k: 0.552, l: 0.284, m: 0.926, n: 0.61, o: 0.606, p: 0.62, q: 0.62, r: 0.388, s: 0.468, t: 0.377, u: 0.607, v: 0.521, w: 0.802, x: 0.498, y: 0.521, z: 0.475, "{": 0.338, "|": 0.27, "}": 0.338, "~": 0.555, \u7834: 1, \u788E: 1, \u7684: 1, \u50CF: 1, \u7D20: 1, \u5730: 1, \u7262: 1, \u7B80: 1, \u4F53: 1, \u4E2D: 1, \u6587: 1, \u8FDB: 1, \u5165: 1, \u652F: 1, \u6301: 1, \u6E38: 1, \u620F: 1, \u6392: 1, \u884C: 1, \u699C: 1, \u65E5: 1, \u5FD7: 1, \u65B0: 1, \u95FB: 1, \u8BBE: 1, \u7F6E: 1, \u66F4: 1, \u8BB0: 1, \u5F55: 1, \u5173: 1, \u4E8E: 1, \u4E3B: 1, \u83DC: 1, \u5355: 1, \u5F00: 1, \u59CB: 1, \u95ED: 1, \u8FD4: 1, \u56DE: 1, \u4E0B: 1, \u4E00: 1, \u9875: 1, \u662F: 1, \u5426: 1, \u9009: 1, \u62E9: 1, \u4F60: 1, \u82F1: 1, \u96C4: 1, \u6218: 1, \u58EB: 1, \u6CD5: 1, \u5E08: 1, \u76D7: 1, \u8D3C: 1, \u5973: 1, \u730E: 1, \u624B: 1, \u575A: 1, \u97E7: 1, \u8FD1: 1, "\u3002": 1, \u521D: 1, \u6B66: 1, \u5668: 1, \u5F3A: 1, "\uFF0C": 1, \u5E76: 1, \u989D: 1, \u5916: 1, \u643A: 1, \u5E26: 1, \u74F6: 1, \u6CBB: 1, \u7597: 1, \u836F: 1, \u6C34: 1, \u6709: 1, \u53E4: 1, \u8001: 1, \u6756: 1, \u5B66: 1, \u8005: 1, \u5347: 1, \u7EA7: 1, \u5377: 1, \u8F74: 1, \u548C: 1, \u63A2: 1, \u64C5: 1, \u957F: 1, \u6F5C: 1, \u6597: 1, \u9690: 1, \u5F62: 1, \u7528: 1, \u53D1: 1, \u52A8: 1, \u4F0F: 1, \u51FB: 1, \u8352: 1, \u91CE: 1, \u7D22: 1, \u98DF: 1, \u7269: 1, \u6DB2: 1, \u706B: 1, \u5242: 1, \u5F13: 1, \u7BAD: 1, \u80FD: 1, \u529B: 1, \u5C1A: 1, \u672A: 1, \u5B9E: 1, \u73B0: 1, \u88C5: 1, \u5907: 1, \u4EF6: 1, \u4E8C: 1, \u9636: 1, \u6216: 1, \u9AD8: 1, \u4E14: 1, \u4E0D: 1, \u53D7: 1, \u5230: 1, \u91CF: 1, \u8DB3: 1, \u60E9: 1, \u7F5A: 1, \u5373: 1, \u53EF: 1, \u89E3: 1, \u9501: 1, \u51B3: 1, \u5BB6: 1, \u5F7B: 1, \u5E95: 1, \u51C0: 1, \u5316: 1, \u4EFB: 1, \u610F: 1, \u8BC5: 1, \u5492: 1, \u4E0A: 1, \u7267: 1, \u751F: 1, \u547D: 1, "\uFF1A": 1, \u7ECF: 1, \u9A8C: 1, \u91D1: 1, \u5E01: 1, \u5C5E: 1, \u6027: 1, \u5929: 1, \u8D4B: 1, \u80CC: 1, \u5305: 1, \u9605: 1, \u8BFB: 1, \u996E: 1, \u6062: 1, \u590D: 1, \u6E05: 1, \u9664: 1, \u8150: 1, \u8680: 1, \u9ECF: 1, \u6D88: 1, \u8017: 1, \u5408: 1, \u6E29: 1, \u6696: 1, \u800C: 1, \u8212: 1, \u7F13: 1, \u6D41: 1, \u904D: 1, \u5168: 1, \u8EAB: 1, \u5BF9: 1, \u9644: 1, \u89C1: 1, \u654C: 1, \u4EBA: 1, \u9020: 1, \u6210: 1, \u70B9: 1, \u4F24: 1, \u5BB3: 1, \u88C2: 1, \u4E3A: 1, \u718A: 1, \u70C8: 1, \u7130: 1, "\uFF01": 1, \u4F7F: 1, \u653B: 1, \u4F1A: 1, \u4ECE: 1, \u89C6: 1, \u5931: 1, \u4E86: 1, \u51C6: 1, \u6C38: 1, \u4E45: 1, \u589E: 1, \u52A0: 1, \u6D8C: 1, \u808C: 1, \u8089: 1, \u6B21: 1, \u7B26: 1, \u878D: 1, \u63ED: 1, \u793A: 1, \u672C: 1, \u5C42: 1, \u4F46: 1, \u5176: 1, \u5E03: 1, \u5C40: 1, \u5728: 1, \u8111: 1, \u6D77: 1, \u6670: 1, \u8D77: 1, \u6765: 1, \u53E3: 1, \u7CAE: 1, \u9965: 1, \u997F: 1, \u5403: 1, \u611F: 1, \u6E10: 1, \u9000: 1, \u9F20: 1, \u8C7A: 1, \u72FC: 1, \u4FA6: 1, \u5BDF: 1, \u5175: 1, \u9053: 1, \u8783: 1, \u87F9: 1, \u7C98: 1, \u5495: 1, \u6781: 1, \u5EA6: 1, \u663E: 1, \u754C: 1, \u9762: 1, \u8F93: 1, \u6570: 1, \u636E: 1, \u97F3: 1, \u9891: 1, \u8BED: 1, \u8A00: 1, \u6BD4: 1, \u4F8B: 1, \u6A2A: 1, \u5C4F: 1, \u7AD6: 1, \u64CD: 1, \u4F5C: 1, \u63D0: 1, \u51CF: 1, \u5C11: 1, \u6001: 1, \u6548: 1, \u679C: 1, \u6307: 1, \u9488: 1, \u7075: 1, \u654F: 1, \u500D: 1, \u65B9: 1, \u5411: 1, \u952E: 1, \u79FB: 1, \u7A7A: 1, \u683C: 1, \u7B49: 1, \u5F85: 1, \u6700: 1, \u5206: 1, \u80DC: 1, \u5229: 1, \u5192: 1, \u9669: 1, \u968F: 1, \u673A: 1, \u79CD: 1, \u5B50: 1, \u4FDD: 1, \u5B58: 1, \u8981: 1, \u5DF2: 1, \u5417: 1, "\uFF1F": 1, \u4E50: 1, \u7ACB: 1, \u6863: 1, "\uFF08": 1, "\uFF09": 1, \u4ECD: 1, \u8BDD: 1, \u6B63: 1, \u5E38: 1, \u73A9: 1, \u517C: 1, \u5BB9: 1, \u8986: 1, \u76D6: 1, \u8BE5: 1, \u8D25: 1, \u4EE5: 1, \u91CD: 1, \u8BD5: 1, \u539F: 1, \u7559: 1, \u5F53: 1, \u524D: 1, \u5F71: 1, \u54CD: 1, \u6B7B: 1, "\u2026": 1, \u9996: 1, \u9886: 1, \u88AB: 1, \u7ED3: 1, \u675F: 1, \u6DF1: 1, \u5357: 1, \u6536: 1, \u96C6: 1, \u54C1: 1, \u70BC: 1, \u672F: 1, \u81EA: 1, \u5236: 1, \u906D: 1, \u9047: 1, \u4E0E: 1, \u6750: 1, \u57FA: 1, \u521B: 1, \u8FD0: 1, \u65F6: 1, \u690D: 1, \u7248: 1, \u7531: 1, \u6B22: 1, \u8FCE: 1, \u6BCF: 1, \u627E: 1, \u697C: 1, \u68AF: 1, \u540E: 1, \u6361: 1, \u679A: 1, \u6389: 1, \u843D: 1, \u9AB7: 1, \u9AC5: 1, \u94A5: 1, \u5319: 1, \u7406: 1, \u9650: 1, \u8EB2: 1, \u7EE7: 1, \u7EED: 1, \u81A8: 1, \u80C0: 1, \u5FEB: 1, \u79BB: 1, \u5B83: 1, \u8303: 1, \u56F4: 1, \u84C4: 1, \u64A4: 1, \u7206: 1, \u6253: 1, \u95E8: 1, \u8BF7: 1, \u7AD9: 1, \u518D: 1, \u6321: 1, \u4F4F: 1, \u53BB: 1, \u8DEF: 1, \u5148: 1, \u7B2C: 1, \u5DE2: 1, \u7A74: 1, \u68C0: 1, \u67E5: 1, \u6240: 1, "\u3001": 1, \u53CD: 1, \u5C04: 1, \u7EC4: 1, \u8BE2: 1, \u62D2: 1, \u7EDD: 1, \u65E0: 1, \u503C: 1, \u7EF4: 1, \u7CBE: 1, \u5B57: 1, \u53D8: 1, \u6362: 1, \u76F8: 1, \u5207: 1, \u9500: 1, \u6BC1: 1, \u6821: 1, \u8282: 1, \u76D8: 1, \u89E6: 1, \u6478: 1, \u5B89: 1, \u533A: 1, \u57DF: 1, \u53D6: 1, \u77E5: 1, \u6C42: 1, \u72B6: 1, \u5199: 1, \u5220: 1, \u50A8: 1, \u79C1: 1, \u76EE: 1, \u5B8C: 1, \u6574: 1, \u5185: 1, \u753B: 1, \u89C9: 1, \u9F50: 1, \u63A5: 1, \u7F3A: 1, \u4ED6: 1, \u5E73: 1, \u53F0: 1, \u70ED: 1, \u8F7D: 1, \u7F51: 1, \u7EDC: 1, \u6309: 1, \u94AE: 1 };

  // modules/ember-arena/game/src/text-layout.ts
  var hasCjk = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
  function fontForText(language, value) {
    return language === "zh-CN" || hasCjk.test(value) ? "fonts/noto-sans-sc.otf" : "fonts/spd-pixel.ttf";
  }
  function measureText(language, value, size) {
    const advances = fontForText(language, value) === "fonts/spd-pixel.ttf" ? spd_pixel_metrics_default : noto_sans_sc_metrics_default;
    let width = 0;
    for (const glyph of value) width += (advances[glyph] ?? (hasCjk.test(glyph) ? 1 : advances["?"])) * size;
    return width;
  }
  function wrapText(language, value, width, size) {
    if (width <= 0 || size <= 0) return [value];
    const layoutLanguage = fontForText(language, value) === "fonts/noto-sans-sc.otf" ? "zh-CN" : language;
    const lines = [];
    for (const paragraph of value.split("\n")) {
      let line = "", space = false;
      const tokens = paragraph.match(/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]|[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]+|\s+/gu) ?? [];
      for (const token of tokens) {
        if (/^\s+$/u.test(token)) {
          space = line.length > 0;
          continue;
        }
        const next = line + (space ? " " : "") + token;
        space = false;
        if (measureText(layoutLanguage, next, size) <= width) {
          line = next;
          continue;
        }
        if (line.length > 1 && /^[，。！？、：；）】》」』…]/u.test(token)) {
          const glyphs = [...line], last = glyphs.pop();
          lines.push(glyphs.join("").trimEnd());
          line = last + token;
          continue;
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        for (const glyph of token) {
          if (line && measureText(layoutLanguage, line + glyph, size) > width) {
            lines.push(line);
            line = "";
          }
          line += glyph;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // modules/ember-arena/game/src/spd-ui.ts
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
  function renderSpdUi(state, on) {
    const language = state.profile.language;
    const t = (key, parameters) => translate(language, key, parameters);
    const textWidth = (value, size) => measureText(language, value, size);
    const wrappedText = (value, width, size) => wrapText(language, value, width, size);
    const m = uiMetrics(), s = m.scale, w = m.width, h = m.height;
    const elements = [];
    const rect = (x, y, width, height) => ({ position: "absolute", left: Math.round(x * s), top: Math.round(y * s), width: Math.round(width * s), height: Math.round(height * s) });
    function label(id, value, x, y, width, size = 8, color = white, height = size * 1.5) {
      return text(id, value, { font: fontForText(language, value), fontSize: size * s, color, style: rect(x, y, width, height) });
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
      const iconWidth = icon ? uiFrames[icon]?.rect[2] ?? 14 : 0;
      size = value ? Math.min(size, size * Math.max(1, width - iconWidth - (icon ? 6 : 4)) / textWidth(value, size)) : size;
      const labelWidth = textWidth(value, size);
      const groupWidth = labelWidth + (icon ? iconWidth + (value ? 2 : 0) : 0), groupLeft = (width - groupWidth) / 2;
      if (icon) children.push(art(`${id}_icon`, icon, groupLeft, (height - (uiFrames[icon]?.rect[3] ?? 14)) / 2));
      if (value) children.push(text(`${id}__label`, value, {
        font: fontForText(language, value),
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
      if (language === "en") elements.push(art("spd_banner", land ? "title_land" : "title_port", (w - bannerW) / 2, 2 + (top - bannerH) / 2));
      else {
        const title = t(land ? "title.name" : "title.portrait");
        const titleWidth = Math.max(...title.split("\n").map((line) => textWidth(line, 18)));
        elements.push(label("spd_banner", title, (w - titleWidth) / 2, 2 + (top - (land ? 24 : 48)) / 2, titleWidth + 1, 18, titleColor, 54));
      }
      const area = land ? 234 : 133, left = (w - area) / 2;
      const gap = Math.max(2, Math.floor((h - top - (land ? 3 : 4) * 20) / 3 / (land ? 3 : 5)));
      const y = top + gap;
      if (land) {
        elements.push(control("start", t("menu.start"), left, y, area / 2 - 1, 20, "toast", "enter"));
        elements.push(control("support", t("menu.support"), left + area / 2 + 1, y, area / 2 - 1, 20, "toast", "support"));
        for (const [index, id] of ["rankings", "journal", "news", "settings", "changes", "about"].entries()) {
          const cw = Math.floor(area / 3) - 1;
          elements.push(control(id, t(`menu.${id}`), left + index % 3 * (cw + 2), y + (1 + Math.floor(index / 3)) * (20 + gap), cw, 20, "toast", id));
        }
      } else {
        elements.push(control("start", t("menu.start"), left, y, area, 20, "toast", "enter"));
        elements.push(control("support", t("menu.support"), left, y + 20 + gap, area, 20, "toast", "support"));
        for (const [index, id] of ["rankings", "journal", "news", "changes", "settings", "about"].entries()) {
          elements.push(control(id, t(`menu.${id}`), left + index % 2 * (area / 2 + 1), y + (2 + Math.floor(index / 2)) * (20 + gap), area / 2 - 1, 20, "toast", id));
        }
      }
      elements.push(label("version", "v0.1.0", w - 26, h - 8, 24, 5, grey));
      elements.push(iconControl("exit", "exit", w - 20, 0));
    }
    function heroScreen() {
      titleBackground();
      const heroName = t(`hero.${state.selectedClass}.name`);
      const leftArea = m.landscape ? Math.max(100, w / 3) : w;
      const backgroundWidth = h * 800 / 450;
      const backgroundLeft = (w - backgroundWidth) / 2 + (m.landscape ? leftArea / 6 : 0);
      elements.push(image("hero_splash", `sprites/spd/${state.selectedClass}.jpg`, { ...rect(backgroundLeft, 0, backgroundWidth, h), imageMode: "stretch" }));
      if (m.landscape) elements.push(art("hero_text_shade", "hero_fade", 0, 0, leftArea + 8, h));
      const uiHeight = Math.min(h - 20, 300), uiTop = (h - uiHeight) / 2;
      const spacing = (uiHeight - 120) / 2 - (uiHeight >= 160 ? 5 : 0) - (uiHeight >= 180 ? 6 : 0);
      if (m.landscape) elements.push(label("hero_select_title", t("hero.choose"), (leftArea - 110) / 2, uiTop, 110, 12, titleColor));
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
      const nameWidth = textWidth(heroName, 9), nameLeft = (leftArea - nameWidth - 20) / 2;
      if (m.landscape) elements.push(label("hero_class_label", heroName, nameLeft, nameY, nameWidth + 4, 9, titleColor));
      if (m.landscape) elements.push(label("hero_description", wrappedText(t(`hero.${state.selectedClass}.description`), 80, 6).join("\n"), (leftArea - 80) / 2, nameY + 16, 80, 6, white, 56));
      elements.push(control("begin_run", m.landscape ? t("common.start") : heroName, m.landscape ? (leftArea - 64) / 2 : (w - 64) / 2, m.landscape ? uiTop + uiHeight - 21 : h - 43, 64, 21, "toast", "enter"));
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
      const children = [label("bag_title", t("bag.title"), 0, 2, width - 25, 8, titleColor), image("bag_gold", "sprites/dungeon/gold.png", rect(width - 15, 0, 12, 12)), label("bag_gold_count", `${state.gold}`, width - 38, 3, 23, 6, titleColor)];
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
      const levelText = large ? t("hud.level", { level: state.level }) : `${state.level}`;
      elements.push(label("hud_level", levelText, large ? (30 - textWidth(levelText, 6)) / 2 : 25.5 - textWidth(levelText, 6) / 2, large ? 30 : 28, 30, 6, [1, 1, 170 / 255, 1]));
      elements.push({ kind: "button", id: "hero_info", onClick: () => on("hero_info"), style: rect(0, 0, 30, 36), children: [] });
      elements.push({ kind: "button", id: "hero_info_bar", onClick: () => on("hero_info"), style: large ? rect(30, 19, 130, 20) : rect(30, 0, 50, 9), children: [] });
      elements.push(art("menu_pane", "menu_pane", w - 31, 0));
      elements.push(label("hud_version", "v0.1.0", w - 28, 1, 27, 5, grey));
      elements.push({ kind: "button", id: "pause", onClick: () => on("pause"), style: rect(w - 16, 0, 16, 21), children: [art("menu_icon", "menu", 2, 8)] });
      elements.push({ kind: "button", id: "game_journal", onClick: () => on("game_journal"), style: rect(w - 31, 0, 17, 21), children: [art("journal_button", "journal_button", 2, 8), art("journal_button_icon", "journal_button_icon", 3, 10.5)] });
      elements.push(art("hud_stairs", "stairs", w - 38, 8, 7, 8));
      elements.push(label("hud_wave", `${state.depth}`, w - 38, 16, 7, 4));
      if (state.hunger !== "satiated") elements.push(label("hud_hunger", state.hunger === "starving" ? t("hud.starving") : t("hud.hungry"), large ? 32 : 33, large ? 4 : 10, 80, 6, titleColor));
      if (state.invisible) elements.push(label("hud_invisible", t("hud.invisible"), 33, large ? 10 : 18, 70, 6, titleColor));
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
      const logWidth = Math.max(90, w - 90);
      const logLines = state.logs.slice(0, 3).reverse().map((entry) => wrappedText(entry, logWidth, 6));
      const logHeights = logLines.map((lines) => Math.max(10, Math.ceil(lines.length * 7.2) + 2));
      let logY = h - 32 - logHeights.reduce((sum, height) => sum + height, 0);
      logLines.forEach((lines, index) => {
        elements.push(label(`log_line_${index}`, lines.join("\n"), 2, logY, logWidth, 6, index === logLines.length - 1 ? white : grey, logHeights[index]));
        logY += logHeights[index];
      });
      if (state.bossHealth !== null) elements.push(node("boss_panel", rect((w - 100) / 2, 2, 100, 10), [
        node("boss_track", { ...rect(0, 5, 100, 3), background: [0.1, 0.03, 0.03, 1] }),
        node("boss_fill", { ...rect(0, 5, Math.max(0, state.bossHealth), 3), background: [0.65, 0.05, 0.04, 1] }),
        label("boss_label", t("monster.boss"), 0, -2, 100, 6, titleColor)
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
      control("settings", t("menu.settings"), 0, 0, 120, 20, "red", "settings"),
      control("home", t("menu.home"), 0, 22, 120, 20, "red", "display")
    ]);
    else if (state.phase === "inventory" || state.phase === "item") {
      const bag = inventoryContent();
      window("bag_window", bag.width, bag.height, bag.children);
      if (state.phase === "item") {
        const def = itemCatalog[state.item];
        const lines = wrappedText(t(`item.${state.item}.description`), 120, 6), descriptionHeight = Math.ceil(lines.length * 7.2);
        const buttonY = 20 + descriptionHeight;
        window("item_window", 120, buttonY + 16, [
          image("item_detail_icon", `sprites/dungeon/${state.item}.png`, rect(0, 0, 16, 16)),
          label("item_detail_title", t(`item.${state.item}.name`), 20, 1, 100, 9, titleColor, 26),
          label("item_detail_desc", lines.join("\n"), 0, 18, 120, 6, white, descriptionHeight),
          control(`use_${state.item}`, def.category === "food" ? t("item.eat") : def.category === "scroll" ? t("item.read") : t("item.drink"), 0, buttonY, 120, 16, "red", void 0, `use_${state.item}`, true, 8)
        ]);
      }
    } else if (state.phase === "hero") {
      window("hero_window", 120, 126, [
        art("hero_detail_icon", `avatar_${state.selectedClass}`, 0, 0, 22, 30),
        label("hero_detail_title", t("hero.level", { level: state.level, hero: t(`hero.${state.selectedClass}.name`) }), 28, 4, 92, 9, titleColor, 22),
        label("hero_stats", t("hero.stats", { health: Math.ceil(state.health), maxHealth: state.maxHealth, strength: state.strength, experience: state.experience, target: state.targetExperience, gold: state.gold }), 0, 34, 120, 8, white, 60),
        control("hero_stats_tab", t("hero.statsTab"), 0, 108, 58, 16, "grey"),
        control("hero_talents_tab", t("hero.talents"), 60, 108, 60, 16, "toast", void 0, "hero_talents_tab", false)
      ]);
    } else if (state.phase === "settings") {
      const width = m.landscape ? 223 : 122, height = Math.min(156, h - 36), content = [];
      const headings = ["settings.display", "settings.ui", "settings.input", "settings.data", "settings.audio", "settings.language"];
      content.push(label("settings_title", t(headings[state.settingsTab]), 0, 0, width, 9, titleColor));
      const names = ["display", "settings", "input", "data", "audio", "langs"];
      names.forEach((name, index) => content.push(control(`settings_tab_${index}`, "", index * (width / 6), height - 18, width / 6 - 1, 18, state.settingsTab === index ? "grey" : "toast", name, `tab:${index}`)));
      if (state.settingsTab === 0) {
        content.push(label("display_scale_label", t("settings.scale"), 0, 22, width, 8));
        content.push(control("window_landscape", t("settings.landscape"), 0, 38, width, 18));
        content.push(control("window_portrait", t("settings.portrait"), 0, 58, width, 18));
      } else if (state.settingsTab === 1) {
        content.push(control("hints", t("settings.hints", { value: t(state.profile.showHints ? "common.on" : "common.off") }), 0, 24, width, 18, "grey"));
        content.push(control("motion", t("settings.motion", { value: t(state.profile.reducedMotion ? "common.on" : "common.off") }), 0, 45, width, 18, "grey"));
      } else if (state.settingsTab === 2) {
        content.push(control("sensitivity", t("settings.sensitivity", { value: state.profile.sensitivity.toFixed(2) }), 0, 24, width, 18, "grey"));
        content.push(label("input_bindings", t("settings.bindings"), 0, 49, width, 7, white, 50));
      } else if (state.settingsTab === 3) {
        content.push(label("saved_stats", t("settings.stats", { best: state.profile.bestScore, wins: state.profile.wins, runs: state.profile.runs }), 0, 18, width, 7, white, 24));
        content.push(label("save_notice", state.saveNotice || t("save.device"), 0, 43, width, 6, grey, 25));
        content.push(control("seed", t("settings.seed", { seed: state.profile.seed }), 0, 71, width, 16, "grey"));
        content.push(control("retry_save", t("settings.save"), 0, 90, width / 2 - 1, 16));
        content.push(control("reset_save", t("settings.clear"), width / 2 + 1, 90, width / 2 - 1, 16));
      } else if (state.settingsTab === 4) {
        content.push(label("audio_music", t("settings.music"), 0, 26, width, 8, grey), label("audio_sfx", t("settings.sfx"), 0, 62, width, 8, grey));
        content.push(node("music_slider", { ...rect(0, 43, width, 3), background: [0.3, 0.3, 0.3, 1] }), node("sfx_slider", { ...rect(0, 79, width, 3), background: [0.3, 0.3, 0.3, 1] }));
      } else {
        content.push(control("language_english", language === "en" ? `${t("language.en")} (${t("settings.current")})` : t("language.en"), 0, 24, width, 20, language === "en" ? "grey" : "red"));
        content.push(control("language_chinese", language === "zh-CN" ? `${t("language.zh-CN")}\uFF08${t("settings.current")}\uFF09` : t("language.zh-CN"), 0, 48, width, 20, language === "zh-CN" ? "grey" : "red"));
        content.push(label("language_hint", wrappedText(t("settings.languageHint"), width, 6).join("\n"), 0, 76, width, 6, grey, 30));
      }
      window("settings_window", width, height, content);
      if (state.resetPending) window("reset_window", 120, 60, [label("reset_warning", t("settings.reset"), 0, 0, 120, 8, titleColor, 22), control("confirm_reset", t("common.yes"), 0, 40, 59, 18), control("cancel_reset", t("common.no"), 61, 40, 59, 18)]);
    } else if (state.phase === "won" || state.phase === "lost") {
      if (language === "en") elements.push(art("result_banner", state.phase === "won" ? "boss_slain" : "game_over", (w - 128) / 2, h * 0.12));
      else {
        const title = t(state.phase === "won" ? "result.bannerWin" : "result.bannerLose"), width = textWidth(title, 16);
        elements.push(label("result_banner", title, (w - width) / 2, h * 0.12, width + 1, 16, titleColor, 24));
      }
      window("result_window", 120, 88, [
        label("result_title", state.phase === "won" ? t("result.win") : t("result.lose"), 0, 0, 120, 9, titleColor),
        label("result_stats", t("result.stats", { score: state.score, depth: state.depth, level: state.level }), 0, 18, 120, 7, white, 26),
        control("restart", t("result.restart"), 0, 46, 120, 20, "red", "enter"),
        control("home", t("menu.home"), 0, 68, 120, 20, "red", "display")
      ], true, h * 0.66);
    } else if (state.phase === "checks") {
      const lines = state.checks.slice(state.checkPage * 6, state.checkPage * 6 + 6);
      window("checks_window", 190, 146, [
        label("checks_title", t("checks.title"), 0, 0, 190, 9, titleColor),
        ...lines.map((line, index) => label(`check_${index}`, line, 0, 16 + index * 13, 190, 6, white, 12)),
        label("network_status", state.networkStatus, 0, 96, 190, 6, grey, 18),
        control("check_page", t("common.next"), 0, 124, 60, 18),
        control("network", "HTTP", 64, 124, 60, 18),
        control("back", t("common.back"), 128, 124, 60, 18)
      ]);
    } else if (menuPhases.includes(state.phase) && state.phase !== "menu") {
      const page = state.phase;
      window(`${page}_window`, 170, 132, [label(`${page}_title`, t(`menu.${page}`), 0, 0, 170, 9, titleColor), label(`${page}_content`, t(`page.${page}`, { best: state.profile.bestScore, runs: state.profile.runs, wins: state.profile.wins }), 0, 18, 170, 7, white, 94), control("back", t("common.close"), 0, 114, 170, 18)]);
    }
    return node("safe_root", { position: "absolute", left: m.left, top: m.top, width: Math.round(w * s), height: Math.round(h * s) }, elements);
  }

  // modules/ember-arena/game/src/ember-arena.ts
  var callbacks = globalThis;
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
  var networkStatus = message("network.idle");
  var networkLines = [];
  var checks = [];
  var profile = defaultProfile();
  var saveNotice = null;
  var saveBlocked = false;
  var resetPending = false;
  var settingsReturn = "menu";
  var runRecorded = false;
  var random = seededRandom(profile.seed);
  var checkPage = 0;
  var selectedItem = "potion_healing";
  var settingsTab = 0;
  var overlayReturn = "playing";
  var uiNotice = null;
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
    saveNotice = null;
    profile = defaultProfile();
    const result = storage_read("profile");
    if (result.state === "error") {
      saveNotice = message("save.unavailable", { error: result.error });
      saveBlocked = result.error === "invalid_data" || result.error === "too_large";
    } else if (result.state === "ok") {
      try {
        profile = parseProfile(result.value);
      } catch {
        saveBlocked = true;
        saveNotice = message("save.incompatible");
      }
    }
  }
  function persistProfile() {
    if (saveBlocked) return;
    const result = storage_write("profile", JSON.stringify(profile));
    saveNotice = result.state === "ok" ? message("save.saved") : message("save.failed", { error: result.error });
  }
  function openSettings() {
    settingsReturn = phase === "paused" ? "playing" : phase;
    resetPending = false;
    setPhase("settings");
  }
  function resetProfile() {
    const result = storage_remove("profile");
    if (result.state === "error") {
      saveNotice = message("save.resetFailed", { error: result.error });
    } else {
      profile = defaultProfile();
      saveBlocked = false;
      saveNotice = message("save.reset");
    }
    resetPending = false;
    drawUi();
  }
  function drawUi() {
    const pointer = input_primary_pointer(), safe = window_safe_area(), metrics = window_metrics();
    if (metrics.width <= 0 || metrics.height <= 0) return;
    viewport = `${pointer.viewportWidth}:${pointer.viewportHeight}:${safe.leftInset}:${safe.rightInset}:${safe.topInset}:${safe.bottomInset}:${metrics.width}:${metrics.height}`;
    const localized = (value) => renderMessage(profile.language, value);
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
      logs: dungeonLogs.map(localized),
      profile,
      settingsTab,
      gameBehind: phase === "settings" ? !["menu", "heroes"].includes(settingsReturn) : phase === "journal" ? overlayReturn !== "menu" : ["hero", "message"].includes(phase) ? overlayReturn !== "heroes" : true,
      saveNotice: saveNotice ? localized(saveNotice) : "",
      resetPending,
      checks: checks.map(localized),
      checkPage,
      networkStatus: networkLines.length ? networkLines.map(localized).join("\n") : localized(networkStatus),
      notice: uiNotice ? localized(uiNotice) : ""
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
        uiNotice = hero === "duelist" ? message("hero.unlockDuelist") : message("hero.unlockCleric");
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
      case "language_english":
        profile.language = "en";
        break;
      case "language_chinese":
        profile.language = "zh-CN";
        break;
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
    dungeonLogs = [message("log.welcome", { hero: message(`hero.${selectedClass}.name`) }), message("log.guide")];
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
        pushLog(message("log.item", { item: message(`item.${item}.name`) }));
      } else {
        const coins = 3 + Math.floor(random() * 8);
        gold += coins;
        pushLog(message("log.gold", { gold: coins }));
      }
      scene_despawn(id);
    }
  }
  function useInventoryItem(kindKey) {
    if (phase !== "playing" && phase !== "inventory" || inventory[kindKey] <= 0) return false;
    inventory[kindKey]--;
    pushLog(message(`item.${kindKey}.effect`));
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
    pushLog(message("log.defeated", { monster: message(`monster.${type}`) }));
    if (type === "boss") {
      pushLog(message("log.sewersCleared"));
      setPhase("won");
      return;
    }
    if (random() < 0.5) spawnLoot(point);
    while (experience >= targetExperience()) {
      experience -= targetExperience();
      level++;
      maxHealth += 5;
      change("player", "health", Math.min(maxHealth, health() + 5));
      pushLog(message("log.level", { level }));
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
      pushLog(message(surprised ? "log.surprise" : "log.hit", { monster: message(`monster.${type}`), damage: power }));
      damageMonster(id, power);
    } else pushLog(message("log.enemyDodged", { monster: message(`monster.${type}`) }));
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
            pushLog(message("log.gooSwells"));
            continue;
          }
          const enraged2 = field(id, "health") <= 50;
          if (!charged && random() < (enraged2 ? 0.5 : 0.2)) {
            change(id, "power", 1);
            pushLog(message("log.gooCharging"));
            continue;
          }
        }
        const enraged = type === "boss" && field(id, "health") <= 50;
        const attack = (enraged ? 15 : spec.attack) * (charged ? 2 : 1);
        if (random() * attack >= random() * (4 + level)) {
          const max = enraged ? 12 : spec.maxDamage;
          const power = Math.max(0, roll(spec.minDamage * (charged ? 3 : 1), max * (charged ? 3 : 1)) - roll(0, 2));
          pushLog(message(charged ? "log.enemyBurst" : "log.enemyHit", { monster: message(`monster.${type}`), damage: power }));
          hurtPlayer(power);
          if (type === "boss" && random() < 1 / 3) causticOozeTimer = 5;
        } else pushLog(message("log.dodged", { monster: message(`monster.${type}`) }));
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
      pushLog(message("log.door"));
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
      pushLog(message("log.stairs"));
      drawUi();
      return;
    }
    if (depth === 5) {
      pushLog(message("log.gooBlocks"));
      drawUi();
      return;
    }
    depth++;
    turns++;
    change("player", "lifetime", turns);
    hungerTimer++;
    pushLog(message(depth === 5 ? "log.lair" : "log.descend", { depth }));
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
        checks.push(message("checks.line", { status: run() ? "PASS" : "FAIL", name: message(name) }));
      } catch {
        checks.push(message("checks.line", { status: "FAIL", name: message(name) }));
      }
    };
    check("checks.entity", () => {
      scene_spawn("probe", 0, 0, 0);
      scene_actor_set("probe", "probe", 5, 1, 0.3);
      actor("probe").set("health", 3);
      const reference = scene_transform("probe").get("translation");
      reference.set("x", 2);
      return field("probe", "health") === 3 && position("probe").x === 2 && scene_actor_ids().includes("probe");
    });
    check(
      "checks.values",
      () => !scene_actor_set("missing", "probe", 1, 1, 1) && !scene_set_transform_3d("probe", 0, 0, 0, 0, 0, 0, -1) && !scene_set_model("probe", "../forbidden.glb") && !window_set_size(NaN, 100)
    );
    check("checks.scene", () => {
      const sprite2 = scene_set_sprite("probe", "sprites/settings-icon.png", 32, 32);
      const label = scene_set_text("probe", "2D probe", 16, 1, 1, 1, 1, "center");
      const transformed = scene_set_transform("probe", 4, 2, 1) && position("probe").x === 4;
      const camera = scene_set_3d_enabled(true) && scene_set_3d_enabled(false);
      return sprite2 && label && transformed && camera;
    });
    check("checks.despawn", () => scene_despawn("probe") && scene_actor("probe") == null && scene_transform("probe") == null);
    check("checks.ui", () => {
      ui_spawn("probe_ui", "", "node");
      ui_spawn("probe_child", "probe_ui", "text");
      ui_spawn("probe_image", "probe_ui", "image");
      const img = ui_set_image("probe_image", "sprites/settings-icon.png");
      const rejected = !ui_set_style("probe_ui", JSON.stringify({ unsupported: 1 }));
      return img && rejected && ui_despawn("probe_ui") && !ui_set_text("probe_child", "gone", 12, 1, 1, 1, 1);
    });
    check("checks.input", () => {
      input_key_pressed("KeyW");
      input_key_just_pressed("KeyW");
      input_key_just_released("KeyW");
      input_primary_touch();
      return window_safe_area().width > 0 && input_primary_pointer().viewportHeight > 0 && window_metrics().width > 0;
    });
    check("checks.unknownHttp", () => http_poll(2147483647).state === "unknown");
    const storage = storage_read("_acceptance_probe");
    if (storage.state === "error" && storage.error === "unavailable") checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.noStorage") }));
    else {
      check("checks.storage", () => {
        if (storage.state !== "missing") return false;
        const written = storage_write("_acceptance_probe", "ember-arena-probe");
        const read = storage_read("_acceptance_probe");
        const removed = storage_remove("_acceptance_probe");
        return written.state === "ok" && read.state === "ok" && read.value === "ember-arena-probe" && removed.state === "ok";
      });
    }
    checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.content") }));
    checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.apis") }));
    checks.push(message("checks.line", { status: "NOT_RUN", name: message("checks.platforms") }));
    setPhase("checks");
  }
  function checkNetwork() {
    if (networkRequests.length) return;
    networkStatus = message("network.pending");
    networkLines = [];
    networkRequests = [
      { id: http_get("https://httpbin.org/get"), method: "GET", elapsed: 0 },
      { id: http_post("https://httpbin.org/post", JSON.stringify({ game: "ember-arena", probe: true }), "application/json"), method: "POST", elapsed: 0 }
    ];
    drawUi();
  }
  function pollNetwork(dt) {
    let changed = false;
    for (const request of [...networkRequests]) {
      request.elapsed += dt;
      const result = http_poll(request.id);
      if (result.state === "pending") continue;
      networkRequests = networkRequests.filter((candidate) => candidate !== request);
      networkLines.push(message("network.result", {
        status: result.state === "complete" && result.status >= 200 && result.status < 300 ? "PASS" : "FAIL",
        method: request.method,
        detail: result.state === "complete" ? result.status : result.state === "error" ? result.error.slice(0, 90) : message("network.unknown")
      }));
      changed = true;
    }
    if (changed && phase === "checks") drawUi();
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
