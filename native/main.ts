// Transit Tangle on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (rules.js) are the browser build's,
// unchanged; this module is what app.js did around them — the flow (title →
// setup / journey / help / settings / scores → preparing (3-2-1) → a round
// ⇄ pause → results), every mode (Learn's three lessons, Journey's 40
// stages, the Daily, Practice by difficulty, Challenge), selecting a vehicle
// and dispatching it to a queue by pointer, touch, keys and pads, undo
// (unranked modes and Journey), the hint (searched on a worker), the
// lesson coach, the results with achievements, the streak, stage progress
// and the leaderboard post of ranked rounds, and the lifecycle (a hidden
// window pauses the round, as visibilitychange did). Screens are drawn by
// screens.ts (starhermit:ui), the plaza by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: the countdown, toasts and the music
// plucks run on a clock advanced 1/60 s per fixed step.
import { frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate, clipboard } from "starhermit:engine";
import { bindings, onAction, onPointerButton, onTouch, primaryPointer, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { R, type Cfg, type Events, type Score, type State } from "./game.ts";
import * as audio from "./audio.ts";
import * as hint from "./hint.ts";
import { S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Mode = "journey" | "daily" | "practice" | "challenge" | "learn";
export type Screen = "title" | "setup" | "journey" | "preparing" | "active" | "paused" | "results" | "help" | "settings" | "scores";
export interface Results {
  sc: Score; won: boolean; newAch: string[]; submitted: { key: string; vars?: Record<string, string> } | null;
  lb: platform.Posted | "posting" | null; reason: string | null; mode: Mode; stage: number; lesson: number; usedAssist: boolean;
}
export type BoardView = { entries: platform.BoardRow[] } | { error: true } | { local: true } | null;

export const session = {
  screen: "title" as Screen,
  mode: null as Mode | null, cfg: null as Cfg | null, state0: null as State | null, state: null as State | null,
  commands: [] as { v: number; q: number }[], undoStack: [] as State[], selectedVehicle: -1,
  stage: 0, lesson: 0, difficulty: "normal", seed: 1, undoAllowed: false, ranked: false, usedAssist: false,
};
export const app = {
  openedFrame: 0,
  focusNext: null as string | null,
  helpReturn: "title" as Screen, settingsReturn: "title" as Screen,
  setupMode: null as "practice" | "challenge" | null,
  results: null as Results | null,
  board: null as BoardView,
  scoresTab: "journey" as "journey" | "challenge" | "daily",
  toast: null as { text: string; until: number } | null,
  countdown: 0,
  countdownAt: 0,
  coachStep: 0,
  coachCollapsed: false,
  coachShown: false,
  mirrorOpen: false,
  kbIndex: 0,
  keyNav: false,
  hintPending: false,
};
let clockMs = 0;
export const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
export const status = (): string => (session.state ? session.state.status : "idle");

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** #live (assertive): one announcement a frame (the newest). */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).pop()!.slice(0, 500);
  try { ui.announce(text, { politeness: "assertive" }); } catch { /* busy */ }
}
export function toast(text: string, ms = 1500): void { app.toast = { text, until: now() + ms / 1000 }; }
function caption(key: string, vars?: Record<string, string | number>): void { if (platform.options.captions) toast(T(key, vars), 900); }
export function haptic(ms: number): void { try { vibrate(ms); } catch { /* none */ } }
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built. */
export function later(fn: () => void): void { pending.push(fn); }
export const COLOR_KEYS = ["colorAmber", "colorBlue", "colorCoral", "colorGreen", "colorViolet"];
export const colorName = (c: number): string => T(COLOR_KEYS[c - 1]!);
const remaining = (s: State): number => s.q.reduce((a, l) => a + l.length, 0) + s.h.length;

// ------------------------------------------------------------------ screens
export function setScreen(name: Screen, focus: string | null = null): void {
  session.screen = name;
  app.openedFrame = frame().frame;
  const coarse = primaryPointer() === "coarse" || frame().width / ui.preferences().scale < 600;
  app.focusNext = focus ?? (coarse ? null : firstFocus(name));
  ui.setFocus(null);
}
function firstFocus(s: Screen): string | null {
  switch (s) {
    case "title": return "btn-play";
    case "setup": return app.setupMode === "practice" ? "diff-easy" : "btn-setup-start";
    case "journey": return `stage-${Math.min(R.JOURNEY_STAGES - 1, platform.progress().progress.journeyUnlocked) + 1}`;
    case "paused": return "btn-resume";
    case "results": return "btn-results-next";
    case "help": return "btn-help-close";
    case "settings": return "btn-settings-close";
    case "scores": return "btn-scores-close";
    default: return null;
  }
}

// ------------------------------------------------------------------ rounds (app.js session)
export function utcDateInt(ms = platform.nowMs()): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
let rngState = 0x9e3779b9;
function randomSeed(): number {
  rngState = (rngState + Math.floor(platform.nowMs())) >>> 0;
  const r = R.rng(rngState);
  rngState = (r() * 0xffffffff) >>> 0;
  return (r() * 0xffffffff) >>> 0;
}
export function startRound(mode: Mode, opts: { stage?: number; difficulty?: string; seed?: number; lesson?: number } = {}): void {
  const prog = platform.progress().progress;
  session.mode = mode;
  session.ranked = mode === "daily" || mode === "challenge" || mode === "journey";
  session.undoAllowed = mode === "practice" || mode === "learn" || mode === "journey";
  session.usedAssist = false;
  if (mode === "journey") {
    session.stage = opts.stage != null ? opts.stage : prog.journeyUnlocked;
    session.cfg = R.journeyConfig(session.stage);
  } else if (mode === "daily") session.cfg = R.dailyConfig(utcDateInt());
  else if (mode === "practice") {
    session.difficulty = opts.difficulty || session.difficulty;
    session.seed = opts.seed != null ? opts.seed : randomSeed();
    session.cfg = R.practiceConfig(session.difficulty, session.seed);
  } else if (mode === "challenge") {
    session.seed = opts.seed != null ? opts.seed : utcDateInt();
    session.cfg = R.challengeConfig(session.seed);
  } else {
    session.lesson = opts.lesson != null ? opts.lesson : 0;
    session.cfg = R.tutorialConfig(session.lesson);
  }
  session.state0 = R.genLevel(session.cfg);
  session.state = R.clone(session.state0);
  session.commands = []; session.undoStack = [];
  session.selectedVehicle = -1;
  app.results = null;
  app.kbIndex = 0;
  app.coachShown = false;
  hint.cancel();
  app.hintPending = false;
  render.setRound(session.state, session.cfg.theme);
  setScreen("preparing");
  const go = (): void => {
    setScreen("active");
    if (mode === "learn") coachFor(0); else app.coachShown = false;
    announce(describeBoard(session.state!));
  };
  if (preferences().reducedMotion) { app.countdown = 0; go(); return; }
  app.countdown = 3;
  app.countdownAt = now() + 0.65;
  announce(T("getReady"));
  countdownDone = go;
}
let countdownDone: (() => void) | null = null;
function stepCountdown(): void {
  if (session.screen !== "preparing" || !app.countdown || now() < app.countdownAt) return;
  app.countdown--;
  app.countdownAt = now() + 0.65;
  if (app.countdown <= 0) { const fn = countdownDone; countdownDone = null; fn?.(); }
}

const REASONS: Record<string, string> = {
  "no-such-vehicle": "rsnNoVehicle", "not-active": "rsnNotActive", "no-such-queue": "rsnNoQueue",
  "vehicle-depleted": "rsnDepleted", "queue-empty": "rsnQueueEmpty",
};
const reasonText = (r: string): string => (REASONS[r] ? T(REASONS[r]!) : r);
function sfxDispatch(boards: number, full: boolean): void {
  audio.play(full ? "dispatch:full" : boards > 0 ? "dispatch:boarded" : "dispatch");
  if (boards > 0) caption("capBoarded", { n: boards }); else caption("capDispatch");
}
export function commitDispatch(vi: number, qi: number): void {
  if (session.screen !== "active" || !session.state) return;
  const before = session.state;
  const r = R.dispatch(before, vi, qi);
  session.state = r.state;
  hint.cancel(); app.hintPending = false;
  if (!r.ok) {
    audio.play("invalid"); haptic(30);
    caption("capInvalid");
    toast(reasonText(r.reason!), 1600);
    announce(T("notAllowed", { reason: reasonText(r.reason!) }));
    return;
  }
  session.commands.push({ v: vi, q: qi });
  if (session.undoAllowed) {
    session.undoStack.push(before);
    if (session.undoStack.length > 60) session.undoStack.shift();
  }
  session.selectedVehicle = -1;
  app.kbIndex = 0;
  const ev = r.events!;
  if (ev.match) sfxDispatch(ev.boarded.length, ev.full); else { audio.play("mismatch"); caption("capMismatch"); }
  haptic(ev.match ? 15 : 40);
  render.sync(session.state, -1, ev);
  announceEvent(ev, r.state);
  if (session.mode === "learn") coachAdvance(ev, r.state);
  if (r.state.status !== "active") endRound(r.state);
}
export function undo(): void {
  if (!session.undoAllowed || session.screen !== "active" || !session.undoStack.length) {
    toast(T(session.undoAllowed ? "nothingToUndo" : "undoRanked"), 1400);
    return;
  }
  session.state = session.undoStack.pop()!;
  session.commands.pop();
  session.selectedVehicle = -1;
  session.usedAssist = true;
  hint.cancel(); app.hintPending = false;
  audio.play("select"); caption("capSelect");
  render.sync(session.state, -1);
  announce(T("undone", { board: describeBoard(session.state) }));
}
export function doHint(): void {
  if (session.screen !== "active" || !session.state || app.hintPending) return;
  const s = session.state;
  app.hintPending = true;
  hint.request(s, (h) => {
    app.hintPending = false;
    if (session.state !== s || session.screen !== "active") return;
    if (!h) { toast(T("noHint"), 1200); return; }
    session.usedAssist = true;
    const veh = s.v[h.v]!, lane = s.q[h.q]!;
    const msg = T(lane[0] === veh.c ? "hintMatch" : "hintMismatch", { color: colorName(veh.c), n: h.q + 1 });
    toast(msg, 3200);
    announce(T("hintAnnounce", { msg }));
    audio.play("select"); // no "select" text cue: in the browser build it replaced the hint's toast at once
  });
}

function endRound(fin: State): void {
  const sc = R.scoreComponents(fin);
  const won = fin.status === "won";
  audio.play(won ? "win" : "lose");
  caption(won ? "capWin" : "capLose");
  const save = platform.progress(), p = save.progress;
  const today = utcDateInt();
  if (!p.daysPlayed.includes(today)) p.daysPlayed.push(today);
  const newAch: string[] = [];
  const award = (key: string, label: string): void => { if (!save.achievements.includes(key)) { save.achievements.push(key); newAch.push(label); } };
  if (won) {
    p.wins++; p.streak++;
    award("first_completion", "achFirst");
    if (p.streak >= 3) award("streak_3", "achStreak3");
    if (p.daysPlayed.length >= 7) award("regular_commuter", "achRegular");
    if (session.mode === "journey") {
      if (!p.journeyDone.includes(session.stage)) p.journeyDone.push(session.stage);
      if (session.stage >= p.journeyUnlocked && session.stage < R.JOURNEY_STAGES - 1) p.journeyUnlocked = session.stage + 1;
      if (session.stage >= 19) award("mechanic_mastery", "achMastery");
      if (session.stage >= 35) award("milestone_hard", "achMilestone");
    }
  } else p.streak = 0;
  if (session.mode === "learn" && session.lesson >= 2) { p.tutorialDone = true; award("tutorial_done", "achTutorial"); }
  if (won && session.ranked) {
    const bk = session.mode!;
    if (p.best[bk] == null || sc.total > p.best[bk]!) p.best[bk] = sc.total;
  }
  platform.persist();
  let submitted: Results["submitted"] = null;
  const res: Results = { sc, won, newAch, submitted, lb: null, reason: fin.reason, mode: session.mode!, stage: session.stage, lesson: session.lesson, usedAssist: session.usedAssist };
  if (session.ranked && platform.signedIn()) {
    submitted = { key: "signedInBest", vars: { name: platform.displayName() || T("player") } };
    res.lb = "posting";
    void platform.postScore(Math.max(0, sc.total)).then((r) => { res.lb = r; });
  } else if (session.ranked) submitted = { key: "localRecords" };
  res.submitted = submitted;
  app.results = res;
  app.coachShown = false;
  setScreen("results");
  const head = won ? T("allAway") : T("roundLost");
  announce(`${head}. ${endReason(res)} ${T("total")} ${sc.total}.`);
}
export function endReason(r: Results): string {
  const k = ({ "all-passengers-boarded": "endBoarded", "holding-overflow": "endOverflow", "move-limit": "endMoveLimit", "no-legal-dispatch": "endNoLegal" } as Record<string, string>)[r.reason || ""];
  return k ? T(k) : r.reason || "";
}
export function resultsLbLine(): string | null {
  const lb = app.results?.lb;
  if (!lb) return null;
  if (lb === "posting") return S("lbPosting");
  return !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted");
}

// ------------------------------------------------------------------ coach (Learn)
const LESSONS = [["lesson1a", "lesson1b"], ["lesson2a", "lesson2b"], ["lesson3a", "lesson3b"]];
function coachFor(step: number): void {
  app.coachStep = step;
  app.coachShown = true;
  app.coachCollapsed = false;
  announce(coachText());
}
export function coachText(): string {
  return T("lessonLine", { n: session.lesson + 1, text: T(LESSONS[session.lesson]![Math.min(app.coachStep, 1)]!) });
}
function coachAdvance(ev: Events, s: State): void {
  if (app.coachStep === 0 && ev.boarded.length > 0) coachFor(1);
  if (s.status === "won") app.coachShown = false;
}

// ------------------------------------------------------------------ the text mirror
export function describeBoard(s: State): string {
  const parts = s.q.map((l, i) => T("queueDesc", { n: i + 1, list: l.length ? l.map(colorName).join(", ") : T("empty") }));
  parts.unshift(T("holdingDesc", { n: s.h.length, cap: s.holdingCap }) + (s.h.length ? ` (${s.h.map(colorName).join(", ")})` : ""));
  return parts.join(". ");
}
export function mirrorText(): string {
  const s = session.state;
  if (!s) return T("noRound");
  return describeBoard(s) + T("vehiclesDesc", { list: s.v.map((v) => T("vehicleItem", { color: colorName(v.c), n: v.n, cap: v.cap })).join(", ") });
}
function announceEvent(ev: Events, s: State): void {
  let msg: string;
  if (ev.match) {
    const nb = ev.boarded.length;
    msg = T(nb === 1 ? "boardedOne" : "boardedMany", { n: nb }) + (ev.full ? T("vehicleFull") : "") + (ev.fromHolding ? T("fromHolding", { n: ev.fromHolding }) : "") + ".";
  } else msg = T("mismatchMsg", { color: colorName(ev.displaced[0]!.color), n: s.h.length, cap: s.holdingCap });
  if (s.h.length >= s.holdingCap - 1 && s.status === "active") msg += T("nearlyFull");
  announce(T("passengersRemain", { msg, n: remaining(s) }));
}

// ------------------------------------------------------------------ picks (handlePick)
export function handlePick(kind: "vehicle" | "queue", index: number): void {
  const s = session.state;
  if (!s || session.screen !== "active") return;
  if (kind === "vehicle") {
    if (session.selectedVehicle === index) {
      session.selectedVehicle = -1; render.sync(s, -1); audio.play("select"); caption("capSelect"); return;
    }
    const veh = s.v[index];
    if (!veh || veh.n < 1) { toast(T("vehicleUsedUp"), 1400); audio.play("invalid"); caption("capInvalid"); return; }
    session.selectedVehicle = index;
    app.kbIndex = 0;
    audio.play("select"); caption("capSelect");
    render.sync(s, index);
    announce(T("vehicleSelected", { color: colorName(veh.c) }));
  } else {
    if (session.selectedVehicle < 0) { toast(T("selectFirst"), 1200); audio.play("invalid"); caption("capInvalid"); return; }
    commitDispatch(session.selectedVehicle, index);
  }
}
/** Keyboard targets (app.js kbTargets): queues with passengers once a vehicle is selected, else vehicles left. */
export function kbTargets(): number[] {
  const s = session.state;
  if (!s) return [];
  if (session.selectedVehicle >= 0) return s.q.map((l, i) => (l.length ? i : -1)).filter((i) => i >= 0);
  return s.v.map((v, i) => (v.n > 0 ? i : -1)).filter((i) => i >= 0);
}

// ------------------------------------------------------------------ flow
export function play(): void {
  if (!platform.progress().progress.tutorialDone) startRound("learn", { lesson: 0 });
  else startRound("journey", {});
}
export function pauseGame(): void {
  if (session.screen !== "active") return;
  setScreen("paused");
  announce(T("announcePaused"));
}
export function resumeGame(): void {
  setScreen("active");
  if (session.state) announce(T("resumed", { board: describeBoard(session.state) }));
}
export function restart(): void {
  const m = session.mode;
  if (m === "practice") startRound("practice", { difficulty: session.difficulty, seed: session.seed });
  else if (m === "challenge") startRound("challenge");
  else if (m === "daily") startRound("daily");
  else if (m === "learn") startRound("learn", { lesson: session.lesson });
  else startRound("journey", { stage: session.stage });
}
export function nextAfterResults(): void {
  const won = session.state?.status === "won";
  if (session.mode === "journey" && won && session.stage < R.JOURNEY_STAGES - 1) startRound("journey", { stage: session.stage + 1 });
  else if (session.mode === "learn" && won && session.lesson < 2) startRound("learn", { lesson: session.lesson + 1 });
  else restart();
}
export function goTitle(): void {
  session.state = null; session.mode = null; session.selectedVehicle = -1;
  app.coachShown = false;
  hint.cancel(); app.hintPending = false;
  render.sync(null, -1);
  setScreen("title");
}
export function openHelp(): void { app.helpReturn = session.screen; setScreen("help"); }
export function openSettings(): void { app.settingsReturn = session.screen; setScreen("settings"); }
export function closeHelp(): void { setScreen(app.helpReturn === "help" || app.helpReturn === "settings" ? "title" : app.helpReturn); }
export function closeSettings(): void { setScreen(app.settingsReturn === "help" || app.settingsReturn === "settings" ? "title" : app.settingsReturn); }
export function openSetup(mode: "practice" | "challenge"): void { app.setupMode = mode; setScreen("setup"); }
export async function openScores(tab: "journey" | "challenge" | "daily" = "journey"): Promise<void> {
  app.scoresTab = tab;
  if (session.screen !== "scores") setScreen("scores");
  if (!platform.signedIn()) { app.board = { local: true }; return; }
  app.board = null;
  try {
    const entries = await platform.topEntries(50);
    app.board = entries ? { entries } : { local: true };
  } catch { app.board = { error: true }; }
}
export function backFromMenu(): void { setScreen(session.state && session.state.status === "active" ? "active" : "title"); }
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied"), 2600); } catch { toast(S("copyFail", { url: link }), 6000); }
}

