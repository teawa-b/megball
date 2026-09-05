# MEGABALL — build log

The competition asks for a markdown log of how the prototype was built with AI tools. This
is that log, in order. Everything below was done with Claude Code (Claude Fable 5.1 driving
the session, Claude Opus subagents for parallel modules) plus the OpenAI Codex CLI for image
generation, with Meta Muse 1.2 used for minor bug fixes. No hand-authored art, audio or 3D
model files exist in the project.

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

## 4t. Boot splash given room; the backglass wakes up

- The splash looked squashed because the wordmark exactly filled the display: 209px of
  text in a 210px inner box, touching both bezels. The type now scales with the viewport
  (`clamp(21px, 6.9vw, 30px)`), the bezel carries 30px of side padding, and the display,
  lamp chase and tagline each got vertical breathing room. The play area widened to
  `min(62vw, 236px)` but kept its 150px height on purpose - the ball's drop keyframe
  lands exactly on the flipper faces, and raising it opened a visible gap between them.
  At 375px the wordmark now clears each bezel by 31px; at 320px it scales down and still
  clears by 31px.
- Home screen, more life, all of it compositor work:
  - An attract lamp rail above the display, carrying the boot splash's chase onto the
    backglass so the machine looks awake while it waits. Nine lamps, one opacity each.
  - The scorecard insert lamps now wink in turn, the way a cabinet nags you to choose a
    mode. The dot keeps its steady glow; a cap on top fades in and out.
- Home screen, faster: the START button used to breathe by animating a 60px-blur
  `box-shadow`, which repaints a large area every frame for as long as the menu is open.
  The glow moved to its own halo element animating only opacity and transform. Measured
  with `document.getAnimations()` and each animation's keyframe properties: the old sheet
  had one paint-triggering animation (`startPulse: boxShadow`), the new one has zero -
  all 25 running animations are `opacity`/`transform` only.
- Note on measurement: frame rate could not be measured in the in-app browser, which
  throttles `requestAnimationFrame` to ~1.5fps regardless of page cost (confirmed: the
  same 1.5fps with every UI animation disabled, and zero long tasks over 4s). The perf
  claim above rests on the property audit, not on an fps number.
- Verified at 375x812, 360x600 and 320x568: no sheet overflow, the lamp chase advances
  between frames, the DMD still cycles its messages, and a cold boot dismisses the splash
  and lands on the home screen as before.

## 4u. Attrition, boss variants, and a difficulty curve that arrives

Playtest verdict on Endless: "I reached level ten and literally didn't have to touch the
phone." A handful of upgraded bumpers held the board on their own, the wave never got
denser, and the only boss was ten waves away. Six changes, all measured against a headless
bot that plays the real `game.js`:

- **Defenses wear out.** Every registered impact scuffs the defense that took it, by the
  striking ball's MASS, so a Hauler batters a bumper far harder than a Drone. Output falls
  with condition (never below 55%, so a tired tower is not dead weight) and an exhausted
  one breaks and frees its slot. Bumpers are always on and register a hit per contact, so
  they wear roughly three times faster than paddles - the difference is emergent from one
  rule, not a second set of numbers. Every upgrade buys a bigger pool, so specialising is
  also buying staying power. REPAIR is a new row in the tower's own panel, priced on how
  much is missing, and it is the energy sink the late game never had.
- **Bumpers were the problem, and the re-hit cooldown was the number.** At `hitCd 0.14` a
  ball rattling in a nest took seven damage instances a second. Now 0.2, with damage
  1.6 -> 1.45. Paddles took a lighter trim (2.2/0.62 -> 2.05/0.68).
- **Endless actually escalates.** Concurrency was a fixed 13 and is now `12 + 0.9/wave`
  up to 30; the points budget gained a quadratic term; spawn gaps tighten from 1.15s to
  0.26s; the HP curve roughly doubled. Measured peak balls on screen: 5 at wave 1, 13 at
  wave 10, 30 from wave 22.
