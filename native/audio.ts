// Sound, as the browser build's app.js audio: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, a variant picked at
// random (engine SoundBanks); the ambience (a 110 Hz sine wobbled ±12 Hz by a
// 0.13 Hz LFO on the old ambience bus) and, while a round is active, the quiet
// music plucks (every 1.4–2.6 s a seeded pentatonic sine, sometimes an
// octave-down second note). The runtime has no ambience bus, so the ambience
// plays on the music bus at the old ambience-to-effects ratio, the plucks at
// the music-to-effects ratio (the old buses at their default volumes: effects
// 0.4, music 0.125, ambience 0.06). The ambience loop and the notes are
// rendered once into clips (OfflineAudioContext); the carrier is 110.5 Hz so
// the 100/13 s loop closes on whole cycles. The synthesized stand-ins app.js
// played while a sample loaded are not ported: a clip still loading is silent.
// The runtime's Options own the volumes and the mute. Clips load and the
// renders run in onStart; only starting the ambience waits for the mixer (in a
// browser, the first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, SoundBank, type AudioClip, type Sound } from "starhermit:audio";
import { R } from "./game.ts";

const SFX: Record<string, string[]> = {
  select: ["ui-click", "vehicle-select"],
  dispatch: ["dispatch-depart"],
  "dispatch:boarded": ["passengers-board"],
  "dispatch:full": ["queue-full-depart"],
  mismatch: ["mismatch-sigh", "wrong-vehicle"],
  invalid: ["invalid-buzz", "move-denied"],
  win: ["win-jingle"],
  lose: ["lose-descend", "lose-overfill"],
};
export type Sfx = keyof typeof SFX;
const MUSIC_K = 0.125 / 0.4, AMB_K = (0.5 * 0.06) / 0.4;
const banks = new Map<string, SoundBank>();

export function play(ev: Sfx): void {
  try { banks.get(ev)?.play(); } catch { /* the mixer is full this frame: skip it */ }
}

// ---- rendered synthesis
const RATE = 22050;
/** app.js blip(): gain set at the start, exponential decay to 0.001 at `dur`, silence to the clip's end. */
async function renderBlip(freq: number, dur: number, vol: number, seconds: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(seconds * RATE), RATE);
  const osc = off.createOscillator(); osc.frequency.value = freq;
  const gain = off.createGain();
  gain.gain.setValueAtTime(vol, 0);
  gain.gain.exponentialRampToValueAtTime(0.001, dur);
  gain.gain.setValueAtTime(0, dur);
  osc.connect(gain).connect(off.destination); osc.start();
  return createClip(await off.startRendering());
}
/** One whole LFO period (100/13 s): 850 carrier cycles, so it loops without a seam. */
async function renderAmbience(): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round((100 / 13) * RATE), RATE);
  const osc = off.createOscillator(); osc.frequency.value = 110.5;
  const lfo = off.createOscillator(); lfo.frequency.value = 0.13;
  const depth = off.createGain(); depth.gain.value = 12;
  lfo.connect(depth).connect(osc.frequency);
  osc.connect(off.destination); osc.start(); lfo.start();
  return createClip(await off.startRendering());
}
const SCALE = [262, 294, 330, 392, 440, 523];
const notes = new Map<string, AudioClip>();
let ambClip: AudioClip | null = null;
const warn = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };

/** Loads every clip at once and renders the ambience and the notes (onStart). */
export function loadSfx(): void {
  const clips = new Map<string, Promise<AudioClip | null>>();
  const load = (name: string): Promise<AudioClip | null> => {
    let c = clips.get(name);
    if (!c) {
      c = loadClip(`sfx/${name}.opus`).catch((e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); return null; });
      clips.set(name, c);
    }
    return c;
  };
  for (const [ev, names] of Object.entries(SFX)) {
    void Promise.all(names.map(load)).then((loaded) => {
      const list = loaded.filter((c) => c !== null);
      if (list.length) banks.set(ev, new SoundBank({ clips: list, bus: "effects" }));
    });
  }
  renderAmbience().then((c) => { ambClip = c; }, warn);
  for (const f of SCALE) {
    renderBlip(f, 0.5, 0.1, 0.52).then((c) => { notes.set(`a${f}`, c); }, warn);
    renderBlip(f / 2, 0.8, 0.08, 0.82).then((c) => { notes.set(`b${f}`, c); }, warn);
  }
}

// ---- the music plucks (app.js startMusic: seeded 20260829, only while a round is active)
const rr = R.rng(20260829);
let nextAt = 0;
let ambVoice: Sound | null = null;
/** The plucks on the fixed-step clock (seconds); `active`: a round is being played. */
export function tick(now: number, active: boolean): void {
  if (now < nextAt || context.state !== "running") return;
  if (active) {
    const a = notes.get(`a${SCALE[Math.floor(rr() * SCALE.length)]}`);
    if (a) try { playClip(a, { bus: "music", gain: MUSIC_K }); } catch { /* busy */ }
    if (rr() < 0.3) {
      const b = notes.get(`b${SCALE[Math.floor(rr() * SCALE.length)]}`);
      if (b) try { playClip(b, { bus: "music", gain: MUSIC_K }); } catch { /* busy */ }
    }
  }
  nextAt = now + 1.4 + rr() * 1.2;
}

/** Each frame, once the mixer runs: the ambience voice. */
export function update(): void {
  if (context.state !== "running") return;
  if (ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB_K, loop: true }); } catch { ambVoice = null; }
  }
}