// ------------------------------------------------------------------ keys and pads (app.js keydown + pollGamepad)
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  const sc = session.screen;
  if (a === "cancel") {
    if (sc === "active") {
      if (session.selectedVehicle >= 0) { session.selectedVehicle = -1; render.sync(session.state, -1); announce(T("selectionCancelled")); }
      else later(pauseGame);
    } else if (sc === "paused" && fresh()) later(resumeGame);
    return;
  }
  if (sc !== "active") return;
  switch (a) {
    case "undo": later(undo); return;
    case "hint": later(doHint); return;
    case "camera": render.resetCamera(); toast(T("cameraReset"), 900); return;
    case "pause": later(pauseGame); return;
  }
  if (ui.focused() !== null) {
    if (a === "confirm") return; // Enter on a focused button is the button's
    ui.setFocus(null);
  }
  const s = session.state!;
  const t = kbTargets();
  if (!t.length) return;
  if (a === "prev" || a === "next") {
    app.kbIndex = (app.kbIndex + (a === "prev" ? -1 : 1) + t.length) % t.length;
    app.keyNav = true;
    const idx = t[app.kbIndex]!;
    if (session.selectedVehicle >= 0) announce(T("queueAnnounce", { n: idx + 1, list: s.q[idx]!.map(colorName).join(", ") || T("empty") }));
    else announce(T("vehicleAnnounce", { n: idx + 1, color: colorName(s.v[idx]!.c), left: s.v[idx]!.n }));
  } else if (a === "confirm") {
    const idx = t[Math.min(app.kbIndex, t.length - 1)]!;
    app.keyNav = true;
    const sel = session.selectedVehicle;
    later(() => { if (sel >= 0) commitDispatch(sel, idx); else handlePick("vehicle", idx); app.kbIndex = 0; });
  }
});

