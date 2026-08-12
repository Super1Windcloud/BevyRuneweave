import {
  setSprite,
  setText,
  setTransform,
  spawnSceneEntity,
  type SpriteSpec,
} from "../../api/scene.js";
import type { PrimaryPointer } from "../../api/input.js";

export interface ColorSpec {
  red: number;
  green: number;
  blue: number;
}

export function spawnSprite(
  id: string,
  sprite: SpriteSpec,
  x = 0,
  y = 0,
  z = 0,
): void {
  spawnSceneEntity(id, { x, y, z });
  setSprite(id, sprite);
}

export function spawnText(id: string, x = 0, y = 0, z = 0): void {
  spawnSceneEntity(id, { x, y, z });
}

export function placeSprite(
  id: string,
  sprite: SpriteSpec,
  x: number,
  y: number,
  z: number,
): void {
  setTransform(id, { x, y, z });
  setSprite(id, sprite);
}

export function placeText(
  id: string,
  value: string,
  x: number,
  y: number,
  z: number,
  fontSize: number,
  color: ColorSpec,
): void {
  setTransform(id, { x, y, z });
  setText(id, { value, fontSize, ...color, alpha: 1, anchor: "center" });
}

export function pointerInside(
  pointer: PrimaryPointer,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): boolean {
  return Math.abs(pointer.x - centerX) <= width * 0.5
    && Math.abs(pointer.y - centerY) <= height * 0.5;
}

export const colors = {
  white: { red: 0.96, green: 0.98, blue: 1 },
  muted: { red: 0.66, green: 0.78, blue: 0.87 },
  gold: { red: 1, green: 0.82, blue: 0.22 },
  dark: { red: 0.16, green: 0.11, blue: 0.03 },
  blue: { red: 0.5, green: 0.83, blue: 1 },
  red: { red: 1, green: 0.61, blue: 0.64 },
} satisfies Record<string, ColorSpec>;
