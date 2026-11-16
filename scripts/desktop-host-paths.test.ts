import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "target/desktop-host-path-tests");
const executables: string[] = [];
let fixtures: string;

function file(path: string, contents = "fixture"): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function assets(path: string): string {
  file(join(path, "engineConfig.json"), JSON.stringify({
    schemaVersion: 1, name: "test-game", version: "1", script: { language: "lua", entry: "main.lua" },
  }));
  file(join(path, "main.lua"), "-- asset fixture");
  return path;
}

function repository(path: string): string {
  file(join(path, "include/game_runtime.h"));
  return path;
}

before(() => {
  mkdirSync(output, { recursive: true });
  // Install-layout fixtures must be outside the real checkout so repository
  // discovery cannot accidentally hide a broken standalone-app resolution.
  // Compilation stays in the workspace's existing target directory.
  fixtures = mkdtempSync(join(tmpdir(), "runeweave-desktop-paths-"));
  mkdirSync(join(fixtures, "unrelated"));
  const driver = join(output, "main.rs");
  writeFileSync(driver, String.raw`
#[path = ${JSON.stringify(join(root, "examples/desktop-demo-host/src/paths.rs"))}]
mod paths;
use std::path::{Path, PathBuf};
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let optional = |index: usize| args.get(index).filter(|value| value.as_str() != "::none::")
        .map(|value| PathBuf::from(value.as_str()));
    let result = match args[1].as_str() {
        "data" => paths::data_root(optional(2), optional(3)),
        "platform-data" => paths::data_root(optional(3),
            paths::data_base(&args[2], optional(4), optional(5), optional(6))),
        "assets" => paths::default_assets_root(Path::new(&args[2])),
        "library" => paths::runtime_library_path(Path::new(&args[2]), &args[3], &args[4], &args[5]),
        "icon" => paths::runtime_icon_path(Path::new(&args[2]), Path::new(&args[3])),
        _ => panic!("unknown path operation"),
    };
    match result { Some(path) => println!("{}", path.display()), None => println!("::none::") }
}
`);
  for (const [profile, assertions, optimization] of [["debug", "yes", "0"], ["release", "no", "2"]]) {
    const executable = join(output, `${profile}${process.platform === "win32" ? ".exe" : ""}`);
    execFileSync("rustc", [
      "--edition=2024", "-C", `debug-assertions=${assertions}`, "-C", `opt-level=${optimization}`,
      driver, "-o", executable,
    ], { cwd: root, stdio: "pipe" });
    executables.push(executable);
  }
});

after(() => { if (fixtures) rmSync(fixtures, { recursive: true, force: true }); });

function resolves(args: string[], expected: string | null, cwd = join(fixtures, "unrelated")): void {
  for (const executable of executables) {
    const actual = execFileSync(executable, args, { cwd, encoding: "utf8" }).trim();
    assert.equal(actual, expected ?? "::none::", `${executable}: ${args.join(" ")}`);
  }
}

test("Debug and Release share the absolute user data root and custom override", () => {
  const base = join(fixtures, "user-data"), custom = join(fixtures, "custom-data");
  resolves(["data", "::none::", base], join(base, "Bevy RuneWeave"));
  resolves(["data", custom, base], custom);
  resolves(["data", custom, "::none::"], custom);
});

test("Windows, macOS and Linux use their platform data directories in both profiles", () => {
  const local = join(fixtures, "Local AppData"), home = join(fixtures, "user-home"), xdg = join(fixtures, "xdg-data");
  resolves(["platform-data", "windows", "::none::", local, home, xdg], join(local, "Bevy RuneWeave"));
  resolves(["platform-data", "macos", "::none::", local, home, xdg], join(home, "Library/Application Support/Bevy RuneWeave"));
  resolves(["platform-data", "linux", "::none::", local, home, xdg], join(xdg, "Bevy RuneWeave"));
  for (const platform of ["windows", "macos", "linux"]) {
    const custom = join(fixtures, "explicit-data");
    resolves(["platform-data", platform, custom, local, home, xdg], custom);
  }
});

test("Linux falls back to the home data directory when XDG_DATA_HOME is missing or relative", () => {
  const home = join(fixtures, "linux-home");
  for (const xdg of ["::none::", "relative-xdg", ""]) {
    resolves(["platform-data", "linux", "::none::", "::none::", home, xdg], join(home, ".local/share/Bevy RuneWeave"));
  }
  resolves(["platform-data", "windows", "::none::", "::none::", home, "::none::"], null);
});

