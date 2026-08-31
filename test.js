'use strict';
/* Transit Tangle — rules & content test suite (node test.js) */
const R = require('./rules.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' (got ' + JSON.stringify(a) + ')'); }

/* ---- basic legality ---- */
{
  const cfg = R.genConfig('t1', 1, R.difficultyParams(0));
  const s = R.initialState(cfg, [[1, 1, 2], [2], []], [{ c: 1, cap: 2, n: 1 }, { c: 2, cap: 2, n: 1 }]);
  const la = R.legalActions(s);
  eq(la.length, 4, 'two vehicles x two non-empty queues');
  const p1 = R.preview(s, 0, 0);
  eq([p1.boards, p1.displaced, p1.match], [2, 0, true], 'matching dispatch boards two');
  const p2 = R.preview(s, 0, 1);
  eq([p2.boards, p2.displaced, p2.match], [0, 1, false], 'mismatch displaces one');
  ok(!R.preview(s, 0, 2).ok, 'empty queue rejected');
  ok(!R.preview(s, 9, 0).ok, 'unknown vehicle rejected');
}

/* ---- dispatch resolution & holding ---- */
{
  const cfg = R.genConfig('t2', 2, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1, 1], [2, 2]], [{ c: 1, cap: 3, n: 2 }, { c: 2, cap: 3, n: 1 }]);
  let r = R.dispatch(s, 0, 1); // mismatch: 2 -> holding (no spare-seat rescue on mismatch)
  ok(r.ok && !r.events.match, 'mismatch dispatch resolves');
  eq(r.state.h, [2], 'displaced passenger waits in holding');
  eq(r.state.boarded, 0, 'nothing boarded on bare mismatch');
  r = R.dispatch(r.state, 1, 1); // match color 2: boards front 2, holding 2 takes spare seat
  eq([r.state.boarded, r.state.h.length], [2, 0], 'match boards queue front plus holding');
  r = R.dispatch(r.state, 0, 0); // vehicle color 1 boards [1,1]
  eq(r.state.status, 'won', 'win when all clear');
  eq(r.state.reason, 'all-passengers-boarded', 'win reason');
}

/* ---- invalid action accounting ---- */
{
  const cfg = R.genConfig('t3', 3, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1]], [{ c: 2, cap: 2, n: 0 }]);
  const r = R.dispatch(s, 0, 0);
  ok(!r.ok && r.reason === 'vehicle-depleted', 'depleted vehicle rejected');
  eq(r.state.invalid, 1, 'invalid counter increments');
  eq(R.scoreComponents(r.state).invalidPenalty, 20, 'invalid penalty scored');
}

/* ---- post-terminal rejection ---- */
{
  const cfg = R.genConfig('t4', 4, R.difficultyParams(0));
  const s = R.initialState(cfg, [[1]], [{ c: 1, cap: 2, n: 1 }]);
  const r = R.dispatch(s, 0, 0);
  eq(r.state.status, 'won', 'single passenger win');
  const r2 = R.dispatch(r.state, 0, 0);
  ok(!r2.ok && (r2.reason === 'not-active' || r2.reason === 'vehicle-depleted'), 'post-terminal dispatch rejected');
}

/* ---- holding overflow loss ---- */
{
  const cfg = R.genConfig('t5', 5, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1, 1], [2, 2]], [{ c: 1, cap: 1, n: 9 }]);
  s.holdingCap = 1;
  let r = R.dispatch(s, 0, 1); // mismatch: 2 -> holding [2]
  ok(r.state.status === 'active' && r.state.h.length === 1, 'first mismatch survives');
  r = R.dispatch(r.state, 0, 1); // mismatch again: holding [2,2] > cap 1
  eq(r.state.status, 'lost', 'holding overflow loses');
  eq(r.state.reason, 'holding-overflow', 'overflow reason');
}

/* ---- move limit loss ---- */
{
  const cfg = R.genConfig('t6', 6, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1], [2]], [{ c: 1, cap: 1, n: 1 }, { c: 2, cap: 1, n: 1 }]);
  s.moveLimit = 1;
  const r = R.dispatch(s, 0, 0);
  eq(r.state.reason, 'move-limit', 'move limit enforced');
}

/* ---- no legal dispatch loss ---- */
{
  const cfg = R.genConfig('t6b', 66, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1], [2]], [{ c: 1, cap: 1, n: 1 }]);
  const r = R.dispatch(s, 0, 0);
  eq(r.state.reason, 'no-legal-dispatch', 'supply exhaustion detected');
}

/* ---- determinism, hints & replay ---- */
{
  const cfg = R.journeyConfig(7);
  const s0 = R.genLevel(cfg);
  const cmds = [];
  let s = s0;
  while (s.status === 'active') {
    const h = R.hint(s);
    const mv = h || (() => { const la = R.legalActions(s); return { v: la[0].vehicle, q: la[0].queue }; })();
    const r = R.dispatch(s, mv.v, mv.q);
    cmds.push({ id: 'c' + cmds.length, tick: s.tick + 1, v: mv.v, q: mv.q });
    s = r.state;
    if (cmds.length > 500) break;
  }
  eq(s.status, 'won', 'hint-guided play wins journey-7');
  const env = R.replayEnvelope(cfg, s0, cmds, s, 'sess-1');
  const v = R.verifyReplay(env, s0);
  ok(v.valid, 'replay verifies: ' + (v.reason || ''));
  const bad = JSON.parse(JSON.stringify(env)); bad.score.total += 1;
  ok(!R.verifyReplay(bad, s0).valid, 'tampered score rejected');
  const bad2 = JSON.parse(JSON.stringify(env)); bad2.commands[1] = bad2.commands[0];
  ok(!R.verifyReplay(bad2, s0).valid, 'duplicate command id rejected');
  const bad3 = JSON.parse(JSON.stringify(env)); bad3.commands[0].v = 99;
  ok(!R.verifyReplay(bad3, s0).valid, 'out-of-bounds vehicle rejected');
}

