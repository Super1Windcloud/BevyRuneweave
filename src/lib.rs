#[cfg(not(any(feature = "js", feature = "typescript", feature = "lua",)))]
compile_error!("enable exactly one scripting feature: js, typescript, or lua");
#[cfg(any(
    all(feature = "js", any(feature = "typescript", feature = "lua")),
    all(feature = "typescript", feature = "lua")
))]
compile_error!("the js, typescript, and lua features are mutually exclusive");

pub mod ecs_api;
mod example_host;
mod runtime;

pub use runtime::{
    build_app, build_app_with_assets, default_script_path, game_runtime_request_reload,
    game_runtime_run, run, run_with_assets,
};
