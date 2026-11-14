//! Owned, asynchronous audio playback through the shared BMS registry.
use std::{io::Cursor, time::Instant};

use bevy::{
    asset::{AssetLoader, LoadContext, LoadState, io::Reader},
    prelude::*,
};
use bevy_audio::{
    AddAudioSource, AudioPlayer, AudioSink, AudioSinkPlayback, AudioSource, Decodable,
    PlaybackSettings, Volume,
};
use bevy_mod_scripting::{
    bindings::{FunctionCallContext, InteropError, WorldExtensions},
    script::ScriptAttachment,
};

use super::{ScriptOwnedBy, current_script, valid_asset_path, valid_entity_id};

#[derive(Asset, TypePath, Clone)]
struct CheckedAudio(AudioSource);

impl Decodable for CheckedAudio {
    type Decoder = rodio::Decoder<Cursor<AudioSource>>;
    fn decoder(&self) -> Self::Decoder {
        // The immutable bytes passed the same decoder constructor on the asset I/O thread.
        rodio::Decoder::new(Cursor::new(self.0.clone())).expect("validated Ogg source")
    }
}

#[derive(Default, TypePath)]
struct CheckedAudioLoader;

fn checked_source(bytes: Vec<u8>) -> Result<CheckedAudio, std::io::Error> {
    let source = AudioSource {
        bytes: bytes.into(),
    };
    rodio::Decoder::new(Cursor::new(source.clone()))
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
    Ok(CheckedAudio(source))
}

impl AssetLoader for CheckedAudioLoader {
    type Asset = CheckedAudio;
    type Settings = ();
    type Error = std::io::Error;
    async fn load(
        &self,
        reader: &mut dyn Reader,
        _: &(),
        _: &mut LoadContext<'_>,
    ) -> Result<CheckedAudio, Self::Error> {
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await?;
        checked_source(bytes)
    }
    fn extensions(&self) -> &[&str] {
        &["ogg", "oga"]
    }
}

#[derive(Component, Reflect)]
#[reflect(Component)]
pub(super) struct ScriptAudio {
    id: String,
    paused: bool,
    #[reflect(ignore)]
    queued_at: Option<Instant>,
}

pub(super) fn install(app: &mut App) {
    app.add_plugins(bevy_audio::AudioPlugin::default())
        .add_audio_source::<CheckedAudio>()
        .init_asset_loader::<CheckedAudioLoader>()
        .add_systems(
            PostUpdate,
            sync_focus.before(bevy::transform::TransformSystems::Propagate),
        );
}

fn sync_focus(
    lifecycle: Option<Res<crate::runtime::ScriptLifecycle>>,
    mut sounds: Query<(&ScriptAudio, &mut PlaybackSettings, Option<&AudioSink>)>,
) {
    let active = lifecycle.is_none_or(|state| state.is_active());
    for (sound, mut settings, sink) in &mut sounds {
        let paused = sound.paused || !active;
        if settings.paused != paused {
            settings.paused = paused;
        }
        if let Some(sink) = sink {
            if paused && !sink.is_paused() {
                sink.pause();
            }
            if !paused && sink.is_paused() {
                sink.play();
            }
        }
    }
}

fn find_audio(world: &mut World, owner: &ScriptAttachment, id: &str) -> Option<Entity> {
    world
        .query::<(Entity, &ScriptOwnedBy, &ScriptAudio)>()
        .iter(world)
        .find(|(_, candidate, sound)| candidate.0 == *owner && sound.id == id)
        .map(|(entity, _, _)| entity)
}

pub(super) fn audio_play(
    context: FunctionCallContext,
    id: String,
    path: String,
    looping: bool,
    volume: f32,
) -> Result<bool, InteropError> {
    if !valid_entity_id(&id)
        || !valid_asset_path(&path)
        || !["ogg", "oga"]
            .iter()
            .any(|ext| path.ends_with(&format!(".{ext}")))
        || !volume.is_finite()
        || !(0.0..=1.0).contains(&volume)
    {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        if !world.contains_resource::<Assets<CheckedAudio>>() {
            return false;
        }
        let Some(server) = world.get_resource::<AssetServer>() else {
            return false;
        };
        let handle: Handle<CheckedAudio> = server.load(path);
        let existing = find_audio(world, &owner, &id);
        let count = world
            .query::<(&ScriptOwnedBy, &ScriptAudio)>()
            .iter(world)
            .filter(|(candidate, _)| candidate.0 == owner)
            .count();
        if count >= 64 && existing.is_none() {
            return false;
        }
        if let Some(entity) = existing {
            world.despawn(entity);
        }
        world.spawn((
            ScriptOwnedBy(owner),
            ScriptAudio {
                id,
                paused: false,
                queued_at: Some(Instant::now()),
            },
            AudioPlayer::<CheckedAudio>(handle),
            (if looping {
                PlaybackSettings::LOOP
            } else {
                PlaybackSettings::DESPAWN
            })
            .with_volume(Volume::Linear(volume)),
        ));
        true
    })
}

