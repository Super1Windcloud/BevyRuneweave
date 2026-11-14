import type { SpmMesh, SpmPrimitive } from "./spm.ts";

/** Keep transparent sorting and coarse spatial culling while batching static opaque geometry. */
export function batchScene(mesh: SpmMesh, shaders: Map<string, string>): SpmMesh {
  const primitives: SpmPrimitive[] = [];
  const batches = new Map<string, SpmPrimitive>();
  for (const source of mesh.primitives) {
    const shader = shaders.get(mesh.materials[source.material].texture);
    if (shader === "alphablend" || shader === "additive") { primitives.push(source); continue; }
    const vertices = source.positions.length / 3;
    const center = [0, 1, 2].map((axis) => {
      let min = Infinity, max = -Infinity;
      for (let index = axis; index < source.positions.length; index += 3) {
        min = Math.min(min, source.positions[index]); max = Math.max(max, source.positions[index]);
      }
      return (min + max) / 2;
    });
    const key = `${source.material}:${source.uvs.length > 0}:${Math.floor(center[0] / 64)}:${Math.floor(center[2] / 64)}`;
    let target = batches.get(key);
    if (!target || target.positions.length / 3 + vertices > 65535) {
      target = { material: source.material, positions: [], normals: [], colors: [], uvs: [], indices: [] };
      primitives.push(target); batches.set(key, target);
    }
    const offset = target.positions.length / 3;
    // Avoid spread argument limits on the full track's vertex buffers.
    for (const field of ["positions", "normals", "colors", "uvs"] as const) {
      for (const value of source[field]) target[field].push(value);
    }
    for (const index of source.indices) target.indices.push(index + offset);
  }
  return { materials: mesh.materials, primitives };
}
