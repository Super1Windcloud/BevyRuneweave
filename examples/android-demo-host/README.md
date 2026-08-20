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

Both runtime and APK recipes default to debug. For release, run `just build-runtime-android --release`
once before `just build-android-demo --release`. The APK build checks that every selected ABI exists
and matches the requested profile. Android Debug builds accept invalid TLS certificate chains and
hostnames in both the launcher downloader and script HTTP API. Release builds always use strict TLS
validation.

Select an ABI set through the repository recipe:

```bash
just build-android-demo "" arm64-v8a
```

The repository-level command delegates profile selection, ABI validation, and Gradle invocation to
`scripts/build-android-demo-host.ts`. Use `--dry-run` on that script to validate arguments without
building, installing, launching, or attaching logcat.

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
