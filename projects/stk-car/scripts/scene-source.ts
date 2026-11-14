import { type SpmMesh, type SpmPrimitive } from "./spm.ts";

export interface XmlNode { tag: string; attributes: Record<string, string>; children: XmlNode[]; }
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: "document", attributes: {}, children: [] };
  const stack = [root];
  for (const match of text.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<((?:"[^"]*"|'[^']*'|[^'">])+)>/g)) {
    const token = match[1].trim();
    if (token.startsWith("?") || token.startsWith("!")) continue;
    if (token.startsWith("/")) {
      if (stack.pop()?.tag !== token.slice(1).trim() || !stack.length) throw new Error("Mismatched XML tag");
      continue;
    }
    const attributes = Object.fromEntries([...token.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((item) => [item[1], item[3].replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code.startsWith("x") ? Number.parseInt(code.slice(1), 16) : Number(code))).replaceAll("&amp;", "&").replaceAll("&quot;", '"')]));
    const node: XmlNode = { tag: token.split(/[\s/]/)[0], attributes, children: [] };
    stack.at(-1)!.children.push(node);
    if (!token.endsWith("/")) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error("Incomplete XML document");
  return root.children[0];
}
export function xyz(value: string): number[] {
  const result = value.trim().split(/\s+/).map(Number);
  if (result.length !== 3 || !result.every(Number.isFinite)) throw new Error(`Invalid XYZ: ${value}`);
  return result;
}
export const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a: number[], b: number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return result;
}
/** Irrlicht uses Rz * Ry * Rx. Compose source-space hierarchy before reflecting Z. */
export function sourceTransform(attributes: Record<string, string>): number[] {
  const [x, y, z] = xyz(attributes.xyz ?? `${attributes.x ?? 0} ${attributes.y ?? 0} ${attributes.z ?? 0}`);
  const [rx, ry, rz] = xyz(attributes.hpr ?? "0 0 0").map((value) => value * Math.PI / 180);
  const [sx, sy, sz] = xyz(attributes.scale ?? "1 1 1");
  const [a, b, c, d, e, f] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  return [c * e * sx, c * f * sx, -d * sx, 0, (b * d * e - a * f) * sy, (b * d * f + a * e) * sy, b * c * sy, 0,
    (a * d * e + b * f) * sz, (a * d * f - b * e) * sz, a * c * sz, 0, x, y, z, 1];
}
export function transformPoint(matrix: number[], point: readonly number[]): number[] {
  return [0, 1, 2].map((axis) => matrix[axis] * point[0] + matrix[4 + axis] * point[1] + matrix[8 + axis] * point[2] + matrix[12 + axis]);
}
export function bakePrimitive(primitive: SpmPrimitive, matrix: number[], material: number): SpmPrimitive {
  const positions: number[] = [];
  const normals: number[] = [];
  // Cofactor matrix is proportional to the inverse transpose, even after nested nonuniform scale.
  const a = [matrix[0], matrix[1], matrix[2]], b = [matrix[4], matrix[5], matrix[6]], c = [matrix[8], matrix[9], matrix[10]];
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const cofactors = [cross(b, c), cross(c, a), cross(a, b)];
  const determinant = a.reduce((sum, value, i) => sum + value * cofactors[0][i], 0);
  if (Math.abs(determinant) < 1e-10) throw new Error("Singular scene transform");
  for (let i = 0; i < primitive.positions.length; i += 3) {
    const p = transformPoint(matrix, [primitive.positions[i], primitive.positions[i + 1], -primitive.positions[i + 2]]);
    positions.push(p[0], p[1], -p[2]);
    const n = [primitive.normals[i], primitive.normals[i + 1], -primitive.normals[i + 2]];
    const transformed = [0, 1, 2].map((axis) => cofactors.reduce((sum, column, k) => sum + column[axis] * n[k], 0) / determinant);
    const length = Math.hypot(...transformed) || 1;
    normals.push(transformed[0] / length, transformed[1] / length, -transformed[2] / length);
  }
  const indices = [...primitive.indices];
  if (determinant < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return { ...primitive, positions, normals, indices, material };
}
export function skyMesh(textures: string[]): SpmMesh {
  const faces = [
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]],
    [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]],
    [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]],
    [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]],
  ];
  return { materials: textures.map((texture) => ({ texture, secondary: "" })), primitives: faces.map((face, material) => ({
    positions: face.flatMap((point) => point.map((value) => value * 750)), normals: face.flatMap((point) => point.map((value) => -value / Math.sqrt(3))),
    uvs: [0, 0, 1, 0, 1, 1, 0, 1], colors: new Array(16).fill(1), indices: [0, 1, 2, 0, 2, 3], material,
  })) };
}
