# Desktop Demo Host

This standalone Cargo project builds the Bevy RuneWeave launcher for Windows, macOS, and Linux.
The native UI uses GPUI Kit, with a warm light canvas, a compact dark sidebar, and separate library
and discovery pages. Light and dark palettes follow the window's system appearance at startup
and update immediately when it changes, preserving the current page, URL input, and download state.
The library highlights the active project and provides per-game launch
buttons. Discovery lists release packages and accepts a custom package URL, including Enter to
install. Narrow windows collapse navigation to icons; the main content scrolls independently of
the download status bar. Downloads disable install and launch actions until installation finishes.

It downloads an asset package into staging, validates `engineConfig.json`, and installs it under a
stable project-specific directory in the user data directory (`<engineConfig.name>/assets`). The
`active-project` marker records which installed package the launcher starts through the public C
ABI. Reinstalling the same project replaces that directory instead of creating a new one from an
HTTP redirect filename.

The launcher lists every valid installed project with its name, version, and script language.
Starting a list item updates `active-project` before spawning the runtime process. Use the refresh
command after changing the application-data directory outside the launcher.

Use **Clear resources** beside **Resource folder** to remove downloaded game assets. A confirmation
dialog asks you to close running games first. Cleanup removes installed `<project>/assets` folders
identified by `engineConfig.json`, the legacy `assets` folder when it contains that file, and the
`active-project` marker. It preserves project-parent files, logs, bundled resources, unrelated
folders, and hidden installation staging/backup folders. Linked resource roots or asset folders
are rejected before deletion; nested links are removed without following their targets.
Cleanup runs in the background and blocks downloads, game launches, refresh, and repeated cleanup.
The game list is refreshed afterward, including after a partial failure; errors stay visible and
successful cleanup is reported in the status bar.

Supported package formats:

- ZIP and tar archives
- gzip, zstd, and xz streams, including compressed tar archives
- 7z extraction (read only)
- RAR extraction (read only, on Windows, macOS, and Linux)

Launch it from the repository root (debug by default), reusing the repository's `target/` cache:

```bash
just run-desktop-demo
just run-desktop-demo --release
```

Build and test it independently from the repository workspace:

```bash
cargo test --manifest-path examples/desktop-demo-host/Cargo.toml --target-dir target
cargo run --manifest-path examples/desktop-demo-host/Cargo.toml --target-dir target
```

Use `just build-runtime-windows`, `just build-runtime-macos`, or `just build-runtime-linux` to
package the single Lua/QuickJS runtime library. These commands do not build this launcher.
Before starting a game through the launcher, build the runtime for your desktop platform. For
example, on macOS run `just build-runtime-macos` first. `just run-desktop-demo` builds and starts
the launcher without rebuilding the runtime library.

The packaged launcher selects the native library for its operating system and keeps downloaded
assets in the user's application-data directory. Complete installers also include the TypeScript
Script Squadron assets as a read-only fallback:

Android, iOS, and desktop share the same remote resource lifecycle: download into staging, validate
`engineConfig.json`, install under platform-private application data, and launch through the shared
runtime. Mobile hosts accept ZIP packages; the desktop launcher additionally supports the archive
formats listed above.

The launcher UI and Bevy runtime execute in separate process modes. This is required on macOS
to keep GPUI's native application lifecycle separate from the dynamically loaded Bevy runtime's
winit event loop. Starting a game spawns the same executable with `--run-game` before initializing
the launcher UI.

The launcher requires macOS 15+, Windows 10+, or a graphical Linux session with a Vulkan driver.
The macOS installer declares this minimum version to match GPUI Kit's supported platform range.
GPUI Kit uses Metal on macOS and DirectX on Windows.
Linux builds also require the X11/Wayland development libraries described in the
[GPUI Kit 0.9.0 installation guide](https://gpui-kit.com/versions/v0.9.0/docs/installation/). The Rust runtime and mobile
hosts do not depend on GPUI Kit. UI interaction tests use Kit's headless test windows; they do not
replace native rendering checks on each desktop platform.

The launcher follows the system locale at startup: all Chinese variants use Simplified Chinese,
and other locales fall back to English. Navigation, accessibility/tooltips, status and recovery
messages share `examples/host-localization.json` with Android and iOS. Package metadata, URLs and
script-language identifiers remain unchanged. Run `npm run prepare:host-locales` after editing
the catalog; `npm run test:host-locales` checks generated resources and placeholder parity.
GPUI's built-in component locale uses the same selection, including the input field's Cut,
Copy, Paste and Select All menus and its Clear accessibility label. Chinese variants map to
the component library's `zh-CN` catalog; unsupported locales use `en` for both host and components.
Restart the launcher after changing the system language.

Localization acceptance on 2026-11-12: 34 macOS-hosted tests passed, including GPUI interaction,
Chinese locale variants, unsupported-language fallback and formatted error data. These headless
checks do not establish native GPU rendering or Windows/Linux execution; those remain unverified
for this localization batch.

Release builds redirect stdout and stderr to process-specific files under the application-data
directory. Every process start truncates its own file, so `logs/launcher.log` contains only the
latest launcher session and `logs/runtime.log` contains only the latest game-runtime session. Debug
builds keep writing to the terminal. The application-data roots are:

- Windows: `%LOCALAPPDATA%\Bevy RuneWeave`
- macOS: `$HOME/Library/Application Support/Bevy RuneWeave`
- Linux: `$XDG_DATA_HOME/Bevy RuneWeave`, or `$HOME/.local/share/Bevy RuneWeave`

```bash
just package-windows-installer --release
just package-macos-dmg --release
```

The Windows command uses the NSIS definition under `installers/windows`; it can run on macOS after
installing `makensis`. The macOS command creates a conventional `.app`, signs it ad hoc by default,
and wraps it in a DMG. Set `MACOS_SIGN_IDENTITY` to use a Developer ID certificate.
