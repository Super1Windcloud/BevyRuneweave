set shell := ["zsh", "-cu"]

ts_dir := "projects/ts"
bms_base_packages := "-p bevy_mod_scripting -p bevy_mod_scripting_asset -p bevy_mod_scripting_bindings -p bevy_mod_scripting_bindings_domain -p bevy_mod_scripting_core -p bevy_mod_scripting_derive -p bevy_mod_scripting_display -p bevy_mod_scripting_script -p bevy_mod_scripting_world -p bevy_system_reflection -p test_utils"
bms_packages := bms_base_packages + " -p bevy_mod_scripting_lua -p bevy_mod_scripting_quickjs"

# List all available recipes.
default:
    @just --list

# Install the pinned TypeScript toolchain.
ts-install:
    npm --prefix {{ts_dir}} install

# Compile TypeScript into its isolated QuickJS asset directory.
ts-build:
    npm --prefix {{ts_dir}} run build

# Type-check the TypeScript game without emitting files.
ts-check:
    npm --prefix {{ts_dir}} run check

# Run the Lua 5.5 game.
run-lua:
    cargo run -p script-squadron-lua

# Run the Luau game.
run-luau:
    cargo run -p script-squadron-luau

# Run the JavaScript game with QuickJS.
run-js:
    cargo run -p script-squadron-js

# Watch, compile, and run the TypeScript game with QuickJS.
run-ts:
    #!/usr/bin/env zsh
    set -e
    npm --prefix {{ts_dir}} run watch &
    watcher_pid=$!
    trap 'kill $watcher_pid 2>/dev/null || true' EXIT INT TERM
    cargo run -p script-squadron-typescript

# Check the Lua 5.5 executable project.
check-lua:
    cargo check -p script-squadron-lua

# Check the Luau executable project.
check-luau:
    cargo check -p script-squadron-luau

# Check the JavaScript executable project.
check-js:
    cargo check -p script-squadron-js

# Check the TypeScript executable project.
check-ts: ts-check
    cargo check -p script-squadron-typescript

# Check all four isolated executable projects.
check: check-lua check-luau check-js check-ts

# Check all language-neutral BMS workspace targets.
bms-check-base:
    cargo check {{bms_base_packages}} --all-targets

# Check the BMS root and language crate with Lua 5.5.
bms-check-lua:
    cargo check -p bevy_mod_scripting --no-default-features --features lua55 --all-targets
    cargo check -p bevy_mod_scripting_lua --no-default-features --features lua55 --all-targets

# Check the BMS root and language crate with Luau.
bms-check-luau:
    cargo check -p bevy_mod_scripting --no-default-features --features luau --all-targets
    cargo check -p bevy_mod_scripting_lua --no-default-features --features luau --all-targets

# Check the BMS root and language crate with QuickJS.
bms-check-js:
    cargo check -p bevy_mod_scripting --no-default-features --features quickjs --all-targets
    cargo check -p bevy_mod_scripting_quickjs --all-targets

# Check the TypeScript alias over the QuickJS runtime.
bms-check-ts:
    cargo check -p bevy_mod_scripting --no-default-features --features typescript --all-targets

# Check every supported BMS runtime configuration.
bms-check: bms-check-base bms-check-lua bms-check-luau bms-check-js bms-check-ts

# Execute 600 gameplay frames with the Lua 5.5 VM.
test-lua:
    cargo test -p bevy-runeweave --no-default-features --features lua --lib

# Execute 600 gameplay frames with the Luau VM.
test-luau:
    cargo test -p bevy-runeweave --no-default-features --features luau --lib

# Execute JavaScript gameplay frames with QuickJS.
test-js:
    cargo test -p bevy-runeweave --no-default-features --features js --lib

# Compile TypeScript, then execute it through its dedicated BMS feature.
test-ts: ts-build
    cargo test -p bevy-runeweave --no-default-features --features typescript --lib

# Run all script-engine gameplay tests.
test: test-lua test-luau test-js test-ts

# Test the BMS Lua 5.5 adapter.
bms-test-lua:
    cargo test -p bevy_mod_scripting_lua --no-default-features --features lua55

# Test the BMS Luau adapter.
bms-test-luau:
    cargo test -p bevy_mod_scripting_lua --no-default-features --features luau

# Test the BMS QuickJS adapter.
bms-test-js:
    cargo test -p bevy_mod_scripting_quickjs

# Test every retained BMS language adapter.
bms-test: bms-test-lua bms-test-luau bms-test-js

# Format all first-party Rust packages.
fmt:
    cargo fmt --all

# Verify first-party Rust formatting without changing files.
fmt-check:
    cargo fmt --all -- --check

# Remove generated BMS build artifacts.
clean-bms:
    cargo clean {{bms_packages}}

# Build the Lua 5.5 game in release mode.
build-lua:
    cargo build --release -p script-squadron-lua

# Build the Luau game in release mode.
build-luau:
    cargo build --release -p script-squadron-luau

# Build the JavaScript game in release mode.
build-js:
    cargo build --release -p script-squadron-js

# Compile TypeScript and build its game in release mode.
build-ts: ts-build
    cargo build --release -p script-squadron-typescript

# Build all four games in release mode.
build: build-lua build-luau build-js build-ts

# Run formatting, project checks, and gameplay tests.
verify: fmt-check bms-check check bms-test test
