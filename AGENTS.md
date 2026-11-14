# Repository Guidelines

## Project Structure

- `src/` contains the Bevy runtime and BMS-registered script APIs; `bevy_mod_scripting/` contains the scripting framework.
- `crates/runtime-cdylib` and `crates/runtime-staticlib` expose C ABI libraries for host applications.
- `examples/desktop-demo-host` is the standalone Windows, macOS, and Linux launcher and resource downloader.
- `examples/android-demo-host` and `examples/ios-demo-host` are standalone native mobile launchers.
- `projects/{js,ts,lua}/` contain language examples, source, compiled scripts, and sprites.
- `scripts/` contains TypeScript build and release tooling; `build-support/` contains Cargo Rust build helpers.
- `include/` contains the public C header; `docs/` contains scripting API documentation.

## Development Defaults

Use TypeScript for all repository-owned scripts, including gameplay, entities, systems, input, UI
behavior, tests, smoke checks, asset preparation, build tooling, and release tooling. Do not add or
maintain handwritten `.js`, `.mjs`, or `.cjs` scripts. JavaScript files are allowed only as generated
TypeScript output, vendored third-party code, or runtime assets that must be emitted for QuickJS.
Keep generated JavaScript out of source-oriented TypeScript checks and regenerate it through the
owning build command. Change the Rust runtime or host only when the scripting API cannot provide the
required capability.

## BMS-First Scripting Architecture

`bevy_mod_scripting` is the architectural foundation for every script-facing runtime API. New APIs
must use its reflection, function registry, namespaces, `ReflectReference`, `WorldGuard`, script
systems, and language conversion infrastructure instead of introducing a parallel scripting model.

- The real Bevy `World` is the single source of truth for entities, components, resources, queries,
  and schedules. Do not add another snapshot, mirrored ECS, or string-keyed component store.
- Register script-facing Rust types through Bevy reflection and BMS type/function registration.
  Register operations through `AppScriptFunctionRegistry`, `NamespaceBuilder`, script bindings, or
  the corresponding BMS extension point. Do not expose new business globals directly through
  `mlua::Lua::globals()` or `rquickjs::Ctx::globals()`.
- Implement generic language conversion in the BMS Lua and QuickJS adapters. A product API must be
  defined once in the BMS registry and must not have separate handwritten Lua and QuickJS behavior.
- Preserve `WorldGuard` access checks, `ReflectReference` lifetime rules, dynamic component/resource
  registration, script-system query declarations, and schedule ordering. Do not bypass them with
  raw world pointers, independently locked mirrors, or host-only mutation queues.
- The removed `src/ecs_api` compatibility layer must not be reintroduced. Do not add `EcsValue`
  snapshots, string-keyed generic component stores, per-language product bindings, or virtual SDK
  modules that bypass the BMS registries.
- Host-only platform integration and the public C ABI may remain outside BMS when they are not
  script-facing. Any script-visible part of those capabilities must still enter through BMS.
- Every new or migrated API must have equivalent Lua and QuickJS/TypeScript behavior, generated or
  maintained TypeScript declarations, reflection/registry tests, and all-platform compatibility
  assessment under the Runtime API Compatibility rules below.

## Runtime API Compatibility

Every implementation of a runtime-exposed interface must remain compatible with all five supported
platforms: Windows, macOS, Linux, Android, and iOS. This applies to the public C ABI in `include/`,
the `runtime-cdylib` and `runtime-staticlib` implementations, and host-visible runtime behavior.
Do not expose platform-specific types, paths, ownership assumptions, or lifecycle requirements in a
shared interface. Keep necessary platform-specific code behind internal target guards and provide
equivalent behavior or an explicit, portable error contract on every platform. Changes to exposed
interfaces must assess all five targets and verify the available platform builds; any target that
cannot be executed in the current environment must be called out explicitly as an unverified gap.

## Mobile Runtime Delivery

- A game bundle and its installed native runtime must be compatible. After changing BMS APIs,
  callbacks or runtime behavior, rebuild the unified Android library and iOS XCFramework, then
  rebuild and reinstall the hosts. Rebuilding TypeScript or Kotlin/Swift alone does not update
  the prebuilt runtime. Match the target, profile and packaged library to the current source.
- A running process or blank fullscreen surface does not prove that a game loaded. Launch the
  current bundle on the device, check script/native logs for missing API errors, and exercise
  gameplay input before reporting runtime acceptance.
- An iOS build or install success does not prove launch acceptance. Verify signing/provisioning
  validity and actual device launch separately. Report signing/trust failures as unresolved;
  a UIKit-only preview or simulator stub is not runtime integration evidence.
- For iOS rotation screenshots, wait for stable foreground geometry and capture the full screen
  with `XCUIScreen.main.screenshot()`. App-relative accessibility window coordinates can retain
  a stale portrait origin after rotation; distinguish capture cropping from actual rendering.
- Preserve existing installed packages and user data when staging local validation assets.
  Record build, installation, launch, touch, rotation, safe-area and background/resume results
  separately for Android and iOS; results from one platform do not establish the other.
