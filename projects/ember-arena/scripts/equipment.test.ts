import assert from "node:assert/strict";
import { test } from "node:test";
import { armorRange, armorReduction, attackDelay, attackSkill, defenseSkill, equippedGear, gearDefinitions,
  moveDelay, startingEquipment, strengthRequired, timeAfter, weaponDamage, weaponRange, type GearItem } from "../modules/ember-arena/game/src/equipment.js";

// Normal, talent-free v4.0.2 fixtures: item classes, Weapon, MeleeWeapon,
// Armor, Hero and RingOfForce at revision 57a4e06a.
test("the four starting weapons use original damage ranges and glove speed", () => {
  for (const [hero, weapon, min, max, delay] of [
    ["warrior", "worn_shortsword", 1, 10, 1], ["mage", "mages_staff", 1, 6, 1],
    ["rogue", "dagger", 1, 8, 1], ["huntress", "gloves", 1, 5, 0.5],
  ] as const) {
    const items = startingEquipment(hero), item = equippedGear(items, "weapon")!;
    assert.equal(item.kind, weapon); assert.deepEqual(weaponRange(item), [min, max]);
    assert.equal(attackDelay(item, 10), delay); assert.equal(strengthRequired(item), 10);
    assert.deepEqual(armorRange(equippedGear(items, "armor")!), [0, 2]);
  }
  assert.equal(gearDefinitions.shortsword.image, 104);
  assert.equal(gearDefinitions.leather_armor.image, 177);
});

test("upgrades reduce required strength at the original triangular levels", () => {
  const item: GearItem = { id: 1, kind: "shortsword", level: 0, equipped: false };
  for (const [level, required, min, max] of [[0, 12, 2, 15], [1, 11, 3, 18], [3, 10, 5, 24], [6, 9, 8, 33], [10, 8, 12, 45]]) {
    item.level = level;
    assert.equal(strengthRequired(item), required); assert.deepEqual(weaponRange(item), [min, max]);
  }
  const gloves = startingEquipment("huntress")[0]!; gloves.level = 3;
  assert.deepEqual(weaponRange(gloves), [4, 8]);
});

test("heavy equipment penalizes accuracy, evasion and time until its requirements are met", () => {
  const sword: GearItem = { id: 1, kind: "shortsword", level: 0, equipped: true };
  const armor: GearItem = { id: 2, kind: "leather_armor", level: 0, equipped: true };
  assert.equal(attackSkill(sword, 10, 1), 4); assert.equal(defenseSkill(armor, 10, 1), 2);
  assert.equal(attackDelay(sword, 10), 1.44); assert.equal(moveDelay(armor, 10), 1.44);
  assert.equal(armorReduction(armor, 10, (_min, max) => max), 0);
  sword.level = armor.level = 3;
  assert.equal(attackSkill(sword, 10, 1), 10); assert.equal(defenseSkill(armor, 10, 1), 5);
  assert.equal(attackDelay(sword, 10), 1); assert.equal(moveDelay(armor, 10), 1);
});

test("armor upgrades change actual reduction and insufficient strength removes two points per deficit", () => {
  const armor = startingEquipment("warrior")[1]!;
  armor.level = 1; assert.deepEqual(armorRange(armor), [1, 3]);
  assert.equal(armorReduction(armor, 10, (min) => min), 1);
  assert.equal(armorReduction(armor, 10, (_min, max) => max), 3);
  armor.kind = "leather_armor";
  assert.deepEqual(armorRange(armor), [1, 6]);
  assert.equal(armorReduction(armor, 10, (_min, max) => max), 4);
  assert.equal(armorReduction(undefined, 10, () => { throw new Error("no armor roll expected"); }), 0);
});

test("dagger surprise damage and excess-strength damage use separate original roll ranges", () => {
  const dagger = startingEquipment("rogue")[0]!;
  assert.equal(weaponDamage(dagger, 10, false, (min) => min), 1);
  assert.equal(weaponDamage(dagger, 10, true, (min) => min), 6);
  dagger.level = 1;
  assert.equal(weaponDamage(dagger, 10, true, (min) => min), 8);
  assert.equal(weaponDamage(dagger, 10, true, (_min, max) => max), 11);
  assert.equal(weaponDamage(undefined, 10, false, (_min, max) => max), 2);
});

test("fractional action time accumulates without snapping half turns or propagating invalid delays", () => {
  let time = 0;
  for (let i = 0; i < 1024; i++) time = timeAfter(time, 0.5);
  assert.equal(time, 512); assert.equal(timeAfter(0.9995, 1), 2);
  assert.equal(timeAfter(1, 1.44), new Float32Array([2.44])[0]);
  assert.throws(() => timeAfter(Number.MAX_VALUE, 1), /invalid action time/);
  for (const delay of [0, -1, NaN, Infinity]) assert.throws(() => timeAfter(0, delay), /invalid action time/);
});
