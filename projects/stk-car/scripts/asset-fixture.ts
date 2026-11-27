import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resourceCatalog } from "../modules/stk-car/game/src/resource-catalog.ts";

export function readLocalAsset(path: string): Buffer | undefined {
  const filename = resolve(import.meta.dirname, "../modules/stk-car/game/assets", path);
  if (!existsSync(filename) && resourceCatalog.owners[path]) return undefined;
  return readFileSync(filename);
}
