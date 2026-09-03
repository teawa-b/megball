# MEGABALL

A tower defense game played on a vertical pinball table: enemy balls pour down from the
top, and you spend Energy building automatic paddles and bumpers to stop them, saving
whatever gets through with two manual flippers. The signature move is igniting an enemy
ball — a Power Paddle or a card flips it into a friendly projectile that chain-destroys
the rest of the swarm.

Built for the Meta Horizon Creator Competition, **Tower Defense & Strategy**.

---

## Run it

Open `index.html` in a browser. That's the whole procedure.

No build step, no server, no install, no network. It works from `file://` and from
`http://` alike. The submission zip contains a single self-contained `index.html`
at its root.

---

## How to play

**Touch**

| Action | Input |
|---|---|
| Flip | Hold anywhere on the left half of the table for the left flipper, right half for the right |
| Build | Tap **PADDLE** (55) or **BUMPER** (40) in the tray, then tap a build slot on the field |
| Upgrade / sell | Tap a placed tower to open its panel; tap away to close |
| Fire a card | Tap the card in the tray |
| Start the next wave early | Tap the **START** banner during the build phase |
| Pick a level | Play → spin the globe, tap the **World 1** pin → tap a numbered tile in the 3 × 3 grid |

The entire field from the spawn zone down to the drain is the flipper surface — there
are no small flipper buttons. Only the card tray at the bottom consumes taps as UI.

**Keyboard**

| Key | Action |
|---|---|
| `←` / `A` / `Z` | Left flipper |
| `→` / `D` / `/` | Right flipper |
| `1` – `4` | Fire card in slot 1–4 |
| `Space` | Start the wave early (during build) |
| `Esc` | Pause |

---

## Tower Defense & Strategy fit

| Genre pillar | In MEGABALL |
|---|---|
| Placeable defenses | Auto Paddle (55) and Bumper (40) drop into fixed build slots across the field |
| Upgrade paths | Paddle → Frost or Power; Bumper → Blast, Shock or Launch. Branching, not linear |
| Selling / repositioning | Any tower sells back at 55% of its cost, so a bad read is recoverable |
| Unit variety | Drone, Runner, Hauler, Bulwark, Divider (splits into Shards) and the Colossus boss, each read by silhouette and glyph |
| Escalating waves | Scripted wave timelines per level with formations and lane choices, ending in a boss |
| In-level economy | Energy is earned per kill, per wave clear and as a chain bonus, and is the only build currency |
| Spend-vs-upgrade tension | Energy is tight, so every wave is a choice between a new tower, a tier-2 upgrade, and banking |
| Active abilities | A card loadout plus one always-available level card on cooldown |
| Win / lose states | 5 lives; a leak costs 1 (Hauler 2, Colossus 3). Clear every wave to win, hit 0 lives to lose |
| Session progression | 5 levels; each awards three independent stars — clear the level, stay inside its leak budget, and complete a level-specific challenge (build a Frost Paddle, land a 4-chain, hold the board to eight defenses) — feeding a star-gated unlock track for new cards and extra card slots |

The physics is what makes it a strategy game rather than a lane-defense game: a bumper
does not just deal damage, it *redirects*, so tower placement is about shaping where balls
travel, not only where they die.

---

## Architecture

Vanilla JavaScript, no build step and no modules — plain `<script>` tags and one global per
file, in load order, so the game runs from `file://` where ES module loading is blocked. The
one library is **three.js** (r185, MIT), shipped as a plain-script global in `vendor/` and
never embedded in the page, exactly as the competition rules ask.

Rendering is two stacked canvases sharing one fixed **720 × 1440** virtual resolution that is
uniformly scaled and letterboxed onto whatever the device has, so all gameplay math is
resolution-independent:

- **WebGL layer (`src/scene3d.js`)** — the physical machine. Table slab and frame, rails,
  pegs, slingshots, spawn gates, drain LED, mounting slots, every tower and both flippers are
  real lit 3D geometry (all procedural: extruded capsules, cylinders, generated canvas
  textures; no model files). The camera looks straight down the table axis, so a point on the
  table surface lands on exactly the same pixel the 2D layer draws it at.
- **2D layer (`src/render.js`)** — transparent, on top. Enemy balls (deliberately flat: a white
  disc with a thick black outline is the most readable thing on a phone), particles, build
  highlights, HUD and card tray. If WebGL is unavailable the 2D layer paints the whole table
  itself, exactly as it did before the 3D layer existed. **All audio is synthesised at runtime with
the Web Audio API** — oscillators, noise buffers, filters and envelopes. There are no
audio files. The only binary assets are 13 WebP images (backgrounds, level thumbnails, card art),
embedded as base64 data URIs.

| File | Global | Responsibility |
|---|---|---|
| `src/util.js` | `U` | Virtual-resolution constants, vertical band layout, math and easing, seeded RNG, local save/load |
| `src/assets.js` | `ART` | Generated. Base64 WebP data URIs plus a null-safe loader; a failed decode never blocks boot |
| `src/audio.js` | `SFX` | Fully procedural Web Audio — every sound effect and music track is built from oscillators and noise |
| `src/fx.js` | `FX` | Juice layer: pooled particles, shockwaves, combat text, screen shake, hitstop, slow motion |
| `src/physics.js` | `PHYS` | Deterministic 2D pinball solver; walls, posts, flippers and paddles are all capsules or circles |
| `src/board.js` | `BOARD` | Per-level table geometry: walls, lanes, posts, build slots, flipper mounts, drain |
| `src/entities.js` | `ENT` | Enemy ball and tower definitions, factories, costs, upgrade trees and per-entity behaviour |
| `src/cards.js` | `CARDS` | Player and level card definitions plus their runtime effects and cooldowns |
| `src/levels.js` | `LEVELS` | Level data, wave scripts and formations, per-level objectives and star scoring, the unlock table |
| `src/vendor/three.min.js` | `THREE` | three.js r185, unmodified vendor bundle (ships as `vendor/three.min.js`) |
| `src/scene3d.js` | `SCENE3D` | The WebGL machine: procedural table, rails, towers and flippers, lighting, shake pivot |
| `src/globe.js` | `GLOBE` | The world picker: a drag-to-rotate neon globe with world pins, mounted inside the menu overlay |
| `src/render.js` | `DRAW` | All canvas drawing, letterbox scaling, and hit-testing for the on-canvas HUD and card tray |
| `src/ui.js` | `UI` | DOM overlay screens: title, level select, deck builder, pause, results |
| `src/game.js` | `GAME` | State machine, economy, wave director, collision resolution, input routing, the update loop |

`index.html` owns the canvas, the boot splash, input binding and the frame loop. The
canvas owns everything that happens on the table; the DOM owns everything between rounds.

---

## Build

```
node tools/build.js     # inlines src/*.js into dist/index.html, copies vendor/, writes dist/megaball.zip
node tools/verify.js    # offline-compliance checks against dist/index.html
```

`build.js` deliberately does not minify — the submission is meant to be read. It splices
each game module into the page verbatim, in load order, keeping the original comment
banners and a marker showing which source file each block came from. Third-party code is
handled the way the rules require: `src/vendor/three.min.js` is copied to
`dist/vendor/three.min.js` and referenced by relative path, never inlined. The zip
therefore holds `index.html` at its root plus `vendor/three.min.js`. Both scripts are Node
stdlib only (the zip writer included).

`tools/serve.js` starts a local static server on port 5173 for playtesting. The shipped
game does not need it.
