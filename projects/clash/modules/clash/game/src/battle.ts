import { requestExit } from "../../api/app.js";
import { keyJustPressed, type PrimaryPointer } from "../../api/input.js";
import { clearScene, despawnSceneEntity, setGameState, setTransform } from "../../api/scene.js";
import { cards, DESIGN_HEIGHT, DESIGN_WIDTH, sprites, type CardDefinition } from "./config.js";
import { clamp, type ScreenLayout } from "./layout.js";
import { colors, placeSprite, placeText, pointerInside, spawnSprite, spawnText } from "./ui.js";

type Team = "blue" | "red";
type Lane = "left" | "right";
type TowerKind = "king" | "princess";
type Outcome = Team | "draw" | null;

interface Vec2 { x: number; y: number }

interface BattleUnit extends Vec2 {
  id: string;
  team: Team;
  lane: Lane;
  card: CardDefinition;
  hp: number;
  attackTimer: number;
}

interface Tower extends Vec2 {
  id: string;
  team: Team;
  kind: TowerKind;
  lane?: Lane;
  hp: number;
  maxHp: number;
  attackTimer: number;
  alive: boolean;
}

interface BattleLayout {
  scale: number;
  fieldLeft: number;
  fieldRight: number;
  fieldTop: number;
  fieldBottom: number;
  riverY: number;
  cardWidth: number;
  cardHeight: number;
  cardY: number;
  elixirY: number;
  settingsX: number;
  settingsY: number;
}

const MATCH_DURATION = 180;
const MAX_ELIXIR = 10;
const SETTINGS_IDS = ["battle_menu_panel", "battle_menu_title", "battle_menu_restart", "battle_menu_exit"];
const RESULT_IDS = ["battle_result_panel", "battle_result_title", "battle_result_score", "battle_result_again"];

export type BattleAction = "none" | "restart" | "exit";

export class BattleController {
  private screen: ScreenLayout | null = null;
  private units = new Map<string, BattleUnit>();
  private towers = new Map<string, Tower>();
  private selectedCard = 0;
  private elixir = 5;
  private enemyElixir = 5;
  private seconds = MATCH_DURATION;
  private enemyTimer = 2.25;
  private nextId = 1;
  private seed = 92317;
  private blueCrowns = 0;
  private redCrowns = 0;
  private paused = false;
  private outcome: Outcome = null;

  show(layout: ScreenLayout): void {
    clearScene();
    this.screen = layout;
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
    this.resize(layout);
    this.updateHud();
  }

  resize(layout: ScreenLayout): void {
    this.screen = layout;
    const battle = this.layout();
    placeSprite("battle_arena", {
      path: sprites.arena.path,
      width: Math.max(DESIGN_WIDTH, layout.viewportWidth),
      height: DESIGN_HEIGHT,
    }, 0, 0, -100);
    this.applyTowers(battle);
    this.applyCards(battle);
    this.applyHud(battle);
    if (this.paused) this.applyMenu(layout);
    if (this.outcome) this.applyResult(layout);
  }

