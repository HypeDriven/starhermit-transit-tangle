# Transit Tangle — Known Issues

## Resolved

### Boarding events treated as a number, not an array (RESOLVED)

- **Where:** `app.js` `commitDispatch()` → `audio.dispatch()`, `announceEvent()`, and `coachAdvance()`.
- **Trigger:** Any dispatch that boards passengers.
- **Previous behaviour:** `TTRules.dispatch` returns `events.boarded` as an *array* of boarded passengers, but the client used it as a count: the screen-reader announcement read "Boarded [object Object] passengers", the `passengers-board` sound effect and boarding caption never played (`array > 0` is false), and the tutorial coach never advanced past step 0 of each lesson.
- **Fix:** Pass/use `ev.boarded.length` in all three places (app.js:623, 737, 759–762).
- **Verified:** new e2e assertion — a matching dispatch at round start must leave "Boarded N passenger(s)" in the live region and no "[object Object]" in live region or sound caption.

### Ranked score submission trusted client-claimed fields (RESOLVED)

- **Where:** `server.js` `POST /api/scores` entry construction.
- **Previous behaviour:** The stored leaderboard entry took `ticks` and `result` from the client-supplied envelope, but the replay hash does not cover either field — a client could claim fewer moves or a different result while passing validation. The `assists` flag was also hardcoded to 0 even though the client tracks undo/hint use.
- **Fix:** The entry now derives `score`, `result`, `ticks`, and `invalid` from the re-simulated verified state (`R.scoreComponents(v.state)`), and the client sends `assists: 1` when undo/hint was used (app.js `endRound`).
- **Verified:** `tests/server.test.mjs` — an envelope claiming `ticks: 1, result: 'lost'` is stored with the real tick count and `won`.

### Leaderboard ordering ignored spec tie-breaks (RESOLVED)

- **Where:** `server.js` `GET /api/scores` sort.
- **Previous behaviour:** Sorted only by score, then ticks. Spec order is: completion, score, fewer invalid actions, lower time, then session id.
- **Fix:** Comparator now implements the full spec order.

### Practice "Restart round" silently rerolled the level (RESOLVED)

- **Where:** `app.js` `startRound('practice')` and the `btn-restart` handler.
- **Previous behaviour:** Restarting (or retrying) a practice round generated a brand-new random seed, unlike every other mode where restart replays the same layout.
- **Fix:** `startRound` accepts an optional seed; restart passes `session.seed`, so practice restart replays the same board.

### Settings/help opened from pause did not return to pause (RESOLVED)

- **Where:** `app.js` help/settings close handlers and the Escape key handler.
- **Previous behaviour:** Closing settings/help with Escape after opening them from the pause screen dropped the player straight into the unpaused game (close buttons duplicated return-path logic).
- **Fix:** Both close buttons and Escape now use the recorded `helpReturn`/`settingsReturn` screen. The left-handed rail swap also moved from boot-only into `applySettings()` so the setting takes effect immediately.

### Missing LICENSE.md and tracked runtime data (RESOLVED)

- Added `LICENSE.md` (PolyForm Noncommercial 1.0.0, per root agents.md).
- Removed the tracked empty `data/db.json` runtime artifact and added `data/` to `.gitignore`; the server recreates it on demand.

### Pointer/touch vehicle selection was broken (RESOLVED)

- **Where:** `app.js` `rebuildBoard()` (vehicle group build), and `pointerPick()` / `handlePick()`.
- **Trigger:** A pointer or touch tap on a vehicle body/cab/pips while a round is active.
- **Previous behaviour:** The picker raycast only the vehicle group's *children* (body/cab/pips), but `userData.vehicleIndex` was set only on the `THREE.Group` itself. A tap on a vehicle therefore returned no hit and `handlePick` was never reached — vehicle selection (and any pointer/touch dispatch) was unusable. Queues (meshes carrying `userData.queueIndex`) could still be picked.
- **Expected:** A tap on a vehicle selects it (and a subsequent tap on a queue dispatches it), matching spec §"responsive within one input" / "Pointer/touch: raycast only against explicit interaction layers".
- **Fix:** In `rebuildBoard()`, propagate `userData.vehicleIndex` to the vehicle's hit-testable children with `grp.traverse(ch => { ch.userData.vehicleIndex = vi; })` (app.js:442), so `pointerPick` (which raycasts the group's children) returns `{ kind: 'vehicle', index }`. `handlePick` then selects/dispatches as before. Keyboard selection path (Left/Right → Enter) is untouched.
- **Verified:** `npm test` → "ALL 162 TESTS PASSED". `node tests/e2e.mjs` → exits 0 with `E2E PASS` — desktop and mobile both report "pointer selects a vehicle and dispatches it", and queue picking still works. A real pointer tap on a vehicle was added as an e2e assertion (desktop `page.mouse.click`, mobile via the same pointer path).

## Test results

| Suite | Result |
| --- | --- |
| `npm test` (node test.js) | ALL 162 TESTS PASSED |
| `npm run test:server` (tests/server.test.mjs) | 6 tests passed |
| `node tests/e2e.mjs` (desktop + mobile) | E2E PASS — no page errors |
