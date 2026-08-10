export function keyPressed(key: string): boolean { return input_key_pressed(key); }
export function keyJustPressed(key: string): boolean { return input_key_just_pressed(key); }
export function keyJustReleased(key: string): boolean { return input_key_just_released(key); }

export interface PrimaryTouch {
  pressed: boolean;
  justPressed: boolean;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export function primaryTouch(): PrimaryTouch { return input_primary_touch(); }
