import type { WindowSafeArea } from "../../api/window.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./config.js";

export interface ScreenLayout {
  viewportWidth: number;
  safeArea: WindowSafeArea;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scale: number;
}

export const FALLBACK_SAFE_AREA: WindowSafeArea = {
  left: -DESIGN_WIDTH * 0.5,
  right: DESIGN_WIDTH * 0.5,
  bottom: -DESIGN_HEIGHT * 0.5,
  top: DESIGN_HEIGHT * 0.5,
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  leftInset: 0,
  rightInset: 0,
  bottomInset: 0,
  topInset: 0,
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createScreenLayout(
  viewportWidth: number,
  safeArea: WindowSafeArea,
): ScreenLayout {
  const contentWidth = Math.min(DESIGN_WIDTH, viewportWidth, safeArea.width);
  const left = Math.max(-contentWidth * 0.5, safeArea.left);
  const right = Math.min(contentWidth * 0.5, safeArea.right);
  const width = Math.max(1, right - left);
  const height = Math.max(1, safeArea.height);
  return {
    viewportWidth,
    safeArea,
    left,
    right,
    top: safeArea.top,
    bottom: safeArea.bottom,
    width,
    height,
    centerX: (left + right) * 0.5,
    centerY: (safeArea.top + safeArea.bottom) * 0.5,
    scale: clamp(Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT), 0.68, 1),
  };
}

export function layoutKey(layout: ScreenLayout): string {
  return [
    layout.viewportWidth,
    layout.left,
    layout.right,
    layout.top,
    layout.bottom,
  ].map((value) => value.toFixed(1)).join(":");
}
