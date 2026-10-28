// The browser build's DOM shell (index.html + style.css + app.js ui) as
// starhermit:ui, built every frame over the plaza: the HUD (mode, objective,
// score, moves against the limit, holding against its capacity — red when
// nearly full — and passengers left), the rails on wide windows (objective,
// progress and par; round, Hint/Undo and Reset camera; swapped for the
// left-handed option), the "Board state (text)" mirror, the action tray
// (Pause, Undo, Hint, Help, Settings), the lesson coach (above the tray, or
// docked at the right in short landscape, with Hide / Show lesson), the
// toast, the 3-2-1 countdown, named targets over the vehicles and queues
// (the canvas picking's accessible mirror: screen readers and play scripts
// find them), the keyboard focus ring and every screen (title, setup,
// journey, pause, results, help, settings, scores) as dialogs over the
// dimmed plaza. The old media queries are layouts picked by the window's
// logical size (≥ 1024 px wide: rails; ≤ 640 px: compact; ≤ 500 px tall
// landscape: the coach at the side). The scene's view rectangle goes to
// main.ts (view → render.ts).
import { frame, openMenu } from "starhermit:engine";
import { requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { R, SaveModel } from "./game.ts";
import { S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { token } from "./style.ts";
import {
  app, backFromMenu, closeHelp, closeSettings, coachText, colorName, doHint, endReason, fresh, goTitle, invite, kbTargets, keysFor, later,
  mirrorText, nextAfterResults, openHelp, openScores, openSettings, openSetup, pauseGame, play, restart, resultsLbLine, resumeGame,
  session, setScreen, signIn, startRound, status, undo, utcDateInt, view, type Screen,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; compact: boolean; land: boolean; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, wide: lw >= 1024, compact: lw <= 640, land: lh <= 500 && lw > lh, ox: sa.left, oy: sa.top };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; width?: number }
const btnWidth = (b: Btn): number => textWidth(b.text, b.style ?? "btn-sec", "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "btn-sec";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const ink = style === "btn" ? "wrap-ink" : "wrap";
  if (b.width != null && btnWidth(b) > b.width) opts.content = () => { ui.style(ink).paragraph(b.text, Math.max(20, b.width! - 30)); };
  else if (b.name && b.name !== b.text) opts.content = () => { ui.style(ink).label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** Buttons at their own widths in rows that wrap at `width` (.row: flex-wrap, gap 10). */
function flow(label: string, list: Btn[], width: number, justify: "start" | "center" = "start", gap = 10): number {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? btnWidth(b));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
  return rows.length;
}
function toWindow(L: Layout, x: number, y: number, w: number, h: number): ui.Rect {
  return { x: L.ox + x * L.sc, y: L.oy + y * L.sc, width: w * L.sc, height: h * L.sc };
}
function paint(id: string, x: number, y: number, w: number, h: number, cls: string): void {
  if (w <= 0 || h <= 0) return;
  ui.place(id, { anchor: "top-start", x, y }, () => { ui.style(cls).widget("", { role: "none", size: { width: w, height: h } }); });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  shell(L);
  overlay(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

function shell(L: Layout): void {
  const top = hud(L);
  const trayH = tray(L);
  let bottom = L.lh - trayH;
  let left = 0, right = L.lw;
  // render the board-facing targets before the overlays so they sit under them
  if (session.screen === "active" && session.state) boardTargets(L);
  if (L.wide) rails(L, top, bottom);
  mirror(L, top, bottom);
  if (app.coachShown && session.screen === "active" && session.state) {
    const r = coach(L, top, bottom);
    if (r.side) right = Math.min(right, r.x);
    else bottom = Math.min(bottom, r.y);
  }
  Object.assign(view, toWindow(L, left, top, right - left, bottom - top));
  if (app.toast) {
    const w = Math.min(L.lw - 32, 560);
    const t = app.toast.text;
    ui.place("toast", { anchor: "top", y: top + 18 }, () => {
      ui.column("toast-box", () => para(t, Math.min(textWidth(t, "toast-text") + 1, w - 36), "toast-text", "toast-text"), { style: "toast" });
    });
  }
  if (session.screen === "preparing" && app.countdown > 0) {
    ui.place("countdown", { anchor: "center" }, () => ui.style("count").id("countdown").label(String(app.countdown)));
  }
}

// #hud: flex-wrap, gap 6px 20px (4 12 compact), padding 6 12
function hud(L: Layout): number {
  const s = session.state;
  const sc = s ? R.scoreComponents(s) : null;
  const gapX = L.compact ? 12 : 20, gapY = L.compact ? 4 : 6, padX = 12, padY = L.land ? 4 : 6;
  const inner = L.lw - 2 * padX;
  const modeV = session.mode ? T(`mode${session.mode[0]!.toUpperCase()}${session.mode.slice(1)}`) + (session.mode === "journey" ? ` ${session.stage + 1}` : "") : "—";
  const danger = !!s && s.h.length >= s.holdingCap - 1 && s.status === "active";
  const items: { id: string; k: string; v: string; extra?: string; danger?: boolean }[] = [
    { id: "hud-mode", k: T("hudMode"), v: modeV },
    { id: "hud-objective", k: T("hudObjective"), v: s && s.moveLimit ? T("objectiveLimit", { n: s.moveLimit }) : T("objectiveClear") },
    { id: "hud-score", k: T("hudScore"), v: sc ? String(sc.total) : "0" },
    { id: "hud-moves", k: T("hudMoves"), v: s ? String(s.dispatches) : "0", extra: s && s.moveLimit ? ` / ${s.moveLimit}` : "" },
    { id: "hud-holding", k: T("hudHolding"), v: s ? `${s.h.length}/${s.holdingCap}` : "0/0", danger },
    { id: "hud-left", k: T("hudLeft"), v: s ? String(s.q.reduce((a, l) => a + l.length, 0) + s.h.length) : "0" },
  ];
  const width = (it: (typeof items)[number]): number => {
    const vs = it.danger ? "hud-danger" : "hud-v";
    return Math.min(inner, textWidth(it.k, it.danger ? "hud-danger" : "hud-k") + 6 + textWidth(it.v, vs) + (it.extra ? textWidth(it.extra, "hud-danger") : 0) + 1);
  };
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const it of items) {
    const w = width(it);
    if (rows[rows.length - 1]!.length && used + gapX + w > inner) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gapX : 0) + w;
    rows[rows.length - 1]!.push(it);
  }
  const lineH = textWidth("M", "hud-v") > 0 ? 22 : 22;
  const h = rows.length * lineH + (rows.length - 1) * gapY + 2 * padY;
  paint("hud-bg", 0, 0, L.lw, h, "bar");
  paint("hud-line", 0, h - 1, L.lw, 1, "bar-line");
  ui.place("hud", { anchor: "top-start", x: padX, y: padY }, () => {
    ui.column("hud-in", () => {
      rows.forEach((row, ri) => ui.row(`hud-r${ri}`, () => {
        for (const it of row) {
          ui.row(it.id, () => {
            ui.style(it.danger ? "hud-danger" : "hud-k").label(it.k);
            if (inner < width(it) + 1 && it.id === "hud-objective") ui.style("hud-v").id(`${it.id}-v`).paragraph(it.v, Math.max(40, inner - textWidth(it.k, "hud-k") - 8));
            else ui.style(it.danger ? "hud-danger" : "hud-v").id(`${it.id}-v`).label(it.v);
            if (it.extra) ui.style("hud-danger").label(it.extra);
          }, { spacing: 6, align: "center" });
        }
      }, { spacing: gapX, height: lineH, align: "center" }));
    }, { spacing: gapY, width: inner });
  });
  return h;
}

// nav#tray: Pause · Undo · Hint · Help · Settings; flex-wrap, centred, padding 10 (6 in short landscape)
function tray(L: Layout): number {
  const pad = L.land ? 6 : 10, gap = 10;
  const inner = L.lw - 2 * pad;
  const active = session.screen === "active";
  const list: Btn[] = [
    { id: "btn-pause", text: T("pause"), name: T("pauseAria"), act: pauseGame, disabled: !active, style: "btn-tray" },
    { id: "btn-undo2", text: T("undo"), act: undo, disabled: !session.undoAllowed || !session.undoStack.length || !active, style: "btn-tray" },
    { id: "btn-hint2", text: T("hint"), act: doHint, disabled: !active, style: "btn-tray" },
    { id: "btn-help-open", text: T("help"), act: openHelp, style: "btn-tray" },
    { id: "btn-settings-open", text: T("settings"), act: openSettings, style: "btn-tray" },
  ];
  let rows = 1, used = 0;
  for (const b of list) { const w = btnWidth(b); if (used && used + gap + w > inner) { rows++; used = 0; } used += (used ? gap : 0) + w; }
  const bh = 44 + (L.land ? 0 : 4);
  const h = rows * bh + (rows - 1) * gap + 2 * pad;
  paint("tray-bg", 0, L.lh - h, L.lw, h, "bar");
  paint("tray-line", 0, L.lh - h, L.lw, 1, "bar-line");
  ui.place("tray", { anchor: "top-start", x: pad, y: L.lh - h + pad }, () => { flow("tray-in", list, inner, "center"); });
  return h;
}

// .rail: 240 / 260 wide, from 64 px down to 90 px above the bottom
function rails(L: Layout, top: number, bottom: number): void {
  const s = session.state;
  const left = !platform.options.leftHand;
  const y = top + 30, full = Math.max(120, bottom - 20 - y);
  // the rail on the left ends above the board-state toggle
  const hFor = (x: number): number => (x < L.lw / 2 ? Math.max(120, full - 46) : full);
  const railL = (x: number): void => {
    const w = 240, iw = w - 24;
    ui.place("rail-left", { anchor: "top-start", x, y }, () => {
      ui.column("rail-left-col", () => {
        para(T("objective"), iw, "h3", "rail-objective-h");
        para(T("objectiveText"), iw, "text", "objective-text");
        para(T("progress"), iw, "h3", "rail-progress-h");
        para(s ? T("progressLine", { boarded: s.boarded, remaining: s.q.reduce((a, l) => a + l.length, 0) + s.h.length, invalid: s.invalid }) : "—", iw, "text", "progress-text");
        para(T("par"), iw, "h3", "rail-par-h");
        para(s ? T("parLine", { par: s.par || "—" }) + (s.moveLimit ? T("parLimit", { n: s.moveLimit }) : "") : "—", iw, "text", "par-text");
      }, { style: "rail", width: w, height: hFor(x), spacing: 6 });
    });
  };
  const railR = (x: number): void => {
    const w = 260, iw = w - 24;
    const active = session.screen === "active";
    ui.place("rail-right", { anchor: "top-start", x, y }, () => {
      ui.column("rail-right-col", () => {
        para(T("round"), iw, "h3", "rail-round-h");
        para(s && session.cfg ? T("roundLine", { id: session.cfg.id, seed: (s.seed >>> 0).toString(16) }) + T(session.ranked ? "rankedTag" : "unrankedTag") : "—", iw, "text", "round-text");
        para(T("assist"), iw, "h3", "rail-assist-h");
        flow("rail-assist", [
          { id: "btn-hint", text: T("hint"), style: "btn-small", act: doHint, disabled: !active },
          { id: "btn-undo", text: T("undo"), style: "btn-small", act: undo, disabled: !session.undoAllowed || !session.undoStack.length || !active },
        ], iw);
        para(T("view"), iw, "h3", "rail-view-h");
        flow("rail-view", [{ id: "btn-camera", text: T("resetCamera"), style: "btn-small", act: () => { render.resetCamera(); } }], iw);
      }, { style: "rail", width: w, height: hFor(x), spacing: 6 });
    });
  };
  if (left) { railL(10); railR(L.lw - 10 - 260); }
  else { railR(10); railL(L.lw - 10 - 240); }
}

// #board-mirror: bottom-left above the tray on wide and landscape windows, under the HUD on portrait ones
function mirror(L: Layout, top: number, bottom: number): void {
  const portrait = !L.wide && L.lh > L.lw;
  const w = Math.min(320, L.lw - 20);
  const label = `${app.mirrorOpen ? "▼" : "▶"} ${T("mirrorSummary")}`;
  const x = 10;
  const prev = lastSize.get("mirror")?.height ?? 40;
  const y = portrait ? top + 8 : bottom - 10 - prev / L.sc;
  ui.place("board-mirror", { anchor: "top-start", x, y }, () => {
    lastSize.set("mirror", ui.column("mirror-col", () => {
      if (ui.style("btn-small", { padding: { top: 6, bottom: 6, start: 10, end: 10 }, minHeight: 32 }).id("mirror-toggle").button(T("mirrorSummary"), {
        content: () => { ui.style("wrap").label(label); },
      }) && fresh()) later(() => { app.mirrorOpen = !app.mirrorOpen; });
      if (app.mirrorOpen) {
        ui.column("mirror-box", () => para(mirrorText(), w - 26, "small", "mirror-content"), { style: "mirror", width: w });
      }
    }, { spacing: 4 }));
  });
}

// #coach: above the tray, centred, ≤ 520 wide; short landscape: ≤ 240 wide at the right
function coach(L: Layout, top: number, bottom: number): { side: boolean; x: number; y: number } {
  const side = L.land;
  const text = coachText();
  const toggle = app.coachCollapsed ? T("showLesson") : T("hide");
  const tw = textWidth(toggle, "btn-small", "button") + 2;
  const maxW = side ? Math.min(240, L.lw * 0.34) : Math.min(520, L.lw * 0.92);
  const padX = side ? 10 : 16;
  const iw = maxW - 2 * padX - 4;
  const prev = lastSize.get("coach");
  const h = prev ? prev.height / L.sc : 80;
  const w = prev ? prev.width / L.sc : maxW;
  const x = side ? L.lw - 8 - w : (L.lw - w) / 2;
  const y = side ? top + 8 : bottom - 10 - h;
  ui.place("coach", { anchor: "top-start", x, y }, () => {
    lastSize.set("coach", ui.column("coach-col", () => {
      const btn = (): void => { button({ id: "coach-toggle", text: toggle, style: "btn-small", act: () => { app.coachCollapsed = !app.coachCollapsed; } }); };
      if (app.coachCollapsed) btn();
      else if (side || iw - tw - 10 < 160) {
        ui.column("coach-in", () => { para(text, iw, "text", "coach-text"); btn(); }, { spacing: 8, width: iw });
      } else {
        ui.row("coach-in", () => { para(text, iw - tw - 10, "text", "coach-text"); ui.spacer(); btn(); }, { spacing: 10, width: iw, align: "center" });
      }
    }, { style: "coach", spacing: 0, padding: { top: side ? 8 : 10, bottom: side ? 8 : 10, start: padX, end: padX } }));
  });
  return { side, x, y };
}

/** Named targets over the vehicles and queues; the key focus ring. */
function boardTargets(L: Layout): void {
  const s = session.state!;
  const rects = render.targetRects();
  rects.vehicles.forEach((r, i) => {
    if (!r) return;
    const v = s.v[i]!;
    const sel = session.selectedVehicle === i ? T("tgtSelected") : "";
    ui.target(T("tgtVehicle", { n: i + 1, color: colorName(v.c), left: v.n }) + sel, r, { role: "button" });
  });
  rects.queues.forEach((r, i) => {
    if (!r) return;
    ui.target(T("queueAnnounce", { n: i + 1, list: s.q[i]!.map(colorName).join(", ") || T("empty") }), r, { role: "button" });
  });
  if (app.keyNav) {
    const t = kbTargets();
    if (!t.length) return;
    const idx = t[Math.min(app.kbIndex, t.length - 1)]!;
    const r = session.selectedVehicle >= 0 ? rects.queues[idx] : rects.vehicles[idx];
    if (!r) return;
    void L;
    ui.place("kb-ring", { anchor: "top-start", x: 0, y: 0 }, () => ui.widget("", {
      role: "none", size: { width: 0, height: 0 },
      draw: () => { const k = frame().scale; draw.strokeRoundRect(r.x - 4 * k, r.y - 4 * k, r.width + 8 * k, r.height + 8 * k, 8, token("focus"), 3); },
    }));
  }
}

// ------------------------------------------------------------------ screens (.overlay > .panel)
type Panel = Exclude<Screen, "active" | "preparing">;
function overlay(L: Layout): void {
  const o = session.screen;
  if (o === "active" || o === "preparing") return;
  const p = o as Panel;
  const w = Math.min(p === "title" ? 640 : 560, L.lw - 40);
  const pad = L.compact ? 16 : 22;
  const inner = w - 2 * pad;
  const maxH = Math.min(0.84 * L.lh, 700);
  const key = `panel-${p}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 2 * pad + (lastSize.get(`${key}-foot`)?.height ?? 0) / L.sc + 12 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const isOpen = ui.style("dlg").dialog(panelLabel(p), "", true, () => {
    ui.column("panel", () => {
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildPanel(p, iw, L), { spacing: 12, width: iw })); };
      const fh = (lastSize.get(`${key}-foot`)?.height ?? 0) / L.sc;
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: Math.max(60, maxH - 2 * pad - (fh ? fh + 12 : 0)) }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
      if (fh || hasFooter(p)) lastSize.set(`${key}-foot`, ui.column(`${key}-foot`, () => { footer(p, inner); }, { spacing: 0, width: inner, padding: { top: 12 } }));
    }, { style: "panel", width: w, spacing: 0, padding: { top: pad, bottom: pad, start: pad, end: pad } });
  });
  if (!isOpen && fresh()) {
    // Escape (app.js keydown cancel)
    if (p === "paused") later(resumeGame);
    else if (p === "help") later(closeHelp);
    else if (p === "settings") later(closeSettings);
    else if (p === "scores" || p === "setup" || p === "journey") later(backFromMenu);
  }
}
const hasFooter = (o: Panel): boolean => ["results", "help", "settings", "scores", "journey"].includes(o);
function panelLabel(o: Panel): string {
  switch (o) {
    case "title": return "Transit Tangle";
    case "setup": return app.setupMode === "practice" ? T("practice") : T("challenge");
    case "journey": return T("journeyTitle");
    case "paused": return T("paused");
    case "results": return app.results?.won ? T("allAway") : T("roundLost");
    case "help": return T("howToPlay");
    case "settings": return T("settings");
    case "scores": return T("scores");
  }
}
function buildPanel(o: Panel, w: number, L: Layout): void {
  switch (o) {
    case "title": titlePanel(w); break;
    case "setup": setupPanel(w); break;
    case "journey": journeyPanel(w, L); break;
    case "paused": pausePanel(w); break;
    case "results": resultsPanel(w); break;
    case "help": helpPanel(w); break;
    case "settings": settingsPanel(w); break;
    case "scores": scoresPanel(w); break;
  }
}

/** The panels' action rows, pinned under the scrolling body (play scripts and the a11y mirror see them). */
function footer(o: Panel, w: number): boolean {
  switch (o) {
    case "results": {
      const r = app.results!;
      const nextKey = r.won && r.mode === "journey" && r.stage < R.JOURNEY_STAGES - 1 ? "nextStage" : r.won && r.mode === "learn" && r.lesson < 2 ? "nextLesson" : "playAgain";
  flow("results-row", [
    { id: "btn-results-next", text: T(nextKey), style: "btn", act: nextAfterResults },
    { id: "btn-results-retry", text: T("retry"), act: restart },
    { id: "btn-results-menu", text: T("menu"), act: goTitle },
  ], w);
      return true;
    }
    case "help":
  flow("help-row", [{ id: "btn-help-close", text: T("close"), style: "btn", act: closeHelp }], w);
      return true;
    case "settings":
  flow("set-row", [
    { id: "btn-replay-tutorial", text: T("replayTutorial"), act: () => { platform.progress().progress.tutorialDone = false; platform.persist(); startRound("learn", { lesson: 0 }); } },
    { id: "btn-settings-close", text: T("done"), style: "btn", act: closeSettings },
  ], w);
      return true;
    case "scores":
  flow("scores-row", [{ id: "btn-scores-close", text: T("close"), style: "btn", act: () => setScreen("title") }], w);
      return true;
    case "journey":
  flow("journey-row", [{ id: "btn-journey-back", text: T("back"), act: () => setScreen("title") }], w);
      return true;
    default: return false;
  }
}
function titlePanel(w: number): void {
  ui.column("title-col", () => titleBody(w), { spacing: 12, width: w, align: "center" });
}
function titleBody(w: number): void {
  para("Transit Tangle", w, "h1", "title-h");
  para(T("tagline"), w, "tagline", "tagline");
  flow("title-r1", [
    { id: "btn-play", text: T("play"), style: "btn", act: play },
    { id: "btn-daily", text: T("daily"), act: () => startRound("daily") },
  ], w, "center");
  flow("title-r2", [
    { id: "btn-journey", text: T("journey"), act: () => setScreen("journey") },
    { id: "btn-practice", text: T("practice"), act: () => openSetup("practice") },
    { id: "btn-challenge", text: T("challenge"), act: () => openSetup("challenge") },
    { id: "btn-learn", text: T("learn"), act: () => startRound("learn", { lesson: 0 }) },
  ], w, "center");
  const r3: Btn[] = [
    { id: "btn-scores", text: T("scores"), style: "btn-small", act: () => void openScores("journey") },
    { id: "btn-help2", text: T("help"), style: "btn-small", act: openHelp },
    { id: "btn-settings2", text: T("settings"), style: "btn-small", act: openSettings },
  ];
  if (!platform.signedIn()) r3.push({ id: "btn-signin", text: S("signIn"), style: "btn-small", act: signIn });
  if (platform.inviteLink()) r3.push({ id: "btn-invite", text: S("invite"), style: "btn-small", act: invite });
  flow("title-r3", r3, w, "center");
  const ms = platform.nowMs();
  const d = new Date(ms);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const left = next - ms;
  para(T("dailyCountdown", { h: Math.floor(left / 3600000), m: Math.floor(left / 60000) % 60, s: Math.floor(left / 1000) % 60 }), w, "center", "daily-countdown");
  const p = platform.progress().progress;
  para(T("titleProgress", { done: p.journeyDone.length, total: R.JOURNEY_STAGES, wins: p.wins }) + (p.streak >= 2 ? T("streakTag", { n: p.streak }) : ""), w, "center", "title-progress");
  if (platform.signedIn()) {
    const st = platform.syncState();
    const sync = st === "saving" || st === "connecting" ? T("syncSaving") : st === "error" ? T("syncOffline") : T("syncSynced");
    para(T("accountLine", { name: platform.displayName() || "…", sync }), w, "center", "account-line");
  }
}
function setupPanel(w: number): void {
  const practice = app.setupMode === "practice";
  para(practice ? T("practice") : T("challenge"), w, "h2", "setup-h");
  para(practice ? T("practiceDesc") : T("challengeDesc"), w, "text", "setup-desc");
  para(practice ? T("practiceMeta") : T("challengeMeta", { seed: utcDateInt() }), w, "muted", "setup-meta");
  if (practice) {
    flow("setup-difficulty", (["easy", "normal", "hard", "expert"] as const).map((d) => ({
      id: `diff-${d}`, text: T(`diff${d[0]!.toUpperCase()}${d.slice(1)}`), act: () => startRound("practice", { difficulty: d }),
    })), w);
    flow("setup-row", [{ id: "btn-setup-back", text: T("back"), act: () => setScreen("title") }], w);
  } else {
    flow("setup-row", [
      { id: "btn-setup-start", text: T("start"), style: "btn", act: () => startRound("challenge") },
      { id: "btn-setup-back", text: T("back"), act: () => setScreen("title") },
    ], w);
  }
}
function journeyPanel(w: number, L: Layout): void {
  const p = platform.progress().progress;
  para(T("journeyTitle"), w, "h2", "journey-h");
  para(T("journeyIntro"), w, "text", "journey-intro");
  const cols = L.compact ? 5 : 8, gap = 6;
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column("stage-grid", () => {
    for (let r = 0; r * cols < R.JOURNEY_STAGES; r++) {
      ui.row(`stage-grid-r${r}`, () => {
        for (let i = r * cols; i < Math.min(R.JOURNEY_STAGES, (r + 1) * cols); i++) {
          const done = p.journeyDone.includes(i), locked = i > p.journeyUnlocked;
          const name = T("stageLabel", { n: i + 1 }) + (done ? T("completedTag") : locked ? T("lockedTag") : "");
          const style = done ? "stage-done" : !locked && i === p.journeyUnlocked ? "stage-current" : "stage";
          if (ui.style(style, { width: cw }).id(`stage-${i + 1}`).button(name, { disabled: locked, content: () => { ui.style(done ? "wrap-ink" : "wrap").label(String(i + 1)); } }) && fresh()) {
            later(() => startRound("journey", { stage: i }));
          }
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width: w });
}
function pausePanel(w: number): void {
  para(T("paused"), w, "h2", "pause-h");
  flow("pause-r1", [
    { id: "btn-resume", text: T("resume"), style: "btn", act: resumeGame },
    { id: "btn-restart", text: T("restartRound"), act: restart },
  ], w);
  flow("pause-r2", [
    { id: "btn-pause-settings", text: T("settings"), act: openSettings },
    { id: "btn-pause-help", text: T("help"), act: openHelp },
    { id: "btn-quit", text: T("leaveRound"), act: goTitle },
  ], w);
}
function table(id: string, rows: string[][], w: number, boldLast = false): void {
  ui.column(id, () => {
    rows.forEach((r, i) => {
      const last = boldLast && i === rows.length - 1;
      ui.row(`${id}-${i}`, () => {
        for (let c = 0; c < r.length - 1; c++) {
          if (c === r.length - 2) para(r[c]!, w * 0.68, last ? "td-b" : "td");
          else ui.style("td").label(r[c]!);
        }
        ui.spacer();
        ui.style(last ? "td-num-b" : "td-num").label(r[r.length - 1]!);
      }, { style: last ? "tr-last" : "tr", width: w, spacing: 12, align: "center" });
    });
  }, { spacing: 0, width: w });
}
function resultsPanel(w: number): void {
  const r = app.results!;
  const sc = r.sc;
  para(r.won ? T("allAway") : T("roundLost"), w, "h2", "results-h");
  para(endReason(r), w, "text", "results-reason");
  table("results-table", [
    [T("rowBoarded"), `+${sc.board}`], [T("rowFull"), `+${sc.full}`], [T("rowSpare"), `+${sc.spare}`],
    [T("rowInvalid"), `-${sc.invalidPenalty}`], [T("rowHolding"), `-${sc.holdingPenalty}`], [T("total"), String(sc.total)],
  ], w, true);
  const prog = r.won ? (r.mode === "journey" ? T("stageComplete", { n: r.stage + 1 }) : "") + (r.usedAssist ? T("assistsUsed") : "") : T("tipSpare");
  para(prog.trim(), w, "text", "results-progress");
  const ach = r.newAch.length ? T("achievementUnlocked", { list: r.newAch.map((k) => T(k)).join(", ") }) : "";
  const sub = r.submitted ? T(r.submitted.key, r.submitted.vars) : "";
  para([ach, sub].filter(Boolean).join(" "), w, "text", "results-achievements");
  const lb = resultsLbLine();
  if (lb) para(lb, w, "text", "results-lb");
  void status;
}
function helpPanel(w: number): void {
  para(T("howToPlay"), w, "h2", "help-h");
  for (const k of ["helpMatch", "helpHolding", "helpLimited", "helpScoring"]) {
    para(T(k), w, "h3", `${k}-h`);
    para(T(`${k}Text`), w, "text", `${k}-p`);
  }
  para(T("controls"), w, "h3", "help-controls-h");
  para(T("helpControls", {
    prev: keysFor("prev"), next: keysFor("next"), confirm: keysFor("confirm"), cancel: keysFor("cancel"), undo: keysFor("undo"),
    hint: keysFor("hint"), camera: keysFor("camera"), pause: keysFor("pause"),
  }), w, "text", "help-controls");
}
/** Settings: what the runtime's Options do not cover — palette, left-handed controls, text cues — and the tutorial replay. */
function settingsPanel(w: number): void {
  const o = platform.options;
  para(T("settings"), w, "h2", "settings-h");
  para(T("optionsNote"), w, "muted", "options-note");
  flow("set-runtime", [
    { id: "btn-options", text: T("openOptions"), act: () => openMenu() },
    { id: "btn-rebind", text: T("keyBindings"), act: () => requestRebind() },
  ], w);
  const names = ["palDefault", "palCvd", "palContrast"];
  const idx = Math.max(0, SaveModel.PALETTES.indexOf(o.palette));
  ui.row("opt-palette-row", () => {
    para(T("colorPalette"), w * 0.42, "text", "opt-palette-label");
    ui.spacer();
    const pick = ui.id("opt-palette").select(T("colorPalette"), idx, names.map((n) => T(n)), { width: Math.min(w * 0.55, 260) } as ui.WidgetOptions);
    if (pick !== idx) later(() => platform.setOption("palette", SaveModel.PALETTES[pick]!));
  }, { width: w, align: "center", height: 48 });
  toggleRow("opt-left", T("leftHanded"), o.leftHand, w, (v) => platform.setOption("leftHand", v));
  toggleRow("opt-captions", T("captions"), o.captions, w, (v) => platform.setOption("captions", v));
}
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w - 56, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel"));
        draw.strokeRoundRect(bx, by, box, box, 4, on ? token("accent") : token("ink-soft"), 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: "#ffffff", align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 8, height: 44 });
}
function scoresPanel(w: number): void {
  para(T("scores"), w, "h2", "scores-h");
  flow("scores-tabs", [
    { id: "tab-journey", text: T("journey"), style: "btn-small", act: () => void openScores("journey") },
    { id: "tab-challenge", text: T("challenge"), style: "btn-small", act: () => void openScores("challenge") },
    { id: "tab-daily", text: T("dailyShort"), style: "btn-small", act: () => void openScores("daily") },
  ], w);
  const v = app.board;
  const best = platform.progress().progress.best;
  const boardName = app.scoresTab === "daily" ? T("dailyShort") : T(app.scoresTab);
  if (!v) para(T("loading"), w, "text", "scores-content");
  else if ("error" in v) para(T("lbUnavailable"), w, "text", "scores-content");
  else if ("local" in v) {
    const b = best[app.scoresTab];
    para(b != null ? T("bestOnDevice", { board: boardName, best: b }) : T("noBestOnDevice", { board: boardName }), w, "text", "scores-content");
  } else if (!v.entries.length) para(T("noEntries"), w, "text", "scores-content");
  else table("scores-table", [["#", T("player"), T("scoreCol")], ...v.entries.map((e, i) => [String(i + 1), e.name || T("player"), String(e.score)])], w);
}