// ------------------------------------------------------------------ pointer and touch on the plaza (canvas pointerup tap)
const presses: { x: number; y: number }[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = now();
  if (e.control || !e.primary || e.phase !== "start" || ui.pointerCaptured()) return;
  presses.push({ x: e.x, y: e.y });
});
onPointerButton((e) => {
  if (e.button !== 0 || !e.pressed || now() - lastTouch < 0.6 || ui.pointerCaptured()) return;
  presses.push({ x: e.x, y: e.y });
});
/** The scene's framed view (window px: the window less the HUD, tray and a docked coach), set by screens.ts. */
export const view = { x: 0, y: 0, width: 0, height: 0 };
function pointerInput(wasActive: boolean): void {
  const list = presses.splice(0);
  if (!wasActive || session.screen !== "active") return;
  for (const p of list) {
    const hit = render.pick(p.x, p.y);
    if (hit) { app.keyNav = false; handlePick(hit.kind, hit.index); }
  }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  stepCountdown();
  audio.tick(now(), session.screen === "active");
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  hint.warm();
  render.setReducedMotion(preferences().reducedMotion);
  render.setPalette(platform.options.palette);
  applyLook();
  render.setRound(null, "plaza");
  render.setActive(true);
  setScreen("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => render.setPalette(platform.options.palette));
onSessionEnded(() => toast(S("signedOut"), 4000));
onSuspend(() => {
  hidden = true;
  if (session.screen === "active") pauseGame();
  platform.flush();
});
onResume(() => { hidden = false; });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  if (app.toast && app.toast.until < now()) app.toast = null;
});
onRender(() => {
  const wasActive = session.screen === "active";
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasActive);
  const f = frame();
  render.update(frameDt, f.width, f.height, view);
  flushAnnouncements();
});
