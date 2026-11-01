#!/usr/bin/env python3
"""App icon: a plain brown-capped mushroom in a shadowy forest (home screen / PWA icons).

    python3 tools/gen_app_icon.py

Draws a 32x32 pixel image and scales it up with nearest-neighbour, so it stays crisp.
Writes web/icons/apple-touch-icon.png (180), icon-192.png, icon-512.png and
icon-maskable-512.png. The art fills the square (iOS and Android round the corners
themselves) and the mushroom stays inside the central safe zone.
"""
import math
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "icons")
N = 32

COL = {
    "bg_top": (22, 46, 28), "bg_bot": (12, 28, 17), "shade": (8, 20, 12),
    "light": (120, 168, 82), "light_hi": (176, 206, 120),
    "line": (24, 16, 12),
    "cap": (140, 86, 48), "cap_hi": (186, 124, 72), "cap_lo": (96, 56, 30), "cap_rim": (70, 40, 22),
    "gill": (176, 150, 116), "stem": (222, 208, 180), "stem_d": (170, 152, 122),
    "ground": (30, 54, 30), "shadow": (10, 22, 12),
}


def rnd(x, y, salt):
    """Stable per-pixel noise (irregular speckle, the same every run)."""
    h = (x * 374761393 + y * 668265263 + salt * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 4294967296


def canopy_light(n):
    """A few patches of light from the game's canopy texture (web/img/canopy.png), sampled small."""
    path = os.path.join(ROOT, "web", "img", "canopy.png")
    if not os.path.exists(path):
        return [[0] * n for _ in range(n)]
    img = Image.open(path).convert("LA")
    w, h = img.size
    box = (int(w * 0.08), int(h * 0.18), int(w * 0.08) + int(h * 0.42), int(h * 0.18) + int(h * 0.42))
    small = img.crop(box).resize((n, n), Image.BILINEAR).split()[1]
    return [[small.getpixel((x, y)) / 255 for x in range(n)] for y in range(n)]


def draw():
    """A plain brown-capped mushroom (no face, no spots) on a dark forest floor under the canopy."""
    px = [[None] * N for _ in range(N)]
    light = canopy_light(N)
    for y in range(N):
        k = y / (N - 1)
        base = tuple(round(a + (b - a) * k) for a, b in zip(COL["bg_top"], COL["bg_bot"]))
        for x in range(N):
            L = light[y][x]
            # Stepped (pixel-art) shafts of light; most of the icon stays in deep shade.
            col = COL["light_hi"] if L > 0.62 else COL["light"] if L > 0.3 else base
            if L <= 0.3 and rnd(x, y, 1) < 0.12:
                col = COL["shade"]
            px[y][x] = col
    # Forest floor the mushroom stands on, and its shadow.
    for y in range(24, N):
        for x in range(N):
            if px[y][x] == COL["bg_bot"] or px[y][x] not in (COL["light"], COL["light_hi"]):
                px[y][x] = COL["shadow"] if rnd(x, y, 2) < 0.22 else COL["ground"]
    for x in range(9, 24):
        px[26][x] = COL["shadow"]
        if 10 < x < 22:
            px[27][x] = COL["shadow"]

    shape = [[None] * N for _ in range(N)]

    def ell(cx, cy, rx, ry, col, clip=lambda x, y: True):
        for y in range(N):
            for x in range(N):
                if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1 and clip(x, y):
                    shape[y][x] = col

    # Stem: natural, slightly curved and widening at the base, shaded on the right.
    for y in range(15, 27):
        half = 2.6 + (y - 15) * 0.09 + (0.6 if y >= 25 else 0)
        cx = 16 + (0.6 if y < 19 else 0)
        for x in range(N):
            if abs(x + .5 - cx) <= half:
                shape[y][x] = COL["stem_d"] if x + .5 - cx > half - 1.4 else COL["stem"]
    # Cap: a rounded brown dome, lit from the top-left, darker toward the rim.
    ell(16, 14.5, 10.5, 8.2, COL["cap"], clip=lambda x, y: y <= 15)
    ell(16, 14.5, 10.5, 8.2, COL["cap_lo"], clip=lambda x, y: 12 <= y <= 15 and shape[y][x] == COL["cap"])
    ell(12.2, 9.2, 4.2, 2.6, COL["cap_hi"], clip=lambda x, y: shape[y][x] == COL["cap"])
    shape[8][11] = (214, 158, 98)
    for x in range(7, 26):
        if shape[15][x]:
            shape[15][x] = COL["cap_rim"]
        if abs(x + .5 - 16) < 8:
            shape[16][x] = COL["gill"]

    for y in range(N):
        for x in range(N):
            if shape[y][x] is None and any(
                    0 <= x + dx < N and 0 <= y + dy < N and shape[y + dy][x + dx] is not None
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[y][x] = COL["line"]
            elif shape[y][x] is not None:
                px[y][x] = shape[y][x]
    img = Image.new("RGB", (N, N))
    img.putdata([c for row in px for c in row])
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    art = draw()
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512)):
        # Nearest-neighbour to fill the square exactly (sizes that aren't a multiple of 32 vary by a pixel).
        art.resize((size, size), Image.NEAREST).save(os.path.join(OUT, name), optimize=True)
    print("wrote app icons to", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
