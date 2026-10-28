// Every key the engine client shows (T("…") in native/*.ts, the
// composed mode/difficulty/colour keys) exists in all nine locales with the
// same placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRINGS } from '../strings.js';

const keys = new Set();
for (const f of readdirSync(new URL('../native/', import.meta.url)).filter((n) => n.endsWith('.ts'))) {
  const src = readFileSync(new URL(`../native/${f}`, import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bT\("([A-Za-z0-9]+)"/g)) keys.add(m[1]);
  for (const m of src.matchAll(/"((?:color|lesson|ach|rsn|end|pal|help)[A-Z0-9][A-Za-z0-9]*)"/g)) keys.add(m[1]);
}
for (const m of ['Journey', 'Daily', 'Practice', 'Challenge', 'Learn']) keys.add(`mode${m}`);
for (const d of ['Easy', 'Normal', 'Hard', 'Expert']) keys.add(`diff${d}`);
for (const k of ['helpMatch', 'helpHolding', 'helpLimited', 'helpScoring']) keys.add(`${k}Text`);
for (const k of ['journey', 'challenge', 'signedInBest', 'localRecords']) keys.add(k);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every client key is translated in all nine locales', () => {
  assert.equal(Object.keys(STRINGS).length, 9);
  assert.ok(keys.size > 120, `found ${keys.size}`);
  const bad = [];
  for (const k of keys) for (const [l, t] of Object.entries(STRINGS)) {
    if (typeof t[k] !== 'string' || !t[k]) bad.push(`${l}: ${k}`);
    else if (holes(t[k]) !== holes(STRINGS['en-US'][k])) bad.push(`${l}: placeholders in ${k}`);
  }
  assert.deepEqual(bad, []);
});
