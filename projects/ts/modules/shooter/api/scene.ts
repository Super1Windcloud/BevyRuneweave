export interface ScriptTransform {
  x: number;
  y: number;
  z: number;
}

export interface SpriteSpec {
  path: string;
  width: number;
  height: number;
}

export interface TextSpec {
  value: string;
  fontSize: number;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  anchor: string;
}

export function clearScene(): void {
  scene_clear();
}

export function spawnSceneEntity(id: string, transform: ScriptTransform): boolean {
  return scene_spawn(id, transform.x, transform.y, transform.z);
}

export function setSprite(id: string, sprite: SpriteSpec): boolean {
  return scene_set_sprite(id, sprite.path, sprite.width, sprite.height);
}

export function setModel(id: string, path: string): boolean {
  return scene_set_model(id, path);
}

export function setTransform3d(
  id: string,
  transform: ScriptTransform,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  scale: number,
): boolean {
  return scene_set_transform_3d(
    id,
    transform.x,
    transform.y,
    transform.z,
    rotationX,
    rotationY,
    rotationZ,
    scale,
  );
}

export function playAnimation(id: string, path: string, repeat = true): boolean {
  return scene_play_animation(id, path, repeat);
}

export function set3dEnabled(enabled: boolean): boolean {
  return scene_set_3d_enabled(enabled);
}

export function setTransform(id: string, transform: ScriptTransform): boolean {
  return scene_set_transform(id, transform.x, transform.y, transform.z);
}

export function setText(id: string, text: TextSpec): boolean {
  return scene_set_text(
    id,
    text.value,
    text.fontSize,
    text.red,
    text.green,
    text.blue,
    text.alpha,
    text.anchor,
  );
}

export function despawnSceneEntity(id: string): boolean {
  return scene_despawn(id);
}

export function setGameState(score: number, lives: number, message: string): void {
  game_state_set(score, lives, message);
}
