# Repository Guidelines

## Project Structure

- `src/` contains the Bevy runtime and ECS bindings; `bevy_mod_scripting/` contains the scripting framework.
- `crates/runtime-cdylib` and `crates/runtime-staticlib` expose C ABI libraries for host applications.
- `examples/desktop-demo-host` is the standalone Windows, macOS, and Linux launcher and resource downloader.
- `projects/{js,ts,lua}/` contain language examples, source, compiled scripts, and sprites.
- `scripts/` contains TypeScript build and release tooling; `build-support/` contains Cargo Rust build helpers.
- `include/` contains the public C header; `docs/` contains ECS API documentation.

## Development Defaults

Treat TypeScript as the default language for subsequent game development. Put gameplay, entities,
systems, input, UI behavior, and iteration in TypeScript scripts and compiled JavaScript assets.
Change the Rust runtime or host only when the scripting API cannot provide the required capability.

## Build and Test Commands

- `npm install` installs root tooling; `npm run typecheck:scripts` checks release/build scripts.
- `just fmt-check` verifies Rust formatting; `just check` checks all three language projects.
- `just test` runs runtime gameplay tests for JS, TypeScript, and Lua.
- `just verify` runs the complete formatting, check, and test suite.
- `just build-runtime-unified-{windows,macos,linux}` builds one desktop launcher with all three language libraries.
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
