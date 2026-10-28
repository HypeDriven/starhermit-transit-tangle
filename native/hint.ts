// The hint (rules.js hint: a best-first search of up to 60,000 dispatches)
// on a worker (native/hint-worker.js): natively it takes longer than a frame
// may run, so the plaza keeps drawing meanwhile. Without a worker (it failed
// to start) the search runs on the game's thread as the browser build's did.
import { worker, type Worker } from "starhermit:script";
import { R, type Hint, type State } from "./game.ts";

let w: Worker | null = null;
let failed = false;
let nextId = 1;
let current: { id: number; done: (h: Hint | null) => void; state: State } | null = null;

function sync(state: State, done: (h: Hint | null) => void): void {
  let h: Hint | null = null;
  try { h = R.hint(state); } catch { h = null; }
  done(h);
}
function ensure(): Worker | null {
  if (w || failed) return w;
  try {
    w = worker("native/hint-worker.js", { type: "module" });
    w.on("message", (m) => {
      const r = m as unknown as { id: number; hint: Hint | null };
      if (!current || current.id !== r.id) return;
      const job = current; current = null;
      job.done(r.hint);
    });
    w.on("error", (msg) => { if (!/not responding/i.test(msg)) console.warn(`hint worker: ${msg}`); });
    w.on("stopped", () => {
      failed = true; w = null;
      if (current) { const job = current; current = null; sync(job.state, job.done); }
    });
  } catch (e) { console.warn(`hint worker: ${String(e)}`); failed = true; w = null; }
  return w;
}
export function warm(): void { ensure(); }
export function cancel(): void { current = null; }
/** Asks for a hint for `state`; `done` hears it (null: none). */
export function request(state: State, done: (h: Hint | null) => void): void {
  const wk = ensure();
  if (!wk) { sync(state, done); return; }
  const id = nextId++;
  current = { id, done, state };
  try { wk.post({ id, state: JSON.parse(JSON.stringify(state)) }); }
  catch (e) { current = null; console.warn(`hint worker: ${String(e)}`); sync(state, done); }
}
