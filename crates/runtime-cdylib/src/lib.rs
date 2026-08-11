use std::ffi::{c_char, c_int};

#[cfg(target_os = "android")]
use std::ffi::CString;

#[cfg(target_os = "android")]
use std::{fs, path::PathBuf};

#[cfg(target_os = "android")]
use bevy::prelude::bevy_main;
#[cfg(target_os = "android")]
use serde::Deserialize;

#[cfg(target_os = "android")]
extern "C" fn return_to_android_launcher() {
    let Some(app) = bevy::android::ANDROID_APP.get() else {
        eprintln!("Bevy Runeweave: Android host is unavailable for exit request");
        return;
    };
    // SAFETY: AndroidApp owns both JNI references for the duration of android_main.
    let vm = unsafe { jni::JavaVM::from_raw(app.vm_as_ptr().cast()) };
    let result = vm.attach_current_thread(|env| -> jni::errors::Result<()> {
        let raw_activity = app.activity_as_ptr() as jni::sys::jobject;
        // SAFETY: AndroidApp exposes an unowned global reference. as_cast_raw
        // borrows it without deleting the reference when this scope ends.
        let activity =
            unsafe { env.as_cast_raw::<jni::refs::Global<jni::objects::JObject>>(&raw_activity)? };
        env.call_method(
            activity,
            jni::jni_str!("returnToLauncherFromNative"),
            jni::jni_sig!("()V"),
            &[],
        )?;
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("Bevy Runeweave: could not return to Android launcher: {error}");
    }
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineConfig {
    schema_version: u32,
    script: ScriptConfig,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct ScriptConfig {
    language: String,
    entry: PathBuf,
}

#[cfg(target_os = "android")]
#[bevy_main]
fn main() {
    let app = bevy::android::ANDROID_APP
        .get()
        .expect("AndroidApp was not initialized by NativeActivity");
    let data = app
        .internal_data_path()
        .expect("NativeActivity did not provide an internal data directory");
    let assets = data.join("assets");
    let config: EngineConfig = serde_json::from_slice(
        &fs::read(assets.join("engineConfig.json")).expect("failed to read engineConfig.json"),
    )
    .expect("failed to parse engineConfig.json");

    assert_eq!(config.schema_version, 1, "unsupported engineConfig schema");
    let extension = config
        .script
        .entry
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    assert!(
        matches!(
            (config.script.language.as_str(), extension),
            ("lua", "lua") | ("js" | "typescript", "js" | "mjs")
        ),
        "asset language does not match the script entry extension"
    );
    bevy_runeweave::game_runtime_set_exit_callback(Some(return_to_android_launcher));
    bevy_runeweave::run_with_assets(assets, config.script.entry);
}

#[unsafe(no_mangle)]
pub extern "C" fn game_runtime_request_reload() {
    bevy_runeweave::game_runtime_request_reload();
}

#[unsafe(no_mangle)]
pub extern "C" fn game_runtime_set_exit_callback(
    callback: Option<bevy_runeweave::RuntimeExitCallback>,
) {
    bevy_runeweave::game_runtime_set_exit_callback(callback);
}

/// # Safety
///
/// `script_path` must point to a valid, NUL-terminated UTF-8 string for the
/// duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn game_runtime_switch_script(script_path: *const c_char) -> c_int {
    // SAFETY: The host contract is forwarded unchanged to the runtime.
    unsafe { bevy_runeweave::game_runtime_switch_script(script_path) }
}

/// # Safety
///
/// `script_path` must point to a valid, NUL-terminated UTF-8 string for the
/// duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn game_runtime_run(script_path: *const c_char) -> c_int {
    // SAFETY: The host contract is forwarded unchanged to the runtime.
    unsafe { bevy_runeweave::game_runtime_run(script_path) }
}

/// # Safety
///
/// Both paths must point to valid, NUL-terminated UTF-8 strings for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn game_runtime_run_with_assets(
    asset_root: *const c_char,
    script_path: *const c_char,
) -> c_int {
    // SAFETY: The host contract is forwarded unchanged to the runtime.
    unsafe { bevy_runeweave::game_runtime_run_with_assets(asset_root, script_path) }
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_super1windcloud_runeweave_demo_RuntimeActivity_nativeSwitchScript<
    'local,
>(
    mut unowned_env: jni::EnvUnowned<'local>,
    _activity: jni::objects::JObject<'local>,
    script_path: jni::objects::JString<'local>,
) -> jni::sys::jint {
    let path = match unowned_env
        .with_env(|env| script_path.try_to_string(env))
        .into_outcome()
    {
        jni::Outcome::Ok(path) => path,
        jni::Outcome::Err(_) | jni::Outcome::Panic(_) => return 1,
    };
    let path = match CString::new(path) {
        Ok(path) => path,
        Err(_) => return 2,
    };
    unsafe { game_runtime_switch_script(path.as_ptr()) }
}
