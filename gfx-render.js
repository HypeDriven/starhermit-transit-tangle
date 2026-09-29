// Transit Tangle render helpers that need three.js: post-processing chain, image-based
// lighting and procedural textures. index.html merges these into window.TTGfx (next to the
// pure quality model and panel strings) before app.js runs.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Colour grade + vignette, applied after OutputPass (display-space colours in and out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.2 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve, a little more saturation, warm highlights and cool shadows.
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.1);
      c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.97), smoothstep(0.2, 0.85, l));
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.4, 0.9, d);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }`,
};

/** Build the post chain for resolved settings `q`; returns null when nothing needs it. */
function buildComposer(renderer, scene, camera, w, h, ratio, q) {
  if (!q.post) return null;
  const pw = Math.max(1, Math.round(w * ratio)), ph = Math.max(1, Math.round(h * ratio));
  const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  if (q.ao !== 'off') {
    const hi = q.ao === 'high';
    const ao = new GTAOPass(scene, camera, pw, ph);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.75;
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: hi ? 16 : 8 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
    composer.addPass(ao);
  }
  // Scene-linear bloom with a high threshold: only emissive markers, lamps and sparks glow.
  if (q.bloom === 'on') composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.35, 1.15));
  composer.addPass(new OutputPass());
  if (q.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
  if (q.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
  if (q.antialias === 'fxaa') {
    const fxaa = new ShaderPass(FXAAShader);
    fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
    composer.addPass(fxaa);
  }
  return composer;
}

/** Prefiltered studio environment for PBR reflections (built once per renderer). */
function roomEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const tex = pmrem.fromScene(room, 0.04).texture;
  room.dispose?.();
  pmrem.dispose();
  return tex;
}

/** Deterministic paving texture: square slabs with mortar lines and per-slab tone noise. */
function pavingTexture(base, seed) {
  const size = 256, n = 8, cell = size / n;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const col = new THREE.Color(base);
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const dark = col.getHSL({}).l < 0.4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = 1 + (rnd() - 0.5) * (dark ? 0.16 : 0.07);
      g.fillStyle = `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // fine grain
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * 0.06;
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // mortar
  g.strokeStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(90,105,120,0.16)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Soft round sprite for particles. */
function sparkTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { buildComposer, roomEnvironment, pavingTexture, sparkTexture, RoundedBoxGeometry };
