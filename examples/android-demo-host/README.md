# Android demo host

This standalone Android application downloads a release ZIP into app-private storage, validates
`engineConfig.json`, and launches the game through Android `NativeActivity`. The NativeActivity is
required because Bevy/winit must receive Android's `AndroidApp` before it creates an event loop.

The default scripting runtime is TypeScript. Build and install an APK with:

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

Select another runtime or ABI set with Gradle properties:

```bash
./gradlew :app:assembleDebug -PruneweaveLanguage=lua -PruneweaveAbis=arm64-v8a
```

`ANDROID_HOME` and `ANDROID_NDK_HOME` must point to an installed Android SDK and NDK. The build also
requires the Rust Android targets and `cargo-ndk`. The downloaded release must use the same language
as the runtime selected at build time. Mobile installation intentionally accepts ZIP packages only.
