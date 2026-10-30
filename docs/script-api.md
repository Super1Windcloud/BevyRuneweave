# BMS Script API

Runeweave registers script-facing operations once in `AppScriptFunctionRegistry`. Lua, JavaScript,
and TypeScript receive the same functions through their BMS language adapters. Scene data is stored
as real reflected Bevy components and resources; there is no script-side ECS snapshot in Rust.

## Scene Functions

| Function | Behavior |
| --- | --- |
| `scene_spawn(id, x, y, z)` | Creates or updates an owned entity with Bevy `Transform`. |
| `scene_set_sprite(id, path, width, height)` | Inserts a Bevy `Sprite` that loads from the runtime asset root. |
| `scene_set_model(id, path)` | Loads scene 0 from a standard glTF 2.0 GLB into the owned entity. Proprietary containers that only use a `.glb` suffix are not supported. |
| `scene_set_transform_3d(id, x, y, z, rx, ry, rz, scale)` | Applies a 3D translation, Euler rotation in radians, and uniform scale. |
| `scene_play_animation(id, path, repeat)` | Loads animation 0 from a standard glTF 2.0 GLB and binds it after the model hierarchy is ready. |
| `scene_set_3d_enabled(enabled)` | Enables or disables the runtime's fixed orthographic 3D camera. |
| `scene_set_transform(id, x, y, z)` | Updates the entity's Bevy `Transform`. |
| `scene_set_text(id, value, size, r, g, b, a, anchor)` | Inserts Bevy `Text2d`, `TextFont`, `TextColor`, and `Anchor` components. |
| `scene_transform(id)` | Returns a BMS `ReflectReference` to Bevy `Transform`. |
| `scene_despawn(id)` | Despawns an entity owned by the current script. |
| `scene_clear()` | Despawns every entity owned by the current script. |
| `game_state_set(score, lives, message)` | Replaces the reflected `ScriptGameState` resource. |
| `app_request_exit()` | Returns an embedding host to its launcher, or sends `AppExit::Success` when no host callback is installed. Reports whether the request was accepted. |
| `window_set_size(width, height)` | Sets the primary window size on desktop; returns `false` without resizing on Android and iOS. |
| `window_safe_area()` | Returns the native safe rectangle in the same centered world coordinates as the primary pointer. |
| `window_metrics()` | Returns logical window pixel `width` and `height` for retained UI, or zero dimensions when there is no primary window. Pointer coordinates remain virtual world units. |

Entity ownership is derived from BMS `CurrentScriptAttachment`. Detaching or reloading a script
removes only the entities owned by that attachment.

### Reflected Gameplay Actors

`scene_actor_set(id, kind, health, speed, radius)` adds or replaces a real reflected `ScriptActor`
component on an existing owned entity. Kind must be nonempty and at most 64 bytes; numeric arguments
must be finite and nonnegative, and radius must be positive. Invalid arguments or missing entities
return `false` without changing the entity.

`scene_actor(id)` returns its BMS `ReflectReference`, or Lua nil / JavaScript undefined when the entity or component does
not exist. Fields are `kind`, `health`, `speed`, `radius`, `power`, `cooldown`, `lifetime`,
`velocity_x`, and `velocity_z`; the last five default to zero. Lua uses normal field access;
QuickJS/TypeScript uses `reference.get(name)` and `reference.set(name, value)`. Reflection writes
follow the normal BMS type/access checks; gameplay must keep numeric values finite.

`scene_actor_ids()` queries the real World and returns sorted IDs of actors owned by the current
attachment. No actor list or component snapshot is retained outside Bevy. Movement, circle/segment
collision rules and combat remain TypeScript gameplay; these APIs do not implement native physics.
Both language adapters consume the same registry entries. They use portable Bevy types on all five
targets; platform execution must still be verified separately.

## Retained UI

Runeweave UI nodes are real Bevy `Node`, `Text`, `ImageNode`, and `Button` components. They use
Bevy's Flexbox layout and are separate from world-space `Sprite`/`Text2d` scene entities.

| Function | Behavior |
| --- | --- |
| `ui_spawn(id, parentId, kind)` | Creates a `node`, `text`, `image`, or `button`; an empty parent ID creates a root. |
| `ui_set_style(id, styleJson)` | Applies validated CSS-like Flexbox style JSON. |
| `ui_set_text(id, value, size, r, g, b, a)` | Sets text content, size, and color on a text node. |
| `ui_set_image(id, path)` | Loads an asset-root-relative image into an image node. |
| `ui_button_just_pressed(id)` | Reports a button's transition to Bevy `Interaction::Pressed`. |
| `ui_despawn(id)` | Removes one UI node and its descendants. |
| `ui_clear()` | Removes UI nodes owned by the current script. |

