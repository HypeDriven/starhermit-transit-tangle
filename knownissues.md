# Transit Tangle — Known Issues

## Resolved

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
| `node tests/e2e.mjs` (desktop + mobile) | E2E PASS — no page errors |
