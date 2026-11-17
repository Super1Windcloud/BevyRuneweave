import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { sha256, zipFiles } from "./resource-packs.ts";

const source = resolve(process.argv.find((arg) => arg.startsWith("--source="))?.slice(9) ?? process.env.STK_ASSETS ?? "../stk-assets");
const output = resolve(import.meta.dirname, "../../../dist/stk-car/source-packs"); mkdirSync(output, { recursive: true });
const files: { name: string; path: string; sha256: string; bytes: number; kind: string }[] = [];
for (const group of ["karts", "music", "tracks", "textures"]) {
  const entries: { path: string; data: Buffer }[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source symlink ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !entry.name.startsWith(".")) entries.push({ path: `stk-assets/${relative(source, path).replaceAll("\\", "/")}`, data: readFileSync(path) });
    }
  };
  visit(join(source, group));
  entries.push({ path: "stk-assets/licenses.txt", data: readFileSync(join(source, "licenses.txt")) });
  const provenance = Object.fromEntries(entries.map((entry) => [entry.path, sha256(entry.data)]));
  entries.push({ path: "source-manifest.json", data: Buffer.from(`${JSON.stringify({ schemaVersion: 1, kind: "production-source-archive", files: provenance }, null, 2)}\n`) });
  const archive = zipFiles(entries), hash = sha256(archive), name = `stk-source-${group}-${hash}.zip`, path = join(output, name);
  writeFileSync(path, archive); files.push({ name, path, sha256: hash, bytes: archive.length, kind: "source-archive" });
  console.log(`${name}: ${entries.length} files, ${(archive.length / 1048576).toFixed(2)} MiB`);
}
writeFileSync(join(output, "publication.json"), `${JSON.stringify({ tag: "stk-content-v1", files }, null, 2)}\n`);
