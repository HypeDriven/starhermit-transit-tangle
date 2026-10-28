// Localization: the browser build's tables (strings.js, keyed, the nine
// StarHermit locales; the account strings in sh-i18n.js) in the interface
// language the runtime reports (preferences().language: Options › Language,
// else the account's or the device's). The runtime's Options replace
// sh-language.js; every string is drawn through T() each frame, so a change
// shows on the next frame.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { STRINGS } from "../strings.js";
import { shLocale, shText } from "../sh-i18n.js";

type Table = Record<string, string>;
const TABLES = STRINGS as unknown as Record<string, Table>;
let locale = "en-US";
let dict: Table = TABLES["en-US"]!;
function apply(tag: string): void {
  const next = shLocale(String(tag || "en-US")) as string;
  const pick = TABLES[next] ? next : "en-US";
  if (pick === locale && dict) return;
  locale = pick;
  dict = TABLES[pick]!;
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export type Vars = Record<string, string | number>;
export function locale_(): string { return locale; }
/** A string key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const s = dict[key] ?? TABLES["en-US"]![key] ?? key;
  return vars ? String(s).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : s;
}
/** The account strings (signIn, invite, copied, copyFail, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string { return shText(key, vars ?? {}, locale) as string; }
