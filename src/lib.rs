#[cfg(not(any(
    feature = "js",
    feature = "typescript",
    feature = "lua",
    feature = "luau"
)))]
compile_error!("enable exactly one scripting feature: js, typescript, lua, or luau");
#[cfg(any(
    all(
        feature = "js",
        any(feature = "typescript", feature = "lua", feature = "luau")
    ),
    all(feature = "typescript", any(feature = "lua", feature = "luau")),
    all(feature = "lua", feature = "luau")
))]
compile_error!("the js, typescript, lua, and luau features are mutually exclusive");

mod ecs_api;
mod runtime;

pub use runtime::{
    build_app, build_app_with_assets, default_script_path, game_runtime_request_reload,
    game_runtime_run, run, run_with_assets,
};
