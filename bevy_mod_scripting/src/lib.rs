#![doc=include_str!("../readme.md")]

pub mod display {
    pub use bevy_mod_scripting_display::*;
}

pub mod bindings {
    pub use bevy_mod_scripting_bindings::*;
    pub use bevy_mod_scripting_bindings_domain::*;
}

pub mod core {
    pub use bevy_mod_scripting_core::*;
}

pub mod asset {
    pub use bevy_mod_scripting_asset::*;
}

pub mod script {
    pub use bevy_mod_scripting_script::*;
}

pub mod prelude;

#[cfg(feature = "lua")]
pub mod lua {
    pub use bevy_mod_scripting_lua::*;
}

#[cfg(feature = "quickjs")]
pub mod quickjs {
    pub use bevy_mod_scripting_quickjs::*;
}

/// TypeScript integration through JavaScript emitted for the QuickJS runtime.
#[cfg(feature = "typescript")]
pub mod typescript {
    pub use bevy_mod_scripting_quickjs::{
        QuickJsContext as TypeScriptContext, QuickJsScriptingPlugin as TypeScriptScriptingPlugin,
        rquickjs,
    };
}

use bevy_app::plugin_group;
pub use bevy_mod_scripting_bindings::CoreScriptGlobalsPlugin;
use bevy_mod_scripting_core::BMSScriptingInfrastructurePlugin;
pub use bevy_mod_scripting_derive::*;

plugin_group! {
    pub struct BMSPlugin {
        :CoreScriptGlobalsPlugin,
        :BMSScriptingInfrastructurePlugin,
        #[custom(cfg(feature = "lua"))]
        bevy_mod_scripting_lua:::LuaScriptingPlugin,
        #[custom(cfg(feature = "quickjs"))]
        bevy_mod_scripting_quickjs:::QuickJsScriptingPlugin
    }
}
