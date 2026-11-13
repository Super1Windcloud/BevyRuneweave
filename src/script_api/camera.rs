use bevy::prelude::*;
use bevy_mod_scripting::bindings::{FunctionCallContext, InteropError, WorldExtensions};

/// Portable perspective/look-at control for the existing runtime camera, through BMS.
#[allow(clippy::too_many_arguments)]
pub(super) fn scene_set_camera_3d(
    context: FunctionCallContext,
    x: f32,
    y: f32,
    z: f32,
    target_x: f32,
    target_y: f32,
    target_z: f32,
    fov_degrees: f32,
) -> Result<bool, InteropError> {
    if ![x, y, z, target_x, target_y, target_z, fov_degrees]
        .iter()
        .all(|value| value.is_finite())
        || !(10.0..=140.0).contains(&fov_degrees)
    {
        return Ok(false);
    }
    let position = Vec3::new(x, y, z);
    let target = Vec3::new(target_x, target_y, target_z);
    let direction = target - position;
    if !direction.is_finite()
        || !direction.length_squared().is_finite()
        || direction.length_squared() < 1e-8
    {
        return Ok(false);
    }
    let forward = direction.normalize();
    // A top-down camera also needs a stable, non-collinear up direction.
    let up = if forward.dot(Vec3::Y).abs() > 0.999 {
        Vec3::Z
    } else {
        Vec3::Y
    };
    context.world()?.with_world_mut(|world| {
        let mut query = world.query_filtered::<(&mut Transform, &mut Projection), With<Camera3d>>();
        let Some((mut transform, mut projection)) = query.iter_mut(world).next() else {
            return false;
        };
        *transform = Transform::from_translation(position).looking_at(target, up);
        match &mut *projection {
            Projection::Perspective(perspective) => perspective.fov = fov_degrees.to_radians(),
            _ => {
                *projection = Projection::Perspective(PerspectiveProjection {
                    fov: fov_degrees.to_radians(),
                    near: 0.1,
                    far: 2000.0,
                    ..default()
                });
            }
        }
        true
    })
}

#[cfg(test)]
mod tests {
    use bevy::asset::Handle;
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{AppScriptFunctionRegistry, CurrentScriptAttachment, WorldGuard},
        script::ScriptAttachment,
    };

    use super::*;

    #[test]
    fn camera_3d_validates_before_mutating_the_real_camera() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        let camera = world
            .spawn((
                Camera3d::default(),
                Transform::default(),
                Projection::Orthographic(OrthographicProjection::default_3d()),
            ))
            .id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache = WorldGuard::setup_cache(&world, CurrentScriptAttachment(Some(attachment)));
        WorldGuard::with_static_guard(&mut world, cache, |guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            for arguments in [
                [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 60.0],
                [f32::NAN, 1.0, 0.0, 0.0, 0.0, 0.0, 60.0],
                [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 180.0],
                [f32::MAX, 0.0, 0.0, -f32::MAX, 0.0, 0.0, 60.0],
            ] {
                let [x, y, z, tx, ty, tz, fov] = arguments;
                assert!(!scene_set_camera_3d(
                    context.clone(),
                    x,
                    y,
                    z,
                    tx,
                    ty,
                    tz,
                    fov
                )?);
            }
            guard.with_world(|world| {
                assert_eq!(
                    *world.get::<Transform>(camera).unwrap(),
                    Transform::default()
                );
                assert!(matches!(
                    world.get::<Projection>(camera),
                    Some(Projection::Orthographic(_))
                ));
            })?;
            assert!(scene_set_camera_3d(
                context.clone(),
                0.0,
                8.0,
                12.0,
                0.0,
                0.0,
                0.0,
                65.0
            )?);
            assert!(scene_set_camera_3d(
                context.clone(),
                0.0,
                8.0,
                0.0,
                0.0,
                0.0,
                0.0,
                70.0
            )?);
            guard.with_world(|world| {
                let transform = world.get::<Transform>(camera).unwrap();
                assert!(transform.rotation.is_finite());
                assert!(transform.forward().dot(Vec3::NEG_Y) > 0.999);
                let Projection::Perspective(projection) = world.get::<Projection>(camera).unwrap()
                else {
                    panic!("perspective camera");
                };
                assert!((projection.fov - 70.0_f32.to_radians()).abs() < 1e-6);
            })?;
            guard.with_world_mut(|world| {
                world.despawn(camera);
            })?;
            assert!(!scene_set_camera_3d(
                context, 0.0, 8.0, 12.0, 0.0, 0.0, 0.0, 65.0
            )?);
            Ok(())
        })
    }

    #[cfg(all(feature = "lua", any(feature = "js", feature = "typescript")))]
    #[test]
    fn camera_3d_is_registered_for_lua_and_quickjs() -> Result<(), InteropError> {
        use bevy_mod_scripting::{
            bindings::CoreScriptGlobalsPlugin,
            core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
            lua::{LuaScriptingPlugin, lua_context_load, lua_handler},
            quickjs::{QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler},
        };
        let mut app = App::new();
        app.add_plugins((
            bevy::app::TaskPoolPlugin::default(),
            bevy::asset::AssetPlugin::default(),
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            LuaScriptingPlugin::default(),
            QuickJsScriptingPlugin::default(),
            super::super::RuneweaveScriptApiPlugin,
        ));
        app.finish();
        let camera = app
            .world_mut()
            .spawn((
                Camera3d::default(),
                Transform::default(),
                Projection::default(),
            ))
            .id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let world_id = app.world().id();
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |guard| {
            let mut js = quickjs_context_load(
                &attachment,
                br#"
                function on_script_loaded() {
                    if (!scene_set_camera_3d(1, 8, 12, 1, 0, 0, 65)) throw Error("camera");
                    if (scene_set_camera_3d(99, 99, 99, 0, 0, 0, 180)) throw Error("invalid FOV");
                }
            "#,
                world_id,
            )?;
            quickjs_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut js,
                world_id,
            )?;
            let check = || {
                guard.with_world(|world| {
                    assert_eq!(
                        world.get::<Transform>(camera).unwrap().translation,
                        Vec3::new(1.0, 8.0, 12.0)
                    );
                    let Projection::Perspective(perspective) =
                        world.get::<Projection>(camera).unwrap()
                    else {
                        panic!("perspective camera");
                    };
                    assert!((perspective.fov - 65.0_f32.to_radians()).abs() < 1e-6);
                })
            };
            check()?;
            let mut lua = lua_context_load(
                &attachment,
                br#"
                function on_script_loaded()
                    assert(scene_set_camera_3d(1, 8, 12, 1, 0, 0, 65))
                    assert(not scene_set_camera_3d(99, 99, 99, 0, 0, 0, 180))
                end
            "#,
                world_id,
            )?;
            lua_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut lua,
                world_id,
            )?;
            check()
        })
    }
}
