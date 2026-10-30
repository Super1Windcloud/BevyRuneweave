//! Small project-scoped persistent values, independent of replaceable game assets.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use bevy::prelude::*;
use bevy_mod_scripting::bindings::{
    FunctionCallContext, InteropError, ScriptValue, WorldExtensions,
};
use bevy_mod_scripting::{core::event::ScriptDetachedEvent, script::ScriptAttachment};

const MAX_VALUE_BYTES: usize = 64 * 1024;

#[derive(Resource, Default)]
pub(crate) struct ScriptStorage {
    directory: Option<PathBuf>,
    bindings: std::collections::HashMap<ScriptAttachment, Option<PathBuf>>,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
}

fn native_data_root() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("RUNEWEAVE_DATA_DIR") {
        return Some(PathBuf::from(value)).filter(|path| path.is_absolute());
    }
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(target_os = "linux")]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    #[cfg(target_os = "android")]
    let base = bevy::android::ANDROID_APP
        .get()
        .and_then(|app| app.internal_data_path());
    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        target_os = "ios"
    )))]
    let base: Option<PathBuf> = None;
    base.filter(|path| path.is_absolute())
        .map(|path| path.join("Bevy RuneWeave"))
}

fn result(state: &str, detail: Option<(&str, String)>) -> ScriptValue {
    let mut fields = bevy::platform::collections::HashMap::default();
    fields.insert(
        "state".to_owned(),
        ScriptValue::String(state.to_owned().into()),
    );
    if let Some((key, value)) = detail {
        fields.insert(key.to_owned(), ScriptValue::String(value.into()));
    }
    ScriptValue::Map(fields)
}
fn error(code: &str) -> ScriptValue {
    result("error", Some(("error", code.to_owned())))
}

impl ScriptStorage {
    fn for_project(root: Option<PathBuf>, project: &str) -> Self {
        Self {
            directory: root
                .filter(|path| path.is_absolute() && valid_name(project))
                .map(|path| path.join("saves").join(project)),
            bindings: Default::default(),
        }
    }

    pub(crate) fn for_assets(assets: &Path) -> Self {
        let project = fs::read(assets.join("engineConfig.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|config| config.get("name")?.as_str().map(str::to_owned));
        Self::for_project(native_data_root(), project.as_deref().unwrap_or_default())
    }

    pub(crate) fn refresh_for_assets(&mut self, assets: &Path) {
        self.directory = Self::for_assets(assets).directory;
    }

    #[cfg(test)]
    pub(super) fn for_test(root: &Path, project: &str) -> Self {
        Self::for_project(Some(root.to_path_buf()), project)
    }

    fn path(&self, key: &str) -> Result<PathBuf, &'static str> {
        if !valid_name(key) {
            return Err("invalid_key");
        }
        self.directory
            .as_ref()
            .map(|directory| directory.join(format!("{key}.save")))
            .ok_or("unavailable")
    }

    fn read(&self, key: &str) -> ScriptValue {
        let path = match self.path(key) {
            Ok(path) => path,
            Err(code) => return error(code),
        };
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
                return result("missing", None);
            }
            Err(_) => return error("io"),
        };
        let mut bytes = Vec::new();
        if file
            .take(MAX_VALUE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .is_err()
        {
            return error("io");
        }
        if bytes.len() > MAX_VALUE_BYTES {
            return error("too_large");
        }
        match String::from_utf8(bytes) {
            Ok(value) => result("ok", Some(("value", value))),
            Err(_) => error("invalid_data"),
        }
    }

    fn write(&self, key: &str, value: &str) -> ScriptValue {
        let path = match self.path(key) {
            Ok(path) => path,
            Err(code) => return error(code),
        };
        if value.len() > MAX_VALUE_BYTES {
            return error("too_large");
        }
        let Some(directory) = path.parent() else {
            return error("unavailable");
        };
        let write = || -> Result<(), ()> {
            fs::create_dir_all(directory).map_err(|_| ())?;
            let mut staging = tempfile::Builder::new()
                .prefix(".save-")
                .tempfile_in(directory)
                .map_err(|_| ())?;
            staging.write_all(value.as_bytes()).map_err(|_| ())?;
            staging.as_file().sync_all().map_err(|_| ())?;
            staging.persist(&path).map_err(|_| ())?;
            // Directory sync is best-effort; Windows does not expose it through std.
            #[cfg(unix)]
            let _ = fs::File::open(directory).and_then(|file| file.sync_all());
            Ok(())
        };
        if write().is_ok() {
            result("ok", None)
        } else {
            error("io")
        }
    }

    fn remove(&self, key: &str) -> ScriptValue {
        let path = match self.path(key) {
            Ok(path) => path,
            Err(code) => return error(code),
        };
        match fs::remove_file(path) {
            Ok(()) => result("ok", None),
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => result("missing", None),
            Err(_) => error("io"),
        }
    }
}

