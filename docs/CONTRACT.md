# MEGABALL — Shared Technical Contract

> **Read this before writing any code.** Every module in this project is written against
> the contract below. Do not change any public API described here without saying so
> explicitly in your final report.

---

## 1. Project identity

**MEGABALL** — a tower-defense game played on a vertical pinball table.
Enemy balls fall from the top; the player builds automatic paddles and bumpers to stop
them, saves shots with two manual flippers, and plays **cards** for active powers.
The signature moment is turning a struck enemy ball into a temporary weapon that
smashes through the swarm for a chain reaction.

Submission target: Meta Horizon Creator Competition — **Tower Defense & Strategy**.

### Hard technical constraints (non-negotiable)

- Single player, **fixed portrait orientation**.
- **Fully offline.** Zero network requests at runtime. No CDNs, no remote fonts,
  no remote images, no `fetch()` to anything but same-origin local files.
- Ships as a `.zip` under **35 MB** with a readable root-level `index.html`.
- Must run from `file://` as well as `http://`. **No ES modules / no `import`** —
  `file://` blocks module loading. Use plain `<script>` tags and globals.
- Third-party libraries (three.js) live in a `vendor/` folder next to `index.html`,
  referenced by relative path, and are never embedded in the page (competition rule).
- Targets mobile web. Must hold **60 fps on a mid-range phone**.

---

## 2. Coordinate system & layout (portrait is everything)

The game renders into one `<canvas>` using a **fixed virtual resolution**:

```
VW = 720     // virtual width
VH = 1440    // virtual height  (1:2 portrait)
```

All gameplay math, positions, radii and speeds are in **virtual units**. The renderer scales
the board **uniformly** (`scale = min(cssW / VW, cssH / (VH - VIEW_TOP))`) — it is never
stretched, so a ball is a circle on every device. A tall phone is width-limited and the spare
height becomes cabinet rather than bars: the HUD rises into the head panel above the table
(up to `U.UI.headMax` units) and the rest goes to the card tray, which scales its contents up
(to `U.UI.trayScaleMax`). Short viewports, tablets and desktop are height-limited and get slim
side bars with the full board. `DRAW.vp` carries `viewTop / viewBottom / hudShift / trayShift`
for any module that needs to know what is on screen; the WebGL layer opens its frustum to the
same band. Never write gameplay layout in CSS pixels — always virtual units.

### Vertical budget

| Band              | y range     | Contents                                                        |
|-------------------|-------------|-----------------------------------------------------------------|
| HUD overlay       | `0 – 104`   | Lives, Energy, Wave. Drawn *over* the table, translucent.        |
| Spawn zone        | `104 – 190` | Enemy gates. Telegraph markers appear here.                      |
| Build field       | `190 – 1030`| Towers, bumpers, obstacles. The strategic space.                 |
| Flipper deck      | `1030 – 1200`| Two manual flippers + the ramps that feed them.                  |
| Drain             | `1200 – 1240`| The exit the player is defending.                               |
| Card tray         | `1240 – 1440`| Cards, build buttons, energy readout.                           |

The table's left/right walls sit at `x = 40` and `x = 680` (a 40u bezel each side).
Playfield interior is therefore `640` units wide.

**Touch input note:** the whole area from `y = 190` to `y = 1240` is the flipper control
surface. Left half → left flipper, right half → right flipper. There are no small
buttons for flippers. The card tray below `y = 1240` is the only region that
consumes taps for UI. Build-mode placement temporarily takes over the field and is
entered only from the tray.

---

## 3. Locked art direction

**Style:** futuristic toy pinball machine. Flat vector shapes, crisp neon edges,
heavy black outlines, no photorealism, no gradients-for-the-sake-of-it. The background
is always quieter than the gameplay pieces.

### Palette — use these exact tokens

```js
const C = {
  void:      '#05060d',  // outside the table
  table:     '#0a0e1a',  // playfield ink
  panel:     '#0b0f1c',  // UI panels
  line:      '#1c2740',  // structural lines, inactive edges
  steel:     '#2c3a5c',  // walls, posts

  cyan:      '#3fe0ff',  // PLAYER. towers, flippers, energy flow
  cyanDeep:  '#0a7ea4',
  frost:     '#8fe8ff',  // slow / frost status
  violet:    '#8b5cff',  // shock / chain
  magenta:   '#ff2e88',  // DANGER. drain, life loss, boss
  amber:     '#ffb020',  // ENERGY currency
  power:     '#ffd24a',  // empowered ball core
  powerHot:  '#ff7a1a',  // empowered ball edge
  green:     '#4ade80',  // success, wave clear
  white:     '#ffffff',
  ink:       '#000000',  // outlines
};
```

### Enemy balls — the single most important visual rule

> **Every enemy ball is a solid WHITE circle with a THICK BLACK OUTLINE.**

