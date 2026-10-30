export interface Profile {
  schemaVersion: 1;
  bestScore: number;
  runs: number;
  wins: number;
  bestTime: number;
  seed: number;
  sensitivity: number;
  showHints: boolean;
  reducedMotion: boolean;
}
export function defaultProfile(): Profile {
  return { schemaVersion: 1, bestScore: 0, runs: 0, wins: 0, bestTime: 0,
    seed: 1337, sensitivity: 1, showHints: true, reducedMotion: false };
}
export function parseProfile(raw: string): Profile {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid profile");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1) throw new Error("unsupported save version");
  for (const key of ["bestScore", "runs", "wins", "seed"]) {
    if (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0) throw new Error(`invalid ${key}`);
  }
  if ((data.wins as number) > (data.runs as number) || (data.seed as number) > 0xffffffff
    || typeof data.bestTime !== "number" || !Number.isFinite(data.bestTime) || data.bestTime < 0
    || ![0.75, 1, 1.25, 1.5].includes(data.sensitivity as number)
    || typeof data.showHints !== "boolean" || typeof data.reducedMotion !== "boolean") throw new Error("invalid settings");
  return { schemaVersion: 1, bestScore: data.bestScore as number, runs: data.runs as number,
    wins: data.wins as number, bestTime: data.bestTime, seed: data.seed as number,
    sensitivity: data.sensitivity as number, showHints: data.showHints, reducedMotion: data.reducedMotion };
}
