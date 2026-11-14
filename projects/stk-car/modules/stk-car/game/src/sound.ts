import { clamp } from "./race.js";
import type { PcSession } from "./session.js";
import { trackData } from "./track-data.js";

let effectVolume = 0.7, effectIndex = 0;
export function menuSound(name: string): void {
  if (effectVolume > 0) audio_play(`effect-${effectIndex++ % 12}`, `audio/sfx/${name}.ogg`, false, effectVolume);
}

/** Gameplay events select sounds; the native BMS API owns decoding, sinks and device focus. */
export class GameAudio {
  private music = "";
  private musicVolume = -1;
  private paused = false;
  private engine = false;
  private nitro = false;
  private skid = false;
  private phase = "";
  private countdown = 0;
  private elapsed = 0;
  private nitroReserve = 0;
  private item = false;
  private stunned = false;
  private clock = 0;
  private stateClock = 0;
  private reported = "";
  reset(): void { audio_clear(); this.music = ""; this.engine = false; this.nitro = false; this.skid = false; this.phase = ""; this.clock = 0; this.elapsed = 0; }
  update(session: PcSession, dt: number): void {
    const { settings, race, screen } = session, player = race.player;
    effectVolume = settings.sfxVolume;
    const inRace = screen === "race" || screen === "paused" || ["options", "help"].includes(screen) && session.returnScreen === "paused";
    const paused = inRace && screen !== "race";
    const pauseChanged = this.paused !== paused;
    const music = screen === "finished" ? race.ranking[0] === player ? trackData.audio.result : trackData.audio.lose : inRace ? trackData.audio.race : trackData.audio.menu;
    if (music !== this.music) {
      this.music = music; this.musicVolume = settings.musicVolume; this.paused = paused;
      audio_play("music", music, true, settings.musicVolume); audio_update("music", settings.musicVolume, 1, paused);
    } else if (this.musicVolume !== settings.musicVolume || this.paused !== paused) {
      this.musicVolume = settings.musicVolume; this.paused = paused;
      audio_update("music", settings.musicVolume, 1, paused);
    }
    if (inRace && race.elapsed < this.elapsed) this.phase = "";
    if (screen === "race") {
      const count = Math.ceil(race.countdown);
      if (race.phase === "countdown" && (this.phase !== "countdown" || count !== this.countdown)) menuSound("pre_start_race");
      if (race.phase === "racing" && this.phase === "countdown") menuSound("start_race");
      if (race.phase === "racing" && player.nitro > this.nitroReserve + 0.5) menuSound("energy_bar_full");
      if (player.item && !this.item) menuSound("grab_collectable");
      if (player.stun > 0 && !this.stunned) menuSound("crash");
      this.countdown = count; this.phase = race.phase; this.nitroReserve = player.nitro; this.item = player.item; this.stunned = player.stun > 0;
    } else if (screen === "finished" && this.phase !== "finished") { menuSound("race_finish"); this.phase = "finished"; }
    this.elapsed = race.elapsed;
    const loop = (id: "engine" | "nitro" | "skid", active: boolean, source: string, gain: number, speed: number) => {
      if (active && !this[id]) audio_play(id, `audio/sfx/${source}.ogg`, true, settings.sfxVolume * gain);
      if (!active && this[id]) audio_stop(id);
      this[id] = active;
      if (active) audio_update(id, settings.sfxVolume * gain, speed, paused);
    };
    this.clock += dt;
    if (this.clock >= 0.1 || inRace !== this.engine || pauseChanged) {
      this.clock = 0;
      loop("engine", inRace, "engine_small", 0.3, clamp(0.65 + Math.abs(player.speed) / 30, 0.65, 2));
      loop("nitro", inRace && player.boost > 0, "nitro", 0.45, 1);
      loop("skid", inRace && player.driftCharge > 0.2, "skid", 0.3, 1);
    }
    this.stateClock += dt;
    if (this.stateClock >= 2) {
      this.stateClock = 0;
      const state = audio_state("music"), failure = `${music}:${state}`;
      if (["playing", "error", "unavailable"].includes(state) && this.reported !== failure) { console.log(`[stk-audio] ${failure}`); this.reported = failure; }
    }
  }
}
