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
| `app_request_exit()` | Returns an embedding host to its launcher, or sends `AppExit::Success` when no host callback is installed. Reports whether the request was accepted. |
| `window_set_size(width, height)` | Sets the primary window size on desktop; returns `false` without resizing on Android and iOS. |
| `window_safe_area()` | Returns the native safe rectangle in the same centered world coordinates as the primary pointer. |

Entity ownership is derived from BMS `CurrentScriptAttachment`. Detaching or reloading a script
removes only the entities owned by that attachment.

## Platform Services

Keyboard functions are `input_key_pressed`, `input_key_just_pressed`, and
`input_key_just_released`; each reads Bevy's live `ButtonInput<KeyCode>` resource through
`WorldGuard`. `input_primary_touch()` reads the lowest-ID active touch from Bevy's live `Touches`
resource and returns `pressed`, `justPressed`, `x`, `y`, `deltaX`, and `deltaY`. Positions and deltas
are normalized against the primary window; X runs left-to-right and Y runs bottom-to-top. On systems
without an active touch it returns the same object with `pressed: false` and zero coordinates.

`input_primary_pointer()` is the cross-platform click and drag API used by gameplay. It prioritizes
the lowest-ID active touch, then falls back to the primary mouse cursor and left button. It returns
`pressed`, `justPressed`, `x`, `y`, `viewportWidth`, and `viewportHeight`. Position and viewport
values use the same centered world-unit coordinate system as the responsive 2D camera, whose
virtual height is fixed at 800 while its width follows the actual window aspect ratio.

The shooter uses the primary pointer for mouse/touch drag movement and geometry-based hit testing.
Its top-right settings icon and menu scale with the visible playfield. The menu opens `RESTART` and
`EXIT GAME`; exit is routed through `app_request_exit()` on all five platforms. Mobile hosts keep
their process-owned event loop alive and return to the native home screen instead of terminating the
application.

`window_set_size(width, height)` lets scripts choose their desktop window dimensions on Windows,
macOS, and Linux. It returns `true` when the primary window accepts a finite size between 1 and
16384 logical pixels. Android and iOS own their window geometry through the native host, run the
game in immersive full-screen mode, and return `false` for every script resize request. This keeps
one portable script contract without allowing gameplay code to break mobile full-screen behavior.

`window_safe_area()` returns `left`, `right`, `bottom`, `top`, `width`, `height`, and the four
`*Inset` values in virtual world units. Desktop insets are zero. Android derives them from winit's
native content rectangle; iOS derives them from the UIKit safe-area inner rectangle. Script
Squadron draws its background across the complete viewport, while keeping HUD text, settings UI,
the player, enemies, and bullets inside this safe rectangle. Click and touch hit tests reuse the
same safe-area layout coordinates.

HTTP functions are `http_get`, `http_post`, and `http_poll`. These services are also registered once
through BMS; the Lua and QuickJS runtimes contain no Runeweave-specific service bindings.

TypeScript declarations and ergonomic wrappers live in `projects/ts/modules/shooter/api`.