Style lengths accept finite numbers as logical pixels, strings such as `"24px"` and `"100%"`, or
`"auto"`. Supported fields are `width`, `height`, min/max dimensions, `left`, `right`, `top`,
`bottom`, `flexDirection`, `alignItems`, `justifyContent`, `position`, `display`, `gap`, `rowGap`,
`columnGap`, `padding`, `margin`, `borderRadius`, `flexGrow`, `flexShrink`, and RGBA `background`.
Unknown fields and invalid values are rejected without partially changing the node.

TypeScript projects can use the declarative helpers in `api/ui.ts`:

```ts
import { button, column, mountUi, text, updateUi } from "../../api/ui.js";

mountUi(column("menu", {
  width: "100%",
  height: "100%",
  padding: 24,
  gap: 12,
  alignItems: "center",
  justifyContent: "center",
}, [
  text("title", "Runeweave", { fontSize: 28 }),
  button("start", "START", {
    style: { width: 180, height: 56, borderRadius: 12, background: [0.1, 0.5, 0.9, 1] },
    onClick: startGame,
  }),
]));

function on_update(): void {
  updateUi();
}
```

Lua and JavaScript receive the same seven registered functions. Lua can pass style JSON directly,
for example `ui_set_style("menu", '{"width":"100%","flexDirection":"column"}')`, and poll
`ui_button_just_pressed` from `on_update`.

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

## Persistent Storage

The BMS registry exposes `storage_read(key)`, `storage_write(key, value)` and `storage_remove(key)`
to both Lua and QuickJS. Values are UTF-8 strings; JSON serialization/versioning belongs to the game.
Keys and the `engineConfig.name` project namespace accept 1-64 ASCII letters, digits, `_` or `-`.
Scripts never receive or select filesystem paths. Keys cannot traverse to other projects.

- Read: `{ state: "ok", value }`, `{ state: "missing" }`, or `{ state: "error", error }`.
- Write: `{ state: "ok" }` or `{ state: "error", error }`.
- Remove: `{ state: "ok" }`, `{ state: "missing" }`, or `{ state: "error", error }`.
- Error codes: `invalid_key`, `unavailable`, `too_large`, `invalid_data`, `io`.

Each value is limited to 64 KiB in UTF-8 bytes. Reads are bounded and invalid UTF-8 is reported without
deleting the original file. Writes stage a private temporary file in the destination directory,
sync its contents, then use [tempfile's atomic replacement](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist).
The containing directory is synced best-effort on Unix. This is not a multi-key transaction, a
cross-process merge protocol, or an absolute power-loss durability guarantee; concurrent writers
use the last successful replacement. Small synchronous I/O should run at settings/result transitions,
not every gameplay frame. Errors are returned as data and do not crash script execution.

Files live under `<data-root>/saves/<engineConfig.name>/<key>.save`, independently of installed assets:

| Platform | Default data root |
| --- | --- |
| Windows | `%LOCALAPPDATA%/Bevy RuneWeave` |
| macOS | `$HOME/Library/Application Support/Bevy RuneWeave` |
| Linux | `$XDG_DATA_HOME/Bevy RuneWeave`, or `$HOME/.local/share/Bevy RuneWeave` |
| Android | NativeActivity's private `internal_data_path()/Bevy RuneWeave` |
| iOS | App sandbox `$HOME/Library/Application Support/Bevy RuneWeave` |

An absolute `RUNEWEAVE_DATA_DIR` supplied by the host overrides the default data root. Missing or invalid
project configuration/private data directories produce `unavailable`; the runtime does not fall back to
writing into a resource package. No C ABI change is required. Shared declarations and return values
are portable across all five platforms; build/run evidence must be reported per target.

Storage is a real Bevy resource accessed through `WorldGuard`, with no value cache or mirrored ECS.
The first storage operation binds the current BMS attachment to its project namespace. Script switches
refresh the default namespace for new attachments while preserving bindings for callbacks from the old
game; detached entity scripts cannot write, and detach events release their bindings. This prevents a
late callback from writing the previous game's data into a newly selected game's save directory.