  update(dt: number, pointer: PrimaryPointer): BattleAction {
    const screen = this.screen;
    if (!screen) return "none";
    const battle = this.layout();
    if (this.handleMenu(pointer, screen, battle)) {
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
    this.handleCards(pointer, battle);
    const frameTime = Math.min(Math.max(dt, 0), 0.05);
    this.elixir = Math.min(MAX_ELIXIR, this.elixir + 0.72 * frameTime);
    this.enemyElixir = Math.min(MAX_ELIXIR, this.enemyElixir + 0.72 * frameTime);
    this.seconds = Math.max(0, this.seconds - frameTime);
    this.enemyAi(frameTime, battle);
    this.updateUnits(frameTime);
    this.updateTowers(frameTime);
    this.checkTimeLimit();
    this.updateHud();
    return "none";
  }

  private spawnStaticScene(): void {
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

  private createTowers(): void {
    const definitions: Array<Pick<Tower, "id" | "team" | "kind" | "lane" | "maxHp">> = [
      { id: "red_king", team: "red", kind: "king", maxHp: 2600 },
      { id: "red_left", team: "red", kind: "princess", lane: "left", maxHp: 1600 },
      { id: "red_right", team: "red", kind: "princess", lane: "right", maxHp: 1600 },
      { id: "blue_king", team: "blue", kind: "king", maxHp: 2600 },
      { id: "blue_left", team: "blue", kind: "princess", lane: "left", maxHp: 1600 },
      { id: "blue_right", team: "blue", kind: "princess", lane: "right", maxHp: 1600 },
    ];
    for (const definition of definitions) {
      const tower: Tower = { ...definition, x: 0, y: 0, hp: definition.maxHp, attackTimer: 0, alive: true };
      this.towers.set(tower.id, tower);
      spawnSprite(tower.id, tower.team === "blue" ? sprites.towerBlue : sprites.towerRed);
      spawnText(`${tower.id}_hp`);
    }
  }

  private layout(): BattleLayout {
    const screen = this.screen!;
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
      settingsY: screen.top - 27 * scale,
    };
  }

  private cardX(index: number, layout: BattleLayout): number {
    const screen = this.screen!;
    const gap = 6 * layout.scale;
    const total = layout.cardWidth * cards.length + gap * (cards.length - 1);
    return screen.left + (screen.width - total) * 0.5 + layout.cardWidth * 0.5 + index * (layout.cardWidth + gap);
  }

  private applyTowers(layout: BattleLayout): void {
    const laneInset = Math.min(102 * layout.scale, (layout.fieldRight - layout.fieldLeft) * 0.25);
    const positions: Record<string, Vec2> = {
      red_king: { x: 0, y: layout.fieldTop - 47 * layout.scale },
      red_left: { x: layout.fieldLeft + laneInset, y: layout.riverY + (layout.fieldTop - layout.riverY) * 0.42 },
      red_right: { x: layout.fieldRight - laneInset, y: layout.riverY + (layout.fieldTop - layout.riverY) * 0.42 },
      blue_king: { x: 0, y: layout.fieldBottom + 47 * layout.scale },
      blue_left: { x: layout.fieldLeft + laneInset, y: layout.riverY - (layout.riverY - layout.fieldBottom) * 0.42 },
      blue_right: { x: layout.fieldRight - laneInset, y: layout.riverY - (layout.riverY - layout.fieldBottom) * 0.42 },
    };
    for (const tower of this.towers.values()) {
      Object.assign(tower, positions[tower.id]);
      if (!tower.alive) continue;
      const width = (tower.kind === "king" ? 82 : 68) * layout.scale;
      const height = (tower.kind === "king" ? 90 : 75) * layout.scale;
      placeSprite(tower.id, {
        path: tower.team === "blue" ? sprites.towerBlue.path : sprites.towerRed.path,
        width,
        height,
      }, tower.x, tower.y, 10);
      setTransform(`${tower.id}_hp`, { x: tower.x, y: tower.y + (tower.team === "red" ? -1 : 1) * height * 0.58, z: 14 });
    }
  }

  private applyCards(layout: BattleLayout): void {
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const x = this.cardX(index, layout);
      const y = layout.cardY + (index === this.selectedCard ? 8 * layout.scale : 0);
      placeSprite(`battle_card_frame_${index}`, {
        path: index === this.selectedCard ? sprites.cardSelected.path : sprites.cardFrame.path,
        width: layout.cardWidth,
        height: layout.cardHeight,
      }, x, y, 20);
      placeSprite(`battle_card_art_${index}`, {
        path: card.art.path,
        width: layout.cardWidth * 0.78,
        height: layout.cardHeight * 0.58,
      }, x, y + layout.cardHeight * 0.1, 21);
      placeText(`battle_card_name_${index}`, card.name, x, y - layout.cardHeight * 0.33, 22, Math.max(9, 11 * layout.scale), colors.white);
      placeText(`battle_card_cost_${index}`, String(card.cost), x - layout.cardWidth * 0.34, y + layout.cardHeight * 0.35, 23, 16 * layout.scale, colors.white);
    }
  }

