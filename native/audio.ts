// Sound, as the browser build's app.js audio: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, a variant picked at
// random; the ambience (a 110 Hz sine wobbled ±12 Hz by a 0.13 Hz LFO on the
// old ambience bus) and, while a round is active, the quiet music plucks
// (every 1.4–2.6 s a seeded pentatonic sine, sometimes an octave-down second
// note). The runtime has no ambience bus, so the ambience plays on the
// music bus at the old ambience-to-effects ratio, the plucks at the
// music-to-effects ratio (the old buses at their default volumes: effects
// 0.4, music 0.125, ambience 0.06). The ambience loop and the notes are
// rendered once into clips (a sine table, a slice a frame); the carrier is
// 110.5 Hz so the 100/13 s loop closes on whole cycles. The synthesized
// stand-ins app.js played while a sample loaded are not ported (a live
// synthesis graph makes clip loads fail on the web): a clip still loading
// is silent. The runtime's Options own the volumes and the mute. Clips load
// once the mixer runs, one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
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
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let pick = 1;

export function loadSfx(): void { wantClips = true; }
export function play(ev: Sfx): void {
  const names = SFX[ev]!;
  pick = (pick * 1103515245 + 12345) >>> 0;
  const name = names[(pick >>> 16) % names.length]!;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// ---- rendered synthesis
const RATE = 22050;
const TABLE_N = 4096;
const SINE = new Float32Array(TABLE_N + 1);
for (let i = 0; i <= TABLE_N; i++) SINE[i] = Math.sin((i / TABLE_N) * Math.PI * 2);
const sineAt = (phase: number): number => { const p = (phase - Math.floor(phase)) * TABLE_N; const i = p | 0; return SINE[i]! + (SINE[i + 1]! - SINE[i]!) * (p - i); };
interface Job { data: Float32Array; pos: number; fill: (i: number) => number; done: (c: AudioClip) => void }
const jobs: Job[] = [];
function job(n: number, fill: (i: number) => number, done: (c: AudioClip) => void): void { jobs.push({ data: new Float32Array(n), pos: 0, fill, done }); }
/** app.js blip(): gain set at the start, exponential decay to 0.001 at `dur`. */
function blipFill(freq: number, dur: number, vol: number): (i: number) => number {
  const n = Math.round(dur * RATE), k = Math.pow(0.001 / vol, 1 / n);
  let env = vol;
  return (i) => { const v = sineAt((freq * i) / RATE) * env; env *= k; return i < n ? v : 0; };
}
const SCALE = [262, 294, 330, 392, 440, 523];
const notes = new Map<string, AudioClip>();
let ambClip: AudioClip | null = null;
let queued = false;
function queueSynthesis(): void {
  if (queued) return;
  queued = true;
  const L = 100 / 13, n = Math.round(L * RATE), f0 = 110.5, depth = 12, lfo = 0.13;
  job(n, (i) => {
    const t = i / RATE;
    const ph = f0 * t - (depth / (2 * Math.PI * lfo)) * (Math.cos(2 * Math.PI * lfo * t) - 1);
    return sineAt(ph);
  }, (c) => { ambClip = c; });
  for (const f of SCALE) {
    job(Math.round(RATE * 0.52), blipFill(f, 0.5, 0.1), (c) => notes.set(`a${f}`, c));
    job(Math.round(RATE * 0.82), blipFill(f / 2, 0.8, 0.08), (c) => notes.set(`b${f}`, c));
  }
}
function runJobs(budget: number): void {
  let left = budget;
  while (jobs.length && left > 0) {
    const j = jobs[0]!;
    const end = Math.min(j.data.length, j.pos + left);
    for (let i = j.pos; i < end; i++) j.data[i] = j.fill(i);
    left -= end - j.pos;
    j.pos = end;
    if (j.pos >= j.data.length) {
      jobs.shift();
      try { j.done(createClip([j.data], RATE)); } catch (e) { console.warn(`audio: ${String(e)}`); }
    }
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

/** Each frame: the clips once the mixer runs (one at a time), the synthesis slices, the ambience voice. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    queueSynthesis();
    for (const list of Object.values(SFX)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
  }
  runJobs(5000);
  if (ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB_K, loop: true }); } catch { ambVoice = null; }
  }
}
