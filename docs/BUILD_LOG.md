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

## 4e. Menu system rebuilt around the logo and a neon HUD reference

- Home now leads with the generated MEGABALL logo (transparent WebP, soft cyan/magenta bloom,
  slow bob), a shield tagline panel, one dominant PLAY button with a "World 1 · Five stages"
  subtitle, and two icon cards (Power Cards in magenta, Learn in cyan) — matching the
  reference mock the author supplied.
- One frame language everywhere: chamfered octagonal panels drawn with a `clip-path` edge
  layer plus a `::before` fill, outer bloom from a `drop-shadow` filter on the wrapper so the
  glow follows the silhouette. Buttons, chips, level tiles, card tiles, stat boxes, unlock
  banners and globe pins all share it (`src/ui.js`).
- Every sub-screen has the same top bar: back chip on the left, title, star chip on the
  right. The campaign screen keeps the "Choose your battlefield." copy and the drag-to-spin
  globe, with an explicit Enter World 1 button under it for keyboard players.
- Keyboard/gamepad-style menu navigation: arrows move focus to the nearest control in that
  direction, Enter/Space press it, Escape/Backspace goes back; the ring is a white-hot edge
  that reads on any backdrop. Menu keys are swallowed so flippers stay quiet.
- Unused `bg_menu` art removed from the pack (payload 533 KB across 14 assets).
- Verified in the in-app browser at 390×844: home, campaign, level select, Power Cards,
  results and pause; no console errors; `node tools/build.js` + `node tools/verify.js` PASS
  (document 1.12 MB).

## 4f. Endless mode

- A second way to play from the Home screen: Endless. It reuses the whole level pipeline
  (build phase, banner, wave compiler, results) by being a level whose wave list is written
  on demand instead of authored (`LEVELS.ENDLESS`, `LEVELS.endlessWave` in `src/levels.js`).
  Each wave is generated from a points budget that grows every wave; Runners join at wave 2,
  Haulers at 4, Bulwarks at 6, Dividers at 8; every 10th wave is a Colossus with an escort.
- Enemy HP scales with `LEVELS.endlessDifficulty` (linear early, gently quadratic later),
  build countdowns shrink from 11s to a 6s floor, and the wave-clear bonus is capped so late
  waves are not a free-build festival. Clearing a boss wave restores one life.
- Each run rolls its own seed. The HUD shows `WAVE n` with the saved record under it, the
  boss banner reads BOSS WAVE instead of FINAL WAVE, and the run ends on a dedicated results
  screen (waves survived, best run, kills, leaks, NEW BEST banner). Progress stores
  `endlessBest` and `endlessRuns`; campaign stars and unlocks are untouched.
- Verified in the in-app browser at 390x844 by driving `GAME.update` from script: eleven
  waves including the wave-10 boss, life restore, best-run save, and the lose flow; no
  console errors.

## 4g. Phone fit without stretch; home screen recomposed

- The board is now scaled uniformly on every device: the 1.06 per-axis stretch is gone
  (`U.UI.maxStretch` removed). At 375x812 the table used to be 6% taller than wide and still
  sat between two 37px black bars.
- Spare height on a tall phone becomes cabinet instead of bars (`DRAW.resize` in
  `src/render.js`): the HUD rises into the head panel above the table frame, up to
  `U.UI.headMax` (100) units, which uncovers the spawn gates and the INCOMING banner; whatever
  is left goes to the card tray, whose hand, build piles and upgrade panel scale up (capped at
  `U.UI.trayScaleMax`, 1.3) and sit centred in the apron. Short viewports, tablets and desktop
  keep the height-limited contain fit with slim side bars.
- `DRAW.vp` exposes `viewTop / viewBottom / hudShift / trayShift`. Tray hit rects stay in
  tray space; `pickTray` maps taps in, `trayRects` / `upgradeRects` map rects out for the
  tutorial and the build hint, and the hold-to-read popout grows from the on-screen cell.