- **A boss every fifth wave, and a different one each time.** Colossus, then Rimewall
  (frost slides off it; it freezes the defenses it passes), Breaker (tears durability out
  of towers, so the flippers have to carry the fight), Vector (dashes sideways, outrunning
  a static nest), then the two damage locks - Prism takes paddle damage only, Crucible
  bumper damage only. Past the rota they arrive in pairs. A lock never blocks the
  empowered-ball chain or a card, or a board of the wrong shape would face an unwinnable
  wave. Locks are readable on the ball (a second, turning dashed ring) and spelled out
  under the health bar, and the wrong damage source says IMMUNE rather than silently
  doing nothing.
- **World 1 Level 3 ends on a mini-boss.** The Warden is a Colossus a Level-3 board can
  actually kill, so the real one on Level 5 is a test rather than an ambush.
- **Measured outcome.** A maxed board can no longer play itself: stop flipping at wave 10
  and the run ends by wave 14; stop at wave 15 and lives fall 5 -> 1 inside one wave.
  Campaign difficulty is statistically unchanged (5 runs each, before and after: L1-L3
  always cleared, L4 4/5, L5 2/5), so the rebalance did not turn the teaching arc into a
  wall.

## 4v. Three bugs

- **The music never came back.** Backgrounding the app suspends the AudioContext, and the
  visibility handler only restarted the note scheduler - which cannot produce sound on a
  suspended context. Worse, the scheduler kept queueing notes against a frozen clock, so
  they all landed on the same instant. Now: `tick()` refuses to schedule unless the
  context is running, and a `resumeAudio()` resumes the CONTEXT (from `visibilitychange`,
  `pageshow`, `focus`, and the next tap) before resyncing the sequencer. It is guarded so
  the resync only fires on an actually-stalled track - `init()` runs on every tap, and
  recovering unconditionally would stutter the music on every flipper press. Covered by a
  lifecycle test with a mock Web Audio context: the old code fails "music comes back after
  the app returns", the new code passes it twice over.
- **Big balls stuck against the side walls.** The outer pegs of the middle row sat at
  x=104 and x=616, leaving a 47-unit channel against a wall surface at 48 - narrower than
  a Hauler is wide (52). One that found it wedged there, shoved back and forth between the
  wall and the peg, and the wave could not finish. The pegs moved to 128/592 (71-unit
  channel), and a general wedge watchdog now sums a ball's static contact normals: when
  they cancel out for 0.3s the ball is freed toward open table. Measured on 96 balls
  dropped into the channel: worst-case escape went from 16.5s to 3.9s, and a 320-ball
  sweep of the whole table reports zero wedges.
- **The first-round build prompt was a toast.** A new player with an empty board can lose
  the level before realising the tray is where defenses come from, and a 15px line at the
  bottom of a moving screen is not where anyone is looking. The opening phase now gets a
  full callout in the build field, with a chevron pointing at the tray, which clears the
  moment the first defense goes down.

## 4w. Two pop-out cards

A notice is a card that stops the table to say one thing, or ask one question - the same
furniture as the upgrade pick, because both mean "the table has stopped and this is a
decision". The sim is frozen while one is up, so an explainer can never be the reason a
wave got through, and backgrounding the app does not silently answer one.

- **DEFENSES WEAR OUT** fires once ever, the first time anything on the board actually
  drops a condition band. Explaining it up front would be a rule about nothing; explaining
  it when the player can see a scuffed bumper is when it means something.
- **FIRST TIME?** is offered at the top of an Endless run to anyone who has not been
  through the lesson, and asked once - a prompt that returns every run stops being an
  offer. TEACH ME runs the full tutorial and hands back into the Endless build phase
  (verified end to end; the tutorial has no level-1 dependencies). The offer lives in
  `startLevel` because Endless is reachable from the lobby, a results screen and
  `startEndless`, and all three land there.

## 4x. Sending the wave early

The START button on the build banner already worked — tap it, or press Space, and the wave
goes. Nobody pressed it, because doing so was strictly worse: you gave up prep time and got
nothing for it. Other tower defense games make that a real decision by PAYING for the time
you hand back, so now so does this one.

