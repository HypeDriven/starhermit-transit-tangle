// The hint search (rules.js hint) off the game's thread (starhermit:script
// worker, a module). The rules are the browser build's rules.js unchanged.
// Message in: { id, state }   Message out: { id, hint } (null: none).
import "../rules.js";

globalThis.onmessage = (e) => {
  const d = e.data;
  let hint = null;
  try { hint = globalThis.TTRules.hint(d.state); } catch (err) { hint = null; }
  postMessage({ id: d.id, hint: hint ? { v: hint.v, q: hint.q } : null });
};
