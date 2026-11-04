#!/usr/bin/env python3
"""Top-down 16x16 ground tiles (grass = plain soil, the treeline floor) and the shrub treeline (run via
gen_placeholders.py). Ground tiles are 16x16 squares anchored at their centre; shrubs
are anchored at their base.
"""
import json
import os
import random
import zlib

from gen_placeholders import Canvas, write, OUT, GROUND_PALETTE, P

T = 16  # tile size in art pixels


def rng_for(sid, salt=0):
    return random.Random(zlib.crc32(sid.encode()) + salt)


def tile(sid, base, specks, extra=None, frames=1, durations=None):
    out = []
    for f in range(frames):
        rng = rng_for(sid)
        c = Canvas(T, T)
        for y in range(T):
            for x in range(T):
                c.px[y][x] = P[base]
                for name, prob in specks:
                    if rng.random() < prob:
                        c.px[y][x] = P[name]
        if extra:
            extra(c, rng_for(sid, 7 + f * 13), f)
        out.append(c)
    write(sid, (T, T), out, palette_ref="pal.ground", anchor=(8, 8), tags=["tile"], durations=durations)


def tufts(colors, n):
    def fn(c, rng, f):
        for _ in range(n):
            x, y = rng.randint(0, 14), rng.randint(1, 15)
            col = P[rng.choice(colors)]
            c.set(x, y, col)
            c.set(x + 1, y - 1, col)
    return fn


def blob(c, cx, cy, rx, ry, col, edge=None):
    if edge is not None:
        c.ellipse(cx + .5, cy + .5, rx + .7, ry + .7, edge)
    c.ellipse(cx + .5, cy + .5, rx, ry, col)


# ------------------------------------------------------------------ ground

def make_ground():
    for i, sid in enumerate(("tile.grass.a", "tile.grass.b", "tile.grass.c")):
        tile(sid, "grass", [("grass_d", .07), ("grass_l", .05), ("grass_ll", .01)],
             extra=tufts(("grass_l", "grass_d", "grass_ll"), 3 + i))
    # Treeline floor: its own very dark palette (the ground palette is full).
    edge_pal = ["transparent", "#0d1f0f", "#123016", "#081509", "#1a3c1c"]
    for sid in ("tile.edge.a", "tile.edge.b"):
        rng = rng_for(sid)
        c = Canvas(T, T)
        for y in range(T):
            for x in range(T):
                r = rng.random()
                c.px[y][x] = 2 if r < .15 else 3 if r < .3 else 4 if r < .34 else 1
        write(sid, (T, T), [c], palette=edge_pal, anchor=(8, 8), tags=["tile"])




# ------------------------------------------------------------------ shrub treeline

# Deep, shadowed forest greens so the treeline reads as a clear dark border around the clearing.
SHRUB_PALETTES = [
    ["transparent", "#060d06", "#14301a", "#1d4022", "#0c2010", "#2a5a2c", "#8a3a48"],
    ["transparent", "#050c06", "#12291a", "#1a3a22", "#0a1c10", "#255030", "#9a9a88"],
    ["transparent", "#060d05", "#173218", "#21461f", "#0e2410", "#2f612a", "#a08a30"],
]

def make_shrubs():
    for i, palette in enumerate(SHRUB_PALETTES):
        for v in range(2):
            sid = "deco.shrub.%s" % "abcdef"[i * 2 + v]
            rng = rng_for(sid)
            c = Canvas(24, 22)
            # A cluster of overlapping leafy balls.
            balls = [(12, 12, 9, 8), (6 + rng.randint(-1, 1), 13, 5.5, 5), (18 + rng.randint(-1, 1), 13, 5.5, 5),
                     (12 + rng.randint(-2, 2), 7, 6, 5)]
            for (x, y, rx, ry) in balls:
                c.ellipse(x, y, rx, ry, 2)
            for (x, y, rx, ry) in balls:
                c.ellipse(x - rx * .25, y - ry * .3, rx * .55, ry * .45, 3)
                c.set(int(x - rx * .4), int(y - ry * .5), 5)
            c.rect(3, 18, 21, 19, 4)
            for _ in range(10):
                x, y = rng.randint(3, 20), rng.randint(4, 17)
                if c.get(x, y) in (2, 3):
                    c.set(x, y, 4 if rng.random() < .6 else 5)
            if v == 1:  # berries / blossoms on some bushes
                for _ in range(4):
                    x, y = rng.randint(5, 18), rng.randint(5, 15)
                    if c.get(x, y):
                        c.set(x, y, 6)
            c.outline(1)
            write(sid, (24, 22), [c], palette=palette, anchor=(12, 20), tags=["decoration"])


def main():
    os.makedirs(os.path.join(OUT, "Palettes"), exist_ok=True)
    with open(os.path.join(OUT, "Palettes", "pal.ground.json"), "w") as fh:
        json.dump({"id": "pal.ground", "colors": GROUND_PALETTE}, fh, indent=1)
        fh.write("\n")
    make_ground()
    make_shrubs()