- The WebGL camera (`src/scene3d.js`) keeps its eye where it was and opens an off-axis frustum
  (`setViewOffset`) to the same band, so the table's perspective is identical on every phone
  and tall ones simply see more of the head and apron plates, which now run 480 units past
  the board. The full-screen flash in `src/fx.js` overfills the taller band.
- Home screen (`screenTitle` in `src/ui.js`) recomposed: a slim pilot strip (rank, progress to
  the next unlock, sound), the logo as the hero with the key art breathing under it, then a
  foot cluster of one gold PLAY and a 2x2 grid of tiles (Levels, Power Cards, Endless, Learn)
  that carry their own counts. The four-row list, the world/stars/best footer tiles and the
  version line are gone; everything fits 360x560 upward without clipping.
- Verified in the in-app browser at 375x812, 390x844, 412x915, 375x667, 360x640 and desktop
  by driving `GAME.update` from script: no console errors; tray cells, pause and hold-to-read
  hit-test correctly through the scaled tray; tutorial pointers land on the larger cells.

## 4h. Home screen as a pinball backglass

- The author called the boxed home layout "AI sloppy" and asked for the frontend-design
  skill. The screen is now the lit backglass of the cabinet in attract mode (`screenTitle`
  in `src/ui.js`): logo on glass over the key art, a real 128x32 dot-matrix display, the
  cabinet START button, and a scorecard of modes with insert lamps and dot leaders instead of
  a stack of framed buttons. Scanlines and a slow reflection sweep sit over the whole pane;
  entry is a lamps-on flicker, the logo scales in, rows stagger in, the button pulses, and a
  "PRESS PLAY · 1 PLAYER · FREE PLAY" line blinks.
- The display (`dmdStart`) rasterises each attract message through the pixel face into a
  128x32 bitmap and paints it as dots (crisp core, short bloom), so the glyphs are real dots.
  Messages: MEGABALL, current world/stage and name, endless record, stars and rank, PRESS
  PLAY; a boot sparkle, left-to-right wipes, and a crawl for lines wider than the display.
  It stops when the screen changes.
- One shipped typeface, "Kenney Pixel" (Kenney, CC0 1.0), embedded as a `data:` URI in
  `src/fonts.js` (3.6 KB WOFF) so the game stays offline and the verifier's no-font-
  subresource rule holds. The raw TTF trips the browsers' OpenType sanitizer (a cmap range
  past the last glyph); re-saving it through fontTools as WOFF fixes it. Source files under
  `assets/raw/`. Sub-screens keep the system stack and the chamfered-panel language.
- Verified in the in-app browser at 375x812, 375x667, 360x560 and 412x915: font loads,
  display cycles, no console errors.

## 4i. The backglass language everywhere

- Every remaining screen and the in-game UI now share the home screen's hardware language.
  DOM screens (`src/ui.js`): a readout line with a lamp-lit back link and the star count; pixel
  headings; amber cabinet buttons (cyan and magenta variants) for the primary action; scorecard
  rows with insert lamps and dot leaders for secondary actions and for stats; dark display
  plates on the dot grid for descriptions and objectives (objectives carry lamps: amber met,
  magenta failed); glass scanlines and the reflection sweep on all of them. Campaign keeps the
  headline, copy and globe (pins are now readout plates). Level select shows the five stages as
  inserts with three star lamps each. Power cards keep the art tiles on sockets. Pause, results
  and endless results open with their own dot-matrix display (PAUSED / LEVEL CLEAR / BREACHED /
  RUN OVER, then the stage and the score) and stars are lamps. Entry flickers start from lit,
  so a stalled animation can never hide a screen.
