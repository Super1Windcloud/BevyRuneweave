# BMS Script API

Runeweave registers script-facing operations once in `AppScriptFunctionRegistry`. Lua, JavaScript,
and TypeScript receive the same functions through their BMS language adapters. Scene data is stored
as real reflected Bevy components and resources; there is no script-side ECS snapshot in Rust.

## Scene Functions

| Function | Behavior |
| --- | --- |
| `scene_spawn(id, x, y, z)` | Creates or updates an owned entity with Bevy `Transform`. |
| `scene_set_sprite(id, path, width, height)` | Inserts a Bevy `Sprite` that loads from the runtime asset root. |
| `scene_set_transform(id, x, y, z)` | Updates the entity's Bevy `Transform`. |
| `scene_set_text(id, value, size, r, g, b, a, anchor)` | Inserts Bevy `Text2d`, `TextFont`, `TextColor`, and `Anchor` components. |
| `scene_transform(id)` | Returns a BMS `ReflectReference` to Bevy `Transform`. |
| `scene_despawn(id)` | Despawns an entity owned by the current script. |
| `scene_clear()` | Despawns every entity owned by the current script. |
| `game_state_set(score, lives, message)` | Replaces the reflected `ScriptGameState` resource. |

Entity ownership is derived from BMS `CurrentScriptAttachment`. Detaching or reloading a script
removes only the entities owned by that attachment.

## Platform Services

Keyboard functions are `input_key_pressed`, `input_key_just_pressed`, and
`input_key_just_released`; each reads Bevy's live `ButtonInput<KeyCode>` resource through
`WorldGuard`. `input_primary_touch()` reads the lowest-ID active touch from Bevy's live `Touches`
resource and returns `pressed`, `justPressed`, `x`, `y`, `deltaX`, and `deltaY`. Positions and deltas
are normalized against the primary window; X runs left-to-right and Y runs bottom-to-top. On systems
without an active touch it returns the same object with `pressed: false` and zero coordinates.

HTTP functions are `http_get`, `http_post`, and `http_poll`. These services are also registered once
through BMS; the Lua and QuickJS runtimes contain no Runeweave-specific service bindings.

TypeScript declarations and ergonomic wrappers live in `projects/ts/modules/shooter/api`.
