// Transit Tangle — localization runtime (ES module; exposed as window.TTI18n
// for app.js). The language comes from sh-language.js: explicit game choice
// (ui.language) → StarHermit account preferredLanguage → device languages →
// en-US. A change re-applies data-i18n markup and notifies listeners so
// code-built text re-renders in place.
import { STRINGS } from './strings.js';

export const SUPPORTED = Object.keys(STRINGS);
let lang = 'en-US';
let dict = STRINGS[lang];
const listeners = new Set();

export function locale() { return lang; }
export function t(key, vars) {
  const s = (dict && dict[key]) ?? STRINGS['en-US'][key] ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}
/** Re-apply data-i18n (text) and data-i18n-aria (aria-label) markup. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  document.documentElement.lang = lang;
}
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setLocale(next) {
  lang = STRINGS[next] ? next : 'en-US';
  dict = STRINGS[lang];
  if (typeof document !== 'undefined' && document.readyState !== 'loading') applyStatic();
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
}

const SL = typeof window !== 'undefined' ? window.StarHermitLanguage : null;
export const language = SL ? SL.create({ game: 'transit-tangle', supported: SUPPORTED, apply: setLocale }) : null;
if (!language) setLocale('en-US');
if (typeof window !== 'undefined') window.TTI18n = { t, locale, onLanguage, applyStatic, language };