- Canvas UI (`src/render.js`): the HUD is a backbox glass strip on the dot grid with lives as
  insert lamps, the wave counter and level name as real dot-matrix readouts (`dmdText`, one
  cached sprite per string), energy in amber dots with a bolt lamp, and a round cabinet pause
  button; modifier chips sit under the glass. The build banner is a display plate with a lamp
  and an amber cabinet START; the challenge chip has a state lamp; toasts have a lamp. Tray
  captions, card names, hotkeys, cooldowns, build piles, the upgrade panel, combat text
  (`src/fx.js`) and tutorial titles (`src/tutorial.js`) use the pixel face via `ptext`; body
  copy stays on the system stack.
- Boot: `FONTS.inject()` puts the face in the page before the splash, which is now set in it,
  and `index.html` waits for the font (capped at 1.5 s) alongside the art so the first HUD
  frame rasterises through it.
- Verified in the in-app browser at 375x812 and 375x667: campaign, level select, power cards,
  in-game build phase, pause, results, endless results, tutorial; no console errors;
  `node tools/build.js` + `node tools/verify.js` PASS.
- Second pass on the lobbies, so they carry the home screen's weight: the display is now a
  controller (`dmdRun` returns `{stop, set}`) and reacts to what is tapped. Level select puts
  the selected stage's painted art (`lvl_n`) in a translite window with its name and subtitle,
  and the display reads out the stage, its stars and the world tally. Power cards open with a
  featured card (art beside name, description and cooldown/slot chips); tapping a locked card
  features it so the unlock cost is readable, and the display carries the rule in force (tap
  to equip / slots full, tap to swap / next stage). Endless gets its own lobby
  (`screenEndless`): record and rules on the display and a translite, best run, runs played
  and the loadout as scorecard rows, then START RUN. The home Endless row opens the lobby.
- Tutorial overlay (`src/tutorial.js`) in the same language: the lesson card is a display
  plate on the dot grid with bezel screws, a lamp before the pixel-face title, body copy in
  the reading face, and an amber lamp breathing beside TAP TO CONTINUE; the skip control is a
  lamp-lit readout button. Fingertip and chevron pointers keep the ball language.

## 4j. Loader in theme; no hitch on level start

- Boot splash (`index.html`, CSS only): the machine powering up. A ball drops between two
  flippers that flip on impact, MEGABALL sits on a dot-matrix display (pixel face under a
  dot mask, lit when the face has loaded), seven attract lamps chase, and the status line
  reads Loading art / Powering up / Ready. Only transform and opacity animate, so the
  compositor keeps it moving while the main thread works behind it.
- The stutter on level start was the first frame doing all the heavy lifting: the very first
  frame compiled every shader (~760 ms on a desktop, several times that on a phone) and every
  level start rebuilt the table geometry and uploaded it on the frame that should draw
  (24 to 67 ms measured). Fix: `SCENE3D.warm(defs, done)` runs behind the splash, one step
  per animation frame: one draw of the bare machine (shaders, environment, shadow map, field
  art), then each level's table built, cached per level id (`tableCache`, layouts are
  deterministic), uploaded and drawn once. A level start is now a cached group swap; cached
  groups are never disposed. Measured after: menu frame 0.3 ms, first frame of a level
  1.5 to 2.4 ms, steady state under 1.5 ms.
- The audio engine's one-time setup moves to the first menu tap (`on()` in `src/ui.js`)
  instead of the first level start.
- Verified in the in-app browser: boot sequence, title after warm-up, level 2, level 4 and
  endless starts timed from script; no console errors; build + verify PASS.

## 4k. No flicker between screens

- The author saw a flicker on every home-screen tap. Two causes: the "lamps on" entry
  effect ran on every screen change, and `shell()` rebuilt the backdrop (key art, veil, grid,
  glass) with each screen. Now the backdrop is built once in `UI.init` and stays put; a
  screen change swaps only the sheet under a plain cross-fade (`screenIn`), the power-on
  flicker, logo/button reveals and display sparkle play only on the first home screen after
  boot (`.boot`), and sub-screen displays wipe their first message straight in. Backdrop
  variants are selected by classes on `#ui` (`hero`, `home`, `sub`, `pause`, `nobg`) via
  `mark(sheet, cls)`.

