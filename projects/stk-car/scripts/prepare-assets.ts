import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readSpm, writeGlb, wheelRadius, type SpmMesh } from "./spm.ts";
import { prepareScene } from "./prepare-scene.ts";
import { parseXml } from "./scene-source.ts";
import type { Course, MapScene } from "../modules/stk-car/game/src/courses.js";
import { Circuit } from "../modules/stk-car/game/src/race.js";
import { minimap } from "./minimap.ts";
import { kartPreviewBasis } from "../modules/stk-car/game/src/kart-layout.js";
import { prepareMenus } from "./prepare-menus.ts";

const project = resolve(import.meta.dirname, "..");
const sourceArgument = process.argv.find((value) => value.startsWith("--source="))?.slice(9);
const source = resolve(sourceArgument ?? process.env.STK_ASSETS ?? "../stk-assets");
const codeArgument = process.argv.find((value) => value.startsWith("--code="))?.slice(7);
const code = resolve(codeArgument ?? process.env.STK_CODE ?? join(source, "..", "stk-code"));
const assets = join(project, "modules/stk-car/game/assets");
const track = join(source, "tracks/lighthouse");
const kart = join(source, "karts/tux");
const sourceFiles = new Map<string, string>();
const textures = new Map<string, string>();
const generatedFiles = new Set<string>();

function indexTextures(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) indexTextures(path);
    else if (/\.(png|jpe?g)$/i.test(entry.name) && !textures.has(entry.name)) textures.set(entry.name, path);
  }
}
function record(path: string): Buffer {
  const sourcePath = relative(source, path), codePath = relative(code, path);
  const inside = (value: string) => value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value);
  const sourceKey = inside(sourcePath) ? `stk-assets/${sourcePath}` : inside(codePath) ? `stk-code/${codePath}` : null;
  if (!sourceKey) throw new Error(`Resource is outside the configured STK directories: ${path}`);
  const data = readFileSync(path);
  sourceFiles.set(sourceKey.replaceAll("\\", "/"), createHash("sha256").update(data).digest("hex"));
  return data;
}
function write(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  const assetPath = relative(assets, path);
  if (assetPath && !assetPath.startsWith("..") && !isAbsolute(assetPath)) generatedFiles.add(assetPath.replaceAll("\\", "/"));
}
function copy(path: string, target: string) { write(join(assets, target), record(path)); }
function textMetadata(bytes: Buffer): string { return `${bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "").trimEnd()}\n`; }
function copyTextMetadata(path: string, target: string) { write(join(assets, target), textMetadata(record(path))); }
function xml(path: string): string { return record(path).toString("utf8"); }
function attributes(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]));
}
function tags(text: string, tag: string): Record<string, string>[] {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(new RegExp(`<${tag}(?=\\s|/|>)([^>]*?)>`, "g"))].map((match) => attributes(match[1]));
}
function vector(value: string): number[] {
  const numbers = value.trim().split(/\s+/).map(Number);
  if (numbers.length !== 3 || !numbers.every(Number.isFinite)) throw new Error(`Invalid XYZ: ${value}`);
  return [numbers[0], numbers[1], -numbers[2]];
}
function convert(path: string, target: string, mesh: SpmMesh = readSpm(record(path))): string {
  const materialPath = join(dirname(path), "materials.xml");
  const shaders = new Map((existsSync(materialPath) ? tags(xml(materialPath), "material") : []).map((m) => [m.name, m.shader]));
  const output = writeGlb(mesh, (name) => {
    const local = join(dirname(path), basename(name));
    const resolved = existsSync(local) ? local : textures.get(basename(name));
    if (!resolved) throw new Error(`Missing texture ${name} for ${path}`);
    record(resolved);
    return resolved;
  }, shaders);
  write(join(assets, target), output);
  console.log(`${target}: ${mesh.primitives.length} primitives, ${(output.length / 1024 ** 2).toFixed(2)} MiB`);
  return target;
}

