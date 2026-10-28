# Transit Tangle — Product and Game Specification

**Document status:** running specification; the game is a StarHermit engine 1.21.0 script game (host API 1.23, engine.minor=23) — sections 1–4 and 7 are the design, section 5 onward describes the game as built.  
**Game index:** 15  
**Genre:** Queue planning puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** Three.js-first presentation with a fully usable semantic HTML interface layer

## 1. Product vision

Transit Tangle is a game in which players dispatch vehicles into matching passenger queues without filling the holding lane. Its signature setting is a bright miniature transit plaza. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Dispatch vehicles into matching passenger queues without filling the holding lane.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **select a compatible vehicle, dispatch it, board matching passengers, and manage holding capacity**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Win when all passengers leave; lose when every holding position is blocked. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action. The lesson coach sits above the measured action tray (docked as a right-hand column in short landscape) and can be hidden to a chip; the camera frames the whole board inside the area not covered by HUD, tray or coach. The daily countdown uses the local clock.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The Three.js canvas fills the game region but is never the only UI. Menus, text, forms, chat, settings, and assistive descriptions use semantic HTML over or beside the canvas. Maintain a single shared layout model so DOM labels align with projected Three.js targets.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Landscape mobile:** reserve a narrow status rail; preserve at least 44×44 CSS-pixel targets and 8-pixel separation.
- **Large screens (above 1600×1000 CSS px):** the shared `ui-scale.js` sets `--ui-scale` (viewport ÷ 1600×1000, capped at 2.5) and every fixed DOM layer — HUD, rails, tray, overlay screens, coach, toast, countdown, board-state toggle and frame-rate readout — is zoomed by it; the full-viewport canvas stays unzoomed and the camera fit frames the board between the larger HUD and tray. At 1600×1000 and below the scale is exactly 1.
- The board-state (text) toggle sits bottom-left under the left rail on wide layouts and under the HUD on portrait screens, never behind other chrome. Opening an overlay screen keeps its heading in view (focus does not scroll a tall panel).
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; DOM equivalents for canvas controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

### Localization and language

- Every player-facing string — HUD, rails, tray, title, setup cards, journey grid, pause, results with score rows, help and controls (with the effective keys), settings, scores, coach lessons, hints, sound captions, invalid-action messages, screen-reader announcements and board mirror, the daily countdown and the platform sync and leaderboard lines — ships in nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT. Strings live in `strings.js`; `i18n.js` (an ES module exposed as `window.TTI18n`, imported before `app.js`) exposes `t()`, applies `data-i18n` / `data-i18n-aria` markup and sets `<html lang>`. Graphics strings (`gfx-i18n.js`) and platform strings (`sh-i18n.js`) follow the same locale. Numbers stay digits.
- Settings (title and pause menu) → **Language → Game language** (the shared `game-options.js` panel, mounted in the Graphics section next to Sound and Report a problem) offers **Automatic — <resolved language>** plus the nine locales by native name, with a status line (Saved to account / Saved on this device / Account sync unavailable). A change applies immediately: markup is re-applied and the HUD, rails, mirror, title line, setup card, help, journey grid, results, scores, coach and the Graphics controls re-render in place; the round keeps running.
- Resolution (`sh-language.js`, loaded after `starhermit-sdk.js`): explicit game choice → for Automatic, the StarHermit account's `preferredLanguage` (`GET /api/v1/me/language`, signed in only) → `navigator.languages` → en-US, mapping tags to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`). The choice (`auto` or a locale) is stored per player in `localStorage['transit-tangle.language.<user|guest>']` and, signed in, in the per-player settings key `ui.language` as `{ choice }`; a failed settings read never overwrites it and the game never writes the platform preference. The game's settings KV mirror only reads and writes its own preference keys, never `ui.*`.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a bright miniature transit plaza. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Graphics

