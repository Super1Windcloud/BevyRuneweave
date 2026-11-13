use bevy::{
    pbr::{DistanceFog, FogFalloff},
    prelude::*,
};
use bevy_mod_scripting::bindings::{FunctionCallContext, InteropError, WorldExtensions};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FogSpec {
    color: [f32; 4],
    start: f32,
    end: f32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnvironmentSpec {
    ambient: [f32; 3],
    brightness: f32,
    sun: [f32; 3],
    illuminance: f32,
    direction: [f32; 3],
    background: [f32; 3],
    fog: Option<FogSpec>,
}

pub(super) fn scene_set_environment(
    context: FunctionCallContext,
    json: String,
) -> Result<bool, InteropError> {
    if json.len() > 4096 {
        return Ok(false);
    }
    let Ok(spec) = serde_json::from_str::<EnvironmentSpec>(&json) else {
        return Ok(false);
    };
    let color_valid = |values: &[f32]| {
        values
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
    };
    let direction = Vec3::from_array(spec.direction);
    if !color_valid(&spec.ambient)
        || !color_valid(&spec.sun)
        || !color_valid(&spec.background)
        || !spec.brightness.is_finite()
        || !(0.0..=10000.0).contains(&spec.brightness)
        || !spec.illuminance.is_finite()
        || !(0.0..=200000.0).contains(&spec.illuminance)
        || !direction.is_finite()
        || !direction.length_squared().is_finite()
        || direction.length_squared() < 1e-8
        || spec.fog.as_ref().is_some_and(|fog| {
            !color_valid(&fog.color)
                || !fog.start.is_finite()
                || !fog.end.is_finite()
                || fog.start < 0.0
                || fog.end <= fog.start
        })
    {
        return Ok(false);
    }
    context.world()?.with_world_mut(|world| {
        let cameras: Vec<_> = world
            .query_filtered::<Entity, With<Camera3d>>()
            .iter(world)
            .collect();
        if cameras.is_empty() {
            return false;
        }
        let [r, g, b] = spec.ambient;
        world.insert_resource(GlobalAmbientLight {
            color: Color::srgb(r, g, b),
            brightness: spec.brightness,
            ..default()
        });
        let [r, g, b] = spec.background;
        world.insert_resource(ClearColor(Color::srgb(r, g, b)));
        let rotation = Transform::from_translation(direction)
            .looking_at(
                Vec3::ZERO,
                if direction.normalize().dot(Vec3::Y).abs() > 0.999 {
                    Vec3::Z
                } else {
                    Vec3::Y
                },
            )
            .rotation;
        for (mut light, mut transform) in world
            .query::<(&mut DirectionalLight, &mut Transform)>()
            .iter_mut(world)
        {
            let [r, g, b] = spec.sun;
            light.color = Color::srgb(r, g, b);
            light.illuminance = spec.illuminance;
            transform.rotation = rotation;
        }
        for camera in cameras {
            let mut entity = world.entity_mut(camera);
            if let Some(fog) = &spec.fog {
                let [r, g, b, a] = fog.color;
                entity.insert(DistanceFog {
                    color: Color::srgba(r, g, b, a),
                    falloff: FogFalloff::Linear {
                        start: fog.start,
                        end: fog.end,
                    },
                    ..default()
                });
            } else {
                entity.remove::<DistanceFog>();
            }
        }
        true
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{AppScriptFunctionRegistry, CurrentScriptAttachment, WorldGuard},
        script::ScriptAttachment,
    };

    #[test]
    fn environment_updates_real_resources_and_rejects_invalid_values_transactionally()
    -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        let camera = world.spawn(Camera3d::default()).id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(&world, CurrentScriptAttachment(Some(attachment)));
        WorldGuard::with_static_guard(&mut world, cache, |guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            let valid = r#"{"ambient":[0.2,0.3,0.4],"brightness":350,"sun":[0.2,0.2,0.3],"illuminance":6000,"direction":[-1,2,1],"background":[0.3,0.4,1],"fog":{"color":[0.1,0.2,0.3,0.5],"start":20,"end":160}}"#;
            assert!(scene_set_environment(context.clone(), valid.into())?);
            for invalid in [
                valid.replace("6000", "-1"),
                valid.replace("160", "10"),
                valid.replace("0.2,0.3,0.4", "2,0.3,0.4"),
                valid.replace("-1,2,1", "0,0,0"),
                "{}".into(),
            ] {
                assert!(!scene_set_environment(context.clone(), invalid)?);
            }
            guard.with_world(|world| {
                assert_eq!(world.resource::<GlobalAmbientLight>().brightness, 350.0);
                assert!(matches!(
                    world.get::<DistanceFog>(camera).unwrap().falloff,
                    FogFalloff::Linear {
                        start: 20.0,
                        end: 160.0
                    }
                ));
            })?;
            assert!(scene_set_environment(
                context,
                valid.replace(
                    r#"{"color":[0.1,0.2,0.3,0.5],"start":20,"end":160}"#,
                    "null"
                )
            )?);
            guard.with_world(|world| assert!(world.get::<DistanceFog>(camera).is_none()))
        })
    }
}