- The bonus is `secondsRemaining x rate`, where the rate climbs with the run
  (`3 + 0.7/wave`, capped at 12/s) so the offer stays worth taking once a wave clear pays
  hundreds. It rides on the button face next to the countdown and visibly shrinks as the
  clock runs. Letting the countdown expire pays nothing, which falls out of the same
  expression rather than needing a special case.
- The painted cabinet button is only ~34 real pixels tall on a 375px phone, under the
  comfortable tap minimum, and the banner has no room to grow the art — so the HIT rect is
  inflated by 14 units instead. Verified that a press 10 units below the art now lands, and
  that field taps still place towers rather than being swallowed.
- Enter starts a wave as well as Space; Enter previously fell through to the tutorial.
- The tutorial's closing line now points at it, since an early-start bonus is invisible as
  a mechanic until somebody says it is there.
- **Tuned against three bots.** Patient (lets the clock run): Endless wave 22, campaign
  L1-L4 cleared. Rushing only when nothing more can be bought: wave 23 — a small edge for
  correct judgement. Rushing blindly every wave, ready or not: dies on Endless wave 2 and
  loses L2 onward. Reward for reading the board, ruin for impatience, which is the shape
  the mechanic is supposed to have.

## 4y. The durability readout, and two dead ends before it

Three designs went in the bin before this one landed, which is worth recording because the
failures were all the same failure.

1. **A gauge RING around each tower.** Legible, and it looked awful: a bright halo on every
   worn defense, competing with the machine underneath. "It just looks very rough."
2. **A level BAR inside the tower.** Cleaner, still an instrument bolted onto a pinball
   table rather than part of one.
3. **Six glowing, branching, wobbling CRACKS.** The right idea, badly overdone — on a
   30-unit dome that is far too much geometry, and a coloured glow on a body that already
   glows is just noise. "Very aggressive, but almost unappealing to look at."

Every one of them was UI stuck ON the machine. What shipped is the machine itself ageing:

- **Tint, carrying most of it.** A worn tower's colour ages toward steel and its lamps go
  dull — in the 2D painter and in the WebGL bodies alike. Hue survives the mix, so a Blast
  bumper is still the magenta one; it has just lost its life. The fade is curved
  (`(1-cond)^0.7`) rather than linear: a straight ramp put almost no change into the first
  third of a tower's life, which is exactly where the tint is the only signal there is.
- **Cracks, as an accent.** One to three fine hairlines running from the rim inward, one
  kink each, no branches and no glow of their own — a dark split with its lip catching the
  light, which is what damage on a machined surface actually looks like. They hold off
  until 70% condition, so a lightly scuffed defense is merely duller and a cracked one has
  visibly earned it. Below 20% the lips catch a slow amber ember, the only colour they ever
  take.
- Still deliberately NOT the mark a ball wears. A damaged ball gets fat black wedges shoved
  outward from its centre on a white body; a tower gets fine hairlines running inward from
  its rim. Opposite direction, opposite weight, so a cracked bumper can never be mistaken at
  a glance for a big enemy parked on the slot.

Nothing at all is drawn above 97%, so a fresh board carries no UI whatsoever.

The frozen state kept a ring, deliberately: it is rare, temporary, and the whole point is
that it shouts. It wears the same mark a frosted BALL does — a ring with radial spines —
because it is the same idea, and a cold wash alone was invisible on a cyan paddle.

REPAIR moved beneath SELL and CLOSE rather than above them, and only appears below 97%, so
the row is never a dead button on an untouched board.

Re-measured after the change (the headless bot does not load `render.js`, so the simulation
is untouched, but the sampling is worth recording): patient Endless over 8 runs reached
waves 22 24 29 25 26 3 29 24 — median ~25 with one unlucky early wipe, which is the shape
an Endless mode that rolls a fresh seed per run should have. Campaign over 6 runs: L1-L3
always cleared, L4 5/6, L5 2/6. Earlier single-run figures in this log were under-sampled;
these are the honest ones.

## 4u. Bosses that could not actually be killed

- Report: a boss's health takes too long to deplete. Measuring it turned up two causes,
  and the second was the real one.
