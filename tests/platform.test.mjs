// platform.test.mjs — platform.js over starhermit-sdk.js with a stubbed fetch
// and launch hash: token read, nickname, cloud-save path game:<slug>
// round-trip, settings patch, controls, and no network standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SDK = require('../starhermit-sdk.js');
const TTPlatform = require('../platform.js');
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `x.${b64url({ sub: 'u-12345678', game_scope: 'transit-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;

function setup(hash, hostname = 'transit-test.starhermit.com') {
  const calls = [], store = new Map(), etags = new Map();
  let version = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Dispatcher' });
    if (path.includes('/cloud-saves/')) {
      if (path.endsWith('/info')) {
        const slot = path.slice(0, -5);
        return json(store.has(slot) ? { exists: true, etag: etags.get(slot) } : { exists: false });
      }
      if (init.method === 'PUT') {
        const match = init.headers?.['If-Match'];
        if (match && match !== etags.get(path)) return new Response(JSON.stringify({ etag: etags.get(path) }), { status: 412 });
        store.set(path, JSON.parse(init.body).dataBase64);
        etags.set(path, '"v' + (++version) + '"');
        return json({ etag: etags.get(path) });
      }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { palette: 'tritan' } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'camera', codes: ['KeyV'] }] });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  const sh = SDK.create({ window: win, fetch });
  // Another device writing the slot: this client's next conditional write is refused (412).
  const otherDevice = async (doc) => {
    const zipped = await sh._zip('save.json', new TextEncoder().encode(JSON.stringify(doc)));
    const slot = [...store.keys()][0];
    store.set(slot, Buffer.from(zipped).toString('base64'));
    etags.set(slot, '"v' + (++version) + '"');
  };
  return { calls, sh, location, otherDevice, P: TTPlatform.create({ sh, fetch, hostname }) };
}

test('launch token read + stripped; nickname from profile', async () => {
  const { P, sh, location } = setup('#game_token=' + JWT);
  assert.equal(P.init(), true);
  assert.equal(P.net.slug, 'transit-test');
  assert.equal(location.hash, '');
  assert.equal(await P.loadProfile(), 'Dispatcher');
  assert.equal(P.displayName(), 'Dispatcher');
  sh.signOut();
});

test('cloud save round-trips through game:<slug>', async () => {
  const { P, sh, calls } = setup('#game_token=' + JWT);
  P.init();
  assert.equal(await P.loadCloudSave(), null);
  P.queueCloudSave({ v: 1, progress: { wins: 9 } }, {});
  await P.flushCloudSave();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:transit-test')));
  assert.equal(put.auth, 'Bearer ' + JWT);
  assert.equal((await P.loadCloudSave()).progress.wins, 9);
  sh.signOut();
});

test('settings KV, controls, invite link', async () => {
  const { P, sh, calls } = setup('#game_token=' + JWT);
  P.init();
  assert.deepEqual(await P.loadPlatformSettings({ palette: 'default', music: 50 }), { palette: 'tritan' });
  P.pushSettings({ palette: 'tritan', music: 10 });
  await new Promise((r) => setTimeout(r, 900));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/transit-test/settings'));
  assert.deepEqual(JSON.parse(patch.body), { settings: { music: 10 } });
  const b = await P.loadBindings();
  assert.deepEqual(b.camera, ['KeyV']);
  assert.deepEqual(b.undo, ['KeyU']);
  assert.match(P.inviteLink(), /game-invite\/u-12345678\/transit-test$/);
  sh.signOut();
});

test('standalone: no network calls', async () => {
  const { P, calls } = setup('', 'example.com');
  assert.equal(P.init(), false);
  assert.equal(P.canSignIn(), false);
  assert.equal(P.inviteLink(), null);
  assert.equal(await P.loadCloudSave(), null);
  P.queueCloudSave({}, {});
  P.pushSettings({ music: 1 });
  assert.equal(await P.loadPlatformBoard(), null);
  assert.deepEqual((await P.loadBindings()).undo, ['KeyU']);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(calls.length, 0);
});

test('sign-in offered on the platform host without a token', () => {
  const { P, calls } = setup('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  P.init();
  assert.equal(P.canSignIn(), true);
  assert.equal(calls.length, 0);
});

test('a save that loses to another device emits saveconflict; mergeProgress keeps both devices\' progress', async () => {
  const { P, sh, otherDevice } = setup('#game_token=' + JWT);
  try {
    P.init();
    await P.loadCloudSave();
    const mine = { journeyDone: [0, 1, 2], journeyUnlocked: 3, tutorialDone: true, daysPlayed: [20261016], wins: 5, streak: 2, best: { journey: 900 } };
    P.queueCloudSave({ v: 1, progress: mine }, {});
    assert.equal(await P.flushCloudSave(), true);
    await otherDevice({ v: 1, progress: { journeyDone: [0, 5], journeyUnlocked: 6, tutorialDone: false, daysPlayed: [20261017], wins: 7, streak: 0, best: { journey: 700, daily: 400 } } });
    let conflicts = 0;
    P.on('saveconflict', () => { conflicts++; });
    P.queueCloudSave({ v: 1, progress: mine }, {});
    assert.equal(await P.flushCloudSave(), false);
    assert.equal(conflicts, 1);
    const remote = await P.loadCloudSave();
    const merged = TTPlatform.mergeProgress(remote.progress, mine);
    assert.deepEqual(merged.journeyDone, [0, 1, 2, 5]);
    assert.equal(merged.journeyUnlocked, 6);
    assert.equal(merged.tutorialDone, true);
    assert.deepEqual(merged.daysPlayed.sort(), [20261016, 20261017]);
    assert.equal(merged.wins, 7);
    assert.deepEqual(merged.best, { journey: 900, daily: 400 });
    P.queueCloudSave({ v: 1, progress: merged }, {});
    assert.equal(await P.flushCloudSave(), true);
  } finally { sh.signOut(); }
});
