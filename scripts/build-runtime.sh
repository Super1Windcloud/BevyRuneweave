#!/usr/bin/env bash

set -euo pipefail

# Zig links Bevy from well over one thousand object files on desktop targets.
ulimit -n 8192 2>/dev/null || true

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly DIST_ROOT="${RUNEWEAVE_DIST_DIR:-$REPO_ROOT/dist/runtimes}"
readonly TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/target}"
readonly DYNAMIC_PACKAGE="bevy-runeweave-runtime-cdylib"
readonly STATIC_PACKAGE="bevy-runeweave-runtime-staticlib"

usage() {
    cat <<'EOF'
Build and package Bevy Runeweave game runtimes.

Usage:
  scripts/build-runtime.sh <platform> [language]

Platforms:
  windows | macos | linux | android | ios | all

Languages:
  js | typescript | lua | luau | all (default)

Environment overrides:
  RUNEWEAVE_DIST_DIR       Output directory (default: dist/runtimes)
  WINDOWS_TARGETS          Comma-separated Rust targets
  MACOS_TARGETS            Comma-separated Rust targets
  LINUX_TARGETS            Comma-separated Rust targets
  ANDROID_ABIS             Comma-separated cargo-ndk ABI names
  ANDROID_PLATFORM         Minimum Android API level (default: 26)
  IOS_DEVICE_TARGETS       Comma-separated Rust device targets
  IOS_SIMULATOR_TARGETS    Comma-separated Rust simulator targets
  IOS_DEPLOYMENT_TARGET    Minimum iOS version (default: 13.0)

Cross-compiling Windows or Linux requires cargo-zigbuild and Zig. Android
requires cargo-ndk plus ANDROID_NDK_HOME. iOS builds require macOS and Xcode.
EOF
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

host_target() {
    rustc -vV | sed -n 's/^host: //p'
}

host_os() {
    case "$(host_target)" in
        *-apple-darwin) printf 'macos\n' ;;
        *-pc-windows-*) printf 'windows\n' ;;
        *-unknown-linux-*) printf 'linux\n' ;;
        *) printf 'unknown\n' ;;
    esac
}

language_feature() {
    case "$1" in
        js | typescript | lua | luau) printf '%s\n' "$1" ;;
        *) die "unsupported language: $1" ;;
    esac
}

asset_directory() {
    case "$1" in
        js) printf '%s/projects/js/assets\n' "$REPO_ROOT" ;;
        typescript) printf '%s/projects/ts/assets\n' "$REPO_ROOT" ;;
        lua) printf '%s/projects/lua/assets\n' "$REPO_ROOT" ;;
        luau) printf '%s/projects/luau/assets\n' "$REPO_ROOT" ;;
        *) die "unsupported language: $1" ;;
    esac
}

target_is_installed() {
    rustup target list --installed | grep -Fxq "$1"
}

require_target() {
    target_is_installed "$1" || die "Rust target '$1' is not installed; run: rustup target add $1"
}

fresh_package_dir() {
    local platform="$1"
    local language="$2"
    local architecture="$3"
    local destination="$DIST_ROOT/$platform/$language/$architecture"

    if [[ "$destination" != "$DIST_ROOT/"* ]]; then
        die "refusing to replace output outside $DIST_ROOT"
    fi
    rm -rf -- "$destination"
    mkdir -p "$destination/lib"
    cp "$REPO_ROOT/include/game_runtime.h" "$destination/game_runtime.h"
    cp -R "$(asset_directory "$language")" "$destination/assets"
    printf '%s\n' "$destination"
}

write_build_info() {
    local destination="$1"
    local platform="$2"
    local language="$3"
    local target="$4"
    local packages
    case "$platform" in
        android) packages="$DYNAMIC_PACKAGE" ;;
        ios) packages="$STATIC_PACKAGE" ;;
        *) packages="$DYNAMIC_PACKAGE,$STATIC_PACKAGE" ;;
    esac
    {
        printf 'package=%s\n' "$packages"
        printf 'platform=%s\n' "$platform"
        printf 'language=%s\n' "$language"
        printf 'target=%s\n' "$target"
        printf 'profile=release\n'
    } > "$destination/build-info.txt"
}

