use std::ffi::{c_char, c_int};

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
