use std::collections::HashMap;

use bevy::prelude::*;

use super::{
    command::{ComponentMap, EcsBridge, ResourceMap, ScriptEntityKey},
    value::EcsValue,
};

#[derive(Resource, Default)]
pub(super) struct ScriptEntityRegistry(HashMap<ScriptEntityKey, Entity>);

/// All script-defined components attached to one Bevy entity.
#[derive(Component, Clone, Debug, Default)]
pub struct ScriptComponents(ComponentMap);

impl ScriptComponents {
    /// Returns a named component value.
    pub fn get(&self, name: &str) -> Option<&EcsValue> {
        self.0.get(name)
    }

    /// Iterates over all named component values.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &EcsValue)> {
        self.0.iter().map(|(name, value)| (name.as_str(), value))
    }
}

/// Script-defined ECS resources shared by all script-owned entities.
#[derive(Resource, Clone, Debug, Default)]
pub struct ScriptResources(ResourceMap);

impl ScriptResources {
    /// Returns a named resource value.
    pub fn get(&self, name: &str) -> Option<&EcsValue> {
        self.0.get(name)
    }

    /// Iterates over all named resource values.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &EcsValue)> {
        self.0.iter().map(|(name, value)| (name.as_str(), value))
    }
}

/// Marks entities whose lifecycle is owned by a script.
#[derive(Component)]
pub struct ScriptOwned;

/// Stable script-facing identity for a Bevy entity.
#[derive(Component)]
pub struct ScriptEntityId(String);

impl ScriptEntityId {
    /// Returns the stable script-facing identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Stable identity of the script context that owns an entity.
#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub struct ScriptOwnerId(String);

impl ScriptOwnerId {
    /// Returns the stable owner identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub(super) fn apply_ecs_writes(
    mut commands: Commands,
    bridge: Res<EcsBridge>,
    mut entities: ResMut<ScriptEntityRegistry>,
    mut resources: ResMut<ScriptResources>,
) {
    let changes = bridge.take_changes();
    for owner in changes.cleared_owners {
        let owned = entities
            .0
            .extract_if(|key, _| key.owner == owner)
            .map(|(_, entity)| entity)
            .collect::<Vec<_>>();
        for entity in owned {
            commands.entity(entity).despawn();
        }
    }
    for key in changes.removed_entities {
        if let Some(entity) = entities.0.remove(&key) {
            commands.entity(entity).despawn();
        }
    }
    for (key, components) in changes.upsert_entities {
        if let Some(entity) = entities.0.get(&key).copied() {
            commands.entity(entity).insert(ScriptComponents(components));
        } else {
            let entity = commands
                .spawn((
                    ScriptOwned,
                    ScriptOwnerId(key.owner.clone()),
                    ScriptEntityId(key.id.clone()),
                    ScriptComponents(components),
                ))
                .id();
            entities.0.insert(key, entity);
        }
    }
    if let Some(next_resources) = changes.resources {
        resources.0 = next_resources;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use bevy::asset::Handle;
    use bevy_mod_scripting::{prelude::ScriptAsset, script::ScriptAttachment};

    use super::*;
    use crate::ecs_api::command::EcsBridge;

    fn object(fields: impl IntoIterator<Item = (&'static str, EcsValue)>) -> EcsValue {
        EcsValue::Object(
            fields
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value))
                .collect::<BTreeMap<_, _>>(),
        )
    }

    #[test]
    fn structured_components_resources_and_queries_sync_to_bevy() {
        let bridge = EcsBridge::default();
        let mut app = App::new();
        app.insert_resource(bridge.clone())
            .init_resource::<ScriptEntityRegistry>()
            .init_resource::<ScriptResources>()
            .add_systems(Update, (apply_ecs_writes, ApplyDeferred).chain());

        bridge.spawn_entity("player".to_owned());
        assert!(bridge.entity_exists("player"));
        assert!(bridge.insert_component(
            "player",
            "transform".to_owned(),
            object([
                ("x", EcsValue::Number(12.0)),
                ("y", EcsValue::Number(-34.0)),
            ]),
        ));
        assert!(bridge.insert_component(
            "player",
            "sprite".to_owned(),
            object([("kind", EcsValue::String("player".to_owned()))]),
        ));
        bridge.set_resource(
            "game_state".to_owned(),
            object([
                ("score", EcsValue::Number(200.0)),
                ("lives", EcsValue::Number(2.0)),
            ]),
        );

        assert_eq!(
            bridge.query_entities(&["sprite".to_owned(), "transform".to_owned()]),
            ["player"]
        );
        assert!(
            bridge
                .query_entities_filtered(&["sprite".to_owned()], &["transform".to_owned()])
                .is_empty()
        );

        bridge.spawn_entity_bundle(
            "pickup".to_owned(),
            [("sprite".to_owned(), EcsValue::String("pickup".to_owned()))]
                .into_iter()
                .collect(),
        );
        assert_eq!(
            bridge.query_entities_filtered(&["sprite".to_owned()], &["transform".to_owned()]),
            ["pickup"]
        );
        assert_eq!(
            bridge.query_entities_matching(
                &[],
                &["transform".to_owned(), "missing".to_owned()],
                &["disabled".to_owned()],
            ),
            ["player"]
        );
        assert_eq!(
            bridge
                .get_component("player", "transform")
                .and_then(|value| value.field("x").and_then(EcsValue::as_number)),
            Some(12.0)
        );
        assert_eq!(
            bridge
                .get_resource("game_state")
                .and_then(|value| value.field("lives").and_then(EcsValue::as_number)),
            Some(2.0)
        );

        app.update();
        let world = app.world_mut();
        let mut query = world.query::<(&ScriptEntityId, &ScriptComponents)>();
        let (id, components) = query
            .iter(world)
            .find(|(id, _)| id.as_str() == "player")
            .expect("player script entity");
        assert_eq!(id.as_str(), "player");
        assert!(components.get("sprite").is_some());
        assert_eq!(
            components
                .get("transform")
                .and_then(|value| value.field("x"))
                .and_then(EcsValue::as_number),
            Some(12.0)
        );
        assert_eq!(
            world
                .resource::<ScriptResources>()
                .get("game_state")
                .and_then(|value| value.field("score"))
                .and_then(EcsValue::as_number),
            Some(200.0)
        );

        assert!(bridge.remove_component("player", "sprite"));
        assert_eq!(bridge.query_entities(&["sprite".to_owned()]), ["pickup"]);
        bridge.clear_world();
        bridge.spawn_entity("final-player".to_owned());
        app.update();

        let world = app.world_mut();
        let mut query = world.query_filtered::<&ScriptEntityId, With<ScriptOwned>>();
        let ids = query
            .iter(world)
            .map(ScriptEntityId::as_str)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["final-player"]);
    }