  private applyHud(layout: BattleLayout): void {
    const screen = this.screen!;
    placeSprite("battle_settings", { path: sprites.settingsIcon.path, width: 48 * layout.scale, height: 48 * layout.scale }, layout.settingsX, layout.settingsY, 60);
    placeText("battle_enemy", "TRAINING BOT", screen.left + 63 * layout.scale, screen.top - 18 * layout.scale, 40, 13 * layout.scale, colors.red);
    placeText("battle_player", "BLUE KING", screen.left + 52 * layout.scale, layout.fieldBottom + 20 * layout.scale, 40, 13 * layout.scale, colors.blue);
    const cellWidth = Math.min(31 * layout.scale, (screen.width - 80 * layout.scale) / 10);
    const gap = 3 * layout.scale;
    const total = cellWidth * 10 + gap * 9;
    const start = screen.centerX - total * 0.5 + cellWidth * 0.5;
    for (let index = 0; index < MAX_ELIXIR; index += 1) {
      placeSprite(`battle_elixir_${index}`, {
        path: index < Math.floor(this.elixir) ? sprites.elixirFull.path : sprites.elixirEmpty.path,
        width: cellWidth,
        height: 17 * layout.scale,
      }, start + index * (cellWidth + gap), layout.elixirY, 20);
    }
    placeText("battle_elixir_text", String(Math.floor(this.elixir)), start - cellWidth, layout.elixirY, 42, 15 * layout.scale, colors.white);
  }

  private updateHud(): void {
    const layout = this.layout();
    const minutes = Math.floor(this.seconds / 60);
    const seconds = Math.max(0, Math.ceil(this.seconds) % 60).toString().padStart(2, "0");
    placeText("battle_timer", `${minutes}:${seconds}`, this.screen!.centerX, this.screen!.top - 18 * layout.scale, 40, 18 * layout.scale, colors.gold);
    placeText("battle_score", `${this.redCrowns} - ${this.blueCrowns}`, this.screen!.right - 76 * layout.scale, this.screen!.top - 18 * layout.scale, 40, 17 * layout.scale, colors.gold);
    this.applyHud(layout);
    for (const tower of this.towers.values()) if (tower.alive) placeText(`${tower.id}_hp`, String(Math.max(0, Math.ceil(tower.hp))), tower.x, tower.y + (tower.team === "red" ? -1 : 1) * 46 * layout.scale, 14, 11 * layout.scale, colors.white);
    setGameState(this.blueCrowns, 3 - this.redCrowns, this.paused ? "PAUSED" : this.outcome ? "RESULT" : "BATTLE");
  }

  private handleCards(pointer: PrimaryPointer, layout: BattleLayout): void {
    for (let index = 0; index < cards.length; index += 1) {
      if (keyJustPressed(`Digit${index + 1}`)) {
        this.selectedCard = index;
        this.applyCards(layout);
        return;
      }
    }
    if (!pointer.justPressed) return;
    for (let index = 0; index < cards.length; index += 1) {
      if (pointerInside(pointer, this.cardX(index, layout), layout.cardY, layout.cardWidth, layout.cardHeight + 14 * layout.scale)) {
        this.selectedCard = index;
        this.applyCards(layout);
        return;
      }
    }
    const card = cards[this.selectedCard];
    if (pointer.x >= layout.fieldLeft && pointer.x <= layout.fieldRight
      && pointer.y >= layout.fieldBottom + 24 * layout.scale && pointer.y <= layout.riverY - 24 * layout.scale
      && this.elixir >= card.cost) {
      this.spawnUnit("blue", card, pointer.x, pointer.y, layout);
      this.elixir -= card.cost;
    }
  }

