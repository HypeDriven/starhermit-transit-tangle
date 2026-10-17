// i18n.test.mjs — every string key used in index.html and app.js exists in
// all nine locales, with the same {placeholders} as US English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../strings.js';

const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) used.add(m[1]);
for (const m of code.matchAll(/\bT\('([A-Za-z0-9]+)'(?!\s*\+)/g)) used.add(m[1]);
// Keys passed through tables and helpers.
for (const m of code.matchAll(/'((?:color|rsn|ach|sync|lesson|end|mode)[A-Z0-9][A-Za-z0-9]*)'/g)) used.add(m[1]);
for (const k of ['helpMatch', 'helpHolding', 'helpLimited', 'helpScoring', 'signedInBest', 'localRecords', 'nextStage', 'nextLesson', 'playAgain',
  'hintMatch', 'hintMismatch', 'boardedOne', 'boardedMany', 'nothingToUndo', 'undoRanked', 'rankedTag', 'unrankedTag', 'allAway', 'roundLost']) used.add(k);
for (const k of ['helpMatch', 'helpHolding', 'helpLimited', 'helpScoring']) used.add(k + 'Text');
for (const m of ['Journey', 'Daily', 'Practice', 'Challenge', 'Learn']) used.add('mode' + m);
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('ships the nine locales', () => assert.deepEqual(Object.keys(STRINGS).sort(), [...LOCALES].sort()));
test('found the keys in markup and code', () => assert.ok(used.size > 170, String(used.size)));
for (const loc of LOCALES) {
  test(`${loc}: every used key, matching placeholders`, () => {
    assert.deepEqual([...used].filter((k) => typeof STRINGS[loc][k] !== 'string'), []);
    for (const k of used) assert.equal(vars(STRINGS[loc][k]), vars(STRINGS['en-US'][k]), `${loc}.${k}`);
  });
}
test('non-English locales are translated', () => {
  for (const loc of LOCALES.filter((l) => !l.startsWith('en'))) {
    const same = [...used].filter((k) => STRINGS[loc][k] === STRINGS['en-US'][k]);
    assert.ok(same.length < 14, `${loc}: ${same.join(', ')}`); // cognates such as Mode, Pause, Total, Par
  }
});
