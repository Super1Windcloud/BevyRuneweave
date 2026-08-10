# Desktop Demo Host

This standalone Cargo project builds the Bevy RuneWeave launcher for Windows, macOS, and Linux.
It downloads an asset package into staging, validates `engineConfig.json`, and installs it under a
stable project-specific directory in the user data directory (`<engineConfig.name>/assets`). The
`active-project` marker records which installed package the launcher starts through the public C
ABI. Reinstalling the same project replaces that directory instead of creating a new one from an
HTTP redirect filename.

Supported package formats:

- ZIP and tar archives
- gzip, zstd, and xz streams, including compressed tar archives
- 7z extraction (read only)
- RAR extraction (read only, on Windows, macOS, and Linux)

Build and test it independently from the repository workspace:

```bash
cargo test --manifest-path examples/desktop-demo-host/Cargo.toml
cargo run --manifest-path examples/desktop-demo-host/Cargo.toml
```

Use `just build-runtime-windows`, `just build-runtime-macos`, or `just build-runtime-linux` to
package the single Lua/QuickJS runtime library. These commands do not build this launcher.

The packaged launcher selects the native library for its operating system and keeps downloaded
assets in the user's application-data directory. Complete installers also include the TypeScript
Script Squadron assets as a read-only fallback:

Android, iOS, and desktop share the same remote resource lifecycle: download into staging, validate
`engineConfig.json`, install under platform-private application data, and launch through the shared
runtime. Mobile hosts accept ZIP packages; the desktop launcher additionally supports the archive
formats listed above.

The launcher UI and Bevy runtime execute in separate process modes. This is required on macOS
because eframe and the dynamically loaded Bevy runtime each link winit; starting both event loops in
one process would register the same Objective-C application delegate twice.

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
