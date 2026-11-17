import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { sha256 } from "./resource-packs.ts";

const project = resolve(import.meta.dirname, "..");
const argument = (key: string) => process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const source = resolve(argument("source") ?? process.env.STK_ASSETS ?? "../stk-assets");
const code = resolve(argument("code") ?? process.env.STK_CODE ?? join(source, "../stk-code"));
const destination = join(project, "modules/stk-car/game/assets/source");
const inputs = [
  ...["models", "sfx", "library"].map((name) => ({ root: source, name, prefix: "stk-assets" })),
  ...["data/gui", "data/skins", "data/ttf", "data/replay"].map((name) => ({ root: code, name, prefix: "stk-code" })),
  { root: source, name: "licenses.txt", prefix: "stk-assets" }, { root: code, name: "COPYING", prefix: "stk-code" },
];
const manifest: Record<string, string> = {};
function copy(root: string, input: string, prefix: string): void {
  if (!existsSync(input)) throw new Error(`Missing source ${input}`);
  const target = join(destination, prefix, relative(root, input));
  mkdirSync(dirname(target), { recursive: true }); cpSync(input, target, { recursive: true });
  const record = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${file}`);
      if (entry.isDirectory()) record(file);
      else if (entry.isFile()) manifest[join(prefix, relative(root, file)).replaceAll("\\", "/")] = sha256(readFileSync(file));
    }
  };
  if (input.endsWith("COPYING") || input.endsWith("licenses.txt")) manifest[join(prefix, relative(root, input))] = sha256(readFileSync(input));
  else record(input);
}
for (const input of inputs) copy(input.root, join(input.root, input.name), input.prefix);
writeFileSync(join(destination, "source-manifest.json"), `${JSON.stringify({ schemaVersion: 1, role: "Versioned production inputs; excluded from the startup ZIP", files: manifest }, null, 2)}\n`);
console.log(`Imported ${Object.keys(manifest).length} local production source files`);