for (const path of [track, kart, join(source, "textures"), join(code, "data/ttf/wqy-microhei.ttf")]) {
  if (!existsSync(path)) throw new Error(`Missing STK resource: ${path}. Pass --source=<stk-assets> --code=<stk-code>.`);
}
indexTextures(join(source, "textures"));
const menus = prepareMenus(source, code, record, (path, data) => write(join(assets, path), data));
write(join(project, "modules/stk-car/game/src/menu-data.ts"), `// Generated by npm run prepare:assets from original STK GUI sources.\nimport type { MenuData } from "./menu-data-types.js";\nexport const menuData: MenuData = ${JSON.stringify(menus)};\n`);
const scene = xml(join(track, "scene.xml"));
const fullScene = prepareScene(source, track, record, textures, (path, data) => write(join(assets, path), data));
const trackModel = fullScene.trackModel;
const scenery: { path: string; position: number[]; rotation: number[]; scale: number[] }[] = [];
const kartConfig = xml(join(kart, "kart.xml"));
const kartModel = convert(join(kart, tags(kartConfig, "kart")[0]["model-file"]), "models/tux.glb");
const wheels = ["front-left", "front-right", "rear-left", "rear-right"].map((tag) => {
  const wheel = tags(kartConfig, tag)[0];
  const path = join(kart, wheel.model), mesh = readSpm(record(path));
  return { path: convert(path, `models/${tag}.glb`, mesh), position: vector(wheel.position), front: tag.startsWith("front"), radius: wheelRadius(mesh) };
});
const collisionBodies: Record<string, { min: number[]; max: number[] }> = {};
const karts = ["tux", "pidgin", "wilber", "suzanne"].map((id) => {
  const directory = join(source, "karts", id);
  const config = xml(join(directory, "kart.xml"));
  const info = tags(config, "kart")[0];
  const model = id === "tux" ? kartModel : convert(join(directory, info["model-file"]), `models/karts/${id}/kart.glb`);
  const kartWheels = id === "tux" ? wheels : ["front-left", "front-right", "rear-left", "rear-right"].map((tag) => {
    const wheel = tags(config, tag)[0];
    const path = join(directory, wheel.model), mesh = readSpm(record(path));
    return { path: convert(path, `models/karts/${id}/${tag}.glb`, mesh), position: vector(wheel.position), front: tag.startsWith("front"), radius: wheelRadius(mesh) };
  });
  const parts = [{ mesh: readSpm(record(join(directory, info["model-file"]))), position: [0, 0, 0] },
    ...["front-left", "front-right", "rear-left", "rear-right"].map((tag) => {
      const wheel = tags(config, tag)[0];
      return { mesh: readSpm(record(join(directory, wheel.model))), position: vector(wheel.position) };
    })];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const primitive of part.mesh.primitives) primitive.positions.forEach((value, index) => {
    const axis = index % 3, coordinate = value + part.position[axis];
    min[axis] = Math.min(min[axis], coordinate); max[axis] = Math.max(max[axis], coordinate);
  });
  if (!min.every(Number.isFinite) || !max.every((value, axis) => value > min[axis])) throw new Error(`Invalid kart collision bounds: ${id}`);
  collisionBodies[id] = { min, max };
  copy(join(directory, info["icon-file"]), `branding/${id}.png`);
  copy(join(directory, "licenses.txt"), `licenses/${id}.txt`);
  return { id, name: info.name, type: info.type, model, icon: `branding/${id}.png`, wheels: kartWheels };
});
write(join(project, "modules/stk-car/game/src/kart-bodies.ts"), `// Generated by npm run prepare:assets from STK kart and wheel meshes.\nexport const kartBodies = ${JSON.stringify(collisionBodies)} as const;\n`);
const pickupModels = Object.fromEntries([
  ["item", "gift-box.spm"], ["banana", "banana.spm"],
  ["small-nitro", "nitrotank-small.spm"], ["big-nitro", "nitrotank-big-low.spm"],
].map(([kind, filename]) => [kind, convert(join(source, "models", filename), `models/${kind}.glb`)]));
function driveline(directory: string, readXml = xml) {
  const quads: number[][][] = [];
  for (const quad of tags(readXml(join(directory, "quads.xml")), "quad")) {
    quads.push([0, 1, 2, 3].map((index) => {
      const value = quad[`p${index}`];
      if (!value.includes(":")) return vector(value);
      const [q, p] = value.split(":").map(Number);
      if (!quads[q]?.[p]) throw new Error(`Invalid quad reference: ${value}`);
      return [...quads[q][p]];
    }));
  }
  const edge = tags(readXml(join(directory, "graph.xml")), "edge-loop")[0];
  return quads.slice(Number(edge.from), Number(edge.to) + 1).map((quad) => ({
    center: quad[0].map((value, axis) => (value + quad[1][axis]) / 2),
    width: Math.hypot(quad[0][0] - quad[1][0], quad[0][2] - quad[1][2]),
  }));
}
const route = driveline(track);
const pickups = ["small-nitro", "big-nitro", "banana", "item"].flatMap((tag) => tags(scene, tag).map((item) => ({
  kind: tag, position: vector(`${item.x} ${item.y} ${item.z}`),
})));
const trackInfo = tags(xml(join(track, "track.xml")), "track")[0];
function music(name: string, readXml = xml): string {
  const info = tags(readXml(join(source, "music", name)), "music")[0];
  const target = `audio/music/${info.file}`;
  copy(join(source, "music", info.file), target);
  copyTextMetadata(join(source, "music", name), `licenses/${name}`);
  return target;
}
const audio = { menu: music("main_theme.music"), race: music(trackInfo.music), result: music("race_win_theme.music"), lose: music("lose_theme.music") };
for (const name of ["plopp", "appear", "locked", "pre_start_race", "start_race", "engine_small", "nitro", "skid", "grab_collectable", "energy_bar_full", "race_finish", "crash", "wee"]) copy(join(source, "sfx", `${name}.ogg`), `audio/sfx/${name}.ogg`);
copyTextMetadata(join(source, "music/licenses.txt"), "licenses/music.txt");
copyTextMetadata(join(source, "sfx/sfx.xml"), "licenses/sfx.xml");
copyTextMetadata(join(source, "sfx/licenses.txt"), "licenses/sfx.txt");
const map = minimap(route);
write(join(assets, "ui/minimap.png"), map.image);
const dayTrack = join(source, "tracks/hacienda");
const dayScene = prepareScene(source, dayTrack, record, textures, (path, data) => write(join(assets, path), data));
const dayInfo = tags(xml(join(dayTrack, "track.xml")), "track")[0], dayXml = xml(join(dayTrack, "scene.xml"));
const dayRoute = driveline(dayTrack), dayMap = minimap(dayRoute);
write(join(assets, "ui/hacienda-minimap.png"), dayMap.image);
const dayPickups = ["small-nitro", "big-nitro", "banana", "item"].flatMap((tag) => tags(dayXml, tag).map((item) => ({ kind: tag, position: vector(`${item.x} ${item.y} ${item.z}`) })));
const dayCourse = { id: "hacienda", name: dayInfo.name, trackModel: dayScene.trackModel, skyModel: dayScene.skyModel, route: dayRoute, pickups: dayPickups,
  defaultLaps: Number(dayInfo["default-number-of-laps"]), environment: dayScene.environment, metadata: dayScene.metadata,
  music: music(dayInfo.music), minimap: { ...dayMap.bounds, image: "ui/hacienda-minimap.png" } };
