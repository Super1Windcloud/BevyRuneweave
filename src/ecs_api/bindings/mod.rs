#[cfg(any(feature = "lua", feature = "luau"))]
mod lua;
#[cfg(any(feature = "js", feature = "typescript"))]
mod quickjs;

use bevy::prelude::App;

#[cfg(any(feature = "js", feature = "typescript"))]
pub(crate) fn add_language(app: &mut App) {
    app.add_plugins(quickjs::ecs_quickjs_plugin());
}

#[cfg(all(
    not(any(feature = "js", feature = "typescript")),
    any(feature = "lua", feature = "luau")
))]
pub(crate) fn add_language(app: &mut App) {
    app.add_plugins(lua::ecs_lua_plugin());
}
