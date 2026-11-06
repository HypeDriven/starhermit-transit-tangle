// Localization: assets/strings.json (generated from the browser build's tables,
// keyed, the nine StarHermit locales) on the engine's strings, which follow the
// interface language the runtime reports (Options › Language, else the
// account's or the device's) and own the locale fallback and the account
// strings (`starhermit.*`). The runtime's Options replace sh-language.js; every
// string is drawn through T() each frame, so a change shows on the next frame.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** A string key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(key, vars ?? undefined); }
/** The engine's account strings (signIn, invite, inviteCopied, inviteLink, signedOut, leaderboard…). */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
