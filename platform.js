'use strict';
/* Transit Tangle — StarHermit platform adapter (browser + Node tests).
   Thin layer over window.StarHermit (starhermit-sdk.js): StarHermit.init()
   reads #game_token= (library launch) or #access_token= (sign-in return)
   once, strips it, keeps it in memory and renews it; the slug comes from the
   game_scope claim. Covers nickname, the game:<slug> cloud-save slot, the
   settings KV, controls, invite link and the read-only platform board.
   Without a token nothing touches the network on any host (loopback
   included); the client never calls this repo's own server.js routes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TTPlatform = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Preferences mirrored to the platform settings KV (analytics consent stays per device).
  const PREF_KEYS = ['music', 'fx', 'ambience', 'palette', 'quality', 'reducedMotion', 'highContrast',
    'largeText', 'leftHand', 'captions', 'haptics', 'gfx'];
  // Keyboard actions (KeyboardEvent.code) — mirrors control.* in starhermit.txt.
  const DEFAULT_BINDINGS = {
    prev: ['ArrowLeft', 'ArrowUp'], next: ['ArrowRight', 'ArrowDown'], confirm: ['Enter', 'Space'],
    cancel: ['Escape'], undo: ['KeyU'], hint: ['KeyH'], camera: ['KeyR'], pause: ['KeyP']
  };

  /** env: { sh } */
  function create(env) {
    const SH = env.sh || null;
    let bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    let pushedPrefs = {}, prefTimer = null;

    const net = {
      nickname: null,
      get hosted() { return !!(SH && SH.signedIn); },
      get slug() { return SH ? SH.slug : null; },
      get userId() { return net.hosted ? SH.userId : null; },
      syncState: 'offline', // saving | synced | offline — shown beside the player name
      now() { return Date.now(); } // local clock
    };

    function pickPrefs(st) {
      const out = {};
      PREF_KEYS.forEach(k => { if (st && st[k] !== undefined) out[k] = st[k]; });
      return out;
    }

    const P = {
      net, PREF_KEYS, DEFAULT_BINDINGS,
      get bindings() { return bindings; },
      canSignIn() { return !!(SH && SH.canSignIn()); },
      signIn() { return !!(SH && SH.signIn()); },
      inviteLink() { return net.hosted ? SH.inviteLink() : null; },
      on(type, fn) { if (SH) SH.on(type, fn); },
      /** Read the launch token; returns true when signed in. */
      init() { if (SH) SH.init(); return net.hosted; },
      displayName() {
        return net.hosted ? (net.nickname || 'Player ' + String(net.userId || '').slice(0, 6)) : 'guest';
      },
      async profileNickname(userId) {
        const p = SH && userId != null ? await SH.profile(String(userId)) : null;
        return p ? p.displayName : 'Player';
      },
      async loadProfile() {
        if (!net.hosted) return null;
        net.nickname = await P.profileNickname(net.userId);
        return net.nickname;
      },
      async loadCloudSave() {
        if (!net.hosted) return null;
        const doc = await SH.loadJSON();
        net.syncState = 'synced';
        return doc && typeof doc === 'object' ? doc : null;
      },
      /** Debounced save of the store doc + PATCH of changed preferences. */
      queueCloudSave(doc, settings) {
        if (!net.hosted) return;
        net.syncState = 'saving';
        SH.saveJSON(doc, 2000);
        P.pushSettings(settings);
      },
      flushCloudSave() { return net.hosted ? SH.flushSave(true) : Promise.resolve(false); },
      /** Platform-stored preferences {key: value} that win over local ones. */
      async loadPlatformSettings(settings) {
        if (!net.hosted) return null;
        const remote = await SH.getSettings();
        const patch = {};
        PREF_KEYS.forEach(k => { if (remote && remote[k] != null) patch[k] = remote[k]; });
        pushedPrefs = Object.assign(pickPrefs(settings), patch);
        return patch;
      },
      pushSettings(settings) {
        if (!net.hosted) return;
        clearTimeout(prefTimer);
        prefTimer = setTimeout(() => {
          const prefs = pickPrefs(settings), diff = {};
          PREF_KEYS.forEach(k => {
            if (JSON.stringify(prefs[k]) !== JSON.stringify(pushedPrefs[k])) diff[k] = prefs[k] === undefined ? null : prefs[k];
          });
          if (!Object.keys(diff).length) return;
          Object.assign(pushedPrefs, diff);
          SH.patchSettings(diff);
        }, 800);
      },
      async loadBindings() {
        if (net.hosted) bindings = await SH.loadBindings(DEFAULT_BINDINGS);
        return bindings;
      },
      /** Post a finished round's total to the high-score board (score-script.js);
       *  resolves { posted, rank } (rank or null). No request standalone. */
      async submitScore(total) {
        if (!net.hosted) return { posted: false, rank: null };
        let keys = [];
        try { keys = await SH.submitScores({ 'high-score': total }); } catch (e) { keys = []; }
        if (!keys || keys.indexOf('high-score') < 0) return { posted: false, rank: null };
        try {
          const r = await SH.leaderboard('high-score', { pageSize: 100 });
          const me = ((r && r.items) || []).find(i => i.userId === SH.userId);
          return { posted: true, rank: me ? me.rank : null };
        } catch (e) { return { posted: true, rank: null }; }
      },
      /** Platform board (the game's first): { entries } or null when none is declared. */
      async loadPlatformBoard() {
        if (!net.hosted) return null;
        const r = await SH.leaderboard(null, { pageSize: 50 });
        return r && r.board ? { entries: r.items || [] } : null;
      }
    };
    return P;
  }

  return { create, PREF_KEYS, DEFAULT_BINDINGS };
});
