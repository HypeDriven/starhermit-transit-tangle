'use strict';
/* Transit Tangle — authoritative server (Node stdlib only).
   - Serves the static game distribution from this directory.
   - GET  /api/v1/time            platform time for countdown/daily sync
   - GET  /api/health             liveness
   - GET  /api/scores?board=X     leaderboard (global | daily:YYYYMMDD | challenge | friends is client-filtered)
   - POST /api/scores             submit a replay envelope; validated by full re-simulation
   - GET  /api/achievements?id=X  achievement state for a profile id
   - POST /api/achievements       idempotent unlock { profile, key }
   Ranked boards (daily, challenge, journey) are validated against the shared
   rules engine; impossible or stale-version scores are rejected. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const R = require('./rules.js');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.opus': 'audio/ogg'
};

/* ---------------- durable store ---------------- */
let db = { scores: [], achievements: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(db.scores) || typeof db.achievements !== 'object') throw new Error('shape');
} catch (e) { /* fresh start */ }
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  }, 250);
}

/* ---------------- rate limiting (per IP, per minute) ---------------- */
const buckets = new Map();
function rateOk(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > 60000) { b = { start: now, n: 0 }; buckets.set(ip, b); }
  return ++b.n <= 120;
}

/* ---------------- content registry (ranked boards only) ---------------- */
function configForId(cfgId) {
  let m;
  if ((m = /^journey-(\d+)$/.exec(cfgId))) {
    const s = +m[1];
    if (s < 0 || s >= R.JOURNEY_STAGES) return null;
    return R.journeyConfig(s);
  }
  if ((m = /^daily-(\d{8})$/.exec(cfgId))) return R.dailyConfig(+m[1]);
  if ((m = /^challenge-(\d+)$/.exec(cfgId))) {
    const seed = +m[1];
    if (seed > 1e9) return null;
    return R.challengeConfig(seed);
  }
  return null; // practice/learn are not ranked
}
function boardFor(cfgId) {
  if (cfgId.startsWith('daily-')) return cfgId;
  if (cfgId.startsWith('challenge-')) return 'challenge';
  if (cfgId.startsWith('journey-')) return 'journey';
  return 'global';
}

/* ---------------- API ---------------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function handleApi(req, res, urlPath, query) {
  if (urlPath === '/api/v1/time') {
    return sendJson(res, 200, { now: Date.now(), iso: new Date().toISOString() });
  }
  if (urlPath === '/api/health') return sendJson(res, 200, { ok: true, version: R.RULES_VERSION });

  if (urlPath === '/api/scores' && req.method === 'GET') {
    const board = String(query.board || 'global').slice(0, 64);
    const rows = db.scores
      .filter(s => s.board === board)
      .map(s => ({ name: s.name, score: s.score, result: s.result, ticks: s.ticks, invalid: s.invalid, date: s.date, session: s.session }))
      .sort((a, b) => b.score - a.score || a.ticks - b.ticks)
      .slice(0, 50);
    return sendJson(res, 200, { board, validated: true, scores: rows });
  }

  if (urlPath === '/api/scores' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJson(res, 413, { error: 'payload-too-large' });
      let msg;
      try { msg = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad-json' }); }
      const env = msg && msg.replay;
      const name = String((msg && msg.name) || 'guest').slice(0, 24).replace(/[<>&"]/g, '');
      if (!env || typeof env.cfgId !== 'string') return sendJson(res, 400, { error: 'missing-replay' });
      const cfg = configForId(env.cfgId);
      if (!cfg) return sendJson(res, 422, { error: 'unranked-content' });
      if (env.contentVersion !== R.CONTENT_VERSION) return sendJson(res, 422, { error: 'stale-version' });
      let state0;
      try { state0 = R.genLevel(cfg); } catch (e) { return sendJson(res, 422, { error: 'defective-content' }); }
      const v = R.verifyReplay(env, state0);
      if (!v.valid) return sendJson(res, 422, { error: 'replay-invalid', detail: v.reason });
      const entry = {
        board: boardFor(env.cfgId), name, score: env.score.total,
        result: env.result, ticks: env.ticks, invalid: env.score.invalidPenalty / 20,
        assists: 0, ruleset: R.RULES_VERSION, contentVersion: R.CONTENT_VERSION,
        seed: env.seed, session: String(env.session || 'anon').slice(0, 40),
        date: new Date().toISOString()
      };
      db.scores.push(entry);
      if (db.scores.length > 20000) db.scores = db.scores.slice(-20000);
      saveDb();
      return sendJson(res, 200, { ok: true, board: entry.board, score: entry.score });
    });
  }

  if (urlPath === '/api/achievements' && req.method === 'GET') {
    const id = String(query.id || 'guest').slice(0, 40);
    return sendJson(res, 200, { profile: id, unlocked: db.achievements[id] || [] });
  }
  if (urlPath === '/api/achievements' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err) return sendJson(res, 413, { error: 'payload-too-large' });
      let msg;
      try { msg = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad-json' }); }
      const id = String(msg.profile || 'guest').slice(0, 40);
      const key = String(msg.key || '').slice(0, 40);
      if (!/^[a-z0-9_]+$/.test(key)) return sendJson(res, 400, { error: 'bad-key' });
      const set = db.achievements[id] || (db.achievements[id] = []);
      if (!set.includes(key)) { set.push(key); saveDb(); }
      return sendJson(res, 200, { ok: true, unlocked: set }); // idempotent
    });
  }

  return sendJson(res, 404, { error: 'not-found' });
}

function readBody(req, cb) {
  let n = 0;
  const chunks = [];
  req.on('data', c => {
    n += c.length;
    if (n > MAX_BODY) { cb(new Error('too-large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => cb(new Error('read')));
}

/* ---------------- static files ---------------- */
function serveStatic(req, res, urlPath) {
  if (urlPath === '/') urlPath = '/index.html';
  const rel = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.startsWith('data' + path.sep) || rel === 'data') {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || 'local';
  if (!rateOk(ip)) return sendJson(res, 429, { error: 'rate-limited' });
  const u = new URL(req.url, 'http://localhost');
  const urlPath = u.pathname;
  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath, Object.fromEntries(u.searchParams));
  if (req.method !== 'GET') { res.writeHead(405); return res.end('method not allowed'); }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => console.log('Transit Tangle listening on http://localhost:' + PORT));
module.exports = server;
