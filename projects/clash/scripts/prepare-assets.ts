import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extractedRoot = resolve(projectRoot, "../../assets/clash/image/chr");
const outputRoot = join(projectRoot, "modules/clash/game/assets/local-clash");
const files = ["chr_king.png"];

if (existsSync(extractedRoot)) {
  mkdirSync(outputRoot, { recursive: true });
  for (const file of files) {
    const source = join(extractedRoot, file);
    if (existsSync(source)) cpSync(source, join(outputRoot, file));
  }
}
