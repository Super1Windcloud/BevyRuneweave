import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

test("iOS resource cleanup preserves bootstrap and unrelated files and permits reinstallation", {
  skip: process.platform !== "darwin" ? "Requires Apple's Foundation and Swift toolchain" : false,
}, () => {
  const outputRoot = join(root, "dist/mobile-resource-cleanup-tests");
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, "run-"));
  cpSync(join(root, "examples/ios-demo-host/assets"), join(directory, "assets"), { recursive: true });
  const fixture = join(directory, "game");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "engineConfig.json"), JSON.stringify({
    schemaVersion: 1, name: "Cleanup fixture", version: "1.0", script: { language: "js", entry: "game.js" },
  }));
  // JavaScript here is a generated QuickJS runtime asset, not a repository-owned script.
  writeFileSync(join(fixture, "game.js"), "globalThis.on_update = () => {};\n");
  const archive = join(directory, "game.zip");
  execFileSync("ditto", ["-c", "-k", fixture, archive]);
  const driver = join(directory, "main.swift");
  writeFileSync(driver, String.raw`
import Foundation

let files = FileManager.default
let root = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("store")
let store = try PackageStore(root: root)
let archive = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    print("PASS: \(message)")
}
try store.installBundledAssetsIfNeeded()
check((try? store.installedConfig()) == nil, "bootstrap is not an installed game")
_ = try store.install(archive: archive)
check((try? store.installedConfig())?.name == "Cleanup fixture", "real ZIP installs before cleanup")
for name in ["assets.staging", "assets.backup"] {
    let target = root.appendingPathComponent(name)
    try files.createDirectory(at: target, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: target.appendingPathComponent("partial.zip"))
}
for name in ["host.log", "settings.json", "save.dat"] {
    try Data("keep".utf8).write(to: root.appendingPathComponent(name))
}
try store.clearLocalResources()
check((try? store.installedConfig()) == nil, "installed selection clears")
check(!files.fileExists(atPath: store.installedAssets.appendingPathComponent("game.js").path), "downloaded game scripts clear")
check(!files.fileExists(atPath: root.appendingPathComponent("assets.staging").path) &&
      !files.fileExists(atPath: root.appendingPathComponent("assets.backup").path), "staging and backup clear")
check(files.fileExists(atPath: store.installedAssets.appendingPathComponent(bootstrapScriptName).path) &&
      (try? validateAssets(at: store.installedAssets)) != nil, "valid bundled bootstrap remains")
check(["host.log", "settings.json", "save.dat"].allSatisfy {
    (try? String(contentsOf: root.appendingPathComponent($0), encoding: .utf8)) == "keep"
}, "logs settings and unrelated save files remain")
try store.clearLocalResources()
check((try? store.installedConfig()) == nil, "repeated cleanup succeeds without an installed game")
_ = try store.install(archive: archive)
check((try? store.installedConfig())?.name == "Cleanup fixture", "real ZIP reinstalls after cleanup")
`);
  const executable = join(directory, "cleanup-tests");
  execFileSync("xcrun", [
    "swiftc", "-swift-version", "5",
    "-import-objc-header", join(root, "examples/ios-demo-host/Sources/BevyRuneweaveHost-Bridging-Header.h"),
    "-I", join(root, "include"), "-lz",
    ...["HostSupport.swift", "ZipInstaller.swift", "PackageStore.swift"].map((file) =>
      join(root, "examples/ios-demo-host/Sources", file)),
    driver, "-o", executable,
  ], { cwd: root, stdio: "pipe" });
  const output = execFileSync(executable, [directory, archive], { cwd: root, encoding: "utf8" });
  process.stdout.write(output);
  assert.equal((output.match(/^PASS:/gm) ?? []).length, 9);
});
