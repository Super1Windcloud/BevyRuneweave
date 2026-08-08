# Android demo host

This standalone Android application downloads a release ZIP into app-private storage, validates
`engineConfig.json`, and launches the game through Android `NativeActivity`. The NativeActivity is
required because Bevy/winit must receive Android's `AndroidApp` before it creates an event loop.

The APK contains one runtime with both Lua and QuickJS. Build and install it with:

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

Repository recipes also default to debug; use `just build-android-demo --release` for a release APK
and release Rust runtime.

Select an ABI set with a Gradle property:

```bash
./gradlew :app:assembleDebug -PruneweaveAbis=arm64-v8a
```

`ANDROID_HOME` and `ANDROID_NDK_HOME` must point to an installed Android SDK and NDK. The build also
requires the Rust Android targets and `cargo-ndk`. Downloaded Lua, JavaScript, and TypeScript asset
packages all use the same native runtime. Mobile installation intentionally accepts ZIP packages only.
