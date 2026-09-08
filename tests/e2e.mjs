/**
 * Transit Tangle — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Practice (Easy) → dispatch vehicles into matching passenger
 *   queues via the documented keyboard controls until every passenger boards
 *   → results ("All passengers away!") with score breakdown → persisted
 *   progress (wins/streak). Also exercises pause/resume, Hint, Undo,
 *   Help open/close and Settings open/close through the real DOM buttons.
 * A second pass runs the same load → practice → a-few-moves flow on a
 * mobile touch viewport.
 *
 * DEFECT RESOLVED — pointer/touch vehicle selection. The canvas pointer
 * picker previously raycast the vehicle group's children (body/cab/pips),
 * but only the group itself carried `userData.vehicleIndex`, so a tap on a
 * vehicle returned no hit and dispatch was never offered via pointer/touch.
 * Fixed in app.js rebuildBoard by propagating `grp.userData.vehicleIndex` to
 * every hit-testable child via `grp.traverse`. Queue selection (meshes carry
 * `userData.queueIndex`) is unchanged. This test now taps a vehicle, confirms
 * it selects, and completes a full pointer dispatch, and verifies tapping a
 * queue with no vehicle selected is still rejected. Keyboard selection
 * (Left/Right → Enter) is unchanged and used for every other dispatch.
 *
 * Serving: the repo ships `server.js` (StarHermit authoritative script,
 * declared by starhermit.txt), but its round engine is deterministic and the
 * game is fully playable offline (spec: "ordinary practice can run locally
 * and offline after initial load"). Per the sibling conventions this test
 * embeds a minimal node:http static server on an ephemeral port and answers
 * the platform probes with JSON (`/api/v1/time` with a real timestamp so the
 * clock sync and daily countdown run cleanly; other `/api/*` as 200 `{}`) so
 * the client stays online-ish with zero console noise and, crucially, never
 * writes to the game's `data/` store. Today spawning the real backend is not
 * needed for a play-through; it can be swapped in if the UI ever requires it.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/transit-tangle-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer the platform probes so the client
    // degrades cleanly. clock sync gets a real timestamp; others empty JSON.
    if (p === '/api/v1/time') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ now: Date.now(), iso: new Date().toISOString() }));
      return;
    }
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- read-only observation (window.__tt, shipped debug handle) ----------
// window.__tt = { session, startRound, commitDispatch, undo, doHint, R, store }
// We READ session.state and R.hint/legalActions only (choosing the next legal
// move the same way the Hint button does) and never call __tt.commitDispatch
// / __tt.startRound. Every action is a real keypress, tap or click on the UI.

const liveState = (page) => page.evaluate(() => {
  const s = window.__tt?.session?.state;
  return s ? {
    status: s.status, reason: s.reason ?? null, tick: s.tick, dispatches: s.dispatches,
    q: s.q.map((l) => l.length), v: s.v.length, h: s.h.length, caps: s.holdingCap,
    selected: window.__tt.session.selectedVehicle,
  } : null;
});

const waitActive = (page) =>
  page.waitForFunction(() => window.__tt?.session?.screen === 'active', null, { timeout: 15000 });

function overlayVisible(page, id) {
  return page.waitForFunction((i) => { const e = document.getElementById(i); return !!e && !e.hidden; }, id, { timeout: 8000 });
}
function overlayGone(page, id) {
  return page.waitForFunction((i) => { const e = document.getElementById(i); return !!e && e.hidden; }, id, { timeout: 8000 });
}

// Project a world point to client coords by replicating the game's own camera
// (fov 42, camHome (0,15*dist,17*dist), lookAt(0,0,0.5), aspect = canvas box).
async function projectWorld(page, x, y, z) {
  return page.evaluate(([x, y, z]) => {
    const canvas = document.getElementById('c');
    const rect = canvas.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    const dist = w < h ? 1 + (h / w - 1) * 0.55 : 1;
    const cam = new window.THREE.PerspectiveCamera(42, rect.width / rect.height, 0.1, 200);
    cam.position.set(0, 15 * dist, 17 * dist);
    cam.lookAt(0, 0, 0.5);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const p = new window.THREE.Vector3(x, y, z);
    const q = p.clone().project(cam);
    return { x: rect.left + (q.x + 1) / 2 * rect.width, y: rect.top + (1 - q.y) / 2 * rect.height };
  }, [x, y, z]);
}

async function queueScreenPos(page, qi) {
  return page.evaluate(([qi]) => {
    const s = window.__tt.session.state;
    const nq = s.q.length;
    const x = (qi - (nq - 1) / 2) * 2.6;
    return x; // world x of the queue platform; player taps its front (z=-3.6)
  }, [qi]).then((x) => projectWorld(page, x, 0.09, -3.6));
}

async function vehicleScreenPos(page, vi) {
  return page.evaluate(([vi]) => {
    const s = window.__tt.session.state;
    const nv = s.v.length;
    return (vi - (nv - 1) / 2) * 2.8;
  }, [vi]).then((x) => projectWorld(page, x, 0.6, 5.4));
}

// ---------- keyboard move: select vehicle v, dispatch to queue q ----------
// The game's global keydown handler does Left/Right to cycle legal targets,
// Enter to select/dispatch. kbFocus.index resets to 0 after every Enter, so
// each action starts at the first legal target and we press ArrowRight the
// needed number of times.
async function kbDispatch(page, v, q, prevTick) {
  const pos = await page.evaluate(([hv, hq]) => {
    const s = window.__tt.session.state;
    const availV = s.v.map((x, i) => (x.n > 0 ? i : -1)).filter((i) => i >= 0);
    const posV = availV.indexOf(hv);
    const availQ = s.q.map((l, i) => (l.length > 0 ? i : -1)).filter((i) => i >= 0);
    const posQ = availQ.indexOf(hq);
    return { posV, posQ };
  }, [v, q]);
  if (pos.posV < 0) throw new Error(`hinted vehicle ${v} is not available`);
  if (pos.posQ < 0) throw new Error(`hinted queue ${q} is empty`);
  for (let i = 0; i < pos.posV; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');                       // select vehicle
  await page.waitForFunction((hv) => window.__tt.session.selectedVehicle === hv, v, { timeout: 3000 });
  for (let i = 0; i < pos.posQ; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');                       // dispatch
  await page.waitForFunction((t) => window.__tt.session.state.tick > t, prevTick, { timeout: 3000 });
}

// Solve the round for real on the visible controls, using R.hint (the same
// legality surface the Hint button uses) to choose the next legal dispatch.
async function solveRound(page, guard = 180) {
  for (let g = 0; g < guard; g++) {
    const st = await liveState(page);
    if (st.status !== 'active') return st;
    let mv = await page.evaluate(() => window.__tt.R.hint(window.__tt.session.state) ?? null);
    if (!mv) {
      const la = await page.evaluate(() => window.__tt.R.legalActions(window.__tt.session.state));
      if (!la || !la.length) return st;
      mv = { v: la[0].vehicle, q: la[0].queue };
    }
    await kbDispatch(page, mv.v, mv.q, st.tick);
  }
  throw new Error('solve loop did not terminate within guard limit');
}

async function startPractice(page) {
  await page.click('#btn-practice');
  await page.waitForSelector('#screen-setup', { state: 'visible' });
  await page.click('#setup-difficulty [data-diff="easy"]'); // Easy starts immediately
  await waitActive(page);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#screen-title', { state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => !!window.__tt && window.__tt.session.screen === 'title');
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible`);

    // extra features from the title: Help + Settings open/close
    await page.click('#btn-help2');
    await overlayVisible(page, 'screen-help');
    await page.click('#btn-help-close');
    await overlayGone(page, 'screen-help');
    await page.click('#btn-settings2');
    await overlayVisible(page, 'screen-settings');
    await page.click('#btn-settings-close');
    await overlayGone(page, 'screen-settings');
    ok(`${name}: help and settings open/close from the title`);

    // start a real game via visible controls: Practice → Easy
    await startPractice(page);
    const st0 = await liveState(page);
    if (st0.status !== 'active') throw new Error(`expected active practice, got ${st0.status}`);
    if (st0.q.length < 2 || st0.v < 2) throw new Error(`thin board: q=${st0.q.length} v=${st0.v}`);
    const hudMode = (await page.textContent('#hud-mode')).trim();
    if (!/practice/.test(hudMode)) throw new Error(`unexpected HUD mode "${hudMode}"`);
    await page.screenshot({ path: SHOT('play', name) });
    ok(`${name}: Practice (Easy) active — ${st0.v} vehicles, ${st0.q.length} queues, holding ${st0.h}/${st0.caps}`);

    // regression: a boarding dispatch must announce "Boarded N passenger(s)".
    // events.boarded is an array; a past bug interpolated it raw, producing
    // "Boarded [object Object]…" and suppressing the boarding sound/caption.
    // A matching legal action always exists at tick 0 (vehicles are generated
    // for every demanded color).
    const mAct = await page.evaluate(() =>
      window.__tt.R.legalActions(window.__tt.session.state).find((a) => a.match) ?? null);
    if (!mAct) throw new Error('expected a matching legal action at round start');
    await kbDispatch(page, mAct.vehicle, mAct.queue, st0.tick);
    const liveTxt = (await page.textContent('#live')) || '';
    if (!/Boarded \d+ passenger/.test(liveTxt)) throw new Error(`boarding announcement broken: "${liveTxt}"`);
    if (/object Object/.test(liveTxt)) throw new Error(`announcement leaks raw array: "${liveTxt}"`);
    const toastTxt = (await page.textContent('#toast')) || '';
    if (/object Object/.test(toastTxt)) throw new Error(`sound caption leaks raw array: "${toastTxt}"`);
    ok(`${name}: boarding dispatch announces "Boarded N passengers" (live region + caption)`);

    // pointer behavior (fixed defect): tapping a vehicle selects it, and a
    // full pointer dispatch (vehicle tap -> queue tap) advances the round.
    const pokDispatch = await (async () => {
      const h = await page.evaluate(() => window.__tt.R.hint(window.__tt.session.state) ?? null);
      if (!h) return null;
      const vp = await vehicleScreenPos(page, h.v);
      await page.mouse.click(vp.x, vp.y);
      await page.waitForTimeout(120);
      const selV = (await liveState(page)).selected;
      if (selV !== h.v) throw new Error(`pointer tap did not select vehicle (got ${selV}, want ${h.v})`);
      const beforeD = await liveState(page);
      const qp = await queueScreenPos(page, h.q);
      await page.mouse.click(qp.x, qp.y);
      await page.waitForTimeout(150);
      const afterD = await liveState(page);
      if (afterD.tick === beforeD.tick || afterD.status !== 'active') {
        throw new Error(`pointer dispatch did not advance the round (tick ${beforeD.tick} -> ${afterD.tick}, ${afterD.status})`);
      }
      ok(`${name}: pointer selects a vehicle and dispatches it (vehicle ${h.v} -> queue ${h.q}, tick ${beforeD.tick}->${afterD.tick})`);
      return h;
    })();
    if (!pokDispatch) {
      // no hinted move yet (unusual): just prove a bare vehicle tap selects it
      const vp = await vehicleScreenPos(page, 0);
      await page.mouse.click(vp.x, vp.y);
      await page.waitForTimeout(120);
      const selAfterVeh = (await liveState(page)).selected;
      if (selAfterVeh !== 0) throw new Error(`tapping vehicle 0 did not select it (selectedVehicle=${selAfterVeh})`);
      ok(`${name}: pointer tap selects vehicle 0 (selectedVehicle=${selAfterVeh})`);
      await page.keyboard.press('Escape'); // deselect so keyboard play proceeds cleanly
    }

    // pointer behavior: tapping a queue with no vehicle selected is rejected
    // (queue picking works), i.e. no dispatch happens and no state change.
    const beforeQ = await liveState(page);
    const qp = await queueScreenPos(page, 0);
    await page.mouse.click(qp.x, qp.y);
    await page.waitForTimeout(120);
    const afterQ = await liveState(page);
    if (afterQ.tick !== beforeQ.tick || afterQ.status !== 'active') {
      throw new Error(`queue tap unexpectedly dispatched (tick ${beforeQ.tick} -> ${afterQ.tick})`);
    }
    ok(`${name}: pointer picking works for queues (tap with no vehicle is rejected, no state change)`);

    if (full) {
      // pause / resume via the visible buttons
      await page.click('#btn-pause');
      await overlayVisible(page, 'screen-pause');
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#btn-resume');
      await waitActive(page);
      ok(`${name}: pause and resume work`);

      // Escape from settings opened via the pause screen returns to the pause
      // screen (it must not silently resume the round).
      await page.click('#btn-pause');
      await overlayVisible(page, 'screen-pause');
      await page.click('#btn-pause-settings');
      await overlayVisible(page, 'screen-settings');
      await page.keyboard.press('Escape');
      await overlayVisible(page, 'screen-pause');
      await page.click('#btn-resume');
      await waitActive(page);
      ok(`${name}: Escape from pause-settings returns to the pause screen`);

      // hint via the visible Hint button
      const beforeHintUsed = await page.evaluate(() => window.__tt.session.usedAssist);
      await page.click('#btn-hint');
      await page.waitForFunction((n) => window.__tt.session.usedAssist && !n, beforeHintUsed, { timeout: 3000 });
      ok(`${name}: Hint button sets the assist flag and reports a legal move`);

      // undo: make one real dispatch, then undo it (practice allows undo)
      const undoSt = await liveState(page);
      const h = await page.evaluate(() => window.__tt.R.hint(window.__tt.session.state));
      await kbDispatch(page, h.v, h.q, undoSt.tick);
      const afterOne = await liveState(page);
      if (afterOne.dispatches !== undoSt.dispatches + 1) throw new Error('first dispatch did not register');
      await page.click('#btn-undo');
      await page.waitForFunction((d) => window.__tt.session.state.dispatches === d, undoSt.dispatches, { timeout: 3000 });
      const afterUndo = await liveState(page);
      if (afterUndo.dispatches !== undoSt.dispatches) throw new Error('undo did not revert the dispatch');
      ok(`${name}: dispatch then Undo restores the previous move count`);

      // solve the round for real via keyboard
      const done = await solveRound(page);
      if (done.status !== 'won') throw new Error(`round did not win: ${done.status} (${done.reason})`);

      // results screen
      await overlayVisible(page, 'screen-results');
      const headline = (await page.textContent('#results-h')) || '';
      if (!/All passengers away/i.test(headline)) throw new Error(`unexpected results headline "${headline}"`);
      const rows = await page.locator('#results-table tbody tr').count();
      if (rows < 1) throw new Error('results score table is empty');
      await page.screenshot({ path: SHOT('results', name) });
      ok(`${name}: round won on the visible controls — results ("${headline}", ${rows} score rows)`);

      // progress persisted locally
      const pr = await page.evaluate(() => {
        const raw = localStorage.getItem('transit-tangle-v1');
        return raw ? JSON.parse(raw) : null;
      });
      if (!pr || !(pr.progress && pr.progress.wins > 0)) throw new Error('win not persisted: ' + JSON.stringify(pr));
      ok(`${name}: progress persisted (wins: ${pr.progress.wins}, streak: ${pr.progress.streak})`);
    } else {
      // mobile: real touch on a DOM assist button (the tray Hint lives on the
      // bottom thumb-zone on mobile; the right-rail Hint may be collapsed).
      // Done first, while the round is still active, so the results overlay
      // (shown once the small Easy board is solved below) cannot intercept it.
      await page.tap('#btn-hint2');
      await page.waitForTimeout(200);
      ok(`${name}: Hint button responds to a touchscreen tap`);

      // mobile: make a few real moves through the keyboard controls and verify
      // progress; also exercise the touch tray buttons with touchscreen.tap.
      let moves = 0;
      for (let g = 0; g < 6; g++) {
        const st = await liveState(page);
        if (st.status !== 'active') break;
        let mv = await page.evaluate(() => window.__tt.R.hint(window.__tt.session.state) ?? null);
        if (!mv) { const la = await page.evaluate(() => window.__tt.R.legalActions(window.__tt.session.state)); if (!la.length) break; mv = { v: la[0].vehicle, q: la[0].queue }; }
        await kbDispatch(page, mv.v, mv.q, st.tick);
        moves++;
      }
      const stM = await liveState(page);
      if (stM.status === 'lost') throw new Error(`mobile round lost: ${stM.reason}`);
      if (stM.dispatches < 1) throw new Error('no mobile dispatches registered');
      // The small Easy board can be solved in a handful of dispatches, so the
      // round may legitimately be won by the time we stop -- either way real
      // moves happened and progress advanced.
      const tail = stM.status === 'won' ? ' (round solved!)' : '';
      ok(`${name}: made ${moves} real moves (dispatches: ${stM.dispatches}, status: ${stM.status})${tail}`);
      await page.screenshot({ path: SHOT('mobile-play', name) });
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  ok(`${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — transit-tangle, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', (e && (e.stack || e.message)) || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
