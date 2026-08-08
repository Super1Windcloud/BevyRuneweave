#[cfg(feature = "lua")]
mod lua;
#[cfg(any(feature = "js", feature = "typescript"))]
mod quickjs;

use super::{command::EcsBridge, network::NetworkBridge};
use bevy::prelude::App;

pub(crate) fn add_language(app: &mut App, bridge: EcsBridge, network: NetworkBridge) {
    #[cfg(any(feature = "js", feature = "typescript"))]
    app.add_plugins(quickjs::ecs_quickjs_plugin(bridge.clone(), network.clone()));
    #[cfg(feature = "lua")]
    app.add_plugins(lua::ecs_lua_plugin(bridge, network));
}
