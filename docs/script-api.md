# BMS Script API

Runeweave registers script-facing operations once in `AppScriptFunctionRegistry`. Lua, JavaScript,
and TypeScript receive the same functions through their BMS language adapters. Scene data is stored
as real reflected Bevy components and resources; there is no script-side ECS snapshot in Rust.

## Lifecycle callbacks

Mobile example hosts accept an optional package setting in `assets/engineConfig.json`:
`"mobile": { "orientation": "landscape" }`. Values are `auto` (the default), `portrait`,
or `landscape`. Android/iOS apply the restriction when activating or switching the game and
restore launcher behavior on exit. Both landscape directions are allowed. This is native host
configuration, not a script callback; Windows/macOS/Linux ignore it and retain `window` sizing.
Packages without `mobile` remain compatible. Updating it requires distributing the new config
and rebuilding the native hosts, without changing the runtime C ABI or Lua/QuickJS bindings.

`on_suspend()` is optional in Lua, JavaScript and TypeScript. The runtime dispatches it through
BMS before `on_update` when the primary window loses focus or Bevy reports application suspension.
Focus and lifecycle notifications for one interruption are coalesced; secondary windows do not
pause the game. Foregrounding rearms the callback and does not automatically restart gameplay.
Use it to cancel queued input/targeting and show a pause screen. Existing scripts without the
callback continue to work. This contract is shared by Windows, macOS, Linux, Android and iOS;
it does not serialize in-progress runs or provide recovery after process termination.

## Scene Functions

`ui_button_hovered(id)` reports whether an owned UI button has Bevy `Interaction::Hovered` or
`Interaction::Pressed`. Missing entities, non-buttons and another attachment's nodes return false.
Use it for mouse focus feedback; `ui_button_just_pressed` remains the activation event.

| Function | Behavior |
| --- | --- |
| `scene_spawn(id, x, y, z)` | Creates or updates an owned entity with Bevy `Transform`. |
| `scene_set_sprite(id, path, width, height)` | Inserts a Bevy `Sprite` that loads from the runtime asset root. |
| `scene_set_sprite_offset(id, x, y)` | Sets a drawing offset from the sprite's center in sprite-local units via its reflected Bevy `Anchor`, preserving the actor `Transform`. Requires a sprite with positive finite custom size; returns false for missing/non-sprite entities or invalid values. `(0, 0)` restores the centered anchor. |
| `scene_set_model(id, path)` | Loads scene 0 from a standard glTF 2.0 GLB into the owned entity. Proprietary containers that only use a `.glb` suffix are not supported. |
| `scene_set_transform_3d(id, x, y, z, rx, ry, rz, scale)` | Applies a 3D translation, Euler rotation in radians, and uniform scale. |
| `scene_play_animation(id, path, repeat)` | Loads animation 0 from a standard glTF 2.0 GLB and binds it after the model hierarchy is ready. |
| `scene_set_3d_enabled(enabled)` | Enables or disables the runtime's 3D camera; it starts with an orthographic projection. |
| `scene_set_environment(configJson)` | Configures the real `GlobalAmbientLight`, `DirectionalLight`, `ClearColor` and 3D-camera `DistanceFog` through BMS. JSON has `ambient`, `sun`, `background` RGB arrays (0–1), `brightness` (0–10000), `illuminance` (0–200000), a finite nonzero `direction` XYZ and optional `fog: { color: [r,g,b,a], start, end }`. Linear fog requires `0 <= start < end`; null/omitted fog removes it. Rejects unknown fields, invalid values, payloads above 4096 bytes or a missing 3D camera with false before mutation. Works identically on Lua and QuickJS; no C ABI changes or platform-specific types. Native hosts need a rebuilt runtime. |
| `scene_set_camera_3d(x, y, z, targetX, targetY, targetZ, fovDegrees)` | Moves the existing 3D camera and aims it at a target using perspective projection. FOV is 10–140 degrees; coordinates must be finite and the target distinct. Returns false without mutation for invalid arguments or a missing camera. Vertical views use a stable alternative up axis. Does not enable the camera; call `scene_set_3d_enabled(true)` separately. |
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

`input_touches()` reads all active contacts from the same live `Touches` resource through
`WorldGuard`. Lua receives a sequence and QuickJS/TypeScript an array of
`{ id, justPressed, x, y }` objects, sorted by native numeric ID. `id` is a string preserving
the entire native u64 identifier. Coordinates are normalized against the primary window,
with `(0, 0)` at the **top-left** and `(1, 1)` at the bottom-right. Unlike the older single-touch
API, Y increases downward, matching retained UI. Releasing/cancelling a contact removes its ID;
there is no mouse emulation, cached ECS mirror or separate per-language implementation. Without
active touch input or a usable primary window the result is empty on all five supported platforms.
Use stable IDs for joystick/button capture and clear capture on suspend, modal entry or resizing.

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