pub(super) fn storage_read(
    context: FunctionCallContext,
    key: String,
) -> Result<ScriptValue, InteropError> {
    with_storage(context, |storage| storage.read(&key))
}
pub(super) fn storage_write(
    context: FunctionCallContext,
    key: String,
    value: String,
) -> Result<ScriptValue, InteropError> {
    with_storage(context, |storage| storage.write(&key, &value))
}
pub(super) fn storage_remove(
    context: FunctionCallContext,
    key: String,
) -> Result<ScriptValue, InteropError> {
    with_storage(context, |storage| storage.remove(&key))
}

fn with_storage(
    context: FunctionCallContext,
    operation: impl FnOnce(&ScriptStorage) -> ScriptValue,
) -> Result<ScriptValue, InteropError> {
    let (world, attachment) = super::current_script(&context)?;
    world.with_world_mut(|world| {
        if attachment
            .entity()
            .is_some_and(|entity| world.get_entity(entity).is_err())
        {
            return error("unavailable");
        }
        let mut storage = world.resource_mut::<ScriptStorage>();
        let directory = storage.directory.clone();
        let bound = storage
            .bindings
            .entry(attachment)
            .or_insert(directory)
            .clone();
        operation(&ScriptStorage {
            directory: bound,
            bindings: Default::default(),
        })
    })
}

