// The save model (save.js): normalize, the two-device merge, the browser
// build's cloud slot as a foreign save, the old settings as game options.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../save.js';

const oldDoc = {
  v: 1, savedAt: 1, settings: { music: 30, palette: 'cvd', leftHand: true, captions: false, quality: 'high', gfx: {} },
  progress: { journeyDone: [0, 1, 2], journeyUnlocked: 3, tutorialDone: true, daysPlayed: [20261001], wins: 4, streak: 2, best: { journey: 300 } },
  achievements: ['first_completion'],
};

test('normalize keeps progress and achievements, drops junk', () => {
  const n = S.normalize({ ...oldDoc, progress: { ...oldDoc.progress, journeyDone: [1, 'x', 1, 99], journeyUnlocked: 80, wins: -3 } });
  assert.deepEqual(n.progress.journeyDone, [1]);
  assert.equal(n.progress.journeyUnlocked, 39);
  assert.equal(n.progress.wins, 0);
  assert.deepEqual(S.normalize(null), S.defaultSave());
});

test('merge keeps the best of both devices', () => {
  const a = S.normalize(oldDoc);
  const b = S.normalize({ progress: { journeyDone: [5], journeyUnlocked: 6, wins: 1, streak: 5, daysPlayed: [20261002], best: { journey: 100, daily: 50 } }, achievements: ['streak_3'] });
  const m = S.mergeSaves(a, b);
  assert.deepEqual(m.progress.journeyDone, [0, 1, 2, 5]);
  assert.equal(m.progress.journeyUnlocked, 6);
  assert.equal(m.progress.tutorialDone, true);
  assert.equal(m.progress.wins, 4);
  assert.equal(m.progress.streak, 5);
  assert.deepEqual(m.progress.best, { journey: 300, daily: 50 });
  assert.deepEqual(m.achievements, ['first_completion', 'streak_3']);
  assert.ok(S.sameSave(m, JSON.parse(JSON.stringify(m))));
});

test('the old cloud slot reads as a foreign save with its options', () => {
  const text = JSON.stringify(oldDoc);
  assert.equal(S.readForeign(text).progress.journeyUnlocked, 3);
  assert.equal(S.readForeign('nope'), null);
  assert.deepEqual(S.foreignOptions(text), { palette: 'cvd', leftHand: true, captions: false });
  assert.deepEqual(S.pickOptions({ palette: 'bad', leftHand: 1 }), {});
});
