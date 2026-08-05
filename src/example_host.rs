use bevy::{prelude::*, sprite::Anchor};

use crate::ecs_api::{ApplyEcsCommands, EcsValue, ScriptComponents, ScriptResources};

const WINDOW_WIDTH: f32 = 600.0;
const WINDOW_HEIGHT: f32 = 800.0;

#[derive(Component, Clone, PartialEq)]
struct MaterializedSprite(String);

#[derive(Component, Clone, Copy, PartialEq)]
struct MaterializedTransform {
    x: f32,
    y: f32,
}

#[derive(Component)]
struct GameStateText;

type ScriptVisualQuery<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static ScriptComponents,
        Option<&'static MaterializedSprite>,
        Option<&'static MaterializedTransform>,
    ),
    Changed<ScriptComponents>,
>;

pub(crate) struct ScriptSquadronHostPlugin;

impl Plugin for ScriptSquadronHostPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_scene).add_systems(
            Update,
            (materialize_script_components, sync_game_state).after(ApplyEcsCommands),
        );
    }
}

fn setup_scene(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn(Camera2d);
    commands.spawn((
        Sprite {
            image: asset_server.load("sprites/background.png"),
            custom_size: Some(Vec2::new(WINDOW_WIDTH, WINDOW_HEIGHT)),
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
        Transform::from_xyz(0.0, WINDOW_HEIGHT / 2.0 - 18.0, 20.0),
        GameStateText,
    ));
}

fn component_number(components: &ScriptComponents, component: &str, field: &str) -> Option<f32> {
    components
        .get(component)?
        .field(field)?
        .as_number()
        .map(|value| value as f32)
}

fn component_string<'a>(
    components: &'a ScriptComponents,
    component: &str,
    field: &str,
) -> Option<&'a str> {
    components.get(component)?.field(field)?.as_str()
}

fn sprite_spec(kind: &str) -> (&'static str, Vec2, f32) {
    match kind {
        "player" => ("sprites/player.png", Vec2::new(72.0, 88.0), 3.0),
        "enemy" => ("sprites/enemy.png", Vec2::new(66.0, 70.0), 2.0),
        "bullet" => ("sprites/bullet.png", Vec2::new(14.0, 34.0), 1.0),
        _ => ("sprites/bullet.png", Vec2::splat(24.0), 1.0),
    }
}

fn materialize_script_components(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    entities: ScriptVisualQuery,
) {
    for (entity, components, current_sprite, current_transform) in &entities {
        if let Some(kind) = component_string(components, "sprite", "kind")
            && current_sprite.is_none_or(|current| current.0 != kind)
        {
            let (path, size, _) = sprite_spec(kind);
            commands.entity(entity).insert((
                MaterializedSprite(kind.to_owned()),
                Sprite {
                    image: asset_server.load(path),
                    custom_size: Some(size),
                    ..default()
                },
            ));
        }

        if let (Some(x), Some(y)) = (
            component_number(components, "transform", "x"),
            component_number(components, "transform", "y"),
        ) {
            let next = MaterializedTransform { x, y };
            if current_transform.is_none_or(|current| *current != next) {
                let kind = component_string(components, "sprite", "kind").unwrap_or("bullet");
                let (_, _, z) = sprite_spec(kind);
                commands
                    .entity(entity)
                    .insert((next, Transform::from_xyz(x, y, z)));
            }
        }
    }
}

fn resource_number(resource: &EcsValue, field: &str) -> Option<f64> {
    resource.field(field)?.as_number()
}

fn sync_game_state(
    resources: Res<ScriptResources>,
    mut text: Query<&mut Text2d, With<GameStateText>>,
) {
    if !resources.is_changed() {
        return;
    }
    let Some(state) = resources.get("game_state") else {
        return;
    };
    let score = resource_number(state, "score").unwrap_or_default();
    let lives = resource_number(state, "lives").unwrap_or_default() as i32;
    let message = state
        .field("message")
        .and_then(EcsValue::as_str)
        .unwrap_or_default();
    if let Ok(mut text) = text.single_mut() {
        text.0 = if message.is_empty() {
            format!("SCORE {score:05.0}    LIVES {lives}")
        } else {
            format!("SCORE {score:05.0}    LIVES {lives}\n{message}")
        };
    }
}
