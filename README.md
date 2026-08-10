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
shooter host provides the window, raw keyboard state, and generic sprite/text materialization.
Scripts select key mappings, asset paths, dimensions, render layers, and HUD content alongside the gameplay itself.

## Project Layout

```text
projects/
├── lua/                 # Standalone Lua 5.5 executable project
│   └── modules/shooter/
│       ├── api/         # Virtual runtime API boundary
│       └── game/assets/ # Editable Lua entry and runtime assets
├── js/                  # Standalone QuickJS executable project
│   └── modules/shooter/
│       ├── api/         # Runtime global API boundary
│       └── game/assets/ # Editable JavaScript entry and runtime assets
└── ts/                  # TypeScript 7.0.2 and QuickJS executable project
    └── modules/shooter/
        ├── api/         # Typed BMS scene and platform-service imports
        └── game/        # TypeScript src/ and compiled runtime assets/
templates/game-project/  # Standalone project templates, outside projects/
├── lua/
├── js/
└── ts/
src/                     # Framework core and shared Bevy host
├── script_api/          # Reflected types and functions registered once through BMS
├── scene_renderer.rs    # Script-authored sprite, transform, and text rendering
├── runtime/             # App assembly, input callbacks, hot reload, and host entry points
└── lib.rs               # Feature constraints and public API exports
docs/script-api.md       # Current reflected scene and platform-service API
docs/scripting-architecture.md # BMS-first API architecture and migration rules
bevy_mod_scripting/      # Reflection, guarded World access, Lua, and QuickJS/TypeScript
include/                 # Public native-host C ABI
examples/                # Standalone desktop, Android, and iOS hosts
```

Assets are intentionally duplicated between language projects. Each runtime receives an explicit
asset root and never loads scripts or images from another language project.

Create a new independent game project from the airplane-shooter template:

```bash
just create-game my-game
just create-game my-js-game js
just create-game my-lua-game lua
```

Templates are stored independently under `templates/game-project/<language>`; active projects are
never used as template sources. Each command creates a complete standalone project at
`projects/<name>`. TypeScript projects receive a separate typed `modules/shooter/api/` layer and are
bundled immediately into `modules/shooter/game/assets/shooter.js`. JavaScript and Lua use the script
in `modules/shooter/game/assets` as their single editable runtime entry. The language defaults to
TypeScript; `typescript` is also accepted as an alias for `ts`. Template validation and the initial
TypeScript build finish in a temporary directory, so a failed creation does not leave a partial
project behind.

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

Scripts mutate real reflected Bevy components through BMS-registered functions. Independent systems
then update `Sprite`, `Transform`, and HUD state from those component and resource changes:

```text
Script logic -> BMS WorldGuard -> Components / Resources -> Bevy systems -> Rendering and UI
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

All languages consume the same BMS registry entries:

```text
scene_spawn / scene_despawn / scene_clear
scene_set_sprite / scene_set_transform / scene_set_text
scene_transform
game_state_set
```

For example, `scene_set_transform` updates a real reflected `ScriptTransform` component, and
`scene_transform` returns a BMS `ReflectReference` to that same value. The host observes it directly;
there is no mirrored ECS or per-language product adapter. See [`docs/script-api.md`](docs/script-api.md)
and [`docs/scripting-architecture.md`](docs/scripting-architecture.md).

Script files support Bevy asset hot reload. Updating `game/assets/shooter.js` or
`game/assets/shooter.lua` in the active JavaScript or Lua project reinitializes game state and prints
`Reloading script after source change`. TypeScript is handled separately: `just run-ts` runs its
watch compiler, so changes to `projects/ts/modules/shooter/game/src/shooter.ts` are compiled and reloaded automatically.

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

`package-lock.json` pins TypeScript 7.0.2. The compiled `modules/shooter/game/assets/shooter.js` is tracked, so a global
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
See [Runtime Rebuild Rules](docs/runtime-rebuild-rules.md) for the runtime/assets/host decision
boundary.

```bash
just build-runtime-macos
just build-runtime-windows
just build-runtime-linux
just build-runtime-android
just build-runtime-ios

# Generic platform entry point
just build-runtime linux
```

Desktop runtime commands package only the shared library, C header, and build metadata; they do not
build or package `desktop-demo-host`. Windows and Linux build directly on their respective hosts.
macOS cross-compiles the MSVC Windows runtime with `cargo-xwin`, while Linux cross-compilation uses
Zig and `cargo-zigbuild`. `WINDOWS_TARGETS` and `LINUX_TARGETS` accept comma-separated overrides.
Windows defaults to `x86_64-pc-windows-msvc` when built on macOS. Android requires `cargo-ndk`, an installed Android NDK,
and the relevant
Rust targets. It supports only `arm64-v8a` and `x86_64`, both built by default with API level 26. iOS
builds only on macOS with Xcode and produces `BevyRuneweave.xcframework` for arm64 devices and Apple
Silicon simulators by default.

The Android build automatically selects the newest side-by-side NDK under `ANDROID_HOME` or
`ANDROID_SDK_ROOT`. Set `ANDROID_NDK_HOME` only when an explicit NDK should override it.

```bash
npm exec -- tsx scripts/build-runtime.ts --help
WINDOWS_TARGETS=x86_64-pc-windows-msvc just build-runtime-windows
ANDROID_ABIS=arm64-v8a just build-runtime-android
IOS_SIMULATOR_TARGETS=aarch64-apple-ios-sim,x86_64-apple-ios just build-runtime-ios
```

The root framework produces an `rlib`. `crates/runtime-cdylib` produces native libraries for
Windows, macOS, Linux, and Android; `crates/runtime-staticlib` produces the iOS XCFramework. The
public host header is [`include/game_runtime.h`](include/game_runtime.h).

## Host Examples

`examples/desktop-demo-host` is a standalone Windows, macOS, and Linux launcher. It reads
`assets/engineConfig.json`, selects the script language and entry point, and can load the unified
runtime library packaged by `just build-runtime-{windows,macos,linux}`. Build the host separately
with Cargo. Its downloader supports ZIP,
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
entering Bevy. The demo bundles `projects/ts/modules/shooter/game/assets`, validates `engineConfig.json`, and starts the
unified Lua and QuickJS XCFramework with `just build-ios-demo`.

Desktop release installers include the launcher, the OS-specific unified runtime, and the default
TypeScript demo assets. Downloaded packages are stored in the user's application-data directory,
not in Program Files or inside the macOS application bundle.

The launcher replaces itself with a runtime-only process before entering Bevy. Keeping the eframe
launcher event loop and the Bevy event loop in separate process modes avoids duplicate winit
platform-global registration, particularly the macOS application delegate.

```bash
just package-windows-installer --release  # NSIS setup executable
just package-macos-dmg --release           # Signed .app inside a DMG
```

Windows packaging requires `makensis`. It can run on macOS after `brew install nsis`. macOS uses
ad-hoc signing by default; set `MACOS_SIGN_IDENTITY` for Developer ID signing before distribution.

Mobile hosts call `game_runtime_run_with_assets(asset_root, script_path)` to pass an explicit asset
directory. The original `game_runtime_run(script_path)` remains available to desktop hosts that use
the current working directory.

All example hosts use `assets/branding/bevy_icon.png`. Windows and Linux set a runtime window icon,
macOS sets the Dock icon, and Android and iOS generate their platform launcher/AppIcon resources.
