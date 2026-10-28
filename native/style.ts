// The look of the HUD, rails, tray, coach, toasts and screens: the browser
// build's style.css rewritten class-based in tools/ui-style.css and
// converted with `starhermit css` into assets/ui-style.json (`npm run css`).
// The runtime's high contrast option is the old body.high-contrast tokens.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#eef3f8", panel: "#ffffff", ink: "#243b53", "ink-soft": "#4a6b8a", accent: "#3b82f6", "accent-ink": "#ffffff",
  danger: "#d64545", ok: "#2f9e63", warn: "#c77d0a", line: "#d7e3ee", focus: "#ff8c00", bar: "#ffffffeb", rail: "#ffffffe0",
};
/** body.high-contrast. */
const CONTRAST: Tokens = { bg: "#ffffff", panel: "#ffffff", ink: "#000000", "ink-soft": "#111111", accent: "#0033aa", line: "#000000", focus: "#000000", bar: "#ffffff", rail: "#ffffff" };

let current: Tokens = { ...BASE };
let css: ui.CssStyles | null = null;
let key = "";
export function initStyles(): void {
  css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  key = "";
  applyTokens(false);
}
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key || !css) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens({ ...css.tokens, ...current });
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$line", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$ink" }, radius: 6, padding: 6 },
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#14233773" } } },
    ".dlg": { background: "#00000000", padding: 0, parts: { backdrop: { background: "#14233773" } } },
  });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24, padding: 8, spacing: 8, radius: 12,
    text: current.ink!, muted: current["ink-soft"]!, panel: current.panel!, control: current.panel!, hovered: "#f4f8fc",
    pressed: "#e6eef6", field: current.panel!, accent: current.accent!, focus: current.focus!, outline: current.line!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
