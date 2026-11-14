import { TouchControls, readControls, type Layout } from "./controls.js";
import { mountHud, pollButtons, readLayout, updateHud, updateStick, updatePerformance } from "./hud.js";
import { FrameProfiler, type FrameMetrics } from "./performance.js";
import { angleDelta, fixedStep, interpolate, type Pose } from "./race.js";
import { PcSession, parseSettings } from "./session.js";
import { trackData } from "./track-data.js";
import { GameAudio } from "./sound.js";
import { advanceWheelSpin, kartFrame, wheelTransform } from "./kart-transform.js";
import { setUiLanguage } from "./localization.js";

const callbacks = globalThis as unknown as RuneweaveCallbacks;
const session = new PcSession();
const touch = new TouchControls();
const mobile = ["android", "ios"].includes(app_platform());
const profiler = new FrameProfiler();
const sound = new GameAudio();
let showPerformance = !mobile;
let lastMetrics: FrameMetrics | null = null;
const wheelAngles = new Map<string, number>();
const pickupVisible = new Map<number, boolean>();
const trapIds = new Set<string>();
let accumulator = 0, uiClock = 0;
let viewport = "", mountedScreen = "";
let layout: Layout;
let layoutClock = 0;
let pendingRescue = false, pendingItem = false, lookBack = false;
let worldReady = false;
let previewId = "", previewAngle = 0;
let camera: Pose = { ...session.race.player };
const zeroPose = (): Pose => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0 });

