export const stepSeconds = 0.16;
export interface RenderPoint { x: number; y: number }

// Presentation-only waypoints. Gameplay still reads the actor's real Bevy
// Transform, which has already reached the destination grid cell.
export class SpriteMotion {
  private points: RenderPoint[];
  private elapsed = 0;

  constructor(from: RenderPoint, to: RenderPoint) { this.points = [from, to]; }

  get target(): RenderPoint { return this.points[this.points.length - 1]!; }
  get finished(): boolean { return this.elapsed >= stepSeconds; }
  get position(): RenderPoint {
    const progress = Math.min(1, this.elapsed / stepSeconds) * (this.points.length - 1);
    const index = Math.min(this.points.length - 2, Math.floor(progress));
    const from = this.points[index]!, to = this.points[index + 1]!, fraction = progress - index;
    return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  }

  retarget(to: RenderPoint): void {
    const segment = Math.floor(Math.min(1, this.elapsed / stepSeconds) * (this.points.length - 1));
    this.points = [this.position, ...this.points.slice(segment + 1), to];
    this.elapsed = 0;
  }

  advance(seconds: number): void { this.elapsed = Math.min(stepSeconds, this.elapsed + Math.max(0, seconds)); }
}
