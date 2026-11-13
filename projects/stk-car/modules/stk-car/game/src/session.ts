import { Circuit, Race, clamp } from "./race.js";
import { trackData } from "./track-data.js";

export type Screen = "main" | "kart" | "setup" | "tracks" | "track-info" | "options" | "help" | "race" | "paused" | "finished";
export interface Settings { kartId: string; difficulty: number; mode: "normal" | "time-trial"; laps: number; aiCount: number; reverse: boolean; wasd: boolean; }
export const defaultSettings = (): Settings => ({ kartId: "tux", difficulty: 1, mode: "normal", laps: trackData.defaultLaps, aiCount: 3, reverse: false, wasd: false });
export function parseSettings(value: string): Settings {
  const defaults = defaultSettings();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const data = parsed as Record<string, unknown>;
    for (const key of ["laps", "difficulty", "aiCount"] as const) if (typeof data[key] === "number" && Number.isFinite(data[key])) defaults[key] = clamp(Math.floor(data[key]), key === "laps" ? 1 : 0, key === "laps" ? 20 : 3);
    if (trackData.karts.some((kart) => kart.id === data.kartId)) defaults.kartId = data.kartId as string;
    if (data.mode === "normal" || data.mode === "time-trial") defaults.mode = data.mode;
    if (typeof data.reverse === "boolean") defaults.reverse = data.reverse;
    if (typeof data.wasd === "boolean") defaults.wasd = data.wasd;
  } catch { /* Preserve defaults for invalid or old saved values. */ }
  return defaults;
}
export class PcSession {
  screen: Screen = "main";
  returnScreen: Screen = "main";
  settings = defaultSettings();
  race = new Race(new Circuit(trackData.route), trackData.pickups, trackData.defaultLaps);
  best = 0;
  get bestKey(): string { return `pc-lighthouse-${this.settings.mode}-${this.settings.laps}-${this.settings.reverse ? "reverse" : "forward"}-${this.settings.difficulty}`; }
  start(): void {
    const route = this.settings.reverse ? [...trackData.route].reverse() : trackData.route;
    this.race = new Race(new Circuit(route), trackData.pickups, this.settings.laps, this.settings);
    this.race.start(); this.screen = "race";
  }
  back(): void {
    const previous: Partial<Record<Screen, Screen>> = { kart: "main", setup: "kart", tracks: "setup", "track-info": "tracks", paused: "race", finished: "track-info", race: "paused" };
    this.screen = this.screen === "options" || this.screen === "help" ? this.returnScreen : previous[this.screen] ?? "main";
  }
  open(screen: "options" | "help"): void { this.returnScreen = this.screen; this.screen = screen; }
}
