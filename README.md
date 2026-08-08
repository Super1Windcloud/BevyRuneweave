# Bevy Runeweave

English | [简体中文](README.zh-CN.md)

**Bevy Runeweave is a game framework that weaves multiple scripting languages into a Bevy ECS world.**

`Rune` represents scripts that give the world behavior, while `Weave` describes how scripts,
components, and systems are composed inside the ECS. The framework provides windowing, input,
rendering, asset management, a scripting-facing ECS API, hot reload, and native Rust host support
on top of Bevy. Gameplay can be written in Lua 5.5, JavaScript, or TypeScript.

The repository includes an airplane shooter named **Script Squadron**. The same game is implemented
in all three languages to demonstrate language integration, isolated project layouts, asset
separation, hot reload, and cooperation between Rust and scripts.

## Features

- **Bevy ECS foundation:** scripts write components and resources; Bevy systems query, process,
  and render that data.
- **Multiple scripting languages:** Lua 5.5, JavaScript, and TypeScript are supported. QuickJS runs
  JavaScript and compiled TypeScript.
- **Scripted gameplay:** movement, weapons, enemy spawning, collisions, scoring, health, and restart
  behavior are implemented with script-side worlds, components, resources, and systems.
- **Project and asset isolation:** every language example owns its executable project, scripts, and
  assets without implicit cross-project dependencies.
- **Development hot reload:** scripts are Bevy assets and can be reloaded automatically while the
  game is running.

The primary framework package is `bevy-runeweave`, its Rust crate is `bevy_runeweave`, and the
TypeScript package is `@superwindcloud/bevy-runeweave`. The Script Squadron executables are
`script-squadron-lua`, `script-squadron-js`, and `script-squadron-typescript`.

Runeweave exposes the same Entity, Component, Resource, and Query API to all three languages. The
shooter host is responsible only for the window, keyboard input, sprite mapping, and HUD rendering;
the gameplay itself remains in Lua, JavaScript, or TypeScript.

## Project Layout

```text
projects/
├── lua/                 # Standalone Lua 5.5 executable project
│   └── assets/          # shooter.lua and isolated sprites
├── js/                  # Standalone QuickJS executable project
│   └── assets/          # shooter.js and isolated sprites
└── ts/                  # TypeScript 7.0.2 and QuickJS executable project
    ├── src/             # TypeScript gameplay source and Runeweave declarations
    └── assets/          # Compiled shooter.js and isolated sprites
src/                     # Framework core and shared Bevy host
├── ecs_api/             # Language-neutral ECS API
│   ├── bindings/        # Lua and QuickJS/TypeScript adapters
│   ├── command.rs       # Readable snapshots and queued Bevy writes
│   ├── value.rs         # Cross-language structured values
│   └── world.rs         # Entity, Component, and Resource synchronization
├── example_host.rs      # Script Squadron sprite, transform, and HUD mapping
├── runtime/             # App assembly, input callbacks, hot reload, and host entry points
└── lib.rs               # Feature constraints and public API exports
docs/ecs-api.md          # ECS API contract and examples
bevy_mod_scripting/      # Lua 5.5 and QuickJS/TypeScript runtimes
include/                 # Public native-host C ABI
examples/                # Standalone desktop, Android, and iOS hosts
```

Assets are intentionally duplicated between language projects. Each runtime receives an explicit
asset root and never loads scripts or images from another language project.

## Running

All common commands are defined in the root `justfile`:

```bash
just
```

Run an individual language implementation:

```bash
just run-lua
just run-js
just run-ts
```

Move with the arrow keys or `WASD`. Weapons fire automatically at a fixed cadence. After health
reaches zero, release and press Space again to restart. Scores continue increasing without a cap.
All three versions use equivalent parameters and random seeds for comparison.

## ECS Data Model

The framework does not expose the deprecated Roblox-style `GameApi`, service discovery, or
Workspace object model. Scripts do not receive behavior-rich game objects or ask a service to run a
predefined workflow. They describe world changes by spawning and despawning entities, inserting and
updating components, and writing resources.

The Rust host commits these writes to the Bevy World. Independent systems then update `Sprite`,
`Transform`, and HUD state from component and resource changes:

```text
Script logic -> ECS write queue -> Components / Resources -> Bevy systems -> Rendering and UI
```

The gameplay scripts follow the same data-oriented model:

- `World` stores sparse component maps keyed by stable entity IDs. Transform, Velocity, Collider,
  and Sprite data are separate, while Player, Bullet, and Enemy are tag components.
- `Resources` hold score, health, random state, spawn cooldowns, automatic-fire cooldowns, and hit
  cooldowns. Enemies leaving the screen are removed without damaging the player.
- Movement, Weapon, EnemySpawn, Bounds, and Collision systems query and update data on a fixed
  schedule instead of attaching behavior methods to entities.
- Systems mark entities for deletion and flush structural changes after iteration. RenderSync then
  submits script component data to the host ECS.

All languages share these operations:

```text
ecs_world_clear()
ecs_entity_spawn / ecs_entity_exists / ecs_entity_despawn
ecs_component_insert / ecs_component_get / ecs_component_has / ecs_component_remove
ecs_query
ecs_resource_set / ecs_resource_get / ecs_resource_remove
```

