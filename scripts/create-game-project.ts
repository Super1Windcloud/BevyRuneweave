import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

type Language = "js" | "ts" | "lua";

interface EngineConfig {
  schemaVersion: number;
  name: string;
  version: string;
  appName?: string;
  script: { language: string; entry: string };
  [key: string]: unknown;
}

const root = resolve(import.meta.dirname, "..");
const name = argument("name");
const languageArgument = argument("language") ?? "ts";

function argument(key: string) {
  return process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
}

function parseLanguage(value: string): Language {
  if (value === "typescript") return "ts";
  if ((["js", "ts", "lua"] as const).includes(value as Language)) return value as Language;
  throw new Error("--language must be js, ts, typescript, or lua");
}

function validateName(value: string | undefined): asserts value is string {
  if (!value || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(
      "--name must start with a lowercase letter and contain only lowercase letters, digits, or hyphens",
    );
  }
}

function requireFile(path: string, description: string) {
  if (!existsSync(path)) throw new Error(`Template is missing ${description}: ${path}`);
}

function readAndValidateConfig(template: string, language: Language) {
  const module = join(template, "modules", "shooter");
  const assetRoot = join(module, "game", "assets");
  const configPath = join(assetRoot, "engineConfig.json");
  requireFile(join(template, "Cargo.toml"), "Cargo.toml");
  requireFile(join(template, "src", "main.rs"), "Rust launcher");
  requireFile(configPath, "engineConfig.json");

  const config = JSON.parse(readFileSync(configPath, "utf8")) as EngineConfig;
  const expectedLanguage = language === "ts" ? "typescript" : language;
  if (config.schemaVersion !== 1) throw new Error("Template engineConfig schemaVersion must be 1");
  if (!config.name?.trim() || !config.version?.trim()) {
    throw new Error("Template engineConfig name and version must not be empty");
  }
  if (config.script?.language !== expectedLanguage) {
    throw new Error(
      `Template script.language must be ${expectedLanguage}, received ${config.script?.language ?? "missing"}`,
    );
  }
  const entry = config.script.entry;
  if (
    !entry ||
    entry.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(entry) ||
    entry.split(/[\\/]/).some((part) => part === "..")
  ) {
    throw new Error("Template script.entry must be a relative path inside game/assets");
  }

  if (language === "ts") {
    requireFile(join(module, "game", "src", "shooter.ts"), "TypeScript source entry");
    requireFile(join(template, "package.json"), "TypeScript package.json");
    requireFile(join(template, "package-lock.json"), "TypeScript package-lock.json");
    requireFile(join(template, "tsconfig.json"), "TypeScript tsconfig.json");
  } else {
    requireFile(join(assetRoot, entry), "runtime script entry");
  }

  return config;
}

async function main() {
  validateName(name);
  const language = parseLanguage(languageArgument);
  const template = join(root, "templates", "game-project", language);
  const projects = join(root, "projects");
  const destination = join(projects, name);
  if (!existsSync(template)) throw new Error(`Template module is missing: ${template}`);
  if (existsSync(destination)) throw new Error(`Game module already exists: ${destination}`);
  const templateConfig = readAndValidateConfig(template, language);

  mkdirSync(projects, { recursive: true });
  const stagingParent = join(root, "dist", "create-game");
  mkdirSync(stagingParent, { recursive: true });
  const stagingRoot = mkdtempSync(join(stagingParent, `${name}-`));
  const staging = join(stagingRoot, name);

  try {
    cpSync(template, staging, { recursive: true });
    const module = join(staging, "modules", "shooter");
    const configPath = join(module, "game", "assets", "engineConfig.json");
    const config = { ...templateConfig, name };
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

    const cargoPath = join(staging, "Cargo.toml");
    const originalCargo = readFileSync(cargoPath, "utf8");
    const cargo = originalCargo.replace(/^name = ".*"$/m, `name = "${name}-${language}"`);
    if (cargo === originalCargo) throw new Error("Template Cargo.toml is missing package.name");
    writeFileSync(cargoPath, cargo, "utf8");

    if (language === "ts") {
      const packagePath = join(staging, "package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
      packageJson.name = `@runeweave/${name}`;
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

      const lockPath = join(staging, "package-lock.json");
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
        name?: string;
        packages?: Record<string, { name?: string }>;
      };
      lock.name = `@runeweave/${name}`;
      if (lock.packages?.[""]) lock.packages[""].name = `@runeweave/${name}`;
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

      await build({
        absWorkingDir: staging,
        entryPoints: [join(module, "game", "src", "shooter.ts")],
        outfile: join(module, "game", "assets", "shooter.js"),
        bundle: true,
        format: "iife",
        target: "es2023",
      });
    }

    renameSync(staging, destination);
    console.log(`Created independent ${language} game project: ${destination}`);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
