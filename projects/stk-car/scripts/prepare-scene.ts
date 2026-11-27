import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bakePrimitive, identity, multiply, parseXml, skyDomeMesh, skyMesh, sourceTransform, xyz, type XmlNode } from "./scene-source.ts";
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
    if (attrs.interaction === "physics-only" || attrs.if === "isEasterEgg" || attrs.scale && xyz(attrs.scale).includes(0)) return;
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
  if (!batched.primitives.length) throw new Error(`No renderable geometry for ${trackId}`);
  console.log(`${trackId} static primitives: ${merged.primitives.length} -> ${batched.primitives.length}`);
  const trackModels: string[] = [];
  const resolveTexture = (name: string) => name.slice(name.indexOf(":") + 1);
  function writePart(mesh: SpmMesh): void {
    const data = writeGlb(mesh, resolveTexture, shaders);
    // GitHub limits individual Git files to 100 MiB. Keep each part self-contained.
    if (data.length > 90 * 1024 ** 2) {
      if (mesh.primitives.length < 2) throw new Error(`Oversized GLB primitive in ${trackId}`);
      const half = Math.ceil(mesh.primitives.length / 2);
      for (const part of [mesh.primitives.slice(0, half), mesh.primitives.slice(half)]) {
        const ids = [...new Set(part.map((primitive) => primitive.material))];
        const local = new Map(ids.map((id, index) => [id, index]));
        writePart({ materials: ids.map((id) => mesh.materials[id]), primitives: part.map((primitive) => ({ ...primitive, material: local.get(primitive.material)! })) });
      }
      return;
    }
    const path = `models/${trackId}-scene${trackModels.length ? `-${trackModels.length + 1}` : ""}.glb`;
    write(path, data);
    trackModels.push(path);
  }
  writePart(batched);
  const skyBox = scene.children.find((child) => child.tag === "sky-box")?.attributes.texture;
  const skyDome = scene.children.find((child) => child.tag === "sky-dome")?.attributes;
  const skyModel = skyBox || skyDome ? `models/${trackId}-sky.glb` : "";
  if (skyBox) {
    const skyTextures = skyBox.trim().split(/\s+/).map((name) => texture(track, name));
    write(skyModel, writeGlb(skyMesh(skyTextures), (name) => name, new Map(skyTextures.map((name) => [name, "unlit"]))));
  }
  if (skyDome && !skyBox) {
    const skyTexture = texture(track, skyDome.texture);
    write(skyModel, writeGlb(skyDomeMesh(skyTexture, skyDome), (name) => name, new Map([[skyTexture, "unlit"]])));
  }
  const sun = scene.children.find((child) => child.tag === "sun")?.attributes ?? {};
  const color = (value: string) => value.trim().split(/\s+/).map((channel) => Math.min(1, Math.max(0, Number(channel) / 255)));
  const metadata = { modelInstances: instances.length, libraryInstances: scene.children.filter((child) => child.tag === "library").length,
    lodInstances: instances.filter((instance) => instance.category.endsWith("-lod")).length, libraries: [...libraries].sort(),
    sourceModels: meshCache.size, triangles: merged.primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0) };
  const skyColor = scene.children.find((child) => child.tag === "sky-color")?.attributes.rgb;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const include = (value: number, axis: number) => {
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  };
  const starts = scene.children.filter((node) => node.tag === "start");
  // Use spawn locations where available so distant background terrain cannot frame the preview.
  if (starts.length) {
    for (const { attributes } of starts) {
      xyz(attributes.xyz ?? `${attributes.x} ${attributes.y} ${attributes.z}`).forEach((value, axis) => { include(axis === 2 ? -value : value, axis); });
    }
  } else for (const primitive of batched.primitives) primitive.positions.forEach((value, index) => { include(value, index % 3); });
  const view = { center: min.map((value, axis) => (value + max[axis]) / 2), radius: Math.max(24, ...max.map((value, axis) => (value - min[axis]) / 2)) };
  return { trackModel: trackModels[0], trackModelParts: trackModels.slice(1), skyModel, metadata, instances, view,
    environment: { ambient: color(sun.ambient ?? "128 128 128"), brightness: daytime ? 1500 : 350, sun: color(sun["sun-diffuse"] ?? "255 255 255"), illuminance: daytime ? 50000 : 6000,
      direction: (sun.xyz ?? "1 3 2").trim().split(/\s+/).map((value, axis) => Number(value) * (axis === 2 ? -1 : 1)),
      background: skyColor ? color(skyColor) : daytime ? [0.5, 0.7, 1] : [0.05, 0.08, 0.12],
      fog: sun.fog === "true" ? { color: [...color(sun["fog-color"]), Number(sun["fog-max"])], start: Number(sun["fog-start"]), end: Number(sun["fog-end"]) } : null },
  };
}
