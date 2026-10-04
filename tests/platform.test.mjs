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
  const calls = [], store = new Map();
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const path = url.split('?')[0];
    const json = (o) => new Response(JSON.stringify(o));
    if (path.endsWith('/profile')) return json({ nickname: 'Dispatcher' });
    if (path.includes('/cloud-saves/')) {
      if (init.method === 'PUT') { store.set(path, JSON.parse(init.body).dataBase64); return new Response(null, { status: 204 }); }
      return store.has(path) ? new Response(Buffer.from(store.get(path), 'base64')) : new Response(null, { status: 404 });
    }
    if (path.endsWith('/settings')) return init.method === 'PATCH' ? new Response(null, { status: 204 }) : json({ settings: { palette: 'tritan' } });
    if (path.endsWith('/controls')) return json({ actions: [{ action: 'camera', codes: ['KeyV'] }] });
    return new Response(null, { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname };
  const win = { location, history: { state: null, replaceState: (_s, _t, u) => { location.hash = u.includes('#') ? u.slice(u.indexOf('#')) : ''; } } };
  const sh = SDK.create({ window: win, fetch });
  return { calls, sh, location, P: TTPlatform.create({ sh, fetch, hostname }) };
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
  const { P, calls } = setup('');
  P.init();
  assert.equal(P.canSignIn(), true);
  assert.equal(calls.length, 0);
});
