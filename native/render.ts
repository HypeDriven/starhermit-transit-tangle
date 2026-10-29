// The transit plaza on starhermit:scene, as the browser build's app.js drew
// it with three.js r170: the round plaza (paving texture when detailed), its
// accent ring, planters and (detailed) bollard lamps, the holding-lane pad
// with its capacity discs and boarding line, the passenger queues on their
// platforms (one pawn shape per colour), the vehicles at the depot (body,
// cab, window band, wheels and lamps when detailed, pips for the vehicles
// left), the selection ring and the legal-target markers (green: match,
// amber: to holding), the boarding sparks, the pawns' idle bob and the
// tweens of a displaced passenger. Graphics follow the runtime's quality
// tier (native/quality.ts: gfx.js's presets and budgets) and the palette
// option.
//
// Engine minor 23 is three.js r185's light units and shadows, so r170's
// intensities (sun 2.4 / hemisphere 1.1, or 2.15 / 0.7 with reflections) and
// the sun's shadow (fitted box, bias −0.0004, normal bias 0.02) are the
// page's own values. Reflections are as the page set them up:
// RoomEnvironment prefiltered with sigma 0.04 as scene.environment at
// environmentIntensity 0.32 (r163+: the renderer argument gives the same
// room the page's r170 built). The composer (GTAO → bloom 0.5/0.35/1.15 →
// OutputPass with ACES 1.0 → the grade + vignette in display space →
// SMAA / FXAA) is the runtime's renderer.ao / bloom / grade / antialias.
// The old canvas spanned the window under the HUD, tray and coach; the
// camera's view offset frames the board in what they leave, as fitCamera did.
import {
  ACESFilmicToneMapping, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Points,
  PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, RoundedBoxGeometry, SRGBColorSpace, Sphere,
  SphereGeometry, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene,
  type BufferGeometry as Geo, type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { R, type Events, type State } from "./game.ts";
import { sparkCount, type Look } from "./quality.ts";

export interface Rect { x: number; y: number; width: number; height: number }

export const PALETTES: Record<string, number[]> = {
  default: [0xf5a623, 0x29b6f6, 0xef5350, 0x66bb6a, 0xab47bc],
  cvd: [0xe69f00, 0x56b4e9, 0xd55e00, 0x009e73, 0xcc79a7],
  contrast: [0xffb000, 0x0055ff, 0xff2222, 0x008844, 0x8800cc],
};
const THEMES: Record<string, { ground: number; sky: number; accent: number }> = {
  plaza: { ground: 0xf2f5f7, sky: 0xdfeaf5, accent: 0x8fb8d8 },
  garden: { ground: 0xe6f2e2, sky: 0xe3f0e6, accent: 0x7fbf8a },
  harbor: { ground: 0xe8eef2, sky: 0xd6e6f0, accent: 0x6f9fc0 },
  market: { ground: 0xf7efe4, sky: 0xf2e8d8, accent: 0xd8a86f },
  night: { ground: 0x2c3550, sky: 0x1d2438, accent: 0x5566aa },
};

// ---------------------------------------------------------------- the scene
const camera = new PerspectiveCamera(42, 1, 0.1, 200);
const LOOK_AT = new Vector3(0, 0, 0.5);
const camHome = new Vector3(0, 15, 17);
camera.position.copy(camHome);
camera.lookAt(LOOK_AT);
const raycaster = new Raycaster();
const ndc = new Vector2();

// warm key light with a shadow box fitted to the board (fitShadow)
const sun = new DirectionalLight(0xfff4e6, 2.4);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize = 1024;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
const shadowCam = sun.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
Object.assign(shadowCam, { left: -16, right: 16, top: 16, bottom: -16 });
scene.add(sun, sun.target);
const hemi = new HemisphereLight(0xf4f8ff, 0x8899aa, 1.1);
scene.add(hemi);
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

let look: Look | null = null;
let palette = "default";
let reduced = false;
let envTex: Texture | null = null;
let themeName = "plaza";
let decorSeed = 7;
let state: State | null = null;
let selected = -1;
let time = 0;

// particle pool (bounded, cosmetic only, never raycast)
const PMAX = 200;
const pGeo = new BufferGeometry();
pGeo.setAttribute("position", new BufferAttribute(new Float32Array(PMAX * 3), 3));
pGeo.setAttribute("color", new BufferAttribute(new Float32Array(PMAX * 3).fill(1), 3));
interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; r: number; g: number; b: number }
const live: Spark[] = [];
let particles: Points | null = null;

