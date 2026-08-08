import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

type Platform = "windows" | "macos" | "linux" | "android" | "ios";
type Language = "js" | "typescript" | "lua";
const platforms: Platform[] = ["windows", "macos", "linux", "android", "ios"];
const languages: Language[] = ["js", "typescript", "lua"];
const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.env.RUNEWEAVE_DIST_DIR ?? join(root, "dist", "runtimes"));
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join(root, "target"));

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
function assets(language: Language) { return join(root, "projects", language === "typescript" ? "ts" : language, "assets"); }
function fresh(platform: Platform, language: Language, architecture: string) {
  const destination = resolve(dist, platform, language, architecture);
  if (!destination.toLowerCase().startsWith(`${dist.toLowerCase()}${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`Refusing to replace output outside ${dist}`);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(join(destination, "lib"), { recursive: true });
  cpSync(join(root, "include", "game_runtime.h"), join(destination, "game_runtime.h"));
  cpSync(assets(language), join(destination, "assets"), { recursive: true });
  return destination;
}
function info(destination: string, platform: Platform, language: Language, target: string) {
  writeFileSync(join(destination, "build-info.txt"), `package=${platform === "ios" ? "bevy-runeweave-runtime-staticlib" : "bevy-runeweave-runtime-cdylib"}\nplatform=${platform}\nlanguage=${language}\ntarget=${target}\nprofile=release\n`, "ascii");
}
function copyArtifacts(source: string, destination: string, extension: string) {
  const files = readdirSync(source).filter((name) => name.endsWith(extension));
  if (!files.length) throw new Error(`No ${extension} runtime libraries found in ${source}`);
  for (const name of files) cpSync(join(source, name), join(destination, "lib", name));
}
function desktop(platform: Exclude<Platform, "android" | "ios">, language: Language) {
  const host = hostTarget();
  const defaults = platform === "windows" ? (hostOs() === "windows" ? host : "x86_64-pc-windows-gnu") : platform === "linux" ? (hostOs() === "linux" ? host : "x86_64-unknown-linux-gnu") : host;
  if (platform === "macos" && hostOs() !== "macos") throw new Error("macOS runtimes can only be built on macOS");
  const variable = `${platform.toUpperCase()}_TARGETS`;
  for (const target of values(variable, defaults)) {
    requireTarget(target);
    const destination = fresh(platform, language, target);
    const cross = target !== host && platform !== "macos";
    run("cargo", [cross ? "zigbuild" : "build", "--release", "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--no-default-features", "--features", language, "--target", target]);
    const extension = platform === "windows" ? ".dll" : platform === "macos" ? ".dylib" : ".so";
    copyArtifacts(join(targetDir, target, "release"), destination, extension);
    if (platform === "macos") run("install_name_tool", ["-id", "@rpath/libbevy_runeweave.dylib", join(destination, "lib", "libbevy_runeweave.dylib")]);
    info(destination, platform, language, target);
  }
}
function android(language: Language) {
  const mapping: Record<string, string> = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7-linux-androideabi", x86_64: "x86_64-linux-android", x86: "i686-linux-android" };
  if (!process.env.ANDROID_NDK_HOME && !process.env.ANDROID_NDK_ROOT) throw new Error("Set ANDROID_NDK_HOME to the Android NDK directory");
  for (const abi of values("ANDROID_ABIS", "arm64-v8a,armeabi-v7a,x86_64")) {
    const target = mapping[abi]; if (!target) throw new Error(`Unsupported Android ABI: ${abi}`); requireTarget(target);
    const destination = fresh("android", language, abi);
    run("cargo", ["ndk", "-t", abi, "-p", process.env.ANDROID_PLATFORM ?? "26", "-o", join(destination, "lib"), "build", "--release", "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--no-default-features", "--features", language]);
    const nested = join(destination, "lib", abi, "libbevy_runeweave.so");
    if (!existsSync(nested)) throw new Error(`Android runtime was not produced for ${abi}`);
    renameSync(nested, join(destination, "lib", "libbevy_runeweave.so")); rmSync(join(destination, "lib", abi), { recursive: true });
    info(destination, "android", language, target);
  }
}
function ios(language: Language) {
  if (hostOs() !== "macos") throw new Error("iOS runtimes can only be built on macOS");
  const device = values("IOS_DEVICE_TARGETS", "aarch64-apple-ios"), simulator = values("IOS_SIMULATOR_TARGETS", "aarch64-apple-ios-sim");
  const work = join(tmpdir(), `runeweave-ios-${process.pid}`); rmSync(work, { recursive: true, force: true }); mkdirSync(join(work, "device"), { recursive: true }); mkdirSync(join(work, "simulator"));
  try {
    for (const [group, targets] of [["device", device], ["simulator", simulator]] as const) for (const target of targets) {
      requireTarget(target); run("cargo", ["build", "--release", "--lib", "-p", "bevy-runeweave-runtime-staticlib", "--no-default-features", "--features", language, "--target", target], { IPHONEOS_DEPLOYMENT_TARGET: process.env.IOS_DEPLOYMENT_TARGET ?? "13.0" });
      cpSync(join(targetDir, target, "release", "libbevy_runeweave.a"), join(work, group, `${target}.a`));
    }
    const deviceLib = join(work, "libbevy_runeweave-device.a"), simulatorLib = join(work, "libbevy_runeweave-simulator.a");
    run("lipo", ["-create", ...readdirSync(join(work, "device")).map((x) => join(work, "device", x)), "-output", deviceLib]);
    run("lipo", ["-create", ...readdirSync(join(work, "simulator")).map((x) => join(work, "simulator", x)), "-output", simulatorLib]);
    const destination = fresh("ios", language, "xcframework");
    run("xcodebuild", ["-create-xcframework", "-library", deviceLib, "-headers", join(root, "include"), "-library", simulatorLib, "-headers", join(root, "include"), "-output", join(destination, "lib", "BevyRuneweave.xcframework")]);
    info(destination, "ios", language, `${device.join(",")};${simulator.join(",")}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

function unifiedDesktop(platform: "windows" | "macos" | "linux") {
  if (hostOs() !== platform) throw new Error(`The unified ${platform} runtime must be built on ${platform}`);
  const target = hostTarget();
  const staging = resolve(dist, platform, `.unified-${target}-${process.pid}`);
  rmSync(staging, { recursive: true, force: true }); mkdirSync(join(staging, "lib"), { recursive: true });
  const extension = platform === "windows" ? ".dll" : platform === "macos" ? ".dylib" : ".so";
  const libraryName = platform === "windows" ? "bevy_runeweave.dll" : `libbevy_runeweave${extension}`;
  for (const language of languages) {
    requireTarget(target);
    run("cargo", ["build", "--release", "--lib", "-p", "bevy-runeweave-runtime-cdylib", "--no-default-features", "--features", language, "--target", target]);
    const libraryDirectory = join(staging, "lib", language); mkdirSync(libraryDirectory, { recursive: true });
    cpSync(join(targetDir, target, "release", libraryName), join(libraryDirectory, libraryName));
  }
  run("cargo", ["build", "--release", "--manifest-path", join(root, "examples", "desktop-demo-host", "Cargo.toml"), "--target", target, "--target-dir", targetDir]);
  const executableName = platform === "windows" ? "bevy-runeweave-demo.exe" : "bevy-runeweave-demo";
  const packagedName = platform === "windows" ? "bevy-runeweave-runtime.exe" : "bevy-runeweave-runtime";
  cpSync(join(targetDir, target, "release", executableName), join(staging, packagedName));
  writeFileSync(join(staging, "build-info.txt"), `package=bevy-runeweave-unified-runtime\nplatform=${platform}\nlanguages=${languages.join(",")}\ntarget=${target}\nprofile=release\n`, "ascii");
  const destination = resolve(dist, platform, "unified", target);
  rmSync(destination, { recursive: true, force: true }); mkdirSync(resolve(destination, ".."), { recursive: true });
  renameSync(staging, destination);
  for (const language of languages) rmSync(resolve(dist, platform, language), { recursive: true, force: true });
  console.log(`Unified runtime executable: ${join(destination, packagedName)}`);
}

const platformArg = process.argv[2], languageArg = process.argv[3] ?? "all";
if (["-h", "--help"].includes(platformArg)) { console.log("Usage: npm exec -- tsx scripts/build-runtime.ts <windows|macos|linux|unified-windows|unified-macos|unified-linux|android|ios|all> [js|typescript|lua|all]"); process.exit(0); }
if (platformArg === "unified-windows" || platformArg === "unified-macos" || platformArg === "unified-linux") { unifiedDesktop(platformArg.slice(8) as "windows" | "macos" | "linux"); process.exit(0); }
const selectedPlatforms = platformArg === "all" ? platforms : platforms.includes(platformArg as Platform) ? [platformArg as Platform] : [];
const selectedLanguages = languageArg === "all" ? languages : languages.includes(languageArg as Language) ? [languageArg as Language] : [];
if (!selectedPlatforms.length || !selectedLanguages.length) throw new Error("Unsupported or missing platform/language");
mkdirSync(dist, { recursive: true });
for (const platform of selectedPlatforms) for (const language of selectedLanguages) platform === "android" ? android(language) : platform === "ios" ? ios(language) : desktop(platform, language);
console.log(`Runtime packages are available under ${dist}`);