pub(super) fn audio_update(
    context: FunctionCallContext,
    id: String,
    volume: f32,
    speed: f32,
    paused: bool,
) -> Result<bool, InteropError> {
    if !volume.is_finite()
        || !speed.is_finite()
        || !(0.0..=1.0).contains(&volume)
        || !(0.25..=4.0).contains(&speed)
    {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_audio(world, &owner, &id) else {
            return false;
        };
        world.get_mut::<ScriptAudio>(entity).unwrap().paused = paused;
        if let Some(mut settings) = world.get_mut::<PlaybackSettings>(entity) {
            settings.volume = Volume::Linear(volume);
            settings.speed = speed;
            settings.paused = paused;
        }
        if let Some(mut sink) = world.get_mut::<AudioSink>(entity) {
            sink.set_volume(Volume::Linear(volume));
            sink.set_speed(speed);
        }
        true
    })
}

pub(super) fn audio_stop(context: FunctionCallContext, id: String) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        find_audio(world, &owner, &id).is_some_and(|entity| world.despawn(entity))
    })
}

pub(super) fn audio_state(
    context: FunctionCallContext,
    id: String,
) -> Result<String, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_audio(world, &owner, &id) else {
            return "missing".into();
        };
        if let Some(sink) = world.get::<AudioSink>(entity) {
            return if sink.is_paused() {
                "paused"
            } else {
                "playing"
            }
            .into();
        }
        let Some(player) = world.get::<AudioPlayer<CheckedAudio>>(entity) else {
            return "error".into();
        };
        match world
            .get_resource::<AssetServer>()
            .and_then(|server| server.get_load_state(player.0.id()))
        {
            Some(LoadState::Failed(_)) => "error",
            Some(LoadState::Loaded)
                if world
                    .get::<ScriptAudio>(entity)
                    .unwrap()
                    .queued_at
                    .is_some_and(|time| time.elapsed().as_secs() >= 5) =>
            {
                "unavailable"
            }
            _ => "queued",
        }
        .into()
    })
}

