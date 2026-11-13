import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readSpm, writeGlb } from "./spm.ts";

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

function indexTextures(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) indexTextures(path);
    else if (/\.(png|jpe?g)$/i.test(entry.name) && !textures.has(entry.name)) textures.set(entry.name, path);
  }
}
function record(path: string): Buffer {
  const data = readFileSync(path);
  const relative = path.startsWith(`${source}/`) ? `stk-assets/${path.slice(source.length + 1)}` : `stk-code/${path.slice(code.length + 1)}`;
  sourceFiles.set(relative, createHash("sha256").update(data).digest("hex"));
  return data;
}
function write(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
function copy(path: string, target: string) { write(join(assets, target), record(path)); }
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
function convert(path: string, target: string): string {
  const mesh = readSpm(record(path));
  const shaders = new Map(tags(xml(join(dirname(path), "materials.xml")), "material").map((m) => [m.name, m.shader]));
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
const scene = xml(join(track, "scene.xml"));
const model = tags(scene, "track")[0].model;
const trackModel = convert(join(track, model), "models/lighthouse.glb");
const objects = tags(scene, "static-object").filter((object) => object.model && object.interaction !== "physics-only" && !["dynamicSky.spm"].includes(object.model));
const scenery = objects.map((object, index) => ({
  path: convert(join(track, object.model), `models/scenery-${index}.glb`),
  position: vector(object.xyz ?? "0 0 0"),
  rotation: (object.hpr ?? "0 0 0").split(/\s+/).map(Number),
  scale: (object.scale ?? "1 1 1").split(/\s+/).map(Number),
}));
const kartConfig = xml(join(kart, "kart.xml"));
const kartModel = convert(join(kart, tags(kartConfig, "kart")[0]["model-file"]), "models/tux.glb");
const wheels = ["front-left", "front-right", "rear-left", "rear-right"].map((tag) => {
  const wheel = tags(kartConfig, tag)[0];
  return { path: convert(join(kart, wheel.model), `models/${tag}.glb`), position: vector(wheel.position), front: tag.startsWith("front") };
});
const pickupModels = Object.fromEntries([
  ["item", "gift-box.spm"], ["banana", "banana.spm"],
  ["small-nitro", "nitrotank-small.spm"], ["big-nitro", "nitrotank-big-low.spm"],
].map(([kind, filename]) => [kind, convert(join(source, "models", filename), `models/${kind}.glb`)]));
const quads: number[][][] = [];
for (const quad of tags(xml(join(track, "quads.xml")), "quad")) {
  quads.push([0, 1, 2, 3].map((index) => {
    const value = quad[`p${index}`];
    if (!value.includes(":")) return vector(value);
    const [q, p] = value.split(":").map(Number);
    if (!quads[q]?.[p]) throw new Error(`Invalid quad reference: ${value}`);
    return [...quads[q][p]];
  }));
}
const edge = tags(xml(join(track, "graph.xml")), "edge-loop")[0];
const route = quads.slice(Number(edge.from), Number(edge.to) + 1).map((quad) => ({
  center: quad[0].map((value, axis) => (value + quad[1][axis]) / 2),
  width: Math.hypot(quad[0][0] - quad[1][0], quad[0][2] - quad[1][2]),
}));
const pickups = ["small-nitro", "big-nitro", "banana", "item"].flatMap((tag) => tags(scene, tag).map((item) => ({
  kind: tag, position: vector(`${item.x} ${item.y} ${item.z}`),
})));
const manifest = { trackModel, kartModel, wheels, scenery, route, pickups, pickupModels };
write(join(project, "modules/stk-car/game/src/track-data.ts"), `// Generated by npm run prepare:assets from STK's Lighthouse assets.\nexport const trackData = ${JSON.stringify(manifest)} as const;\n`);
copy(join(kart, "tux_icon.png"), "branding/tux.png");
copy(join(track, "screenshot.jpg"), "branding/lighthouse.jpg");
copy(join(code, "data/ttf/wqy-microhei.ttf"), "fonts/wqy-microhei.ttf");
for (const [path, target] of [
  [join(source, "licenses.txt"), "licenses/stk-assets.txt"],
  [join(track, "licenses.txt"), "licenses/lighthouse.txt"],
  [join(kart, "licenses.txt"), "licenses/tux.txt"],
  [join(source, "models/licenses.txt"), "licenses/models.txt"],
  [join(code, "data/ttf/LICENSE"), "licenses/fonts.txt"],
  [join(code, "COPYING"), "licenses/STK-COPYING.txt"],
] as const) copy(path, target);
write(join(assets, "licenses/source-manifest.json"), `${JSON.stringify({
  source: "https://github.com/supertuxkart/stk-assets-mobile/releases/tag/git",
  conversion: "SPM v1 to GLB; Z reflection with reversed winding; baked straight pose; base color only; secondary textures and skeletons omitted.",
  files: Object.fromEntries([...sourceFiles].sort(([a], [b]) => a.localeCompare(b))),
}, null, 2)}\n`);
console.log(`Prepared Lighthouse (${route.length} route nodes), Tux and ${pickups.length} pickups.`);
