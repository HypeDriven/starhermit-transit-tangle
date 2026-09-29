// Unit tests for the pure graphics quality model (node --test tests/gfx.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, choosePreset, presetTier, describe, CATEGORIES, PRESETS } from '../gfx.js';
import { GFX_STRINGS, pickLocale } from '../gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 640'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('touch devices cap Auto at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
