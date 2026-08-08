# Desktop Demo Host

This standalone Cargo project builds the Bevy RuneWeave launcher for Windows, macOS, and Linux.
It downloads an asset package, validates `engineConfig.json`, installs the package under `assets`,
and loads the matching runtime library through the public C ABI.

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
package the launcher with the single Lua/QuickJS runtime library.
