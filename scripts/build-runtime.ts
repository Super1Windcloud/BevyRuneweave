import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type Platform = "windows" | "macos" | "linux" | "android" | "ios";
const platforms: Platform[] = ["windows", "macos", "linux", "android", "ios"];
const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.env.RUNEWEAVE_DIST_DIR ?? join(root, "dist", "runtimes"));
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join(root, "target"));
const platformArg = process.argv[2];
const options = process.argv.slice(3);
const unknownOptions = options.filter((option) => option !== "--release");
if (unknownOptions.length) throw new Error(`Unsupported argument: ${unknownOptions.join(", ")}`);
const profile = options.includes("--release") ? "release" : "debug";
const cargoProfileArgs = profile === "release" ? ["--release"] : [];

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}
function output(command: string, args: string[]) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}
function hostTarget() { return output("rustc", ["-vV"]).split(/\r?\n/).find((line) => line.startsWith("host: "))!.slice(6); }
function hostOs(): Platform | "unknown" {
  const target = hostTarget();
  return target.includes("apple-darwin") ? "macos" : target.includes("pc-windows") ? "windows" : target.includes("unknown-linux") ? "linux" : "unknown";
}
function values(name: string, fallback: string) { return (process.env[name] ?? fallback).split(",").map((item) => item.trim()).filter(Boolean); }
function requireTarget(target: string) {
  if (!output("rustup", ["target", "list", "--installed"]).split(/\r?\n/).includes(target)) throw new Error(`Rust target '${target}' is not installed; run: rustup target add ${target}`);
}
function targetPlatform(target: string): Exclude<Platform, "android" | "ios"> | "unknown" {
  return target.includes("windows") ? "windows" : target.includes("apple-darwin") ? "macos" : target.includes("linux") ? "linux" : "unknown";
}
function requireCrossCompiler() {
  try {
    output("zig", ["version"]);
    output("cargo-zigbuild", ["--version"]);
  } catch {
    throw new Error("Cross-compiling desktop runtimes requires Zig and cargo-zigbuild; install them with 'brew install zig' and 'cargo install cargo-zigbuild'");
  }
}
function fresh(platform: Platform, architecture: string) {
  const destination = resolve(dist, platform, architecture);
  if (!destination.toLowerCase().startsWith(`${dist.toLowerCase()}${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`Refusing to replace output outside ${dist}`);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(join(destination, "lib"), { recursive: true });
  cpSync(join(root, "include", "game_runtime.h"), join(destination, "game_runtime.h"));
  return destination;
}
function info(destination: string, platform: Platform, target: string) {
  writeFileSync(join(destination, "build-info.txt"), `package=${platform === "ios" ? "bevy-runeweave-runtime-staticlib" : "bevy-runeweave-runtime-cdylib"}\nplatform=${platform}\nbackends=lua,quickjs\nscript_languages=lua,js,typescript\ntarget=${target}\nprofile=${profile}\n`, "ascii");
}
function desktop(platform: Exclude<Platform, "android" | "ios">) {
  if (platform === "macos" && hostOs() !== "macos") throw new Error("macOS runtimes can only be built on macOS");
  const fallback = platform === hostOs() ? hostTarget() : platform === "windows" ? "x86_64-pc-windows-gnu" : "x86_64-unknown-linux-gnu";
  for (const target of values(`${platform.toUpperCase()}_TARGETS`, fallback)) {
    if (targetPlatform(target) !== platform) throw new Error(`Target '${target}' does not belong to platform '${platform}'`);
    requireTarget(target);
    const cross = target !== hostTarget();
    if (cross) requireCrossCompiler();

    const staging = resolve(dist, platform, `.staging-${target}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true }); mkdirSync(join(staging, "lib"), { recursive: true });
    cpSync(join(root, "include", "game_runtime.h"), join(staging, "game_runtime.h"));
    const extension = platform === "windows" ? ".dll" : platform === "macos" ? ".dylib" : ".so";
    const libraryName = platform === "windows" ? "bevy_runeweave.dll" : `libbevy_runeweave${extension}`;
    const cargoCommand = cross ? "zigbuild" : "build";
    run("cargo", [cargoCommand, ...cargoProfileArgs, "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--no-default-features", "--features", "unified", "--target", target]);
    cpSync(join(targetDir, target, profile, libraryName), join(staging, "lib", libraryName));
    if (platform === "macos") run("install_name_tool", ["-id", "@rpath/libbevy_runeweave.dylib", join(staging, "lib", libraryName)]);
    run("cargo", [cargoCommand, ...cargoProfileArgs, "--manifest-path", join(root, "examples", "desktop-demo-host", "Cargo.toml"), "--target", target, "--target-dir", targetDir]);
    const executableName = platform === "windows" ? "bevy-runeweave-demo.exe" : "bevy-runeweave-demo";
    const packagedName = platform === "windows" ? "bevy-runeweave-runtime.exe" : "bevy-runeweave-runtime";
    cpSync(join(targetDir, target, profile, executableName), join(staging, packagedName));
    info(staging, platform, target);
    const destination = resolve(dist, platform, target);
    rmSync(destination, { recursive: true, force: true }); mkdirSync(resolve(destination, ".."), { recursive: true });
    renameSync(staging, destination);
    console.log(`Runtime package: ${destination}`);
  }
}
function android() {
  const mapping: Record<string, string> = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7-linux-androideabi", x86_64: "x86_64-linux-android", x86: "i686-linux-android" };
  if (!process.env.ANDROID_NDK_HOME && !process.env.ANDROID_NDK_ROOT) throw new Error("Set ANDROID_NDK_HOME to the Android NDK directory");
  for (const abi of values("ANDROID_ABIS", "arm64-v8a,armeabi-v7a,x86_64")) {
    const target = mapping[abi]; if (!target) throw new Error(`Unsupported Android ABI: ${abi}`); requireTarget(target);
    const destination = fresh("android", abi);
    run("cargo", ["ndk", "-t", abi, "-P", process.env.ANDROID_PLATFORM ?? "26", "-o", join(destination, "lib"), "build", ...cargoProfileArgs, "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--no-default-features", "--features", "unified"]);
    const nested = join(destination, "lib", abi, "libbevy_runeweave.so");
    if (!existsSync(nested)) throw new Error(`Android runtime was not produced for ${abi}`);
    renameSync(nested, join(destination, "lib", "libbevy_runeweave.so")); rmSync(join(destination, "lib", abi), { recursive: true });
    info(destination, "android", target);
  }
}
function ios() {
  if (hostOs() !== "macos") throw new Error("iOS runtimes can only be built on macOS");
  const device = values("IOS_DEVICE_TARGETS", "aarch64-apple-ios"), simulator = values("IOS_SIMULATOR_TARGETS", "aarch64-apple-ios-sim");
  const work = join(tmpdir(), `runeweave-ios-${process.pid}`); rmSync(work, { recursive: true, force: true }); mkdirSync(join(work, "device"), { recursive: true }); mkdirSync(join(work, "simulator"));
  try {
    for (const [group, targets] of [["device", device], ["simulator", simulator]] as const) for (const target of targets) {
      requireTarget(target); run("cargo", ["build", ...cargoProfileArgs, "--lib", "-p", "bevy-runeweave-runtime-staticlib", "--no-default-features", "--features", "unified", "--target", target], { IPHONEOS_DEPLOYMENT_TARGET: process.env.IOS_DEPLOYMENT_TARGET ?? "13.0" });
      cpSync(join(targetDir, target, profile, "libbevy_runeweave.a"), join(work, group, `${target}.a`));
    }
    const deviceLib = join(work, "libbevy_runeweave-device.a"), simulatorLib = join(work, "libbevy_runeweave-simulator.a");
    run("lipo", ["-create", ...readdirSync(join(work, "device")).map((x) => join(work, "device", x)), "-output", deviceLib]);
    run("lipo", ["-create", ...readdirSync(join(work, "simulator")).map((x) => join(work, "simulator", x)), "-output", simulatorLib]);
    const destination = fresh("ios", "xcframework");
    run("xcodebuild", ["-create-xcframework", "-library", deviceLib, "-headers", join(root, "include"), "-library", simulatorLib, "-headers", join(root, "include"), "-output", join(destination, "lib", "BevyRuneweave.xcframework")]);
    info(destination, "ios", `${device.join(",")};${simulator.join(",")}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (["-h", "--help"].includes(platformArg)) { console.log("Usage: npm exec -- tsx scripts/build-runtime.ts <windows|macos|linux|android|ios> [--release]"); process.exit(0); }
if (!platforms.includes(platformArg as Platform)) throw new Error("Unsupported or missing platform");
mkdirSync(dist, { recursive: true });
const platform = platformArg as Platform;
platform === "android" ? android() : platform === "ios" ? ios() : desktop(platform);
console.log(`Runtime packages are available under ${dist}`);