test("relative and empty data overrides fail instead of diverging from runtime saves", () => {
  const base = join(fixtures, "user-data");
  for (const override of ["relative-data", "../other", ""]) resolves(["data", override, base], null);
  resolves(["data", "::none::", "relative-base"], null);
  resolves(["data", "::none::", "::none::"], null);
});

test("repository executables find the same default game and runtime from any working directory", () => {
  const repo = repository(join(fixtures, "source-repository"));
  const game = assets(join(repo, "projects/ts/modules/shooter/game/assets"));
  const library = file(join(repo, "dist/runtimes/macos/test-target/lib/libbevy_runeweave.dylib"));
  for (const profile of ["debug", "release"]) {
    const executableDirectory = join(repo, "target", profile);
    resolves(["assets", executableDirectory], game);
    resolves(["library", executableDirectory, "macos", "test-target", "libbevy_runeweave.dylib"], library);
  }
});

test("a standalone macOS app finds its bundled resources and dylib without a source checkout", () => {
  const contents = join(fixtures, "Applications/Bevy RuneWeave.app/Contents"), executableDirectory = join(contents, "MacOS");
  const game = assets(join(contents, "Resources/assets"));
  const library = file(join(contents, "Frameworks/libbevy_runeweave.dylib"));
  resolves(["assets", executableDirectory], game);
  resolves(["library", executableDirectory, "macos", "test-target", "libbevy_runeweave.dylib"], library);
});

test("adjacent assets and lib directories work for Windows and Linux installation layouts", () => {
  for (const [platform, name] of [["windows", "bevy_runeweave.dll"], ["linux", "libbevy_runeweave.so"]]) {
    const executableDirectory = join(fixtures, platform, "Programs/Bevy RuneWeave");
    const game = assets(join(executableDirectory, "assets"));
    const library = file(join(executableDirectory, "lib", name));
    resolves(["assets", executableDirectory], game);
    resolves(["library", executableDirectory, platform, "test-target", name], library);
  }
});

test("packaged assets and libraries take precedence even when an app is staged inside a repository", () => {
  const repo = repository(join(fixtures, "staged-repository"));
  assets(join(repo, "projects/ts/modules/shooter/game/assets"));
  file(join(repo, "dist/runtimes/macos/test-target/lib/libbevy_runeweave.dylib"));
  const contents = join(repo, "dist/Game.app/Contents"), executableDirectory = join(contents, "MacOS");
  const game = assets(join(contents, "Resources/assets"));
  const library = file(join(contents, "Frameworks/libbevy_runeweave.dylib"));
  resolves(["assets", executableDirectory], game);
  resolves(["library", executableDirectory, "macos", "test-target", "libbevy_runeweave.dylib"], library);
});

test("missing installed files never fall back to a repository in the current working directory", () => {
  const cwd = repository(join(fixtures, "misleading-working-directory"));
  assets(join(cwd, "projects/ts/modules/shooter/game/assets"));
  file(join(cwd, "dist/runtimes/macos/test-target/lib/libbevy_runeweave.dylib"));
  const executableDirectory = join(fixtures, "missing-app/Contents/MacOS");
  resolves(["assets", executableDirectory], null, cwd);
  resolves(["library", executableDirectory, "macos", "test-target", "libbevy_runeweave.dylib"], null, cwd);
});

test("runtime icon caches stay in managed game assets and never target bundled or source assets", () => {
  const data = join(fixtures, "managed-data"), managed = join(data, "test-game/assets");
  resolves(["icon", managed, data], join(managed, ".runtime-icon.png"));
  resolves(["icon", join(fixtures, "Applications/Game.app/Contents/Resources/assets"), data], null);
  resolves(["icon", join(fixtures, "source-repository/projects/ts/modules/shooter/game/assets"), data], null);
  resolves(["icon", join(fixtures, "managed-data-other/game/assets"), data], null);
});

test("the actual repository default is a valid game asset directory", () => {
  resolves(["assets", join(root, "target/debug")], join(root, "projects/ts/modules/shooter/game/assets"));
});

test("the production path resolver compiles for all three desktop targets", () => {
  const targets = execFileSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" }).trim().split(/\r?\n/);
  const required = ["aarch64-apple-darwin", "x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"];
  for (const target of required) {
    assert.ok(targets.includes(target), `Install the desktop validation target with rustup target add ${target}`);
    execFileSync("rustc", [
      "--edition=2024", "--crate-type=lib", "--emit=metadata", "--target", target,
      join(root, "examples/desktop-demo-host/src/paths.rs"), "-o", join(output, `${target}.rmeta`),
    ], { cwd: root, stdio: "pipe" });
  }
});
