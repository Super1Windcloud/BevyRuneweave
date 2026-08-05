use std::collections::HashMap;

use bevy::prelude::*;

use super::{
    command::{ComponentMap, EcsCommand, ResourceMap, take_commands},
    value::EcsValue,
};

#[derive(Resource, Default)]
pub(super) struct ScriptEntityRegistry(HashMap<String, Entity>);

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

pub(super) fn apply_ecs_writes(
    mut commands: Commands,
    mut entities: ResMut<ScriptEntityRegistry>,
    script_entities: Query<Entity, With<ScriptOwned>>,
) {
    for command in take_commands() {
        match command {
            EcsCommand::ClearWorld => {
                let registered = entities
                    .0
                    .drain()
                    .map(|(_, entity)| entity)
                    .collect::<Vec<_>>();
                for &entity in &registered {
                    commands.entity(entity).despawn();
                }
                for entity in &script_entities {
                    if !registered.contains(&entity) {
                        commands.entity(entity).despawn();
                    }
                }
            }
            EcsCommand::SpawnEntity { id } => {
                if let Some(old) = entities.0.remove(&id) {
                    commands.entity(old).despawn();
                }
                let entity = commands
                    .spawn((
                        ScriptOwned,
                        ScriptEntityId(id.clone()),
                        ScriptComponents::default(),
                    ))
                    .id();
                entities.0.insert(id, entity);
            }
            EcsCommand::SyncComponents { id, components } => {
                if let Some(entity) = entities.0.get(&id) {
                    commands
                        .entity(*entity)
                        .insert(ScriptComponents(components));
                }
            }
            EcsCommand::DespawnEntity { id } => {
                if let Some(entity) = entities.0.remove(&id) {
                    commands.entity(entity).despawn();
                }
            }
            EcsCommand::SyncResources(resources) => {
                commands.insert_resource(ScriptResources(resources));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ecs_api::command::{
        clear_world, entity_exists, get_component, get_resource, insert_component, query_entities,
        remove_component, reset_bridge, set_resource, spawn_entity,
    };

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
        reset_bridge();
        let mut app = App::new();
        app.init_resource::<ScriptEntityRegistry>()
            .init_resource::<ScriptResources>()
            .add_systems(Update, (apply_ecs_writes, ApplyDeferred).chain());

        spawn_entity("player".to_owned());
        assert!(entity_exists("player"));
        assert!(insert_component(
            "player",
            "transform".to_owned(),
            object([
                ("x", EcsValue::Number(12.0)),
                ("y", EcsValue::Number(-34.0)),
            ]),
        ));
        assert!(insert_component(
            "player",
            "sprite".to_owned(),
            object([("kind", EcsValue::String("player".to_owned()))]),
        ));
        set_resource(
            "game_state".to_owned(),
            object([
                ("score", EcsValue::Number(200.0)),
                ("lives", EcsValue::Number(2.0)),
            ]),
        );

        assert_eq!(
            query_entities(&["sprite".to_owned(), "transform".to_owned()]),
            ["player"]
        );
        assert_eq!(
            get_component("player", "transform")
                .and_then(|value| value.field("x").and_then(EcsValue::as_number)),
            Some(12.0)
        );
        assert_eq!(
            get_resource("game_state")
                .and_then(|value| value.field("lives").and_then(EcsValue::as_number)),
            Some(2.0)
        );

        app.update();
        let world = app.world_mut();
        let mut query = world.query::<(&ScriptEntityId, &ScriptComponents)>();
        let (id, components) = query.single(world).expect("one script entity");
        assert_eq!(id.as_str(), "player");
        assert!(components.get("sprite").is_some());
        assert_eq!(
            world
                .resource::<ScriptResources>()
                .get("game_state")
                .and_then(|value| value.field("score"))
                .and_then(EcsValue::as_number),
            Some(200.0)
        );

        assert!(remove_component("player", "sprite"));
        assert!(query_entities(&["sprite".to_owned()]).is_empty());
        clear_world();
        spawn_entity("final-player".to_owned());
        app.update();

        let world = app.world_mut();
        let mut query = world.query_filtered::<&ScriptEntityId, With<ScriptOwned>>();
        let ids = query
            .iter(world)
            .map(ScriptEntityId::as_str)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["final-player"]);
    }
}
