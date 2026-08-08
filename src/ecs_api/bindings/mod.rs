#[cfg(feature = "lua")]
mod lua;
#[cfg(any(feature = "js", feature = "typescript"))]
mod quickjs;

use super::command::EcsBridge;
use bevy::prelude::App;

#[cfg(any(feature = "js", feature = "typescript"))]
pub(crate) fn add_language(app: &mut App, bridge: EcsBridge) {
    app.add_plugins(quickjs::ecs_quickjs_plugin(bridge));
}

#[cfg(all(not(any(feature = "js", feature = "typescript")), feature = "lua"))]
pub(crate) fn add_language(app: &mut App, bridge: EcsBridge) {
    app.add_plugins(lua::ecs_lua_plugin(bridge));
}
