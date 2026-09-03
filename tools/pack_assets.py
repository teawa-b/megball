#!/usr/bin/env python3
"""
MEGABALL asset packer.

Reads the source PNGs in assets/raw/, resizes them to the sizes the game
actually draws at, encodes them to WebP under a per-file byte budget, and
emits src/assets.js -- a plain (non-module) script that exposes window.ART.

The game never reads assets/raw/; it only ever reads src/assets.js.
Run:  python tools/pack_assets.py
"""

import base64
import io
import os
import sys

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "assets", "raw")
OUT_JS = os.path.join(ROOT, "src", "assets.js")

# Max encoded bytes per asset. Backgrounds carry the most detail so they get
# the whole budget; cards are small and land far under it anyway.
BYTE_BUDGET = 90 * 1024
Q_START = 90
Q_FLOOR = 60
Q_STEP = 5

# Draw sizes, keyed by name prefix. Order matters: first match wins.
SIZE_RULES = [
    ("bg_", (720, 1440)),
    ("logo_", (640, 430)),
    ("card_", (320, 320)),
    ("lvl_", (480, 270)),
]
DEFAULT_SIZE = (512, 512)

# Manifest emission order, so the generated file stays stable across runs and
# the integrator sees a predictable key list.
KEY_ORDER = [
    "bg_table",
    "bg_menu",
    "bg_menu_v2",
    "logo_megaball",
    "lvl_1",
    "lvl_2",
    "lvl_3",
    "lvl_4",
    "lvl_5",
    "card_slowtime",
    "card_overcharge",
    "card_megaball",
    "card_barrier",
    "card_magnet",
    "card_shockwave",
]


def target_size(key):
    for prefix, size in SIZE_RULES:
        if key == prefix or key.startswith(prefix):
            return size
    return DEFAULT_SIZE


def encode(img, budget):
    """Encode to WebP, dropping quality until it fits the budget."""
    q = Q_START
    data = None
    while True:
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=q, method=6)
        data = buf.getvalue()
        if len(data) <= budget or q <= Q_FLOOR:
            return data, q
        q -= Q_STEP


def main():
    if not os.path.isdir(RAW_DIR):
        sys.exit("no raw asset dir: %s" % RAW_DIR)

    found = {}
    for name in sorted(os.listdir(RAW_DIR)):
        if not name.lower().endswith(".png"):
            continue
        found[os.path.splitext(name)[0]] = os.path.join(RAW_DIR, name)

    keys = [k for k in KEY_ORDER if k in found]
    keys += [k for k in sorted(found) if k not in KEY_ORDER]
    if not keys:
        sys.exit("no PNGs found in %s" % RAW_DIR)

    entries = []
    total = 0
    for key in keys:
        src = found[key]
        with Image.open(src) as im:
            # Logos retain real transparency; scene art is flattened to RGB.
            im = im.convert("RGBA" if key.startswith("logo_") else "RGB")
            w, h = im.size
            tw, th = target_size(key)
            # Cover-fit: the game draws these at fixed aspect ratios, so crop
            # the overflow rather than letterbox or squash.
            out = ImageOps.fit(im, (tw, th), method=Image.LANCZOS, centering=(0.5, 0.5))
        data, q = encode(out, BYTE_BUDGET)
        total += len(data)
        entries.append((key, base64.b64encode(data).decode("ascii")))
        print(
            "%-16s %5dx%-5d -> %4dx%-4d  q=%-3d %7.1f KB"
            % (key, w, h, tw, th, q, len(data) / 1024.0)
        )

    write_js(entries)
    size = os.path.getsize(OUT_JS)
    print("-" * 58)
    print("webp payload : %.1f KB across %d assets" % (total / 1024.0, len(entries)))
    print("src/assets.js: %d bytes (%.1f KB)" % (size, size / 1024.0))


def write_js(entries):
    lines = []
    lines.append("/* MEGABALL - src/assets.js")
    lines.append(" * GENERATED FILE. Do not edit by hand.")
    lines.append(" * Produced by tools/pack_assets.py from the PNGs in assets/raw/.")
    lines.append(" * Exposes window.ART per CONTRACT.md section 5.3.")
    lines.append(" */")
    lines.append("'use strict';")
    lines.append("(function (global) {")
    lines.append("")
    lines.append("  var PREFIX = 'data:image/webp;base64,';")
    lines.append("")
    lines.append("  var manifest = {")
    for i, (key, b64) in enumerate(entries):
        comma = "," if i < len(entries) - 1 else ""
        lines.append("    %s: PREFIX + '%s'%s" % (key, b64, comma))
    lines.append("  };")
    lines.append("")
    lines.append("  var images = {};")
    lines.append("")
    lines.append("  var ART = {")
    lines.append("    manifest: manifest,")
    lines.append("    ready: false,")
    lines.append("")
    lines.append("    // Decode every entry, then fire the callback exactly once.")
    lines.append("    // A failed decode is recorded as null and must never block boot,")
    lines.append("    // because every image in this game is decoration over procedural art.")
    lines.append("    load: function (onDone) {")
    lines.append("      var keys = Object.keys(manifest);")
    lines.append("      var pending = keys.length;")
    lines.append("      var done = false;")
    lines.append("")
    lines.append("      function finish() {")
    lines.append("        if (done) return;")
    lines.append("        done = true;")
    lines.append("        ART.ready = true;")
    lines.append("        if (typeof onDone === 'function') onDone();")
    lines.append("      }")
    lines.append("")
    lines.append("      if (!pending || typeof Image === 'undefined') { finish(); return; }")
    lines.append("")
    lines.append("      // Safety net: never let a wedged decode strand the loading screen.")
    lines.append("      var guard = setTimeout(finish, 8000);")
    lines.append("")
    lines.append("      function step() {")
    lines.append("        pending--;")
    lines.append("        if (pending <= 0) { clearTimeout(guard); finish(); }")
    lines.append("      }")
    lines.append("")
    lines.append("      keys.forEach(function (k) {")
    lines.append("        var img = new Image();")
    lines.append("        img.onload = function () { images[k] = img; step(); };")
    lines.append("        img.onerror = function () { images[k] = null; step(); };")
    lines.append("        try {")
    lines.append("          img.src = manifest[k];")
    lines.append("        } catch (e) {")
    lines.append("          images[k] = null;")
    lines.append("          step();")
    lines.append("        }")
    lines.append("      });")
    lines.append("    },")
    lines.append("")
    lines.append("    // Null-safe. Callers draw only when this returns something.")
    lines.append("    get: function (key) {")
    lines.append("      var img = images[key];")
    lines.append("      return img && img.width ? img : null;")
    lines.append("    }")
    lines.append("  };")
    lines.append("")
    lines.append("  global.ART = ART;")
    lines.append("")
    lines.append("})(typeof window !== 'undefined' ? window : this);")
    lines.append("")

    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    main()
