use std::path::{Component, Path};

use bevy::{prelude::*, sprite::Anchor};

use crate::ecs_api::{ApplyEcsCommands, ScriptComponents};

#[derive(Component, Clone, PartialEq)]
struct MaterializedSprite(SpriteSpec);

#[derive(Component, Clone, Copy, PartialEq)]
struct MaterializedTransform(TransformSpec);

#[derive(Component, Clone, PartialEq)]
struct MaterializedText(TextSpec);

#[derive(Clone, Debug, PartialEq)]
struct SpriteSpec {
    path: String,
    size: Option<Vec2>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TransformSpec {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Clone, Debug, PartialEq)]
struct TextSpec {
    value: String,
    font_size: f32,
    color: [f32; 4],
    anchor: Anchor,
}

type ScriptVisualQuery<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static ScriptComponents,
        Option<&'static MaterializedSprite>,
        Option<&'static MaterializedTransform>,
        Option<&'static MaterializedText>,
    ),
    Changed<ScriptComponents>,
>;

pub(crate) struct ScriptSquadronHostPlugin;

impl Plugin for ScriptSquadronHostPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(
            Update,
            materialize_script_components.after(ApplyEcsCommands),
        );
    }
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

fn valid_asset_path(path: &str) -> bool {
    let path = Path::new(path);
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn sprite_spec(components: &ScriptComponents) -> Option<SpriteSpec> {
    let path = component_string(components, "sprite", "path")?;
    if !valid_asset_path(path) {
        return None;
    }
    let size = match (
        component_number(components, "sprite", "width"),
        component_number(components, "sprite", "height"),
    ) {
        (Some(width), Some(height)) if width > 0.0 && height > 0.0 => {
            Some(Vec2::new(width, height))
        }
        _ => None,
    };
    Some(SpriteSpec {
        path: path.to_owned(),
        size,
    })
}

fn transform_spec(components: &ScriptComponents) -> Option<TransformSpec> {
    Some(TransformSpec {
        x: component_number(components, "transform", "x")?,
        y: component_number(components, "transform", "y")?,
        z: component_number(components, "transform", "z").unwrap_or_default(),
    })
}

fn text_anchor(value: Option<&str>) -> Anchor {
    match value {
        Some("bottom_left") => Anchor::BOTTOM_LEFT,
        Some("bottom_center") => Anchor::BOTTOM_CENTER,
        Some("bottom_right") => Anchor::BOTTOM_RIGHT,
        Some("center_left") => Anchor::CENTER_LEFT,
        Some("center_right") => Anchor::CENTER_RIGHT,
        Some("top_left") => Anchor::TOP_LEFT,
        Some("top_center") => Anchor::TOP_CENTER,
        Some("top_right") => Anchor::TOP_RIGHT,
        _ => Anchor::CENTER,
    }
}

fn color_channel(components: &ScriptComponents, field: &str, default: f32) -> f32 {
    component_number(components, "text", field)
        .unwrap_or(default)
        .clamp(0.0, 1.0)
}

fn text_spec(components: &ScriptComponents) -> Option<TextSpec> {
    Some(TextSpec {
        value: component_string(components, "text", "value")?.to_owned(),
        font_size: component_number(components, "text", "fontSize")
            .filter(|value| *value > 0.0)
            .unwrap_or(25.0),
        color: [
            color_channel(components, "red", 1.0),
            color_channel(components, "green", 1.0),
            color_channel(components, "blue", 1.0),
            color_channel(components, "alpha", 1.0),
        ],
        anchor: text_anchor(component_string(components, "text", "anchor")),
    })
}

fn materialize_script_components(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    entities: ScriptVisualQuery,
) {
    for (entity, components, current_sprite, current_transform, current_text) in &entities {
        match sprite_spec(components) {
            Some(next) if current_sprite.is_none_or(|current| current.0 != next) => {
                commands.entity(entity).insert((
                    MaterializedSprite(next.clone()),
                    Sprite {
                        image: asset_server.load(next.path),
                        custom_size: next.size,
                        ..default()
                    },
                ));
            }
            None if current_sprite.is_some() => {
                commands
                    .entity(entity)
                    .remove::<(MaterializedSprite, Sprite)>();
            }
            _ => {}
        }

        if let Some(next) = transform_spec(components)
            && current_transform.is_none_or(|current| current.0 != next)
        {
            commands.entity(entity).insert((
                MaterializedTransform(next),
                Transform::from_xyz(next.x, next.y, next.z),
            ));
        }

        match text_spec(components) {
            Some(next) if current_text.is_none_or(|current| current.0 != next) => {
                let [red, green, blue, alpha] = next.color;
                commands.entity(entity).insert((
                    MaterializedText(next.clone()),
                    Text2d::new(next.value),
                    TextFont {
                        font_size: FontSize::Px(next.font_size),
                        ..default()
                    },
                    TextColor(Color::srgba(red, green, blue, alpha)),
                    next.anchor,
                ));
            }
            None if current_text.is_some() => {
                commands
                    .entity(entity)
                    .remove::<(MaterializedText, Text2d, TextFont, TextColor, Anchor)>();
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ecs_api::EcsValue;

    fn object(fields: impl IntoIterator<Item = (&'static str, EcsValue)>) -> EcsValue {
        EcsValue::Object(
            fields
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value))
                .collect::<BTreeMap<_, _>>(),
        )
    }

    fn components(fields: impl IntoIterator<Item = (&'static str, EcsValue)>) -> ScriptComponents {
        ScriptComponents(
            fields
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value))
                .collect(),
        )
    }

    #[test]
    fn asset_paths_stay_inside_the_game_package() {
        assert!(valid_asset_path("sprites/player.png"));
        assert!(!valid_asset_path(""));
        assert!(!valid_asset_path("../player.png"));
        assert!(!valid_asset_path("sprites/../player.png"));
        assert!(!valid_asset_path("/tmp/player.png"));
    }

    #[test]
    fn render_specs_are_fully_defined_by_script_components() {
        let components = components([
            (
                "sprite",
                object([
                    ("path", EcsValue::String("sprites/player.png".to_owned())),
                    ("width", EcsValue::Number(72.0)),
                    ("height", EcsValue::Number(88.0)),
                ]),
            ),
            (
                "transform",
                object([
                    ("x", EcsValue::Number(12.0)),
                    ("y", EcsValue::Number(-34.0)),
                    ("z", EcsValue::Number(3.0)),
                ]),
            ),
            (
                "text",
                object([
                    ("value", EcsValue::String("READY".to_owned())),
                    ("fontSize", EcsValue::Number(30.0)),
                    ("red", EcsValue::Number(0.2)),
                    ("green", EcsValue::Number(0.4)),
                    ("blue", EcsValue::Number(0.6)),
                    ("alpha", EcsValue::Number(0.8)),
                    ("anchor", EcsValue::String("top_center".to_owned())),
                ]),
            ),
        ]);

        assert_eq!(
            sprite_spec(&components),
            Some(SpriteSpec {
                path: "sprites/player.png".to_owned(),
                size: Some(Vec2::new(72.0, 88.0)),
            })
        );
        assert_eq!(
            transform_spec(&components),
            Some(TransformSpec {
                x: 12.0,
                y: -34.0,
                z: 3.0,
            })
        );
        assert_eq!(
            text_spec(&components),
            Some(TextSpec {
                value: "READY".to_owned(),
                font_size: 30.0,
                color: [0.2, 0.4, 0.6, 0.8],
                anchor: Anchor::TOP_CENTER,
            })
        );
    }
}
