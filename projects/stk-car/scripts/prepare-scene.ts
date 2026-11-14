import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bakePrimitive, identity, multiply, parseXml, skyMesh, sourceTransform, type XmlNode } from "./scene-source.ts";
import { readSpm, writeGlb, type SpmMesh } from "./spm.ts";
import { batchScene } from "./batch-scene.ts";

export function prepareScene(source: string, track: string, record: (path: string) => Buffer, textureIndex: Map<string, string>, write: (relative: string, data: Buffer) => void) {
  const merged: SpmMesh = { materials: [], primitives: [] };
  const shaders = new Map<string, string>();
  const meshCache = new Map<string, SpmMesh>();
  const materialCache = new Map<string, number>();
  const libraries = new Set<string>();
  const instances: { model: string; category: string; matrix: number[] }[] = [];
  const document = (path: string) => parseXml(record(path).toString());
  const scene = document(join(track, "scene.xml"));
  const trackInfo = document(join(track, "track.xml")).attributes;
  const trackId = basename(track), daytime = trackInfo["is-during-day"] === "Y";
  function texture(directory: string, name: string): string {
    const local = join(directory, basename(name));
    const path = existsSync(local) ? local : textureIndex.get(basename(name));
    if (!path) throw new Error(`Missing ${name} in ${directory}`);
    record(path);
    return path;
  }
  function append(path: string, matrix: number[], category: string) {
    let mesh = meshCache.get(path);
    if (!mesh) { mesh = readSpm(record(path)); meshCache.set(path, mesh); }
    const materialFile = join(dirname(path), "materials.xml");
    const specs = existsSync(materialFile) ? document(materialFile).children.filter((child) => child.tag === "material") : [];
    const indices = mesh.materials.map((material) => {
      const resolved = material.texture ? texture(dirname(path), material.texture) : "";
      const shader = specs.find((spec) => spec.attributes.name === material.texture)?.attributes.shader ?? "solid";
      const key = `${resolved}:${shader}`;
      let index = materialCache.get(key);
      if (index === undefined) {
        index = merged.materials.length;
        materialCache.set(key, index);
        // One texture can have different material settings in different source scopes.
        const name = resolved ? `${index}:${resolved}` : "";
        merged.materials.push({ texture: name, secondary: "" });
        shaders.set(name, shader);
      }
      return index;
    });
    for (const primitive of mesh.primitives) merged.primitives.push(bakePrimitive(primitive, matrix, indices[primitive.material]));
    instances.push({ model: path.slice(source.length + 1).replaceAll("\\", "/"), category, matrix });
  }
  function walk(node: XmlNode, directory: string, parent: number[], groups: Map<string, XmlNode>, stack: string[], category: string): void {
    if (node.tag === "lod") return;
    const attrs = node.attributes;
    if (attrs.interaction === "physics-only" || attrs.if === "isEasterEgg") return;
    const matrix = multiply(parent, sourceTransform(attrs));
    if (node.tag === "library") {
      const name = attrs.name;
      if (!/^[\w-]+$/.test(name) || stack.includes(name)) throw new Error(`Invalid or recursive library ${name}`);
      libraries.add(name);
      walk(document(join(source, "library", name, "node.xml")), join(source, "library", name), matrix, new Map(), [...stack, name], "library");
      return;
    }
    if (node.tag === "scene") {
      groups = new Map(groups);
      for (const lod of node.children.filter((child) => child.tag === "lod")) for (const group of lod.children) {
        const selected = [...group.children].sort((a, b) => Number(a.attributes.lod_distance) - Number(b.attributes.lod_distance))[0];
        if (selected) groups.set(group.attributes.name, selected);
      }
    }
    const model = attrs.model ?? (attrs.lod_instance === "true" ? groups.get(attrs.lod_group)?.attributes.model : undefined);
    if (model) append(join(directory, model), matrix, attrs.lod_instance === "true" ? `${category}-lod` : category);
    for (const child of node.children) walk(child, directory, matrix, groups, stack, category);
  }
  walk(scene, track, identity(), new Map(), [], "track");
  const batched = batchScene(merged, shaders);
  console.log(`${trackId} static primitives: ${merged.primitives.length} -> ${batched.primitives.length}`);
  write(`models/${trackId}-scene.glb`, writeGlb(batched, (name) => name.slice(name.indexOf(":") + 1), shaders));
  const skyTextures = scene.children.find((child) => child.tag === "sky-box")!.attributes.texture.split(/\s+/).map((name) => texture(track, name));
  write(`models/${trackId}-sky.glb`, writeGlb(skyMesh(skyTextures), (name) => name, new Map(skyTextures.map((name) => [name, "unlit"]))));
  const sun = scene.children.find((child) => child.tag === "sun")!.attributes;
  const color = (value: string) => value.trim().split(/\s+/).map((channel) => Number(channel) / 255);
  const metadata = { modelInstances: instances.length, libraryInstances: scene.children.filter((child) => child.tag === "library").length,
    lodInstances: instances.filter((instance) => instance.category.endsWith("-lod")).length, libraries: [...libraries].sort(),
    sourceModels: meshCache.size, triangles: merged.primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0) };
  const skyColor = scene.children.find((child) => child.tag === "sky-color")?.attributes.rgb;
  return { trackModel: `models/${trackId}-scene.glb`, skyModel: `models/${trackId}-sky.glb`, metadata, instances,
    environment: { ambient: color(sun.ambient), brightness: daytime ? 1500 : 350, sun: color(sun["sun-diffuse"]), illuminance: daytime ? 50000 : 6000,
      direction: sun.xyz.split(/\s+/).map((value, axis) => Number(value) * (axis === 2 ? -1 : 1)),
      background: skyColor ? color(skyColor) : daytime ? [0.5, 0.7, 1] : [0.05, 0.08, 0.12],
      fog: sun.fog === "true" ? { color: [...color(sun["fog-color"]), Number(sun["fog-max"])], start: Number(sun["fog-start"]), end: Number(sun["fog-end"]) } : null },
  };
}
