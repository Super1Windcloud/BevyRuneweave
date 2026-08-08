#[cfg(not(any(feature = "js", feature = "typescript", feature = "lua")))]
compile_error!("enable a scripting feature: unified, js, typescript, or lua");
#[cfg(all(feature = "js", feature = "typescript"))]
compile_error!("the js and typescript features select the same QuickJS backend");

pub mod ecs_api;
mod example_host;
mod runtime;

pub use runtime::{
    build_app, build_app_with_assets, default_script_path, game_runtime_request_reload,
    game_runtime_run, game_runtime_run_with_assets, run, run_with_assets,
};
