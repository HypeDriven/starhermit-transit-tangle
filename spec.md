# Transit Tangle — Product and Game Specification

**Document status:** design specification only; no implementation is included.  
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

**Graphics.** The plaza is lit by a warm key sun whose PCF shadow box is refitted to the board after every rebuild, a cool-sky/warm-ground hemisphere fill and, when reflections are on, a prefiltered studio environment (`RoomEnvironment` through `PMREMGenerator`) as image-based light; output is ACES filmic tone-mapped sRGB and the background is set through `scene.background`. At the detailed tier passengers and vehicles use a lacquered-toy PBR finish (clearcoat), vehicles gain rounded bodies, a dark glass window band, wheels and glowing headlamps, platforms get bevelled edges and a yellow boarding-edge stripe, the holding lane a painted boarding line, the ground a deterministic procedural paving texture, and low bollard lights ring the plaza. Optional post-processing (three's EffectComposer, same r170 revision as the core): GTAO contact darkening, bloom limited to HDR accents (threshold above lit surfaces, so only lamps, headlamps, sparks and boosted selection/target markers glow), a colour grade (gentle S-curve, slight saturation, warm highlights/cool shadows) with vignette, and FXAA/SMAA or MSAA. Boarding bursts are soft sprite sparks in the vehicle's colour. Ambient motion (passengers breathe, the selected vehicle lifts and its ring pulses, bollard lights shimmer) stops under the game's reduced-motion setting or `prefers-reduced-motion`. The Settings panel's **Graphics** section offers Quality (Auto, chosen from the WebGL unmasked renderer: software renderers get Low, discrete GPUs and Apple M get High, others Balanced, touch devices capped at Balanced; Low; Balanced; High; Ultra), a render scale (50–200% of the preset's), a per-category override select ("From preset (…)" by default) for shadows (off/1024/2048/4096), ambient occlusion (off/on/high), bloom, colour grade, anti-aliasing (off/FXAA/SMAA/MSAA), reflections, scene detail (plain/detailed), particles (low/high) and ambient motion (static/animated), adaptive resolution (averages 90 frames; steps down by 0.1 to 60% above 26 ms, back up by 0.05 below 14 ms) and a frame-rate readout (bottom right above the tray), plus a summary line "GPU · cost summary · W×H px". Choosing a preset clears overrides. Changes apply immediately without reload and persist in the game's settings store (`quality` holds the preset, `gfx` the overrides). Pixel ratio is min(devicePixelRatio, preset cap: Low 1, Balanced 1.5, High/Ultra 2) × render scale × adaptive scale. Low is the no-post baseline (no shadows, no reflections, plain geometry, canvas MSAA) and costs no more than the original scene. If the post chain cannot be built the game renders directly and the panel says so. Graphics strings are localized (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) from the browser language. The body and canvas carry `data-gfx-preset`; controls use ids `set-quality`, `gfx-scale`, `gfx-<category>` (with `data-gfx-cat`), `gfx-adaptive`, `gfx-fps` and `gfx-summary`.

Files: `gfx.js` (pure quality model: presets, categories, `detectPreset`, `resolve`, `choosePreset`, `presetTier`, `describe`), `gfx-i18n.js` (Graphics panel strings), `gfx-render.js` (post chain, grade shader, environment, procedural textures), `vendor/three/addons/` (r170 addons: postprocessing, shaders, RoomEnvironment, RoundedBoxGeometry; the importmap maps `three` to `three.min.js` and `three/addons/` here), `tests/gfx.test.mjs` (unit tests, part of `npm test`); `tests/e2e.mjs` drives the Graphics section on desktop and mobile.

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

## 5. Technical architecture

### Client modules

- `bootstrap`: host handshake, capability detection, asset manifest, lifecycle.
- `rules`: pure deterministic state transitions, legality, scoring, seeded random stream.
- `session`: local or hosted commands, snapshots, prediction policy, reconnect, replay.
- `render`: Three.js scene graph, semantic entity views, camera, lighting, VFX, quality.
- `ui`: responsive DOM shell, focus, localization, settings, overlays, accessibility mirror.
- `audio`: buses, event mapping, focus/background behavior, decode and memory policy.
- `content`: versioned levels, themes, tutorials, validation metadata.
- `platform`: token-aware REST/WebSocket adapter, retries, rate-limit handling, telemetry consent.

No module may mutate rules state except through a validated command. Rendering consumes immutable snapshots plus interpolation data. UI state and simulation state are separate so closing a drawer cannot affect a match.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- Ships `starhermit.txt` (`name=Transit Tangle`, `launch=index.html`, `control.*` key declarations) and a copy of the canonical `starhermit-sdk.js`, loaded by `index.html` before `platform.js` and the app. `platform.js` (`TTPlatform`, shared with Node tests) is a thin adapter over `window.StarHermit`: `init()` calls `StarHermit.init()`, which reads `#game_token=` (library launch) or `#access_token=` (direct sign-in return), strips it, takes the slug from the `game_scope` claim and renews the token on the SDK's schedule. Tokens are never persisted.
- On `*.starhermit.com` without a token the title shows a localized "Sign in with StarHermit" button (`StarHermit.signIn()`), hidden when signed in and off-platform. If renewal is refused the SDK signs out: a localized toast says progress stays on this device, the sign-in button returns and play continues locally.
- Without a token the game makes no request to any `/api/…` or `/ws` route, on any host including localhost. The daily countdown uses the local clock (labeled); the client never calls this repo's own `server.js` routes. Standalone, Scores shows the device's personal best per board.

### Identity, profile, presence, and preferences
- Guests play locally. Signed in, the title account line shows the profile nickname (`StarHermit.profile()`, fallback "Player <id>") and the cloud-sync state. No presence calls.
- Preferences (volumes, palette, quality/graphics, reduced motion, high contrast, large text, left-handed, captions, haptics) are mirrored to the platform settings KV with a debounced `patchSettings` of changed keys; at start they are applied on top of the cloud save (platform values win). Analytics consent stays per device.
- Keyboard actions are declared as `control.*` lines (`KeyboardEvent.code`); at start `StarHermit.loadBindings()` applies the player's platform overrides, keydown (and the gamepad's synthesized key events) is routed by `event.code`, and the Help screen's controls line shows the effective keys. There is no in-game rebinding UI; touch stays responsive UI.
- Cloud save: the versioned store document (settings, progress, achievements, personal bests) lives in the `game:<slug>` slot via `saveJSON`/`loadJSON`, loaded remote-first at start (field-by-field remote wins; an empty slot is seeded from the local cache), saved debounced and flushed with keepalive on `pagehide`/hidden. localStorage remains the offline cache.
- Signed in, the title shows a localized "Invite a friend" button that copies `StarHermit.inviteLink()` to the clipboard with a confirmation toast.

### Discovery, activity, and social layer
- Launch activity and presence are host-owned; the game starts no activity or telemetry calls itself. Surface entitlement or catalog state only in host-owned chrome; the game itself must remain playable without promotional interruption.
- Provide a compact friends panel for score comparison and invitations where appropriate. Respect presence visibility and do not expose a hidden or private profile through game UI.
- Do not create gameplay chat or voice surfaces for the initial release; they are not relevant to the core solo loop. Friends-only leaderboard filtering and shareable challenge seeds supply the social layer without unnecessary communication permissions.

### Achievements and leaderboards
- Declare a small static achievement set: first completion, mechanic mastery, a sustained streak, a difficult content milestone, and an accessibility-neutral long-term goal. Keys are stable, lowercase identifiers; unlocks are idempotent.
- Hosted clients read the platform leaderboard only (`StarHermit.leaderboard()`, nicknames via `profile()`; clients can never submit scores); personal bests are kept locally and cloud-saved. The client never posts scores or achievements to `server.js`; its replay-validating board (ruleset, content version, seed, assists, duration) remains for tooling/tests only.
- For globally competitive boards, validate score claims through replay re-simulation using replayable input logs and deterministic seeds — this repo's `server.js` implements it, but the client does not call it. If validation is unavailable, label the board casual and apply plausibility/rate checks.

### Sessions and transport
- The initial game is solo; ordinary practice runs locally and offline after initial load. This repo's `server.js` is a local-dev static host (its replay validation and scoreboard routes are not called by the client) — not a platform game script, so hosted achievement state lives in the cloud-saved document.
- A daily session records content version, seed, settings affecting difficulty, an ordered input log, score components, and final checksum. Reconnect from the durable session snapshot rather than trusting cached client state.
- Realtime rooms, peer relay, matchmaking, backfill, and voice are intentionally not used because they add no value to this ruleset.

### Publishing and operations
- Keep the authoritative script inside the distribution and declare it with `server=server.js`. Choose a digest-pinned container only if profiling proves the sandbox unsuitable; no initial design here requires one.
- Define control defaults, achievement metadata, and versioned settings before release. Publish immutable build assets, verify the launch path, maintain migration tests for saves, and expose no secret configuration to the client.
- Capture anonymous funnel events only for start, tutorial step, round end, retry, settings change, and error category. Avoid raw text, precise personal data, and cross-title tracking.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, cloud-save conflict handling, token refresh, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.
