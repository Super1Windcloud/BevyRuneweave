import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

interface ModuleConfig {
  language?: string;
}

const root = resolve(import.meta.dirname, "..");
const projectsRoot = resolve(root, "projects");
const projectArgument = process.argv.find((argument) => argument.startsWith("--project="))
  ?.slice("--project=".length);
const unknown = process.argv.slice(2).filter((argument) => !argument.startsWith("--project="));
if (unknown.length) throw new Error(`Unsupported argument: ${unknown.join(", ")}`);
if (!projectArgument) throw new Error("Usage: build-typescript-project.ts --project=<project-directory>");

const project = resolve(projectArgument);
const projectRelative = relative(projectsRoot, project);
if (!projectRelative || projectRelative.startsWith("..") || isAbsolute(projectRelative)) {
  throw new Error(`TypeScript project must be a direct child of ${projectsRoot}: ${project}`);
}
if (dirname(project) !== projectsRoot) {
  throw new Error(`TypeScript project must be a direct child of ${projectsRoot}: ${project}`);
}

const modulesRoot = resolve(project, "modules");
if (!existsSync(modulesRoot)) throw new Error(`Project has no modules directory: ${project}`);
const moduleFiles = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(modulesRoot, entry.name, "module.json")))
  .map((entry) => resolve(modulesRoot, entry.name, "module.json"));
if (moduleFiles.length !== 1) {
  throw new Error(`Project must contain exactly one module.json: ${project}`);
}
const config = JSON.parse(readFileSync(moduleFiles[0]!, "utf8")) as ModuleConfig;
if (config.language !== "ts") throw new Error(`Project module is not TypeScript: ${moduleFiles[0]}`);

const packageFile = resolve(project, "package.json");
if (!existsSync(packageFile)) throw new Error(`TypeScript project has no package.json: ${project}`);
const packageJson = JSON.parse(readFileSync(packageFile, "utf8")) as { scripts?: { build?: unknown } };
if (typeof packageJson.scripts?.build !== "string") {
  throw new Error(`TypeScript project has no npm build script: ${packageFile}`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
console.log(`Compiling TypeScript project: ${projectRelative}`);
execFileSync(npm, ["run", "build"], {
  cwd: project,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
