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
and then boots a simulator if needed, installs the app, and launches it. The launch command remains
attached to the app so Swift, Rust, Bevy, and script stdout/stderr are visible in the current
terminal; close the app or press `Ctrl+C` to stop streaming. Native crash reports remain available
under `$HOME/Library/Logs/DiagnosticReports/BevyRuneweave-*.ips`. Run `just build-runtime-ios`
separately when the runtime changes.

The Debug workflow prefers an already booted iPhone. Select a specific simulator by name or UDID:

```bash
RUNEWEAVE_IOS_SIMULATOR="iPhone 17 Pro" just build-ios-demo
```

`just build-ios-demo --release` only builds the Release simulator app; it does not install or launch
it. Pass `--release` to `just build-runtime-ios` separately when a Release runtime is required.

The launcher reads every asset from the latest GitHub Release through the paginated Releases API and
presents it alongside a custom HTTPS URL field. Downloading and starting a game are always user
initiated. The selected ZIP is extracted into staging, validated through `engineConfig.json`,
atomically promoted under Application Support, and then activated in the running runtime. A
previously installed package can be started explicitly with **Start installed game**.

Script exit requests restore the native launcher window. The Bevy runtime remains alive behind it
because winit owns the application's single `UIApplicationMain` event loop; starting another game
switches the script in that existing runtime.

The game window is full-screen on iPhone and iPad and hides the status bar. The native host owns
mobile surface geometry, so script calls to `window_set_size` return `false`; responsive gameplay
uses the viewport dimensions returned by `input_primary_pointer()` instead. `window_safe_area()`
converts UIKit's safe-area rectangle to those same world coordinates. Full-screen backgrounds may
extend to every edge, while foreground text, sprites, and controls remain inside the safe region.

The native launcher's tab container ends at the bottom safe-area boundary, keeping the complete
Home and Settings navigation bar above the Home Indicator area.
