import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type InstallerPlatform = "windows" | "macos";

const root = resolve(import.meta.dirname, "..");
const platform = process.argv[2] as InstallerPlatform | undefined;
const release = process.argv.slice(3).includes("--release");
const unknown = process.argv.slice(3).filter((argument) => argument !== "--release");
if (platform !== "windows" && platform !== "macos") throw new Error("Usage: package-desktop.ts <windows|macos> [--release]");
if (unknown.length) throw new Error(`Unsupported argument: ${unknown.join(", ")}`);

const profile = release ? "release" : "debug";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const runtimeDist = resolve(process.env.RUNEWEAVE_DIST_DIR ?? join(root, "dist", "runtimes"));
const installerDist = resolve(process.env.RUNEWEAVE_INSTALLER_DIR ?? join(root, "dist", "installers"));
const assets = join(root, "projects", "ts", "assets");

function run(command: string, args: string[]) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
}

function output(command: string, args: string[]) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function hostTarget() {
  return output("rustc", ["-vV"]).split(/\r?\n/).find((line) => line.startsWith("host: "))!.slice(6);
}

function targets() {
  const variable = platform === "windows" ? "WINDOWS_TARGETS" : "MACOS_TARGETS";
  const fallback = platform === "windows" && !hostTarget().includes("windows") ? "x86_64-pc-windows-gnu" : hostTarget();
  return (process.env[variable] ?? fallback).split(",").map((target) => target.trim()).filter(Boolean);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["exec", "--", "tsx", "scripts/build-runtime.ts", platform, ...(release ? ["--release"] : [])]);

for (const target of targets()) {
  const runtime = join(runtimeDist, platform, target);
  if (!existsSync(runtime)) throw new Error(`Runtime package is missing: ${runtime}`);
  const destination = join(installerDist, platform, profile);
  mkdirSync(destination, { recursive: true });
  const cargoCommand = target === hostTarget() ? "build" : "zigbuild";
  run("cargo", [
    cargoCommand,
    ...(release ? ["--release"] : []),
    "--manifest-path",
    join(root, "examples", "desktop-demo-host", "Cargo.toml"),
    "--target",
    target,
    "--target-dir",
    join(root, "target"),
  ]);

  const packageSource = mkdtempSync(join(tmpdir(), "runeweave-desktop-"));
  cpSync(runtime, packageSource, { recursive: true });
  const executableName = platform === "windows" ? "bevy-runeweave-demo.exe" : "bevy-runeweave-demo";
  const packagedName = platform === "windows" ? "bevy-runeweave-runtime.exe" : "bevy-runeweave-runtime";
  cpSync(join(root, "target", target, profile, executableName), join(packageSource, packagedName));

  try {
    if (platform === "windows") {
      const installer = join(destination, `Bevy-RuneWeave-${packageJson.version}-${target}-setup.exe`);
      run("makensis", [
        `-DSOURCE_DIR=${packageSource}`,
        `-DASSETS_DIR=${assets}`,
        `-DOUTPUT_FILE=${installer}`,
        `-DAPP_VERSION=${packageJson.version}`,
        join(root, "examples", "desktop-demo-host", "installers", "windows", "BevyRuneweave.nsi"),
      ]);
      console.log(`Created ${installer}`);
    } else {
      const installer = join(destination, `Bevy-RuneWeave-${packageJson.version}-${target}.dmg`);
      run("sh", [
        join(root, "examples", "desktop-demo-host", "installers", "macos", "package-dmg.sh"),
        packageSource,
        assets,
        installer,
        packageJson.version,
      ]);
    }
  } finally {
    rmSync(packageSource, { recursive: true, force: true });
  }
}
