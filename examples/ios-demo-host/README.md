# iOS demo host

The iOS host starts a minimal Bevy bootstrap before UIKit creates an application object. This
ordering is required by winit on iOS because its event loop owns the call to `UIApplicationMain`.
After the runtime window exists, the host covers it with a full-screen native launcher matching the
Android workflow. No game package is bundled or started by default.

Build the unified Lua/QuickJS XCFramework, then open or build the project:

```bash
just build-runtime-ios
xcodebuild -project examples/ios-demo-host/BevyRuneweaveHost.xcodeproj \
  -scheme BevyRuneweaveHost \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -configuration Debug \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

`just build-ios-demo` reuses the XCFramework under `dist/runtimes/ios`, builds the Debug host app,
and then boots a simulator if needed, installs the app, and launches it. Run
`just build-runtime-ios` separately when the runtime changes.

The Debug workflow prefers an already booted iPhone. Select a specific simulator by name or UDID:

```bash
RUNEWEAVE_IOS_SIMULATOR="iPhone 17 Pro" just build-ios-demo
```

`just build-ios-demo --release` only builds the Release simulator app; it does not install or launch
it. Pass `--release` to `just build-runtime-ios` separately when a Release runtime is required.

The launcher presents the available GitHub TypeScript, JavaScript, and Lua release assets plus a
custom HTTPS URL field. Downloading and starting a game are always user initiated. The selected ZIP
is extracted into staging, validated through `engineConfig.json`, atomically promoted under
Application Support, and then activated in the running runtime. A previously installed package can
be started explicitly with **Start installed game**.
