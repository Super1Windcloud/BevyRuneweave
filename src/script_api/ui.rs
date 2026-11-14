//! Script-facing retained UI primitives backed by real Bevy UI components.

use std::path::Path;

use bevy::{ecs::query::QueryState, prelude::*};
use bevy_mod_scripting::{
    bindings::{FunctionCallContext, InteropError, WorldExtensions},
    script::ScriptAttachment,
};
use serde::Deserialize;

use super::{
    ScriptEntityId, ScriptOwnedBy, current_script, find_owned_entity, set_component_if_neq,
    valid_asset_path, valid_entity_id,
};

#[derive(Component, Reflect, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[reflect(Component)]
pub(super) struct ScriptUiNode;

#[derive(Deserialize)]
#[serde(untagged)]
enum UiLength {
    Pixels(f32),
    Css(String),
}

impl UiLength {
    fn value(&self) -> Option<Val> {
        match self {
            Self::Pixels(value) if value.is_finite() => Some(Val::Px(*value)),
            Self::Pixels(_) => None,
            Self::Css(value) if value == "auto" => Some(Val::Auto),
            Self::Css(value) => {
                let (number, percent) = value
                    .strip_suffix('%')
                    .map(|number| (number, true))
                    .or_else(|| value.strip_suffix("px").map(|number| (number, false)))?;
                let number = number.trim().parse::<f32>().ok()?;
                if !number.is_finite() {
                    return None;
                }
                Some(if percent {
                    Val::Percent(number)
                } else {
                    Val::Px(number)
                })
            }
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UiStyleSpec {
    width: Option<UiLength>,
    height: Option<UiLength>,
    min_width: Option<UiLength>,
    min_height: Option<UiLength>,
    max_width: Option<UiLength>,
    max_height: Option<UiLength>,
    left: Option<UiLength>,
    right: Option<UiLength>,
    top: Option<UiLength>,
    bottom: Option<UiLength>,
    flex_direction: Option<String>,
    align_items: Option<String>,
    justify_content: Option<String>,
    position: Option<String>,
    display: Option<String>,
    gap: Option<UiLength>,
    row_gap: Option<UiLength>,
    column_gap: Option<UiLength>,
    padding: Option<UiLength>,
    margin: Option<UiLength>,
    border_radius: Option<UiLength>,
    flex_grow: Option<f32>,
    flex_shrink: Option<f32>,
    background: Option<[f32; 4]>,
    image_mode: Option<String>,
    image_tint: Option<[f32; 4]>,
}

#[derive(Resource)]
struct UiEntityQuery(
    QueryState<(Entity, &'static ScriptOwnedBy, &'static ScriptEntityId), With<ScriptUiNode>>,
);

fn find_ui_entity(world: &mut World, owner: &ScriptAttachment, id: &str) -> Option<Entity> {
    if !world.contains_resource::<UiEntityQuery>() {
        let query =
            world.query_filtered::<(Entity, &ScriptOwnedBy, &ScriptEntityId), With<ScriptUiNode>>();
        world.insert_resource(UiEntityQuery(query));
    }
    world.resource_scope(|world, mut query: Mut<UiEntityQuery>| {
        query
            .0
            .iter(world)
            .find(|(_, candidate_owner, candidate_id)| {
                candidate_owner.0 == *owner && candidate_id.0 == id
            })
            .map(|(entity, _, _)| entity)
    })
}

pub(super) fn ui_spawn(
    context: FunctionCallContext,
    id: String,
    parent_id: String,
    kind: String,
) -> Result<bool, InteropError> {
    if !valid_entity_id(&id) || (!parent_id.is_empty() && !valid_entity_id(&parent_id)) {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        if let Some(entity) = find_ui_entity(world, &owner, &id) {
            return if parent_id.is_empty() {
                true
            } else if let Some(parent) = find_ui_entity(world, &owner, &parent_id) {
                world.entity_mut(parent).add_child(entity);
                true
            } else {
                false
            };
        }
        if find_owned_entity(world, &owner, &id).is_some() {
            return false;
        }
        let parent = if parent_id.is_empty() {
            None
        } else {
            let Some(parent) = find_ui_entity(world, &owner, &parent_id) else {
                return false;
            };
            Some(parent)
        };
        let owned = (ScriptOwnedBy(owner), ScriptEntityId(id), ScriptUiNode);
        let entity = match kind.as_str() {
            "node" => world.spawn((owned, Node::default())).id(),
            "text" => world.spawn((owned, Text::default(), Node::default())).id(),
            "image" => world
                .spawn((owned, ImageNode::default(), Node::default()))
                .id(),
            "button" => world.spawn((owned, Button, Node::default())).id(),
            _ => return false,
        };
        if let Some(parent) = parent {
            world.entity_mut(parent).add_child(entity);
        }
        true
    })
}

fn parse_style(style: &str) -> Option<UiStyleSpec> {
    serde_json::from_str(style).ok()
}

fn set_length(target: &mut Val, value: Option<&UiLength>) -> Option<()> {
    if let Some(value) = value {
        *target = value.value()?;
    }
    Some(())
}

fn optional_length(value: Option<&UiLength>) -> Option<Option<Val>> {
    match value {
        Some(value) => Some(Some(value.value()?)),
        None => Some(None),
    }
}

fn apply_style(node: &mut Node, style: &UiStyleSpec) -> Option<()> {
    set_length(&mut node.width, style.width.as_ref())?;
    set_length(&mut node.height, style.height.as_ref())?;
    set_length(&mut node.min_width, style.min_width.as_ref())?;
    set_length(&mut node.min_height, style.min_height.as_ref())?;
    set_length(&mut node.max_width, style.max_width.as_ref())?;
    set_length(&mut node.max_height, style.max_height.as_ref())?;
    set_length(&mut node.left, style.left.as_ref())?;
    set_length(&mut node.right, style.right.as_ref())?;
    set_length(&mut node.top, style.top.as_ref())?;
    set_length(&mut node.bottom, style.bottom.as_ref())?;

    if let Some(value) = optional_length(style.padding.as_ref())? {
        node.padding = UiRect::all(value);
    }
    if let Some(value) = optional_length(style.margin.as_ref())? {
        node.margin = UiRect::all(value);
    }
    if let Some(value) = optional_length(style.border_radius.as_ref())? {
        node.border_radius = BorderRadius::all(value);
    }
    if let Some(value) = optional_length(style.gap.as_ref())? {
        node.row_gap = value;
        node.column_gap = value;
    }
    set_length(&mut node.row_gap, style.row_gap.as_ref())?;
    set_length(&mut node.column_gap, style.column_gap.as_ref())?;

    if let Some(value) = style.flex_direction.as_deref() {
        node.flex_direction = match value {
            "row" => FlexDirection::Row,
            "row-reverse" => FlexDirection::RowReverse,
            "column" => FlexDirection::Column,
            "column-reverse" => FlexDirection::ColumnReverse,
            _ => return None,
        };
    }
    if let Some(value) = style.align_items.as_deref() {
        node.align_items = match value {
            "start" => AlignItems::FlexStart,
            "end" => AlignItems::FlexEnd,
            "center" => AlignItems::Center,
            "stretch" => AlignItems::Stretch,
            "baseline" => AlignItems::Baseline,
            _ => return None,
        };
    }
    if let Some(value) = style.justify_content.as_deref() {
        node.justify_content = match value {
            "start" => JustifyContent::FlexStart,
            "end" => JustifyContent::FlexEnd,
            "center" => JustifyContent::Center,
            "space-between" => JustifyContent::SpaceBetween,
            "space-around" => JustifyContent::SpaceAround,
            "space-evenly" => JustifyContent::SpaceEvenly,
            _ => return None,
        };
    }
    if let Some(value) = style.position.as_deref() {
        node.position_type = match value {
            "relative" => PositionType::Relative,
            "absolute" => PositionType::Absolute,
            _ => return None,
        };
    }
    if let Some(value) = style.display.as_deref() {
        node.display = match value {
            "flex" => Display::Flex,
            "none" => Display::None,
            _ => return None,
        };
    }
    if let Some(value) = style.flex_grow {
        if !value.is_finite() || value < 0.0 {
            return None;
        }
        node.flex_grow = value;
    }
    if let Some(value) = style.flex_shrink {
        if !value.is_finite() || value < 0.0 {
            return None;
        }
        node.flex_shrink = value;
    }
    Some(())
}

pub(super) fn ui_set_style(
    context: FunctionCallContext,
    id: String,
    style: String,
) -> Result<bool, InteropError> {
    let Some(style) = parse_style(&style) else {
        return Ok(false);
    };
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        let Some(node) = world.get::<Node>(entity) else {
            return false;
        };
        let mut updated_node = node.clone();
        if apply_style(&mut updated_node, &style).is_none() {
            return false;
        }
        let image_mode = match style.image_mode.as_deref() {
            None => None,
            Some("auto") => Some(bevy::ui::widget::NodeImageMode::Auto),
            Some("stretch") => Some(bevy::ui::widget::NodeImageMode::Stretch),
            Some(_) => return false,
        };
        if (image_mode.is_some() || style.image_tint.is_some())
            && world.get::<ImageNode>(entity).is_none()
        {
            return false;
        }
        if style
            .image_tint
            .is_some_and(|color| color.iter().any(|value| !value.is_finite()))
        {
            return false;
        }
        if let Some([red, green, blue, alpha]) = style.background {
            if [red, green, blue, alpha]
                .iter()
                .any(|value| !value.is_finite())
            {
                return false;
            }
            set_component_if_neq(
                world,
                entity,
                BackgroundColor(Color::srgba(
                    red.clamp(0.0, 1.0),
                    green.clamp(0.0, 1.0),
                    blue.clamp(0.0, 1.0),
                    alpha.clamp(0.0, 1.0),
                )),
            );
        }
        set_component_if_neq(world, entity, updated_node);
        if let Some(mode) = image_mode {
            world.get_mut::<ImageNode>(entity).unwrap().image_mode = mode;
        }
        if let Some([r, g, b, a]) = style.image_tint {
            world.get_mut::<ImageNode>(entity).unwrap().color = Color::srgba(
                r.clamp(0.0, 1.0),
                g.clamp(0.0, 1.0),
                b.clamp(0.0, 1.0),
                a.clamp(0.0, 1.0),
            );
        }
        true
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn ui_set_text(
    context: FunctionCallContext,
    id: String,
    value: String,
    font_size: f32,
    red: f32,
    green: f32,
    blue: f32,
    alpha: f32,
) -> Result<bool, InteropError> {
    if [font_size, red, green, blue, alpha]
        .iter()
        .any(|value| !value.is_finite())
    {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        let Some(mut text) = world.get_mut::<Text>(entity) else {
            return false;
        };
        text.set_if_neq(Text(value));
        let font = world
            .get::<TextFont>(entity)
            .cloned()
            .unwrap_or_default()
            .with_font_size(font_size.max(1.0));
        set_component_if_neq(world, entity, font);
        set_component_if_neq(
            world,
            entity,
            TextColor(Color::srgba(
                red.clamp(0.0, 1.0),
                green.clamp(0.0, 1.0),
                blue.clamp(0.0, 1.0),
                alpha.clamp(0.0, 1.0),
            )),
        );
        true
    })
}

pub(super) fn ui_set_image(
    context: FunctionCallContext,
    id: String,
    path: String,
) -> Result<bool, InteropError> {
    if !valid_asset_path(&path) || Path::new(&path).extension().is_none() {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    let asset_server = world
        .with_world(|world| world.get_resource::<AssetServer>().cloned())?
        .ok_or_else(|| InteropError::invariant("UI image API requires Bevy AssetPlugin"))?;
    let image = asset_server
        .load_builder()
        .with_settings(|settings: &mut bevy::image::ImageLoaderSettings| {
            settings.sampler = bevy::image::ImageSampler::nearest();
        })
        .load(path);
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        let Some(mut image_node) = world.get_mut::<ImageNode>(entity) else {
            return false;
        };
        if image_node.image != image {
            image_node.image = image;
        }
        true
    })
}

/// Selects a project-owned font through the same registry for every language.
pub(super) fn ui_set_font(
    context: FunctionCallContext,
    id: String,
    path: String,
) -> Result<bool, InteropError> {
    if !valid_asset_path(&path)
        || !matches!(
            Path::new(&path)
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("ttf" | "otf")
        )
    {
        return Ok(false);
    }
    let (world, owner) = current_script(&context)?;
    let server = world.with_world(|world| world.get_resource::<AssetServer>().cloned())?;
    let Some(server) = server else {
        return Ok(false);
    };
    let font = server.load(path);
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        let Some(mut text_font) = world.get_mut::<TextFont>(entity) else {
            return false;
        };
        text_font.font = bevy::text::FontSource::Handle(font);
        text_font.font_smoothing = bevy::text::FontSmoothing::None;
        true
    })
}

