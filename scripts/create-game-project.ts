import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

type Language = "js" | "ts" | "lua";

interface EngineConfig {
  schemaVersion: number;
  name: string;
  version: string;
  script: { language: string; entry: string };
  [key: string]: unknown;
}

const root = resolve(import.meta.dirname, "..");
const language = argument("language") as Language | undefined;
const name = argument("name");

function argument(key: string) {
  return process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
}

function validate() {
  if (!language || !(["js", "ts", "lua"] as const).includes(language)) {
    throw new Error("--language must be js, ts, or lua");
  }
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error("--name must start with a lowercase letter and contain only lowercase letters, digits, or hyphens");
  }
}

async function main() {
  validate();
  const template = join(root, "templates", "game-project", language!);
  const destination = join(root, "projects", name!);
  if (!existsSync(template)) throw new Error(`Template module is missing: ${template}`);
  if (existsSync(destination)) throw new Error(`Game module already exists: ${destination}`);

  mkdirSync(join(root, "projects"), { recursive: true });
  cpSync(template, destination, { recursive: true });

  const module = join(destination, "modules", "shooter");
  const configPath = join(module, "game", "assets", "engineConfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as EngineConfig;
  config.name = name!;
  writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`, "utf8");

  const moduleInfo = {
    schemaVersion: 1,
    name,
    language,
    sourceDirectory: language === "ts" ? "game/src" : "game/assets",
    assetDirectory: "game/assets",
    scriptEntry: config.script.entry,
  };
  writeFileSync(join(module, "module.json"), `${JSON.stringify(moduleInfo, null, 4)}\n`, "utf8");

  const cargoPath = join(destination, "Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8").replace(
    /^name = ".*"$/m,
    `name = "${name}-${language}"`,
  );
  writeFileSync(cargoPath, cargo, "utf8");

  if (language === "ts") {
    const packagePath = join(destination, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
    packageJson.name = `@runeweave/${name}`;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const lockPath = join(destination, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      name?: string;
      packages?: Record<string, { name?: string }>;
    };
    lock.name = `@runeweave/${name}`;
    if (lock.packages?.[""]) lock.packages[""].name = `@runeweave/${name}`;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    await build({
      entryPoints: [join(module, "game", "src", "shooter.ts")],
      outfile: join(module, "game", "assets", "shooter.js"),
      bundle: true,
      format: "iife",
      target: "es2023",
    });
  }

  console.log(`Created independent ${language} game project: ${destination}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
