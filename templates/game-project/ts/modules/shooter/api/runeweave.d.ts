interface BmsReflectReference {
  get(key: string | number): unknown;
  set(key: string | number, value: unknown): void;
  call(name: string, ...args: unknown[]): unknown;
}

declare function scene_spawn(id: string, x: number, y: number, z: number): boolean;
declare function scene_set_sprite(id: string, path: string, width: number, height: number): boolean;
declare function scene_set_model(id: string, path: string): boolean;
declare function scene_set_transform_3d(
  id: string,
  x: number,
  y: number,
  z: number,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  scale: number,
): boolean;
declare function scene_play_animation(id: string, path: string, repeat: boolean): boolean;
declare function scene_set_3d_enabled(enabled: boolean): boolean;
declare function scene_set_transform(id: string, x: number, y: number, z: number): boolean;
declare function scene_set_text(
  id: string,
  value: string,
  fontSize: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
  anchor: string,
): boolean;
declare function scene_despawn(id: string): boolean;
declare function scene_clear(): void;
declare function scene_transform(id: string): BmsReflectReference | null | undefined;
declare function ui_spawn(id: string, parentId: string, kind: "node" | "text" | "image" | "button"): boolean;
declare function ui_set_style(id: string, styleJson: string): boolean;
declare function ui_set_text(id: string, value: string, fontSize: number, red: number, green: number, blue: number, alpha: number): boolean;
declare function ui_set_image(id: string, path: string): boolean;
declare function ui_button_just_pressed(id: string): boolean;
declare function ui_despawn(id: string): boolean;
declare function ui_clear(): void;
declare function game_state_set(score: number, lives: number, message: string): void;
declare function app_request_exit(): boolean;
declare function window_set_size(width: number, height: number): boolean;
declare function window_safe_area(): RuneweaveWindowSafeArea;
declare function input_key_pressed(key: string): boolean;
declare function input_key_just_pressed(key: string): boolean;
declare function input_key_just_released(key: string): boolean;
declare function input_primary_touch(): RuneweaveTouchState;
declare function input_primary_pointer(): RuneweavePointerState;

interface RuneweaveTouchState {
  pressed: boolean;
  justPressed: boolean;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

interface RuneweavePointerState {
  pressed: boolean;
  justPressed: boolean;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
}
interface RuneweaveWindowSafeArea {
  left: number;
  right: number;
  bottom: number;
  top: number;
  width: number;
  height: number;
  leftInset: number;
  rightInset: number;
  bottomInset: number;
  topInset: number;
}
declare function http_get(url: string): number;
declare function http_post(url: string, body: string, contentType: string): number;
declare function http_poll(id: number): HttpPollResult;

type HttpPollResult =
  | { state: "pending" }
  | { state: "complete"; status: number; body: string }
  | { state: "error"; error: string }
  | { state: "unknown" };

interface RuneweaveCallbacks {
  on_script_loaded: () => void;
  on_script_reloaded: () => void;
  on_update: (dt: number) => void;
}

/** ScriptActor is a real reflected Bevy component owned by this attachment. */
declare function scene_actor_set(id: string, kind: string, health: number, speed: number, radius: number): boolean;
declare function scene_actor(id: string): BmsReflectReference | null | undefined;
declare function scene_actor_ids(): string[];

/** Values are UTF-8 strings, scoped by engineConfig.name; maximum 64 KiB per key. */
type StorageError = "invalid_key" | "unavailable" | "too_large" | "invalid_data" | "io";
type StorageReadResult = { state: "ok"; value: string } | { state: "missing" } | { state: "error"; error: StorageError };
type StorageWriteResult = { state: "ok" } | { state: "error"; error: StorageError };
declare function storage_read(key: string): StorageReadResult;
declare function storage_write(key: string, value: string): StorageWriteResult;
declare function storage_remove(key: string): StorageWriteResult | { state: "missing" };

/** Logical pixel dimensions for native Bevy UI, distinct from virtual pointer units. */
declare function window_metrics(): { width: number; height: number };
