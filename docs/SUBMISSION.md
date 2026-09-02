# MEGABALL — submission compliance checklist

Maps every hard constraint from `docs/CONTRACT.md` §1 (and the plan's §29 restatement of
the competition rules) to the evidence that it is met.

**Artifact under test:** `dist/index.html`, produced by `node tools/build.js`, shipped as
`dist/megaball.zip`. Sizes below are from the build made while writing this file;
`tools/build.js` reprints them on every run, so re-run it after any source change.

Regenerate the evidence with:

```
node tools/build.js
node tools/verify.js
```

---

## Constraint → evidence

| # | Constraint (CONTRACT.md §1) | Evidence | Status |
|---|---|---|---|
| 1 | Single player | No multiplayer, netcode or matchmaking exists; verify.js check 2 proves there is no WebSocket, EventSource, XHR or fetch anywhere in the shipped file | MET |
| 2 | Fixed portrait orientation | Canvas is a fixed 720 × 1440 (1:2) virtual resolution letterboxed by `DRAW.resize`; `index.html` pins the viewport (`user-scalable=no`) and shows a "rotate your device" overlay in landscape under 520px tall | MET |
| 3 | Fully offline — zero network requests at runtime | verify.js checks 1 and 2 (no `http(s)://`, no `fetch`/`XHR`/`WebSocket`/`EventSource`/`importScripts`/`sendBeacon`/service worker/Worker). Confirmed dynamically: a real Chrome loading `dist/index.html` from `file://` issued **1 `file:` request (the document itself) and 9 `data:` requests, and zero `http`/`https`/`ws` requests** | MET — statically and dynamically |
| 4 | No CDNs, remote fonts or remote images | verify.js checks 1, 4 and 5. Typography is the system stack only (`'Segoe UI', system-ui, …`); no `@font-face`, no `fonts.googleapis.com`. The 9 images are base64 WebP data URIs inside the document | MET |
| 5 | Ships as a `.zip` under 35 MB | `dist/megaball.zip` is **271,544 bytes (0.26 MB)** — 34.74 MB of headroom. Printed by build.js on every run | MET |
| 6 | Readable root-level `index.html` inside the zip | The zip has exactly one entry, `index.html`, at the archive root. build.js proves this two ways: it reads its own archive back through the central directory (CRC + byte compare) and the archive was additionally opened with Windows `Expand-Archive`, whose extracted file matches `dist/index.html` by SHA-256. **The build does not minify** — modules are spliced in verbatim with their comment banners and a `<!-- src/… -->` marker each | MET |
| 7 | Runs from `file://` as well as `http://` | Booted from `file:///…/dist/index.html` in Chrome: title screen rendered, all 12 globals defined, `ART.ready === true`, boot splash dismissed, `GAME.state.mode === 'menu'`, ~60 fps (122 rAF frames in 2 s), **zero console errors, zero warnings, zero uncaught exceptions**. A full click-through then reached gameplay: level select → build phase (5 lives, 135 Energy) → `Space` → `mode === 'wave'` with balls in play, still with zero errors and zero remote requests. `http://` was already the day-to-day playtest path via `tools/serve.js` on port 5173 | MET — executed, see below |
| 8 | No ES modules / no `import` | verify.js check 3 (no `import`/`export` statements, no dynamic `import(`, no `type="module"`). This is exactly what makes constraint 7 possible | MET |
| 9 | Playable as a complete session | 5 levels with scripted waves ending in a boss, an Energy economy, star ratings and a star-gated unlock track. Reached live gameplay in the `file://` run above; the full 5-level playthrough is the author's own playtesting, not something these tools measure | MET (tool-verified up to first wave; full run is manual) |
| 10 | Targets mobile web, 60 fps on a mid-range phone | Input is pointer-events with multi-touch flippers, `touch-action: none`, no scroll; FX is object-pooled with a hard particle cap; physics substeps are sized to the fastest ball. **Not measured on real mid-range hardware.** The only frame-rate number anywhere in this repo is 122 rAF callbacks in 2 s in headless desktop Chrome, which says the loop runs — it is not a phone benchmark | **UNVERIFIED — needs a device test** |

---

## What `tools/verify.js` checks

Run against `dist/index.html`; exits non-zero on any failure.

1. **No `http://` / `https://` URLs.** `data:` URIs are fine. `http://www.w3.org/…` XML
   namespace strings are exempt — browsers never fetch them. Reports line and context.
2. **No networking APIs:** `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `importScripts`, `sendBeacon`, `navigator.serviceWorker`, `new Worker(`.
3. **No ES-module syntax:** `import`/`export` statements, dynamic `import(`,
   `type="module"`.
4. **No remote fonts:** `@font-face` with a non-`data:` URL, `fonts.googleapis.com`,
   `fonts.gstatic.com`.
5. **Self-contained document:** no surviving `<script src=`, no stylesheet `<link>`, no
   `<link href=`/`<img src=`/`<audio|video|source|iframe|embed|object>` pointing anywhere
   but `data:`, no CSS `@import`.
6. **Under the 35 MB cap.**
7. **Informational:** count and total size of embedded `data:` URIs and base64 payload
   literals, so the asset budget stays visible. (`src/assets.js` builds its URIs as
   `PREFIX + '<base64>'`, so both are reported — counting literal `data:` strings alone
   would undercount by ~248 KB.)

The checker was negative-tested against a deliberately non-compliant fixture containing a
Google Fonts link, a remote `@font-face`, an external stylesheet, an external script, a
`type="module"` block with `import`/`export`, a remote `<img>`, and `fetch`/`WebSocket`/
`XMLHttpRequest`/`sendBeacon` calls: it failed 5 of 6 checks and exited 1, while correctly
ignoring a legitimate `data:` image. It is not a checker that passes everything.

---

## What was NOT verified

Stated plainly so nobody reads more into this document than it earns:

- **60 fps on a mid-range phone.** Never measured. Desktop headless Chrome is not a proxy.
- **Real touch input on a real device.** Multi-touch flippers were exercised through
  synthesised CDP mouse and key events, not fingers on glass.
- **Audio output.** The `file://` run was muted (`--mute-audio`) and the Web Audio context
  only unlocks on a user gesture, so no sound was actually heard by these tools. The audio
  path threw no errors during boot or gameplay, which is weaker than "it sounds right".
- **A complete 5-level playthrough to a win state.** The automated run reached wave 1 of
  level 1 and stopped there.
- **Browsers other than Chrome.** Only Chrome (headless, Windows) was driven.

---

## Package contents

`dist/megaball.zip` contains exactly one file:

```
index.html      535,361 bytes   (0.51 MB uncompressed)
```

12 source modules inlined in load order — `util`, `assets`, `audio`, `fx`, `physics`,
`board`, `entities`, `cards`, `levels`, `render`, `ui`, `game` — plus the page's own boot
and input script.

`assets/raw/` (16 MB of source PNGs) is **not** in the package and is git-ignored. The
shipped art is the 9 compressed WebP data URIs already embedded in `src/assets.js`.
