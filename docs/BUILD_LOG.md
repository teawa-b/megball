# MEGABALL — build log

The competition asks for a markdown log of how the prototype was built with AI tools. This
is that log, in order. Everything below was done with Claude Code (Claude Fable 5.1 driving
the session, Claude Opus subagents for parallel modules) plus the OpenAI Codex CLI for image
generation. No hand-authored art, audio or 3D model files exist in the project.

## 1. Design → contract

- Started from `pinball_tower_defense_game_plan.md` (the written design: tower defense on a
  vertical pinball table, energy economy, cards, the "ignite an enemy ball" signature).
- Turned it into `docs/CONTRACT.md`: the fixed 720×1440 virtual resolution, the vertical band
  layout, the locked palette, the enemy-ball readability rule, the module/global map, and
  the exact public APIs (`FX`, `SFX`, `ART`, `UI`) every module was written against.

## 2. Core game (main session)

- `physics.js` — capsule/circle pinball solver with substeps sized to the fastest ball.
- `board.js` — the table geometry. Rewritten twice after headless playtesting (thousands of
  simulated frames) found ball traps at the ramp/flipper seam and a slingshot pocket that
  volleyed forever. The comments in the file record the rules that came out of that.
- `entities.js`, `cards.js`, `levels.js`, `game.js` — enemies, towers, upgrade tree, cards,
  five scripted levels with a boss, star ratings and the unlock track.
- Watchdogs in `game.js` (gravity ramp, drain steering, ball-search kick, hard retire) so a
  geometry bug can never soft-lock a wave.

## 3. Parallel modules (Opus subagents, one contract each)

- `fx.js` — pooled, zero-allocation particle/juice layer with a hard cap.
- `audio.js` — 100% procedural Web Audio (every effect and music track is synthesised).
- Art — prompts run through the Codex CLI image tool, packed by `tools/pack_assets.py` into
  base64 WebP data URIs in `src/assets.js`.
- `tools/build.js` / `tools/verify.js` — packaging and an offline-compliance checker.

## 4. Visual pass: 3D machine

- Added three.js (r185) as a plain-script global in `vendor/` (rules: libraries in a vendor
  folder, not embedded) and wrote `src/scene3d.js`: the table, frame, rails, pegs, slingshots,
  spawn gates, drain LED, mounting slots, towers and flippers as lit, shadowed, procedural
  WebGL geometry. The 2D canvas became transparent and keeps the balls, FX and UI on top.
- A first attempt re-themed the whole game to a "modern consumer hardware" look. The author
  rejected it on sight; the original neon toy-pinball direction was restored from git and the
  3D materials were retuned to that palette. Kept from that attempt: the card-based level
  picker (restyled neon) and per-level thumbnails — and then the author rejected that picker
  too, as too convoluted. Replaced with their own idea: Play → a rotatable neon globe with
  world pins (`src/globe.js`), tap World 1 → a plain 3×3 grid of numbered level tiles.
- Verification: headless Chrome harness screenshots for every screen, `renderer.info`
  budget check (≈140 draw calls incl. shadow pass, ≈75k triangles for a full board), and the
  offline checker (`node tools/verify.js`) on the built package.

## 4b. Onboarding tutorial (World 1 · Level 1)

