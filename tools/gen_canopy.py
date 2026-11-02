#!/usr/bin/env python3
"""Canopy textures for the tree-shadow effect.

1. web/img/canopy.png - the tree-shadow asset (design/canopy_source.webp: a black shade layer whose
   alpha holes are sunlight), turned into a seamless pixel-art light mask: scaled so flecks are a few
   art pixels, flecks touching the tile edge removed (so tiles join with no seams). The soft
   light-to-dark falloff is kept at full precision (no quantising). Stored as white with alpha = light.
2. web/img/canopy-region.png - big soft blobs (the earlier dappled-light layout), used at a large
   scale to vary shade depth by region so the fleck pattern never reads as wallpaper.

Original notes for the region layer:
Dappled canopy light: a seamless, soft blob mask for the sunlight overlay.

    python3 tools/gen_canopy.py

Writes web/img/canopy.png (the stand-in canopy mask): a 144x256 greyscale+alpha tile (white = light through the leaves)
that the renderer repeats across the forest in world pixels and sways slowly. Patches are big
(3–5 tiles across, the layout of the reference picture) so creatures feel small under the canopy. The edges wrap, so it tiles with
no seams. Soft edges are quantised into a few steps so it stays in the pixel-art style.
To use your own image instead, save a seamless greyscale PNG over web/img/canopy.png (or set visuals.canopy.image).
"""
import math
import os
import random

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "img", "canopy-region.png")
FLECKS_OUT = os.path.join(ROOT, "web", "img", "canopy.png")
SOURCE = os.path.join(ROOT, "design", "canopy_source.webp")
FLECK_W = 600   # tile width in world pixels for the fleck layer (bigger = fewer, larger patches of light)
STEPS = 6


# The canopy-light picture's layout (traced from the reference image, 1080x1920):
# centre x, centre y, radius x, radius y, tilt (radians).
REF_W, REF_H = 1080, 1920
REF_BLOBS = [
    (330, 310, 190, 145, 0.0), (840, 400, 175, 285, -0.25), (380, 780, 155, 205, 0.3),
    (790, 1040, 135, 135, 0.0), (250, 1330, 270, 175, 0.05),
    (860, 1560, 165, 330, 0.62), (240, 1760, 190, 140, 0.1), (560, 60, 150, 70, 0.0),
]
W, H = 144, 256          # tile size in world pixels (about a phone screen wide at full zoom-out)


def make_flecks():
    src = Image.open(SOURCE).convert("RGBA")
    light = src.split()[3].point(lambda a: 255 - a)              # holes in the shade = sunlight
    w = FLECK_W
    h = round(src.height * w / src.width)
    small = light.resize((w, h), Image.LANCZOS)
    px = small.load()
    # Remove flecks that touch the edge (flood fill from the border) so the tile wraps seamlessly.
    seen, stack = set(), [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or px[x, y] < 12:
            continue
        seen.add((x, y))
        px[x, y] = 0
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    img = Image.new("LA", (w, h), 255)
    img.putalpha(small)                                          # full 0-255 falloff, no steps
    img.save(FLECKS_OUT, optimize=True)
    print("wrote", os.path.relpath(FLECKS_OUT, ROOT), (w, h))


def main():
    make_flecks()
    big = Image.new("L", (W * 3, H * 3), 0)
    px = big.load()
    sx, sy = W / REF_W, H / REF_H
    # Draw each blob in all 9 wrapped copies so the centre tile repeats with no seams.
    for (cx, cy, rx, ry, a) in REF_BLOBS:
        cx, cy, rx, ry = cx * sx, cy * sy, rx * sx, ry * sy
        ca, sa = math.cos(a), math.sin(a)
        r = int(max(rx, ry)) + 2
        for ox in (0, W, 2 * W):
            for oy in (0, H, 2 * H):
                bx, by = cx + ox, cy + oy
                for y in range(int(by - r), int(by + r)):
                    for x in range(int(bx - r), int(bx + r)):
                        if not (0 <= x < 3 * W and 0 <= y < 3 * H):
                            continue
                        dx, dy = x - bx, y - by
                        u, v = (dx * ca + dy * sa) / rx, (-dx * sa + dy * ca) / ry
                        if u * u + v * v <= 1:
                            px[x, y] = 255
    soft = big.filter(ImageFilter.GaussianBlur(7)).crop((W, H, 2 * W, 2 * H))
    # Quantise into a few hard steps (pixel-art banding) and store as white with alpha.
    alpha = soft.point(lambda v: int(round(v / 255 * (STEPS - 1))) * 255 // (STEPS - 1))
    img = Image.new("LA", (W, H), 255)
    img.putalpha(alpha)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, optimize=True)
    print("wrote", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
