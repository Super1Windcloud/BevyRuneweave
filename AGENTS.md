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

Treat TypeScript as the default language for subsequent game development. Put gameplay, entities,
systems, input, UI behavior, and iteration in TypeScript scripts and compiled JavaScript assets.
Change the Rust runtime or host only when the scripting API cannot provide the required capability.

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

## Build and Test Commands

- `npm install` installs root tooling; `npm run typecheck:scripts` checks release/build scripts.
- `just fmt-check` verifies Rust formatting; `just check` checks all three language projects.
- `just test` runs runtime gameplay tests for JS, TypeScript, and Lua.
- `just verify` runs the complete formatting, check, and test suite.
- `just build-runtime-{windows,macos,linux}` builds one Lua/QuickJS runtime library without the desktop launcher.
- `just build-android-demo` and `just build-ios-demo` build native hosts using the unified runtime.
- `just package-windows-installer` and `just package-macos-dmg` create complete desktop installers.
- All build recipes default to debug; pass `--release` explicitly for release artifacts.
- Native runtime artifacts are always unified and embed every supported engine (Lua and QuickJS,
  including TypeScript through emitted JavaScript). Do not add language-specific runtime features,
  packages, or build recipes; single-language features are only for project development and tests.
- `npm run release:assets` packages assets and uploads same-named Release assets using `.env` credentials.

## Configuration and Assets

Each game package must include `assets/engineConfig.json` with `schemaVersion`, `name`, `version`,
and `script.language`/`script.entry`. Entry paths must remain relative to `assets` and must not use `..`.
Keep generated output under `dist/`; never commit `.env`, tokens, or generated binaries.

## Style and Testing

Use `cargo fmt` for Rust and strict TypeScript settings in `scripts/tsconfig.json`. Use four-space
indentation in Rust/JSON and two-space indentation in TypeScript. Name Rust items in `snake_case`,
TypeScript symbols in `camelCase`, and language package folders with lowercase names. Add focused
tests for runtime behavior and configuration validation; keep test names descriptive.

## Commits and Pull Requests

Use Conventional Commit prefixes such as `feat(runtime):`, `fix(host):`, `build(scripts):`, or
`docs:` followed by a concise description. PRs should explain behavior changes, list verification
commands, identify platform/toolchain prerequisites, and include screenshots for visible Windows UI
changes. Do not include secrets or generated release archives in source changes.