## 4l. The in-game view as one machine

- The author liked the menus and asked for the playable view to match them and sit better on
  a portrait phone. What was wrong, seen against the black-glass menus: the cabinet head and
  apron were grey brushed steel, the HUD was a pill floating on that plate with margins all
  round, the field was a grid of 28 bright chrome slot discs, five separate chrome gate trims
  made a checkerboard along the top, and the card hand sat in a bright-bordered box on a box.
- Cabinet (`src/scene3d.js`): the head and apron plates are now black backglass on the dot
  grid (`glassPlateTexture`, one texel per unit, 28-unit dot pitch, own repeat per plate) with
  a soft clear coat; the print stops at the frame (void outside it), so the frame is the edge
  of the machine and the lit strip of print past the right wall no longer reads as a border.
  The gate trims are one continuous steel header; the mounting slots are dark sockets with a
  dim ring, so the pegs and towers, the things the ball hits, carry the light. The print gets
  tapered lane-arrow inserts under the gates and a quiet maker's mark above the drain.
- Backglass HUD (`drawHud` in `src/render.js`): one display plate the width of the cabinet,
  dot grid, scanlines, bezel screws, docked to the frame's pinstripe. The readout row (lamps,
  wave and energy in dots, cabinet pause button) sits nearest the table. A tall phone's extra
  head becomes a second row: MEGABALL / STAGE n bezel captions and a live dot-matrix ticker
  (`hudTicker`): active card effects with their timers, else during the build the next wave's
  roster and the star challenge take turns, and during a wave the balls still to deal with.
  Short viewports keep the one-row glass and the modifier chips under it.
- Tray: the hand is a well let into the apron (dark, top edge in shadow, cyan breath on the
  lip, POWER CARDS caption plate breaking the edge) rather than a bordered plate; the pile
  prices are a bolt lamp and amber dot digits, the energy counter's own language. The tower
  upgrade panel is refit to the 130-unit band (it ran to 1408 in a band ending at 1370, so
  the price line fell off the bottom of a short phone): name row with lamp and CLOSE, then
  74-unit cards with two-line blurbs, ending inside the band.
- Verified in the in-app browser at 375x812 and 375x667: build phase (banner, ticker
  alternating NEXT / STAR), wave (balls-left ticker), tower selected (upgrade panel), no
  console errors; draw calls unchanged (59 on stage 1); `node tools/build.js` +
  `node tools/verify.js` PASS.

## 4m. New wordmark; the way out is a cabinet button

- Wordmark: `assets/raw/logo_megaball.png` is the MegaBall Defense banner (2172x724, alpha),
  packed at 900x300 (`logo_` size rule in `tools/pack_assets.py`, 49 KB WebP). The plate is a
  3:1 banner rather than the old 640x430 square, so `.brand-logo` takes `aspect-ratio:3/1`,
  the home brand runs the full sheet width, and the top spacer is weighted down (.28) so the
  wordmark rides high on the backglass instead of floating in the middle of the art.
- Back navigation: the `MAP` / `HOME` text link above the star readout is gone. Every
  sub-screen (campaign, stage select, power cards, endless) now ends with `.pxbk` -- a
  full-width pixel back button under the last option, stair-cut corners (`pxc()`, whole-cell
  steps rather than a machined bevel) and an 8x8 block arrow. It keeps `id="back"`, so
  Escape and Backspace still route through it. The readout row it vacated shrinks to 26px
  and the scorecard above the button stops stretching (`.scard.tight`), which is what keeps
  the button under POWER CARDS instead of drifting to the floor of the sheet.
- Verified in the in-app browser at 375x812 and 375x667: all four sub-screens plus the title,
  no console errors.
## 4n. Tower upgrades as a level-up pick

- Tapping a tower during a wave is now a decision beat: the table ramps into 12% speed over
  a quarter second (`selT` factor in the time scaling in `src/game.js`), the mix drops under
  the slow-motion lowpass and `slowmo_in` plays; closing lifts the filter unless a Slow Time
  card still owns it. `S.selFor` / `S.selT` track which tower the pick is open for and how
  long, ahead of the mode gate so quitting with a pick open still restores the mix.
