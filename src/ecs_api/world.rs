use std::collections::HashMap;

use bevy::{prelude::*, sprite::Anchor};

use super::{EcsApiConfig, command::EcsCommand};

#[derive(Resource, Default)]
pub(super) struct ScriptEntityRegistry(HashMap<String, Entity>);

#[derive(Resource, Default)]
pub(super) struct GameState {
    score: i32,
    lives: i32,
    message: String,
}

#[derive(Component)]
pub(super) struct ScriptOwned;

#[derive(Component)]
pub(super) struct ScriptEntityId {
    _key: String,
}

#[derive(Component)]
pub(super) struct SpriteKind(String);

#[derive(Component)]
pub(super) struct ScriptTransform {
    x: f32,
    y: f32,
}

#[derive(Component)]
pub(super) struct GameStateText;

pub(super) fn setup_scene(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    config: Res<EcsApiConfig>,
) {
    commands.spawn(Camera2d);
    commands.spawn((
        Sprite {
            image: asset_server.load("sprites/background.png"),
            custom_size: Some(Vec2::new(config.width, config.height)),
            ..default()
        },
        Transform::from_xyz(0.0, 0.0, -10.0),
    ));
    commands.spawn((
        Text2d::new("SCORE 00000    LIVES 0"),
        TextFont {
            font_size: FontSize::Px(25.0),
            ..default()
        },
        TextColor(Color::srgb(0.82, 0.94, 1.0)),
        Anchor::TOP_CENTER,
        Transform::from_xyz(0.0, config.height / 2.0 - 18.0, 20.0),
        GameStateText,
    ));
}

pub(super) fn apply_ecs_writes(
    mut commands: Commands,
    mut pending: MessageReader<EcsCommand>,
    mut entities: ResMut<ScriptEntityRegistry>,
    mut game_state: ResMut<GameState>,
    script_entities: Query<Entity, With<ScriptOwned>>,
) {
    for command in pending.read() {
        match command {
            EcsCommand::ClearWorld => {
                for entity in &script_entities {
                    commands.entity(entity).despawn();
                }
                entities.0.clear();
            }
            EcsCommand::SpawnEntity { id } => {
                if let Some(old) = entities.0.remove(id) {
                    commands.entity(old).despawn();
                }
                let entity = commands
                    .spawn((
                        ScriptOwned,
                        ScriptEntityId { _key: id.clone() },
                        Transform::default(),
                    ))
                    .id();
                entities.0.insert(id.clone(), entity);
            }
            EcsCommand::InsertSprite { id, kind } => {
                if let Some(entity) = entities.0.get(id) {
                    commands.entity(*entity).insert(SpriteKind(kind.clone()));
                }
            }
            EcsCommand::SetTransform { id, x, y } => {
                if let Some(entity) = entities.0.get(id) {
                    commands
                        .entity(*entity)
                        .insert(ScriptTransform { x: *x, y: *y });
                }
            }
            EcsCommand::DespawnEntity { id } => {
                if let Some(entity) = entities.0.remove(id) {
                    commands.entity(entity).despawn();
                }
            }
            EcsCommand::SetGameState {
                score,
                lives,
                message,
            } => {
                game_state.score = *score;
                game_state.lives = *lives;
                message.clone_into(&mut game_state.message);
            }
        }
    }
}

fn sprite_spec(kind: &str) -> (&'static str, Vec2, f32) {
    match kind {
        "player" => ("sprites/player.png", Vec2::new(72.0, 88.0), 3.0),
        "enemy" => ("sprites/enemy.png", Vec2::new(66.0, 70.0), 2.0),
        "bullet" => ("sprites/bullet.png", Vec2::new(14.0, 34.0), 1.0),
        _ => ("sprites/bullet.png", Vec2::splat(24.0), 1.0),
    }
}

pub(super) fn sync_sprite_components(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    sprites: Query<(Entity, &SpriteKind), Changed<SpriteKind>>,
) {
    for (entity, kind) in &sprites {
        let (path, size, _) = sprite_spec(&kind.0);
        commands.entity(entity).insert(Sprite {
            image: asset_server.load(path),
            custom_size: Some(size),
            ..default()
        });
    }
}

pub(super) fn sync_transform_components(
    mut transforms: Query<
        (&ScriptTransform, &SpriteKind, &mut Transform),
        Changed<ScriptTransform>,
    >,
) {
    for (script_transform, kind, mut transform) in &mut transforms {
        let (_, _, z) = sprite_spec(&kind.0);
        transform.translation = Vec3::new(script_transform.x, script_transform.y, z);
    }
}

pub(super) fn sync_game_state(
    game_state: Res<GameState>,
    mut text: Query<&mut Text2d, With<GameStateText>>,
) {
    if !game_state.is_changed() {
        return;
    }
    if let Ok(mut text) = text.single_mut() {
        text.0 = if game_state.message.is_empty() {
            format!(
                "SCORE {:05}    LIVES {}",
                game_state.score, game_state.lives
            )
        } else {
            format!(
                "SCORE {:05}    LIVES {}\n{}",
                game_state.score, game_state.lives, game_state.message
            )
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ecs_api::command::{queue_command, reset_command_queue};

    #[test]
    fn ecs_writes_compose_components_and_resources() {
        reset_command_queue();
        let mut app = App::new();
        app.init_resource::<ScriptEntityRegistry>()
            .init_resource::<GameState>()
            .add_message::<EcsCommand>()
            .add_systems(
                Update,
                (
                    super::super::command::dispatch_commands,
                    apply_ecs_writes,
                    ApplyDeferred,
                )
                    .chain(),
            );

        queue_command(EcsCommand::SpawnEntity {
            id: "player".to_owned(),
        });
        queue_command(EcsCommand::InsertSprite {
            id: "player".to_owned(),
            kind: "player".to_owned(),
        });
        queue_command(EcsCommand::SetTransform {
            id: "player".to_owned(),
            x: 12.0,
            y: -34.0,
        });
        queue_command(EcsCommand::SetGameState {
            score: 200,
            lives: 2,
            message: "READY".to_owned(),
        });
        app.update();

        let world = app.world_mut();
        let mut query = world.query::<(&ScriptEntityId, &SpriteKind, &ScriptTransform)>();
        let components = query.single(world).expect("one composed script entity");
        assert_eq!(components.0._key, "player");
        assert_eq!(components.1.0, "player");
        assert_eq!((components.2.x, components.2.y), (12.0, -34.0));
        let state = world.resource::<GameState>();
        assert_eq!((state.score, state.lives), (200, 2));
        assert_eq!(state.message, "READY");

        queue_command(EcsCommand::ClearWorld);
        app.update();
        let world = app.world_mut();
        let mut query = world.query_filtered::<Entity, With<ScriptOwned>>();
        assert_eq!(query.iter(world).count(), 0);
    }
}
