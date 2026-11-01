#!/usr/bin/env python3
"""App icon: a pixel-art toadstool on a green background (home screen / PWA icons).

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
    "bg_top": (86, 160, 66), "bg_bot": (52, 112, 44),
    "tuft": (128, 198, 92), "tuft_d": (62, 128, 50), "shadow": (34, 74, 30),
    "line": (27, 20, 32),
    "cap": (216, 50, 60), "cap_hi": (255, 112, 96), "cap_d": (154, 30, 42),
    "spot": (255, 246, 228), "spot_d": (232, 214, 190),
    "gill": (212, 186, 150), "stem": (244, 234, 210), "stem_d": (204, 186, 148),
}


def draw():
    px = [[None] * N for _ in range(N)]
    # Background: soft vertical gradient with a darker rim, plus grass tufts near the bottom.
    for y in range(N):
        k = y / (N - 1)
        base = tuple(round(a + (b - a) * k) for a, b in zip(COL["bg_top"], COL["bg_bot"]))
        for x in range(N):
            px[y][x] = base
    for (x, y) in ((4, 27), (7, 29), (25, 27), (28, 29), (3, 10), (27, 8), (22, 4)):
        px[y][x] = COL["tuft"]; px[y - 1][x] = COL["tuft"]; px[y][x + 1] = COL["tuft_d"]

    shape = [[None] * N for _ in range(N)]

    def ell(cx, cy, rx, ry, col, clip=lambda x, y: True):
        for y in range(N):
            for x in range(N):
                if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1 and clip(x, y):
                    shape[y][x] = col

    # Ground shadow (drawn straight onto the background).
    for y in range(N):
        for x in range(N):
            if ((x + .5 - 16) / 8.5) ** 2 + ((y + .5 - 26.5) / 1.8) ** 2 <= 1:
                px[y][x] = COL["shadow"]
    # Stem, slightly wider at the foot, shaded on the right.
    for y in range(15, 27):
        half = 3.5 + (0.8 if y >= 24 else 0)
        for x in range(N):
            if abs(x + .5 - 16) <= half:
                shape[y][x] = COL["stem_d"] if x + .5 - 16 > half - 1.6 else COL["stem"]
    # Cap: a dome with a darker underside and a highlight.
    ell(16, 14.5, 12.5, 9, COL["cap"], clip=lambda x, y: y <= 15)
    ell(16, 14.5, 12.5, 9, COL["cap_d"], clip=lambda x, y: 13 <= y <= 15 and shape[y][x])
    for x in range(6, 26):
        shape[16][x] = COL["gill"] if abs(x + .5 - 16) < 9.5 else shape[16][x]
    ell(11, 9, 3.2, 2.2, COL["cap_hi"], clip=lambda x, y: shape[y][x] == COL["cap"])
    # Spots.
    for (cx, cy, r) in ((16, 9, 2.3), (9.5, 12.5, 1.6), (22.5, 11.5, 1.9), (20, 6.5, 1.2), (12.5, 6, 1)):
        ell(cx, cy, r, r * .85, COL["spot"], clip=lambda x, y: shape[y][x] is not None and y <= 14)
        bx, by = int(cx + r * .5), int(cy + r * .6)
        if shape[by][bx] == COL["spot"]:
            shape[by][bx] = COL["spot_d"]
    # Face.
    for (x, y) in ((14, 19), (18, 19)):
        shape[y][x] = COL["line"]; shape[y + 1][x] = COL["line"]
    shape[22][15] = shape[22][16] = shape[22][17] = COL["stem_d"]

    # 1px dark outline around the mushroom, then composite.
    for y in range(N):
        for x in range(N):
            if shape[y][x] is None and any(
                    0 <= x + dx < N and 0 <= y + dy < N and shape[y + dy][x + dx] is not None
                    and shape[y + dy][x + dx] != COL["line"]
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