copy_matching_artifacts() {
    local source_dir="$1"
    local destination="$2"
    shift 2
    local copied=0
    local pattern artifact

    shopt -s nullglob
    for pattern in "$@"; do
        for artifact in "$source_dir"/$pattern; do
            cp "$artifact" "$destination/lib/"
            copied=1
        done
    done
    shopt -u nullglob

    [[ "$copied" -eq 1 ]] || die "no runtime libraries found in $source_dir"
}

build_desktop_target() {
    local platform="$1"
    local language="$2"
    local target="$3"
    local feature
    feature="$(language_feature "$language")"

    require_target "$target"
    local cargo_subcommand='build'
    if [[ "$target" != "$(host_target)" && "$platform" != 'macos' ]]; then
        require_command zig
        cargo zigbuild --help >/dev/null 2>&1 || die "cargo-zigbuild is required for target $target; run: cargo install cargo-zigbuild"
        cargo_subcommand='zigbuild'
    fi

    printf 'Building %s/%s for %s\n' "$platform" "$language" "$target"
    local destination
    destination="$(fresh_package_dir "$platform" "$language" "$target")"
    (cd "$REPO_ROOT" && cargo "$cargo_subcommand" --release --lib -p "$DYNAMIC_PACKAGE" --no-default-features --features "$feature" --target "$target")
    case "$platform" in
        windows) copy_matching_artifacts "$TARGET_DIR/$target/release" "$destination" '*.dll' '*.dll.a' '*.dll.lib' ;;
        macos)
            copy_matching_artifacts "$TARGET_DIR/$target/release" "$destination" '*.dylib'
            install_name_tool -id '@rpath/libbevy_runeweave.dylib' "$destination/lib/libbevy_runeweave.dylib"
            ;;
        linux) copy_matching_artifacts "$TARGET_DIR/$target/release" "$destination" '*.so' ;;
    esac
    (cd "$REPO_ROOT" && cargo "$cargo_subcommand" --release --lib -p "$STATIC_PACKAGE" --no-default-features --features "$feature" --target "$target")
    case "$platform" in
        windows) copy_matching_artifacts "$TARGET_DIR/$target/release" "$destination" '*.lib' '*.a' ;;
        macos | linux) copy_matching_artifacts "$TARGET_DIR/$target/release" "$destination" '*.a' ;;
    esac
    write_build_info "$destination" "$platform" "$language" "$target"
}

build_desktop() {
    local platform="$1"
    local language="$2"
    local defaults targets_value
    case "$platform" in
        windows)
            if [[ "$(host_os)" == 'windows' ]]; then defaults="$(host_target)"; else defaults='x86_64-pc-windows-gnu'; fi
            targets_value="${WINDOWS_TARGETS:-$defaults}"
            ;;
        macos)
            [[ "$(host_os)" == 'macos' ]] || die 'macOS runtimes can only be built on macOS'
            defaults="$(host_target)"
            targets_value="${MACOS_TARGETS:-$defaults}"
            ;;
        linux)
            if [[ "$(host_os)" == 'linux' ]]; then defaults="$(host_target)"; else defaults='x86_64-unknown-linux-gnu'; fi
            targets_value="${LINUX_TARGETS:-$defaults}"
            ;;
    esac

    local -a targets
    IFS=',' read -r -a targets <<< "$targets_value"
    local target
    for target in "${targets[@]}"; do
        build_desktop_target "$platform" "$language" "$target"
    done
}

android_rust_target() {
    case "$1" in
        arm64-v8a) printf 'aarch64-linux-android\n' ;;
        armeabi-v7a) printf 'armv7-linux-androideabi\n' ;;
        x86_64) printf 'x86_64-linux-android\n' ;;
        x86) printf 'i686-linux-android\n' ;;
        *) die "unsupported Android ABI: $1" ;;
    esac
}

build_android() {
    local language="$1"
    local feature
    feature="$(language_feature "$language")"
    require_command cargo
    cargo ndk --version >/dev/null 2>&1 || die "cargo-ndk is required; run: cargo install cargo-ndk"
    [[ -n "${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}" ]] || die 'set ANDROID_NDK_HOME to the Android NDK directory'

    local -a abis
    IFS=',' read -r -a abis <<< "${ANDROID_ABIS:-arm64-v8a,armeabi-v7a,x86_64}"
    local abi target destination ndk_output
    for abi in "${abis[@]}"; do
        target="$(android_rust_target "$abi")"
        require_target "$target"
        destination="$(fresh_package_dir android "$language" "$abi")"
        ndk_output="$destination/lib"
        printf 'Building android/%s for %s (%s)\n' "$language" "$abi" "$target"
        (cd "$REPO_ROOT" && cargo ndk -t "$abi" -p "${ANDROID_PLATFORM:-26}" -o "$ndk_output" build --release --lib -p "$DYNAMIC_PACKAGE" --no-default-features --features "$feature")
        [[ -f "$ndk_output/$abi/libbevy_runeweave.so" ]] || die "Android runtime was not produced for $abi"
        mv "$ndk_output/$abi/libbevy_runeweave.so" "$ndk_output/"
        rmdir "$ndk_output/$abi"
        write_build_info "$destination" android "$language" "$target"
    done
}