pub(super) fn ui_button_hovered(
    context: FunctionCallContext,
    id: String,
) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        world.get::<Button>(entity).is_some()
            && world.get::<Interaction>(entity).is_some_and(|interaction| {
                matches!(interaction, Interaction::Hovered | Interaction::Pressed)
            })
    })
}

pub(super) fn ui_button_just_pressed(
    context: FunctionCallContext,
    id: String,
) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        world
            .entity(entity)
            .get_ref::<Interaction>()
            .is_some_and(|interaction| {
                interaction.is_changed() && *interaction == Interaction::Pressed
            })
    })
}

pub(super) fn ui_despawn(context: FunctionCallContext, id: String) -> Result<bool, InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let Some(entity) = find_ui_entity(world, &owner, &id) else {
            return false;
        };
        world.despawn(entity);
        true
    })
}

pub(super) fn ui_clear(context: FunctionCallContext) -> Result<(), InteropError> {
    let (world, owner) = current_script(&context)?;
    world.with_world_mut(|world| {
        let mut query = world.query::<(Entity, &ScriptOwnedBy, &ScriptUiNode)>();
        let entities = query
            .iter(world)
            .filter(|(_, candidate, _)| candidate.0 == owner)
            .map(|(entity, _, _)| entity)
            .collect::<Vec<_>>();
        for entity in entities {
            let _ = world.try_despawn(entity);
        }
    })
}