- **Damage economy.** A built board lands about 1.5 damage per second on a boss, and that
  figure barely moves with tower count (5 towers 1.66/s, 14 towers 1.38/s) - the limit is
  how often the boss is in contact, not how much is on the table. At 240 hit points the
  Colossus needed roughly 160s of unbroken contact.
- **The anti-stall backstop.** `updateBall` retires ANY ball still alive after 40s,
  awarding the bounty and counting a kill. Its comment says "no ball in normal play lives
  anywhere near this long", which is untrue of a boss - outlasting the board is a boss's
  job. So the Colossus was always retired at about three-quarters health: the bar crawled,
  then the boss simply vanished. Measured on the level-5 finale, it left the board with
  247.7 of 312 hit points intact.
- Fix, both halves: bosses now get their own timings (stall ramp at 70s, backstop at 150s)
  so a long fight is allowed to finish while a genuine geometry trap still resolves; and
  boss hit points were re-costed against the measured damage rate.

  | Boss | Was | Now | Measured solo fight |
  |---|---|---|---|
  | Warden (mini) | 74 | 30 | 16-18s |
  | Colossus | 240 | 58 | 28-39s |
  | Rimewall | 300 | 55 | 48-62s |
  | Breaker | 265 | 55 | 40-44s |
  | Vector | 205 | 80 | 41-44s |
  | Prism | 195 | 38 | 32-43s |
  | Crucible | 205 | 75 | 38-42s |

  The two locked bosses are costed against the board their lock demands, not a mixed one:
  Prism takes paddle damage only (~1.0/s from a paddle board) against Crucible's bumper
  damage (~2.2/s), so equal hit points meant wildly unequal fights. Rimewall carries the
  lowest total of the full bosses because its freeze halves your output - at parity it ran
  78s against the Colossus's 44s.
- Verified: every boss now dies to damage rather than being retired, in a 16-62s band. Two
  full level-5 playthroughs win with 5/5 lives and drive the boss to under 3 hit points,
  where before it walked off the board at 79% health.

## 4z. Calling the next wave in, and two small fixes

- **The tail of a wave is its dullest stretch** — two stragglers ricocheting around while
  the player waits on a counter. The START button already existed for the build phase; the
  same seat now offers **NEXT WAVE** during a live wave, so the wait can be skipped. It is
  gated hard: ENDLESS only (the campaign's authored pacing and its leak-budget stars both
  assume a wave is fought out), only once the gates have gone QUIET (both because "nearly
  over" is untrue while it is still arriving, and because the button sits in the spawn zone
  and must never cover an incoming ball), never over a live boss (a boss IS the wave, not
  its tail), and only with at most 30% of the wave still breathing.
  The stragglers are NOT swept up when it is pressed. They keep playing right through the
  build phase — the physics step was lifted out of `GAME.update` into `stepWorld()` so the
  build phase can run it — and they can still reach the drain and still cost lives while
  the player is shopping. That overlap is the price of the time just bought, and it is what
  stops this from being a free skip. Verified: a straggler left behind drains during the
  build phase and takes a life with it.
- **Upgraded gear costs more to keep running.** Repair was already half of a tower's price,
  which scales, but that left a Power Paddle cheap to nurse relative to what it does. Tier 2
  now pays a 1.4x maintenance premium on top, which is the counterweight to the bigger
  durability pool upgrading buys: full repair runs 20 for a Bumper against 56 for a Blast,
  27 for a Paddle against 77 for a Power.
- **The results card could be dismissed by a tap the player had already started.** It is the
  one screen that raises itself, and it raises itself at the worst possible moment — the
  last ball drains while the player is mid-rhythm on the flippers, and the next tap of that
  rhythm landed on NEXT LEVEL. The sheet is now deaf for 550ms after it appears: longer than
  its own entry animation, far shorter than any deliberate reach for a button. Verified with
  `elementFromPoint`, which is the browser's own hit-test: during the window a tap at the
  button's centre does not reach it, after the window it does.

Regression-checked by running the headless bot against HEAD and the working tree
interleaved, eight runs each, because lifting the physics stepper out of the update loop is
the kind of refactor that silently changes behaviour. The two distributions are the same.