`app_locale()` returns the native preferred language as a BCP 47 tag (for example `zh-Hans-CN`
or `en-US`), with `en-US` as the fallback when unavailable. It is registered once through BMS
and has the same Lua and QuickJS/TypeScript contract on Windows, macOS, Linux, Android and iOS.
Android reads the system language, rather than an Android per-app language override. It does not
change system settings or subscribe to language changes; games decide when to read it and how to
map unsupported languages. Existing runtime libraries must be rebuilt to expose the new function;
the public C ABI is unchanged.

`app_platform()` returns the native operating-system identifier (`windows`, `macos`, `linux`,
`android` or `ios` on supported targets). It is independent of language and input hardware and
has the same BMS registration for Lua and QuickJS/TypeScript. Ember Arena uses it to show its
mobile controls only on Android/iOS. Both this function and `input_touches()` require a freshly
built native runtime; the public C ABI and host ownership/lifecycle contracts are unchanged.

`window_set_size(width, height)` lets scripts choose their desktop window dimensions on Windows,
macOS, and Linux. It returns `true` when the primary window accepts a finite size between 1 and
16384 logical pixels. Android and iOS own their window geometry through the native host, run the
game in immersive full-screen mode, and return `false` for every script resize request. This keeps
one portable script contract without allowing gameplay code to break mobile full-screen behavior.

For the **initial** desktop size, set an optional `window` object in `assets/engineConfig.json`:

```json
"window": { "width": 1280, "height": 800 }
```

The runtime reads these logical-pixel dimensions before creating the native window, and centers
that final size on the primary monitor. Both fields must be integers from 1 through 16384;
invalid desktop window settings return a startup error. Packages without `window` keep the
600×800 default. Android and iOS ignore this desktop preference and retain native fullscreen.
Use `window_set_size` for explicit user actions after launch, rather than in `on_script_loaded`:
resizing an already visible window can produce a size transition and leave it off-center.
The C ABI is unchanged; previously distributed runtime libraries need rebuilding to read this field.

`window_safe_area()` returns `left`, `right`, `bottom`, `top`, `width`, `height`, and the four
`*Inset` values in virtual world units. Desktop insets are zero. Android derives them from winit's
native content rectangle; iOS derives them from the UIKit safe-area inner rectangle. Script
Squadron draws its background across the complete viewport, while keeping HUD text, settings UI,
the player, enemies, and bullets inside this safe rectangle. Click and touch hit tests reuse the
same safe-area layout coordinates.

HTTP functions are `http_get`, `http_post`, and `http_poll`. These services are also registered once
through BMS; the Lua and QuickJS runtimes contain no Runeweave-specific service bindings.

TypeScript declarations and ergonomic wrappers live in `projects/ts/modules/shooter/api`.

## Audio

Audio functions use the same BMS registry for Lua and QuickJS/TypeScript. Playback is backed by
owned Bevy audio entities; IDs are independent of scene/UI IDs. Native runtimes must be rebuilt
to include the audio plugin and Ogg Vorbis decoder.

| Function | Contract |
| --- | --- |
| `audio_play(id, path, looping, volume)` | Queues a relative `.ogg`/`.oga` asset. Linear volume is 0–1. Replaces an owned voice with the same ID; at most 64 voices per script. `true` means accepted, not audible yet. |
| `audio_update(id, volume, speed, paused)` | Updates a queued or playing voice. Speed is 0.25–4. Returns `false` for an unknown voice or invalid parameters. |
| `audio_state(id)` | Returns `missing`, `queued`, `playing`, `paused`, `error`, or `unavailable`. Missing/corrupt assets report `error`. A loaded asset without a device sink after five seconds reports `unavailable`; it may recover if playback becomes available. |
| `audio_stop(id)` | Despawns one owned voice, returning whether it existed. |
| `audio_clear()` | Despawns all voices belonging to this script. |

Decoding validation runs on the asset I/O thread before playback, so corrupt headers become
asset errors. Scripts cannot update or stop another attachment's voices. `scene_clear` preserves
audio across scene transitions; script detach/unload removes it. Window focus loss/application
suspension pauses existing and queued voices before playback. Foregrounding resumes only voices
that the script itself has not paused. This contract is portable across Windows, macOS, Linux,
Android and iOS; device/driver availability is reported separately from queue acceptance.

For desktop games, `window.vsync` in `engineConfig.json` is an optional boolean, defaulting to
`true`. Setting it to `false` requests Bevy's portable `AutoNoVsync` mode; the compositor may
still limit presentation. Android/iOS keep their native presentation settings. In debug builds,
`RUNEWEAVE_RENDER_DIAGNOSTICS=1` enables Bevy frame/render diagnostics. Metal CPU timings are
available, while unsupported GPU timestamp measurements must not be interpreted as zero GPU cost.

Optional `"render": { "msaaSamples": 1, "fxaa": true }` configures startup camera antialiasing.
`msaaSamples` accepts 1 (off), 2, 4 or 8 and applies to both runtime cameras. FXAA applies only
to the 3D camera and requires MSAA off. Invalid values, types, combinations or unknown render
fields return a startup error. Omitted render settings retain 4× MSAA and no FXAA on every platform.

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
