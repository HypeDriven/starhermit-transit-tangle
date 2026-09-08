/**
 * Transit Tangle — authoritative server API tests (node tests/server.test.mjs).
 *
 * Spawns the real server.js on an ephemeral port and verifies:
 *   - a valid replay envelope is accepted and re-simulated
 *   - client-claimed ticks/result are NOT trusted (they are not covered by the
 *     replay hash); the stored entry reflects the verified state
 *   - tampered scores are rejected
 *   - leaderboard ordering follows the spec tie-break: completion, score,
 *     fewer invalid actions, lower tick count, session id
 *   - achievement unlocks are idempotent
 * Uses and cleans up an isolated temporary database.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = require(path.join(ROOT, 'rules.js'));

const testData = await mkdtemp(path.join(tmpdir(), 'transit-tangle-test-'));
process.env.TRANSIT_TANGLE_DATA_DIR = testData;
process.env.PORT = '0';
const server = require(path.join(ROOT, 'server.js'));
await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await new Promise((r) => setTimeout(r, 400)); // let the debounced db write land first
  await rm(testData, { recursive: true, force: true });
});

function solveToEnd(cfg) {
  const s0 = R.genLevel(cfg);
  const cmds = [];
  let s = s0;
  while (s.status === 'active' && cmds.length < 500) {
    const h = R.hint(s) || (() => { const la = R.legalActions(s); return { v: la[0].vehicle, q: la[0].queue }; })();
    const r = R.dispatch(s, h.v, h.q);
    cmds.push({ id: 'c' + cmds.length, tick: s.tick + 1, v: h.v, q: h.q });
    s = r.state;
  }
  return { s0, cmds, final: s };
}

async function post(pathname, body) {
  const r = await fetch(BASE + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

test('valid replay accepted; claimed ticks/result not trusted', async () => {
  const cfg = R.journeyConfig(0);
  const { s0, cmds, final } = solveToEnd(cfg);
  assert.equal(final.status, 'won');
  const env = R.replayEnvelope(cfg, s0, cmds, final, 'srv-test-a');
  env.ticks = 1;          // lie: claim fewer ticks than the hash covers
  env.result = 'lost';    // lie: claim a loss
  const res = await post('/api/scores', { name: 'tester', assists: 1, replay: env });
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const board = await (await fetch(BASE + '/api/scores?board=journey')).json();
  const row = board.scores.find((s) => s.session === 'srv-test-a');
  assert.ok(row, 'entry stored');
  assert.equal(row.ticks, final.tick, 'ticks come from the verified state, not the claim');
  assert.equal(row.result, 'won', 'result comes from the verified state, not the claim');
  assert.equal(row.score, env.score.total);
});

test('tampered score rejected', async () => {
  const cfg = R.journeyConfig(1);
  const { s0, cmds, final } = solveToEnd(cfg);
  const env = R.replayEnvelope(cfg, s0, cmds, final, 'srv-test-b');
  env.score.total += 1000;
  const res = await post('/api/scores', { name: 'cheat', replay: env });
  assert.equal(res.status, 422);
  assert.equal(res.json.error, 'replay-invalid');
});

test('unranked content rejected', async () => {
  const res = await post('/api/scores', { name: 'x', replay: { cfgId: 'practice-easy-1' } });
  assert.equal(res.status, 422);
  assert.equal(res.json.error, 'unranked-content');
});

test('leaderboard tie-break: completion, score, invalid, ticks, session', async () => {
  // two real validated wins on the shared journey board
  for (const [stage, sess] of [[2, 'srv-sort-a'], [3, 'srv-sort-b']]) {
    const cfg = R.journeyConfig(stage);
    const { s0, cmds, final } = solveToEnd(cfg);
    const env = R.replayEnvelope(cfg, s0, cmds, final, sess);
    const res = await post('/api/scores', { name: sess, replay: env });
    assert.equal(res.status, 200);
  }
  const board = await (await fetch(BASE + '/api/scores?board=journey')).json();
  const rows = board.scores.filter((s) => String(s.session).startsWith('srv-'));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const key = (r) => [r.result === 'won' ? 1 : 0, r.score, -r.invalid, -r.ticks];
    const ka = key(a), kb = key(b);
    for (let k = 0; k < ka.length; k++) {
      if (ka[k] !== kb[k]) {
        assert.ok(ka[k] > kb[k], `row ${i - 1} should outrank row ${i} on component ${k}`);
        break;
      }
    }
  }
});

test('achievement unlock is idempotent', async () => {
  const a = await post('/api/achievements', { profile: 'srv-prof', key: 'first_completion' });
  const b = await post('/api/achievements', { profile: 'srv-prof', key: 'first_completion' });
  assert.equal(a.status, 200);
  assert.deepEqual(b.json.unlocked, ['first_completion']);
  const got = await (await fetch(BASE + '/api/achievements?id=srv-prof')).json();
  assert.deepEqual(got.unlocked, ['first_completion']);
  const bad = await post('/api/achievements', { profile: 'srv-prof', key: 'BAD KEY!' });
  assert.equal(bad.status, 400);
});

test('platform time endpoint', async () => {
  const j = await (await fetch(BASE + '/api/v1/time')).json();
  assert.ok(Math.abs(j.now - Date.now()) < 5000);
});
