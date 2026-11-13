# Android demo host

This standalone Android application downloads a release ZIP into app-private storage, validates
`engineConfig.json`, and launches the game through one long-lived Android `NativeActivity`. The
NativeActivity is required because Bevy/winit must receive Android's `AndroidApp` before it creates
an event loop. The downloader never starts a second NativeActivity: it reorders the existing
`RuntimeActivity` and sends `game_runtime_switch_script` through JNI. This avoids winit's
`RecreationAttempt` failure and stale Activity/logger state.

The APK reuses the prebuilt runtime under `dist/runtimes/android` instead of compiling Rust from
Gradle. Build the runtime once, then build and install the APK as often as needed:

```bash
just build-runtime-android
just build-android-demo
```

`just build-android-demo` installs the Debug APK, launches `MainActivity`, and streams `logcat`
filtered to the application process. Press `Ctrl-C` to stop the log stream. When multiple devices
are connected, set `ANDROID_SERIAL` to select one. The Release variant is not signed, so
`just build-android-demo --release` only assembles the Release APK.

To package an APK without installing, launching or streaming logs, use the dedicated script:

```bash
npm run package:android
npm run package:android -- --release
just package-android-apk
```

This reuses the existing runtime `.so` under `dist/runtimes/android` and never invokes Cargo or
adb. It defaults to Debug and `arm64-v8a`; `--abis=arm64-v8a,x86_64` selects both supported ABIs.
Each runtime must already match the requested Debug/Release profile. Debug output is
`examples/android-demo-host/app/build/outputs/apk/debug/app-debug.apk`; Release output is
`examples/android-demo-host/app/build/outputs/apk/release/app-release-unsigned.apk`.
Use `npm run package:android -- --dry-run` to print the selected ABI and Gradle task without building.

Both runtime and APK recipes default to debug. For release, run `just build-runtime-android --release`
once before `just build-android-demo --release`. The APK build checks that every selected ABI exists
and matches the requested profile. Android Debug builds accept invalid TLS certificate chains and
hostnames in both the launcher downloader and script HTTP API. Release builds always use strict TLS
validation.

Runtime builds and APK packaging default to `arm64-v8a` only, including direct Gradle builds.
Previously built x86_64 runtime outputs may remain on disk but are not copied into the default APK.
To opt into both supported ABIs, build and package the same set explicitly:

```bash
ANDROID_ABIS=arm64-v8a,x86_64 just build-runtime-android
just build-android-demo "" arm64-v8a,x86_64
```

The repository-level command delegates profile selection, ABI validation, and Gradle invocation to
`scripts/build-android-demo-host.ts`. Use `--dry-run` on that script to validate arguments without
building, installing, launching, or attaching logcat.
For direct Gradle builds, use `-PruneweaveAbis=arm64-v8a,x86_64` to override the default.

Building the runtime requires an Android SDK, NDK, Rust Android targets, and `cargo-ndk`. Building
the APK from an existing dist runtime does not invoke Cargo. Downloaded Lua, JavaScript, and
TypeScript asset packages all use the same native runtime. Mobile installation intentionally accepts
ZIP packages only.

The Android launcher accepts an HTTPS ZIP URL, extracts it into staging, validates
`engineConfig.json`, atomically replaces the installed assets, and starts or reuses the shared
`RuntimeActivity` runtime. This is the same resource lifecycle used by the desktop and iOS hosts;
the presentation and remote asset selection remain platform-specific. Script exit requests bring
`MainActivity` back to the front while the shared runtime and its winit event loop remain alive.
When the runtime activity is actually finished by Android, its process is terminated so a future
launch gets a fresh winit event loop.

`RuntimeActivity` always presents the game as an immersive full-screen surface. It hides status and
navigation bars again after resume or focus changes, allows transient bars by edge swipe, and lays
out through display cutouts where the Android version supports it. Script calls to
`window_set_size` return `false` on Android; viewport-dependent gameplay must use the dimensions
reported by `input_primary_pointer()`. `window_safe_area()` exposes the activity's native content
rectangle in the same world coordinates, allowing backgrounds to extend behind cutouts and system
bars while foreground text, sprites, and controls stay within safe bounds.

The native launcher's bottom navigation adds the current navigation-bar or display-cutout inset
below its fixed-height controls, so neither gesture navigation nor three-button navigation covers
the Home and Settings actions.

The launcher shares a sage-and-teal visual palette with iOS. Home separates the installed game,
release downloads, and custom package links into rounded sections. Settings persists the light/dark
appearance choice. Content stays centered on wide screens, release names wrap without fixed row
heights, and navigation grows with the system font scale. Download controls expose disabled and
busy states; keyboard insets keep the URL field accessible.

The launcher follows the system language by default: Chinese locales use Simplified Chinese,
and other languages use English. Android 13+ per-app language preferences take priority; an
unsupported preference falls back to English even on a Chinese system. Navigation, accessibility,
status and validation messages come from `examples/host-localization.json`. Run
`npm run prepare:host-locales` after changing that shared catalog and `npm run test:host-locales`
to check the generated native resources and desktop catalog.

The host reads optional `mobile.orientation` from the package's `engineConfig.json`: `auto`
(the default), `portrait`, or `landscape`. Ember Arena selects `landscape`, allowing both landscape
directions even when the system rotation preference is locked to portrait. The setting is applied
before native startup and again when switching packages; it does not restrict the launcher.
Older packages without the setting retain the default system policy.

The game changes orientation without recreating its NativeActivity. System Back
returns to the launcher while keeping the runtime alive. The portable BMS `on_suspend()` callback
lets games pause on focus loss or backgrounding; Ember Arena clears queued input and requires
manual resume. This preserves an in-process run, not a save across process death.

Device acceptance on 2026-11-12: Pixel 8 / Android 17, arm64 Debug runtime and APK rebuilt,
Kotlin compilation and Android Lint passed. Chinese system default, English and French-to-English
fallback, native launcher navigation, actual dungeon touch movement, portrait/landscape rendering,
Home/recents pause/resume and Back-to-launcher passed. The runtime PID stayed unchanged through
Home/recents and Back. Captures and logs are under `dist/mobile-adaptation/`; locale overrides were
cleared and portrait restored. Other ABIs, minimum supported OS versions, Release, download-failure
recovery, audio/performance and complete game acceptance were not tested in this batch.
