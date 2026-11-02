#!/usr/bin/env python3
"""Top-down 16x16 ground tiles, stat overlays and the shrub treeline (run via gen_placeholders.py).

Same sprite ids as before (tile.*, ov.*), so tileRules.json doesn't change. Ground tiles
and overlays are 16x16 squares anchored at their centre; shrubs are anchored at their base.
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

    def cave(c, rng, f):
        blob(c, 7.5, 7.5, 5.5, 5, P["cave_l"])
        blob(c, 7.5, 8, 4.3, 3.8, P["cave_m"])
        blob(c, 7.5, 8.5, 3, 2.6, P["cave"])
        blob(c, 7.5, 9, 1.6, 1.3, P["cave_d"])
        for x in range(4, 12):
            c.set(x, 2 if 5 < x < 10 else 3, P["rock_l"])
    tile("tile.cave.a", "rock", [("rock_l", .1), ("rock_d", .12)], extra=cave)

    def crystal(c, rng, f):
        for _ in range(4):
            x, y = rng.randint(2, 13), rng.randint(3, 13)
            col = rng.choice(("cr_cyan", "cr_violet"))
            c.set(x, y, P["cr_dcyan"]); c.set(x, y - 1, P[col]); c.set(x, y - 2, P["cr_white"])
    tile("tile.crystal.a", "rock", [("rock_l", .08), ("rock_d", .1)], extra=crystal)

    def pool(c, rng, f):
        blob(c, 7.5, 7.5, 6.5, 5.5, P["water"], edge=P["mud_d"])
        blob(c, 7.5, 8, 3.5, 2.5, P["water_d"])
        for i in range(4):
            c.set(4 + i + f * 2, 5, P["water_l"])
        c.set(10 - f, 10, P["water_hi"])
    tile("tile.pool.a", "mud", [("mud_d", .2), ("moss", .06)], extra=pool, frames=2, durations=[0.8, 0.8])

    def glowmoss(c, rng, f):
        for _ in range(6):
            x, y = rng.randint(0, 15), rng.randint(0, 15)
            c.set(x, y, P["gm_hi"] if (f + x) % 2 == 0 else P["gm_glow"])
    tile("tile.glowmoss.a", "gm", [("gm_m", .25), ("moss_d", .1)], extra=glowmoss, frames=2, durations=[0.9, 0.9])

    def bloom(c, rng, f):
        for _ in range(9):
            x, y = rng.randint(1, 14), rng.randint(1, 14)
            c.set(x, y, P[rng.choice(("pink", "white", "yellow", "violet"))])
    tile("tile.bloom.a", "lush", [("lush_d", .12), ("lush_l", .2)], extra=bloom)

    def mossrock(c, rng, f):
        for _ in range(2):
            cx, cy = rng.randint(3, 12), rng.randint(3, 12)
            blob(c, cx, cy, 3, 2, P["moss_l"])
    tile("tile.mossrock.a", "rock", [("rock_l", .1), ("rock_d", .1)], extra=mossrock)
    tile("tile.moss.a", "moss", [("moss_d", .18), ("moss_l", .2), ("moss_ll", .05)])


# ------------------------------------------------------------------ overlays
# Transparent 16x16 layers, one family per stat, three strengths each; they stack.

def overlay(sid, draw, frames=1, durations=None):
    out = []
    for f in range(frames):
        c = Canvas(T, T)
        draw(c, rng_for(sid), f)
        out.append(c)
    write(sid, (T, T), out, palette_ref="pal.ground", anchor=(8, 8), tags=["overlay"], durations=durations)


def pt(rng, m=1):
    return rng.randint(m, T - 1 - m), rng.randint(m, T - 1 - m)


def ov_flowers(level):
    def d(c, rng, f):
        for i in range((2, 4, 7)[level - 1]):
            x, y = pt(rng, 1)
            petal = P[rng.choice(("pink", "white", "yellow", "violet", "pink"))]
            for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1)):
                c.set(x + dx, y + dy, petal)
            c.set(x, y, P["yellow"] if petal != P["yellow"] else P["white"])
    return d


def ov_lush(level):
    def d(c, rng, f):
        if level == 3:
            for _ in range(2):
                x, y = pt(rng, 3)
                blob(c, x, y, 3, 2, P["lush"])
        for _ in range((3, 7, 12)[level - 1]):
            x, y = pt(rng, 1)
            c.set(x - 1, y, P["lush_d"]); c.set(x, y, P["lush_l"]); c.set(x, y - 1, P["lush_l"])
            c.set(x + 1, y, P["lush"]); c.set(x + 1, y - 1, P["lush_ll"])
    return d


def ov_dirt(level):
    def d(c, rng, f):
        for rx, ry in {1: [(1.8, 1.4)], 2: [(2.8, 2.2), (1.6, 1.3)], 3: [(5, 4), (3, 2.5)]}[level]:
            x, y = pt(rng, 3)
            blob(c, x, y, rx, ry, P["dirt"], edge=P["dirt_d"])
            for _ in range(int(rx * 2)):
                c.set(x + rng.randint(-1, 1), y + rng.randint(-1, 1), P[rng.choice(("dirt_l", "dirt_d"))])
    return d


def ov_stones(level):
    def d(c, rng, f):
        for _ in range(level - 1):
            x, y = pt(rng, 4)
            blob(c, x, y, 2 + level, 1.5 + level * .5, P["rock"], edge=P["rock_d"])
            c.ellipse(x - .5, y - .5, 1.5 + level * .6, 1, P["rock_l"])
        for _ in range((2, 4, 6)[level - 1]):
            x, y = pt(rng, 1)
            c.set(x, y, P["rock"]); c.set(x + 1, y, P["rock_d"]); c.set(x, y - 1, P["rock_ll"])
    return d


def ov_mycelium(level):
    def strand(c, rng, x, y, dx, dy, steps, col, branch):
        for _ in range(steps):
            c.set(x, y, col)
            if rng.random() < 0.5:
                x += dx
            else:
                y += dy
            if rng.random() < 0.25:
                dx, dy = (dx if rng.random() < .5 else -dx), (dy if rng.random() < .5 else -dy)
            if branch and rng.random() < 0.25:
                strand(c, rng, x, y, -dx, dy, rng.randint(1, 3), P["myc_d"], False)
        c.set(x, y, P["myc_hi"])

    def d(c, rng, f):
        for _ in range((1, 2, 3)[level - 1]):
            x, y = pt(rng, 2)
            strand(c, rng, x, y, rng.choice((-1, 1)), rng.choice((-1, 1)), 6 + level * 3, P["myc"], True)
    return d


def ov_glow(level):
    def d(c, rng, f):
        for i in range((1, 3, 5)[level - 1]):
            x, y = pt(rng, 1)
            bright = (i + f) % 2 == 0
            c.set(x, y, P["gm_hi"] if bright else P["gm_glow"])
            if level == 3 and bright:
                for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1)):
                    c.set(x + dx, y + dy, P["gm_glow"])
    return d


def make_overlays():
    fams = {"flowers": (ov_flowers, 1), "lush": (ov_lush, 1), "dirt": (ov_dirt, 1),
            "stones": (ov_stones, 1), "mycelium": (ov_mycelium, 1), "glow": (ov_glow, 2)}
    for name, (fn, frames) in fams.items():
        for level in (1, 2, 3):
            for v in "ab":
                overlay("ov.%s.%d%s" % (name, level, v), fn(level), frames=frames,
                        durations=[0.9, 0.9] if frames > 1 else None)


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


def make_landmarks():
    """The Old Log at the centre of the clearing: the stump from design/stump_source.jpg (gen_stump.py),
    or this placeholder fallen log if that picture is missing."""
    try:
        import gen_stump
        if os.path.exists(gen_stump.SOURCE):
            gen_stump.main()
            return
    except ImportError:
        pass
    pal = ["transparent", "#24160e", "#6b4a2f", "#8a6440", "#4a3322", "#c49a6c", "#6a9a48", "#83b45a", "#e8d4b0"]
    c = Canvas(30, 16)
    c.ellipse(15, 9.5, 13, 4.5, 2)                       # trunk
    for x in range(4, 26, 3):
        c.line(x, 6, x + 1, 13, 4)                        # bark grooves
    c.rect(3, 6, 26, 6, 3)
    c.ellipse(26, 9.5, 3, 4.2, 5)                         # cut end with rings
    c.ellipse(26, 9.5, 1.8, 2.6, 8)
    c.ellipse(26, 9.5, 0.8, 1.2, 5)
    for (x, y, rx) in ((9, 5.5, 4), (17, 5, 3), (6, 8, 2)):
        c.ellipse(x, y, rx, 1.6, 6)                       # moss
        c.set(int(x) - 1, int(y) - 1, 7)
    c.set(13, 3, 7); c.set(14, 2, 6)                      # tiny sprout
    c.outline(1)
    write("landmark.old-log", (30, 16), [c], palette=pal, anchor=(15, 13), tags=["landmark"])


def main():
    os.makedirs(os.path.join(OUT, "Palettes"), exist_ok=True)
    with open(os.path.join(OUT, "Palettes", "pal.ground.json"), "w") as fh:
        json.dump({"id": "pal.ground", "colors": GROUND_PALETTE}, fh, indent=1)
        fh.write("\n")
    make_ground()
    make_overlays()
    make_shrubs()
    make_landmarks()
