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
  imageMode?: "auto" | "stretch";
  imageTint?: UiColor;
}

interface UiElementBase {
  id: string;
  style?: UiStyle;
  children?: readonly UiElement[];
}

export interface UiContainerElement extends UiElementBase { kind: "node"; }
export interface UiTextElement extends UiElementBase {
  kind: "text";
  value: string;
  fontSize: number;
  color: UiColor;
  font?: string;
}
export interface UiImageElement extends UiElementBase { kind: "image"; path: string; }
export interface UiButtonElement extends UiElementBase { kind: "button"; onClick?: () => void; }
export type UiElement = UiContainerElement | UiTextElement | UiImageElement | UiButtonElement;
export interface UiTextOptions { style?: UiStyle; fontSize?: number; color?: UiColor; font?: string; }
export interface UiButtonOptions {
  style?: UiStyle;
  textStyle?: UiStyle;
  fontSize?: number;
  color?: UiColor;
  onClick?: () => void;
}

const buttonCallbacks = new Map<string, () => void>();
const mountedProperties = new Map<string, Map<string, string>>();
let mountedTopology = "";
let pointerActionHandled = false;
const defaultTextColor: UiColor = [1, 1, 1, 1];

export function node(id: string, style: UiStyle = {}, children: readonly UiElement[] = []): UiContainerElement {
  return { kind: "node", id, style, children };
}
export function row(id: string, style: UiStyle = {}, children: readonly UiElement[] = []): UiContainerElement {
  return node(id, { ...style, flexDirection: "row" }, children);
}
export function column(id: string, style: UiStyle = {}, children: readonly UiElement[] = []): UiContainerElement {
  return node(id, { ...style, flexDirection: "column" }, children);
}
export function text(id: string, value: string, options: UiTextOptions = {}): UiTextElement {
  return { kind: "text", id, value, style: options.style, fontSize: options.fontSize ?? 16, color: options.color ?? defaultTextColor, font: options.font };
}
export function image(id: string, path: string, style: UiStyle = {}): UiImageElement {
  return { kind: "image", id, path, style };
}
export function button(id: string, label: string, options: UiButtonOptions = {}): UiButtonElement {
  return {
    kind: "button",
    id,
    style: { alignItems: "center", justifyContent: "center", ...options.style },
    onClick: options.onClick,
    children: [text(`${id}__label`, label, { style: options.textStyle, fontSize: options.fontSize, color: options.color })],
  };
}
function requireUi(result: boolean, operation: string, id: string): void {
  if (!result) throw new Error(`Runeweave UI ${operation} failed for "${id}"`);
}
function syncProperty(id: string, property: string, value: string, write: () => boolean): void {
  const previous = mountedProperties.get(id);
  if (previous?.get(property) === value) return;
  requireUi(write(), property, id);
  previous?.set(property, value);
}
export function setUiStyle(id: string, style: UiStyle): void {
  const value = JSON.stringify(style);
  syncProperty(id, "style", value, () => ui_set_style(id, value));
}
function mountElement(element: UiElement, parentId: string): void {
  if (!mountedProperties.has(element.id)) {
    requireUi(ui_spawn(element.id, parentId, element.kind), "spawn", element.id);
    mountedProperties.set(element.id, new Map());
  }
  setUiStyle(element.id, element.style ?? {});
  if (element.kind === "text") {
    const [red, green, blue, alpha] = element.color;
    syncProperty(element.id, "text", JSON.stringify([element.value, element.fontSize, element.color]),
      () => ui_set_text(element.id, element.value, element.fontSize, red, green, blue, alpha));
    if (element.font) syncProperty(element.id, "font", element.font, () => ui_set_font(element.id, element.font!));
  } else if (element.kind === "image") {
    syncProperty(element.id, "image", element.path, () => ui_set_image(element.id, element.path));
  } else if (element.kind === "button" && element.onClick) {
    buttonCallbacks.set(element.id, element.onClick);
  }
  for (const child of element.children ?? []) mountElement(child, element.id);
}
export function mountUi(root: UiElement): void {
  const topology: unknown[] = [];
  const visit = (element: UiElement, parent: string): void => {
    // Native style writes are patches. A removed property needs fresh defaults.
    topology.push([element.id, parent, element.kind, element.kind === "text" && !!element.font,
      Object.entries(element.style ?? {}).filter(([, value]) => value !== undefined).map(([key]) => key).sort()]);
    for (const child of element.children ?? []) visit(child, element.id);
  };
  visit(root, "");
  const next = JSON.stringify(topology);
  // Changes to tree structure still rebuild once. Normal HUD updates keep the
  // same native entities and only write changed text/style/image properties.
  if (next !== mountedTopology) {
    ui_clear();
    mountedProperties.clear();
    mountedTopology = "";
  }
  buttonCallbacks.clear();
  mountElement(root, "");
  mountedTopology = next;
}
export function updateUi(): boolean {
  // A held pointer can press a replacement button again after a remount.
  // Keep the action latched until release, across rebuilds of the UI tree.
  const pointerPressed = input_primary_pointer().pressed;
  if (!pointerPressed) pointerActionHandled = false;
  if (pointerActionHandled) return false;
  // A callback may remount the UI and replace this map. Process one action
  // from the original tree, never newly mounted buttons in the same frame.
  for (const [id, callback] of [...buttonCallbacks]) {
    if (ui_button_just_pressed(id)) { pointerActionHandled = pointerPressed; callback(); return true; }
  }
  return false;
}
export function unmountUi(): void { buttonCallbacks.clear(); mountedProperties.clear(); mountedTopology = ""; ui_clear(); }
export function removeUi(id: string): boolean { buttonCallbacks.delete(id); mountedProperties.delete(id); mountedTopology = ""; return ui_despawn(id); }
