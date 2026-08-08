# iOS demo host

The iOS host starts Bevy before UIKit creates an application object. This ordering is required by
winit on iOS: its event loop owns the call to `UIApplicationMain`, so a SwiftUI or UIKit launcher
cannot be shown first and then hand control to the runtime.

Build the unified Lua/QuickJS XCFramework, then open or build the project:

```bash
just build-runtime-ios
xcodebuild -project examples/ios-demo-host/BevyRuneweaveHost.xcodeproj \
  -scheme BevyRuneweaveHost -sdk iphonesimulator -configuration Debug build
```

`just build-ios-demo` builds Debug by default; `just build-ios-demo --release` selects the Release
configuration for both the XCFramework and host app.

The demo bundles `projects/ts/assets`, validates its `engineConfig.json`, and calls
`game_runtime_run_with_assets` before UIKit starts. The same XCFramework supports Lua, JavaScript,
and compiled TypeScript assets; to change the bundled example, point the `assets` folder reference
at the matching project without rebuilding a language-specific runtime.
