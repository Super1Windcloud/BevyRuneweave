import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

type Platform = "windows" | "macos" | "linux" | "android" | "ios";
const platforms: Platform[] = ["windows", "macos", "linux", "android", "ios"];
const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.env.RUNEWEAVE_DIST_DIR ?? join(root, "dist", "runtimes"));
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join(root, "target"));
const platformArg = process.argv[2];
const options = process.argv.slice(3);
const capabilityOptions = {
  "--documentation": "documentation",
  "--dynamic-components": "dynamic_components",
  "--script-systems": "script_systems",
  "--full-scripting": "full_scripting",
} as const;
const supportedOptions = new Set(["--release", ...Object.keys(capabilityOptions)]);
const unknownOptions = options.filter((option) => !supportedOptions.has(option));
if (unknownOptions.length) throw new Error(`Unsupported argument: ${unknownOptions.join(", ")}`);
const profile = options.includes("--release") ? "release" : "debug";
const cargoProfileArgs = profile === "release" ? ["--release"] : [];
const cargoFeatures = [...new Set(options.flatMap((option) => option in capabilityOptions
  ? [capabilityOptions[option as keyof typeof capabilityOptions]]
  : []))];
const cargoFeatureArgs = cargoFeatures.length ? ["--features", cargoFeatures.join(",")] : [];
const capabilities = cargoFeatures.includes("full_scripting")
  ? ["documentation", "dynamic_components", "script_systems"]
  : cargoFeatures;

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
function crossCargoArgs(target: string) {
  if (target.endsWith("-pc-windows-msvc")) {
    try {
      output("cargo", ["xwin", "--version"]);
    } catch {
      throw new Error("Cross-compiling MSVC Windows runtimes requires cargo-xwin; install it with 'cargo install cargo-xwin'");
    }
    return ["xwin", "build"];
  }
  try {
    output("zig", ["version"]);
    output("cargo-zigbuild", ["--version"]);
  } catch {
    throw new Error("Cross-compiling GNU desktop runtimes requires Zig and cargo-zigbuild; install them with 'brew install zig' and 'cargo install cargo-zigbuild'");
  }
  return ["zigbuild"];
}
function isAndroidNdk(directory: string) {
  return existsSync(join(directory, "source.properties")) && existsSync(join(directory, "toolchains", "llvm", "prebuilt"));
}
function androidNdk() {
  const configured = process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT;
  if (configured) {
    const directory = resolve(configured);
    if (!isAndroidNdk(directory)) throw new Error(`Configured Android NDK is invalid: ${directory}`);
    return directory;
  }

  const defaults = process.platform === "darwin"
    ? [join(homedir(), "Library", "Android", "sdk")]
    : process.platform === "win32"
      ? [join(process.env.LOCALAPPDATA ?? homedir(), "Android", "Sdk")]
      : [join(homedir(), "Android", "Sdk")];
  const sdkRoots = [...new Set([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    ...defaults,
  ].filter((value): value is string => Boolean(value)).map((value) => resolve(value)))];

  for (const sdk of sdkRoots) {
    const sideBySide = join(sdk, "ndk");
    if (existsSync(sideBySide)) {
      const versions = readdirSync(sideBySide, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && isAndroidNdk(join(sideBySide, entry.name)))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      if (versions[0]) return join(sideBySide, versions[0]);
    }
    const legacy = join(sdk, "ndk-bundle");
    if (isAndroidNdk(legacy)) return legacy;
  }
  throw new Error("Android NDK was not found; install it with sdkmanager 'ndk;<version>' or set ANDROID_NDK_HOME");
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
  writeFileSync(join(destination, "build-info.txt"), `package=${platform === "ios" ? "bevy-runeweave-runtime-staticlib" : "bevy-runeweave-runtime-cdylib"}\nplatform=${platform}\nbackends=lua,quickjs\nscript_languages=lua,js,typescript\ncapabilities=${capabilities.join(",")}\ntarget=${target}\nprofile=${profile}\n`, "ascii");
}
function desktop(platform: Exclude<Platform, "android" | "ios">) {
  if (platform === "macos" && hostOs() !== "macos") throw new Error("macOS runtimes can only be built on macOS");
  const fallback = platform === hostOs() ? hostTarget() : platform === "windows" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
  for (const target of values(`${platform.toUpperCase()}_TARGETS`, fallback)) {
    if (targetPlatform(target) !== platform) throw new Error(`Target '${target}' does not belong to platform '${platform}'`);
    requireTarget(target);
    const cross = target !== hostTarget();

    const staging = resolve(dist, platform, `.staging-${target}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true }); mkdirSync(join(staging, "lib"), { recursive: true });
    cpSync(join(root, "include", "game_runtime.h"), join(staging, "game_runtime.h"));
    const extension = platform === "windows" ? ".dll" : platform === "macos" ? ".dylib" : ".so";
    const libraryName = platform === "windows" ? "bevy_runeweave.dll" : `libbevy_runeweave${extension}`;
    const cargoArgs = cross ? crossCargoArgs(target) : ["build"];
    run("cargo", [...cargoArgs, ...cargoProfileArgs, ...cargoFeatureArgs, "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--target", target]);
    cpSync(join(targetDir, target, profile, libraryName), join(staging, "lib", libraryName));
    if (platform === "macos") run("install_name_tool", ["-id", "@rpath/libbevy_runeweave.dylib", join(staging, "lib", libraryName)]);
    info(staging, platform, target);
    const destination = resolve(dist, platform, target);
    rmSync(destination, { recursive: true, force: true }); mkdirSync(resolve(destination, ".."), { recursive: true });
    renameSync(staging, destination);
    console.log(`Runtime package: ${destination}`);
  }
}
function android() {
  const mapping: Record<string, string> = {
    "arm64-v8a": "aarch64-linux-android",
    x86_64: "x86_64-linux-android",
  };
  const androidOutput = resolve(dist, "android");
  if (existsSync(androidOutput)) {
    for (const entry of readdirSync(androidOutput, { withFileTypes: true })) {
      if (entry.isDirectory() && !mapping[entry.name]) {
        rmSync(join(androidOutput, entry.name), { recursive: true, force: true });
      }
    }
  }
  const ndk = androidNdk();
  console.log(`Android NDK: ${ndk}`);
  for (const abi of values("ANDROID_ABIS", "arm64-v8a,x86_64")) {
    const target = mapping[abi]; if (!target) throw new Error(`Unsupported Android ABI '${abi}'; supported ABIs: arm64-v8a, x86_64`); requireTarget(target);
    const destination = fresh("android", abi);
    run("cargo", ["ndk", "-t", abi, "-P", process.env.ANDROID_PLATFORM ?? "26", "-o", join(destination, "lib"), "build", ...cargoProfileArgs, ...cargoFeatureArgs, "--lib", "-p", "bevy-runeweave-runtime-cdylib"], { ANDROID_NDK_HOME: ndk, ANDROID_NDK_ROOT: ndk });
    const nested = join(destination, "lib", abi, "libbevy_runeweave.so");
    if (!existsSync(nested)) throw new Error(`Android runtime was not produced for ${abi}`);
    renameSync(nested, join(destination, "lib", "libbevy_runeweave.so")); rmSync(join(destination, "lib", abi), { recursive: true });
    info(destination, "android", target);
  }
}
function vendoredLua(target: string) {
  const buildRoot = join(targetDir, target, profile, "build");
  const library = readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mlua-sys-"))
    .map((entry) => join(buildRoot, entry.name, "out", "lib", "liblua5.5.a"))
    .find((candidate) => existsSync(candidate));
  if (!library) throw new Error(`Vendored Lua library was not produced for ${target}`);
  return library;
}
function ios() {
  if (hostOs() !== "macos") throw new Error("iOS runtimes can only be built on macOS");
  const device = values("IOS_DEVICE_TARGETS", "aarch64-apple-ios");
  const work = join(tmpdir(), `runeweave-ios-${process.pid}`); rmSync(work, { recursive: true, force: true }); mkdirSync(join(work, "device"), { recursive: true });
  try {
    for (const target of device) {
      requireTarget(target); run("cargo", ["build", ...cargoProfileArgs, ...cargoFeatureArgs, "--lib", "-p", "bevy-runeweave-runtime-staticlib", "--target", target], { IPHONEOS_DEPLOYMENT_TARGET: process.env.IOS_DEPLOYMENT_TARGET ?? "13.0" });
      run("libtool", ["-static", "-o", join(work, "device", `${target}.a`), join(targetDir, target, profile, "libbevy_runeweave.a"), vendoredLua(target)]);
    }
    const deviceLib = join(work, "libbevy_runeweave-device.a");
    const deviceInputs = readdirSync(join(work, "device")).map((x) => join(work, "device", x));
    if (deviceInputs.length === 0) throw new Error("No iOS device targets were configured");
    if (deviceInputs.length === 1) cpSync(deviceInputs[0], deviceLib);
    else run("lipo", ["-create", ...deviceInputs, "-output", deviceLib]);
    const destination = fresh("ios", "xcframework");
    run("xcodebuild", ["-create-xcframework", "-library", deviceLib, "-headers", join(root, "include"), "-output", join(destination, "lib", "BevyRuneweave.xcframework")]);
    info(destination, "ios", device.join(","));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (["-h", "--help"].includes(platformArg)) { console.log("Usage: npm exec -- tsx scripts/build-runtime.ts <windows|macos|linux|android|ios> [--release] [--documentation] [--dynamic-components] [--script-systems] [--full-scripting]"); process.exit(0); }
if (!platforms.includes(platformArg as Platform)) throw new Error("Unsupported or missing platform");
mkdirSync(dist, { recursive: true });
const platform = platformArg as Platform;
platform === "android" ? android() : platform === "ios" ? ios() : desktop(platform);
console.log(`Runtime packages are available under ${dist}`);