pub(super) fn audio_clear(context: FunctionCallContext) -> Result<(), InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let entities: Vec<_> = world
            .query::<(Entity, &ScriptOwnedBy, &ScriptAudio)>()
            .iter(world)
            .filter(|(_, candidate, _)| candidate.0 == owner)
            .map(|(entity, _, _)| entity)
            .collect();
        for entity in entities {
            world.despawn(entity);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::asset::AssetApp;
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{AppScriptFunctionRegistry, CurrentScriptAttachment, WorldGuard},
    };

    fn app() -> App {
        let mut app = App::new();
        app.add_plugins((
            bevy::app::TaskPoolPlugin::default(),
            bevy::asset::AssetPlugin::default(),
        ))
        .init_asset::<CheckedAudio>()
        .init_asset_loader::<CheckedAudioLoader>()
        .init_resource::<AppScriptFunctionRegistry>()
        .init_resource::<AppTypeRegistry>();
        app
    }

    #[test]
    fn corrupt_audio_is_a_loader_error_before_any_playback_sink() {
        for bytes in [Vec::new(), b"OggSnot an audio stream".to_vec()] {
            assert!(checked_source(bytes).is_err());
        }
    }

    #[test]
    fn audio_is_owned_bounded_validated_and_survives_scene_clear() -> Result<(), InteropError> {
        let mut app = app();
        let owner = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let foreign =
            ScriptAttachment::EntityScript(app.world_mut().spawn_empty().id(), Handle::default());
        let other = app
            .world_mut()
            .spawn((
                ScriptOwnedBy(foreign),
                ScriptAudio {
                    id: "music".into(),
                    paused: false,
                    queued_at: None,
                },
            ))
            .id();
        let cache = WorldGuard::setup_cache(app.world(), CurrentScriptAttachment(Some(owner)));
        WorldGuard::with_static_guard(app.world_mut(), cache, |guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            for (id, path, volume) in [
                ("music", "../bad.ogg", 0.5),
                ("music", "/bad.ogg", 0.5),
                ("music", "bad.mp3", 0.5),
                ("", "bad.ogg", 0.5),
                ("music", "bad.ogg", f32::NAN),
                ("music", "bad.ogg", -1.0),
            ] {
                assert!(!audio_play(
                    context.clone(),
                    id.into(),
                    path.into(),
                    true,
                    volume
                )?);
            }
            assert_eq!(audio_state(context.clone(), "music".into())?, "missing");
            assert!(audio_play(
                context.clone(),
                "music".into(),
                "missing-audio-test.ogg".into(),
                true,
                0.5
            )?);
            assert!(!audio_update(
                context.clone(),
                "music".into(),
                1.0,
                0.0,
                false
            )?);
            assert!(audio_update(
                context.clone(),
                "music".into(),
                0.25,
                1.5,
                true
            )?);
            super::super::scene_clear(context.clone())?;
            assert_ne!(audio_state(context.clone(), "music".into())?, "missing");
            guard.with_world_mut(|world| {
                let (audio, settings) = world
                    .query::<(&ScriptAudio, &PlaybackSettings)>()
                    .single(world)
                    .unwrap();
                assert!(audio.paused && settings.paused);
                assert_eq!(settings.volume, Volume::Linear(0.25));
                assert_eq!(settings.speed, 1.5);
                world.run_system_cached(sync_focus).unwrap();
                assert!(
                    world
                        .query::<&PlaybackSettings>()
                        .single(world)
                        .unwrap()
                        .paused
                );
            })?;
            for index in 1..64 {
                assert!(audio_play(
                    context.clone(),
                    format!("voice-{index}"),
                    "missing-audio-test.ogg".into(),
                    false,
                    0.0
                )?);
            }
            assert!(!audio_play(
                context.clone(),
                "overflow".into(),
                "missing-audio-test.ogg".into(),
                false,
                0.0
            )?);
            assert!(audio_play(
                context.clone(),
                "music".into(),
                "missing-audio-test.ogg".into(),
                true,
                0.5
            )?);
            assert!(audio_stop(context.clone(), "music".into())?);
            assert!(!audio_stop(context.clone(), "music".into())?);
            audio_clear(context)?;
            guard.with_world(|world| assert!(world.get::<ScriptAudio>(other).is_some()))?;
            Ok(())
        })
    }

    #[cfg(all(feature = "lua", any(feature = "js", feature = "typescript")))]
    #[test]
    fn lua_and_quickjs_audio_use_one_registry_and_real_playback_components()
    -> Result<(), InteropError> {
        use bevy_mod_scripting::{
            bindings::CoreScriptGlobalsPlugin,
            core::{BMSScriptingInfrastructurePlugin, event::CallbackLabel},
            lua::{LuaScriptingPlugin, lua_context_load, lua_handler},
            quickjs::{QuickJsScriptingPlugin, quickjs_context_load, quickjs_handler},
        };
        let mut app = app();
        app.add_plugins((
            CoreScriptGlobalsPlugin::default(),
            BMSScriptingInfrastructurePlugin::default(),
            LuaScriptingPlugin::default(),
            QuickJsScriptingPlugin::default(),
            super::super::RuneweaveScriptApiPlugin,
        ));
        app.finish();
        assert!(
            app.world()
                .resource::<AppTypeRegistry>()
                .read()
                .contains(std::any::TypeId::of::<ScriptAudio>())
        );
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let world_id = app.world().id();
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |guard| {
            let mut js = quickjs_context_load(
                &attachment,
                br#"function on_script_loaded() {
                if (audio_play("bad", "../bad.ogg", false, 1)) throw Error("path");
                if (!audio_play("music", "missing-audio-test.ogg", true, 0.5)) throw Error("queue");
                if (!audio_update("music", 0.25, 1.5, true)) throw Error("update");
                if (audio_state("music") === "missing") throw Error("state");
            }"#,
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
                guard.with_world_mut(|world| {
                    let settings = world.query::<&PlaybackSettings>().single(world).unwrap();
                    assert_eq!(settings.volume, Volume::Linear(0.25));
                    assert_eq!(settings.speed, 1.5);
                    assert!(settings.paused);
                })
            };
            check()?;
            let mut lua = lua_context_load(
                &attachment,
                br#"function on_script_loaded()
                audio_clear()
                assert(not audio_play("bad", "../bad.ogg", false, 1))
                assert(audio_play("music", "missing-audio-test.ogg", true, 0.5))
                assert(audio_update("music", 0.25, 1.5, true))
                assert(audio_state("music") ~= "missing")
            end"#,
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
