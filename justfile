set shell := ["zsh", "-cu"]

rust_packages := "-p bevy-script-runtime -p plane-war-lua -p plane-war-luau -p plane-war-js -p plane-war-typescript"
ts_dir := "projects/ts"

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
    cargo run -p plane-war-lua

# Run the Luau game.
run-luau:
    cargo run -p plane-war-luau

# Run the JavaScript game with QuickJS.
run-js:
    cargo run -p plane-war-js

# Watch, compile, and run the TypeScript game with QuickJS.
run-ts:
    #!/usr/bin/env zsh
    set -e
    npm --prefix {{ts_dir}} run watch &
    watcher_pid=$!
    trap 'kill $watcher_pid 2>/dev/null || true' EXIT INT TERM
    cargo run -p plane-war-typescript

# Check the Lua 5.5 executable project.
check-lua:
    cargo check -p plane-war-lua

# Check the Luau executable project.
check-luau:
    cargo check -p plane-war-luau

# Check the JavaScript executable project.
check-js:
    cargo check -p plane-war-js

# Check the TypeScript executable project.
check-ts: ts-check
    cargo check -p plane-war-typescript

# Check all four isolated executable projects.
check: check-lua check-luau check-js check-ts

# Execute 600 gameplay frames with the Lua 5.5 VM.
test-lua:
    cargo test -p bevy-script-runtime --no-default-features --features lua --lib

# Execute 600 gameplay frames with the Luau VM.
test-luau:
    cargo test -p bevy-script-runtime --no-default-features --features luau --lib

# Execute JavaScript gameplay frames with QuickJS.
test-js:
    cargo test -p bevy-script-runtime --no-default-features --features js --lib

# Compile TypeScript, then execute it through its dedicated BMS feature.
test-ts: ts-build
    cargo test -p bevy-script-runtime --no-default-features --features typescript --lib

# Run all script-engine gameplay tests.
test: test-lua test-luau test-js test-ts

# Format all first-party Rust packages.
fmt:
    cargo fmt {{rust_packages}}

# Verify first-party Rust formatting without changing files.
fmt-check:
    cargo fmt {{rust_packages}} -- --check

# Build the Lua 5.5 game in release mode.
build-lua:
    cargo build --release -p plane-war-lua

# Build the Luau game in release mode.
build-luau:
    cargo build --release -p plane-war-luau

# Build the JavaScript game in release mode.
build-js:
    cargo build --release -p plane-war-js

# Compile TypeScript and build its game in release mode.
build-ts: ts-build
    cargo build --release -p plane-war-typescript

# Build all four games in release mode.
build: build-lua build-luau build-js build-ts

# Run formatting, project checks, and gameplay tests.
verify: fmt-check check test
