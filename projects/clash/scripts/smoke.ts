import assert from "node:assert/strict";

interface RuntimeCallbacks {
  on_script_loaded(): void;
  on_script_reloaded(): void;
  on_update(dt: number): void;
}

interface MockPointer {
  pressed: boolean;
  justPressed: boolean;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface MockSafeArea {
  left: number;
  right: number;
  bottom: number;
  top: number;
  width: number;
  height: number;
  leftInset: number;
  rightInset: number;
  bottomInset: number;
  topInset: number;
}

interface MockEntity {
  id: string;
  x: number;
  y: number;
  z: number;
  path?: string;
  width?: number;
  height?: number;
  value?: string;
  fontSize?: number;
}

interface MockGameState {
  score: number;
  lives: number;
  message: string;
}

const entities = new Map<string, MockEntity>();
const safeArea: MockSafeArea = {
  left: -210,
  right: 210,
  bottom: -366,
  top: 356,
  width: 420,
  height: 722,
  leftInset: 15,
  rightInset: 15,
  bottomInset: 34,
  topInset: 44,
};
let pointer: MockPointer = {
  pressed: false,
  justPressed: false,
  x: 0,
  y: 0,
  viewportWidth: 450,
  viewportHeight: 800,
};
let gameState: MockGameState = { score: 0, lives: 0, message: "" };
let set3dEnabledCalls = 0;

const runtime = globalThis as typeof globalThis & RuntimeCallbacks;
Object.assign(runtime, {
  scene_clear: () => entities.clear(),
  scene_spawn: (id: string, x: number, y: number, z: number) => {
    entities.set(id, { id, x, y, z });
    return true;
  },
  scene_set_sprite: (id: string, path: string, width: number, height: number) => {
    Object.assign(assertEntity(id), { path, width, height });
    return true;
  },
  scene_set_transform: (id: string, x: number, y: number, z: number) => {
    Object.assign(assertEntity(id), { x, y, z });
    return true;
  },
  scene_set_text: (id: string, value: string, fontSize: number) => {
    Object.assign(assertEntity(id), { value, fontSize });
    return true;
  },
  scene_despawn: (id: string) => entities.delete(id),
  scene_set_3d_enabled: (enabled: boolean) => {
    assert.equal(enabled, false);
    set3dEnabledCalls += 1;
    return true;
  },
  game_state_set: (score: number, lives: number, message: string) => {
    gameState = { score, lives, message };
  },
  input_key_just_pressed: () => false,
  input_primary_pointer: () => pointer,
  window_set_size: () => true,
  window_safe_area: () => safeArea,
  app_request_exit: () => true,
});

const generatedRuntimeAsset = "../modules/clash/game/assets/clash.js";
await import(generatedRuntimeAsset);

function assertEntity(id: string): MockEntity {
  const entity = entities.get(id);
  assert.ok(entity, `missing mock entity: ${id}`);
  return entity;
}

function tap(x: number, y: number, dt = 0.016): void {
  pointer = { ...pointer, pressed: true, justPressed: true, x, y };
  runtime.on_update(dt);
  pointer = { ...pointer, pressed: false, justPressed: false };
}

function intersectsSafeArea(entity: MockEntity): boolean {
  if (entity.width === undefined || entity.height === undefined) return true;
  return entity.x + entity.width * 0.5 >= safeArea.left
    && entity.x - entity.width * 0.5 <= safeArea.right
    && entity.y + entity.height * 0.5 >= safeArea.bottom
    && entity.y - entity.height * 0.5 <= safeArea.top;
}

runtime.on_script_loaded();
assert.equal(set3dEnabledCalls, 1);
assert.equal(gameState.message, "LOBBY");
assert.ok(entities.has("lobby_arena"));
assert.ok(entities.has("lobby_battle_button"));

for (const entity of entities.values()) {
  if (entity.id === "lobby_background" || !intersectsSafeArea(entity)) continue;
  if (entity.width !== undefined) {
    assert.ok(entity.x - entity.width * 0.5 >= safeArea.left - 1, `${entity.id} crosses the left safe area`);
    assert.ok(entity.x + entity.width * 0.5 <= safeArea.right + 1, `${entity.id} crosses the right safe area`);
  }
  if (entity.height !== undefined) {
    assert.ok(entity.y - entity.height * 0.5 >= safeArea.bottom - 1, `${entity.id} crosses the bottom safe area`);
    assert.ok(entity.y + entity.height * 0.5 <= safeArea.top + 1, `${entity.id} crosses the top safe area`);
  }
}

tap(-168, safeArea.bottom + 39);
assert.equal(gameState.message, "LOBBY:SHOP");

tap(0, safeArea.bottom + 39);
assert.equal(gameState.message, "LOBBY:BATTLE");

tap(0, safeArea.bottom + 136);
assert.equal(gameState.message, "MATCHMAKING");
assert.equal(set3dEnabledCalls, 2);
for (let frame = 0; frame < 25; frame += 1) runtime.on_update(0.05);
assert.equal(gameState.message, "BATTLE");
assert.equal(set3dEnabledCalls, 3);

tap(41, safeArea.bottom + 74);
tap(50, -80);
assert.ok([...entities.keys()].some((id) => id.startsWith("blue_giant_")), "giant must deploy after selecting its card");

tap(safeArea.right - 28, safeArea.top - 27);
assert.equal(gameState.message, "PAUSED");
tap(0, (safeArea.top + safeArea.bottom) * 0.5 + 18);
assert.equal(gameState.message, "BATTLE");
assert.ok(![...entities.keys()].some((id) => id.startsWith("blue_giant_")), "restart must clear deployed units");

console.log("clash lobby, safe-area, matchmaking, deployment, and restart smoke test passed");