  private spawnUnit(team: Team, card: CardDefinition, x: number, y: number, layout: BattleLayout): void {
    const id = `${team}_${card.id}_${this.nextId++}`;
    const unit: BattleUnit = {
      id,
      team,
      lane: x < 0 ? "left" : "right",
      card,
      x: clamp(x, layout.fieldLeft + 24, layout.fieldRight - 24),
      y: clamp(y, layout.fieldBottom + 25, layout.fieldTop - 25),
      hp: card.unit.hp,
      attackTimer: 0,
    };
    this.units.set(id, unit);
    spawnSprite(id, { path: card.art.path, width: card.unit.width * layout.scale, height: card.unit.height * layout.scale }, unit.x, unit.y, 7);
    spawnSprite(`${id}_team`, unit.team === "blue" ? sprites.teamBlue : sprites.teamRed, unit.x, unit.y, 6);
  }

  private despawnUnit(unit: BattleUnit): void {
    this.units.delete(unit.id);
    despawnSceneEntity(unit.id);
    despawnSceneEntity(`${unit.id}_team`);
  }

  private distance(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }

  private nearestEnemy(unit: BattleUnit, maxDistance: number): BattleUnit | undefined {
    let nearest: BattleUnit | undefined;
    for (const candidate of this.units.values()) {
      if (candidate.team === unit.team || candidate.hp <= 0 || this.distance(unit, candidate) >= maxDistance) continue;
      nearest = candidate;
      maxDistance = this.distance(unit, candidate);
    }
    return nearest;
  }

  private targetTower(unit: BattleUnit): Tower | undefined {
    const enemy = unit.team === "blue" ? "red" : "blue";
    const lane = this.towers.get(`${enemy}_${unit.lane}`);
    if (lane?.alive) return lane;
    const king = this.towers.get(`${enemy}_king`);
    return king?.alive ? king : undefined;
  }

  private move(unit: BattleUnit, target: Vec2, dt: number): void {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const step = Math.min(length, unit.card.unit.speed * dt);
    unit.x += dx / length * step;
    unit.y += dy / length * step;
  }

