//! Opt-in performance baselines for the script-facing hot paths.
//!
//! The measurement is ignored by default. `just bench` records a run in
//! `target/perf-baseline/latest.json` and compares it with the machine-local
//! `baseline.json`; `just bench save` promotes the run to the baseline, and
//! `just bench compare <percent>` fails when a median regresses beyond the threshold.

use std::{
    error::Error,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use bevy::{
    app::{App, TaskPoolPlugin},
    asset::{AssetApp, AssetPlugin},
    image::Image,
    window::{PrimaryWindow, WindowResolution},
};
use bevy_mod_scripting::{
    asset::{Language, ScriptAsset},
    bindings::{CoreScriptGlobalsPlugin, CurrentScriptAttachment},
    core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
};
use serde::{Deserialize, Serialize};

use super::*;

const ENTITY_COUNTS: [usize; 3] = [100, 500, 1000];
const WARMUP_FRAMES: usize = 10;
const MEASURED_FRAMES: usize = 120;
const MEASURED_ROUNDS: usize = 5;
const REPORT_SCHEMA_VERSION: u32 = 1;
const FRAME_DELTA: f64 = 1.0 / 60.0;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Measurement {
    name: String,
    calls_per_frame: usize,
    median_us: f64,
    p95_us: f64,
    per_call_ns: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PerfReport {
    schema_version: u32,
    profile: String,
    target: String,
    results: Vec<Measurement>,
}

fn bench_app() -> App {
    let mut app = App::new();
    app.add_plugins((
        TaskPoolPlugin::default(),
        AssetPlugin::default(),
        CoreScriptGlobalsPlugin::default(),
        BMSScriptingInfrastructurePlugin::default(),
    ));
    #[cfg(any(feature = "js", feature = "typescript"))]
    app.add_plugins(bevy_mod_scripting::quickjs::QuickJsScriptingPlugin::default());
    #[cfg(feature = "lua")]
    app.add_plugins(bevy_mod_scripting::lua::LuaScriptingPlugin::default());
    app.add_plugins(RuneweaveScriptApiPlugin)
        .init_asset::<Image>();
    app.finish();

    let world = app.world_mut();
    world.spawn((
        Window {
            resolution: WindowResolution::new(600, 800),
            ..default()
        },
        PrimaryWindow,
    ));
    let mut keys = ButtonInput::<KeyCode>::default();
    keys.press(KeyCode::ArrowRight);
    keys.press(KeyCode::KeyW);
    world.insert_resource(keys);
    world.insert_resource(ButtonInput::<MouseButton>::default());
    app
}

fn with_script_guard<O>(
    app: &mut App,
    body: impl FnOnce(WorldGuard<'static>, &ScriptAttachment) -> Result<O, InteropError>,
) -> Result<O, InteropError> {
    let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
    let cache = WorldGuard::setup_cache(
        app.world(),
        CurrentScriptAttachment(Some(attachment.clone())),
    );
    WorldGuard::with_static_guard(app.world_mut(), cache, |guard| body(guard, &attachment))
}

fn spawn_entities(
    context: &FunctionCallContext,
    count: usize,
) -> Result<Vec<String>, InteropError> {
    let ids = (0..count)
        .map(|index| format!("entity_{index}"))
        .collect::<Vec<_>>();
    for id in &ids {
        if !scene_spawn(context.clone(), id.clone(), 0.0, 0.0, 0.0)? {
            return Err(InteropError::string(format!("could not spawn {id}")));
        }
    }
    Ok(ids)
}

fn ensure_entity_count(guard: &WorldGuard, expected: usize) -> Result<(), InteropError> {
    let actual =
        guard.with_world_mut(|world| world.query::<&ScriptEntityId>().iter(world).count())?;
    if actual == expected {
        Ok(())
    } else {
        Err(InteropError::string(format!(
            "benchmark expected {expected} script entities, found {actual}"
        )))
    }
}

fn micros(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1e6
}

/// Times `frame` once per simulated frame, clearing change trackers between
/// frames the same way `App::update` does.
fn measure(
    name: String,
    calls_per_frame: usize,
    guard: &WorldGuard,
    mut frame: impl FnMut(usize) -> Result<(), InteropError>,
) -> Result<Measurement, InteropError> {
    let mut samples = Vec::with_capacity(MEASURED_FRAMES);
    for index in 0..WARMUP_FRAMES + MEASURED_FRAMES {
        let started = Instant::now();
        frame(index)?;
        let elapsed = started.elapsed();
        guard.with_world_mut(World::clear_trackers)?;
        if index >= WARMUP_FRAMES {
            samples.push(elapsed);
        }
    }
    samples.sort_unstable();
    let median = samples[samples.len() / 2];
    let p95 = samples[(samples.len() * 95 / 100).min(samples.len() - 1)];
    Ok(Measurement {
        name,
        calls_per_frame,
        median_us: micros(median),
        p95_us: micros(p95),
        per_call_ns: median.as_secs_f64() * 1e9 / calls_per_frame.max(1) as f64,
    })
}

/// Every entity moves every frame, matching `renderSyncSystem` in the shooter.
fn rust_transform_sync(count: usize) -> Result<Measurement, InteropError> {
    with_script_guard(&mut bench_app(), |guard, _| {
        let context = FunctionCallContext::new(Language::Unknown);
        let ids = spawn_entities(&context, count)?;
        let measurement = measure(
            format!("rust/scene_set_transform/n={count}"),
            count,
            &guard,
            |frame| {
                let offset = frame as f32;
                for (index, id) in ids.iter().enumerate() {
                    scene_set_transform(
                        context.clone(),
                        id.clone(),
                        index as f32 + offset,
                        offset,
                        0.0,
                    )?;
                }
                Ok(())
            },
        )?;
        ensure_entity_count(&guard, count)?;
        Ok(measurement)
    })
}

/// An unchanged HUD refresh per frame, matching the shooter's `gameStateSystem`.
fn rust_hud_unchanged(count: usize) -> Result<Measurement, InteropError> {
    with_script_guard(&mut bench_app(), |guard, _| {
        let context = FunctionCallContext::new(Language::Unknown);
        spawn_entities(&context, count)?;
        scene_spawn(context.clone(), "hud".to_owned(), 0.0, 382.0, 20.0)?;
        let measurement = measure(format!("rust/hud_unchanged/n={count}"), 2, &guard, |_| {
            scene_set_text(
                context.clone(),
                "hud".to_owned(),
                "SCORE 00010    LIVES 3".to_owned(),
                24.0,
                0.82,
                0.94,
                1.0,
                1.0,
                "top_left".to_owned(),
            )?;
            game_state_set(context.clone(), 10, 3, String::new())
        })?;
        ensure_entity_count(&guard, count + 1)?;
        Ok(measurement)
    })
}

/// The shooter's per-frame input and window queries.
fn rust_frame_input(count: usize) -> Result<Measurement, InteropError> {
    const KEYS: [&str; 8] = [
        "ArrowRight",
        "KeyD",
        "ArrowLeft",
        "KeyA",
        "ArrowUp",
        "KeyW",
        "ArrowDown",
        "KeyS",
    ];
    with_script_guard(&mut bench_app(), |guard, _| {
        let context = FunctionCallContext::new(Language::Unknown);
        spawn_entities(&context, count)?;
        let measurement = measure(
            format!("rust/frame_input/n={count}"),
            KEYS.len() + 2,
            &guard,
            |_| {
                for key in KEYS {
                    input_key_pressed(context.clone(), key.to_owned())?;
                }
                input_primary_pointer(context.clone())?;
                window_safe_area(context.clone())?;
                Ok(())
            },
        )?;
        ensure_entity_count(&guard, count)?;
        Ok(measurement)
    })
}

#[cfg(any(feature = "js", feature = "typescript"))]
fn quickjs_transform_sync(count: usize) -> Result<Measurement, InteropError> {
    use bevy_mod_scripting::quickjs::{quickjs_context_load, quickjs_handler};

    const SOURCE: &str = r#"
const ids = Array.from({ length: __COUNT__ }, (_, index) => `entity_${index}`);
let elapsed = 0;
globalThis.on_script_loaded = function () {
  for (const id of ids) scene_spawn(id, 0, 0, 0);
};
globalThis.on_update = function (dt) {
  elapsed += dt;
  for (let index = 0; index < ids.length; index += 1) {
    scene_set_transform(ids[index], index + elapsed, elapsed, 0);
  }
};
"#;
    let mut app = bench_app();
    let world_id = app.world().id();
    with_script_guard(&mut app, |guard, attachment| {
        let source = SOURCE.replace("__COUNT__", &count.to_string());
        let mut context = quickjs_context_load(attachment, source.as_bytes(), world_id)?;
        quickjs_handler(
            Vec::new(),
            attachment,
            &CallbackLabel::from("on_script_loaded"),
            &mut context,
            world_id,
        )?;
        let on_update = CallbackLabel::from("on_update");
        let measurement = measure(
            format!("quickjs/scene_set_transform/n={count}"),
            count,
            &guard,
            |_| {
                quickjs_handler(
                    vec![ScriptValue::Float(FRAME_DELTA)],
                    attachment,
                    &on_update,
                    &mut context,
                    world_id,
                )
                .map(drop)
            },
        )?;
        ensure_entity_count(&guard, count)?;
        Ok(measurement)
    })
}

#[cfg(feature = "lua")]
fn lua_transform_sync(count: usize) -> Result<Measurement, InteropError> {
    use bevy_mod_scripting::lua::{lua_context_load, lua_handler};

    const SOURCE: &str = r#"
local ids = {}
for index = 1, __COUNT__ do
  ids[index] = "entity_" .. (index - 1)
end
local elapsed = 0
function on_script_loaded()
  for index = 1, #ids do
    scene_spawn(ids[index], 0, 0, 0)
  end
end
function on_update(dt)
  elapsed = elapsed + dt
  for index = 1, #ids do
    scene_set_transform(ids[index], index + elapsed, elapsed, 0)
  end
end
"#;
    let mut app = bench_app();
    let world_id = app.world().id();
    with_script_guard(&mut app, |guard, attachment| {
        let source = SOURCE.replace("__COUNT__", &count.to_string());
        let mut context = lua_context_load(attachment, source.as_bytes(), world_id)?;
        lua_handler(
            Vec::new(),
            attachment,
            &CallbackLabel::from("on_script_loaded"),
            &mut context,
            world_id,
        )?;
        let on_update = CallbackLabel::from("on_update");
        let measurement = measure(
            format!("lua/scene_set_transform/n={count}"),
            count,
            &guard,
            |_| {
                lua_handler(
                    vec![ScriptValue::Float(FRAME_DELTA)],
                    attachment,
                    &on_update,
                    &mut context,
                    world_id,
                )
                .map(drop)
            },
        )?;
        ensure_entity_count(&guard, count)?;
        Ok(measurement)
    })
}

fn report_dir() -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target"))
        .join("perf-baseline")
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Prints the run and returns the measurements that regressed beyond `max_regression`.
fn print_report(
    report: &PerfReport,
    baseline: Option<&PerfReport>,
    max_regression: Option<f64>,
) -> Vec<String> {
    let mut regressions = Vec::new();
    println!(
        "\nRuneweave performance baseline ({}, {}; quietest of {MEASURED_ROUNDS} rounds x {MEASURED_FRAMES} frames)",
        report.profile, report.target
    );
    println!(
        "{:<36} {:>7} {:>12} {:>12} {:>12} {:>10}",
        "scenario", "calls", "median us", "p95 us", "ns/call", "vs base"
    );
    for result in &report.results {
        let previous = baseline.and_then(|baseline| {
            baseline
                .results
                .iter()
                .find(|candidate| candidate.name == result.name)
        });
        let delta = previous
            .filter(|previous| previous.median_us > 0.0)
            .map(|previous| (result.median_us - previous.median_us) / previous.median_us * 100.0);
        let delta_label = delta.map_or_else(|| "-".to_owned(), |delta| format!("{delta:+.1}%"));
        println!(
            "{:<36} {:>7} {:>12.1} {:>12.1} {:>12.1} {:>10}",
            result.name,
            result.calls_per_frame,
            result.median_us,
            result.p95_us,
            result.per_call_ns,
            delta_label
        );
        if let (Some(delta), Some(limit)) = (delta, max_regression)
            && delta > limit
        {
            regressions.push(format!(
                "{} regressed {delta:.1}% (limit {limit}%)",
                result.name
            ));
        }
    }
    print_scaling(report);
    regressions
}

/// Prints the machine-independent per-call cost growth from the smallest to the
/// largest entity count; constant-time lookups keep this ratio near 1.0.
fn print_scaling(report: &PerfReport) {
    let (smallest, largest) = (ENTITY_COUNTS[0], ENTITY_COUNTS[ENTITY_COUNTS.len() - 1]);
    let suffix = format!("/n={smallest}");
    println!("\nper-call cost growth from n={smallest} to n={largest}");
    for small in report
        .results
        .iter()
        .filter(|result| result.name.ends_with(&suffix))
    {
        let scenario = &small.name[..small.name.len() - suffix.len()];
        let large_name = format!("{scenario}/n={largest}");
        if let Some(large) = report
            .results
            .iter()
            .find(|result| result.name == large_name)
            && small.per_call_ns > 0.0
        {
            println!(
                "{scenario:<30} {:>6.2}x",
                large.per_call_ns / small.per_call_ns
            );
        }
    }
}

#[test]
#[ignore = "performance baseline; run with `just bench`"]
fn perf_baseline() -> Result<(), Box<dyn Error>> {
    // Rounds interleave every scenario so host load spikes spread across all of
    // them; each scenario keeps its quietest round.
    let mut results = Vec::<Measurement>::new();
    for _ in 0..MEASURED_ROUNDS {
        for count in ENTITY_COUNTS {
            let round = [
                rust_transform_sync(count)?,
                rust_hud_unchanged(count)?,
                rust_frame_input(count)?,
                #[cfg(any(feature = "js", feature = "typescript"))]
                quickjs_transform_sync(count)?,
                #[cfg(feature = "lua")]
                lua_transform_sync(count)?,
            ];
            for measurement in round {
                match results
                    .iter_mut()
                    .find(|result| result.name == measurement.name)
                {
                    Some(result) if measurement.median_us < result.median_us => {
                        *result = measurement;
                    }
                    Some(_) => {}
                    None => results.push(measurement),
                }
            }
        }
    }
    let report = PerfReport {
        schema_version: REPORT_SCHEMA_VERSION,
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .to_owned(),
        target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        results,
    };

    let directory = report_dir();
    fs::create_dir_all(&directory)?;
    let encoded = serde_json::to_vec_pretty(&report)?;
    fs::write(directory.join("latest.json"), &encoded)?;
    let baseline_path = directory.join("baseline.json");

    let mode = env_value("RUNEWEAVE_PERF_BASELINE").unwrap_or_else(|| "compare".to_owned());
    let max_regression = env_value("RUNEWEAVE_PERF_MAX_REGRESSION")
        .map(|value| value.parse::<f64>())
        .transpose()?;
    if cfg!(debug_assertions) {
        println!("warning: debug build timings are not representative; run `just bench`");
    }

    match mode.as_str() {
        "save" => {
            print_report(&report, None, None);
            fs::write(&baseline_path, &encoded)?;
            println!("saved baseline to {}", baseline_path.display());
            Ok(())
        }
        "compare" => {
            let baseline = match fs::read(&baseline_path) {
                Ok(bytes) => Some(serde_json::from_slice::<PerfReport>(&bytes)?),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.into()),
            };
            let comparable = baseline.filter(|baseline| {
                baseline.schema_version == report.schema_version
                    && baseline.profile == report.profile
                    && baseline.target == report.target
            });
            let regressions = print_report(&report, comparable.as_ref(), max_regression);
            println!("wrote {}", directory.join("latest.json").display());
            if comparable.is_none() {
                println!(
                    "no comparable baseline at {}; run `just bench save` first",
                    baseline_path.display()
                );
                if max_regression.is_some() {
                    return Err("a regression limit requires a comparable baseline".into());
                }
            }
            if regressions.is_empty() {
                Ok(())
            } else {
                Err(regressions.join("\n").into())
            }
        }
        other => Err(
            format!("RUNEWEAVE_PERF_BASELINE must be `compare` or `save`, got `{other}`").into(),
        ),
    }
}