pub(super) fn clear_detached_storage_bindings(
    mut events: MessageReader<ScriptDetachedEvent>,
    mut storage: ResMut<ScriptStorage>,
) {
    for event in events.read() {
        storage.bindings.remove(&event.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{CoreScriptGlobalsPlugin, CurrentScriptAttachment, WorldGuard},
        core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
        script::ScriptAttachment,
    };

    fn app(root: &Path) -> App {
        let mut app = App::new();
        app.add_plugins((
            bevy::app::TaskPoolPlugin::default(),
            bevy::asset::AssetPlugin::default(),
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            super::super::RuneweaveScriptApiPlugin,
        ));
        app.insert_resource(ScriptStorage::for_test(root, "first"));
        app.world_mut().spawn((
            Window {
                resolution: bevy::window::WindowResolution::new(640, 360),
                ..default()
            },
            bevy::window::PrimaryWindow,
        ));
        app
    }

    fn state(value: ScriptValue, key: &str) -> String {
        let ScriptValue::Map(fields) = value else {
            panic!("expected structured result")
        };
        let Some(ScriptValue::String(value)) = fields.get(key) else {
            panic!("missing result field")
        };
        value.to_string()
    }

    #[test]
    fn saves_survive_recreation_and_projects_are_isolated() {
        let directory = tempfile::tempdir().unwrap();
        let first = ScriptStorage::for_test(directory.path(), "first");
        assert_eq!(state(first.read("profile"), "state"), "missing");
        assert_eq!(
            state(first.write("profile", "{\"score\":10}"), "state"),
            "ok"
        );
        let reopened = ScriptStorage::for_test(directory.path(), "first");
        assert_eq!(state(reopened.read("profile"), "value"), "{\"score\":10}");
        assert_eq!(state(reopened.write("profile", "new"), "state"), "ok");
        assert_eq!(state(first.read("profile"), "value"), "new");
        assert_eq!(
            state(
                ScriptStorage::for_test(directory.path(), "other").read("profile"),
                "state"
            ),
            "missing"
        );
        assert_eq!(state(first.remove("profile"), "state"), "ok");
        assert_eq!(state(first.remove("profile"), "state"), "missing");
    }

    #[test]
    fn rejects_traversal_and_oversized_values_without_overwriting() {
        let directory = tempfile::tempdir().unwrap();
        let store = ScriptStorage::for_test(directory.path(), "game");
        for key in ["../escape", "a/b", "a\\b", "", ".", "C:save", "a.json"] {
            assert_eq!(state(store.write(key, "bad"), "error"), "invalid_key");
        }
        store.write("profile", "good");
        assert_eq!(
            state(
                store.write("profile", &"x".repeat(MAX_VALUE_BYTES + 1)),
                "error"
            ),
            "too_large"
        );
        assert_eq!(state(store.read("profile"), "value"), "good");
        assert_eq!(
            fs::read_dir(store.directory.as_ref().unwrap())
                .unwrap()
                .count(),
            1
        );
        assert_eq!(
            state(
                ScriptStorage::for_test(directory.path(), "../game").read("profile"),
                "error"
            ),
            "unavailable"
        );
        assert_eq!(
            state(ScriptStorage::default().read("profile"), "error"),
            "unavailable"
        );
    }

    #[test]
    fn io_and_corruption_are_explicit_and_do_not_erase_previous_data() {
        let directory = tempfile::tempdir().unwrap();
        let store = ScriptStorage::for_test(directory.path(), "game");
        store.write("profile", "good");
        fs::write(store.path("profile").unwrap(), [0xff, 0xfe]).unwrap();
        assert_eq!(state(store.read("profile"), "error"), "invalid_data");
        fs::write(store.path("large").unwrap(), vec![0; MAX_VALUE_BYTES + 1]).unwrap();
        assert_eq!(state(store.read("large"), "error"), "too_large");
        fs::create_dir(store.path("directory").unwrap()).unwrap();
        assert_eq!(state(store.write("directory", "bad"), "error"), "io");
        assert_eq!(
            fs::read(store.path("profile").unwrap()).unwrap(),
            [0xff, 0xfe]
        );
    }

    #[test]
    fn old_attachments_keep_their_namespace_during_game_switches() -> Result<(), InteropError> {
        let directory = tempfile::tempdir().unwrap();
        let mut app = app(directory.path());
        let first = ScriptAttachment::EntityScript(
            app.world_mut().spawn_empty().id(),
            Handle::<ScriptAsset>::default(),
        );
        let second = ScriptAttachment::EntityScript(
            app.world_mut().spawn_empty().id(),
            Handle::<ScriptAsset>::default(),
        );
        let call = |app: &mut App,
                    attachment: &ScriptAttachment,
                    write: Option<&str>|
         -> Result<ScriptValue, InteropError> {
            let cache = WorldGuard::setup_cache(
                app.world(),
                CurrentScriptAttachment(Some(attachment.clone())),
            );
            WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
                let context = FunctionCallContext::new(Language::Unknown);
                if let Some(value) = write {
                    storage_write(context, "profile".into(), value.into())
                } else {
                    storage_read(context, "profile".into())
                }
            })
        };
        call(&mut app, &first, Some("first save"))?;
        app.world_mut().resource_mut::<ScriptStorage>().directory =
            ScriptStorage::for_test(directory.path(), "second").directory;
        assert_eq!(state(call(&mut app, &second, None)?, "state"), "missing");
        call(&mut app, &second, Some("second save"))?;
        call(&mut app, &first, Some("late first save"))?;
        assert_eq!(
            state(call(&mut app, &first, None)?, "value"),
            "late first save"
        );
        assert_eq!(
            state(call(&mut app, &second, None)?, "value"),
            "second save"
        );
        app.world_mut().despawn(first.entity().unwrap());
        assert_eq!(
            state(call(&mut app, &first, Some("must not write"))?, "error"),
            "unavailable"
        );
        Ok(())
    }

    #[cfg(any(feature = "js", feature = "typescript"))]
    #[test]
    fn quickjs_storage_uses_the_registered_portable_contract() -> Result<(), InteropError> {
        use bevy_mod_scripting::quickjs::{
            QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler,
        };
        let directory = tempfile::tempdir().unwrap();
        let mut app = app(directory.path());
        app.add_plugins(QuickJsScriptingPlugin::default());
        app.finish();
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let mut context = quickjs_context_load(
                &attachment,
                br#"
                function on_script_loaded() {
                    function check(value) { if (!value) throw Error("storage contract"); }
                    check(window_metrics().width === 640 && window_metrics().height === 360);
                    check(storage_read("profile").state === "missing");
                    check(storage_write("profile", "saved").state === "ok");
                    check(storage_read("profile").value === "saved");
                    check(storage_write("profile", "updated").state === "ok");
                    check(storage_read("profile").value === "updated");
                    check(storage_write("../escape", "bad").error === "invalid_key");
                    check(storage_remove("profile").state === "ok");
                    check(storage_read("profile").state === "missing");
                }
            "#,
                world_id,
            )?;
            quickjs_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )
        })
        .map(|_| ())
    }

    #[cfg(feature = "lua")]
    #[test]
    fn lua_storage_uses_the_registered_portable_contract() -> Result<(), InteropError> {
        use bevy_mod_scripting::lua::{LuaScriptingPlugin, lua_context_load, lua_handler};
        let directory = tempfile::tempdir().unwrap();
        let mut app = app(directory.path());
        app.add_plugins(LuaScriptingPlugin::default());
        app.finish();
        let world_id = app.world().id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |_guard| {
            let mut context = lua_context_load(
                &attachment,
                br#"
                function on_script_loaded()
                    assert(window_metrics().width == 640 and window_metrics().height == 360)
                    assert(storage_read("profile").state == "missing")
                    assert(storage_write("profile", "saved").state == "ok")
                    assert(storage_read("profile").value == "saved")
                    assert(storage_write("profile", "updated").state == "ok")
                    assert(storage_read("profile").value == "updated")
                    assert(storage_write("../escape", "bad").error == "invalid_key")
                    assert(storage_remove("profile").state == "ok")
                    assert(storage_read("profile").state == "missing")
                end
            "#,
                world_id,
            )?;
            lua_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut context,
                world_id,
            )
        })
        .map(|_| ())
    }
}
