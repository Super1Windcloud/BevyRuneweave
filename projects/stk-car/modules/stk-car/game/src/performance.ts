export interface FrameMetrics { fps: number; frameMedianMs: number; frameP95Ms: number; scriptMeanMs: number; }

/** Real callback intervals, independent of the runtime's capped gameplay delta. */
export class FrameProfiler {
  private previous = 0;
  private windowStart: number | null = null;
  private frameStart = 0;
  private scriptTime = 0;
  private frames = 0;
  private intervals: number[] = [];
  begin(now: number): void {
    if (this.windowStart === null || now < this.previous) {
      this.windowStart = now; this.previous = now; this.frames = 0; this.scriptTime = 0; this.intervals = [];
    }
    if (now > this.previous) this.intervals.push(now - this.previous);
    this.previous = now; this.frameStart = now;
  }
  end(now: number): FrameMetrics | null {
    this.scriptTime += Math.max(0, now - this.frameStart); this.frames++;
    const elapsed = now - (this.windowStart ?? now);
    if (elapsed < 2000) return null;
    const sorted = this.intervals.sort((a, b) => a - b);
    const metrics = { fps: this.frames * 1000 / elapsed, frameMedianMs: sorted[Math.floor(sorted.length / 2)] ?? elapsed,
      frameP95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? elapsed,
      scriptMeanMs: this.scriptTime / this.frames };
    this.windowStart = now; this.frames = 0; this.scriptTime = 0; this.intervals = [];
    return metrics;
  }
}
