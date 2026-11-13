import { TouchControls, readControls } from "./controls.js";
import { mountHud, pollButtons, readLayout, updateHud, updateStick } from "./hud.js";
import { Circuit, Race, angleDelta, fixedStep, interpolate, type Pose } from "./race.js";
import { trackData } from "./track-data.js";

const callbacks = globalThis as unknown as RuneweaveCallbacks;
const circuit = new Circuit(trackData.route);
const touch = new TouchControls();
let race = new Race(circuit, trackData.pickups);
let accumulator = 0;
let uiClock = 0;
let paused = false;
let best = 0;
let overlay = "";
let viewport = "";
let camera: Pose = { ...race.player };
let wheelRoll = 0;
let pendingRescue = false;
let pendingItem = false;
const pickupVisible = new Map<number, boolean>();
const trapIds = new Set<string>();

function spawn(id: string, path: string, pose: Pose, scale = 1): void {
  if (!scene_spawn(id, pose.x, pose.y, pose.z) || !scene_set_model(id, path)) throw new Error(`Cannot create model ${id}`);
  scene_set_transform_3d(id, pose.x, pose.y, pose.z, pose.pitch, -pose.heading, 0, scale);
}
function screenMode(): string { return paused ? "paused" : race.phase === "ready" ? "ready" : race.phase === "finished" ? "finished" : "race"; }
function refreshUi(): void {
  touch.stickId = null;
  const layout = readLayout();
  mountHud(race, screenMode(), best, layout, primaryAction, togglePause);
  overlay = screenMode(); viewport = JSON.stringify(layout);
}
function primaryAction(): void {
  if (paused) { paused = false; accumulator = 0; }
  else if (race.phase === "ready") race.start();
  else resetRace();
  refreshUi();
}
function togglePause(): void {
  if (["ready", "finished"].includes(race.phase)) return;
  paused = !paused; accumulator = 0; pendingItem = false; pendingRescue = false; refreshUi();
}
function resetRace(): void {
  race = new Race(circuit, trackData.pickups);
  race.start(); paused = false; accumulator = 0; wheelRoll = 0; pendingItem = false; pendingRescue = false;
  camera = { ...race.player };
  pickupVisible.clear();
  for (const id of trapIds) scene_despawn(id);
  trapIds.clear();
}
function render(alpha: number, dt: number): void {
  wheelRoll = (wheelRoll + race.player.speed * dt / 0.18) % (Math.PI * 2);
  for (const racer of race.racers) {
    const pose = interpolate(racer, alpha);
    const sway = racer.stun > 0 ? Math.sin(race.elapsed * 20) * 0.2 : -racer.steering * Math.min(0.09, Math.abs(racer.speed) * 0.003);
    scene_set_transform_3d(racer.id, pose.x, pose.y + 0.16, pose.z, pose.pitch, -pose.heading, sway, 1);
    for (let index = 0; index < trackData.wheels.length; index++) {
      const wheel = trackData.wheels[index];
      const [wx, wy, wz] = wheel.position;
      const yaw = -pose.heading;
      const x = pose.x + wx * Math.cos(yaw) + wz * Math.sin(yaw);
      const z = pose.z - wx * Math.sin(yaw) + wz * Math.cos(yaw);
      scene_set_transform_3d(`${racer.id}-wheel-${index}`, x, pose.y + wy + 0.16, z, wheelRoll, yaw - (wheel.front ? racer.steering * 0.35 : 0), 0, 1);
    }
  }
  const target = interpolate(race.player, alpha);
  const response = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
  camera.x += (target.x - camera.x) * response;
  camera.y += (target.y - camera.y) * response;
  camera.z += (target.z - camera.z) * response;
  camera.heading += angleDelta(target.heading - camera.heading) * response;
  const distance = 8.5 + Math.abs(race.player.speed) * 0.04;
  if (!scene_set_camera_3d(camera.x - Math.sin(camera.heading) * distance, camera.y + 4.8,
    camera.z + Math.cos(camera.heading) * distance, camera.x + Math.sin(camera.heading) * 2.6, camera.y + 1,
    camera.z - Math.cos(camera.heading) * 2.6, 68)) throw new Error("3D follow camera unavailable; update the native runtime");
  for (let i = 0; i < race.pickups.length; i++) {
    const pickup = race.pickups[i];
    const visible = pickup.cooldown <= 0;
    if (pickupVisible.get(i) === visible) continue;
    const [x, y, z] = pickup.position;
    scene_set_transform_3d(`pickup-${i}`, x, visible ? y : y - 1000, z, 0, 0, 0, 1);
    pickupVisible.set(i, visible);
  }
  const active = new Set<string>();
  for (const trap of race.traps) {
    const id = `trap-${trap.x.toFixed(3)}-${trap.z.toFixed(3)}`;
    active.add(id);
    if (!trapIds.has(id)) {
      spawn(id, trackData.pickupModels.banana, { ...trap, heading: 0, pitch: 0 });
      trapIds.add(id);
    }
  }
  for (const id of trapIds) if (!active.has(id)) { scene_despawn(id); trapIds.delete(id); }
}
function load(): void {
  scene_clear(); scene_set_3d_enabled(true);
  race = new Race(circuit, trackData.pickups); paused = false; accumulator = 0; uiClock = 0; wheelRoll = 0; pendingItem = false; pendingRescue = false;
  camera = { ...race.player }; pickupVisible.clear(); trapIds.clear();
  const stored = storage_read("lighthouse-best-v1");
  const value = stored.state === "ok" ? Number(stored.value) : 0;
  best = Number.isFinite(value) && value > 0 ? value : 0;
  spawn("lighthouse", trackData.trackModel, { x: 0, y: 0, z: 0, heading: 0, pitch: 0 });
  for (let i = 0; i < trackData.scenery.length; i++) {
    const object = trackData.scenery[i];
    const [x, y, z] = object.position;
    spawn(`scenery-${i}`, object.path, { x, y, z, heading: object.rotation[1] * Math.PI / 180, pitch: object.rotation[0] * Math.PI / 180 }, object.scale[0]);
  }
  for (const racer of race.racers) {
    spawn(racer.id, trackData.kartModel, racer);
    for (let i = 0; i < trackData.wheels.length; i++) spawn(`${racer.id}-wheel-${i}`, trackData.wheels[i].path, racer);
  }
  for (let i = 0; i < race.pickups.length; i++) {
    const pickup = race.pickups[i];
    const [x, y, z] = pickup.position;
    const path = trackData.pickupModels[pickup.kind as keyof typeof trackData.pickupModels];
    spawn(`pickup-${i}`, path, { x, y, z, heading: 0, pitch: 0 });
  }
  refreshUi(); render(1, 1);
}
callbacks.on_script_loaded = load;
callbacks.on_script_reloaded = load;
callbacks.on_suspend = () => { if (!paused && ["racing", "countdown"].includes(race.phase)) togglePause(); };
callbacks.on_update = (frameDt) => {
  if (!Number.isFinite(frameDt) || frameDt < 0) return;
  if (input_key_just_pressed("Escape") || input_key_just_pressed("KeyP")) togglePause();
  if (input_key_just_pressed("Enter")) {
    if (["ready", "finished"].includes(race.phase) || paused) primaryAction();
  }
  pollButtons();
  const layout = readLayout();
  if (viewport !== JSON.stringify(layout) || overlay !== screenMode()) refreshUi();
  const dt = Math.min(frameDt, 0.1);
  const controls = readControls(touch, layout);
  if (!paused && race.phase === "racing") {
    pendingItem ||= controls.useItem;
    pendingRescue ||= controls.rescue;
  }
  updateStick(touch, layout);
  if (!paused) {
    accumulator += dt;
    while (accumulator >= fixedStep) {
      const before = race.phase;
      controls.useItem = pendingItem; controls.rescue = pendingRescue;
      race.step(fixedStep, controls);
      pendingItem = false; pendingRescue = false;
      accumulator -= fixedStep;
      if (before !== "finished" && race.phase === "finished") {
        if (!best || race.elapsed < best) {
          best = race.elapsed;
          const saved = storage_write("lighthouse-best-v1", `${best}`);
          if (saved.state === "error") console.log(`Could not save best race time: ${saved.error}`);
        }
        refreshUi();
      }
    }
  }
  render(paused ? 1 : accumulator / fixedStep, paused ? 0 : dt);
  uiClock += dt;
  if (uiClock >= 0.1) { uiClock = 0; updateHud(race); }
};