## 4aa. Tap flips, hold opens — separating two intents on one surface

The whole playfield doubles as the flipper surface AND the tower-selection surface, so a tap
meant for a flipper that landed on a bumper opened its panel, dropped the table to 12% speed,
and cost the save.

The first fix gave the flippers priority whenever a ball was descending past y=800 or a
flipper had gone down inside 600ms. It killed the accident and created a worse one: during a
busy wave both are nearly always true, so managing a tower became impossible exactly when
the player most wanted to — "it's causing issues where I actually want to upgrade when a
ball is below the thing". Time-slicing two intents on one surface cannot work, because the
moments they are wanted overlap almost completely.

They are separated by GESTURE now instead. During a WAVE:

- A tap flips. It never selects a tower, so the original accident is impossible.
- A HOLD of 0.22s on a defense opens its panel — near enough the tray's 0.2s card hold that
  it reads as one gesture rather than two. It started at 0.3s and felt sluggish in play. It
  cannot go much lower: press-and-hold is also how a flipper is kept RAISED to trap a ball,
  so every millisecond shaved makes it likelier that a deliberate trap held over a defense
  turns into an upgrade panel instead.
- The press still flips immediately either way, so the gesture never costs a flip; the
  flipper is only released at the moment the panel actually opens.
- Sliding off the defense cancels it — that was a swipe, not a hold.
- A ring fills on the tower while held. Without it the gesture is a guess: you press, nothing
  happens, and there is nothing to tell you that holding a moment longer is the answer.
- Letting go early says so once per level, because a player who taps a defense and gets
  nothing has no other way to discover the hold exists.

A BUILD phase is untouched — nothing else wants the tap there, so a plain tap still opens the
panel. Verified all four: tap-with-a-ball-low flips and hints, hold opens and releases the
flipper, slide-off cancels, build-phase tap opens.

The tutorial teaches the hold, and REQUIRES it. Instant tap-selection is now a build-phase
affordance only, so the lesson's upgrade step asks the player to hold their bumper and will
not accept a tap — teaching the tap would teach a gesture that stops working the moment the
first wave starts. The step's pointer switched to the hold marker the tutorial already had,
and its copy says why: "HOLD your bumper for a moment to open it — during a wave a tap works
the flippers, so holding is how you reach a defense." The ring that fills under the finger is
the game's own affordance, so the lesson is really just pointing at it. Verified the whole
lesson still runs end to end with a real hold driving that step, and that a tap there no
longer advances it.

## 4bb. The opening defense is no longer optional

A player could tap START on a completely empty board and lose wave 1 to a rule nobody had
told them. "You MAY build" is not something a new player reads as "you must", and a prompt
they can dismiss by pressing the big glowing button next to it is not guidance.

Before wave 1, with nothing on the board:

- **The countdown holds.** Otherwise the guidance is decoration and the wave arrives anyway.
- **START is greyed and reads BUILD FIRST**, and refuses the tap with an error and a nudge.
  Greyed rather than hidden: the button has to stay where it lives, or the player learns its
  position only after the rule stops applying. Every route to sending a wave — the banner,
  the keyboard, the tray — funnels through one gate, so it cannot be walked around.
- **The prompt became two steps, showing only the one you are on.** "BUILD YOUR FIRST
  DEFENSE / TAP PADDLE OR BUMPER BELOW" with a chevron at the tray; then, once something is
  in hand, "NOW PLACE IT / TAP THE MARKED SLOT" with a target ring and chevron on a
  recommended mounting point. Stating both steps at once is a paragraph, and a new player
  reads none of it.
- **The marker points, it does not fence.** Every other slot still takes the tap, and the
  prompt says so outright: "ANY SLOT WORKS — THIS ONE IS A GOOD START". The recommendation
  is the nearest free slot to the middle of the build field, which is where the scatter
  posts funnel traffic, so a defense there meets every lane.

Strictly the OPENING phase: `waveIndex < 0` and an empty board. Once a run is under way,
selling down to nothing is the player's business, not the game's — verified that a mid-run
build phase with an empty board is not gated. The tutorial is exempt while it is running,
since the lesson drives its own placement; skipping the lesson leaves the gate in place,
which is the correct outcome.