function sparkTexture(): Texture {
  const cv = new OffscreenCanvas(64, 64);
  const g = cv.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.85)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
function ensureParticles(): void {
  if (particles) return;
  const spark = sparkTexture();
  particles = new Points(pGeo, new PointsMaterial({
    color: new Color(0xffffff), size: 0.2, map: spark, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, alphaTest: 0.02,
  }));
  particles.frustumCulled = false;
  scene.add(particles);
}

// ---------------------------------------------------------------- materials and geometry (app.js caches)
const GEO: Record<string, Geo> = {};
const MAT: Record<string, Material> = {};
const glow = (k: number): number => (look?.bloom ? k : 1);
const detailed = (): boolean => !!look?.detailed;
const seg = (n: number, min = 4): number => Math.max(min, Math.round(n * (look ? look.budget.segments : 1)));
type Params = Record<string, unknown>;
/** app.js litMaterial: Lambert (Low), Standard (Balanced), Physical where asked (High, Ultra); parameters a class lacks are dropped. */
function litMaterial(opts: Params, physical = false): Material {
  const tier = look ? look.budget.material : "standard";
  const p: Params = {};
  for (const [k, v] of Object.entries(opts)) p[k] = typeof v === "number" && (k === "color" || k === "emissive") ? new Color(v) : v;
  if (tier === "lambert") {
    const { roughness: _r, metalness: _m, clearcoat: _c, clearcoatRoughness: _cr, ...rest } = p;
    return new MeshLambertMaterial(rest);
  }
  if (physical && tier === "physical") return new MeshPhysicalMaterial(p);
  const { clearcoat: _c, clearcoatRoughness: _cr, ...rest } = p;
  return new MeshStandardMaterial(rest);
}
function colorOf(c: number): number { return PALETTES[palette]![c - 1]!; }
function sharedGeo(key: string, make: () => Geo): Geo { return GEO[key] || (GEO[key] = make()); }
function roundedBox(key: string, w: number, h: number, d: number, r: number): Geo {
  return sharedGeo(key, () => (detailed() ? new RoundedBoxGeometry(w, h, d, look!.budget.bevel, r) : new BoxGeometry(w, h, d)));
}
function pawnGeo(c: number): Geo {
  return sharedGeo(`p${c}`, () => [
    () => new SphereGeometry(0.28, seg(16, 8), seg(12, 6)),
    () => new ConeGeometry(0.26, 0.55, seg(14, 6)),
    () => new BoxGeometry(0.42, 0.42, 0.42),
    () => new CapsuleGeometry(0.2, 0.3, seg(6, 3), seg(12, 6)),
    () => new CylinderGeometry(0.2, 0.28, 0.5, seg(12, 6)),
  ][(c - 1) % 5]!());
}
function colorMat(c: number): Material {
  const det = detailed();
  const key = `c${c}-${palette}${det ? "-d" : ""}`;
  if (!MAT[key]) {
    MAT[key] = det
      ? litMaterial({ color: colorOf(c), roughness: 0.42, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.25 }, true)
      : litMaterial({ color: colorOf(c), roughness: 0.55, metalness: 0.05 });
  }
  return MAT[key]!;
}
function plainMat(color: number, opts?: Params): Material {
  const key = `m${color}${JSON.stringify(opts || "")}`;
  if (!MAT[key]) MAT[key] = litMaterial({ color, roughness: 0.8, metalness: 0.02, ...(opts || {}) });
  return MAT[key]!;
}
function physMat(key: string, opts: Params): Material {
  if (!MAT[key]) MAT[key] = litMaterial(opts, true);
  return MAT[key]!;
}
/** Emissive-looking accents (markers, lamps): unlit, pushed into HDR when bloom is on. */
function glowMat(color: number, k: number, opts?: Params): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ color: new Color(color), ...(opts || {}) });
  mat.color.multiplyScalar(glow(k));
  return mat;
}
const paving: Record<string, Texture> = {};
/** gfx-render.js pavingTexture: square slabs with mortar lines and per-slab tone noise. */
function pavingTexture(base: number, seed: number, px: number): Texture {
  const size = 256, n = 8, cell = size / n;
  const cv = new OffscreenCanvas(px, px);
  const g = cv.getContext("2d")!;
  g.scale(px / size, px / size);
  const col = new Color(base);
  let s = (seed >>> 0) || 1;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const hsl = { h: 0, s: 0, l: 0 };
  const dark = col.getHSL(hsl).l < 0.4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = 1 + (rnd() - 0.5) * (dark ? 0.16 : 0.07);
      g.fillStyle = `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * 0.06;
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  g.strokeStyle = dark ? "rgba(0,0,0,0.3)" : "rgba(90,105,120,0.16)";
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke();
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
function groundMat(t: { ground: number }, name: string): Material {
  if (!detailed()) return plainMat(t.ground);
  const key = `ground-${name}`;
  if (!MAT[key]) {
    const px = look!.budget.texture;
    const pk = `${name}:${px}`;
    if (!paving[pk]) paving[pk] = pavingTexture(t.ground, name.length * 977, px);
    const tex = paving[pk]!;
    tex.repeat.set(5, 5);
    MAT[key] = litMaterial({ map: tex, roughness: 0.85, metalness: 0 });
  }
  return MAT[key]!;
}
function dropCaches(): void {
  for (const k of Object.keys(GEO)) { GEO[k]!.dispose(); delete GEO[k]; }
  for (const k of Object.keys(MAT)) { MAT[k]!.dispose(); delete MAT[k]; }
}

// ---------------------------------------------------------------- environment
let envGroup: Group | null = null;
let bulbs: { mat: MeshBasicMaterial; base: Color } | null = null;
function disposeGroup(g: Object3D): void {
  const shared = new Set<unknown>(Object.values(GEO));
  const sharedM = new Set<unknown>(Object.values(MAT));
  g.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
    const mat = m.material as Material | undefined;
    if (mat && !Array.isArray(mat) && !sharedM.has(mat)) mat.dispose();
  });
}
function buildEnvironment(): void {
  if (!look) return;
  if (envGroup) { scene.remove(envGroup); disposeGroup(envGroup); }
  const t = THEMES[themeName] || THEMES.plaza!;
  scene.background = new Color(t.sky);
  const env = new Group();
  const ground = new Mesh(new CylinderGeometry(15, 15, 0.5, seg(detailed() ? 96 : 48, 24)), groundMat(t, themeName));
  ground.position.y = -0.25;
  ground.receiveShadow = true;
  env.add(ground);
  const ring = new Mesh(new TorusGeometry(13.2, 0.12, seg(8, 4), seg(64, 24)), plainMat(t.accent));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
  env.add(ring);
  const dr = R.rng((decorSeed * 2654435761) >>> 0);
  const pots = new InstancedMesh(new CylinderGeometry(0.35, 0.28, 0.5, seg(10, 6)), plainMat(0xb08968), 10);
  const bushes = new InstancedMesh(new SphereGeometry(0.4, seg(10, 6), seg(8, 4)), plainMat(0x6a994e), 10);
  const m4 = new Matrix4();
  for (let i = 0; i < 10; i++) {
    const a = dr() * Math.PI * 2, rad = 12.2 + dr() * 1.4;
    m4.makeTranslation(Math.cos(a) * rad, 0.25, Math.sin(a) * rad);
    pots.setMatrixAt(i, m4);
    m4.makeTranslation(Math.cos(a) * rad, 0.75, Math.sin(a) * rad);
    bushes.setMatrixAt(i, m4);
  }
  pots.castShadow = bushes.castShadow = true;
  env.add(pots, bushes);
  const pad = new Mesh(roundedBox("rb-pad", 10, 0.1, 1.6, 0.04), plainMat(0xe8d9b0, detailed() ? { roughness: 0.7 } : undefined));
  pad.position.set(0, 0.05, 2.6);
  pad.receiveShadow = true;
  env.add(pad);
  bulbs = null;
  if (detailed()) {
    const n = 12;
    const poles = new InstancedMesh(new CylinderGeometry(0.09, 0.11, 0.5, seg(10, 6)), plainMat(0x3a4250, { roughness: 0.45, metalness: 0.5 }), n);
    const bulbMat = glowMat(themeName === "night" ? 0xffd79a : 0xfff0d0, themeName === "night" ? 4 : 2.6);
    const bulbMesh = new InstancedMesh(new CylinderGeometry(0.1, 0.1, 0.1, seg(12, 6)), bulbMat, n);
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2, rad = 12.7;
      m4.makeTranslation(Math.cos(a) * rad, 0.25, Math.sin(a) * rad); poles.setMatrixAt(i, m4);
      m4.makeTranslation(Math.cos(a) * rad, 0.55, Math.sin(a) * rad); bulbMesh.setMatrixAt(i, m4);
    }
    poles.castShadow = true;
    env.add(poles, bulbMesh);
    bulbs = { mat: bulbMat, base: bulbMat.color.clone() };
    const line = new Mesh(new BoxGeometry(9.6, 0.012, 0.06), plainMat(0xf2c14e, { roughness: 0.6 }));
    line.position.set(0, 0.106, 2.0);
    env.add(line);
  }
  scene.add(env);
  envGroup = env;
}

// ---------------------------------------------------------------- the board
interface Bob { o: Object3D; y: number; ph: number; amp: number; lift?: number; ring?: Mesh }
let board: Group | null = null;
let bob: Bob[] = [];
let vehicleGroups: Group[] = [];
let queuePlats: Mesh[] = [];
interface Tween { obj: Vector3; to: Vector3; t: number; dur: number }
let tweens: Tween[] = [];
function layout(n: number, spacing: number, z: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * spacing, z });
  return out;
}
function rebuildBoard(ev?: Events | null): void {
  if (!look) return;
  if (board) { scene.remove(board); disposeGroup(board); board = null; }
  bob = []; vehicleGroups = []; queuePlats = [];
  const s = state;
  if (!s) return;
  const g = new Group();
  const det = detailed();
  const qPos = layout(s.q.length, 2.6, -1.6);
  s.q.forEach((lane, qi) => {
    const plat = new Mesh(roundedBox("rb-plat", 2.0, 0.18, 6.2, 0.06), plainMat(0xdde5ec, det ? { roughness: 0.6 } : undefined));
    plat.position.set(qPos[qi]!.x, 0.09, -1.6 - 2.0);
    plat.receiveShadow = true;
    plat.userData.queueIndex = qi;
    g.add(plat);
    queuePlats.push(plat);
    if (det) {
      const stripe = new Mesh(sharedGeo("stripe", () => new BoxGeometry(1.8, 0.012, 0.14)), plainMat(0xf2c14e, { roughness: 0.6 }));
      stripe.position.set(qPos[qi]!.x, 0.186, -0.72);
      stripe.userData.queueIndex = qi;
      g.add(stripe);
    }
    lane.forEach((c, idx) => {
      const m = new Mesh(pawnGeo(c), colorMat(c));
      m.position.set(qPos[qi]!.x, 0.55, -0.9 - idx * 0.95);
      m.castShadow = true;
      m.receiveShadow = det;
      m.userData.queueIndex = qi;
      g.add(m);
      bob.push({ o: m, y: 0.55, ph: qi * 1.7 + idx * 0.9, amp: 0.035 });
      if (ev && ev.displaced.some((d) => d.queue === qi) && idx === 0) tweenScaleIn(m);
    });
  });
  s.h.forEach((c, i) => {
    const m = new Mesh(pawnGeo(c), colorMat(c));
    m.position.set(-4.5 + i * 1.0, 0.55, 2.6);
    m.castShadow = true;
    g.add(m);
    bob.push({ o: m, y: 0.55, ph: 5 + i * 1.3, amp: 0.025 });
    if (ev && ev.displaced.length && i === s.h.length - 1) tweenFrom(m, qPos[ev.displaced[0]!.queue]!.x, -0.9);
  });
  for (let i = 0; i < s.holdingCap; i++) {
    const tick = new Mesh(sharedGeo(`tick${det}`, () => new CylinderGeometry(0.32, 0.32, 0.04, det ? 24 : 16)), plainMat(i < s.h.length ? 0xd64545 : 0xcccccc));
    tick.position.set(-4.5 + i * 1.0, 0.12, 2.6);
    g.add(tick);
  }
  const vPos = layout(s.v.length, 2.8, 5.4);
  s.v.forEach((veh, vi) => {
    const grp = new Group();
    const body = new Mesh(roundedBox("rb-body", 1.6, 0.7, 1.0, 0.12), colorMat(veh.c));
    body.position.y = 0.45;
    body.castShadow = true;
    const cab = new Mesh(roundedBox("rb-cab", 0.7, 0.5, 0.9, 0.08),
      det ? physMat("cab", { color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }) : plainMat(0xffffff));
    cab.position.set(-0.3, 1.0, 0);
    cab.castShadow = det;
    grp.add(body, cab);
    if (det) {
      const glass = new Mesh(sharedGeo("glass", () => new BoxGeometry(0.74, 0.2, 0.94)),
        physMat("glass", { color: 0x1c2a3a, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }));
      glass.position.set(-0.3, 1.08, 0);
      grp.add(glass);
      const wheelGeo = sharedGeo("wheel", () => new CylinderGeometry(0.17, 0.17, 0.12, seg(18, 8)).rotateX(Math.PI / 2));
      for (const [wx, wz] of [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]] as const) {
        const wheel = new Mesh(wheelGeo, plainMat(0x262a31, { roughness: 0.75 }));
        wheel.position.set(wx, 0.17, wz);
        grp.add(wheel);
      }
      const lampMat = glowMat(0xfff3c4, 3);
      for (const lz of [-0.3, 0.3]) {
        const lamp = new Mesh(sharedGeo("lamp", () => new BoxGeometry(0.03, 0.1, 0.16)), lampMat);
        lamp.position.set(-0.815, 0.55, lz);
        grp.add(lamp);
      }
    }
    for (let k = 0; k < veh.n; k++) {
      const pip = new Mesh(sharedGeo("pip", () => new SphereGeometry(0.12, seg(12, 6), seg(8, 4))), colorMat(veh.c));
      pip.position.set(-0.5 + k * 0.32, 1.45, 0);
      grp.add(pip);
    }
    grp.traverse((ch) => { ch.userData.vehicleIndex = vi; });
    grp.position.set(vPos[vi]!.x, 0, vPos[vi]!.z);
    if (veh.n < 1) grp.children.forEach((ch) => { (ch as Mesh).material = plainMat(0x9aa7b2); });
    g.add(grp);
    vehicleGroups.push(grp);
    if (selected === vi) {
      const ring = new Mesh(new RingGeometry(0.9, 1.1, 32), glowMat(0x3b82f6, 1.8, { side: DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(vPos[vi]!.x, 0.06, vPos[vi]!.z);
      g.add(ring);
      bob.push({ o: grp, y: 0, ph: 0, amp: 0.06, lift: 0.08, ring });
    }
  });
  if (selected >= 0 && s.status === "active") {
    s.q.forEach((lane, qi) => {
      if (!lane.length) return;
      const p = R.preview(s, selected, qi);
      if (!p.ok) return;
      const mk = new Mesh(new RingGeometry(0.35, 0.5, 24), glowMat(p.match ? 0x2f9e63 : 0xc77d0a, 1.8, { side: DoubleSide, transparent: true, opacity: 0.9 }));
      mk.rotation.x = -Math.PI / 2;
      mk.position.set(qPos[qi]!.x, 0.22, -0.9);
      g.add(mk);
    });
  }
  scene.add(g);
  board = g;
  fitShadow(g);
  if (ev && ev.boarded.length) burst(qPos[ev.queue] ? { x: qPos[ev.queue]!.x, z: -0.9 } : { x: 0, z: 3.5 }, ev.color);
}
function fitShadow(g: Group): void {
  const box = new Box3().setFromObject(g);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new Sphere());
  const dir = new Vector3(-8, 18, 10).normalize();
  sun.target.position.copy(sphere.center);
  sun.position.copy(sphere.center).addScaledVector(dir, 30);
  const r = sphere.radius + 0.6;
  Object.assign(shadowCam, { left: -r, right: r, top: r, bottom: -r, near: 30 - r - 2, far: 30 + r + 2 });
  shadowCam.updateProjectionMatrix();
}
function tweenScaleIn(m: Object3D): void {
  if (reduced) return;
  m.scale.set(0.01, 0.01, 0.01);
  tweens.push({ obj: m.scale, to: new Vector3(1, 1, 1), t: 0, dur: 0.25 });
}
function tweenFrom(m: Object3D, x: number, z: number): void {
  if (reduced) return;
  const target = m.position.clone();
  m.position.set(x, 0.55, z);
  tweens.push({ obj: m.position, to: target, t: 0, dur: 0.4 });
}
let sparkRnd = 0x2545f491;
const rnd = (): number => ((sparkRnd = (sparkRnd * 1664525 + 1013904223) >>> 0) / 4294967296);
const sparkColor = new Color();
function burst(at: { x: number; z: number }, colorIndex: number): void {
  if (reduced || !look) return;
  ensureParticles();
  const base = colorIndex ? colorOf(colorIndex) : 0xffffff;
  const n = sparkCount(look);
  for (let i = 0; i < n; i++) {
    sparkColor.set(i % 3 === 0 ? 0xffffff : base).multiplyScalar(glow(2.4));
    live.push({
      x: at.x + (rnd() - 0.5), y: 1 + rnd(), z: at.z + (rnd() - 0.5),
      vx: (rnd() - 0.5) * 1.5, vy: 2 + rnd() * 1.5, vz: (rnd() - 0.5) * 1.5, t: 0.8, r: sparkColor.r, g: sparkColor.g, b: sparkColor.b,
    });
  }
  if (live.length > PMAX) live.splice(0, live.length - PMAX);
}
function stepParticles(dt: number): void {
  if (!particles) return;
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i]!;
    p.t -= dt; p.vy -= 4 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.t <= 0 || p.y < 0) live.splice(i, 1);
  }
  const pos = pGeo.getAttribute("position") as BufferAttribute, col = pGeo.getAttribute("color") as BufferAttribute;
  for (let i = 0; i < PMAX; i++) {
    const p = live[i];
    pos.setXYZ(i, p ? p.x : 0, p ? p.y : -10, p ? p.z : 0);
    if (p) col.setXYZ(i, p.r, p.g, p.b);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ---------------------------------------------------------------- public
/** A new round's plaza (theme, decor seed) and board. */
export function setRound(s: State | null, theme: string): void {
  const nextSeed = s ? s.seed : 7;
  const envChanged = theme !== themeName || nextSeed !== decorSeed || !envGroup;
  themeName = theme; decorSeed = nextSeed; state = s; selected = -1;
  tweens = []; live.length = 0;
  if (envChanged) buildEnvironment();
  rebuildBoard();
  frameKey = ""; // a new board: frame it again (fitCamera)
}
/** The board after a dispatch / selection / undo (events animate a dispatch). */
export function sync(s: State | null, sel: number, ev?: Events | null): void {
  state = s; selected = sel;
  rebuildBoard(ev);
}
/** The runtime's quality tier applied live (app.js computeQuality + rebuildAll). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  if (prev && (prev.budget.material !== next.budget.material || prev.budget.segments !== next.budget.segments ||
    prev.budget.bevel !== next.budget.bevel || prev.budget.texture !== next.budget.texture || prev.detailed !== next.detailed || prev.bloom !== next.bloom)) {
    if (board) { scene.remove(board); disposeGroup(board); board = null; }
    if (envGroup) { scene.remove(envGroup); disposeGroup(envGroup); envGroup = null; }
    dropCaches();
  }
  renderer.shadowMap.enabled = next.shadows > 0;
  sun.castShadow = next.shadows > 0;
  if (next.shadows > 0) sun.shadow.mapSize = next.shadows;
  if (next.reflections && !envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; } catch (e) { console.warn(`environment: ${String(e)}`); }
  }
  scene.environment = next.reflections ? envTex : null;
  scene.environmentIntensity = 0.32;
  hemi.intensity = scene.environment ? 0.7 : 1.1;
  sun.intensity = scene.environment ? 2.15 : 2.4;
  // r170 page bloom 0.5, squared for the r185 UnrealBloom of minor 29
  renderer.bloom = next.bloom ? { strength: 0.25, radius: 0.35, threshold: 1.15, resolution: next.budget.bloomRes } : null;
  const hi = next.ao === "high";
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: hi ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader after OutputPass: an 0.18 S-curve, saturation 1.1, cool shadows / warm highlights by a smoothstep of luma
  // 0.2–0.85, a 0.2 vignette from 0.4 to 0.9 with x × 1.1.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.09, saturation: 1.1, split: [0.2, 0.85], shadows: [0.97, 0.99, 1.04], highlights: [1.03, 1.0, 0.97],
    vignette: { amount: 0.2, inner: 0.4, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  if (particles) (particles.material as PointsMaterial).size = next.particles === "high" ? 0.26 : 0.18;
  if (!envGroup) buildEnvironment();
  rebuildBoard();
}
export function setPalette(name: string): void {
  if (name === palette || !PALETTES[name]) return;
  palette = name;
  rebuildBoard();
}
export function setReducedMotion(v: boolean): void { reduced = v; }
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
export function colorHex(c: number): string { return "#" + colorOf(c).toString(16).padStart(6, "0"); }

// ---------------------------------------------------------------- framing and picking
let frameKey = "";
let win = { w: 1, h: 1 };
/** app.js fitCamera: the view offset frames the safe rect; the camera pulls back along its axis until the board fits. */
function fitCamera(safe: Rect): void {
  const { w, h } = win;
  const sw = Math.max(1, safe.width), sh = Math.max(1, safe.height);
  if (sw < w * 0.45 || sh < h * 0.35) { camera.aspect = w / h; camera.clearViewOffset(); }
  else { camera.aspect = sw / sh; camera.setViewOffset(sw, sh, -safe.x, -safe.y, w, h); }
  camera.updateProjectionMatrix();
  const base = new Vector3(0, 15, 17);
  const dir = base.clone().sub(LOOK_AT).normalize();
  const box = board ? new Box3().setFromObject(board) : new Box3(new Vector3(-7, 0, -7), new Vector3(7, 2, 7));
  if (box.isEmpty()) box.set(new Vector3(-7, 0, -7), new Vector3(7, 2, 7));
  box.expandByScalar(0.8);
  const pts: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new Vector3(x, y, z));
  const probe = new PerspectiveCamera(camera.fov, camera.aspect, 0.1, 200);
  const v = new Vector3();
  let d = base.distanceTo(LOOK_AT) * 0.7;
  for (let i = 0; i < 14; i++) {
    probe.position.copy(LOOK_AT).addScaledVector(dir, d);
    probe.lookAt(LOOK_AT); probe.updateMatrixWorld(); probe.updateProjectionMatrix();
    let over = 0;
    for (const q of pts) { v.copy(q).project(probe); over = Math.max(over, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.92); }
    if (over <= 1) break;
    d *= Math.min(1.6, over + 0.02);
  }
  camHome.copy(LOOK_AT).addScaledVector(dir, d);
  resetCamera();
}
/** R: the home view again (app.js resetCamera). */
export function resetCamera(): void { camera.position.copy(camHome); camera.lookAt(LOOK_AT); }

/** The vehicle or queue under a window point (app.js pointerPick). */
export function pick(x: number, y: number): { kind: "vehicle" | "queue"; index: number } | null {
  if (!board) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const targets: Object3D[] = [];
  for (const g of vehicleGroups) for (const c of g.children) targets.push(c);
  for (const ch of board.children) if (ch.userData.queueIndex != null) targets.push(ch);
  for (const h of raycaster.intersectObjects(targets, false)) {
    const u = h.object.userData;
    if (u.vehicleIndex != null) return { kind: "vehicle", index: u.vehicleIndex as number };
    if (u.queueIndex != null) return { kind: "queue", index: u.queueIndex as number };
  }
  return null;
}
const corner = new Vector3();
function screenRect(o: Object3D): Rect | null {
  const box = new Box3().setFromObject(o);
  if (box.isEmpty()) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    corner.set(x, y, z).project(camera);
    const px = ((corner.x + 1) / 2) * win.w, py = ((1 - corner.y) / 2) * win.h;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
/** Window rects of each vehicle and queue platform (named targets: screen readers, play scripts). */
export function targetRects(): { vehicles: (Rect | null)[]; queues: (Rect | null)[] } {
  camera.updateMatrixWorld();
  return { vehicles: vehicleGroups.map(screenRect), queues: queuePlats.map(screenRect) };
}

// ---------------------------------------------------------------- each frame
/** app.js loop: tweens, particles, idle motion; framing to `safe` (window px). */
export function update(dt: number, w: number, h: number, safe: Rect): void {
  dt = Math.min(0.05, dt);
  if (w > 0 && h > 0) {
    const fk = `${w}x${h}:${Math.round(safe.x)}:${Math.round(safe.y)}:${Math.round(safe.width)}:${Math.round(safe.height)}`;
    if (fk !== frameKey) { frameKey = fk; win = { w, h }; fitCamera(safe); }
  }
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]!;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.obj.lerp(tw.to, 1 - Math.pow(1 - k, 3));
    if (k >= 1) tweens.splice(i, 1);
  }
  stepParticles(dt);
  const animated = !!look?.animated && !reduced;
  if (!animated) {
    if (time !== 0) for (const b of bob) { b.o.position.y = b.y + (b.lift || 0); b.ring?.scale.setScalar(1); }
    time = 0;
    return;
  }
  time += dt;
  for (const b of bob) {
    if (tweens.some((tw) => tw.obj === b.o.position)) continue;
    b.o.position.y = b.y + (b.lift || 0) + Math.sin(time * 2.2 + b.ph) * b.amp;
    if (b.ring) b.ring.scale.setScalar(1 + 0.05 * Math.sin(time * 4));
  }
  if (bulbs) bulbs.mat.color.copy(bulbs.base).multiplyScalar(0.94 + 0.06 * Math.sin(time * 1.3));
}
