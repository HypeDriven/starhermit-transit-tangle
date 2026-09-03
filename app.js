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
      leftHand: false, captions: true, haptics: true, analytics: false
    },
    progress: { journeyDone: [], journeyUnlocked: 0, tutorialDone: false, daysPlayed: [], wins: 0, streak: 0 },
    achievements: []
  };
  let store;
  try { store = Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
  catch (e) { store = JSON.parse(JSON.stringify(defaults)); }
  store.settings = Object.assign({}, defaults.settings, store.settings);
  store.progress = Object.assign({}, defaults.progress, store.progress);
  function saveStore() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} }
  const sessionId = 's-' + Math.random().toString(36).slice(2, 10);
  const profileId = (() => {
    let id = localStorage.getItem('tt-profile');
    if (!id) { id = 'p-' + Math.random().toString(36).slice(2, 12); try { localStorage.setItem('tt-profile', id); } catch (e) {} }
    return id;
  })();

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

  /* ============================== net ============================== */
  const net = {
    offset: 0, online: false,
    async syncTime() {
      try {
        const t0 = Date.now();
        const r = await fetch('api/v1/time');
        const j = await r.json();
        net.offset = j.now - (t0 + Date.now()) / 2;
        net.online = true;
      } catch (e) { net.online = false; }
    },
    now() { return Date.now() + net.offset; },
    async post(pathname, body) {
      const r = await fetch(pathname, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('http-' + r.status));
      return j;
    },
    async get(pathname) {
      const r = await fetch(pathname);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('http-' + r.status));
      return j;
    }
  };

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
  let quality = { dpr: 2, shadows: true, particleCount: 60 };

  function computeQuality() {
    const q = store.settings.quality;
    const tier = q === 'auto'
      ? (Math.min(window.innerWidth, window.innerHeight) < 700 ? 'low' : 'high')
      : q;
    if (tier === 'low') quality = { dpr: 1, shadows: false, particleCount: 20 };
    else if (tier === 'medium') quality = { dpr: 1.5, shadows: false, particleCount: 40 };
    else quality = { dpr: 2, shadows: true, particleCount: 60 };
    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr));
      renderer.shadowMap.enabled = quality.shadows;
    }
  }

  function initScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      $('objective-text').textContent = '3D unavailable: ' + e.message + '. The text board remains fully playable.';
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    computeQuality();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    scene3.camHome = new THREE.Vector3(0, 15, 17);
    camera.position.copy(scene3.camHome);
    camera.lookAt(0, 0, 0.5);

    sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
    sunLight.position.set(-8, 18, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -16; sunLight.shadow.camera.right = 16;
    sunLight.shadow.camera.top = 16; sunLight.shadow.camera.bottom = -16;
    scene.add(sunLight);
    ambLight = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1);
    scene.add(ambLight);

    // particle pool (bounded, cosmetic only, never raycast)
    const pg = new THREE.BufferGeometry();
    const pos = new Float32Array(200 * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.9 }));
    particles.frustumCulled = false;
    particles.userData.live = [];
    scene.add(particles);

    canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); scene3.ready = false; });
    canvas.addEventListener('webglcontextrestored', () => { initSceneFlag = true; rebuildAll(); });
    scene3.ready = true;
    resize();
  }
  let initSceneFlag = false;

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
  function colorMat(c) {
    const key = 'c' + c + '-' + store.settings.palette;
    if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial({ color: colorOf(c), roughness: 0.55, metalness: 0.05 });
    return MAT[key];
  }
  function plainMat(color, opts) {
    const key = 'm' + color + JSON.stringify(opts || '');
    if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.02 }, opts));
    return MAT[key];
  }

  function layoutPositions(n, spacing, z) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * spacing, z });
    return out;
  }

  function rebuildAll() { buildEnvironment(session.theme || 'plaza'); rebuildBoard(); }

  function buildEnvironment(themeName) {
    if (!scene3.ready) return;
    if (scene3.env) { scene.remove(scene3.env); disposeGroup(scene3.env); }
    const t = THEMES[themeName] || THEMES.plaza;
    scene.background = new THREE.Color(t.sky);
    const env = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.5, 48), plainMat(t.ground));
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
    const pad = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 1.6), plainMat(0xe8d9b0));
    pad.position.set(0, 0.05, 2.6);
    pad.receiveShadow = true;
    env.add(pad);
    scene.add(env);
    scene3.env = env;
  }

  function disposeGroup(g) {
    g.traverse(o => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); });
  }

  // Rebuild board meshes from an immutable snapshot (plus simple tween-in).
  function rebuildBoard(prevEvents) {
    if (!scene3.ready || !session.state) return;
    if (boardGroup) { scene.remove(boardGroup); disposeGroup(boardGroup); }
    const s = session.state;
    const g = new THREE.Group();
    pickMeshes.vehicles = []; pickMeshes.queues = [];
    markerMeshes.length = 0;

    // queues: platforms + passenger pawns (front nearest camera)
    const qPos = layoutPositions(s.q.length, 2.6, -1.6);
    s.q.forEach((lane, qi) => {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 6.2), plainMat(0xdde5ec));
      plat.position.set(qPos[qi].x, 0.09, -1.6 - 2.0);
      plat.receiveShadow = true;
      plat.userData.queueIndex = qi;
      g.add(plat);
      pickMeshes.queues.push(plat);
      lane.forEach((c, idx) => {
        const m = new THREE.Mesh(pawnGeo(c), colorMat(c));
        m.position.set(qPos[qi].x, 0.55, -0.9 - idx * 0.95);
        m.castShadow = true;
        m.userData.queueIndex = qi;
        g.add(m);
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
      if (prevEvents && prevEvents.displaced.length && i === s.h.length - 1) tweenFrom(m, qPos[prevEvents.displaced[0].queue].x, -0.9);
    });
    // holding capacity ticks
    for (let i = 0; i < s.holdingCap; i++) {
      const tickm = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16),
        plainMat(i < s.h.length ? 0xd64545 : 0xcccccc));
      tickm.position.set(-4.5 + i * 1.0, 0.12, 2.6);
      g.add(tickm);
    }

    // vehicles at depot
    const vPos = layoutPositions(s.v.length, 2.8, 5.4);
    s.v.forEach((veh, vi) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.0), colorMat(veh.c));
      body.position.y = 0.45;
      body.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), plainMat(0xffffff));
      cab.position.set(-0.3, 1.0, 0);
      grp.add(body, cab);
      // remaining-count pips
      for (let k = 0; k < veh.n; k++) {
        const pip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), colorMat(veh.c));
        pip.position.set(-0.5 + k * 0.32, 1.45, 0);
        grp.add(pip);
      }
      grp.position.set(vPos[vi].x, 0, vPos[vi].z);
      grp.userData.vehicleIndex = vi;
      if (veh.n < 1) grp.children.forEach(ch => { ch.material = plainMat(0x9aa7b2); });
      g.add(grp);
      pickMeshes.vehicles.push(grp);
      if (session.selectedVehicle === vi) addSelectionRing(g, vPos[vi].x, vPos[vi].z);
    });

    // legal-target markers when a vehicle is selected
    if (session.selectedVehicle >= 0 && s.status === 'active') {
      s.q.forEach((lane, qi) => {
        if (!lane.length) return;
        const p = R.preview(s, session.selectedVehicle, qi);
        if (!p.ok) return;
        const mk = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24),
          new THREE.MeshBasicMaterial({ color: p.match ? 0x2f9e63 : 0xc77d0a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
        mk.rotation.x = -Math.PI / 2;
        mk.position.set(qPos[qi].x, 0.22, -0.9);
        g.add(mk);
        markerMeshes.push(mk);
      });
    }

    scene.add(g);
    boardGroup = g;
    if (prevEvents && prevEvents.boarded.length) burst(vPosEvent(prevEvents), s);
  }
  function vPosEvent(ev) { return { x: 0, z: 3.5 }; }

  function addSelectionRing(g, x, z) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    g.add(ring);
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
  function burst(at, s) {
    if (store.settings.reducedMotion || !particles) return;
    const live = particles.userData.live;
    for (let i = 0; i < Math.min(quality.particleCount, 12); i++) {
      live.push({
        x: at.x + (Math.random() - 0.5), y: 1 + Math.random(), z: at.z + (Math.random() - 0.5),
        vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5, t: 0.8
      });
    }
    if (live.length > 200) live.splice(0, live.length - 200);
  }
  function stepParticles(dt) {
    if (!particles) return;
    const live = particles.userData.live;
    const attr = particles.geometry.getAttribute('position');
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t -= dt; p.vy -= 4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.t <= 0 || p.y < 0) live.splice(i, 1);
    }
    for (let i = 0; i < 200; i++) {
      const p = live[i];
      attr.setXYZ(i, p ? p.x : 0, p ? p.y : -10, p ? p.z : 0);
    }
    attr.needsUpdate = true;
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
      session.seed = (Math.random() * 0xffffffff) >>> 0;
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
    if (ev.match) audio.dispatch(ev.boarded, ev.full); else audio.mismatch();
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
        newAch.push(label);
        if (net.online) net.post('api/achievements', { profile: profileId, key }).catch(() => {});
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
    saveStore();
    // score submission (ranked modes, server-validated)
    let submitted = null;
    if (session.ranked && net.online) {
      const env = R.replayEnvelope(session.cfg, session.state0, session.commands, finalState, sessionId);
      submitted = net.post('api/scores', { name: 'guest', replay: env })
        .then(() => 'Score submitted to the validated board.')
        .catch(e => 'Score not accepted: ' + e.message);
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
    el.textContent = 'Lesson ' + (lesson + 1) + ': ' + LESSONS[lesson][Math.min(step, 1)];
    el.hidden = false;
    announce(el.textContent);
  }
  function coachAdvance(ev, state) {
    if (coachStep === 0 && ev.boarded > 0) coachForLesson(session.lesson, 1);
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
      msg = 'Boarded ' + ev.boarded + ' passenger' + (ev.boarded === 1 ? '' : 's') +
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
      if (focusable) focusable.focus();
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
      $('help-controls').textContent =
        'Pointer/touch: tap a vehicle, then a queue. Keyboard: Left/Right choose, Enter select and dispatch, Escape cancel or pause, U undo, H hint, R reset camera. Gamepad: stick or D-pad choose, A confirm, B cancel, Start pause.';
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
    async showScores(board) {
      const el = $('scores-content');
      if (!net.online) { el.textContent = 'Score boards unavailable offline. Your local progress is safe.'; return; }
      el.textContent = 'Loading…';
      try {
        const j = await net.get('api/scores?board=' + encodeURIComponent(board));
        if (!j.scores.length) { el.textContent = 'No scores yet — be the first.'; return; }
        el.innerHTML = '<table class="scores-table"><tr><th>#</th><th>Name</th><th>Score</th><th>Moves</th><th>Result</th></tr>' +
          j.scores.map((s, i) => '<tr><td>' + (i + 1) + '</td><td></td><td>' + s.score + '</td><td>' + s.ticks + '</td><td>' + s.result + '</td></tr>').join('') +
          '</table>';
        el.querySelectorAll('tbody tr, tr').forEach(() => {});
        // insert names safely (no HTML injection)
        const rows = el.querySelectorAll('tr');
        j.scores.forEach((s, i) => { if (rows[i + 1]) rows[i + 1].children[1].textContent = s.name; });
      } catch (e) {
        el.textContent = 'Score boards unavailable offline. Your local progress is safe.';
      }
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
    rebuildAll();
    saveStore();
    funnel('settings-change');
  }
  function bindSettings() {
    const s = store.settings;
    $('set-music').addEventListener('input', e => { s.music = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-fx').addEventListener('input', e => { s.fx = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-ambience').addEventListener('input', e => { s.ambience = +e.target.value; audio.applyVolumes(); saveStore(); });
    $('set-palette').addEventListener('change', e => { s.palette = e.target.value; applySettings(); });
    $('set-quality').addEventListener('change', e => { s.quality = e.target.value; applySettings(); });
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
  document.addEventListener('keydown', ev => {
    if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
    const k = ev.key;
    if (k === 'Escape') {
      if (session.selectedVehicle >= 0 && session.screen === 'active') {
        session.selectedVehicle = -1; rebuildBoard(); announce('Selection cancelled');
      } else if (session.screen === 'active') pauseGame();
      else if (session.screen === 'paused') resumeGame();
      else if (['help', 'settings', 'scores', 'setup', 'journey'].includes(session.screen)) setScreen(session.state && session.state.status === 'active' ? 'active' : 'title');
      ev.preventDefault();
      return;
    }
    if (session.screen !== 'active') return;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      const t = kbTargets();
      if (!t.length) return;
      const dir = (k === 'ArrowLeft' || k === 'ArrowUp') ? -1 : 1;
      kbFocus.index = (kbFocus.index + dir + t.length) % t.length;
      const idx = t[kbFocus.index];
      if (session.selectedVehicle >= 0) announce('Queue ' + (idx + 1) + ': ' + (session.state.q[idx].map(c => COLOR_NAMES[c - 1]).join(', ') || 'empty'));
      else announce('Vehicle ' + (idx + 1) + ': ' + COLOR_NAMES[session.state.v[idx].c - 1] + ', ' + session.state.v[idx].n + ' left');
      ev.preventDefault();
    } else if (k === 'Enter' || k === ' ') {
      const t = kbTargets();
      if (!t.length) return;
      const idx = t[Math.min(kbFocus.index, t.length - 1)];
      if (session.selectedVehicle >= 0) commitDispatch(session.selectedVehicle, idx);
      else handlePick({ kind: 'vehicle', index: idx });
      kbFocus.index = 0;
      ev.preventDefault();
    } else if (k === 'u' || k === 'U') { undo(); }
    else if (k === 'h' || k === 'H') { doHint(); }
    else if (k === 'r' || k === 'R') { resetCamera(); }
    else if (k === 'p' || k === 'P') { pauseGame(); }
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
    if (once('left', axisX < -0.5 || pressed(14))) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    if (once('right', axisX > 0.5 || pressed(15))) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    if (once('a', pressed(0))) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    if (once('b', pressed(1))) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
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
    $('btn-help-close').addEventListener('click', () => setScreen(helpReturn === 'active' ? 'active' : helpReturn));
    $('btn-settings-close').addEventListener('click', () => setScreen(settingsReturn === 'active' ? 'active' : settingsReturn));
    $('btn-pause').addEventListener('click', pauseGame);
    $('btn-resume').addEventListener('click', resumeGame);
    $('btn-restart').addEventListener('click', () => {
      const m = session.mode;
      if (m === 'practice') startRound('practice', { difficulty: session.difficulty });
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
    el.textContent = 'Next daily seed in ' + h + 'h ' + m + 'm ' + s + 's (UTC)' + (net.online ? '' : ' · offline — local clock');
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
    if (scene3.ready) renderer.render(scene, camera);
  }

  function resize() {
    if (!scene3.ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // portrait: pull back to keep queues in frame
    const dist = w < h ? 1 + (h / w - 1) * 0.55 : 1;
    scene3.camHome.set(0, 15 * dist, 17 * dist);
    if (!store.settings.reducedMotion) { /* keep current camera; reset applies */ }
    camera.position.copy(scene3.camHome);
    camera.lookAt(0, 0, 0.5);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));

  /* ============================== boot ============================== */
  function boot() {
    initScene();
    bindUI();
    bindSettings();
    ui.buildHelp();
    applySettings();
    ui.updateAll();
    setScreen('title');
    net.syncTime().then(tickDailyCountdown);
    setInterval(tickDailyCountdown, 1000);
    requestAnimationFrame(loop);
    funnel('boot');
    // left-handed: swap rails
    if (store.settings.leftHand) {
      $('rail-left').style.left = 'auto'; $('rail-left').style.right = 'calc(10px + var(--sar))';
      $('rail-right').style.right = 'auto'; $('rail-right').style.left = 'calc(10px + var(--sal))';
    }
  }
  boot();
  // debug/test handle (read-only rules access plus flow control)
  window.__tt = { session, startRound, commitDispatch, undo, doHint, R, store };
})();