    #[test]
    fn bridge_state_is_isolated_per_app() {
        let first = EcsBridge::default();
        let second = EcsBridge::default();

        first.spawn_entity("only-first".to_owned());
        first.set_resource("score".to_owned(), EcsValue::Number(10.0));

        assert!(first.entity_exists("only-first"));
        assert!(!second.entity_exists("only-first"));
        assert_eq!(second.get_resource("score"), None);
    }

    #[test]
    fn bridge_rejects_invalid_keys() {
        let bridge = EcsBridge::default();
        bridge.spawn_entity(String::new());
        assert!(!bridge.entity_exists(""));
        assert!(!bridge.insert_component("missing", String::new(), EcsValue::Null));
        bridge.set_resource("\n".to_owned(), EcsValue::Bool(true));
        assert_eq!(bridge.get_resource("\n"), None);
    }

    #[test]
    fn script_owners_can_reuse_ids_and_clear_independently() {
        let root = EcsBridge::default();
        let first = root.for_owner("script-a".to_owned());
        let second = root.for_owner("script-b".to_owned());
        let mut app = App::new();
        app.insert_resource(root)
            .init_resource::<ScriptEntityRegistry>()
            .init_resource::<ScriptResources>()
            .add_systems(Update, (apply_ecs_writes, ApplyDeferred).chain());

        first.spawn_entity("player".to_owned());
        second.spawn_entity("player".to_owned());
        assert_eq!(first.query_entities(&[]), ["player"]);
        assert_eq!(second.query_entities(&[]), ["player"]);
        app.update();

        first.clear_world();
        assert!(!first.entity_exists("player"));
        assert!(second.entity_exists("player"));
        app.update();

        let world = app.world_mut();
        let mut query = world.query::<(&ScriptOwnerId, &ScriptEntityId)>();
        let owned = query
            .iter(world)
            .map(|(owner, id)| (owner.as_str(), id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(owned, [("script-b", "player")]);
    }

    #[test]
    fn attachment_owner_id_is_stable_without_display_strings() {
        let root = EcsBridge::default();
        let script = Handle::<ScriptAsset>::default();
        let first_attachment = ScriptAttachment::EntityScript(
            Entity::from_raw_u32(1).expect("valid test entity"),
            script.clone(),
        );
        let second_attachment = ScriptAttachment::EntityScript(
            Entity::from_raw_u32(2).expect("valid test entity"),
            script,
        );

        root.for_attachment(&first_attachment)
            .spawn_entity("owned".to_owned());

        assert!(
            root.for_attachment(&first_attachment)
                .entity_exists("owned")
        );
        assert!(
            !root
                .for_attachment(&second_attachment)
                .entity_exists("owned")
        );
    }
}