- Diagnose the device the user actually reported. For an iPhone failure, first identify the
  connected iPhone, installed app/game bundle and its script/native errors. A macOS reproduction
  can investigate shared code, but cannot establish the cause or acceptance of the iOS failure.
- Check the installed runtime's interface availability, not just current declarations or source.
  An old host can render the home screen yet throw on the first input or a periodic diagnostic
  because APIs such as `ui_button_hovered` or `audio_state` are missing. Updating the game ZIP
  alone does not add these APIs to the installed host.
- A shared `android`/`ios` script branch establishes code coverage only. Do not describe iOS as
  validated until the current signed host and game bundle actually load and accept gameplay
  input on iOS. Keep code checks, signing, installation, launch and interaction evidence separate.
- Honor the user's current device-use constraints. If device interaction is postponed, continue
  source/build work and read-only diagnostics without launching, switching or driving phone apps.

## Script UI Contract Validation

- Use the runtime's actual style schema and enum values, not browser CSS assumptions. For example,
  BMS retained UI accepts `start`/`end`, not `flex-start`/`flex-end`; rejected styles can abort menu
  construction. Check UI API return values so failures identify the widget and operation.
- UI test doubles must reject the invalid parameters relevant to their regression cases. Do not
  make every spawn/style/image call return success and then claim native UI compatibility.
  Exercise real BMS bindings when changing their contract; Node/VM tests remain script evidence.
- Test missing optional APIs explicitly. Touch menus must not depend on desktop mouse-hover
  queries, and optional audio/telemetry diagnostics must not block input, interrupt gameplay or
  mask the primary failure from a callback. Required capability failures need a clear recovery
  path rather than an empty or partially constructed screen.

## Example Host Localization

- Every user-facing example host must support English and Simplified Chinese, including navigation,
  accessibility labels, progress/status messages, validation errors and recovery actions.
- Follow the system language by default, selecting Chinese for Chinese system locales and English
  as the fallback. Use native localization resources on Android/iOS and a centralized catalog on
  desktop. Keep package names, URLs, script language identifiers and protocol data unchanged.
- Verify both languages and an unsupported-locale fallback. Localize presentation without changing
  download, installation, runtime switching or persistence behavior.

## Build and Test Commands

- `npm install` installs root tooling; `npm run typecheck:scripts` checks release/build scripts.
- `just fmt-check` verifies Rust formatting; `just check` checks all three language projects.
- `just test` runs runtime gameplay tests for JS, TypeScript, and Lua.
- `just verify` runs the complete formatting, check, and test suite.
- `just bench` measures script API hot paths in release mode against the machine-local baseline in
  `target/perf-baseline/`; `just bench save` records it and `just bench compare <percent>` gates regressions.
- `just build-runtime-{windows,macos,linux}` builds one Lua/QuickJS runtime library without the desktop launcher.
- `just build-android-demo` and `just build-ios-demo` build native hosts using the unified runtime.
- `just package-windows-installer` and `just package-macos-dmg` create complete desktop installers.
- All build recipes default to debug; pass `--release` explicitly for release artifacts.
- Native runtime artifacts are always unified and embed every supported engine (Lua and QuickJS,
  including TypeScript through emitted JavaScript). Do not add language-specific runtime features,
  packages, or build recipes; single-language features are only for project development and tests.
- Optional BMS framework capabilities are disabled by default. Enable `documentation`,
  `dynamic_components`, or `script_systems` independently, or use `full_scripting` to enable all
  three. These capability features must not change which script engines are embedded.
- `npm run release:assets` packages assets and uploads same-named Release assets using `.env` credentials.
- `just update-bevy` (or `npm run update:bevy`) updates the underlying Bevy engine version to latest (or `--version=<target>`), updates manifests/lockfiles, verifies compilation, and writes details into `CHANGELOG.md`.

## Configuration and Assets

Each game package must include `assets/engineConfig.json` with `schemaVersion`, `name`, `version`,
and `script.language`/`script.entry`. Entry paths must remain relative to `assets` and must not use `..`.
Keep generated output under `dist/`; never commit `.env`, tokens, or generated binaries.
`GITHUB_TOKEN` (or `GH_TOKEN`) can be read from `.env` in the repository root (or environment variables)
by tooling and agents for GitHub API operations (such as upstream release queries, asset publishing,
and changelog generation). Never print, log, or commit secret tokens or `.env` contents.

## Style and Testing

Use `cargo fmt` for Rust and strict TypeScript settings in `scripts/tsconfig.json`. Use four-space
indentation in Rust/JSON and two-space indentation in TypeScript. Name Rust items in `snake_case`,
TypeScript symbols in `camelCase`, and language package folders with lowercase names. Add focused
tests for runtime behavior and configuration validation; keep test names descriptive.

## Commits and Pull Requests

Write all commit messages in English, including the subject and body.
Use Conventional Commit prefixes such as `feat(runtime):`, `fix(host):`, `build(scripts):`, or
`docs:` followed by a concise description. PRs should explain behavior changes, list verification
commands, identify platform/toolchain prerequisites, and include screenshots for visible Windows UI
changes. Do not include secrets or generated release archives in source changes.