**Graphics.** The plaza is lit by a warm key sun whose PCF shadow box is refitted to the board after every rebuild, a cool-sky/warm-ground hemisphere fill and, when reflections are on, a prefiltered studio environment (`RoomEnvironment` through `PMREMGenerator`) as image-based light; output is ACES filmic tone-mapped sRGB and the background is set through `scene.background`. At the detailed tier passengers and vehicles use a lacquered-toy PBR finish (clearcoat), vehicles gain rounded bodies, a dark glass window band, wheels and glowing headlamps, platforms get bevelled edges and a yellow boarding-edge stripe, the holding lane a painted boarding line, the ground a deterministic procedural paving texture, and low bollard lights ring the plaza. Optional post-processing (three's EffectComposer, same r170 revision as the core): GTAO contact darkening, bloom limited to HDR accents (threshold above lit surfaces, so only lamps, headlamps, sparks and boosted selection/target markers glow), a colour grade (gentle S-curve, slight saturation, warm highlights/cool shadows) with vignette, and FXAA/SMAA or MSAA. Boarding bursts are soft sprite sparks in the vehicle's colour. Ambient motion (passengers breathe, the selected vehicle lifts and its ring pulses, bollard lights shimmer) stops under the game's reduced-motion setting or `prefers-reduced-motion`. The Settings panel's **Graphics** section offers Quality (Auto, chosen from the StarHermit hardware level below; Low; Balanced; High; Ultra), a render scale (50–200% of the preset's), a per-category override select ("From preset (…)" by default) for shadows (off/1024/2048/4096), ambient occlusion (off/on/high), bloom, colour grade, anti-aliasing (off/FXAA/SMAA/MSAA), reflections, scene detail (plain/detailed), particles (low/high) and ambient motion (static/animated), adaptive resolution (averages 90 frames; steps down by 0.1 to 60% above 26 ms, back up by 0.05 below 14 ms) and a frame-rate readout (bottom right above the tray), plus a summary line "GPU · Level N · cost summary · W×H px" ("Level" localized). Choosing a preset clears overrides. Changes apply immediately without reload and persist in the game's settings store (`quality` holds the preset, `gfx` the overrides). Pixel ratio is min(devicePixelRatio, preset cap: Low 1, Balanced 1.5, High/Ultra 2) × render scale × adaptive scale. Low is the no-post baseline (no shadows, no reflections, plain geometry, canvas MSAA) and costs no more than the original scene. If the post chain cannot be built the game renders directly and the panel says so. Graphics strings are localized in the nine locales and follow the game language. The body and canvas carry `data-gfx-preset`; controls use ids `set-quality`, `gfx-scale`, `gfx-<category>` (with `data-gfx-cat`), `gfx-adaptive`, `gfx-fps` and `gfx-summary`.

**Hardware-level detection.** `gpu-level.js` (shared StarHermit copy, `window.StarHermitGpu`, a classic script loaded before the game modules, never edited here) rates the WebGL unmasked renderer plus device facts (`detectSystem()`: phone/tablet, cores, memory, screen) on the StarHermit hardware level 0–20 (0 = Galaxy S20 / Intel UHD or weaker and every software renderer; 20 = RTX 5090; each level ≈ 1.23×; laptop parts two levels below desktop; phones, tablets and ≤ 4 GB machines capped at 9). `gfx.js` maps it with `presetForLevel(level, { low: 0, balanced: 4, high: 10, ultra: 17 })`, so Auto picks Ultra on strong GPUs; adaptive resolution still steps down when slow. Headless SwiftShader is level 0 → Low. Phones and tablets pace Auto FPS at half the display refresh rate ("Auto (half refresh rate)") and start at 16 simultaneous sounds (shared `game-options.js`).

**Per-preset budgets** (`BUDGETS` / `budgetFor` in `gfx.js`, applied in `app.js` through `litMaterial` / `seg` and the paving size). Each preset holds 60 FPS on the weakest GPU Auto gives it — Low at level 0, Balanced 4, High 10, Ultra 17. The plaza layout, lanes, vehicles, passengers, picking and rules are identical on every preset; only visuals change. A budget change drops the geometry/material caches and rebuilds the scene. Spark counts are tuned at the floor level and scale up within the preset on faster GPUs (`StarHermitGpu.scaleBudget`, ≤ 2×, at most 72 per burst).

| Preset (floor level) | Pixel ratio cap / scale | Shadows | Post | Materials | Tessellation | Rounded-box segments | Paving texture | Sparks per boarding |
|---|---|---|---|---|---|---|---|---|
| Low (0) | 1 / 1 | off | none (canvas MSAA) | Lambert | ½ of authored | — (plain boxes) | — (plain) | 6 (Particles low) |
| Balanced (4) | 1.5 / 1 | 1024² | half-res bloom, grade, FXAA, reflections | Standard (no clearcoat) | ¾ | 2 | 256 px | 18 |
| High (10) | 2 / 1 | 2048² | half-res GTAO + bloom, grade, SMAA, reflections | Physical (clear-coated toy finish) | authored | 3 | 256 px | 24 |
| Ultra (17) | 2 / 1.25 | 4096² | full-res GTAO (16 samples) + bloom, grade, MSAA, reflections | Physical | 1.5× | 4 | 512 px | 36 |

**Benchmark** (`node tools/gfx-bench.mjs transit-tangle`; hook `tests/gfx-bench.mjs` picks the preset in Settings → Graphics, starts Practice on Expert and keeps dispatching by tapping the hinted vehicle and its queue platform on the 3D board, going again with Retry). Measured 2026-10-18 (GPU ms above the draws-skipped floor, projected to the preset's floor level; CPU p90 on the RTX 5090 run):

Desktop 1920×1080:

```
PASS low       GPU p50 8.75 / p90 11.76 ms (same page, draws skipped: 8.99 / 11.64) on level 2 → at level 0: typical 0.00 (≤ 12), slow 0.18 (≤ 14)  CPU p90 0.40 ms (≤ 6)  frames 458/463
PASS balanced  GPU p50 14.28 / p90 16.85 ms (same page, draws skipped: 7.38 / 11.53) on level 2 → at level 4: typical 4.56 (≤ 12), slow 3.52 (≤ 14)  CPU p90 0.80 ms (≤ 6)  frames 351/451
PASS high      GPU p50 17.64 / p90 21.17 ms (same page, draws skipped: 8.11 / 11.72) on level 2 → at level 10: typical 1.82 (≤ 12), slow 1.80 (≤ 14)  CPU p90 1.20 ms (≤ 6)  frames 303/443
PASS ultra     GPU p50 75.24 / p90 185.27 ms (same page, draws skipped: 15.41 / 16.75) on level 2 → at level 17: typical 2.68 (≤ 12), slow 7.55 (≤ 14)  CPU p90 1.20 ms (≤ 6)  frames 74/448
```

Phone 390×844 at DPR 3 (`--mobile --presets low,balanced`):

```
PASS low       GPU p50 13.96 / p90 16.46 ms (same page, draws skipped: 13.93 / 16.58) on level 2 → at level 0: typical 0.05 (≤ 12), slow 0.00 (≤ 14)  CPU p90 0.50 ms (≤ 6)  frames 410/418
PASS balanced  GPU p50 13.85 / p90 16.61 ms (same page, draws skipped: 14.12 / 16.66) on level 2 → at level 4: typical 0.00 (≤ 12), slow 0.00 (≤ 14)  CPU p90 0.80 ms (≤ 6)  frames 410/422
```

Files: `gpu-level.js` (shared StarHermit hardware-level module), `gfx.js` (pure quality model: presets, categories, hardware-level `detectLevel` / `presetForLevel` / `detectPreset`, per-preset `BUDGETS` / `budgetFor`, `resolve`, `choosePreset`, `presetTier`, `describe`), `gfx-i18n.js` (Graphics panel strings), `gfx-render.js` (post chain, grade shader, environment, procedural textures), `vendor/three/addons/` (r170 addons: postprocessing, shaders, RoomEnvironment, RoundedBoxGeometry; the importmap maps `three` to `three.min.js` and `three/addons/` here), `tests/gfx.test.mjs` (unit tests, part of `npm test`); `tests/e2e.mjs` drives the Graphics section on desktop and mobile.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. On the StarHermit engine

### Files
- `starhermit.txt`: launch=index.html (the loader `npm run package` writes), engine.entry=native/main.ts, engine.version=1.21.0, engine.minor=23, capabilities platform, storage, clipboard; server=score-script.js (unchanged).
- `rules.js` (unchanged rules, UMD on globalThis), `save.js` (save model), `strings.js` + `sh-i18n.js` (nine locales), `native/*.ts` (the client), `native/hint-worker.js`, `assets/ui-style.json` (from `tools/ui-style.css` via `npm run css`), `sfx/*.opus`.
- `server.js` is the dev/test server (replay validation, its own boards); it is not shipped (.starhermitignore).

### Screens and flow
Title (Play, Daily Challenge, Journey, Practice, Challenge, Learn, Scores, Help, Settings, Sign in, Invite; daily-seed countdown, journey progress, account and sync line) → Setup (Practice: Easy/Normal/Hard/Expert; Challenge: Start) or the Journey grid (40 stages, done/current/locked) → a 3-2-1 countdown (skipped with reduced motion) → the round ⇄ Pause (Resume, Restart round, Settings, Help, Leave round) → Results (breakdown, stage/assist note, achievements, ranked note, leaderboard rank; Next stage / Next lesson / Play again, Retry, Menu). Help and Settings return to the screen they were opened from. Every screen is reachable from the title or the round.

In a round: the HUD (mode, objective, score, moves and the move limit, holding against capacity — red when nearly full — and passengers left), wide windows (≥ 1024 logical px) show the rails (objective, progress, par; round id and seed, Hint/Undo, Reset camera; sides swapped by Left-handed controls), the "Board state (text)" mirror (bottom-left; under the HUD on portrait windows), the tray (Pause, Undo, Hint, Help, Settings), the Learn coach (above the tray; docked right in short landscape; Hide / Show lesson) and toasts. HUD and tray rows wrap within the window width.

### Controls
- Pointer/touch: tap a vehicle (again to deselect), then a queue. Taps that land on UI (`ui.pointerCaptured()`) never reach the plaza.
- Keys (rebindable in the runtime's Options): ←/↑ previous, →/↓ next target, Enter/Space select or dispatch, Esc cancel selection / pause / resume / back, U undo, H hint, R reset camera, P pause. A focus ring marks the keyboard target.
- Gamepad: D-pad/left stick targets, South confirm, East cancel, Start pause, West undo, North hint, right stick press camera.
- Every vehicle and queue is a named target (screen readers, play scripts): "Vehicle N: colour, K left", "Queue N: …".

### Settings
The runtime's Options own volumes, graphics quality and frame rate, language, larger text, high contrast, reduced motion and vibration. The game's Settings keep the colour palette (default, colour-vision safe, high contrast), left-handed controls, text cues for sounds (on by default), Replay tutorial, and buttons to the Options and key bindings.

### Graphics
Quality tiers follow gfx.js's presets and budgets (native/quality.ts): Low (Lambert, no shadows/post, MSAA), Balanced (Standard, 1024 shadows, bloom, grade, FXAA, reflections, detailed meshes and paving), High (Physical clear-coat, 2048 shadows, GTAO, SMAA), Ultra (4096 shadows, full GTAO, MSAA, 1.5× segments, 512 px paving). At minor 23 the page's r170 values apply unchanged: sun 2.4 / hemisphere 1.1 (2.15 / 0.7 with reflections), the fitted shadow box with bias −0.0004 / normal bias 0.02, RoomEnvironment as scene.environment at 0.32, ACES at 1.0, bloom 0.5/0.35/1.15, the display-space grade and vignette. Sparks scale with the hardware level within the tier.

### Sound
The authored clips per event (random variant), the 110 Hz ambience (carrier 110.5 Hz so the rendered loop closes) and the seeded music plucks while a round is active, rendered to clips; ambience plays on the music bus.

### Saves and platform
The engine save (schema 1) holds progress and achievements; devices merge best-of-both. The browser build's cloud slot (game:<slug>) is merged as a foreign save once, adopting its palette/left-handed/sound-cue settings; the old settings KV is adopted then removed. Ranked rounds (Journey, Daily, Challenge) post their total through score-script.js (range-checked) when signed in and show the rank; guests keep device bests. The Daily and Challenge seeds use the platform clock (device UTC date offline). Achievements live in the save, as before.

### Checks
`npm test`: rules tests (test.js), save, i18n and dev-server tests, then tests/native.mjs — web index up to date, tsc, `starhermit check` with zero warnings, and play scripts generated by tools/gen-plays.mjs: Learn's three lessons by finger on a DPR-3 phone, Journey stages 1–2 by keys on desktop, the menus in short landscape (help, settings, scores, Practice with hint/dispatch/undo, pause/restart/leave, Challenge, Daily). `npm run test:browser` plays the package in GPU Chrome at desktop, phone and landscape (DPR 3).

### Known limitations and differences
- The hint searches up to 60,000 dispatches on a worker: natively it can take a second or more (the browser build answered in ~0.1 s).
- The hint no longer shows the "select" sound cue (in the browser build that cue replaced the hint's toast at once).
- Not ported: the per-category graphics overrides, the FPS readout (runtime), haptics toggle (runtime vibration setting), the local anonymous usage counter, the synthesized stand-in sounds while clips load.
- Guests' old browser localStorage progress does not migrate; cloud saves do.
- The camera re-frames when a new round starts (the browser build re-framed on window and chrome changes only).