## 4cc. Endless becomes the headline

The home screen led with the campaign: a round PLAY cabinet button wired to World 1, with
Endless demoted to a row in the scorecard. That is backwards for what this game actually
is. The campaign is five stages long and is finished once; Endless has no ceiling, owns the
record the player comes back to beat, and is where every system built this cycle — the boss
rota, wear, the rising ball count, calling the next wave in — actually lives.

So the round button now launches Endless and the campaign moves down into the scorecard.

It keeps the word PLAY rather than the word ENDLESS: it is a 116px circle set in a 30px
pixel face, where "PLAY" fits and "ENDLESS" does not. The action stays on the cap and the
destination rides underneath it, which is how a real cabinet is labelled anyway. The record
surfaces in three places instead of one — the button's accessible name, the attract line
("Best wave 23 · 1 player · free play"), and first position in the display rotation, which
now opens on ENDLESS / BEST WAVE rather than the campaign stage. With no record yet the
display reads ENDLESS MODE / HOW FAR CAN YOU GET, which is the pitch.

The scorecard keeps four rows so the column still balances the button: Campaign (the globe),
Levels (the stage list), Power cards, How to play. Campaign takes the amber accent Endless
used to have. Nothing lost a route — every destination the old menu reached is still one or
two taps away, and the ids were kept so the handlers did not move.

Checked at 375x812 and 360x600: no sheet overflow, and all four routes verified by clicking
them — big button to the Endless lobby, Campaign to the world map, Levels to the stage list.

## 4dd. Upkeep, the Rimewall's teeth, and what the lesson forgot

- **The tutorial now says where cards come from.** A player could finish the campaign never
  knowing that the second and third objectives on every level are what buys the rest of the
  deck. A new step, STARS BUY CARDS, lands immediately after the player fires their first
  card — while "I want more of these" is the live thought — and spells out the three-star
  scoring and what stars unlock. `TUT.VERSION` bumped to 3, so a save that has seen the old
  lesson gets this one.
- **Endless upkeep gets dearer as a run climbs.** `ENT.repairScale`, driven from the wave
  (`1 + 0.18/wave`, capped at 8x). Income out there climbs steeply, so a flat repair bill
  stopped being a decision somewhere in the teens and the board just got nursed forever out
  of petty cash. A full rebuild of a Power Paddle runs 77 at wave 1, 216 at wave 11, 493 at
  wave 31. The campaign stays at 1x.
- **The Rimewall now cracks what it freezes.** Its pulse takes 14 durability out of the TWO
  NEAREST towers in the ring, with a frost burst on each so the bill is visible. Measured
  against a 16-tower board over a fixed 60s window, it roughly doubles the towers destroyed.

The Rimewall took four passes to land, and the wrong turns are the interesting part:

1. **AoE wear was a trap.** Damaging every tower in the ring looked fairer and walked the
   whole nest toward zero in lockstep, so they failed together and the board's output fell
   off a cliff mid-fight. A sweep lost the wave at every value from 8 upward — including
   values dealing LESS total damage than what shipped. Concentrated on two named towers it
   is a bill the player can see and answer.
2. **The real damage was not where it looked.** Any truthy `wrecker` also switched on a x3
   CONTACT wear multiplier, and a boss of mass 7.4 rattling through a nest lands contacts
   constantly — 22 durability a touch. That, not the pulse, was dissolving the board, which
   is why 8 and 26 behaved the same. Contact wear is now its own field, `contactWear`, and
   only the Breaker has it: destruction by contact is the Breaker's identity, not the
   Rimewall's.
3. **The instrument was measuring the wrong thing.** "Does the bot win" is dominated by
   whether it leaks to the boss's escorts, which is noise — the same setting won 4/3 and
   lost 3/3 across runs. Switching to "how much of the board is left after a fixed 60s,
   lives held open" gave a signal that actually moved with the input.
4. **More was not more.** Tower destruction saturates near four towers however hard the
   pulse bites, while the boss's own survival falls off as the board thins: 14 killed it in
   2 of 3 runs, 22 in 1, 30 in none. So 22 and 30 bought no extra damage and cost the fight.