  private updateUnits(dt: number): void {
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
          } else this.damageTower(target as Tower, unit.card.unit.damage, unit.team);
          unit.attackTimer = unit.card.unit.attackDelay;
        }
      } else this.move(unit, target, dt);
      if (!this.units.has(unit.id)) continue;
      setTransform(unit.id, { x: unit.x, y: unit.y, z: 7 });
      setTransform(`${unit.id}_team`, { x: unit.x, y: unit.y - unit.card.unit.height * scale * 0.42, z: 6 });
    }
  }

  private updateTowers(dt: number): void {
    for (const tower of this.towers.values()) {
      if (!tower.alive) continue;
      tower.attackTimer = Math.max(0, tower.attackTimer - dt);
      let target: BattleUnit | undefined;
      let range = tower.kind === "king" ? 138 : 152;
      for (const unit of this.units.values()) {
        const distance = this.distance(tower, unit);
        if (unit.team !== tower.team && distance < range) { target = unit; range = distance; }
      }
      if (target && tower.attackTimer <= 0) {
        target.hp -= tower.kind === "king" ? 72 : 58;
        if (target.hp <= 0) this.despawnUnit(target);
        tower.attackTimer = tower.kind === "king" ? 0.82 : 0.95;
      }
    }
  }

  private damageTower(tower: Tower, amount: number, team: Team): void {
    if (!tower.alive) return;
    tower.hp -= amount;
    if (tower.hp > 0) return;
    tower.alive = false;
    despawnSceneEntity(tower.id);
    despawnSceneEntity(`${tower.id}_hp`);
    if (team === "blue") this.blueCrowns += 1; else this.redCrowns += 1;
    if (tower.kind === "king") this.finish(team);
  }

  private random(): number {
    this.seed = (this.seed * 48271) % 2147483647;
    return this.seed / 2147483647;
  }

  private enemyAi(dt: number, layout: BattleLayout): void {
    this.enemyTimer -= dt;
    if (this.enemyTimer > 0) return;
    const affordable = cards.filter((card) => card.cost <= this.enemyElixir);
    if (affordable.length === 0) { this.enemyTimer = 0.6; return; }
    const card = affordable[Math.floor(this.random() * affordable.length)];
    const laneX = this.random() < 0.5
      ? layout.fieldLeft + (layout.fieldRight - layout.fieldLeft) * 0.27
      : layout.fieldRight - (layout.fieldRight - layout.fieldLeft) * 0.27;
    this.spawnUnit("red", card, laneX, layout.riverY + 52 * layout.scale, layout);
    this.enemyElixir -= card.cost;
    this.enemyTimer = 1.35 + this.random() * 1.35;
  }

  private checkTimeLimit(): void {
    if (this.seconds > 0 || this.outcome) return;
    if (this.blueCrowns !== this.redCrowns) return this.finish(this.blueCrowns > this.redCrowns ? "blue" : "red");
    const blueHp = [...this.towers.values()].filter((tower) => tower.team === "blue" && tower.alive).reduce((sum, tower) => sum + tower.hp, 0);
    const redHp = [...this.towers.values()].filter((tower) => tower.team === "red" && tower.alive).reduce((sum, tower) => sum + tower.hp, 0);
    this.finish(blueHp === redHp ? "draw" : blueHp > redHp ? "blue" : "red");
  }

  private handleMenu(pointer: PrimaryPointer, screen: ScreenLayout, battle: BattleLayout): boolean {
    const toggle = keyJustPressed("Escape") || (pointer.justPressed && pointerInside(pointer, battle.settingsX, battle.settingsY, 48 * battle.scale, 48 * battle.scale));
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

  private applyMenu(screen: ScreenLayout): void {
    placeSprite("battle_menu_panel", { path: sprites.settingsPanel.path, width: 420 * screen.scale, height: 300 * screen.scale }, screen.centerX, screen.centerY, 70);
    placeText("battle_menu_title", "BATTLE MENU", screen.centerX, screen.centerY + 104 * screen.scale, 72, 27 * screen.scale, colors.white);
    placeText("battle_menu_restart", "RESTART", screen.centerX, screen.centerY + 18 * screen.scale, 72, 24 * screen.scale, colors.blue);
    placeText("battle_menu_exit", "EXIT GAME", screen.centerX, screen.centerY - 82 * screen.scale, 72, 24 * screen.scale, colors.red);
  }

  private finish(outcome: Exclude<Outcome, null>): void {
    if (this.outcome) return;
    this.outcome = outcome;
    spawnSprite("battle_result_panel", sprites.settingsPanel);
    for (const id of ["battle_result_title", "battle_result_score", "battle_result_again"]) spawnText(id);
    this.applyResult(this.screen!);
  }

  private applyResult(screen: ScreenLayout): void {
    const title = this.outcome === "blue" ? "VICTORY" : this.outcome === "red" ? "DEFEAT" : "DRAW";
    placeSprite("battle_result_panel", { path: sprites.settingsPanel.path, width: 420 * screen.scale, height: 300 * screen.scale }, screen.centerX, screen.centerY, 65);
    placeText("battle_result_title", title, screen.centerX, screen.centerY + 94 * screen.scale, 66, 32 * screen.scale, title === "DEFEAT" ? colors.red : colors.gold);
    placeText("battle_result_score", `${this.blueCrowns} CROWNS ${this.redCrowns}`, screen.centerX, screen.centerY + 15 * screen.scale, 66, 21 * screen.scale, colors.white);
    placeText("battle_result_again", "PLAY AGAIN", screen.centerX, screen.centerY - 78 * screen.scale, 66, 24 * screen.scale, colors.blue);
  }

  private handleResult(pointer: PrimaryPointer, screen: ScreenLayout): boolean {
    if (!this.outcome) return false;
    if (pointer.justPressed && pointerInside(pointer, screen.centerX, screen.centerY - 78 * screen.scale, 340 * screen.scale, 70 * screen.scale)) this.show(screen);
    return true;
  }
}
