export function setWindowSize(width: number, height: number): boolean {
  return window_set_size(width, height);
}

export interface WindowSafeArea {
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

export function windowSafeArea(): WindowSafeArea {
  return window_safe_area();
}