**Correction to the Rimewall numbers above.** They were tuned against a fixed 60-second
window, and that instrument read backwards: harder settings looked like they stopped the
boss dying, when they were only pushing the kill past the end of the window. Measured to the
END of the fight instead, with lives live, the ordering reverses — 26 x 3 destroys nearly
twice the towers of 14 x 2 (6.7 of 16 against 3.7) AND kills the boss more often (2 runs of 3
against 1), in the same ~67s, with a couple of lives to spare. Shipped at 26 x 3. Three
towers and not the whole ring still stands: spreading it walks the entire nest to zero in
lockstep and the board's output falls off a cliff mid-fight.

Also checked and NOT changed: energy does not carry between campaign levels. Every route —
next level, direct start, restart, and Endless — resets to the level's own `startEnergy`
(135/155/170/185/200). The rising start values are most likely what read as carry-over.

## 4ee. The build piles were half the size of a power card

PADDLE and BUMPER drew a 64x80 face inside an 80-wide slot, against a 92x120 power card —
so the two most-used controls in the game were roughly half the area of the least-used, and
they read as an afterthought beside the hand. Building is the core loop; they should not be
the smallest thing in the tray.

The panel between them could not give up any width: at `trayScaleMax` a four-card hand uses
every unit of it, which is exactly the configuration a tall phone runs. So the space came
from the piles' own padding and from the full height of the apron instead — the face is now
78x90 (137% of the old area, against the card's 92x120) in an 86-wide slot, and the art,
which had been drawn at fixed offsets sized for the old face, scales with it rather than
rattling around inside a bigger card. The hit rect grows with the cell, so the tap target
improved as well.

The price readout hangs BELOW the face, which is what capped the height: at 96 tall its dot
matrix ran off the bottom of the apron, so the face sits at 90 and the readout ends at
y=1365 against an apron that ends at 1366.

Checked in the two configurations that actually constrain it — a short screen (tray at scale
1, 79 units of clearance each side) and a tall one with the worst-case four-card hand (tray
at scale 1.3, 14 units each side) — plus all three cell states at once: affordable, too
expensive, and selected.

## 4ff. The card lesson now has something to slow down

The tutorial's card step ran on an EMPTY table. The player was told cards are one-tap
powers, pointed at SLOW TIME, and tapped it — and nothing happened, because nothing was
moving. The one card everybody owns stayed an abstraction taught by its own caption.

It now demonstrates instead of describing:

- Two or three balls fall down the lesson's safe columns for the whole step, topped up as
  they drain, so there is always something for the card to act on. They are given absurd hit
  points on purpose: a bumper kill mid-demo would empty the table exactly as the player
  reaches for the card.
- The step runs at FULL SPEED. Everywhere else the lesson leans on bullet time, which here
  would mask the very thing the card exists to show.
- Firing it holds the step open for 3.4s with a SLOW MOTION callout, so the effect is
  watched rather than skipped past. Cutting to the next card the instant it is tapped would
  teach the button and hide the result.
- The pointer finds SLOW TIME wherever it sits in the hand rather than assuming slot 0, so
  the lesson still lands for someone replaying it from HOW TO PLAY with a different deck;
  the copy falls back to the generic line if that card is not in the hand at all.
- The lower field stays tappable so the player can flip at the demo balls while they watch.
  Tower taps are deliberately not let through — an upgrade panel here would bury the point.

Measured: balls travel 150.6 units per half-second before the tap and 82.1 after. The step
holds, then hands on to STARS BUY CARDS, and the lesson still ends clean — no leftover demo
balls, slow state cleared, cards back to full.

## 4gg. Megaball is a starter card

The game is named after the Megaball and the card that fires it sat at seven stars, which
for most players is the fourth level. The signature play was the thing a new player saw
last. It is now owned from the first run alongside Slow Time, equipped by default for a
fresh save, and listed first in the deck. The unlock ladder loses its seven-star rung and
is otherwise unchanged: Barrier at two, the second slot at three, Overcharge at five, the
third slot at nine, Magnetise at eleven, Shockwave at twelve. Existing saves keep the deck
they built; the card simply appears as owned.

## 5. Packaging

`node tools/build.js` inlines the readable game modules into `dist/index.html`, copies the
library to `dist/vendor/`, and writes `dist/megaball.zip` (index.html at the root plus
`vendor/three.min.js`). `node tools/verify.js` proves no remote URLs, no network APIs, no
modules, no remote fonts, only `vendor/` subresources, under 35 MB.

## 6. Gallery screenshots

Eight 1800x1200 (3:2) images in `docs/screenshots/`, each under 1.4 MB, built from
real frames of the running game.

**Capture.** The browser pane's own screenshot is 660x1425 with letterboxing baked in, so
the game was driven from JS in a background tab and read off its canvases instead:
`devicePixelRatio` forced to 2.5 on a 640x1386 viewport (1600x3465), one manual
`GAME.update` + `DRAW.frame`, then `#gl` composited over `#game` in the SAME task — the
WebGL buffer is not preserved, a readback one tick later is black. A throwaway Node
server on :5199 wrote the POSTed PNG. Stepping by hand meant every shot could be posed:
a fourteen-tower board, Colossus at 55% health, fourteen enemies bunched before Flash
Freeze, `waveIndex = 19` so the readout says WAVE 20. One trap: balls only exist while
`S.mode === 'wave'` — spawn them in build mode and the update loop culls them before the
next frame, leaving shadows and rings with no ball inside.

**A first pass was thrown out.** Tilted phone frames on generated comic plates, with
insets, wires, speech bubbles, caption slabs and bursts all on one page. The game ended up
a sliver in the corner, everything was dark, and the type (Segoe/Arial) read as a slide
deck. The second pass keeps one rule: the game fills the frame. Six panels are a straight
3:2 crop of the table blown up edge to edge; the two that need the whole phone (hero,
cards) stand it upright at full height on a blurred, zoomed copy of the same frame.

Per image: one Impact headline with an ink stroke and hard shadow, one subline in the
game's own Kenney Pixel face on a black DMD slab, and at most one ring with a label —
positioned from *source-shot* pixels through the crop mapping, not by eye. Speed lines
and Ben-Day dots live only in the outer band so they never sit on the action.

## 7. Trailer

`video/` is a Remotion project (`npm install && npm run render`) that produces
`docs/megaball-trailer.mp4`: 34 seconds, 1920x1080, 30 fps.

**Footage is the real game, frame-accurate.** The trailer's six gameplay sections are JPEG
frame sequences captured off the game's canvases at exactly 30 fps, the same way the
gallery stills were taken but in a loop: `GAME.update(1/30)`, `DRAW.frame`, composite
`#gl` over `#game`, POST the JPEG to a local frame server as `clips/<name>/0000.jpg`. A
hook per clip drives the scene — towers dropping in every eleven frames then START, the
Megaball card fired on frame 30, Flash Freeze on 35, Colossus ignited on 60. Frame N of a
section shows frame N of its clip, so every burst and flash in the edit lands on the exact
frame the game's own effect fires. 840 frames, 289 MB, gitignored.

**Animation.** One `Section` component: the clip stands upright at 1000 px on a blurred,
zoomed copy of itself; the headline slams in from the left on springs; a punch-in zoom
targets the moment (the START button, the ignited ball, the boss); on the SFX frame there
is a white flash, a screen shake that decays over ~7 frames, a Codex-drawn comic starburst
(black background keyed to alpha) popping under Impact lettering, and Codex-drawn radial
speed lines multiplied over the frame for a beat. Intro: the logo slams from 3.6x with a
shake on the Codex title plate; outro: logo + "PLAY FREE IN YOUR BROWSER".

**Music** is a 46-second ElevenLabs `music_v2` cue prompted as driving synthwave with a
rise, a drop at eight seconds and a hard final stab, faded over the last 1.5 s.

Fonts: Impact for the block lettering, the game's Kenney Pixel for sublines. The raw TTF
fails Chrome's OTS check, so the WOFF the game itself ships is loaded through `FontFace`
behind `delayRender`.