- Fill: `#ffffff`. Outline: `#000000`, roughly **one third of the radius** — thick
  enough to be unmistakable, but not so thick on the small ones that it swallows
  the white core (a flat 5 units did exactly that to the Runner in testing).
- This is what makes the board readable when 10 balls are flying. Never tint the
  white fill for enemy type. Never make an enemy ball dark.
- Type is read from **silhouette (size)** + **a black glyph inside the white** +
  an optional thin coloured status ring *outside* the black outline.

| Enemy    | Name     | Radius | Outline | Inner glyph (black on white)      |
|----------|----------|--------|---------|-----------------------------------|
| basic    | Drone    | 17     | 6       | none                              |
| fast     | Runner   | 14     | 4.5     | two slanted speed slashes         |
| heavy    | Hauler   | 26     | 9       | thick concentric ring             |
| armored  | Bulwark  | 19     | 6.5     | hexagonal plate segments          |
| splitter | Divider  | 20     | 6.5     | dashed split line down the middle |
| shard    | Shard    | 13     | 4       | two slanted speed slashes         |
| boss     | Colossus | 46     | 13      | crown of thick spokes             |

Balls also get a **contact shadow** (a dark radial disc under them), a **motion
smear** above ~300 u/s and a mild **velocity stretch** — all three exist purely to
make a white circle read as a fast physical object rather than a flat sprite.

**Status effects are added as rings/overlays around the ball, never as a fill change:**
- *Slowed* → `frost` ring + frost crystals + slower trail.
- *Empowered* → `power`→`powerHot` corona, sparks, thick fiery trail. This is the only
  time a ball may glow hot.
- *Damaged* → black crack lines drawn on the white fill (more cracks = closer to death).

Player-owned objects (flippers, paddles, bumpers) are **cyan-family neon on dark**, which
keeps friend/foe instantly separable from the white enemy balls.

### Typography

Two faces. Display type (menu headings, buttons, readouts, captions on the canvas, combat text,
tutorial titles) is one shipped typeface, "Ken Pixel" (Kenney Pixel, CC0), embedded as a `data:`
URI in `src/fonts.js` so the built document still has no font subresource; any further font must be
embedded the same way (see `tools/verify.js`). Body copy (paragraphs, card blurbs, objective text)
stays on the system stack (offline): `'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial,
sans-serif`. Menus and the HUD share one hardware language: dot-matrix displays, insert lamps,
cabinet buttons, scorecard rows, dark plates on a dot grid, glass scanlines.
Numbers in HUD are heavy weight, tabular, uppercase labels with wide letter-spacing.

---

## 4. Module map & load order

`index.html` loads plain scripts in this order. Each file attaches ONE global.

```
src/util.js      → global  U        math, easing, seeded RNG, pooling helpers
src/assets.js    → global  ART      base64 image data + loader   (generated)
src/audio.js     → global  SFX      procedural WebAudio
src/fx.js        → global  FX       particles, juice, camera shake, hitstop
src/physics.js   → global  PHYS     collision primitives
src/board.js     → global  BOARD    table geometry per level
src/entities.js  → global  ENT      balls, towers, bumpers
src/cards.js     → global  CARDS    card definitions + runtime
src/levels.js    → global  LEVELS   wave + level data
src/vendor/three.min.js → THREE     three.js (vendor; ships in vendor/, not inlined)
src/scene3d.js   → global  SCENE3D  WebGL machine: table, rails, towers, flippers
src/globe.js     → global  GLOBE    world-picker globe (own renderer, mounted by UI)
src/render.js    → global  DRAW     2D layer: balls, FX, HUD, tray (+ 2D fallback table)
src/ui.js        → global  UI       DOM overlay screens
src/game.js      → global  GAME     state machine, loop, economy
```

No file may reference a global defined *later* in the list at load time (only inside
functions called after boot).

---

## 5. Public APIs you must implement exactly

### 5.1 `FX` — juice engine (`src/fx.js`)

```js
FX.reset()                       // clear all live effects
FX.update(dtReal)                // dtReal = unscaled seconds since last frame
FX.timeScale()                   // → number. 0 during hitstop; <1 during slowmo; else 1
FX.hitstop(seconds)              // freeze gameplay (additive, takes the max)
FX.slowmo(scale, seconds)        // e.g. FX.slowmo(0.25, 0.35)
FX.shake(magnitude, seconds)     // magnitude in virtual units, additive
FX.camera()                      // → {x, y, rot} current shake offset for this frame

FX.drawBelow(ctx)                // decals, shockwave rings, ground glow  (under entities)
FX.drawAbove(ctx)                // sparks, debris, flashes, floating text (over entities)

// emitters — all coords in virtual units
FX.spark(x, y, o)      // o: {count,color,speed,spread,dir,size,life,gravity,drag,glow}
FX.burst(x, y, o)      // o: {count,color,color2,power,life,size}   radial explosion puff
FX.ring(x, y, o)       // o: {r0,r1,color,life,width,fade}          expanding stroke ring
FX.shard(x, y, o)      // o: {count,color,speed,life,size}          spinning triangle debris
FX.text(x, y, str, o)  // o: {color,size,life,rise,pop,outline}     floating combat text
FX.flash(o)            // o: {color,alpha,life}                     full-screen flash
FX.trail(key, x, y, o) // o: {color,width,life,glow}  ribbon sample for a moving object
FX.dropTrail(key)      // release a trail when its owner dies
```

