// Unit tests for the pure graphics quality model (node --test tests/gfx.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { detectPreset, detectLevel, presetForLevel, budgetFor, resolve, choosePreset, presetTier, describe, CATEGORIES, PRESETS,
  LEVELS, BUDGETS, SPARK_MAX } = await import('../gfx.js');
const { GFX_STRINGS, pickLocale } = await import('../gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = Object.keys(BUDGETS.low);
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).sparks > budgetFor('balanced', 4).sparks, 'counts scale up within the preset');
  assert.ok(budgetFor('balanced', 20).sparks <= 2 * BUDGETS.balanced.sparks, '≤ 2×');
  assert.ok(budgetFor('ultra', 20).sparks <= SPARK_MAX);
  const head = resolve({}, 'low', 0);
  assert.equal(head.preset, 'low', 'headless SwiftShader: Low');
  assert.equal(head.level, 0);
});

test('every locale has the Level label', () => {
  for (const [tag, T] of Object.entries(GFX_STRINGS)) assert.match(T.level, /\{n\}/, tag);
});

test('resolve uses the detected preset for auto and honours explicit presets', () => {
  assert.equal(resolve({}, 'low').preset, 'low');
  assert.equal(resolve({ preset: 'auto' }, 'high').auto, true);
  const r = resolve({ preset: 'ultra' }, 'low');
  assert.equal(r.preset, 'ultra');
  assert.equal(r.auto, false);
  assert.equal(r.shadows, 'high');
  assert.equal(resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('low preset is the cheap no-post baseline', () => {
  const r = resolve({ preset: 'low' });
  assert.equal(r.post, false);
  assert.equal(r.shadows, 'off');
  assert.equal(r.reflections, 'off');
  assert.equal(r.dpr, 1);
});

test('overrides win over the preset; invalid tiers fall back', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'nope' });
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, true);
});

test('render scale clamps to 50–200% of the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
});

test('adaptive defaults on, fps readout defaults off', () => {
  const r = resolve({});
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }).adaptive, false);
});

test('choosing a preset clears category overrides but keeps scale and toggles', () => {
  const s = choosePreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, show_fps: true }, 'high');
  assert.equal(s.preset, 'high');
  for (const c of Object.keys(CATEGORIES)) assert.equal(s[c], undefined);
  assert.equal(s.render_scale, 1.5);
  assert.equal(s.show_fps, true);
  assert.equal(choosePreset({}, 'auto').preset, 'auto');
});

test('presetTier and describe', () => {
  assert.equal(presetTier('balanced', 'shadows'), 'low');
  assert.equal(presetTier('nope', 'shadows'), undefined);
  const d = describe(resolve({ preset: 'high' }), [800, 600]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /800×600 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('every locale has every Graphics string', () => {
  const en = GFX_STRINGS['en-US'];
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    const t = GFX_STRINGS[loc];
    assert.ok(t, loc);
    for (const k of Object.keys(en)) assert.ok(t[k], `${loc}.${k}`);
    for (const p of PRESETS) assert.ok(t.presets[p], `${loc}.presets.${p}`);
    for (const [c, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(t.cats[c], `${loc}.cats.${c}`);
      for (const tier of tiers) assert.ok(t.tiers[tier], `${loc}.tiers.${tier}`);
    }
    for (const k of Object.keys(en.sum)) assert.ok(t.sum[k], `${loc}.sum.${k}`);
  }
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