- `src/tutorial.js` — a scripted, interactive first-play lesson that runs on the real table
  before Wave 1: hold left / hold right / hold both (with the "it parks a ball, it won't win
  you the level" joke), a single enemy ball spawned in bullet time with the camera zoomed on
  it, flip it back up (bullet time kicks in as it reaches the flippers, a miss respawns it
  for free), a mid-air freeze to explain that flippers cannot destroy, build a bumper, drop
  a demo ball onto it and destroy it, then tap the bumper to walk through each upgrade and
  Sell, and a beat on cards. Skip button, tap-to-continue cards, animated hold/tap/arrow
  pointers and spotlight cut-outs, all drawn in the 720x1440 virtual space so it lays out
  identically in portrait on any phone. Replayable from the title screen ("How to play").
- Camera zoom is a shared transform: `TUT.cam()` gives a focal point, screen anchor and
  scale that `DRAW.frame` (2D) and `SCENE3D.render` (WebGL pivot) apply identically, so the
  balls stay glued to the 3D machine while zoomed. New `tutorial` game mode: real physics,
  no wave timeline, drains never cost a life.
- Verified in the in-app browser at a 375x812 portrait viewport, driving the whole script
  through `GAME.pointerDown` / `GAME.keyDown` and stepping `GAME.update` frame by frame.
- Playtest fixes. The table's pegs share the SAME columns as the tower slots, on rows exactly
  halfway between the slot rows, so the lesson's ball (spawned at x=360) landed dead centre on
  a peg and balanced there, and the demo ball spawned 300 above a slot spawned *inside* a peg.
  The tutorial now uses hand-checked geometry: two clear fall columns, a 150-unit drop, and
  placement restricted to the three middle slots of one row, which are the only ones with a
  clear column above them. Plus a real-time anti-stall nudge, because the simulation's own
  watchdog is measured in game time and takes seconds to fire under bullet time.
- The lesson is keyed to a tutorial VERSION rather than a boolean, so World 1 Level 1 teaches
  it to every save written before this build instead of only to brand-new ones.
- Results now route onward through the DECK when a level unlocked something, and always
  after Level 1. The Barrier card unlocks at 2 stars but the 2nd card SLOT needs 4, so the
  first reward a player ever earns cannot be equipped without swapping — and nothing in the
  old flow ever sent them to the screen where swapping happens. The deck screen takes an
  optional { next, unlocks } context: it shows what was unlocked, explains the swap in one
  line when they own more cards than slots, and its footer becomes "Play 2. Build the Board".
- Build phases now nudge: if the player can afford a defense and has placed nothing this
  phase, the tray buttons pulse amber and a one-line toast says to spend the Energy.

## 4c. Visual pass 2: make it look like a machine people want to play

- The author's verdict on the first 3D table: works, but "not the biggest fan of the visual
  design". Diagnosis from screenshots: a flat, straight-down slab with tiny pins, no light in
  the scene, and a title screen whose key art was hidden behind a 95% veil.
- Key art regenerated with the codex CLI image tool (two prompts, run from a scratch
  directory so its auto-commit habit could not fire): a cinematic neon cabinet hero for the
  title (dark top band reserved for the logo), and a deliberately quiet PCB-motif playfield
  print. `src/scene3d.js` now reads the print from `ART` once it has decoded (the renderer
  boots before the assets do) and composites the lane marks, drain apron and the
  load-bearing vignette on top of it, so the ball-readability rule in CONTRACT §3 still holds.
- The machine itself: chrome pins, posts, hubs and an inner chrome lip on a clear-coated
  gloss frame; brushed cabinet panels above (HUD) and below (card tray) with cyan pinstripes;
  corner bolts; a frosted dome with a lit core on every bumper; and a bloom stand-in — an
  additive "glow" layer of soft sprites (dot and bar textures) merged into one draw call per
  table for pins, rails, slingshots, gates and the neon rim, plus live ones on towers,
  flippers and the drain that brighten when the thing under them fires. A faint diagonal
  sheen plane sells the glass over the playfield.
- Menus: the title lets the art breathe (light veil, slow 14 s drift, cyan light bleeding up
  from the machine, pulsing primary button); level tiles gained depth and a lit "current"
  state. The flow — title → globe → 3×3 grid — is unchanged, as the author asked.
- Verified in the in-app browser at 375×812: no console errors, ≈147 draw calls / 100k
  triangles on Level 3 with four towers, `node tools/build.js` + `node tools/verify.js` PASS
  (zip 0.76 MB).

## 4d. Portrait UI and presentation revamp

- Rebuilt the title hierarchy around a shorter two-line pitch and one dominant START action,
  with Cards and Tutorial grouped as secondary actions. Buttons now have consistent touch
  height, clearer focus/hover states, tighter phone spacing and reduced-motion support.
- Replaced the nine-tile stage grid (four tiles were decorative locks) with the five actual
  stages in a single progression row. Selecting a stage now updates a compact objective card;
  a separate PLAY LEVEL action prevents accidental launches and makes the flow explicit.
- Reworked Power Cards into a one-screen 3x2 collection at normal phone heights, with a
  compact short-phone variant. Copy is shorter and Back returns to the title, world, or level
  screen that opened it instead of always dumping the player into level select.
- Phone aspect ratios now fill the complete portrait viewport with matched X/Y input mapping;
  tablets and desktop retain contain-fit. This removes device letterboxing without cropping
  the HUD or card tray. The live HUD was enlarged and given stronger contrast.
- Lifted the 3D playfield exposure, environment fill, key light and cyan kicker, reduced the
  dark wash over the painted board, and added a restrained emissive base so slots, rails and
  balls remain legible without flattening the neon-night art direction.
- Verified title, world, level select, Power Cards, tutorial, build phase, live wave and pause
  at 375x667 and 390x844. Navigation return paths passed; no clipping or menu scrolling was
  present. `node tools/build.js`, `node tools/verify.js`, syntax checks and `git diff --check`
  passed after the source changes.

## 5. Packaging

`node tools/build.js` inlines the readable game modules into `dist/index.html`, copies the
library to `dist/vendor/`, and writes `dist/megaball.zip` (index.html at the root plus
`vendor/three.min.js`). `node tools/verify.js` proves no remote URLs, no network APIs, no
modules, no remote fonts, only `vendor/` subresources, under 35 MB.
