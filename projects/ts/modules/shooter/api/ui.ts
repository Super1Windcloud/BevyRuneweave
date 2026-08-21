export type UiLength = number | `${number}px` | `${number}%` | "auto";
export type UiColor = readonly [red: number, green: number, blue: number, alpha: number];

export interface UiStyle {
  width?: UiLength;
  height?: UiLength;
  minWidth?: UiLength;
  minHeight?: UiLength;
  maxWidth?: UiLength;
  maxHeight?: UiLength;
  left?: UiLength;
  right?: UiLength;
  top?: UiLength;
  bottom?: UiLength;
  flexDirection?: "row" | "row-reverse" | "column" | "column-reverse";
  alignItems?: "start" | "end" | "center" | "stretch" | "baseline";
  justifyContent?: "start" | "end" | "center" | "space-between" | "space-around" | "space-evenly";
  position?: "relative" | "absolute";
  display?: "flex" | "none";
  gap?: UiLength;
  rowGap?: UiLength;
  columnGap?: UiLength;
  padding?: UiLength;
  margin?: UiLength;
  borderRadius?: UiLength;
  flexGrow?: number;
  flexShrink?: number;
  background?: UiColor;
}

interface UiElementBase {
  id: string;
  style?: UiStyle;
  children?: readonly UiElement[];
}

export interface UiContainerElement extends UiElementBase {
  kind: "node";
}

export interface UiTextElement extends UiElementBase {
  kind: "text";
  value: string;
  fontSize: number;
  color: UiColor;
}

export interface UiImageElement extends UiElementBase {
  kind: "image";
  path: string;
}

export interface UiButtonElement extends UiElementBase {
  kind: "button";
  onClick?: () => void;
}

export type UiElement = UiContainerElement | UiTextElement | UiImageElement | UiButtonElement;

export interface UiTextOptions {
  style?: UiStyle;
  fontSize?: number;
  color?: UiColor;
}

export interface UiButtonOptions {
  style?: UiStyle;
  textStyle?: UiStyle;
  fontSize?: number;
  color?: UiColor;
  onClick?: () => void;
}

const buttonCallbacks = new Map<string, () => void>();
const defaultTextColor: UiColor = [1, 1, 1, 1];

export function node(
  id: string,
  style: UiStyle = {},
  children: readonly UiElement[] = [],
): UiContainerElement {
  return { kind: "node", id, style, children };
}

export function row(
  id: string,
  style: UiStyle = {},
  children: readonly UiElement[] = [],
): UiContainerElement {
  return node(id, { ...style, flexDirection: "row" }, children);
}

export function column(
  id: string,
  style: UiStyle = {},
  children: readonly UiElement[] = [],
): UiContainerElement {
  return node(id, { ...style, flexDirection: "column" }, children);
}

export function text(id: string, value: string, options: UiTextOptions = {}): UiTextElement {
  return {
    kind: "text",
    id,
    value,
    style: options.style,
    fontSize: options.fontSize ?? 16,
    color: options.color ?? defaultTextColor,
  };
}

export function image(id: string, path: string, style: UiStyle = {}): UiImageElement {
  return { kind: "image", id, path, style };
}

export function button(id: string, label: string, options: UiButtonOptions = {}): UiButtonElement {
  return {
    kind: "button",
    id,
    style: {
      alignItems: "center",
      justifyContent: "center",
      ...options.style,
    },
    onClick: options.onClick,
    children: [
      text(`${id}__label`, label, {
        style: options.textStyle,
        fontSize: options.fontSize,
        color: options.color,
      }),
    ],
  };
}

function requireUi(result: boolean, operation: string, id: string): void {
  if (!result) throw new Error(`Runeweave UI ${operation} failed for "${id}"`);
}

function mountElement(element: UiElement, parentId: string): void {
  requireUi(ui_spawn(element.id, parentId, element.kind), "spawn", element.id);
  if (element.style) {
    requireUi(ui_set_style(element.id, JSON.stringify(element.style)), "style", element.id);
  }
  if (element.kind === "text") {
    const [red, green, blue, alpha] = element.color;
    requireUi(
      ui_set_text(element.id, element.value, element.fontSize, red, green, blue, alpha),
      "text",
      element.id,
    );
  } else if (element.kind === "image") {
    requireUi(ui_set_image(element.id, element.path), "image", element.id);
  } else if (element.kind === "button" && element.onClick) {
    buttonCallbacks.set(element.id, element.onClick);
  }
  for (const child of element.children ?? []) mountElement(child, element.id);
}

export function mountUi(root: UiElement): void {
  ui_clear();
  buttonCallbacks.clear();
  mountElement(root, "");
}

export function updateUi(): void {
  for (const [id, callback] of buttonCallbacks) {
    if (ui_button_just_pressed(id)) callback();
  }
}

export function unmountUi(): void {
  buttonCallbacks.clear();
  ui_clear();
}

export function removeUi(id: string): boolean {
  buttonCallbacks.delete(id);
  return ui_despawn(id);
}