/* ---- same seed -> identical hashes (property) ---- */
{
  for (let trial = 0; trial < 20; trial++) {
    const cfg = R.journeyConfig(trial % 40);
    const a = R.genLevel(cfg), b = R.genLevel(cfg);
    eq(R.hashState(a), R.hashState(b), 'genLevel deterministic seed ' + trial);
  }
}

/* ---- all journey stages solvable, bounded, move limits sane ---- */
{
  for (let stage = 0; stage < R.JOURNEY_STAGES; stage++) {
    const cfg = R.journeyConfig(stage);
    const s = R.genLevel(cfg);
    ok(s.par > 0, 'journey-' + stage + ' solvable with par');
    ok(s.q.length === cfg.queueCount, 'journey-' + stage + ' queue count');
    if (cfg.moveLimit) ok(s.moveLimit > 0 && s.par <= s.moveLimit, 'journey-' + stage + ' limit >= par');
  }
}

/* ---- daily / practice / challenge / tutorial configs ---- */
{
  const d = R.dailyConfig(20260829);
  ok(R.genLevel(d).par > 0, 'daily solvable');
  eq(R.dailyConfig(20260829).seed, R.dailyConfig(20260829).seed, 'daily seed immutable');
  ok(R.dailyConfig(20260829).id !== R.dailyConfig(20260830).id, 'daily id rotates');
  for (const diff of ['easy', 'normal', 'hard', 'expert']) {
    ok(R.genLevel(R.practiceConfig(diff, 99)).par > 0, 'practice ' + diff + ' solvable');
  }
  const ch = R.genLevel(R.challengeConfig(5));
  ok(ch.par > 0 && ch.moveLimit > 0, 'challenge has move limit');
  ok(ch.moveLimit >= ch.par, 'challenge limit >= par');
  for (let l = 0; l < 3; l++) ok(R.genLevel(R.tutorialConfig(l)).par > 0, 'tutorial ' + l + ' solvable');
}

/* ---- fuzz malformed commands & generated content ---- */
{
  const cfg = R.journeyConfig(3);
  const s0 = R.genLevel(cfg);
  const rnd = R.rng(12345);
  let s = s0, resets = 0;
  for (let i = 0; i < 2000; i++) {
    const vi = Math.floor(rnd() * 8) - 2;
    const qi = Math.floor(rnd() * 8) - 2;
    const r = R.dispatch(s, vi, qi);
    s = r.state;
    if (!Number.isFinite(s.tick) || s.tick < 0) { ok(false, 'tick sane'); break; }
    if (s.q.some(l => l.some(c => !Number.isInteger(c)))) { ok(false, 'colors sane'); break; }
    if (s.status !== 'active' && resets++ < 20) s = s0;
  }
  ok(true, 'fuzz completed without hangs/NaN');
  ok(!R.verifyReplay(null, s0).valid, 'null replay rejected');
  ok(!R.verifyReplay({ schema: 2 }, s0).valid, 'bad schema rejected');
  ok(!R.verifyReplay({ schema: 1, rulesVersion: 1, commands: 'x' }, s0).valid, 'bad commands rejected');
}

/* ---- scoring components & tie-breaks ---- */
{
  const cfg = R.genConfig('t7', 7, R.difficultyParams(0));
  let s = R.initialState(cfg, [[1, 1]], [{ c: 1, cap: 2, n: 2 }]);
  const r = R.dispatch(s, 0, 0);
  const sc = R.scoreComponents(r.state);
  eq(sc.board, 20, 'board points');
  eq(sc.full, 25, 'full vehicle bonus');
  eq(sc.spare, 15, 'spare vehicle bonus on win');
  eq(sc.total, 60, 'total');
  eq(sc.completion, 1, 'completion flag');
  const ord = R.compareResults(
    { completion: 1, total: 60, invalid: 0, ticks: 1, session: 'b' },
    { completion: 1, total: 60, invalid: 0, ticks: 1, session: 'a' });
  ok(ord > 0, 'tie broken by session id');
  const ord2 = R.compareResults(
    { completion: 0, total: 999, invalid: 0, ticks: 1, session: 'a' },
    { completion: 1, total: 10, invalid: 0, ticks: 9, session: 'b' });
  ok(ord2 > 0, 'completion outranks raw total');
}

/* ---- serialization round trip ---- */
{
  const cfg = R.journeyConfig(11);
  const s = R.genLevel(cfg);
  const s2 = JSON.parse(JSON.stringify(s));
  eq(R.hashState(s), R.hashState(s2), 'state survives JSON round trip');
}

console.log(failed === 0 ? 'ALL ' + passed + ' TESTS PASSED' : failed + ' FAILURES / ' + passed + ' passed');
process.exit(failed === 0 ? 0 : 1);
