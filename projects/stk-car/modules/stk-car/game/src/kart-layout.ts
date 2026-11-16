import type { Layout } from "./controls.js";
import { guiLayout, type GuiBox, type Rect } from "./gui-layout.js";
import { menuData } from "./menu-data.js";
import type { GuiNode } from "./menu-data-types.js";

export function menuGeometry(layout: Layout): { rect: Rect; scale: number } {
  const rect = layout.mobile ? { x: layout.left, y: layout.top, width: layout.width - layout.left - layout.right, height: layout.height - layout.top - layout.bottom } : { x: 0, y: 0, width: layout.width, height: layout.height };
  return { rect, scale: Math.max(layout.mobile ? 0.85 : 0.5, Math.min(1.4, rect.width / 1280, rect.height / 720)) };
}

/** STK reserves Continue for touchscreens; desktop validates the kart itself. */
export function kartMenuSource(): GuiNode {
  const filter = (node: GuiNode): GuiNode => ({ ...node, children: node.children.filter((child, index, children) => child.attributes.id !== "continue" && !(child.tag === "spacer" && children[index + 1]?.attributes.id === "continue")).map(filter) });
  return filter(menuData.pages.karts);
}

export function playerKartRects(area: Rect, scale: number): { player: Rect; model: Rect; name: Rect } {
  const line = Math.min(28 * scale, area.height / 4), side = Math.max(1, Math.min(area.width / 2, area.height - line * 2));
  return {
    player: { x: area.x + area.width / 2 - 120 * scale, y: area.y, width: 240 * scale, height: line },
    model: { x: area.x + area.width / 4 - side / 2, y: area.y + (area.height - side) / 2, width: side, height: side },
    name: { x: area.x, y: area.y + area.height - line, width: area.width, height: line },
  };
}

export function kartPreviewRect(layout: Layout): Rect {
  if (layout.mobile) return { x: layout.left, y: layout.top + 48, width: layout.width - layout.left - layout.right, height: Math.max(1, layout.height - layout.top - layout.bottom - 160) };
  const { rect, scale } = menuGeometry(layout);
  const find = (box: GuiBox): GuiBox | undefined => box.node.attributes.id === "playerskarts" ? box : box.children.map(find).find(Boolean);
  return playerKartRects(find(guiLayout(kartMenuSource(), rect, scale))!.rect, scale).model;
}

export function kartPreviewBasis(): { forward: number[]; right: number[]; up: number[] } {
  const direction = [2.5, 1, 3.6], length = Math.hypot(...direction), horizontal = Math.hypot(direction[0], direction[2]);
  const right = [direction[2] / horizontal, 0, -direction[0] / horizontal];
  const up = [-direction[0] * direction[1] / (horizontal * length), horizontal / length, -direction[2] * direction[1] / (horizontal * length)];
  return { forward: direction.map((value) => -value / length), right, up };
}

/** Translate the full-window camera along its image plane to frame the source widget. */
export function kartPreviewCamera(layout: Layout): number[] {
  const rect = kartPreviewRect(layout), fov = 32, distance = 4.2 * layout.height / Math.max(1, rect.height);
  const { forward, right, up } = kartPreviewBasis();
  const units = 2 * distance * Math.tan(fov * Math.PI / 360) / layout.height;
  const dx = (layout.width / 2 - rect.x - rect.width / 2) * units, dy = (rect.y + rect.height / 2 - layout.height / 2) * units;
  const target = right.map((value, axis) => value * dx + up[axis] * dy + (axis === 1 ? 0.45 : 0));
  return [...target.map((value, axis) => value - forward[axis] * distance), ...target, fov];
}

export function kartBackdropTransform(layout: Layout, camera: number[]): number[] {
  const { forward } = kartPreviewBasis(), depth = 100;
  const height = 2 * depth * Math.tan(camera[6] * Math.PI / 360);
  // The original background is 2:1. Cover the window without skewing the checks.
  return [...forward.map((value, axis) => camera[axis] + value * depth), 0, 0, 0, height * Math.max(1, layout.width / layout.height / 2)];
}
