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
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -configuration Debug \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

`just build-ios-demo` reuses the XCFramework under `dist/runtimes/ios`. Debug builds prefer an
available physical iPhone, install the app, and launch it through CoreDevice. When no usable iPhone
or signing setup is available, the command falls back to a simulator. The launch command remains
attached to the app so Swift, Rust, Bevy, and script stdout/stderr are visible in the current
terminal; close the app or press `Ctrl+C` to stop streaming. Native crash reports remain available
under `$HOME/Library/Logs/DiagnosticReports/BevyRuneweave-*.ips`. Run `just build-runtime-ios`
separately when the runtime changes.

The default runtime build currently produces a device-only arm64 XCFramework. Simulator builds,
including the host script's fallback and Release simulator path, require a separately prepared
matching simulator slice; the device library cannot be linked into a simulator app. This batch
validated the signed Debug app on a physical iPhone, not those simulator paths. A paired iPhone
whose CoreDevice tunnel has not opened yet is eligible for selection; DDI availability alone is
not a reliable pre-launch filter.

Physical-device installation requires an Apple Development signing identity and a 10-character team
ID. Store the team ID in the root `.env`; the generated signing configuration remains untracked:

```bash
RUNEWEAVE_IOS_DEVELOPMENT_TEAM=ABCDEFGHIJ
```

Select a specific connected iPhone by name, CoreDevice identifier, or UDID:

```bash
RUNEWEAVE_IOS_DEVICE="My iPhone" just build-ios-demo
```

When the workflow falls back to a simulator, select it by name or UDID:

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

The launcher shares a sage-and-teal visual palette with Android. Home separates the installed game,
release downloads, and custom package links into rounded sections. Settings persists the light/dark
appearance choice. The centered content column adapts to iPad widths, text supports Dynamic Type,
and release names wrap without fixed row heights. Keyboard avoidance and download busy states keep
the package import flow accessible.

The launcher follows the first preferred system language: Chinese locales use Simplified Chinese,
and other languages use English. Native `.lproj` resources include navigation, accessibility,
status and validation messages. They are generated from `examples/host-localization.json` with
`npm run prepare:host-locales`; `npm run test:host-locales` verifies consistency across all hosts.

The game supports portrait and both landscape orientations. The portable BMS `on_suspend()`
callback lets games pause on focus loss or backgrounding. Ember Arena clears queued input and
requires manual resume while preserving the current in-process world; process-death saving is
outside this change.

The shared `BevyRuneweaveHostUITests` scheme runs against the real signed app and embedded runtime:

```bash
xcodebuild -project examples/ios-demo-host/BevyRuneweaveHost.xcodeproj \
  -scheme BevyRuneweaveHostUITests -sdk iphoneos \
  -destination 'id=<iPhone UDID>' -configuration Debug \
  -derivedDataPath dist/ios-demo-derived-data -allowProvisioningUpdates \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES test
```

The gameplay test requires current Ember Arena assets in the host's private package store.
Build/install/signature checks and actual device trust/launch are separate gates. Rotation captures
use `XCUIScreen.main.screenshot()` after stable foreground geometry because app-relative captures
can crop against stale accessibility window coordinates.

Device acceptance on 2026-11-12: iPhone 14 Pro / iOS 27.0.1, fresh unified runtime, signed Debug
build and actual launch passed. Two native UI tests verified English, Chinese and French fallback,
launcher navigation and actual game launch/taps/rotation/background activation. Full-screen GPU
captures were visually inspected for title, hero selection, portrait/landscape dungeon and the
pause modal after resume. The UI tests assert labels and app state; visual inspection supplies
the canvas-layout evidence. Logs, `.xcresult` bundles and captures are under
`dist/mobile-adaptation/`. Simulator, iPad, minimum OS, Release, download-failure recovery,
audio/performance and complete game acceptance remain untested in this batch.
