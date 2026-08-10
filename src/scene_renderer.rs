use bevy::{prelude::*, sprite::Anchor};

use crate::script_api::{ScriptApiUpdated, ScriptSprite, ScriptText, ScriptTransform};

#[derive(Component, Clone, PartialEq)]
struct MaterializedSprite(ScriptSprite);

#[derive(Component, Clone, Copy, PartialEq)]
struct MaterializedTransform(ScriptTransform);

#[derive(Component, Clone, PartialEq)]
struct MaterializedText(ScriptText);

type ScriptVisualQuery<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        Option<&'static ScriptSprite>,
        Option<&'static ScriptTransform>,
        Option<&'static ScriptText>,
        Option<&'static MaterializedSprite>,
        Option<&'static MaterializedTransform>,
        Option<&'static MaterializedText>,
    ),
    Or<(
        Changed<ScriptSprite>,
        Changed<ScriptTransform>,
        Changed<ScriptText>,
    )>,
>;

pub(crate) struct RuneweaveSceneRendererPlugin;

impl Plugin for RuneweaveSceneRendererPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(
            Update,
            materialize_script_components.after(ScriptApiUpdated),
        );
    }
}

fn text_anchor(value: &str) -> Anchor {
    match value {
        "bottom_left" => Anchor::BOTTOM_LEFT,
        "bottom_center" => Anchor::BOTTOM_CENTER,
        "bottom_right" => Anchor::BOTTOM_RIGHT,
        "center_left" => Anchor::CENTER_LEFT,
        "center_right" => Anchor::CENTER_RIGHT,
        "top_left" => Anchor::TOP_LEFT,
        "top_center" => Anchor::TOP_CENTER,
        "top_right" => Anchor::TOP_RIGHT,
        _ => Anchor::CENTER,
    }
}

fn materialize_script_components(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    entities: ScriptVisualQuery,
) {
    for (entity, sprite, transform, text, current_sprite, current_transform, current_text) in
        &entities
    {
        match sprite {
            Some(next) if current_sprite.is_none_or(|current| current.0 != *next) => {
                commands.entity(entity).insert((
                    MaterializedSprite(next.clone()),
                    Sprite {
                        image: asset_server.load(next.path.clone()),
                        custom_size: Some(Vec2::new(next.width, next.height)),
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

        match transform {
            Some(next) if current_transform.is_none_or(|current| current.0 != *next) => {
                commands.entity(entity).insert((
                    MaterializedTransform(*next),
                    Transform::from_xyz(next.x, next.y, next.z),
                ));
            }
            None if current_transform.is_some() => {
                commands
                    .entity(entity)
                    .remove::<(MaterializedTransform, Transform)>();
            }
            _ => {}
        }

        match text {
            Some(next) if current_text.is_none_or(|current| current.0 != *next) => {
                commands.entity(entity).insert((
                    MaterializedText(next.clone()),
                    Text2d::new(next.value.clone()),
                    TextFont {
                        font_size: FontSize::Px(next.font_size),
                        ..default()
                    },
                    TextColor(Color::srgba(next.red, next.green, next.blue, next.alpha)),
                    text_anchor(&next.anchor),
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
    use super::*;

    #[test]
    fn reflected_render_components_fully_define_scene_output() {
        let sprite = ScriptSprite {
            path: "sprites/player.png".to_owned(),
            width: 72.0,
            height: 88.0,
        };
        let transform = ScriptTransform {
            x: 12.0,
            y: -34.0,
            z: 3.0,
        };
        let text = ScriptText {
            value: "READY".to_owned(),
            font_size: 30.0,
            red: 0.2,
            green: 0.4,
            blue: 0.6,
            alpha: 0.8,
            anchor: "top_center".to_owned(),
        };

        assert_eq!(
            Vec2::new(sprite.width, sprite.height),
            Vec2::new(72.0, 88.0)
        );
        assert_eq!(
            Transform::from_xyz(transform.x, transform.y, transform.z).translation,
            Vec3::new(12.0, -34.0, 3.0)
        );
        assert_eq!(text_anchor(&text.anchor), Anchor::TOP_CENTER);
    }
}
