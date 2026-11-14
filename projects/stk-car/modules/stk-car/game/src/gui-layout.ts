import type { GuiNode } from "./menu-data-types.js";

export interface Rect { x: number; y: number; width: number; height: number; }
export interface GuiBox { node: GuiNode; rect: Rect; path: string; children: GuiBox[]; }
const labelTags = new Set(["label", "header", "small-header", "tiny-header", "bubble"]);
export function guiLength(value: string | undefined, span: number, scale: number): number | null {
  if (!value || value === "fit") return null;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, value.endsWith("%") ? span * number / 100 : value.endsWith("f") ? number * 24 * scale : number * scale);
}
function natural(node: GuiNode, horizontal: boolean, span: number, scale: number): number {
  const a = node.attributes;
  if (horizontal) {
    if (node.tag === "spacer") return 8 * scale;
    if (node.tag === "checkbox") return 28 * scale;
    if (["textbox", "spinner", "gauge"].includes(node.tag)) return 180 * scale;
    if (node.tag === "icon-button" || node.tag === "icon") return 70 * scale;
    if (labelTags.has(node.tag) || node.tag === "button") return Math.min(span, Math.max(50, [...(a.text ?? "")].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 18 : 9), 0) + 24) * scale);
    return span;
  }
  if (["header", "small-header", "tiny-header"].includes(node.tag)) return (node.tag === "header" ? 48 : 30) * scale;
  if (node.tag === "spacer") return 8 * scale;
  if (node.tag === "bubble") return 52 * scale;
  if (node.tag === "icon-button" || node.tag === "icon") return 70 * scale;
  if (["textbox", "button", "spinner", "gauge", "checkbox", "label"].includes(node.tag)) return 32 * scale;
  return 40 * scale;
}

/** STK's percent/pixel/font units and proportional rows, evaluated in logical window pixels. */
export function guiLayout(node: GuiNode, rect: Rect, scale = 1, path = "0"): GuiBox {
  const attrs = node.attributes, children: GuiBox[] = [];
  const layout = attrs.layout;
  if (layout !== "vertical-row" && layout !== "horizontal-row") {
    node.children.forEach((child, index) => {
      const a = child.attributes;
      const width = Math.min(rect.width, guiLength(a.width, rect.width, scale) ?? rect.width);
      const height = Math.min(rect.height, guiLength(a.height, rect.height, scale) ?? rect.height);
      const x = a.align === "center" ? (rect.width - width) / 2 : a.align === "right" ? rect.width - width : guiLength(a.x, rect.width, scale) ?? 0;
      const y = guiLength(a.y, rect.height, scale) ?? 0;
      children.push(guiLayout(child, { x: rect.x + x, y: rect.y + y, width, height }, scale, `${path}.${index}`));
    });
  } else {
    const horizontal = layout === "horizontal-row", main = horizontal ? rect.width : rect.height, cross = horizontal ? rect.height : rect.width;
    const sizes = node.children.map((child) => Number(child.attributes.proportion) > 0 ? 0 : guiLength(child.attributes[horizontal ? "width" : "height"], main, scale) ?? natural(child, horizontal, main, scale));
    const fixed = sizes.reduce((sum, size) => sum + size, 0), remaining = Math.max(0, main - fixed);
    const weight = node.children.reduce((sum, child) => sum + Math.max(0, Number(child.attributes.proportion) || 0), 0);
    const shrink = fixed > main ? main / fixed : 1;
    let cursor = 0;
    node.children.forEach((child, index) => {
      const a = child.attributes, proportion = Math.max(0, Number(a.proportion) || 0);
      const along = proportion && weight ? remaining * proportion / weight : sizes[index] * shrink;
      const across = Math.min(cross, guiLength(a[horizontal ? "height" : "width"], cross, scale) ?? (horizontal ? natural(child, false, cross, scale) : cross));
      const offset = a.align === "center" ? (cross - across) / 2 : a.align === "right" ? cross - across : 0;
      const x = rect.x + (horizontal ? cursor : offset), y = rect.y + (horizontal ? offset : cursor);
      children.push(guiLayout(child, { x, y, width: horizontal ? along : across, height: horizontal ? across : along }, scale, `${path}.${index}`));
      cursor += along;
    });
  }
  return { node, rect, path, children };
}
