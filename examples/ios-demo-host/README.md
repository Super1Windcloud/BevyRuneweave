# iOS demo host

The iOS host starts Bevy before UIKit creates an application object. This ordering is required by
winit on iOS: its event loop owns the call to `UIApplicationMain`, so a SwiftUI or UIKit launcher
cannot be shown first and then hand control to the runtime.

Build the TypeScript XCFramework, then open or build the project:

```bash
just build-runtime-ios typescript
xcodebuild -project examples/ios-demo-host/BevyRuneweaveHost.xcodeproj \
  -scheme BevyRuneweaveHost -sdk iphonesimulator -configuration Debug build
```

The demo bundles `projects/ts/assets`, validates its `engineConfig.json`, and calls
`game_runtime_run_with_assets` before UIKit starts. To use another language, build that runtime,
update `RUNEWEAVE_LANGUAGE` in `Config/Runtime.xcconfig`, replace the XCFramework file reference,
and point the `assets` folder reference at the matching project. Only one language runtime can be
linked because iOS uses a static XCFramework.