write(join(project, "modules/stk-car/game/src/day-course-data.ts"), `// Generated by npm run prepare:assets from STK's Hacienda assets.\nexport const dayCourseData = ${JSON.stringify(dayCourse)};\n`);
write(join(assets, "licenses/hacienda-scene-instances.json"), `${JSON.stringify(dayScene.instances)}\n`);
copy(join(dayTrack, "License.txt"), "licenses/hacienda.txt");
for (const name of dayScene.metadata.libraries) {
  const path = join(source, "library", name, "licenses.txt");
  if (existsSync(path)) copy(path, `licenses/library-${name}.txt`);
}
const manifest = { trackModel, kartModel, wheels, scenery, route, pickups, pickupModels, karts, audio,
  menuSkyModel: "models/menu-background.glb",
  skyModel: fullScene.skyModel, sceneMetadata: fullScene.metadata, environment: fullScene.environment,
  minimap: map.bounds, defaultLaps: Number(trackInfo["default-number-of-laps"]), startGrid: tags(scene, "default-start")[0] };
write(join(project, "modules/stk-car/game/src/track-data.ts"), `// Generated by npm run prepare:assets from STK's Lighthouse assets.\nexport const trackData = ${JSON.stringify(manifest)} as const;\n`);
copy(join(kart, "tux_icon.png"), "branding/tux.png");
copy(join(track, "screenshot.jpg"), "branding/lighthouse.jpg");
copy(join(code, "data/ttf/wqy-microhei.ttf"), "fonts/wqy-microhei.ttf");
copy(join(code, "data/ttf/Cantarell-Regular.otf"), "fonts/Cantarell-Regular.otf");
copy(join(code, "data/ttf/SigmarOne.otf"), "fonts/SigmarOne.otf");
for (const name of ["logo", "menu_story", "menu_story_focus", "menu_race", "menu_race_focus", "menu_multi", "menu_multi_focus", "menu_online", "menu_online_focus", "menu_addons", "menu_addons_focus", "main_options", "main_help", "tutorial", "crown", "gp_copy", "gpeditor", "main_about", "main_quit", "back", "green_check", "restart", "mode_normal", "mode_tt", "difficulty_easy", "difficulty_medium", "difficulty_hard", "difficulty_best", "speedback", "nitro", "lap_flag", "power", "zipper_collect", "banana"]) {
  copy(join(code, `data/gui/icons/${name}.png`), `ui/${name}.png`);
}
copy(join(code, "data/skins/common/background.jpg"), "ui/background.jpg");
copy(join(code, "data/skins/common/bottom_bar.png"), "ui/bottom_bar.png");
copy(join(code, "data/skins/classic/glassbutton.png"), "ui/profile.png");
copy(join(code, "data/skins/common/License.txt"), "licenses/common-skin.txt");
const menuBackground = join(code, "data/skins/common/background.jpg");
const { right: menuRight, up: menuUp, forward: menuForward } = kartPreviewBasis();
const menuBackdrop = { materials: [{ texture: menuBackground, secondary: "" }], primitives: [{
  positions: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]].flatMap(([x, y]) => menuRight.map((value, axis) => value * x + menuUp[axis] * y)),
  normals: Array.from({ length: 4 }, () => menuForward.map((value) => -value)).flat(),
  uvs: [0, 1, 1, 1, 1, 0, 0, 0], colors: new Array(16).fill(1), indices: [0, 1, 2, 0, 2, 3], material: 0,
}] };
write(join(assets, "models/menu-background.glb"), writeGlb(menuBackdrop, (name) => name, new Map([[menuBackground, "unlit"]])));
copy(join(code, "data/gui/icons/licenses.txt"), "licenses/gui-icons.txt");
copy(join(code, "data/skins/cartoon/licenses.txt"), "licenses/skin.txt");
for (const name of fullScene.metadata.libraries) {
  const path = join(source, "library", name, "licenses.txt");
  if (existsSync(path)) copy(path, `licenses/library-${name}.txt`);
}
write(join(assets, "licenses/scene-instances.json"), `${JSON.stringify(fullScene.instances)}\n`);
for (const [path, target] of [
  [join(source, "licenses.txt"), "licenses/stk-assets.txt"],
  [join(track, "licenses.txt"), "licenses/lighthouse.txt"],
  [join(kart, "licenses.txt"), "licenses/tux.txt"],
  [join(source, "models/licenses.txt"), "licenses/models.txt"],
  [join(code, "data/ttf/SIL Open Font License.txt"), "licenses/OFL.txt"],
  [join(code, "COPYING"), "licenses/STK-COPYING.txt"],
] as const) copy(path, target);
copyTextMetadata(join(code, "data/ttf/LICENSE"), "licenses/fonts.txt");
write(join(assets, "licenses/source-manifest.json"), `${JSON.stringify({
  source: "https://github.com/supertuxkart/stk-assets-mobile/releases/tag/git",
  conversion: "SPM v1 to GLB; Z reflection; composed scene/library/LOD transforms baked including nonuniform scale; static opaque/masked material batching in 64m cells, transparent instances kept separate; original skybox; straight kart poses; base color only; secondary textures and skeletons omitted.",
  files: Object.fromEntries([...sourceFiles].sort(([a], [b]) => a.localeCompare(b))),
}, null, 2)}\n`);

