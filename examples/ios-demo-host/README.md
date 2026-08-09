# iOS demo host

The iOS host starts Bevy before UIKit creates an application object. This ordering is required by
winit on iOS: its event loop owns the call to `UIApplicationMain`, so a SwiftUI or UIKit launcher
cannot be shown first and then hand control to the runtime.

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

`just build-ios-demo` reuses the XCFramework under `dist/runtimes/ios`, compiles the TypeScript
assets, and builds the Debug host app by default. Run `just build-runtime-ios` separately when the
runtime changes. Pass `--release` to both recipes when producing Release artifacts.

To install and launch the built app on the currently booted simulator:

```bash
xcrun simctl install booted \
  dist/ios-demo-derived-data/Build/Products/Debug-iphonesimulator/BevyRuneweave.app
xcrun simctl launch booted io.github.super1windcloud.runeweave.demo
```

After Bevy creates its iOS window, the host presents the available GitHub TypeScript, JavaScript,
and Lua release assets. Downloading is always user initiated. The selected ZIP is extracted into
staging, validated through `engineConfig.json`, atomically promoted under Application Support, and
then activated in the running runtime.