- The pick itself left the apron. `drawUpgradeModal` (`src/render.js`) dims the field and
  lays the options out as big cards across the middle of the board (206x330 for a bumper's
  three, 236 wide for a paddle's two): a colour-banded header with the name, the tower's
  silhouette as art, the blurb, and an amber price plate (or NEED n MORE in magenta). SELL
  and CLOSE share a row underneath; a tier-2 tower with nothing left to become gets just
  that row, mid-screen. Every card rises from below the screen edge in turn, left to right,
  90 ms apart, overshooting and settling (`popIn`, `U.ease.outBack`).
- Taps: `DRAW.hitUpgrade` tests the same board-space rects the painter used, ahead of the
  tray in `pointerDown`; a tap on the HUD or tray closes the pick, a field tap falls through
  so it can re-target another tower or close-and-flip. `DRAW.upgradeRects` now returns
  board-space rects, so the tutorial's spotlights follow; its upgrade lessons read from the
  low slot under the cards instead of mid-screen.
- Verified in the in-app browser at 375x812: cards arrive one, two, three; tapping SHOCK
  upgrades (460 -> 385 E) and the re-opened pick shows the tier-2 SELL / CLOSE row; the ball
  crawls while the pick is up; no console errors.
## 4o. Cooldowns on the upgrade pick; Blast Bumper re-arms slower

- Every option card in the upgrade pick now carries a cooldown chip under its blurb:
  `0.58S SWING CD` for paddles, `2.6S BLAST CD` / `0.95S CHAIN CD` for the specialised
  bumpers, `NO COOLDOWN` for the plain and launch bumpers (`towerCdLabel` in render.js).
  The heading shows the tapped tower's own cooldown and its live state: `READY`, or
  `READY IN 0.4S` in amber while it recharges. `chip` learned a `center` side for this.
- The Blast Bumper detonated every 1.4 s, which made it a near-permanent area denial
  once two balls were in play. Its `blastCd` is now 2.6 s; the arc around the bumper
  reads the new value, so the re-arm is visible on the table too.
- Verified in the in-app browser at 375x812 on stage 2: a fresh paddle with 0.45 s of
  swing left shows `0.62S SWING CD / READY IN 0.1S` in the heading; both paddle and
  bumper picks show the chips inside the cards; no console errors.

## 4p. Paddles that hit but did not hurt

- Report: a paddle would visibly connect with a ball (kick, sparks, sound) and the ball
  took no damage. Cause: `towerPaddleHit` only dealt damage while the arm's angular
  speed was above 4 rad/s. The paddle leads the ball by ~0.07 s, so the ball usually
  arrives at full extension or on the slow reset, where that speed is near zero. In a
  scripted 60 s run with six paddles, 27% of arm contacts during a swing fell in that
  slow phase.
- Now the whole 0.34 s swing cycle is live. The outward stroke and the extension carry
  the arm's velocity and the full launch force; the reset gives a softer 55% kick and no
  arm velocity (it would drag the ball inward). Paddles got the bumpers' per-ball
  `hitCds` map so a ball resting against a resetting arm takes one hit per swing, not
  one per frame.
- Verified in the in-app browser on stage 2: 147 contact frames during swings produced
  120 damage events (the rest are the same ball within 0.3 s), 57 of 72 drones killed.

## 4q. Tutorial: look cues no longer read as tap cues

- Report: several lessons point at a control and the player taps it, but the tap just
  advances the card. The DEFENSES arrow sat over the tray, PADDLE pointed at the PADDLE
  button, and each upgrade card (BLAST, SHOCK, LAUNCH, SELL) was cut out of the dim
  mask with the same pulsing cyan rim the lesson uses for "tap one of the GLOWING
  slots". Same picture, two meanings.
- Now the picture says which it is. A card that continues on any tap prints TAP
  ANYWHERE TO CONTINUE whenever a pointer or spotlight is up, its spotlight rim is a
  steady thin amber line (cyan pulse is reserved for something to tap), and every
  show-only arrow carries a caption (ENEMY, BUMPER, ENERGY, PADDLE, BLAST BUMPER,
  SELL) so it reads as a label rather than an instruction. PADDLE says you build one
  later.
- Where the arrow points at a real button the tap counts: a step's `allow` now wins
  over tap-to-continue, so tapping BUMPER during DEFENSES picks it and skips straight
  to PLACE IT.
- Verified in the in-app browser at 375x812 by stepping the loop from JS: welcome,
  defend (early BUMPER tap lands on placeBumper), paddle, all four upgrade cards, and
  the card step render as described; the interactive steps are unchanged.

## 4q. Upgrading closes the pick

- Buying an upgrade kept the new tower selected, so the modal immediately re-opened on
  the tier-2 layout: no options left, just a bare SELL / CLOSE row. Every upgrade cost a
  second tap to dismiss a screen that offered nothing.
- `GAME.upgradeTower` now clears `S.selectedTower`. The pick closes, the table comes back
  to full speed, and the upgrade's own ring, burst and floating name land on a clear
  board. Selling already closed it this way, so the two now match.
- The tutorial's upgrade steps only tour the cards and never buy, so they are unaffected.
- Verified in the in-app browser at 375x812 on stage 2: tapping SHOCK on a bumper and
  FROST on a paddle through `DRAW.hitUpgrade` both upgrade the tower and leave the
  selection null with the board visible; 180 frames run clean afterwards.

## 4r. Card descriptions were being cut off

- The featured panel on the POWER CARDS screen clamped its description to three lines
  (two on short phones). Four of the six cards need four lines, so SLOW TIME, MEGABALL,
  BARRIER and MAGNETISE all ended in an ellipsis mid-sentence. A card you cannot read is
  a card you cannot choose, which is the one thing that screen exists for.
- Dropped `-webkit-line-clamp` from `.feat-txt .sub`; the panel now sizes to its text and
  the flex spacer below the grid absorbs the extra height. On short phones the
  description drops to 10.5px with tighter leading instead of being clamped, so it still
  fits without truncating.
- Verified in the in-app browser at 375x812, 375x667 and 360x600: all six cards report
  `scrollHeight === clientHeight` (nothing hidden) and the sheet itself never overflows,
  so BACK TO HOME stays on screen at every size.

## 4s. BACK was sitting on the bottom edge

- The menu sheets are marked with a `sub` class, which also matches the unrelated `.sub`
  subtitle text rule and lends them `margin:12px auto 0`. Left at a full `100dvh` the
  sheet therefore hung 12px past the viewport, and since it is `overflow:hidden` the
  bottom padding was simply off-screen: BACK measured a 0px gap to the bottom edge on
  every sub screen (map, stage select, power cards, endless, pause).
- `.sheet.sub` is now `height:calc(100dvh - 12px)` with `padding-bottom:22px` plus the
  safe-area inset, so the button clears the edge. 14px on screens under 600px tall.
- Stage select was already 3px over at 360x600 before this and the tighter box made it
  17px over, so the short-phone rules trim the translite window to 98px and tighten the
  insert row. Nothing else moved.
- Verified in the in-app browser at 375x812, 375x667 and 360x600 across all five sub
  screens: zero sheet overflow everywhere, and the last element clears the bottom edge
  by 22px on tall screens, 14px on short ones.

## 5. Packaging

`node tools/build.js` inlines the readable game modules into `dist/index.html`, copies the
library to `dist/vendor/`, and writes `dist/megaball.zip` (index.html at the root plus
`vendor/three.min.js`). `node tools/verify.js` proves no remote URLs, no network APIs, no
modules, no remote fonts, only `vendor/` subresources, under 35 MB.
