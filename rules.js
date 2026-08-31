'use strict';
/* Transit Tangle — shared rules engine (browser + Node).
   Pure deterministic state transitions, legality, scoring, seeded RNG,
   content generation, solver validation, and replay verification.
   No DOM, no rendering, no I/O.

   Core action: dispatch(vehicle, queue).
   - The vehicle visits one queue. If the queue's front passengers match the
     vehicle color, consecutive matches board (up to capacity).
   - If the front passenger does NOT match, that passenger steps aside into
     the holding lane (capacity limited — overflow loses the round).
   - After boarding, waiting holding-lane passengers (any color, FIFO) fill
     remaining seats.
   Win: every queue and the holding lane are empty.
   Lose: holding overflow, move limit reached, or no legal dispatch remains. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.TTRules = mod;
})(typeof self !== 'undefined' ? self : this, function () {

  const RULES_VERSION = 1;
  const CONTENT_VERSION = 1;

  /* ---------------- seeded RNG (mulberry32) ---------------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- hashing / serialization ---------------- */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function stateKey(s) {
    return s.q.map(q => q.join('')).join('|') + '#' + s.h.join('') + '#' +
      s.v.map(v => v.c + ':' + v.n).join(',');
  }
  function hashState(s) { return fnv1a(stateKey(s)); }

  /* ---------------- difficulty & content ---------------- */
  function difficultyParams(stage) {
    // Journey ramp: one concept at a time, then combined, then mastery.
    const t = Math.max(0, Math.min(39, stage));
    return {
      queueCount: 3 + Math.min(3, Math.floor(t / 8)),          // 3..6
      colorCount: 3 + Math.min(2, Math.floor((t + 4) / 12)),   // 3..5
      holdingCap: 6 - Math.min(3, Math.floor(t / 10)),         // 6..3
      queueLenMin: 3, queueLenMax: 3 + Math.min(3, Math.floor(t / 10)),
      capacityMin: 2, capacityMax: 2 + Math.min(2, Math.floor(t / 14)),
      slack: t < 10 ? 2 : t < 25 ? 1 : 0,                      // spare vehicles
      moveLimit: t >= 28 ? 1 : 0                               // mastery stages get a limit
    };
  }

  function genConfig(id, seed, p, theme) {
    return {
      id, version: CONTENT_VERSION, seed: seed >>> 0,
      queueCount: p.queueCount, colorCount: p.colorCount,
      holdingCap: p.holdingCap,
      queueLenMin: p.queueLenMin, queueLenMax: p.queueLenMax,
      capacityMin: p.capacityMin, capacityMax: p.capacityMax,
      slack: p.slack, moveLimit: p.moveLimit || 0,
      theme: theme || 'plaza'
    };
  }

  function initialState(cfg, queues, vehicles) {
    return {
      cfgId: cfg.id, version: RULES_VERSION, seed: cfg.seed,
      holdingCap: cfg.holdingCap, moveLimit: cfg.moveLimit || 0,
      tick: 0,
      q: queues.map(l => l.slice()),
      h: [],
      v: vehicles.map(x => ({ c: x.c, cap: x.cap, n: x.n })),
      boarded: 0, dispatches: 0, invalid: 0,
      fullBoards: 0, holdingAccum: 0,
      status: 'active', reason: null, par: 0, moveLimitLeft: 0
    };
  }

  // Build a solvable initial state from a config (solver-verified, deterministic).
  function genLevel(cfg) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const r = rng((cfg.seed + attempt * 7919) >>> 0);
      const q = [];
      for (let i = 0; i < cfg.queueCount; i++) {
        const len = cfg.queueLenMin + Math.floor(r() * (cfg.queueLenMax - cfg.queueLenMin + 1));
        const lane = [];
        for (let j = 0; j < len; j++) lane.push(1 + Math.floor(r() * cfg.colorCount));
        q.push(lane);
      }
      const demand = {};
      for (const lane of q) for (const c of lane) demand[c] = (demand[c] || 0) + 1;
      const caps = {};
      for (let c = 1; c <= cfg.colorCount; c++) {
        if (demand[c]) caps[c] = cfg.capacityMin + Math.floor(r() * (cfg.capacityMax - cfg.capacityMin + 1));
      }
      // Exact dispatches needed per color under the always-match strategy:
      // sum over maximal same-color runs of ceil(runLen / capacity).
      const need = {};
      for (const lane of q) {
        let j = 0;
        while (j < lane.length) {
          const c = lane[j]; let k = j;
          while (k < lane.length && lane[k] === c) k++;
          need[c] = (need[c] || 0) + Math.ceil((k - j) / caps[c]);
          j = k;
        }
      }
      const v = [];
      for (let c = 1; c <= cfg.colorCount; c++) {
        if (!demand[c]) continue;
        v.push({ c, cap: caps[c], n: need[c] + (r() < 0.5 ? cfg.slack : Math.max(0, cfg.slack - 1)) });
      }
      const st = initialState(Object.assign({}, cfg, { moveLimit: 0 }), q, v);
      const greedyMoves = greedySolve(st); // constructive proof: always-match strategy
      if (greedyMoves > 0) {
        st.par = greedyMoves + Math.max(2, Math.ceil(greedyMoves * 0.4));
        if (cfg.moveLimit) st.moveLimit = greedyMoves + Math.max(3, Math.ceil(greedyMoves * 0.5));
        return st;
      }
    }
    throw new Error('genLevel: no solvable level for ' + cfg.id);
  }

  /* ---------------- legality ---------------- */
  function preview(s, vi, qi) {
    const veh = s.v[vi];
    if (!veh) return { ok: false, reason: 'no-such-vehicle' };
    if (s.status !== 'active') return { ok: false, reason: 'not-active' };
    if (qi == null || qi < 0 || qi >= s.q.length) return { ok: false, reason: 'no-such-queue' };
    if (veh.n < 1) return { ok: false, reason: 'vehicle-depleted' };
    const lane = s.q[qi];
    if (!lane.length) return { ok: false, reason: 'queue-empty' };
    let room = veh.cap, boards = 0, displaced = 0;
    if (lane[0] === veh.c) {
      let j = 0;
      while (j < lane.length && lane[j] === veh.c && room > 0) { j++; room--; boards++; }
    } else {
      displaced = 1; // mismatched front steps aside into holding
    }
    // Waiting holding passengers board only on a matched dispatch.
    const fromHolding = displaced === 0 ? Math.min(room, s.h.length) : 0;
    boards += fromHolding;
    return { ok: true, match: displaced === 0, boards, displaced, fromHolding, fills: room === 0 };
  }

  function legalActions(s) {
    const out = [];
    for (let i = 0; i < s.v.length; i++) {
      for (let qi = 0; qi < s.q.length; qi++) {
        const p = preview(s, i, qi);
        if (p.ok) out.push({ vehicle: i, queue: qi, match: p.match, boards: p.boards });
      }
    }
    return out;
  }

  /* ---------------- deterministic resolution ---------------- */
  function clone(s) {
    return {
      cfgId: s.cfgId, version: s.version, seed: s.seed,
      holdingCap: s.holdingCap, moveLimit: s.moveLimit,
      tick: s.tick, q: s.q.map(l => l.slice()), h: s.h.slice(),
      v: s.v.map(x => ({ c: x.c, cap: x.cap, n: x.n })),
      boarded: s.boarded, dispatches: s.dispatches, invalid: s.invalid,
      fullBoards: s.fullBoards, holdingAccum: s.holdingAccum,
      status: s.status, reason: s.reason, par: s.par
    };
  }

  function dispatch(s, vi, qi) {
    const p = preview(s, vi, qi);
    if (!p.ok) {
      const ns = clone(s);
      ns.invalid++;
      return { ok: false, reason: p.reason, state: ns, events: null };
    }
    const ns = clone(s);
    ns.tick++;
    ns.dispatches++;
    const veh = ns.v[vi];
    veh.n--;
    let room = veh.cap;
    const events = { boarded: [], displaced: [], fromHolding: 0, full: false, match: p.match, queue: qi, color: veh.c };
    const lane = ns.q[qi];
    if (lane[0] === veh.c) {
      while (lane.length && lane[0] === veh.c && room > 0) {
        events.boarded.push({ queue: qi, color: lane.shift() });
        room--; ns.boarded++;
      }
      while (room > 0 && ns.h.length) {
        ns.h.shift(); room--; ns.boarded++; events.fromHolding++;
      }
    } else {
      events.displaced.push({ queue: qi, color: lane.shift() });
      ns.h.push(events.displaced[0].color);
    }
    if (room === 0) { events.full = true; ns.fullBoards++; }
    ns.holdingAccum += ns.h.length;
    const empty = ns.q.every(l => l.length === 0) && ns.h.length === 0;
    if (empty) { ns.status = 'won'; ns.reason = 'all-passengers-boarded'; }
    else if (ns.h.length > ns.holdingCap) { ns.status = 'lost'; ns.reason = 'holding-overflow'; }
    else if (ns.moveLimit && ns.dispatches >= ns.moveLimit) { ns.status = 'lost'; ns.reason = 'move-limit'; }
    else if (legalActions(ns).length === 0) { ns.status = 'lost'; ns.reason = 'no-legal-dispatch'; }
    return { ok: true, state: ns, events };
  }

  /* ---------------- scoring (integers only) ---------------- */
  function scoreComponents(s) {
    const board = s.boarded * 10;
    const full = s.fullBoards * 25;
    const spare = s.status === 'won'
      ? s.v.reduce((acc, x) => acc + x.n, 0) * 15 : 0;
    const invalidPenalty = s.invalid * 20;
    const holdingPenalty = s.holdingAccum * 2;
    const completion = s.status === 'won' ? 1 : 0;
    const total = board + full + spare - invalidPenalty - holdingPenalty;
    return { completion, board, full, spare, invalidPenalty, holdingPenalty, total };
  }

  // Tie-break order: completion, total, fewer invalid, lower tick count, session id.
  function compareResults(a, b) {
    if (a.completion !== b.completion) return b.completion - a.completion;
    if (a.total !== b.total) return b.total - a.total;
    if (a.invalid !== b.invalid) return a.invalid - b.invalid;
    if (a.ticks !== b.ticks) return a.ticks - b.ticks;
    return String(a.session).localeCompare(String(b.session));
  }

  /* ---------------- solver (content validation + hints) ----------------
     Best-first search: minimizes remaining passengers, then holding load. */
  function solve(start, nodeCap) {
    const remaining = s => s.q.reduce((a, l) => a + l.length, 0) + s.h.length;
    const prio = (s, depth) => remaining(s) * 10 + s.h.length * 3 + depth;
    const heap = [{ s: start, first: null, depth: 0, p: prio(start, 0) }];
    const seen = new Set([stateKey(start)]);
    let nodes = 0, best = null;
    function push(n) {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (heap[par].p <= heap[i].p) break;
        const t = heap[par]; heap[par] = heap[i]; heap[i] = t; i = par;
      }
    }
    function pop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < heap.length && heap[l].p < heap[m].p) m = l;
          if (r < heap.length && heap[r].p < heap[m].p) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    }
    while (heap.length) {
      const node = pop();
      if (best && node.depth >= best.moves) continue;
      for (let i = 0; i < node.s.v.length; i++) {
        if (node.s.v[i].n < 1) continue;
        for (let qi = 0; qi < node.s.q.length; qi++) {
          const r = dispatch(node.s, i, qi);
          if (!r.ok) continue;
          if (++nodes > nodeCap) return best;
          const first = node.first || { v: i, q: qi };
          if (r.state.status === 'won') {
            const cand = { moves: node.depth + 1, firstMove: first };
            if (!best || cand.moves < best.moves) best = cand;
            continue;
          }
          if (r.state.status === 'active') {
            const k = stateKey(r.state);
            if (!seen.has(k)) {
              seen.add(k);
              push({ s: r.state, first, depth: node.depth + 1, p: prio(r.state, node.depth + 1) });
            }
          }
        }
      }
    }
    return best;
  }

  // Constructive solvability proof: repeatedly dispatch a vehicle whose color
  // matches some queue front. Returns dispatch count, or 0 if it stalls.
  function greedySolve(start) {
    let s = start, moves = 0;
    const cap = 10000;
    while (s.status === 'active' && moves < cap) {
      let done = false;
      for (let qi = 0; qi < s.q.length && !done; qi++) {
        if (!s.q[qi].length) continue;
        const c = s.q[qi][0];
        for (let i = 0; i < s.v.length; i++) {
          if (s.v[i].c === c && s.v[i].n > 0) {
            const r = dispatch(s, i, qi);
            if (r.ok) { s = r.state; moves++; done = true; }
            break;
          }
        }
      }
      if (!done) return 0;
    }
    return s.status === 'won' ? moves : 0;
  }

  // Hint: first move of the best known solution from the current state.
  // Falls back to the constructive always-match move when search is too deep.
  function hint(s) {
    const sol = solve(s, 60000);
    if (sol) return sol.firstMove;
    for (let qi = 0; qi < s.q.length; qi++) {
      if (!s.q[qi].length) continue;
      const c = s.q[qi][0];
      for (let i = 0; i < s.v.length; i++) {
        if (s.v[i].c === c && s.v[i].n > 0) return { v: i, q: qi };
      }
    }
    const la = legalActions(s);
    return la.length ? { v: la[0].vehicle, q: la[0].queue } : null;
  }

  /* ---------------- level registry ---------------- */
  const THEMES = ['plaza', 'garden', 'harbor', 'market', 'night'];
  const JOURNEY_STAGES = 40;
  function journeyConfig(stage) {
    const p = difficultyParams(stage);
    return genConfig('journey-' + stage, (1000003 + stage * 101) >>> 0, p, THEMES[Math.floor(stage / 8) % THEMES.length]);
  }
  function dailyConfig(dateInt) {
    const stage = 10 + (dateInt % 15); // mid difficulty band
    const p = difficultyParams(stage);
    return genConfig('daily-' + dateInt, (dateInt * 2654435761) >>> 0, p, THEMES[dateInt % THEMES.length]);
  }
  function practiceConfig(difficulty, seed) {
    const stage = { easy: 2, normal: 12, hard: 26, expert: 36 }[difficulty] || 12;
    const p = difficultyParams(stage);
    return genConfig('practice-' + difficulty + '-' + seed, seed >>> 0, p, THEMES[seed % THEMES.length]);
  }
  function challengeConfig(seed) {
    const p = difficultyParams(30 + (seed % 8));
    p.moveLimit = 1;
    return genConfig('challenge-' + seed, (seed * 2246822519) >>> 0, p, THEMES[(seed + 2) % THEMES.length]);
  }
  function tutorialConfig(lesson) {
    const base = difficultyParams(0);
    const cfgs = [
      genConfig('learn-1', 42, Object.assign({}, base, { queueCount: 2, colorCount: 1, holdingCap: 6, queueLenMin: 2, queueLenMax: 2, capacityMin: 2, capacityMax: 2 }), 'plaza'),
      genConfig('learn-2', 77, Object.assign({}, base, { queueCount: 3, colorCount: 2, holdingCap: 4, queueLenMin: 3, queueLenMax: 3, capacityMin: 2, capacityMax: 3 }), 'plaza'),
      genConfig('learn-3', 113, Object.assign({}, base, { queueCount: 4, colorCount: 3, holdingCap: 4 }), 'plaza')
    ];
    return cfgs[Math.max(0, Math.min(2, lesson))];
  }

  /* ---------------- replay envelope ---------------- */
  function replayEnvelope(cfg, state0, commands, finalState, sessionId) {
    return {
      schema: 1, rulesVersion: RULES_VERSION, contentVersion: CONTENT_VERSION,
      cfgId: cfg.id, seed: cfg.seed, initialHash: hashState(state0),
      commands: commands.map(c => ({ id: c.id, tick: c.tick, v: c.v, q: c.q })),
      finalHash: hashState(finalState),
      score: scoreComponents(finalState),
      result: finalState.status, reason: finalState.reason,
      ticks: finalState.tick, session: sessionId || 'local'
    };
  }

  // Re-simulate an envelope; returns { valid, reason, state }.
  function verifyReplay(env, state0) {
    if (!env || env.schema !== 1 || env.rulesVersion !== RULES_VERSION) return { valid: false, reason: 'bad-schema' };
    if (!state0 || hashState(state0) !== env.initialHash) return { valid: false, reason: 'initial-hash-mismatch' };
    if (!Array.isArray(env.commands) || env.commands.length > 10000) return { valid: false, reason: 'bad-commands' };
    let s = state0;
    const seenIds = new Set();
    for (const c of env.commands) {
      if (typeof c.v !== 'number' || typeof c.q !== 'number' ||
          c.v < 0 || c.v >= 16 || c.q < 0 || c.q >= 16 || seenIds.has(c.id)) {
        return { valid: false, reason: 'bad-command' };
      }
      seenIds.add(c.id);
      const r = dispatch(s, c.v, c.q);
      s = r.state; // invalid attempts are part of the deterministic record
    }
    if (hashState(s) !== env.finalHash) return { valid: false, reason: 'final-hash-mismatch' };
    const sc = scoreComponents(s);
    if (sc.total !== env.score.total) return { valid: false, reason: 'score-mismatch' };
    return { valid: true, state: s };
  }

  return {
    RULES_VERSION, CONTENT_VERSION, THEMES, JOURNEY_STAGES,
    rng, fnv1a, stateKey, hashState,
    difficultyParams, genConfig, genLevel, initialState,
    preview, legalActions, dispatch, clone,
    scoreComponents, compareResults,
    solve, hint,
    journeyConfig, dailyConfig, practiceConfig, challengeConfig, tutorialConfig,
    replayEnvelope, verifyReplay
  };
});