For example, a renderable entity is created with `ecs_entity_spawn`, then receives separate
`sprite` and `transform` components. Runeweave does not assign business meaning to those names; the
Script Squadron host maps their structured values to Bevy components. See
[`docs/ecs-api.md`](docs/ecs-api.md) for the complete contract.

Script files support Bevy asset hot reload. Updating the active project's script reinitializes game
state and prints `Reloading script after source change`. `just run-ts` also runs the TypeScript watch
compiler, so changes to `projects/ts/src/shooter.ts` are compiled and reloaded automatically.

## Build and Verification

Applications and `bevy_mod_scripting` crates share the root Cargo workspace, `Cargo.lock`, dependency
versions, and formatting configuration. Runtime backends are checked independently.

```bash
just check       # Check all language projects
just test        # Run gameplay tests against each script engine
just verify      # Formatting, checks, adapter tests, and gameplay tests
```

Regenerate TypeScript runtime assets after changing TypeScript source:

```bash
just ts-install
just ts-build
```

`package-lock.json` pins TypeScript 7.0.2. The compiled `assets/shooter.js` is tracked, so a global
`tsc` installation is not required just to run the game.

Build commands use the debug profile by default. Add `--release` explicitly for release builds:

```bash
just build
just build-ts --release
```

## Cross-Platform Runtime

`scripts/build-runtime.ts` packages the C ABI runtime and header under
`dist/runtimes/<platform>/<architecture>/`. Each platform architecture receives one unified runtime
containing Lua 5.5 and QuickJS; JavaScript and compiled TypeScript both execute through QuickJS.
Runtime commands also default to debug builds and accept `--release` explicitly.

```bash
just build-runtime-macos
just build-runtime-windows
just build-runtime-linux
just build-runtime-android
just build-runtime-ios

# Generic platform entry point
just build-runtime linux
```

Desktop packages include the native launcher. Windows and Linux build directly on their respective
hosts; macOS can cross-compile them with Zig, `cargo-zigbuild`, and the corresponding installed Rust
target. `WINDOWS_TARGETS` and `LINUX_TARGETS` accept comma-separated overrides. Windows defaults to
`x86_64-pc-windows-gnu` when built on macOS. Android requires `cargo-ndk`, the Android NDK,
`ANDROID_NDK_HOME`, and the relevant
Rust targets. It builds `arm64-v8a`, `armeabi-v7a`, and `x86_64` by default with API level 26. iOS
builds only on macOS with Xcode and produces `BevyRuneweave.xcframework` for arm64 devices and Apple
Silicon simulators by default.

```bash
npm exec -- tsx scripts/build-runtime.ts --help
WINDOWS_TARGETS=x86_64-pc-windows-gnu just build-runtime-windows
ANDROID_ABIS=arm64-v8a just build-runtime-android
IOS_SIMULATOR_TARGETS=aarch64-apple-ios-sim,x86_64-apple-ios just build-runtime-ios
```

The root framework produces an `rlib`. `crates/runtime-cdylib` produces native libraries for
Windows, macOS, Linux, and Android; `crates/runtime-staticlib` produces the iOS XCFramework. The
public host header is [`include/game_runtime.h`](include/game_runtime.h).

## Host Examples

`examples/desktop-demo-host` is a standalone Windows, macOS, and Linux launcher. It reads
`assets/engineConfig.json`, selects the script language and entry point, and uses the unified runtime
library packaged by `just build-runtime-{windows,macos,linux}`. Its downloader supports ZIP,
tar, gzip, zstd, xz, and read-only 7z and RAR extraction. The native RAR backend is built only on
Windows, macOS, and Linux.

```json
{
  "schemaVersion": 1,
  "name": "my-game",
  "version": "0.1.0",
  "script": {
    "language": "typescript",
    "entry": "main.js"
  },
  "metadata": {
    "author": "example"
  }
}
```

`script.language` accepts `js`, `typescript`, or `lua`. `script.entry` must remain relative to the
asset root and cannot contain `..`. Additional project data can be stored in `metadata`.

`examples/android-demo-host` provides a Kotlin download screen. It safely extracts a release ZIP to
private app storage and starts Bevy through a Rust `NativeActivity`. The APK embeds the unified
runtime; use a command such as `just build-android-demo arm64-v8a` to select ABIs.

`examples/ios-demo-host` is a standalone Xcode project. Winit must make the initial
`UIApplicationMain` call, so the iOS host cannot display a SwiftUI or UIKit downloader before
entering Bevy. The demo bundles `projects/ts/assets`, validates `engineConfig.json`, and starts the
unified Lua and QuickJS XCFramework with `just build-ios-demo`.

Mobile hosts call `game_runtime_run_with_assets(asset_root, script_path)` to pass an explicit asset
directory. The original `game_runtime_run(script_path)` remains available to desktop hosts that use
the current working directory.

All example hosts use `assets/branding/bevy_icon.png`. Windows and Linux set a runtime window icon,
macOS sets the Dock icon, and Android and iOS generate their platform launcher/AppIcon resources.