const additionalCourses: Course[] = [], additionalScenes: MapScene[] = [];
const trackRoot = join(source, "tracks");
// Some scenes refer to textures shipped in another track's directory.
indexTextures(trackRoot);
for (const entry of readdirSync(trackRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  const id = entry.name;
  if (!entry.isDirectory() || id === "hacienda" || id === "lighthouse") continue;
  const directory = join(trackRoot, id), provenance = new Map<string, string>();
  function read(path: string): Buffer {
    const bytes = readFileSync(path);
    provenance.set(relative(source, path).replaceAll("\\", "/"), createHash("sha256").update(bytes).digest("hex"));
    return bytes;
  }
  const readXml = (path: string) => read(path).toString("utf8");
  const info = parseXml(readXml(join(directory, "track.xml"))).attributes;
  const converted = prepareScene(source, directory, read, textures, (path, data) => write(join(assets, path), data));
  const { trackModel: model, trackModelParts, skyModel, environment, view } = converted;
  const mapScene = { id, name: info.name ?? id, trackModel: model, trackModelParts, skyModel, environment, view };
  for (const file of readdirSync(directory).filter((name) => /^licen[cs]e/i.test(name) && name.endsWith(".txt"))) {
    write(join(assets, "licenses/maps", id, file), textMetadata(read(join(directory, file))));
  }
  for (const library of converted.metadata.libraries) {
    const path = join(source, "library", library, "licenses.txt");
    if (existsSync(path)) write(join(assets, "licenses/maps", id, `library-${library}.txt`), textMetadata(read(path)));
  }
  const competitive = !["arena", "soccer", "cutscene", "internal"].some((flag) => info[flag] === "Y") && id !== "overworld" && id !== "tutorial";
  if (competitive) {
    const courseRoute = driveline(directory, readXml);
    new Circuit(courseRoute);
    const courseMap = minimap(courseRoute), image = `ui/maps/${id}/minimap.png`;
    write(join(assets, image), courseMap.image);
    const courseXml = readXml(join(directory, "scene.xml"));
    const coursePickups = ["small-nitro", "big-nitro", "banana", "item"].flatMap((kind) => tags(courseXml, kind).map((item) => ({
      kind, position: vector(item.xyz ?? `${item.x} ${item.y} ${item.z}`),
    })));
    const courseMusic = info.music ? music(info.music, readXml) : audio.race;
    additionalCourses.push({ ...mapScene, route: courseRoute, pickups: coursePickups, defaultLaps: Number(info["default-number-of-laps"] ?? 3), music: courseMusic, minimap: { ...courseMap.bounds, image } });
  } else additionalScenes.push(mapScene);
  write(join(assets, "licenses/maps", id, "source-manifest.json"), `${JSON.stringify(Object.fromEntries([...provenance].sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
}
write(join(project, "modules/stk-car/game/src/additional-map-data.ts"), `// Generated by npm run prepare:assets from the supplied STK assets.\nimport type { Course, MapScene } from "./courses.js";\nexport const additionalCourses: Course[] = ${JSON.stringify(additionalCourses)};\nexport const additionalScenes: MapScene[] = ${JSON.stringify(additionalScenes)};\n`);
console.log(`Prepared Lighthouse (${fullScene.metadata.modelInstances} model instances, ${fullScene.metadata.libraryInstances} library instances, ${route.length} route nodes), ${karts.length} karts and ${pickups.length} pickups.`);
console.log(`Prepared ${additionalCourses.length} additional race courses and ${additionalScenes.length} scene previews.`);
write(join(assets, "asset-manifest.json"), `${JSON.stringify({ files: [...generatedFiles].sort() }, null, 2)}\n`);
