'use strict';
/* Transit Tangle — client application.
   Modules: store (persistence), net (platform API), audio (synth buses),
   scene (Three.js render), session (game flow), ui (DOM shell), input.
   Rules state changes happen only through TTRules.dispatch. */
(function () {
  const R = window.TTRules;
  const $ = id => document.getElementById(id);

  /* ============================== store ============================== */
  const LS_KEY = 'transit-tangle-v1';
  const defaults = {
    v: 1,
    settings: {
      music: 50, fx: 80, ambience: 40, palette: 'default', quality: 'auto',
      reducedMotion: false, highContrast: false, largeText: false,
      leftHand: false, captions: true, haptics: true, analytics: false,
      gfx: {} // graphics overrides (render_scale, adaptive, show_fps, per-category tiers); preset lives in `quality`
    },
    progress: { journeyDone: [], journeyUnlocked: 0, tutorialDone: false, daysPlayed: [], wins: 0, streak: 0, best: {} },
    achievements: []
  };
  let store;
  try { store = Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
  catch (e) { store = JSON.parse(JSON.stringify(defaults)); }
  store.settings = Object.assign({}, defaults.settings, store.settings);
  store.progress = Object.assign({}, defaults.progress, store.progress);
  function migrateSettings(st) {
    if (st.quality === 'medium') st.quality = 'balanced'; // pre-preset tier name
    if (!['auto', 'low', 'balanced', 'high', 'ultra'].includes(st.quality)) st.quality = 'auto';
    if (!st.gfx || typeof st.gfx !== 'object') st.gfx = {};
  }
  migrateSettings(store.settings);
  function saveStore() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} queueCloudSave(); }
  const sessionId = 's-' + Math.random().toString(36).slice(2, 10);

  // anonymous funnel (local, aggregate, consent-gated)
  function funnel(event) {
    if (!store.settings.analytics) return;
    try {
      const k = 'tt-funnel';
      const f = JSON.parse(localStorage.getItem(k) || '{}');
      f[event] = (f[event] || 0) + 1;
      localStorage.setItem(k, JSON.stringify(f));
    } catch (e) {}
  }

  /* ============================== net (platform adapter) ============================== */
  // platform.js wraps window.StarHermit; this glue binds it to the store and DOM.
  const SH = window.StarHermit || null;
  const ST = (k, vars) => (window.TTSh ? window.TTSh.shText(k, vars) : k);
  const P = window.TTPlatform.create({ sh: SH });
  const net = P.net;
  const displayName = () => P.displayName();
  const profileNickname = id => P.profileNickname(id);
  const loadPlatformBoard = () => P.loadPlatformBoard();
  let bindings = P.bindings;

  function updateAccountLine() {
    const signin = $('btn-signin'), invite = $('btn-invite');
    if (signin) signin.hidden = !P.canSignIn();
    if (invite) invite.hidden = !P.inviteLink();
    const el = $('account-line');
    if (!el) return;
    if (!net.hosted) { el.hidden = true; return; }
    el.hidden = false;
    const syncTxt = {
      saving: 'saving…', synced: 'synced',
      offline: 'offline — will sync when you play'
    }[net.syncState] || net.syncState;
    el.textContent = 'Playing as ' + (net.nickname || '…') + ' · progress ' + syncTxt;
  }
  function storeDoc() {
    return {
      v: store.v, settings: store.settings, progress: store.progress,
      achievements: store.achievements, savedAt: Date.now()
    };
  }
  function applyStoreDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    // conflict resolution prefers the remote copy field-by-field
    store.settings = Object.assign({}, defaults.settings, store.settings, doc.settings);
    migrateSettings(store.settings);
    store.progress = Object.assign({}, defaults.progress, store.progress, doc.progress);
    if (Array.isArray(doc.achievements)) store.achievements = doc.achievements.slice();
    return true;
  }
  function queueCloudSave() {
    if (!net.hosted) return;
    P.queueCloudSave(storeDoc(), store.settings);
    updateAccountLine();
  }
  function flushCloudSave() { P.flushCloudSave(); }
  async function copyInvite() {
    const url = P.inviteLink();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast(ST('copied'), 2600); }
    catch (e) { toast(ST('copyFail', { url }), 6000); }
  }
  function initPlatform() {
    P.init();
    P.on('saved', ok => { net.syncState = ok ? 'synced' : 'offline'; updateAccountLine(); });
    P.on('auth', a => {
      if (!a.signedIn) { net.nickname = null; toast(ST('signedOut'), 4000); }
      updateAccountLine();
    });
    if (!net.hosted) { updateAccountLine(); return Promise.resolve(); }
    // Remote save first, then the settings KV on top (platform preferences
    // win); one saveStore() re-mirrors the merged doc (or seeds an empty slot).
    return Promise.all([
      P.loadProfile().then(updateAccountLine),
      P.loadCloudSave()
        .then(doc => { applyStoreDoc(doc); return P.loadPlatformSettings(store.settings); })
        .then(patch => { Object.assign(store.settings, patch || {}); migrateSettings(store.settings); saveStore(); }),
      P.loadBindings().then(b => { bindings = b; })
    ]).catch(() => {}).then(updateAccountLine);
  }

  /* ============================== audio ============================== */
  // authored one-shots (sfx/manifest.json), keyed by event; variants picked at random
  const SFX = {
    select: ['ui-click', 'vehicle-select'],
    'dispatch': ['dispatch-depart'],
    'dispatch:boarded': ['passengers-board'],
    'dispatch:full': ['queue-full-depart'],
    mismatch: ['mismatch-sigh', 'wrong-vehicle'],
    invalid: ['invalid-buzz', 'move-denied'],
    win: ['win-jingle'],
    lose: ['lose-descend', 'lose-overfill']
  };
  const audio = {
    ctx: null, buses: {}, sfx: {},
    ensure() {
      if (audio.ctx) return;
      try {
        audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (const name of ['music', 'fx', 'ambience']) {
          const g = audio.ctx.createGain();
          g.connect(audio.ctx.destination);
          audio.buses[name] = g;
        }
        audio.applyVolumes();
        audio.startAmbience();
        audio.startMusic();
      } catch (e) {}
    },
    applyVolumes() {
      if (!audio.ctx) return;
      const s = store.settings;
      audio.buses.music.gain.value = s.music / 100 * 0.25;
      audio.buses.fx.gain.value = s.fx / 100 * 0.5;
      audio.buses.ambience.gain.value = s.ambience / 100 * 0.15;
    },
    blip(freq, dur, type, vol, bus) {
      if (!audio.ctx) return;
      try {
        const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
        o.type = type || 'sine'; o.frequency.value = freq;
        const t = audio.ctx.currentTime;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(audio.buses[bus || 'fx']);
        o.start(); o.stop(t + dur);
      } catch (e) {}
    },
    chord(freqs, dur, vol) { freqs.forEach((f, i) => setTimeout(() => audio.blip(f, dur, 'triangle', vol), i * 70)); },
    // lazy fetch/decode/cache of authored clips; plays through the fx bus.
    // Returns true when a decoded sample was started; false while loading or on failure (caller synthesizes instead).
    playSample(name) {
      if (!audio.ctx || !name) return false;
      const cached = audio.sfx[name];
      if (cached instanceof AudioBuffer) {
        try {
          const src = audio.ctx.createBufferSource();
          src.buffer = cached;
          src.connect(audio.buses.fx);
          src.start();
        } catch (e) {}
        return true;
      }
      if (cached === undefined) {
        audio.sfx[name] = fetch('sfx/' + name + '.opus')
          .then(r => { if (!r.ok) throw new Error('http-' + r.status); return r.arrayBuffer(); })
          .then(ab => audio.ctx.decodeAudioData(ab))
          .then(buf => { audio.sfx[name] = buf; })
          .catch(() => { audio.sfx[name] = null; });
      }
      return false;
    },
    sampleFor(event) {
      const list = SFX[event];
      return list ? list[Math.floor(Math.random() * list.length)] : null;
    },
    startAmbience() {
      if (!audio.ctx) return;
      const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
      o.type = 'sine'; o.frequency.value = 110;
      const lfo = audio.ctx.createOscillator(), lg = audio.ctx.createGain();
      lfo.frequency.value = 0.13; lg.gain.value = 12;
      lfo.connect(lg).connect(o.frequency);
      g.gain.value = 0.5;
      o.connect(g).connect(audio.buses.ambience);
      o.start(); lfo.start();
    },
    startMusic() {
      if (!audio.ctx) return;
      // quiet adaptive stem: seeded pentatonic plucks, sparse
      const scale = [262, 294, 330, 392, 440, 523];
      const rr = R.rng(20260829);
      (function tick() {
        if (session.status === 'active') {
          audio.blip(scale[Math.floor(rr() * scale.length)], 0.5, 'sine', 0.10, 'music');
          if (rr() < 0.3) audio.blip(scale[Math.floor(rr() * scale.length)] / 2, 0.8, 'sine', 0.08, 'music');
        }
        setTimeout(tick, 1400 + rr() * 1200);
      })();
    },
    // event map
    select() {
      if (!audio.playSample(audio.sampleFor('select'))) audio.blip(520, 0.08, 'square', 0.25);
      caption('select');
    },
    dispatch(boards, full) {
      const event = full ? 'dispatch:full' : boards > 0 ? 'dispatch:boarded' : 'dispatch';
      if (!audio.playSample(audio.sampleFor(event))) {
        audio.blip(330, 0.12, 'triangle', 0.4);
        if (boards > 0) audio.chord([440, 554, 659].slice(0, Math.min(3, boards)), 0.15, 0.3);
        if (full) audio.chord([523, 659, 784], 0.25, 0.35);
      }
      caption(boards > 0 ? 'boarded ' + boards : 'dispatch');
    },
    mismatch() {
      if (!audio.playSample(audio.sampleFor('mismatch'))) audio.blip(180, 0.25, 'sawtooth', 0.3);
      caption('mismatch — passenger waits');
    },
    invalid() {
      if (!audio.playSample(audio.sampleFor('invalid'))) audio.blip(140, 0.15, 'square', 0.2);
      caption('not allowed');
    },
    win() {
      if (!audio.playSample(audio.sampleFor('win'))) audio.chord([523, 659, 784, 1047], 0.5, 0.4);
      caption('round complete');
    },
    lose() {
      if (!audio.playSample(audio.sampleFor('lose'))) audio.chord([330, 262, 196], 0.5, 0.35);
      caption('round lost');
    }
  };
  function caption(text) {
    if (!store.settings.captions) return;
    toast(text, 900);
  }
  function haptic(ms) {
    if (store.settings.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {}
  }

  /* ============================== palettes & themes ============================== */
  const PALETTES = {
    default: [0xf5a623, 0x29b6f6, 0xef5350, 0x66bb6a, 0xab47bc],
    cvd: [0xe69f00, 0x56b4e9, 0xd55e00, 0x009e73, 0xcc79a7],
    contrast: [0xffb000, 0x0055ff, 0xff2222, 0x008844, 0x8800cc]
  };
  const COLOR_NAMES = ['amber', 'blue', 'coral', 'green', 'violet'];
  const THEMES = {
    plaza: { ground: 0xf2f5f7, sky: 0xdfeaf5, accent: 0x8fb8d8 },
    garden: { ground: 0xe6f2e2, sky: 0xe3f0e6, accent: 0x7fbf8a },
    harbor: { ground: 0xe8eef2, sky: 0xd6e6f0, accent: 0x6f9fc0 },
    market: { ground: 0xf7efe4, sky: 0xf2e8d8, accent: 0xd8a86f },
    night: { ground: 0x2c3550, sky: 0x1d2438, accent: 0x5566aa }
  };
  function colorOf(c) { return PALETTES[store.settings.palette][c - 1]; }

  /* ============================== scene (Three.js) ============================== */
  const canvas = $('c');
  const scene3 = { ready: false };
  let renderer, scene, camera, sunLight, ambLight;
  let boardGroup = null;        // rebuilt per state
  const tweens = [];
  const pickMeshes = { vehicles: [], queues: [] };
  const markerMeshes = [];
  let particles = null;
  let quality = { particleCount: 6 };

  /* ---- graphics quality (model in gfx.js, helpers in gfx-render.js via window.TTGfx) ---- */
  const GFX = window.TTGfx;
  const GS = GFX.gfxStrings(navigator.language);
  const gfx = {
    gpu: '', detected: 'balanced', q: null, composer: null, postKey: null, postFailed: false,
    adaptiveScale: 1, frames: [], fps: 0, size: [0, 0], ratio: 1, envTex: null, time: 0,
    paving: {}, spark: null
  };
  const isTouch = (() => {
    try { return matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent); } catch (e) { return false; }
  })();
  function savedGfx() { return Object.assign({}, store.settings.gfx, { preset: store.settings.quality }); }
  function gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) { return ''; }
  }
  function motionAllowed() {
    if (store.settings.reducedMotion) return false;
    try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
  }
  // HDR multiplier for emissive accents: above the bloom threshold only when bloom is on.
  function glow(k) { return gfx.q && gfx.q.bloom === 'on' ? k : 1; }
  function detailed() { return !!gfx.q && gfx.q.detail === 'detailed' && !!GFX.RoundedBoxGeometry; }

  function computeQuality() {
    const q = GFX.resolve(savedGfx(), gfx.detected);
    gfx.q = q;
    quality.particleCount = GFX.PARTICLES[q.particles];
    document.body.dataset.gfxPreset = q.preset;
    canvas.dataset.gfxPreset = q.preset;
    fpsVisible(q.showFps);
    if (!renderer || !scene) return;
    const size = GFX.SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = size > 0;
    sunLight.castShadow = size > 0;
    if (size > 0 && sunLight.shadow.mapSize.x !== size) {
      sunLight.shadow.mapSize.set(size, size);
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    const env = q.reflections === 'on' && !!GFX.roomEnvironment;
    if (env && !gfx.envTex) {
      try { gfx.envTex = GFX.roomEnvironment(renderer); } catch (e) { gfx.envTex = null; }
    }
    scene.environment = env ? gfx.envTex : null;
    scene.environmentIntensity = 0.32;
    // With image-based fill the hemisphere light is reduced so totals stay close to the plain look.
    ambLight.intensity = scene.environment ? 0.7 : 1.1;
    sunLight.intensity = scene.environment ? 2.15 : 2.4;
    gfx.adaptiveScale = 1;
    gfx.frames = [];
    gfx.postKey = null; // rebuild the post chain on the next frame
    for (const m of Object.values(MAT)) m.needsUpdate = true;
    if (particles) {
      particles.material.size = q.particles === 'high' ? 0.26 : 0.18;
      particles.material.needsUpdate = true;
    }
  }

  function fpsVisible(on) {
    let el = $('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  function buildPost(w, h, ratio) {
    if (gfx.composer) { gfx.composer.dispose(); gfx.composer = null; }
    const q = gfx.q;
    if (!q.post) return;
    if (!GFX.buildComposer) { gfx.postFailed = true; return; }
    try {
      gfx.composer = GFX.buildComposer(renderer, scene, camera, w, h, ratio, q);
      gfx.postFailed = false;
    } catch (e) {
      // Post-processing is an enhancement: render directly and say so in the Graphics panel.
      gfx.composer = null;
      gfx.postFailed = true;
    }
    syncGfxSummary();
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  function adapt(ms) {
    const f = gfx.frames;
    f.push(ms);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    gfx.fps = 1000 / avg;
    const el = $('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(gfx.fps) + ' fps · ' + (Math.round(gfx.ratio * 100) / 100) + '×';
    if (session.screen === 'settings') syncGfxSummary();
    if (!gfx.q.adaptive) return false;
    const before = gfx.adaptiveScale;
    if (avg > 26) gfx.adaptiveScale = Math.max(0.6, gfx.adaptiveScale - 0.1);
    else if (avg < 14 && gfx.adaptiveScale < 1) gfx.adaptiveScale = Math.min(1, gfx.adaptiveScale + 0.05);
    return before !== gfx.adaptiveScale;
  }

  function renderFrame(dt) {
    const q = gfx.q;
    adapt(dt * 1000);
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, q.dpr) * q.scale * gfx.adaptiveScale;
    if (w !== gfx.size[0] || h !== gfx.size[1] || ratio !== gfx.ratio) {
      gfx.size = [w, h];
      gfx.ratio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
    }
    const key = q.post ? [q.ao, q.bloom, q.grade, q.antialias, w, h, ratio].join('|') : 'none';
    if (key !== gfx.postKey) { gfx.postKey = key; buildPost(w, h, ratio); }
    if (gfx.composer) {
      try { gfx.composer.render(dt); return; } catch (e) { gfx.composer.dispose(); gfx.composer = null; gfx.postFailed = true; syncGfxSummary(); }
    }
    renderer.render(scene, camera);
  }

  function graphicsInfo() {
    const px = [Math.round(gfx.size[0] * gfx.ratio), Math.round(gfx.size[1] * gfx.ratio)];
    return {
      gpu: gfx.gpu || GS.unknownGpu, detected: gfx.detected, resolved: gfx.q,
      summary: GFX.describe(gfx.q, px, GS.sum), fps: Math.round(gfx.fps || 0),
      adaptiveScale: Math.round(gfx.adaptiveScale * 100) / 100,
      postFailed: !!(gfx.postFailed || (gfx.q.post && !GFX.buildComposer)), post: !!gfx.composer
    };
  }

  function initScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      $('objective-text').textContent = '3D unavailable: ' + e.message + '. The text board remains fully playable.';
      computeQuality();
      return;
    }
    gfx.gpu = gpuName(renderer);
    gfx.detected = GFX.detectPreset(gfx.gpu, isTouch);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    scene3.camHome = new THREE.Vector3(0, 15, 17);
    camera.position.copy(scene3.camHome);
    camera.lookAt(0, 0, 0.5);

    // warm key light with a shadow box fitted to the board (see fitShadow)
    sunLight = new THREE.DirectionalLight(0xfff4e6, 2.4);
    sunLight.position.set(-8, 18, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.camera.left = -16; sunLight.shadow.camera.right = 16;
    sunLight.shadow.camera.top = 16; sunLight.shadow.camera.bottom = -16;
    scene.add(sunLight, sunLight.target);
    // cool sky / warm ground fill
    ambLight = new THREE.HemisphereLight(0xf4f8ff, 0x8899aa, 1.1);
    scene.add(ambLight);

    // particle pool (bounded, cosmetic only, never raycast)
    const pg = new THREE.BufferGeometry();
    const pos = new Float32Array(200 * 3);
    const col = new Float32Array(200 * 3).fill(1);
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (GFX.sparkTexture) gfx.spark = GFX.sparkTexture();
    particles = new THREE.Points(pg, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.2, map: gfx.spark, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, alphaTest: gfx.spark ? 0.02 : 0
    }));
    particles.frustumCulled = false;
    particles.userData.live = [];
    scene.add(particles);

    canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); scene3.ready = false; });
    canvas.addEventListener('webglcontextrestored', () => { initSceneFlag = true; gfx.envTex = null; gfx.postKey = null; scene3.ready = true; computeQuality(); rebuildAll(); });
    computeQuality();
    scene3.ready = true;
    resize();
  }
  let initSceneFlag = false;

  // Fit the key light's orthographic shadow box tightly around the board.
  function fitShadow(g) {
    if (!sunLight) return;
    const box = new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(-8, 18, 10).normalize();
    sunLight.target.position.copy(sphere.center);
    sunLight.position.copy(sphere.center).addScaledVector(dir, 30);
    const r = sphere.radius + 0.6;
    Object.assign(sunLight.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 30 - r - 2, far: 30 + r + 2 });
    sunLight.shadow.camera.updateProjectionMatrix();
  }

  // shared geometry/material caches
  const GEO = {}, MAT = {};
  function pawnGeo(c) {
    if (!GEO['p' + c]) {
      const shapes = [
        () => new THREE.SphereGeometry(0.28, 16, 12),
        () => new THREE.ConeGeometry(0.26, 0.55, 14),
        () => new THREE.BoxGeometry(0.42, 0.42, 0.42),
        () => new THREE.CapsuleGeometry(0.2, 0.3, 6, 12),
        () => new THREE.CylinderGeometry(0.2, 0.28, 0.5, 12)
      ];
      GEO['p' + c] = shapes[(c - 1) % 5]();
    }
    return GEO['p' + c];
  }
  function sharedGeo(key, make) { return GEO[key] || (GEO[key] = make()); }
  function roundedBox(key, w, h, d, r) {
    return sharedGeo(key, () => (detailed() ? new GFX.RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d)));
  }
  function colorMat(c) {
    const det = detailed();
    const key = 'c' + c + '-' + store.settings.palette + (det ? '-d' : '');
    if (!MAT[key]) {
      // detailed: glossy lacquered toy finish (clearcoat picks up the studio reflections)
      MAT[key] = det
        ? new THREE.MeshPhysicalMaterial({ color: colorOf(c), roughness: 0.42, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.25 })
        : new THREE.MeshStandardMaterial({ color: colorOf(c), roughness: 0.55, metalness: 0.05 });
    }
    return MAT[key];
  }
  function plainMat(color, opts) {
    const key = 'm' + color + JSON.stringify(opts || '');
    if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.02 }, opts));
    return MAT[key];
  }
  function physMat(key, opts) {
    if (!MAT[key]) MAT[key] = new THREE.MeshPhysicalMaterial(opts);
    return MAT[key];
  }
  // Emissive-looking accents (markers, lamps): unlit, pushed into HDR when bloom is on.
  function glowMat(color, k, opts) {
    const mat = new THREE.MeshBasicMaterial(Object.assign({ color }, opts));
    mat.color.multiplyScalar(glow(k));
    return mat;
  }
  function groundMat(t, themeName) {
    if (!detailed() || !GFX.pavingTexture) return plainMat(t.ground);
    const key = 'ground-' + themeName;
    if (!MAT[key]) {
      if (!gfx.paving[themeName]) gfx.paving[themeName] = GFX.pavingTexture(t.ground, themeName.length * 977);
      const tex = gfx.paving[themeName];
      tex.repeat.set(5, 5);
      MAT[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
    }
    return MAT[key];
  }

  function layoutPositions(n, spacing, z) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * spacing, z });
    return out;
  }

  function rebuildAll() {
    // detail tier swaps geometry: drop cached shapes that depend on it
    for (const k of Object.keys(GEO)) if (k.startsWith('rb-')) { GEO[k].dispose(); delete GEO[k]; }
    buildEnvironment(session.theme || 'plaza'); rebuildBoard(); resize();
  }

  function buildEnvironment(themeName) {
    if (!scene3.ready) return;
    if (scene3.env) { scene.remove(scene3.env); disposeGroup(scene3.env); }
    const t = THEMES[themeName] || THEMES.plaza;
    scene.background = new THREE.Color(t.sky);
    const env = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.5, detailed() ? 96 : 48), groundMat(t, themeName));
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    env.add(ground);
    // plaza ring + decorative planters (deterministic decor stream)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.12, 8, 64), plainMat(t.accent));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
    env.add(ring);
    const decorSeed = ((session.state ? session.state.seed : 7) * 2654435761) >>> 0;
    const dr = R.rng(decorSeed);
    const potGeo = new THREE.CylinderGeometry(0.35, 0.28, 0.5, 10);
    const bushGeo = new THREE.SphereGeometry(0.4, 10, 8);
    const pots = new THREE.InstancedMesh(potGeo, plainMat(0xb08968), 10);
    const bushes = new THREE.InstancedMesh(bushGeo, plainMat(0x6a994e), 10);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 10; i++) {
      const a = dr() * Math.PI * 2, rad = 12.2 + dr() * 1.4;
      m4.makeTranslation(Math.cos(a) * rad, 0.25, Math.sin(a) * rad);
      pots.setMatrixAt(i, m4);
      m4.makeTranslation(Math.cos(a) * rad, 0.75, Math.sin(a) * rad);
      bushes.setMatrixAt(i, m4);
    }
    pots.castShadow = bushes.castShadow = true;
    env.add(pots, bushes);
    // holding lane pad
    const pad = new THREE.Mesh(roundedBox('rb-pad', 10, 0.1, 1.6, 0.04), plainMat(0xe8d9b0, detailed() ? { roughness: 0.7 } : undefined));
    pad.position.set(0, 0.05, 2.6);
    pad.receiveShadow = true;
    env.add(pad);
    if (detailed()) {
      // low bollard lights just inside the plaza ring; warm caps glow under bloom
      const n = 12, poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10), plainMat(0x3a4250, { roughness: 0.45, metalness: 0.5 }), n);
      const bulbMat = glowMat(themeName === 'night' ? 0xffd79a : 0xfff0d0, themeName === 'night' ? 4 : 2.6);
      const bulbs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), bulbMat, n);
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * Math.PI * 2, rad = 12.7;
        m4.makeTranslation(Math.cos(a) * rad, 0.25, Math.sin(a) * rad); poles.setMatrixAt(i, m4);
        m4.makeTranslation(Math.cos(a) * rad, 0.55, Math.sin(a) * rad); bulbs.setMatrixAt(i, m4);
      }
      poles.castShadow = true;
      env.add(poles, bulbs);
      env.userData.bulbs = bulbMat;
      env.userData.bulbBase = bulbMat.color.clone();
      // painted boarding line along the holding lane
      const line = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.012, 0.06), plainMat(0xf2c14e, { roughness: 0.6 }));
      line.position.set(0, 0.106, 2.0);
      env.add(line);
    }
    scene.add(env);
    scene3.env = env;
  }

  function disposeGroup(g) {
    const shared = Object.values(GEO);
    g.traverse(o => {
      if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
      // per-build unlit accent materials are not cached
      if (o.material && o.material.isMeshBasicMaterial && !Object.values(MAT).includes(o.material)) o.material.dispose();
    });
  }

  // Rebuild board meshes from an immutable snapshot (plus simple tween-in).
  function rebuildBoard(prevEvents) {
    if (!scene3.ready || !session.state) return;
    if (boardGroup) { scene.remove(boardGroup); disposeGroup(boardGroup); }
    const s = session.state;
    const g = new THREE.Group();
    const det = detailed();
    const bob = [];
    pickMeshes.vehicles = []; pickMeshes.queues = [];
    markerMeshes.length = 0;

    // queues: platforms + passenger pawns (front nearest camera)
    const qPos = layoutPositions(s.q.length, 2.6, -1.6);
    s.q.forEach((lane, qi) => {
      const plat = new THREE.Mesh(roundedBox('rb-plat', 2.0, 0.18, 6.2, 0.06), plainMat(0xdde5ec, det ? { roughness: 0.6 } : undefined));
      plat.position.set(qPos[qi].x, 0.09, -1.6 - 2.0);
      plat.receiveShadow = true;
      plat.userData.queueIndex = qi;
      g.add(plat);
      pickMeshes.queues.push(plat);
      if (det) {
        // safety stripe at the boarding edge
        const stripe = new THREE.Mesh(sharedGeo('stripe', () => new THREE.BoxGeometry(1.8, 0.012, 0.14)), plainMat(0xf2c14e, { roughness: 0.6 }));
        stripe.position.set(qPos[qi].x, 0.186, -0.72);
        stripe.userData.queueIndex = qi;
        g.add(stripe);
      }
      lane.forEach((c, idx) => {
        const m = new THREE.Mesh(pawnGeo(c), colorMat(c));
        m.position.set(qPos[qi].x, 0.55, -0.9 - idx * 0.95);
        m.castShadow = true;
        m.receiveShadow = det;
        m.userData.queueIndex = qi;
        g.add(m);
        bob.push({ o: m, y: 0.55, ph: qi * 1.7 + idx * 0.9, amp: 0.035 });
        if (prevEvents && prevEvents.displaced.some(d => d.queue === qi) && idx === 0) {
          tweenScaleIn(m);
        }
      });
    });

    // holding lane pawns
    s.h.forEach((c, i) => {
      const m = new THREE.Mesh(pawnGeo(c), colorMat(c));
      m.position.set(-4.5 + i * 1.0, 0.55, 2.6);
      m.castShadow = true;
      g.add(m);
      bob.push({ o: m, y: 0.55, ph: 5 + i * 1.3, amp: 0.025 });
      if (prevEvents && prevEvents.displaced.length && i === s.h.length - 1) tweenFrom(m, qPos[prevEvents.displaced[0].queue].x, -0.9);
    });
    // holding capacity ticks
    for (let i = 0; i < s.holdingCap; i++) {
      const tickm = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, det ? 24 : 16),
        plainMat(i < s.h.length ? 0xd64545 : 0xcccccc));
      tickm.position.set(-4.5 + i * 1.0, 0.12, 2.6);
      g.add(tickm);
    }

    // vehicles at depot
    const vPos = layoutPositions(s.v.length, 2.8, 5.4);
    s.v.forEach((veh, vi) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(roundedBox('rb-body', 1.6, 0.7, 1.0, 0.12), colorMat(veh.c));
      body.position.y = 0.45;
      body.castShadow = true;
      const cab = new THREE.Mesh(roundedBox('rb-cab', 0.7, 0.5, 0.9, 0.08),
        det ? physMat('cab', { color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }) : plainMat(0xffffff));
      cab.position.set(-0.3, 1.0, 0);
      cab.castShadow = det;
      grp.add(body, cab);
      if (det) {
        // window band, wheels and headlamps
        const glass = new THREE.Mesh(sharedGeo('glass', () => new THREE.BoxGeometry(0.74, 0.2, 0.94)),
          physMat('glass', { color: 0x1c2a3a, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }));
        glass.position.set(-0.3, 1.08, 0);
        grp.add(glass);
        const wheelGeo = sharedGeo('wheel', () => new THREE.CylinderGeometry(0.17, 0.17, 0.12, 18).rotateX(Math.PI / 2));
        for (const [wx, wz] of [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]]) {
          const wheel = new THREE.Mesh(wheelGeo, plainMat(0x262a31, { roughness: 0.75 }));
          wheel.position.set(wx, 0.17, wz);
          grp.add(wheel);
        }
        const lampMat = glowMat(0xfff3c4, 3);
        for (const lz of [-0.3, 0.3]) {
          const lamp = new THREE.Mesh(sharedGeo('lamp', () => new THREE.BoxGeometry(0.03, 0.1, 0.16)), lampMat);
          lamp.position.set(-0.815, 0.55, lz);
          grp.add(lamp);
        }
      }
      // remaining-count pips
      for (let k = 0; k < veh.n; k++) {
        const pip = new THREE.Mesh(sharedGeo('pip', () => new THREE.SphereGeometry(0.12, 12, 8)), colorMat(veh.c));
        pip.position.set(-0.5 + k * 0.32, 1.45, 0);
        grp.add(pip);
      }
      // propagate vehicle pick metadata to hit-testable children so a
      // pointer/touch tap on the body/cab/pips selects the vehicle
      grp.traverse(ch => { ch.userData.vehicleIndex = vi; });
      grp.position.set(vPos[vi].x, 0, vPos[vi].z);
      grp.userData.vehicleIndex = vi;
      if (veh.n < 1) grp.children.forEach(ch => { ch.material = plainMat(0x9aa7b2); });
      g.add(grp);
      pickMeshes.vehicles.push(grp);
      if (session.selectedVehicle === vi) {
        const ring = addSelectionRing(g, vPos[vi].x, vPos[vi].z);
        bob.push({ o: grp, y: 0, ph: 0, amp: 0.06, lift: 0.08, ring });
      }
    });

    // legal-target markers when a vehicle is selected
    if (session.selectedVehicle >= 0 && s.status === 'active') {
      s.q.forEach((lane, qi) => {
        if (!lane.length) return;
        const p = R.preview(s, session.selectedVehicle, qi);
        if (!p.ok) return;
        const mk = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24),
          glowMat(p.match ? 0x2f9e63 : 0xc77d0a, 1.8, { side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
        mk.rotation.x = -Math.PI / 2;
        mk.position.set(qPos[qi].x, 0.22, -0.9);
        g.add(mk);
        markerMeshes.push(mk);
      });
    }

    g.userData.bob = bob;
    scene.add(g);
    boardGroup = g;
    fitShadow(g);
    if (prevEvents && prevEvents.boarded.length) {
      const at = prevEvents.queue != null && qPos[prevEvents.queue] ? { x: qPos[prevEvents.queue].x, z: -0.9 } : vPosEvent(prevEvents);
      burst(at, prevEvents.color);
    }
  }
  function vPosEvent(ev) { return { x: 0, z: 3.5 }; }

  function addSelectionRing(g, x, z) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32),
      glowMat(0x3b82f6, 1.8, { side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    g.add(ring);
    return ring;
  }

  // Gentle idle motion: pawns breathe, the selected vehicle lifts, lamps shimmer.
  function stepAmbient(dt) {
    const animated = gfx.q && gfx.q.ambient === 'animated' && motionAllowed();
    const bob = boardGroup && boardGroup.userData.bob;
    if (!animated) {
      if (gfx.time !== 0 && bob) for (const b of bob) { b.o.position.y = b.y + (b.lift || 0); if (b.ring) b.ring.scale.setScalar(1); }
      gfx.time = 0;
      return;
    }
    gfx.time += dt;
    const t = gfx.time;
    if (bob) {
      for (const b of bob) {
        if (tweens.some(tw => tw.obj === b.o.position)) continue;
        b.o.position.y = b.y + (b.lift || 0) + Math.sin(t * 2.2 + b.ph) * b.amp;
        if (b.ring) b.ring.scale.setScalar(1 + 0.05 * Math.sin(t * 4));
      }
    }
    const bulbs = scene3.env && scene3.env.userData.bulbs;
    if (bulbs) bulbs.color.copy(scene3.env.userData.bulbBase).multiplyScalar(0.94 + 0.06 * Math.sin(t * 1.3));
  }

  /* ---- cosmetic tweens (interruptible, snap-safe) ---- */
  function tweenScaleIn(m) {
    if (store.settings.reducedMotion) return;
    m.scale.set(0.01, 0.01, 0.01);
    tweens.push({ obj: m.scale, to: new THREE.Vector3(1, 1, 1), t: 0, dur: 0.25 });
  }
  function tweenFrom(m, x, z) {
    if (store.settings.reducedMotion) return;
    const target = m.position.clone();
    m.position.set(x, 0.55, z);
    tweens.push({ obj: m.position, to: target, t: 0, dur: 0.4 });
  }
  const sparkColor = new THREE.Color();
  function burst(at, colorIndex) {
    if (store.settings.reducedMotion || !particles) return;
    const live = particles.userData.live;
    const base = colorIndex ? colorOf(colorIndex) : 0xffffff;
    for (let i = 0; i < quality.particleCount; i++) {
      // mix of vehicle-coloured confetti and white sparks; HDR under bloom
      sparkColor.set(i % 3 === 0 ? 0xffffff : base).multiplyScalar(glow(2.4));
      live.push({
        x: at.x + (Math.random() - 0.5), y: 1 + Math.random(), z: at.z + (Math.random() - 0.5),
        vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5, t: 0.8,
        r: sparkColor.r, g: sparkColor.g, b: sparkColor.b
      });
    }
    if (live.length > 200) live.splice(0, live.length - 200);
  }
  function stepParticles(dt) {
    if (!particles) return;
    const live = particles.userData.live;
    const attr = particles.geometry.getAttribute('position');
    const cattr = particles.geometry.getAttribute('color');
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t -= dt; p.vy -= 4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.t <= 0 || p.y < 0) live.splice(i, 1);
    }
    for (let i = 0; i < 200; i++) {
      const p = live[i];
      attr.setXYZ(i, p ? p.x : 0, p ? p.y : -10, p ? p.z : 0);
      if (p) cattr.setXYZ(i, p.r, p.g, p.b);
    }
    attr.needsUpdate = true;
    cattr.needsUpdate = true;
  }
  function stepTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
      tw.obj.lerp(tw.to, e);
      if (k >= 1) tweens.splice(i, 1);
    }
  }

  /* ============================== session ============================== */
  const session = {
    screen: 'title',       // boot→title→mode-select→preparing→active↔paused→results
    mode: null, cfg: null, state0: null, state: null, theme: 'plaza',
    commands: [], undoStack: [], selectedVehicle: -1,
    lesson: 0, difficulty: 'normal', seed: 1,
    undoAllowed: false, ranked: false, usedAssist: false,
    get status() { return session.state ? session.state.status : 'idle'; }
  };
  let commandSeq = 0;

  function utcDateInt(d) {
    const dt = d ? new Date(d) : new Date(net.now());
    return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  }

  function startRound(mode, opts) {
    opts = opts || {};
    session.mode = mode;
    session.ranked = (mode === 'daily' || mode === 'challenge' || mode === 'journey');
    session.undoAllowed = (mode === 'practice' || mode === 'learn' || mode === 'journey');
    session.usedAssist = false;
    if (mode === 'journey') {
      session.stage = opts.stage != null ? opts.stage : store.progress.journeyUnlocked;
      session.cfg = R.journeyConfig(session.stage);
    } else if (mode === 'daily') {
      session.cfg = R.dailyConfig(utcDateInt());
    } else if (mode === 'practice') {
      session.difficulty = opts.difficulty || session.difficulty;
      session.seed = opts.seed != null ? opts.seed : (Math.random() * 0xffffffff) >>> 0;
      session.cfg = R.practiceConfig(session.difficulty, session.seed);
    } else if (mode === 'challenge') {
      session.seed = opts.seed != null ? opts.seed : utcDateInt();
      session.cfg = R.challengeConfig(session.seed);
    } else if (mode === 'learn') {
      session.lesson = opts.lesson != null ? opts.lesson : 0;
      session.cfg = R.tutorialConfig(session.lesson);
    }
    session.state0 = R.genLevel(session.cfg);
    session.state = R.clone(session.state0);
    session.theme = session.cfg.theme;
    session.commands = []; session.undoStack = [];
    session.selectedVehicle = -1;
    commandSeq = 0;
    funnel('round-start-' + mode);
    setScreen('preparing');
    buildEnvironment(session.theme);
    rebuildBoard();
    ui.updateAll();
    countdownThen(() => {
      session.screen = 'active';
      ui.updateAll();
      if (mode === 'learn') coachForLesson(session.lesson, 0);
      else hideCoach();
      announce(describeBoard(session.state));
    });
  }

  let countdownTimer = null;
  function countdownThen(cb) {
    const el = $('countdown');
    if (store.settings.reducedMotion) { el.hidden = true; cb(); return; }
    let n = 3;
    el.hidden = false; el.textContent = n;
    announce('Get ready');
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(countdownTimer); el.hidden = true; cb(); }
      else el.textContent = n;
    }, 650);
  }

  function commitDispatch(vi, qi) {
    if (session.screen !== 'active' || !session.state) return;
    const cmdId = sessionId + '-' + (++commandSeq);
    const before = session.state;
    const r = R.dispatch(before, vi, qi);
    session.state = r.state;
    if (!r.ok) {
      audio.invalid(); haptic(30);
      toast(invalidReasonText(r.reason), 1600);
      announce('Not allowed: ' + invalidReasonText(r.reason));
      ui.updateHUD();
      return;
    }
    session.commands.push({ id: cmdId, tick: before.tick + 1, v: vi, q: qi });
    if (session.undoAllowed) {
      session.undoStack.push(before);
      if (session.undoStack.length > 60) session.undoStack.shift();
    }
    session.selectedVehicle = -1;
    const ev = r.events;
    if (ev.match) audio.dispatch(ev.boarded.length, ev.full); else audio.mismatch();
    haptic(ev.match ? 15 : 40);
    rebuildBoard(ev);
    ui.updateAll();
    announceEvent(ev, r.state);
    if (session.mode === 'learn') coachAdvance(ev, r.state);
    if (r.state.status !== 'active') endRound(r.state);
  }

  function invalidReasonText(reason) {
    return {
      'no-such-vehicle': 'no such vehicle', 'not-active': 'round is not active',
      'no-such-queue': 'no such queue', 'vehicle-depleted': 'that vehicle type is used up',
      'queue-empty': 'that queue is already empty'
    }[reason] || reason;
  }

  function undo() {
    if (!session.undoAllowed || session.screen !== 'active' || !session.undoStack.length) {
      toast(session.undoAllowed ? 'Nothing to undo' : 'Undo is not available in this ranked mode', 1400);
      return;
    }
    session.state = session.undoStack.pop();
    session.commands.pop();
    session.selectedVehicle = -1;
    session.usedAssist = true;
    audio.select();
    rebuildBoard();
    ui.updateAll();
    announce('Undone. ' + describeBoard(session.state));
  }

  function doHint() {
    if (session.screen !== 'active' || !session.state) return;
    const h = R.hint(session.state);
    if (!h) { toast('No hint available', 1200); return; }
    session.usedAssist = true;
    const veh = session.state.v[h.v];
    const lane = session.state.q[h.q];
    const msg = 'Try the ' + COLOR_NAMES[veh.c - 1] + ' vehicle on queue ' + (h.q + 1) +
      (lane[0] === veh.c ? ' — colors match' : ' — it will move a passenger to holding');
    toast(msg, 3200);
    announce('Hint: ' + msg);
    audio.select();
  }

  function endRound(finalState) {
    const sc = R.scoreComponents(finalState);
    const won = finalState.status === 'won';
    if (won) audio.win(); else audio.lose();
    funnel('round-end-' + finalState.status);
    // progression
    const today = utcDateInt();
    if (!store.progress.daysPlayed.includes(today)) store.progress.daysPlayed.push(today);
    const newAch = [];
    function award(key, label) {
      if (!store.achievements.includes(key)) {
        store.achievements.push(key);
        newAch.push(label); // local; hosted keeps achievements in the cloud-saved store doc
      }
    }
    if (won) {
      store.progress.wins++;
      store.progress.streak++;
      award('first_completion', 'First completion');
      if (store.progress.streak >= 3) award('streak_3', 'Three-round streak');
      if (store.progress.daysPlayed.length >= 7) award('regular_commuter', 'Played on 7 different days');
      if (session.mode === 'journey') {
        if (!store.progress.journeyDone.includes(session.stage)) store.progress.journeyDone.push(session.stage);
        if (session.stage >= store.progress.journeyUnlocked && session.stage < R.JOURNEY_STAGES - 1) {
          store.progress.journeyUnlocked = session.stage + 1;
        }
        if (session.stage >= 19) award('mechanic_mastery', 'Mechanic mastery (stage 20)');
        if (session.stage >= 35) award('milestone_hard', 'Difficult content milestone');
      }
    } else {
      store.progress.streak = 0;
    }
    if (session.mode === 'learn') {
      if (session.lesson >= 2) { store.progress.tutorialDone = true; award('tutorial_done', 'Tutorial complete'); }
    }
    if (won && session.ranked) {
      store.progress.best = store.progress.best || {};
      const bk = session.mode === 'daily' ? 'daily' : session.mode;
      if (store.progress.best[bk] == null || sc.total > store.progress.best[bk]) store.progress.best[bk] = sc.total;
    }
    saveStore();
    // score submission (ranked modes). Hosted: clients can never submit to a
    // platform leaderboard — the personal best above is cloud-saved instead.
    let submitted = null;
    if (session.ranked && net.hosted) {
      submitted = Promise.resolve('Signed in as ' + displayName() + ' — personal best saved to your profile.');
    } else if (session.ranked) {
      submitted = Promise.resolve('Score kept in your local records.');
    }
    ui.showResults(sc, won, newAch, submitted);
    setScreen('results');
  }

  /* ============================== tutorial coach ============================== */
  const LESSONS = [
    ['Watch a queue’s front passenger. Select a vehicle of the same color, then tap that queue.',
     'Matched passengers board. Clear every passenger to win.'],
    ['Two colors now. Only dispatch when the front passenger matches — a mismatch sends them to the holding lane.',
     'A matched vehicle with spare seats also picks up waiting holding passengers.'],
    ['The holding lane is small. Plan dispatches so waiting passengers get collected before it overflows.',
     'Finish the level to complete your training.']
  ];
  let coachStep = 0;
  function coachForLesson(lesson, step) {
    coachStep = step;
    const el = $('coach');
    const text = 'Lesson ' + (lesson + 1) + ': ' + LESSONS[lesson][Math.min(step, 1)];
    el.textContent = '';
    const span = document.createElement('span'); span.className = 'coach-text'; span.textContent = text;
    // the coach can be tucked away so it never hides a vehicle; the chip
    // brings the text back
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small secondary coach-toggle';
    btn.textContent = 'Hide'; btn.setAttribute('aria-expanded', 'true');
    btn.addEventListener('click', () => {
      const c = el.classList.toggle('collapsed');
      btn.textContent = c ? 'Show lesson' : 'Hide';
      btn.setAttribute('aria-expanded', String(!c));
    });
    el.append(span, btn);
    el.classList.remove('collapsed');
    el.hidden = false;
    announce(text);
  }
  function coachAdvance(ev, state) {
    if (coachStep === 0 && ev.boarded.length > 0) coachForLesson(session.lesson, 1);
    if (state.status === 'won') hideCoach();
  }
  function hideCoach() { $('coach').hidden = true; }

  /* ============================== announcements & mirror ============================== */
  function announce(text) { $('live').textContent = text; }
  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 1500);
  }
  function describeBoard(s) {
    const parts = s.q.map((l, i) =>
      'queue ' + (i + 1) + ': ' + (l.length ? l.map(c => COLOR_NAMES[c - 1]).join(', ') : 'empty'));
    parts.unshift('holding lane ' + s.h.length + ' of ' + s.holdingCap +
      (s.h.length ? ' (' + s.h.map(c => COLOR_NAMES[c - 1]).join(', ') + ')' : ''));
    return parts.join('. ');
  }
  function announceEvent(ev, s) {
    let msg;
    if (ev.match) {
      const nb = ev.boarded.length;
      msg = 'Boarded ' + nb + ' passenger' + (nb === 1 ? '' : 's') +
        (ev.full ? ', vehicle full' : '') +
        (ev.fromHolding ? ', ' + ev.fromHolding + ' collected from holding' : '') + '.';
    } else {
      msg = 'Mismatch — a ' + COLOR_NAMES[ev.displaced[0].color - 1] + ' passenger waits in the holding lane (' + s.h.length + ' of ' + s.holdingCap + ').';
    }
    if (s.h.length >= s.holdingCap - 1 && s.status === 'active') msg += ' Holding lane nearly full!';
    announce(msg + ' ' + (s.q.reduce((a, l) => a + l.length, 0) + s.h.length) + ' passengers remain.');
  }

  /* ============================== UI ============================== */
  const SCREENS = ['screen-title', 'screen-setup', 'screen-journey', 'screen-pause', 'screen-results', 'screen-help', 'screen-settings', 'screen-scores'];
  let helpReturn = 'title', settingsReturn = 'title';

  function setScreen(name) {
    session.screen = name;
    const map = {
      title: 'screen-title', setup: 'screen-setup', journey: 'screen-journey',
      paused: 'screen-pause', results: 'screen-results', help: 'screen-help',
      settings: 'screen-settings', scores: 'screen-scores'
    };
    SCREENS.forEach(id => { $(id).hidden = true; });
    if (map[name]) {
      $(map[name]).hidden = false;
      const focusable = $(map[name]).querySelector('button');
      // keep the panel's heading in view: focusing a button low in a tall,
      // scrolling panel (Done, Close, Play again) must not scroll it away
      if (focusable) focusable.focus({ preventScroll: true });
      const panel = $(map[name]).querySelector('.panel');
      if (panel) panel.scrollTop = 0;
    }
    if (name === 'active' || name === 'preparing') { /* canvas only */ }
    ui.updateHUD();
  }

  const ui = {
    updateAll() { ui.updateHUD(); ui.updateRails(); ui.updateMirror(); ui.updateTitle(); },
    updateHUD() {
      const s = session.state;
      $('hud-mode').textContent = session.mode ? session.mode + (session.mode === 'journey' ? ' ' + (session.stage + 1) : '') : '—';
      $('hud-score').textContent = s ? String(R.scoreComponents(s).total) : '0';
      $('hud-moves').textContent = s ? String(s.dispatches) : '0';
      $('hud-limit').textContent = s && s.moveLimit ? ' / ' + s.moveLimit : '';
      $('hud-holding').textContent = s ? s.h.length + '/' + s.holdingCap : '0/0';
      $('hud-holding').parentElement.classList.toggle('danger', !!s && s.h.length >= s.holdingCap - 1 && s.status === 'active');
      $('hud-left').textContent = s ? String(s.q.reduce((a, l) => a + l.length, 0) + s.h.length) : '0';
      $('hud-objective').textContent = s && s.moveLimit ? 'Clear all within ' + s.moveLimit + ' moves' : 'Clear every queue';
    },
    updateRails() {
      const s = session.state;
      if (!s) return;
      $('progress-text').textContent =
        s.boarded + ' boarded · ' + (s.q.reduce((a, l) => a + l.length, 0) + s.h.length) + ' remaining · ' +
        s.invalid + ' invalid';
      $('par-text').textContent = 'Par ' + (s.par || '—') + (s.moveLimit ? ' · limit ' + s.moveLimit : '');
      $('round-text').textContent = (session.cfg ? session.cfg.id : '') + ' · seed ' + (s.seed >>> 0).toString(16) +
        (session.ranked ? ' · ranked' : ' · unranked');
      $('btn-undo').disabled = $('btn-undo2').disabled = !session.undoAllowed || !session.undoStack.length;
    },
    updateMirror() {
      const s = session.state;
      if (!s) { $('mirror-content').textContent = 'No active round.'; return; }
      $('mirror-content').textContent = describeBoard(s) + '. Vehicles: ' +
        s.v.map(v => COLOR_NAMES[v.c - 1] + ' x' + v.n + ' (seats ' + v.cap + ')').join(', ') + '.';
    },
    updateTitle() {
      $('title-progress').textContent =
        'Journey: ' + store.progress.journeyDone.length + '/' + R.JOURNEY_STAGES + ' stages · wins ' + store.progress.wins +
        (store.progress.streak >= 2 ? ' · streak ' + store.progress.streak : '');
    },
    showResults(sc, won, newAch, submitted) {
      $('results-h').textContent = won ? 'All passengers away!' : 'Round lost';
      $('results-reason').textContent = {
        'all-passengers-boarded': 'Every queue cleared — nice dispatching.',
        'holding-overflow': 'The holding lane overflowed. Dispatch matches to collect waiting passengers sooner.',
        'move-limit': 'Move limit reached. Plan dispatches that board more per move.',
        'no-legal-dispatch': 'No vehicles remain that can act.'
      }[session.state.reason] || session.state.reason;
      const rows = [
        ['Passengers boarded', '+' + sc.board],
        ['Full-vehicle bonuses', '+' + sc.full],
        ['Spare vehicles kept', '+' + sc.spare],
        ['Invalid actions', '-' + sc.invalidPenalty],
        ['Holding-lane congestion', '-' + sc.holdingPenalty],
        ['Total', String(sc.total)]
      ];
      $('results-table').innerHTML = rows.map((r, i) =>
        '<tr' + (i === rows.length - 1 ? ' class="total"' : '') + '><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
      $('results-progress').textContent = won
        ? (session.mode === 'journey' ? 'Stage ' + (session.stage + 1) + ' complete. ' : '') +
          (session.usedAssist ? 'Assists used (undo/hint) — not eligible for ties.' : '')
        : 'Tip: spare seats on a matched vehicle rescue holding passengers.';
      $('results-achievements').textContent = newAch.length ? 'Achievement unlocked: ' + newAch.join(', ') : '';
      if (submitted) submitted.then(t => { $('results-achievements').textContent += ($('results-achievements').textContent ? ' ' : '') + t; });
      $('btn-results-next').textContent = won && session.mode === 'journey' && session.stage < R.JOURNEY_STAGES - 1 ? 'Next stage'
        : won && session.mode === 'learn' && session.lesson < 2 ? 'Next lesson' : 'Play again';
      announce($('results-h').textContent + '. ' + $('results-reason').textContent + ' Total score ' + sc.total + '.');
      funnel('results-shown');
    },
    buildHelp() {
      const cards = [
        ['Match fronts', 'Select a vehicle, then a queue whose front passenger shares its color. Consecutive matching passengers board up to the vehicle’s seats.'],
        ['Holding lane', 'A mismatched front passenger steps aside into the holding lane. If it overfills, you lose. Matched vehicles with spare seats collect waiting passengers.'],
        ['Vehicles are limited', 'Each vehicle type has a fixed count, shown as pips. Keep spares for the endgame.'],
        ['Scoring', 'Points for boarded passengers, full vehicles, and unused vehicles; penalties for invalid actions and holding congestion.']
      ];
      $('help-cards').innerHTML = cards.map(c => '<h3>' + c[0] + '</h3><p>' + c[1] + '</p>').join('');
      const lbl = c => (/^Key[A-Z]$/.test(c) ? c.slice(3) : ({ Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[c] || c));
      const k = a => (bindings[a] || []).map(lbl).join('/') || '—';
      $('help-controls').textContent =
        'Pointer/touch: tap a vehicle, then a queue. Keyboard: ' + k('prev') + ' / ' + k('next') + ' choose, ' + k('confirm') +
        ' select and dispatch, ' + k('cancel') + ' cancel or pause, ' + k('undo') + ' undo, ' + k('hint') + ' hint, ' +
        k('camera') + ' reset camera, ' + k('pause') + ' pause. Gamepad: stick or D-pad choose, A confirm, B cancel, Start pause.';
    },
    buildStageGrid() {
      const grid = $('stage-grid');
      grid.innerHTML = '';
      for (let i = 0; i < R.JOURNEY_STAGES; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(i + 1);
        const done = store.progress.journeyDone.includes(i);
        const locked = i > store.progress.journeyUnlocked;
        b.className = done ? 'done' : locked ? 'locked' : (i === store.progress.journeyUnlocked ? 'current' : '');
        b.disabled = locked;
        b.setAttribute('aria-label', 'Stage ' + (i + 1) + (done ? ' completed' : locked ? ' locked' : ''));
        b.addEventListener('click', () => startRound('journey', { stage: i }));
        grid.appendChild(b);
      }
    },
    showLocalBests(el) {
      const best = (store.progress && store.progress.best) || {};
      const rows = [['Journey', best.journey], ['Challenge', best.challenge], ['Daily', best.daily]]
        .filter(r => r[1] != null);
      if (!rows.length) { el.textContent = 'No local records yet.'; return; }
      el.innerHTML = '<table class="scores-table"><tr><th>Board</th><th>Your best</th></tr>' +
        rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</table>';
    },
    async showPlatformScores(el) {
      if (!net.hosted) { ui.showLocalBests(el); return; }
      el.textContent = 'Loading…';
      try {
        const j = await loadPlatformBoard();
        if (!j) { ui.showLocalBests(el); return; } // no leaderboardId: local records only
        const list = Array.isArray(j.entries) ? j.entries : (Array.isArray(j) ? j : []);
        if (!list.length) { el.textContent = 'No entries yet — be the first.'; return; }
        const names = await Promise.all(list.map(e => profileNickname(e.userId != null ? e.userId : e.user_id)));
        el.innerHTML = '<table class="scores-table"><tr><th>#</th><th>Player</th><th>Score</th></tr>' +
          list.map((e, i) => '<tr><td>' + (i + 1) + '</td><td></td><td>' +
            (e.score != null ? e.score : (e.value != null ? e.value : '')) + '</td></tr>').join('') + '</table>';
        // insert names safely (no HTML injection)
        const rows = el.querySelectorAll('tr');
        names.forEach((n, i) => { if (rows[i + 1]) rows[i + 1].children[1].textContent = n; });
      } catch (e) {
        el.textContent = 'Leaderboard unavailable right now. Your local progress is safe.';
      }
    },
    async showScores(board) {
      const el = $('scores-content');
      if (net.hosted) return ui.showPlatformScores(el); // read-only platform board
      // standalone: personal best on this device
      const best = (store.progress.best || {})[board];
      el.textContent = best != null
        ? 'Your best (' + board + ', this device): ' + best + '. Sign in with StarHermit for online boards.'
        : 'No ' + board + ' best yet on this device. Sign in with StarHermit for online boards.';
    }
  };

  /* ============================== settings ============================== */
  function applySettings() {
    const s = store.settings;
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    document.body.classList.toggle('high-contrast', s.highContrast);
    document.body.classList.toggle('large-text', s.largeText);
    $('set-music').value = s.music; $('set-fx').value = s.fx; $('set-ambience').value = s.ambience;
    $('set-palette').value = s.palette; $('set-quality').value = s.quality;
    $('set-motion').checked = s.reducedMotion; $('set-contrast').checked = s.highContrast;
    $('set-largetext').checked = s.largeText; $('set-lefthand').checked = s.leftHand;
    $('set-captions').checked = s.captions; $('set-haptics').checked = s.haptics;
    $('set-analytics').checked = s.analytics;
    audio.applyVolumes();
    computeQuality();
    applyHandedness();
    rebuildAll();
    syncGfxPanel();
    saveStore();
    funnel('settings-change');
  }

  /* ---- Graphics section (built from the quality model; strings from gfx-i18n.js) ---- */
  const GFX_CATS = Object.keys(GFX.CATEGORIES);
  function gfxRow(host, label, forId, control, extra) {
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.htmlFor = forId; lab.textContent = label;
    row.append(lab, control);
    if (extra) row.append(extra);
    host.append(row);
    return row;
  }
  function buildGfxPanel() {
    const host = $('gfx-controls');
    if (!host) return;
    const sec = host.closest('section') || host.parentElement;
    if (sec) sec.lang = GFX.pickLocale(navigator.language);
    if ($('gfx-heading')) $('gfx-heading').textContent = GS.graphics;
    if ($('gfx-quality-label')) $('gfx-quality-label').textContent = GS.quality;
    host.textContent = '';
    // render scale
    const scale = document.createElement('input');
    Object.assign(scale, { type: 'range', id: 'gfx-scale', min: 50, max: 200, step: 5 });
    scale.dataset.gfx = 'render_scale';
    const val = document.createElement('output');
    val.id = 'gfx-scale-val'; val.htmlFor = 'gfx-scale'; val.className = 'gfx-val';
    const scaleWrap = document.createElement('span');
    scaleWrap.className = 'gfx-range';
    scaleWrap.append(scale, val);
    gfxRow(host, GS.renderScale, 'gfx-scale', scaleWrap);
    scale.addEventListener('input', () => {
      store.settings.gfx.render_scale = +scale.value / 100;
      val.textContent = scale.value + '%';
      applyGraphics(false);
    });
    // one select per category
    for (const cat of GFX_CATS) {
      const sel = document.createElement('select');
      sel.id = 'gfx-' + cat;
      sel.dataset.gfxCat = cat;
      for (const v of ['preset'].concat(GFX.CATEGORIES[cat])) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v === 'preset' ? '' : (GS.tiers[v] || v);
        sel.append(o);
      }
      gfxRow(host, GS.cats[cat], sel.id, sel);
      sel.addEventListener('change', () => {
        if (sel.value === 'preset') delete store.settings.gfx[cat]; else store.settings.gfx[cat] = sel.value;
        applyGraphics(cat === 'detail');
      });
    }
    // toggles
    for (const [id, key, label, def] of [['gfx-adaptive', 'adaptive', GS.adaptive, true], ['gfx-fps', 'show_fps', GS.showFps, false]]) {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = id; cb.dataset.gfx = key;
      gfxRow(host, label, id, cb);
      cb.addEventListener('change', () => {
        if (cb.checked === def) delete store.settings.gfx[key]; else store.settings.gfx[key] = cb.checked;
        applyGraphics(false);
      });
    }
    const sum = document.createElement('p');
    sum.id = 'gfx-summary'; sum.className = 'gfx-summary'; sum.setAttribute('aria-live', 'polite');
    const note = document.createElement('p');
    note.id = 'gfx-post-note'; note.className = 'gfx-note'; note.hidden = true; note.textContent = GS.postFailed;
    host.append(sum, note);
  }
  // Apply graphics changes live; a detail change swaps meshes so the scene is rebuilt.
  function applyGraphics(rebuild) {
    computeQuality();
    if (rebuild) rebuildAll();
    syncGfxPanel();
    saveStore();
  }
  function syncGfxPanel() {
    const q = gfx.q;
    if (!q || !$('gfx-controls')) return;
    const qs = $('set-quality');
    for (const o of qs.options) {
      o.textContent = o.value === 'auto' ? GS.auto.replace('{tier}', GS.presets[gfx.detected]) : GS.presets[o.value];
    }
    qs.value = store.settings.quality;
    const g = store.settings.gfx;
    const pct = Math.round((Number(g.render_scale) || 1) * 100);
    if ($('gfx-scale')) { $('gfx-scale').value = pct; $('gfx-scale-val').textContent = pct + '%'; }
    for (const cat of GFX_CATS) {
      const sel = $('gfx-' + cat);
      if (!sel) continue;
      const tier = GFX.presetTier(q.preset, cat);
      sel.options[0].textContent = GS.fromPreset.replace('{tier}', GS.tiers[tier] || tier);
      sel.value = GFX.CATEGORIES[cat].includes(g[cat]) ? g[cat] : 'preset';
    }
    if ($('gfx-adaptive')) $('gfx-adaptive').checked = q.adaptive;
    if ($('gfx-fps')) $('gfx-fps').checked = q.showFps;
    syncGfxSummary();
    // pixel size settles after the next frame
    requestAnimationFrame(() => requestAnimationFrame(syncGfxSummary));
  }
  function syncGfxSummary() {
    const el = $('gfx-summary');
    if (!el || !gfx.q) return;
    const info = graphicsInfo();
    el.textContent = info.gpu + ' · ' + info.summary;
    $('gfx-post-note').hidden = !info.postFailed;
  }
  function applyHandedness() {
    const on = store.settings.leftHand;
    $('rail-left').style.left = on ? 'auto' : '';
    $('rail-left').style.right = on ? 'calc(10px + var(--sar))' : '';
    $('rail-right').style.right = on ? 'auto' : '';
    $('rail-right').style.left = on ? 'calc(10px + var(--sal))' : '';
  }
  function bindSettings() {
    const s = store.settings;
    $('set-music').addEventListener('input', e => { s.music = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-fx').addEventListener('input', e => { s.fx = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-ambience').addEventListener('input', e => { s.ambience = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-palette').addEventListener('change', e => { s.palette = e.target.value; applySettings(); });
    buildGfxPanel();
    $('set-quality').addEventListener('change', e => {
      // choosing a preset clears per-category overrides (scale, adaptive and fps are kept)
      const next = GFX.choosePreset(s.gfx, e.target.value);
      s.quality = next.preset;
      delete next.preset;
      s.gfx = next;
      applySettings();
    });
    $('set-motion').addEventListener('change', e => { s.reducedMotion = e.target.checked; applySettings(); });
    $('set-contrast').addEventListener('change', e => { s.highContrast = e.target.checked; applySettings(); });
    $('set-largetext').addEventListener('change', e => { s.largeText = e.target.checked; applySettings(); });
    $('set-lefthand').addEventListener('change', e => { s.leftHand = e.target.checked; applySettings(); });
    $('set-captions').addEventListener('change', e => { s.captions = e.target.checked; applySettings(); });
    $('set-haptics').addEventListener('change', e => { s.haptics = e.target.checked; applySettings(); });
    $('set-analytics').addEventListener('change', e => { s.analytics = e.target.checked; applySettings(); });
    $('btn-replay-tutorial').addEventListener('click', () => { store.progress.tutorialDone = false; saveStore(); startRound('learn', { lesson: 0 }); });
  }

  /* ============================== input ============================== */
  function pointerPick(ev) {
    if (!scene3.ready || !boardGroup) return null;
    const rect = canvas.getBoundingClientRect();
    const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const targets = [];
    pickMeshes.vehicles.forEach(g => g.children.forEach(c => targets.push(c)));
    pickMeshes.queues.forEach(q => targets.push(q));
    boardGroup.children.forEach(ch => {
      if (ch.userData.queueIndex != null && !targets.includes(ch)) targets.push(ch);
    });
    const hits = rc.intersectObjects(targets, false);
    for (const h of hits) {
      let o = h.object;
      if (o.userData.vehicleIndex != null) return { kind: 'vehicle', index: o.userData.vehicleIndex };
      if (o.userData.queueIndex != null) return { kind: 'queue', index: o.userData.queueIndex };
    }
    return null;
  }

  let pointerDownAt = null;
  canvas.addEventListener('pointerdown', ev => {
    audio.ensure();
    pointerDownAt = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  canvas.addEventListener('pointerup', ev => {
    if (!pointerDownAt) return;
    const dx = ev.clientX - pointerDownAt.x, dy = ev.clientY - pointerDownAt.y;
    const dt = performance.now() - pointerDownAt.t;
    const isTap = dx * dx + dy * dy < 100 && dt < 600;
    pointerDownAt = null;
    if (!isTap || session.screen !== 'active') return;
    const pick = pointerPick(ev);
    if (!pick) return;
    handlePick(pick);
  });
  canvas.addEventListener('pointercancel', () => { pointerDownAt = null; });

  function handlePick(pick) {
    if (pick.kind === 'vehicle') {
      if (session.selectedVehicle === pick.index) {
        session.selectedVehicle = -1; rebuildBoard(); audio.select(); return;
      }
      const veh = session.state.v[pick.index];
      if (!veh || veh.n < 1) { toast('That vehicle type is used up', 1400); audio.invalid(); return; }
      session.selectedVehicle = pick.index;
      audio.select();
      rebuildBoard();
      announce(COLOR_NAMES[veh.c - 1] + ' vehicle selected. Green rings board; amber rings displace to holding. Tap a queue.');
    } else if (pick.kind === 'queue') {
      if (session.selectedVehicle < 0) { toast('Select a vehicle first', 1200); audio.invalid(); return; }
      commitDispatch(session.selectedVehicle, pick.index);
    }
  }

  // keyboard focus navigation among legal targets
  let kbFocus = { zone: 'vehicles', index: 0 };
  function kbTargets() {
    if (!session.state) return [];
    if (session.selectedVehicle >= 0) {
      return session.state.q.map((l, i) => (l.length > 0 ? i : -1)).filter(i => i >= 0);
    }
    return session.state.v.map((veh, i) => (veh.n > 0 ? i : -1)).filter(i => i >= 0);
  }
  // Keydown routes through the effective bindings (KeyboardEvent.code).
  const isKey = (action, ev) => (bindings[action] || []).includes(ev.code);
  document.addEventListener('keydown', ev => {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
    if (isKey('cancel', ev)) {
      if (session.selectedVehicle >= 0 && session.screen === 'active') {
        session.selectedVehicle = -1; rebuildBoard(); announce('Selection cancelled');
      } else if (session.screen === 'active') pauseGame();
      else if (session.screen === 'paused') resumeGame();
      else if (session.screen === 'help') setScreen(helpReturn);
      else if (session.screen === 'settings') setScreen(settingsReturn);
      else if (['scores', 'setup', 'journey'].includes(session.screen)) setScreen(session.state && session.state.status === 'active' ? 'active' : 'title');
      ev.preventDefault();
      return;
    }
    if (session.screen !== 'active') return;
    if (isKey('prev', ev) || isKey('next', ev)) {
      const t = kbTargets();
      if (!t.length) return;
      const dir = isKey('prev', ev) ? -1 : 1;
      kbFocus.index = (kbFocus.index + dir + t.length) % t.length;
      const idx = t[kbFocus.index];
      if (session.selectedVehicle >= 0) announce('Queue ' + (idx + 1) + ': ' + (session.state.q[idx].map(c => COLOR_NAMES[c - 1]).join(', ') || 'empty'));
      else announce('Vehicle ' + (idx + 1) + ': ' + COLOR_NAMES[session.state.v[idx].c - 1] + ', ' + session.state.v[idx].n + ' left');
      ev.preventDefault();
    } else if (isKey('confirm', ev)) {
      const t = kbTargets();
      if (!t.length) return;
      const idx = t[Math.min(kbFocus.index, t.length - 1)];
      if (session.selectedVehicle >= 0) commitDispatch(session.selectedVehicle, idx);
      else handlePick({ kind: 'vehicle', index: idx });
      kbFocus.index = 0;
      ev.preventDefault();
    } else if (isKey('undo', ev)) { undo(); }
    else if (isKey('hint', ev)) { doHint(); }
    else if (isKey('camera', ev)) { resetCamera(); }
    else if (isKey('pause', ev)) { pauseGame(); }
  });

  // gamepad polling
  let padPrev = {};
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && pads[0];
    if (!p || session.screen !== 'active') return;
    const pressed = i => p.buttons[i] && p.buttons[i].pressed;
    const axisX = p.axes[0] || 0;
    function once(name, cond) {
      if (cond && !padPrev[name]) { padPrev[name] = true; return true; }
      if (!cond) padPrev[name] = false;
      return false;
    }
    const send = action => document.dispatchEvent(new KeyboardEvent('keydown', { code: (bindings[action] || [])[0] || '' }));
    if (once('left', axisX < -0.5 || pressed(14))) send('prev');
    if (once('right', axisX > 0.5 || pressed(15))) send('next');
    if (once('a', pressed(0))) send('confirm');
    if (once('b', pressed(1))) send('cancel');
    if (once('start', pressed(9))) pauseGame();
  }

  function resetCamera() {
    if (!scene3.ready) return;
    camera.position.copy(scene3.camHome);
    camera.lookAt(0, 0, 0.5);
    toast('Camera reset', 900);
  }

  /* ============================== pause / lifecycle ============================== */
  function pauseGame() {
    if (session.screen !== 'active') return;
    setScreen('paused');
    announce('Paused');
    funnel('pause');
  }
  function resumeGame() {
    setScreen('active');
    announce('Resumed. ' + describeBoard(session.state));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session.screen === 'active') pauseGame();
  });

  /* ============================== wiring ============================== */
  function bindUI() {
    $('btn-signin').textContent = ST('signIn');
    $('btn-invite').textContent = ST('invite');
    $('btn-signin').addEventListener('click', () => P.signIn());
    $('btn-invite').addEventListener('click', copyInvite);
    updateAccountLine();
    $('btn-play').addEventListener('click', () => {
      audio.ensure();
      if (!store.progress.tutorialDone) startRound('learn', { lesson: 0 });
      else startRound('journey', {});
    });
    $('btn-daily').addEventListener('click', () => { audio.ensure(); startRound('daily'); });
    $('btn-journey').addEventListener('click', () => { ui.buildStageGrid(); setScreen('journey'); });
    $('btn-journey-back').addEventListener('click', () => setScreen('title'));
    $('btn-practice').addEventListener('click', () => {
      $('setup-h').textContent = 'Practice';
      $('setup-desc').textContent = 'Unranked. Undo and hints allowed. Pick a difficulty.';
      $('setup-meta').textContent = 'Expected duration: 2–5 minutes · 1 player · not ranked';
      $('setup-difficulty').hidden = false;
      $('btn-setup-start').hidden = true;
      setScreen('setup');
    });
    $('btn-challenge').addEventListener('click', () => {
      $('setup-h').textContent = 'Challenge';
      $('setup-desc').textContent = 'A tight layout with a move limit. Ranked on the validated challenge board.';
      $('setup-meta').textContent = 'Today’s seed: ' + utcDateInt() + ' · expected duration: 2–4 minutes · ranked';
      $('setup-difficulty').hidden = true;
      $('btn-setup-start').hidden = false;
      $('btn-setup-start').onclick = () => { audio.ensure(); startRound('challenge'); };
      setScreen('setup');
    });
    document.querySelectorAll('#setup-difficulty [data-diff]').forEach(b =>
      b.addEventListener('click', () => { audio.ensure(); startRound('practice', { difficulty: b.dataset.diff }); }));
    $('btn-setup-back').addEventListener('click', () => setScreen('title'));
    $('btn-learn').addEventListener('click', () => { audio.ensure(); startRound('learn', { lesson: 0 }); });
    $('btn-scores').addEventListener('click', () => { ui.showScores('journey'); setScreen('scores'); });
    document.querySelectorAll('#screen-scores [data-board]').forEach(b =>
      b.addEventListener('click', () => {
        const board = b.dataset.board === 'daily' ? 'daily-' + utcDateInt() : b.dataset.board;
        ui.showScores(board);
      }));
    $('btn-scores-close').addEventListener('click', () => setScreen('title'));
    $('btn-help2').addEventListener('click', () => { helpReturn = 'title'; setScreen('help'); });
    $('btn-settings2').addEventListener('click', () => { settingsReturn = 'title'; setScreen('settings'); });
    $('btn-help-open').addEventListener('click', () => { helpReturn = session.screen; setScreen('help'); });
    $('btn-settings-open').addEventListener('click', () => { settingsReturn = session.screen; setScreen('settings'); });
    $('btn-help-close').addEventListener('click', () => setScreen(helpReturn));
    $('btn-settings-close').addEventListener('click', () => setScreen(settingsReturn));
    $('btn-pause').addEventListener('click', pauseGame);
    $('btn-resume').addEventListener('click', resumeGame);
    $('btn-restart').addEventListener('click', () => {
      const m = session.mode;
      if (m === 'practice') startRound('practice', { difficulty: session.difficulty, seed: session.seed });
      else if (m === 'challenge') startRound('challenge');
      else if (m === 'daily') startRound('daily');
      else if (m === 'learn') startRound('learn', { lesson: session.lesson });
      else startRound('journey', { stage: session.stage });
    });
    $('btn-quit').addEventListener('click', () => { session.state = null; setScreen('title'); ui.updateAll(); });
    $('btn-pause-settings').addEventListener('click', () => { settingsReturn = 'paused'; setScreen('settings'); });
    $('btn-pause-help').addEventListener('click', () => { helpReturn = 'paused'; setScreen('help'); });
    $('btn-hint').addEventListener('click', doHint);
    $('btn-hint2').addEventListener('click', doHint);
    $('btn-undo').addEventListener('click', undo);
    $('btn-undo2').addEventListener('click', undo);
    $('btn-camera').addEventListener('click', resetCamera);
    $('btn-results-retry').addEventListener('click', () => $('btn-restart').click());
    $('btn-results-menu').addEventListener('click', () => { session.state = null; setScreen('title'); ui.updateAll(); });
    $('btn-results-next').addEventListener('click', () => {
      if (session.mode === 'journey' && session.state && session.state.status === 'won' && session.stage < R.JOURNEY_STAGES - 1) {
        startRound('journey', { stage: session.stage + 1 });
      } else if (session.mode === 'learn' && session.state && session.state.status === 'won' && session.lesson < 2) {
        startRound('learn', { lesson: session.lesson + 1 });
      } else {
        $('btn-restart').click();
      }
    });
  }

  /* ============================== daily countdown ============================== */
  function tickDailyCountdown() {
    const el = $('daily-countdown');
    if (session.screen !== 'title') return;
    const now = net.now();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    const ms = next.getTime() - now;
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    el.textContent = 'Next daily seed in ' + h + 'h ' + m + 'm ' + s + 's (UTC)' + ' · local clock';
  }

  /* ============================== render loop ============================== */
  let lastT = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (document.hidden) return; // zero-render heartbeat when backgrounded
    pollGamepad();
    stepTweens(dt);
    stepParticles(dt);
    stepAmbient(dt);
    if (scene3.ready) renderFrame(dt);
  }

  // Bands of the viewport covered by fixed chrome (HUD, tray, coach); the
  // board is framed inside what is left via a camera view offset.
  function safeInsets(w, h) {
    const ins = { top: 0, bottom: 0, left: 0, right: 0 };
    const hud = $('hud'), tray = $('tray'), coach = $('coach');
    if (hud && !hud.hidden) ins.top = Math.max(ins.top, hud.getBoundingClientRect().bottom);
    if (tray && !tray.hidden) ins.bottom = Math.max(ins.bottom, h - tray.getBoundingClientRect().top);
    if (coach && !coach.hidden) {
      const r = coach.getBoundingClientRect();
      if (r.width && r.height) {
        if (r.width < w * 0.45 && r.height > 80) { // docked as a side column (landscape)
          if (r.left + r.width / 2 < w / 2) ins.left = Math.max(ins.left, r.right); else ins.right = Math.max(ins.right, w - r.left);
        } else ins.bottom = Math.max(ins.bottom, h - r.top);
      }
    }
    return ins;
  }

  // Pull the authored camera straight back along its own axis until the whole
  // board (queues, holding lane, vehicles) fits the framed rectangle.
  function fitCamera() {
    const w = window.innerWidth, h = window.innerHeight;
    const ins = safeInsets(w, h);
    const sw = Math.max(1, w - ins.left - ins.right), sh = Math.max(1, h - ins.top - ins.bottom);
    if (sw < w * 0.45 || sh < h * 0.35) { camera.aspect = w / h; camera.clearViewOffset(); }
    else { camera.aspect = sw / sh; camera.setViewOffset(sw, sh, -ins.left, -ins.top, w, h); }
    camera.updateProjectionMatrix();
    const look = new THREE.Vector3(0, 0, 0.5);
    const base = new THREE.Vector3(0, 15, 17);
    const dir = base.clone().sub(look).normalize();
    const box = boardGroup ? new THREE.Box3().setFromObject(boardGroup) : new THREE.Box3(new THREE.Vector3(-7, 0, -7), new THREE.Vector3(7, 2, 7));
    box.expandByScalar(0.8);
    const pts = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
    const probe = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.1, 200);
    const v = new THREE.Vector3();
    let d = base.distanceTo(look) * 0.7;
    for (let i = 0; i < 14; i++) {
      probe.position.copy(look).addScaledVector(dir, d);
      probe.lookAt(look); probe.updateMatrixWorld(); probe.updateProjectionMatrix();
      let over = 0;
      for (const q of pts) { v.copy(q).project(probe); over = Math.max(over, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.92); }
      if (over <= 1) break;
      d *= Math.min(1.6, over + 0.02);
    }
    scene3.camHome.copy(look).addScaledVector(dir, d);
    camera.position.copy(scene3.camHome);
    camera.lookAt(look);
  }

  function resize() {
    // measured chrome heights drive the coach placement in CSS
    const hud = $('hud'), tray = $('tray');
    document.documentElement.style.setProperty('--hud-h', (hud && !hud.hidden ? hud.offsetHeight : 0) + 'px');
    document.documentElement.style.setProperty('--tray-h', (tray && !tray.hidden ? tray.offsetHeight : 0) + 'px');
    if (!scene3.ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    fitCamera();
  }
  {
    // chrome changes (coach shown/hidden, tray wrapping) refit the board
    let raf = 0;
    const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(resize); };
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(refit);
      ['hud', 'tray', 'coach'].forEach(id => { const el = $(id); if (el) ro.observe(el); });
    }
    const mo = new MutationObserver(refit);
    ['hud', 'tray', 'coach'].forEach(id => { const el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] }); });
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  /* ============================== boot ============================== */
  function boot() {
    initScene();
    const platformReady = initPlatform();
    tickDailyCountdown();
    setInterval(tickDailyCountdown, 1000);
    // hosted: resolve identity + remote-preferred cloud save before first paint
    // of the shell; local: resolves immediately, boot is unchanged
    platformReady.then(() => {
      bindUI();
      bindSettings();
      ui.buildHelp();
      applySettings();
      ui.updateAll();
      setScreen('title');
      requestAnimationFrame(loop);
      funnel('boot');
    });
  }
  window.addEventListener('pagehide', () => { flushCloudSave(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCloudSave();
  });
  boot();
  // debug/test handle (read-only rules access plus flow control)
  window.__tt = {
    session, startRound, commitDispatch, undo, doHint, R, store,
    graphicsInfo: () => (gfx.q ? graphicsInfo() : null),
    // client-space projection under the live (fitted) camera, for tests/tools
    projectWorld(x, y, z) {
      const rect = renderer.domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      const q = new THREE.Vector3(x, y, z).project(camera);
      return { x: rect.left + (q.x + 1) / 2 * rect.width, y: rect.top + (1 - q.y) / 2 * rect.height };
    },
  };
})();
