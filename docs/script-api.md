# BMS Script API

Runeweave registers script-facing operations once in `AppScriptFunctionRegistry`. Lua, JavaScript,
and TypeScript receive the same functions through their BMS language adapters. Scene data is stored
as real reflected Bevy components and resources; there is no script-side ECS snapshot in Rust.

## Scene Functions

| Function | Behavior |
| --- | --- |
| `scene_spawn(id, x, y, z)` | Creates or updates an owned entity with `ScriptTransform`. |
| `scene_set_sprite(id, path, width, height)` | Inserts a real `ScriptSprite` component. |
| `scene_set_transform(id, x, y, z)` | Updates the entity's real `ScriptTransform`. |
| `scene_set_text(id, value, size, r, g, b, a, anchor)` | Inserts a real `ScriptText`. |
| `scene_transform(id)` | Returns a BMS `ReflectReference` to `ScriptTransform`. |
| `scene_despawn(id)` | Despawns an entity owned by the current script. |
| `scene_clear()` | Despawns every entity owned by the current script. |
| `game_state_set(score, lives, message)` | Replaces the reflected `ScriptGameState` resource. |

Entity ownership is derived from BMS `CurrentScriptAttachment`. Detaching or reloading a script
removes only the entities owned by that attachment.

## Platform Services

Keyboard functions are `input_key_pressed`, `input_key_just_pressed`, and
`input_key_just_released`. HTTP functions are `http_get`, `http_post`, and `http_poll`. These are
also registered once through BMS; the Lua and QuickJS runtimes contain no Runeweave-specific service
bindings.

TypeScript declarations and ergonomic wrappers live in `projects/ts/modules/shooter/api`.
