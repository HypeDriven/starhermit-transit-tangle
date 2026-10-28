// save.js — Transit Tangle's save model for the engine client (pure: no
// storage, no platform), shared by native/platform.ts and the node tests.
//
// The engine save (starhermit:storage `saves`, schema 1, on the device and in
// the player's cloud slot) is the store document the browser build kept in
// localStorage (transit-tangle-v1) and mirrored to the cloud slot
// game:<slug> through the JS SDK's saveJSON:
//   { v: 1, progress: { journeyDone, journeyUnlocked, tutorialDone,
//     daysPlayed, wins, streak, best }, achievements: [keys] }
// The old doc's `settings` are not kept here: volumes, graphics, reduced
// motion, high contrast and larger text are the runtime's Options; the
// palette, left-handed controls and text cues for sounds are engine
// settings (OPTION_KEYS). Two saves merge as the browser build merged them
// (platform.js mergeProgress: best of both devices; achievements united).

const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const int = (v) => (Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : 0);
const ints = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => Number.isInteger(x) && x >= 0))] : []);

export function defaultSave() {
  return {
    v: 1,
    progress: { journeyDone: [], journeyUnlocked: 0, tutorialDone: false, daysPlayed: [], wins: 0, streak: 0, best: {} },
    achievements: [],
  };
}

/** A save document from anything (the old store doc included; missing or broken fields from the default). */
export function normalize(raw) {
  const d = obj(raw), p = obj(d.progress), out = defaultSave();
  out.progress.journeyDone = ints(p.journeyDone).filter((x) => x < 40).sort((a, b) => a - b);
  out.progress.journeyUnlocked = Math.min(39, int(p.journeyUnlocked));
  out.progress.tutorialDone = p.tutorialDone === true;
  out.progress.daysPlayed = ints(p.daysPlayed).sort((a, b) => a - b);
  out.progress.wins = int(p.wins);
  out.progress.streak = int(p.streak);
  for (const [k, v] of Object.entries(obj(p.best))) if (Number.isFinite(v)) out.progress.best[k] = v;
  out.achievements = Array.isArray(d.achievements) ? [...new Set(d.achievements.filter((k) => typeof k === 'string'))] : [];
  return out;
}

/** platform.js mergeProgress + the achievements union (a: this device). */
export function mergeSaves(a, b) {
  const A = normalize(a), B = normalize(b);
  const best = { ...B.progress.best };
  for (const [k, v] of Object.entries(A.progress.best)) if (best[k] == null || v > best[k]) best[k] = v;
  const union = (x, y) => [...new Set([...x, ...y])].sort((m, n) => m - n);
  return normalize({
    v: 1,
    progress: {
      journeyDone: union(A.progress.journeyDone, B.progress.journeyDone),
      journeyUnlocked: Math.max(A.progress.journeyUnlocked, B.progress.journeyUnlocked),
      tutorialDone: A.progress.tutorialDone || B.progress.tutorialDone,
      daysPlayed: union(A.progress.daysPlayed, B.progress.daysPlayed),
      wins: Math.max(A.progress.wins, B.progress.wins),
      streak: Math.max(A.progress.streak, B.progress.streak),
      best,
    },
    achievements: A.achievements.concat(B.achievements.filter((k) => !A.achievements.includes(k))),
  });
}

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
/** Same content, whatever the key order. */
export function sameSave(a, b) { return canonical(normalize(a)) === canonical(normalize(b)); }

/** The browser build's cloud slot text (the store doc as JSON), or null when it is not one. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || !doc.progress || typeof doc.progress !== 'object') return null;
    return normalize(doc);
  } catch { return null; }
}

/** The old doc's settings block (also the old settings KV) → the game's options. */
export const DEFAULT_OPTIONS = { palette: 'default', leftHand: false, captions: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
export const PALETTES = ['default', 'cvd', 'contrast'];
/** platform.js PREF_KEYS: the browser build's settings KV keys (all removed after the import). */
export const BROWSER_KEYS = ['music', 'fx', 'ambience', 'palette', 'quality', 'reducedMotion', 'highContrast',
  'largeText', 'leftHand', 'captions', 'haptics', 'gfx'];

export function pickOptions(raw) {
  const r = obj(raw), out = {};
  if (PALETTES.includes(r.palette)) out.palette = r.palette;
  if (typeof r.leftHand === 'boolean') out.leftHand = r.leftHand;
  if (typeof r.captions === 'boolean') out.captions = r.captions;
  return out;
}
/** The old cloud doc's settings block (when the foreign save is read). */
export function foreignOptions(text) {
  try { return pickOptions(obj(JSON.parse(text)).settings); } catch { return {}; }
}