Requirements:
- **Object-pooled.** Zero allocation in the steady state. Hard cap ~900 particles;
  when full, recycle the oldest.
- Particles are short-lived (most < 0.6 s) so they never hide the ball, the flippers
  or the drain. This is a stated design rule.
- `drawBelow`/`drawAbove` must not leave the canvas context dirty (save/restore).
- Additive glow via `ctx.globalCompositeOperation = 'lighter'` is encouraged, but batch
  it — do not flip composite mode per particle.

### 5.2 `SFX` — audio (`src/audio.js`)

```js
SFX.init()                 // build AudioContext; MUST be safe to call repeatedly;
                           // call from a user gesture
SFX.ready                  // boolean
SFX.play(name, o)          // o: {vol=1, rate=1, pan=0}   pan -1..1
SFX.music(name|null)       // 'menu' | 'battle' | 'boss' | null — crossfades
SFX.setMuted(bool)
SFX.isMuted()
SFX.lowpass(t)             // 0 = open, 1 = heavily filtered (used during slowmo)
SFX.duck(amount, seconds)  // temporarily lower music for a big moment
```

**100% procedural — no audio files.** Oscillators, noise buffers, filters, envelopes.

Required sound names:
```
ui_tap ui_back ui_error
flipper_up flipper_down
paddle_hit frost_hit power_hit launch_hit
bumper bumper_blast bumper_shock
ball_hit_ball armor_crack split
enemy_hurt enemy_die enemy_die_big
energy_pickup place upgrade sell
card_ready card_use slowmo_in slowmo_out
wave_start wave_clear life_lost warn
chain1 chain2 chain3 chain4 chain5   // rising pitch ladder
boss_spawn boss_hurt boss_die
win lose star
```

### 5.3 `ART` — images (`src/assets.js`, generated by the asset pass)

```js
ART.manifest              // { key: 'data:image/webp;base64,...' , ... }
ART.load(onDone)          // decodes everything into HTMLImageElement, then calls onDone
ART.get(key)              // → HTMLImageElement | null   (null-safe; game must not crash)
ART.ready                 // boolean
```

The game **must degrade gracefully** if an image is missing — every image is decoration
layered on top of procedural drawing, never load-bearing.

### 5.4 `UI` — DOM overlay (`src/ui.js`)

The canvas owns gameplay. The DOM owns menus, results and modals.

```js
UI.init(hooks)   // hooks: { onStartLevel(id) }
UI.showScreen(name, data)   // 'title' | 'world' | 'levelSelect' | 'loadout' | 'results' | 'paused' | null
UI.current()                // → the open screen name, or null
UI.isOpen()                 // → boolean
```

Only `onStartLevel` is injected. Starting a level is the one action the host
page owns, because it has to close the overlay and hand the loadout across.
Everything else the menus do — retry, next level, quit, pause/resume, editing
the deck, muting — is a direct call into `GAME` or `SFX`, which keeps the
indirection proportional to the actual coupling.

In-game hints are drawn on the canvas by `DRAW` (see `GAME.toast`), not in the
DOM, so that they scale and shake with the board.

---

## 6. Game systems reference (for anyone touching gameplay)

- **Lives:** 5. A leaked ball costs 1 (heavy 2, boss 3). 0 = level lost.
- **Energy:** earned per kill, per wave clear, and as a chain bonus. Spent on placing
  and upgrading defenses. This is the tower-defense economy — it must always be visible.
- **Towers:** Auto Paddle, Standard Bumper. Upgrades specialise them into
  Frost Paddle / Power Paddle, Blast Bumper / Shock Bumper / Launch Bumper.
- **Empowered balls (signature):** a Power Paddle/Card hit flips an *enemy* ball into a
  friendly projectile for a few seconds. It damages other enemies on contact and builds
  `CHAIN x2 … MEGA HIT` feedback with escalating juice.
- **Cards:** player card slots (start with 1, unlock more) + one always-available
  level card on a cooldown.

---

## 7. Code style

- Vanilla ES2019 (no modules, no optional chaining in hot loops is fine but keep it simple).
- `'use strict';` at the top of each file, wrapped in an IIFE that assigns the global.
- Comment the *why*, not the *what*. Judges read this code — keep it clean and readable.
- No dependencies. No build step required for the game to run.