#[cfg(test)]
mod tests {
    use bevy_mod_scripting::{
        asset::{Language, ScriptAsset},
        bindings::{
            AppScriptFunctionRegistry, CurrentScriptAttachment, FunctionCallContext,
            WorldExtensions, WorldGuard,
        },
    };

    use super::*;

    #[test]
    fn cached_ui_query_filters_scene_ids_and_tracks_new_archetypes() {
        let mut world = World::new();
        let owner = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let other = ScriptAttachment::EntityScript(world.spawn_empty().id(), Handle::default());
        world.spawn((ScriptOwnedBy(owner.clone()), ScriptEntityId("hud".into())));
        world.spawn((
            ScriptOwnedBy(other),
            ScriptEntityId("hud".into()),
            ScriptUiNode,
        ));
        assert_eq!(find_ui_entity(&mut world, &owner, "hud"), None);
        let hud = world
            .spawn((
                ScriptOwnedBy(owner.clone()),
                ScriptEntityId("hud".into()),
                ScriptUiNode,
            ))
            .id();
        assert_eq!(find_ui_entity(&mut world, &owner, "hud"), Some(hud));
        world.entity_mut(hud).insert(Node::default());
        assert_eq!(find_ui_entity(&mut world, &owner, "hud"), Some(hud));
        world.despawn(hud);
        assert_eq!(find_ui_entity(&mut world, &owner, "hud"), None);
        let respawned = world
            .spawn((
                ScriptOwnedBy(owner.clone()),
                ScriptEntityId("hud".into()),
                ScriptUiNode,
            ))
            .id();
        assert_eq!(find_ui_entity(&mut world, &owner, "hud"), Some(respawned));
    }