function spawn(id: string, path: string, pose: Pose, scale = 1): void {
  if (!scene_spawn(id, pose.x, pose.y, pose.z) || !scene_set_model(id, path)) throw new Error(`Cannot create model ${id}`);
  scene_set_transform_3d(id, pose.x, pose.y, pose.z, pose.pitch, -pose.heading, 0, scale);
}
function refreshUi(): void {
  layout = readLayout(mobile); layoutClock = 0;
  touch.reset(); accumulator = 0; pendingItem = false; pendingRescue = false; lookBack = false;
  if (session.screen === "kart") preparePreview();
  scene_set_3d_enabled(session.screen === "kart" || worldReady && (["race", "paused", "finished"].includes(session.screen) || ["options", "help"].includes(session.screen) && session.returnScreen === "paused"));
  if (session.screen === "track-info") {
    const stored = storage_read(session.bestKey);
    const value = stored.state === "ok" ? Number(stored.value) : 0;
    session.best = Number.isFinite(value) && value > 0 ? value : 0;
  }
  storage_write("pc-race-settings-v1", JSON.stringify(session.settings));
  mountHud(session, layout, refreshUi, startRace, mobile, (id) => {
    if (session.screen === "kart" && id.startsWith("gui:karts:choose-")) {
      const kart = trackData.karts.find((kart) => `gui:karts:choose-${kart.id}` === id);
      if (kart && session.settings.kartId !== kart.id) { session.settings.kartId = kart.id; refreshUi(); }
    }
  });
  viewport = JSON.stringify(layout); mountedScreen = session.screen;
  updatePerformance(lastMetrics, showPerformance && session.screen !== "main");
}
function preparePreview(): void {
  if (previewId === session.settings.kartId) return;
  scene_clear(); worldReady = false; previewId = session.settings.kartId; previewAngle = 0;
  const kart = trackData.karts.find((kart) => kart.id === previewId)!;
  scene_set_environment(JSON.stringify({ ambient: [1, 1, 1], brightness: 600, sun: [1, 0.95, 0.9], illuminance: 12000, direction: [1, 3, 2], background: [0.2, 0.17, 0.12], fog: null }));
  spawn("preview-background", trackData.menuSkyModel, zeroPose());
  spawn("preview-body", kart.model, zeroPose());
  for (let i = 0; i < kart.wheels.length; i++) spawn(`preview-wheel-${i}`, kart.wheels[i].path, zeroPose());
}
function renderPreview(dt: number): void {
  previewAngle = (previewAngle + dt * 0.55) % (Math.PI * 2);
  const frame = kartFrame({ ...zeroPose(), heading: -previewAngle }, 0, 0);
  scene_set_transform_3d("preview-body", 0, 0, 0, ...frame.rotation, 1);
  const kart = trackData.karts.find((kart) => kart.id === session.settings.kartId)!;
  for (let i = 0; i < kart.wheels.length; i++) {
    const wheel = wheelTransform(frame, kart.wheels[i].position, 0, 0);
    scene_set_transform_3d(`preview-wheel-${i}`, wheel.position.x, wheel.position.y, wheel.position.z, ...wheel.rotation, 1);
  }
  scene_set_camera_3d(2.5, 1.5, 3.6, 0, 0.5, 0, 32);
}
function startRace(): void {
  session.start(); accumulator = 0; uiClock = 0; lookBack = false;
  wheelAngles.clear(); pickupVisible.clear(); trapIds.clear();
  camera = { ...session.race.player };
  scene_clear();
  if (!scene_set_environment(JSON.stringify(trackData.environment))) throw new Error("STK scene environment requires the current native runtime");
  scene_set_3d_enabled(true);
  spawn("lighthouse", trackData.trackModel, zeroPose());
  spawn("sky", trackData.skyModel, zeroPose());
  for (const racer of session.race.racers) {
    const kart = trackData.karts.find((kart) => kart.id === racer.kartId)!;
    spawn(racer.id, kart.model, racer);
    for (let i = 0; i < kart.wheels.length; i++) spawn(`${racer.id}-wheel-${i}`, kart.wheels[i].path, racer);
  }
  for (let i = 0; i < session.race.pickups.length; i++) {
    const pickup = session.race.pickups[i], [x, y, z] = pickup.position;
    spawn(`pickup-${i}`, trackData.pickupModels[pickup.kind as keyof typeof trackData.pickupModels], { x, y, z, heading: 0, pitch: 0 });
  }
  worldReady = true; refreshUi(); render(1, 1);
  previewId = "";
}
function render(alpha: number, dt: number): void {
  if (!worldReady) return;
  const race = session.race;
  for (const racer of race.racers) {
    const pose = interpolate(racer, alpha);
    const kart = trackData.karts.find((kart) => kart.id === racer.kartId)!;
    const lean = racer.stun > 0 && !racer.falseStart ? Math.sin(race.elapsed * 20) * 0.2 : -racer.steering * Math.min(0.09, Math.abs(racer.speed) * 0.003);
    const frame = kartFrame(pose, lean);
    scene_set_transform_3d(racer.id, frame.position.x, frame.position.y, frame.position.z, ...frame.rotation, 1);
    for (let i = 0; i < kart.wheels.length; i++) {
      const wheel = kart.wheels[i], id = `${racer.id}-wheel-${i}`;
      const spin = advanceWheelSpin(wheelAngles.get(id) ?? 0, racer.speed, dt, wheel.radius);
      wheelAngles.set(id, spin);
      const transform = wheelTransform(frame, wheel.position, spin, wheel.front ? -racer.steering * 0.35 : 0);
      scene_set_transform_3d(id, transform.position.x, transform.position.y, transform.position.z, ...transform.rotation, 1);
    }
  }
  const target = interpolate(race.player, alpha), response = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
  camera.x += (target.x - camera.x) * response; camera.y += (target.y - camera.y) * response; camera.z += (target.z - camera.z) * response;
  const lagX = camera.x - target.x, lagZ = camera.z - target.z, lag = Math.hypot(lagX, lagZ);
  if (lag > 0.75) { camera.x = target.x + lagX * 0.75 / lag; camera.z = target.z + lagZ * 0.75 / lag; }
  camera.heading += angleDelta(target.heading - camera.heading) * response;
  const distance = 3.8 + Math.abs(race.player.speed) * 0.008, direction = lookBack ? -1 : 1;
  if (!scene_set_camera_3d(camera.x - Math.sin(camera.heading) * distance * direction, camera.y + 1.9,
    camera.z + Math.cos(camera.heading) * distance * direction, camera.x + Math.sin(camera.heading) * 1.1 * direction, camera.y + 0.65,
    camera.z - Math.cos(camera.heading) * 1.1 * direction, 55)) throw new Error("3D follow camera unavailable");
  for (let i = 0; i < race.pickups.length; i++) {
    const pickup = race.pickups[i], visible = pickup.cooldown <= 0;
    if (pickupVisible.get(i) === visible) continue;
    const [x, y, z] = pickup.position;
    scene_set_transform_3d(`pickup-${i}`, x, visible ? y : y - 1000, z, 0, 0, 0, 1); pickupVisible.set(i, visible);
  }
  const active = new Set<string>();
  for (const trap of race.traps) {
    const id = `trap-${trap.x.toFixed(3)}-${trap.z.toFixed(3)}`; active.add(id);
    if (!trapIds.has(id)) { spawn(id, trackData.pickupModels.banana, { ...trap, heading: 0, pitch: 0 }); trapIds.add(id); }
  }
  for (const id of trapIds) if (!active.has(id)) { scene_despawn(id); trapIds.delete(id); }
}
function load(): void {
  sound.reset();
  const stored = storage_read("pc-race-settings-v1");
  session.settings = parseSettings(stored.state === "ok" ? stored.value : "{}"); session.screen = "main";
  setUiLanguage(session.settings.language); session.menu.close(); session.menuHistory = [];
  scene_clear(); scene_set_3d_enabled(false); worldReady = false;
  previewId = "";
  accumulator = 0; uiClock = 0; wheelAngles.clear(); pickupVisible.clear(); trapIds.clear(); refreshUi();
  sound.update(session, 0);
}
callbacks.on_script_loaded = load;
callbacks.on_script_reloaded = load;
callbacks.on_suspend = () => { if (session.screen === "race") { session.screen = "paused"; refreshUi(); } };
function updateGame(frameDt: number): void {
  if (!Number.isFinite(frameDt) || frameDt < 0) return;
  if (input_key_just_pressed("F3")) { showPerformance = !showPerformance; updatePerformance(lastMetrics, showPerformance && session.screen !== "main"); }
  if (input_key_just_pressed("Escape")) { if (session.menu.editing) session.menu.editing = ""; else session.back(); refreshUi(); return; }
  const previousScreen = session.screen;
  pollButtons();
  const dt = Math.min(frameDt, 0.1);
  layoutClock += dt;
  if (mobile || layoutClock >= 0.1) {
    layoutClock = 0;
    if (viewport !== JSON.stringify(readLayout(mobile))) refreshUi();
  }
  if (mountedScreen !== session.screen) refreshUi();
  if (session.screen === "kart") renderPreview(dt);
  if (session.screen !== "race") {
    if (previousScreen === "race") { pendingItem = false; pendingRescue = false; }
    if (worldReady && ["paused", "finished"].includes(session.screen)) render(1, 0);
    return;
  }
  const controls = readControls(touch, layout, mobile, session.settings.wasd); lookBack = controls.lookBack ?? false;
  if (mobile) updateStick(touch, layout);
  if (session.race.phase === "racing") { pendingItem ||= controls.useItem; pendingRescue ||= controls.rescue; }
  accumulator += dt;
  while (accumulator >= fixedStep) {
    controls.useItem = pendingItem; controls.rescue = pendingRescue;
    session.race.step(fixedStep, controls); pendingItem = false; pendingRescue = false; accumulator -= fixedStep;
    if (session.race.phase === "finished") {
      const stored = storage_read(session.bestKey), best = stored.state === "ok" ? Number(stored.value) : 0;
      if (!Number.isFinite(best) || best <= 0 || session.race.elapsed < best) {
        session.best = session.race.elapsed;
        const saved = storage_write(session.bestKey, `${session.best}`);
        if (saved.state === "error") console.log(`Could not save race time: ${saved.error}`);
      }
      session.screen = "finished"; refreshUi(); break;
    }
  }
  render(accumulator / fixedStep, dt); uiClock += dt;
  if (uiClock >= 0.1) { uiClock = 0; updateHud(session); }
}
callbacks.on_update = (frameDt) => {
  profiler.begin(Date.now());
  try { updateGame(frameDt); }
  finally {
    sound.update(session, Number.isFinite(frameDt) ? Math.max(0, Math.min(frameDt, 0.1)) : 0);
    const metrics = profiler.end(Date.now());
    if (metrics) {
      lastMetrics = metrics; updatePerformance(metrics, showPerformance && session.screen !== "main");
      if (showPerformance) console.log(`[stk-perf] ${JSON.stringify({ screen: session.screen, ...metrics })}`);
    }
  }
};
