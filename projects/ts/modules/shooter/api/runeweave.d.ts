interface BmsReflectReference {
  get(key: string | number): unknown;
  set(key: string | number, value: unknown): void;
  call(name: string, ...args: unknown[]): unknown;
}

declare function scene_spawn(id: string, x: number, y: number, z: number): boolean;
declare function scene_set_sprite(
  id: string,
  path: string,
  width: number,
  height: number,
): boolean;
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
declare function scene_transform(id: string): BmsReflectReference | null;
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