    #[cfg(all(feature = "lua", any(feature = "js", feature = "typescript")))]
    #[test]
    fn project_font_api_has_equivalent_lua_and_quickjs_behavior() -> Result<(), InteropError> {
        use bevy::asset::AssetApp;
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
        ))
        .init_asset::<Font>();
        app.finish();
        let camera = app
            .world_mut()
            .spawn((
                Camera2d,
                Projection::Orthographic(OrthographicProjection::default_2d()),
                Transform::default(),
            ))
            .id();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let world_id = app.world().id();
        let cache = WorldGuard::setup_cache(
            app.world(),
            CurrentScriptAttachment(Some(attachment.clone())),
        );
        WorldGuard::with_static_guard(app.world_mut(), cache, |guard| {
            let mut js = quickjs_context_load(&attachment, br#"
                function on_script_loaded() {
                    if (!ui_spawn("font_label", "", "text")) throw Error("spawn");
                    if (!ui_spawn("hover_test", "", "button") || ui_button_hovered("hover_test") || ui_button_hovered("missing")) throw Error("hover");
                    if (!ui_set_text("font_label", "Pixel", 24, 1, 1, 1, 1)) throw Error("text");
                    if (!ui_set_font("font_label", "fonts/spd-pixel.ttf")) throw Error("font");
                    if (!scene_set_camera_2d(12, 24, 240) || scene_set_camera_2d(99, 99, 0)) throw Error("camera");
                    if (!ui_spawn("pixel_image", "", "image") || !ui_set_style("pixel_image", '{"width":120,"height":18,"imageMode":"stretch","imageTint":[0.6,0.6,0.6,1]}')) throw Error("image mode");
                    if (ui_set_style("pixel_image", '{"width":999,"imageMode":"invalid"}')) throw Error("invalid image mode");
                    if (ui_set_font("font_label", "../secret.ttf") || ui_set_font("missing", "fonts/spd-pixel.ttf") || ui_set_font("font_label", "sprites/a.png")) throw Error("invalid font accepted");
                    if (!ui_set_text("font_label", "Changed", 18, 1, 1, 1, 1)) throw Error("update");
                }
            "#, world_id)?;
            quickjs_handler(
                Vec::new(),
                &attachment,
                &CallbackLabel::from("on_script_loaded"),
                &mut js,
                world_id,
            )?;
            let assert_font = || {
                guard.with_world_mut(|world| {
                    let entity = find_ui_entity(world, &attachment, "font_label").unwrap();
                    let font = world.get::<TextFont>(entity).unwrap();
                    assert_eq!(font.font_smoothing, bevy::text::FontSmoothing::None);
                    assert!(matches!(font.font, bevy::text::FontSource::Handle(_)));
                    assert_eq!(world.get::<Text>(entity).unwrap().0, "Changed");
                    let image = find_ui_entity(world, &attachment, "pixel_image").unwrap();
                    assert_eq!(
                        world.get::<ImageNode>(image).unwrap().image_mode,
                        bevy::ui::widget::NodeImageMode::Stretch
                    );
                    assert_eq!(world.get::<Node>(image).unwrap().width, Val::Px(120.0));
                    assert_eq!(
                        world.get::<ImageNode>(image).unwrap().color,
                        Color::srgba(0.6, 0.6, 0.6, 1.0)
                    );
                    assert_eq!(world.get::<Transform>(camera).unwrap().translation.x, 12.0);
                    assert_eq!(world.get::<Transform>(camera).unwrap().translation.y, 24.0);
                    let Projection::Orthographic(projection) =
                        world.get::<Projection>(camera).unwrap()
                    else {
                        panic!("orthographic camera");
                    };
                    assert!(matches!(
                        projection.scaling_mode,
                        bevy::camera::ScalingMode::FixedVertical {
                            viewport_height: 240.0
                        }
                    ));
                })
            };
            assert_font()?;
            let mut lua = lua_context_load(
                &attachment,
                br#"
                function on_script_loaded()
                    assert(ui_spawn("font_label", "", "text"))
                    assert(ui_spawn("hover_test", "", "button"))
                    assert(not ui_button_hovered("hover_test") and not ui_button_hovered("missing"))
                    assert(ui_set_text("font_label", "Pixel", 24, 1, 1, 1, 1))
                    assert(ui_set_font("font_label", "fonts/spd-pixel.ttf"))
                    assert(scene_set_camera_2d(12, 24, 240))
                    assert(not scene_set_camera_2d(99, 99, 0))
                    assert(ui_spawn("pixel_image", "", "image"))
                    assert(ui_set_style("pixel_image", '{"width":120,"height":18,"imageMode":"stretch","imageTint":[0.6,0.6,0.6,1]}'))
                    assert(not ui_set_style("pixel_image", '{"width":999,"imageMode":"invalid"}'))
                    assert(not ui_set_font("font_label", "../secret.ttf"))
                    assert(not ui_set_font("missing", "fonts/spd-pixel.ttf"))
                    assert(not ui_set_font("font_label", "sprites/a.png"))
                    assert(ui_set_text("font_label", "Changed", 18, 1, 1, 1, 1))
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
            assert_font()
        })
    }

    #[test]
    fn ui_api_builds_flex_tree_and_reports_button_press() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache =
            WorldGuard::setup_cache(&world, CurrentScriptAttachment(Some(attachment.clone())));

        WorldGuard::with_static_guard(&mut world, cache, |guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            assert!(ui_spawn(
                context.clone(),
                "root".to_owned(),
                String::new(),
                "node".to_owned(),
            )?);
            assert!(ui_set_style(
                context.clone(),
                "root".to_owned(),
                r#"{"width":"100%","height":"100%","flexDirection":"column","alignItems":"center","justifyContent":"space-between","gap":12,"padding":"16px","background":[0.1,0.2,0.3,1.0]}"#.to_owned(),
            )?);
            assert!(ui_spawn(
                context.clone(),
                "start".to_owned(),
                "root".to_owned(),
                "button".to_owned(),
            )?);
            assert!(ui_spawn(
                context.clone(),
                "label".to_owned(),
                "start".to_owned(),
                "text".to_owned(),
            )?);
            assert!(ui_set_text(
                context.clone(),
                "label".to_owned(),
                "START".to_owned(),
                24.0,
                1.0,
                1.0,
                1.0,
                1.0,
            )?);

            guard.with_world_mut(|world| {
                let root = find_ui_entity(world, &attachment, "root").unwrap();
                let start = find_ui_entity(world, &attachment, "start").unwrap();
                let root_node = world.get::<Node>(root).unwrap();
                assert_eq!(root_node.width, Val::Percent(100.0));
                assert_eq!(root_node.flex_direction, FlexDirection::Column);
                assert_eq!(root_node.align_items, AlignItems::Center);
                assert_eq!(root_node.justify_content, JustifyContent::SpaceBetween);
                assert_eq!(root_node.row_gap, Val::Px(12.0));
                assert_eq!(world.get::<ChildOf>(start).unwrap().parent(), root);
                *world.get_mut::<Interaction>(start).unwrap() = Interaction::Pressed;
            })?;

            assert!(ui_button_just_pressed(context.clone(), "start".to_owned())?);
            assert!(ui_button_hovered(context.clone(), "start".to_owned())?);
            assert!(!ui_button_hovered(context.clone(), "root".to_owned())?);
            assert!(!ui_button_hovered(context.clone(), "missing".to_owned())?);
            guard.with_world_mut(World::clear_trackers)?;
            assert!(!ui_button_just_pressed(
                context.clone(),
                "start".to_owned()
            )?);
            ui_clear(context)?;
            Ok::<(), InteropError>(())
        })?;

        assert_eq!(world.query::<&ScriptUiNode>().iter(&world).count(), 0);
        Ok(())
    }

    #[test]
    fn invalid_style_is_rejected_without_partial_mutation() -> Result<(), InteropError> {
        let mut world = World::new();
        world.init_resource::<AppScriptFunctionRegistry>();
        world.init_resource::<AppTypeRegistry>();
        let attachment = ScriptAttachment::StaticScript(Handle::<ScriptAsset>::default());
        let cache =
            WorldGuard::setup_cache(&world, CurrentScriptAttachment(Some(attachment.clone())));

        WorldGuard::with_static_guard(&mut world, cache, |_guard| {
            let context = FunctionCallContext::new(Language::Unknown);
            assert!(ui_spawn(
                context.clone(),
                "root".to_owned(),
                String::new(),
                "node".to_owned(),
            )?);
            assert!(!ui_set_style(
                context,
                "root".to_owned(),
                r#"{"width":"100%","flexDirection":"sideways"}"#.to_owned(),
            )?);
            Ok::<(), InteropError>(())
        })?;

        let root = find_ui_entity(&mut world, &attachment, "root").unwrap();
        assert_eq!(world.get::<Node>(root).unwrap().width, Val::Auto);
        Ok(())
    }
}
