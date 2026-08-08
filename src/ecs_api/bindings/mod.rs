#[cfg(feature = "lua")]
mod lua;
#[cfg(any(feature = "js", feature = "typescript"))]
mod quickjs;

use super::command::EcsBridge;
use bevy::prelude::App;

pub(crate) fn add_language(app: &mut App, bridge: EcsBridge) {
    #[cfg(any(feature = "js", feature = "typescript"))]
    app.add_plugins(quickjs::ecs_quickjs_plugin(bridge.clone()));
    #[cfg(feature = "lua")]
    app.add_plugins(lua::ecs_lua_plugin(bridge));
}