build_ios_slice() {
    local language="$1"
    local target="$2"
    local output="$3"
    local feature
    feature="$(language_feature "$language")"
    require_target "$target"
    printf 'Building ios/%s for %s\n' "$language" "$target"
    (cd "$REPO_ROOT" && IPHONEOS_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-13.0}" cargo build --release --lib -p "$STATIC_PACKAGE" --no-default-features --features "$feature" --target "$target")
    cp "$TARGET_DIR/$target/release/libbevy_runeweave.a" "$output"
}

build_ios() {
    local language="$1"
    [[ "$(host_os)" == 'macos' ]] || die 'iOS runtimes can only be built on macOS'
    require_command xcodebuild
    require_command lipo

    local -a device_targets simulator_targets
    IFS=',' read -r -a device_targets <<< "${IOS_DEVICE_TARGETS:-aarch64-apple-ios}"
    IFS=',' read -r -a simulator_targets <<< "${IOS_SIMULATOR_TARGETS:-aarch64-apple-ios-sim}"

    local target
    for target in "${device_targets[@]}" "${simulator_targets[@]}"; do
        require_target "$target"
    done

    local work_dir destination
    work_dir="$(mktemp -d "${TMPDIR:-/tmp}/runeweave-ios.XXXXXX")"
    trap 'rm -rf -- "$work_dir"' EXIT INT TERM
    mkdir -p "$work_dir/device" "$work_dir/simulator"

    for target in "${device_targets[@]}"; do
        build_ios_slice "$language" "$target" "$work_dir/device/$target.a"
    done
    for target in "${simulator_targets[@]}"; do
        build_ios_slice "$language" "$target" "$work_dir/simulator/$target.a"
    done

    lipo -create "$work_dir"/device/*.a -output "$work_dir/libbevy_runeweave-device.a"
    lipo -create "$work_dir"/simulator/*.a -output "$work_dir/libbevy_runeweave-simulator.a"
    destination="$(fresh_package_dir ios "$language" xcframework)"
    xcodebuild -create-xcframework \
        -library "$work_dir/libbevy_runeweave-device.a" -headers "$REPO_ROOT/include" \
        -library "$work_dir/libbevy_runeweave-simulator.a" -headers "$REPO_ROOT/include" \
        -output "$destination/lib/BevyRuneweave.xcframework"
    write_build_info "$destination" ios "$language" "${device_targets[*]};${simulator_targets[*]}"
    rm -rf -- "$work_dir"
    trap - EXIT INT TERM
}

build_one() {
    local platform="$1"
    local language="$2"
    case "$platform" in
        windows | macos | linux) build_desktop "$platform" "$language" ;;
        android) build_android "$language" ;;
        ios) build_ios "$language" ;;
        *) die "unsupported platform: $platform" ;;
    esac
}

main() {
    [[ $# -ge 1 && $# -le 2 ]] || { usage; exit 2; }
    local platform="$1"
    local language="${2:-all}"
    local -a platforms languages

    case "$platform" in
        all) platforms=(windows macos linux android ios) ;;
        windows | macos | linux | android | ios) platforms=("$platform") ;;
        -h | --help) usage; exit 0 ;;
        *) die "unsupported platform: $platform" ;;
    esac
    case "$language" in
        all) languages=(js typescript lua luau) ;;
        js | typescript | lua | luau) languages=("$language") ;;
        *) die "unsupported language: $language" ;;
    esac

    require_command cargo
    require_command rustc
    require_command rustup
    mkdir -p "$DIST_ROOT"

    local selected_platform selected_language
    for selected_platform in "${platforms[@]}"; do
        for selected_language in "${languages[@]}"; do
            build_one "$selected_platform" "$selected_language"
        done
    done

    printf 'Runtime packages are available under %s\n' "$DIST_ROOT"
}

main "$@"
