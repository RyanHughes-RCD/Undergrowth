#!/usr/bin/env python3
"""Generates placeholder pixel-art sprites as JSON in the Undergrowth sprite format.

Every sprite is a palette plus rows of palette-index characters (base-62, '.' = 0 =
transparent), with one or more animation frames. Run from anywhere:

    python3 tools/gen_placeholders.py

Output goes to Resources/Sprites/. Hand-made or editor-made sprites can replace any
of these by id; this script only exists so the game is playable before real art.
"""
import json
import math
import os
import random
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Resources", "Sprites")
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[0] * w for _ in range(h)]

    def set(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return 0

    def rect(self, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c, clip=None):
        for y in range(self.h):
            for x in range(self.w):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 and (clip is None or clip(x, y)):
                    self.px[y][x] = c

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n):
            t = i / max(1, n - 1)
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def outline(self, c, skip=()):
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] != 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = self.get(x + dx, y + dy)
                    if n != 0 and n not in skip:
                        add.append((x, y))
                        break
        for x, y in add:
            self.px[y][x] = c

    def rows(self):
        return ["".join("." if v == 0 else ALPHABET[v] for v in row) for row in self.px]


def write(sprite_id, size, frames, palette=None, palette_ref=None, anchor=None, tags=None, durations=None):
    data = {"id": sprite_id, "size": list(size)}
    if anchor is not None:
        data["anchor"] = list(anchor)
    if palette is not None:
        data["palette"] = palette
    if palette_ref is not None:
        data["paletteRef"] = palette_ref
    data["frames"] = []
    for i, f in enumerate(frames):
        fr = {"rows": f.rows()}
        if durations:
            fr["duration"] = durations[i % len(durations)]
        data["frames"].append(fr)
    if tags:
        data["tags"] = tags
    folder = os.path.join(OUT, sprite_id.split(".")[0])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, sprite_id + ".json"), "w") as fh:
        json.dump(data, fh, indent=1)
        fh.write("\n")


# ---------------------------------------------------------------- ground tiles
# Isometric tile: 32x16 diamond top + 8px side "lip" = 32x24, anchored at the
# diamond center (16, 8). Diamonds tile exactly at offsets of (16, 8).
GROUND_PALETTE = [
    "transparent",
    # 1-4 soil / leaf litter
    "#6b4a2f", "#5a3d26", "#86603d", "#b5662f",
    # 5-8 grass
    "#5f8f3a", "#79a94a", "#4a7330", "#97c463",
    # 9-12 lush
    "#3f8a3a", "#5bb04a", "#2d6a2c", "#8ad46b",
    # 13-16 flowers
    "#ff9ccf", "#fff3c4", "#ffd84a", "#c58cff",
    # 17-20 mud / wet
    "#4e3b2e", "#3a2c22", "#6a5a50", "#57483d",
    # 21-24 moss
    "#4f7a3a", "#6a9a48", "#3a5e2c", "#83b45a",
    # 25-28 glow moss
    "#24464a", "#3d7a70", "#7cf2ff", "#c8fbff",
    # 29-32 rock
    "#7c7c86", "#9a9aa6", "#5e5e68", "#b8b8c4",
    # 33-36 loam
    "#3e2b2a", "#2e1f22", "#5a3c30", "#4a3436",
    # 37-40 water
    "#2a4e6e", "#3f6f94", "#1d3650", "#7fb0d4",
    # 41-44 crystal
    "#7ce0ff", "#c58cff", "#e9d8ff", "#4aa8c8",
    # 45-48 cave
    "#120c18", "#221a2c", "#342a40", "#0a070e",
    # 49-54 lips (soil left/right, rock left/right, dark left/right)
    "#4a3322", "#3a2719", "#5e5e68", "#4a4a54", "#2e1f22", "#22171a",
    # 55-57 mycelium, 58-60 dirt patches, 61 deep grass
    "#d9cfb3", "#b0a587", "#f2ecd9", "#7a5232", "#5b3c22", "#93683f", "#3f6a2a",
]
P = {name: i for i, name in enumerate([
    "t", "soil", "soil_d", "soil_l", "leaf",
    "grass", "grass_l", "grass_d", "grass_ll",
    "lush", "lush_l", "lush_d", "lush_ll",
    "pink", "white", "yellow", "violet",
    "mud", "mud_d", "mud_l", "mud_m",
    "moss", "moss_l", "moss_d", "moss_ll",
    "gm", "gm_m", "gm_glow", "gm_hi",
    "rock", "rock_l", "rock_d", "rock_ll",
    "loam", "loam_d", "loam_root", "loam_m",
    "water", "water_l", "water_d", "water_hi",
    "cr_cyan", "cr_violet", "cr_white", "cr_dcyan",
    "cave", "cave_m", "cave_l", "cave_d",
    "lip_soil_l", "lip_soil_r", "lip_rock_l", "lip_rock_r", "lip_dark_l", "lip_dark_r",
    "myc", "myc_d", "myc_hi", "dirt", "dirt_d", "dirt_l", "grass_dd",
])}


def in_diamond(x, y):
    return abs(x + 0.5 - 16) / 16 + abs(y + 0.5 - 8) / 8 <= 1


def ground_tile(sprite_id, base, specks, lip="soil", seed=0, extra=None, frames=1, durations=None):
    out = []
    for f in range(frames):
        rng = random.Random(zlib.crc32(sprite_id.encode()) % 100000 + seed)
        c = Canvas(32, 24)
        for y in range(24):
            for x in range(32):
                if in_diamond(x, y):
                    c.px[y][x] = P[base]
                    for name, prob in specks:
                        if rng.random() < prob:
                            c.px[y][x] = P[name]
                else:
                    for d in range(1, 9):
                        if in_diamond(x, y - d):
                            side = "l" if x < 16 else "r"
                            c.px[y][x] = P["lip_%s_%s" % ("soil" if lip == "grassy" else lip, side)]
                            if lip == "grassy" and (d == 1 or (d == 2 and rng.random() < 0.35)):
                                c.px[y][x] = P["grass_d"] if side == "l" else P["grass_dd"]
                            # a darker strata line
                            if d == 5 and rng.random() < 0.7:
                                c.px[y][x] = P["lip_dark_" + side]
                            break
        if extra:
            extra(c, random.Random(zlib.crc32(sprite_id.encode()) % 1000 + f * 17), f)
        out.append(c)
    write(sprite_id, (32, 24), out, palette_ref="pal.ground", anchor=(16, 8), tags=["tile"], durations=durations)


def grass_tufts(colors, n):
    def fn(c, rng, f):
        for _ in range(n):
            x, y = rng.randint(3, 28), rng.randint(2, 13)
            if in_diamond(x, y) and in_diamond(x + 1, y - 1):
                col = P[rng.choice(colors)]
                c.set(x, y, col)
                c.set(x + 1, y - 1, col)
                c.set(x + 1, y, col)
    return fn


# ------------------------------------------------------------ overlays
# Transparent 32x24 layers drawn on top of the ground, one family per stat,
# three strengths each (1 = faint ... 3 = heavy). They stack, so tiles with
# several influences combine into unique looks.

def rand_in(rng, inset=1):
    for _ in range(200):
        x, y = rng.randint(1, 30), rng.randint(1, 14)
        if all(in_diamond(x + dx, y + dy) for dx in (-inset, inset) for dy in (-inset, inset)):
            return x, y
    return 16, 8


def overlay(sprite_id, draw, frames=1, durations=None):
    out = []
    for f in range(frames):
        c = Canvas(32, 24)
        draw(c, random.Random(zlib.crc32(sprite_id.encode())), f)
        for y in range(24):
            for x in range(32):
                if not in_diamond(x, y):
                    c.px[y][x] = 0
        out.append(c)
    write(sprite_id, (32, 24), out, palette_ref="pal.ground", anchor=(16, 8), tags=["overlay"], durations=durations)


def ov_flowers(level):
    def draw(c, rng, f):
        for i in range((3, 7, 13)[level - 1]):
            x, y = rand_in(rng, 1)
            petal = P[rng.choice(("pink", "white", "yellow", "violet", "pink", "white"))]
            centre = P["yellow"] if petal != P["yellow"] else P["white"]
            c.set(x, y + 1, P["grass_d"])
            for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1)):
                c.set(x + dx, y + dy, petal)
            c.set(x, y, centre)
            if level == 3 and i % 4 == 0:
                c.set(x + 2, y, petal); c.set(x - 2, y, petal)
    return draw


def ov_lush(level):
    def draw(c, rng, f):
        if level == 3:
            for _ in range(3):
                cx, cy = rand_in(rng, 2)
                c.ellipse(cx + .5, cy + .5, 4, 2, P["lush"])
        for _ in range((5, 12, 22)[level - 1]):
            x, y = rand_in(rng, 2)
            c.set(x - 1, y, P["lush_d"])
            c.set(x, y, P["lush_l"]); c.set(x, y - 1, P["lush_l"])
            c.set(x + 1, y, P["lush"]); c.set(x + 1, y - 1, P["lush"]); c.set(x + 1, y - 2, P["lush_ll"])
    return draw


def ov_dirt(level):
    def draw(c, rng, f):
        sizes = {1: [(2.5, 1.3)], 2: [(3.5, 1.8), (2.5, 1.3)], 3: [(6, 3), (4.5, 2.2), (3.5, 1.8), (3, 1.5)]}[level]
        for rx, ry in sizes:
            cx, cy = rand_in(rng, 2)
            c.ellipse(cx + .5, cy + .5, rx + 0.8, ry + 0.6, P["dirt_d"])
            c.ellipse(cx + .5, cy + .5, rx, ry, P["dirt"])
            for _ in range(int(rx * 2)):
                c.set(cx + rng.randint(-int(rx) + 1, int(rx) - 1), cy + rng.randint(-int(ry), int(ry)),
                      P[rng.choice(("dirt_l", "dirt_d"))])
    return draw


def ov_stones(level):
    def draw(c, rng, f):
        if level >= 2:
            for _ in range(level - 1):
                cx, cy = rand_in(rng, 3)
                c.ellipse(cx + .5, cy + .5, 4 + level, 2 + level / 2, P["rock"])
                c.ellipse(cx - .5, cy - .5, 2.5 + level, 1.2, P["rock_l"])
                c.set(cx + 2, cy + 1, P["rock_d"]); c.set(cx + 3, cy + 1, P["rock_d"])
        for _ in range((3, 6, 9)[level - 1]):
            x, y = rand_in(rng, 1)
            c.set(x, y, P["rock"]); c.set(x + 1, y, P["rock_d"]); c.set(x, y - 1, P["rock_ll"])
    return draw


def ov_mycelium(level):
    """Root-like strands that follow the isometric diagonals and branch."""
    def strand(c, rng, x, y, dx, dy, steps, colour, branch):
        for i in range(steps):
            c.set(x, y, colour)
            c.set(x + (1 if dx > 0 else -1), y, colour)
            x += dx
            y += dy
            if rng.random() < 0.3:  # wobble: switch between the two diagonals
                dy = -dy if rng.random() < 0.5 else dy
            if branch and rng.random() < 0.25:
                strand(c, rng, x, y, dx, -dy, rng.randint(1, 3), P["myc_d"], False)
        c.set(x, y, P["myc_hi"])

    def draw(c, rng, f):
        for _ in range((1, 2, 4)[level - 1]):
            x, y = rand_in(rng, 2)
            strand(c, rng, x, y, rng.choice((-2, 2)), rng.choice((-1, 1)), rng.randint(3, 5) + level, P["myc"], True)
    return draw


def ov_glow(level):
    def draw(c, rng, f):
        for i in range((2, 5, 9)[level - 1]):
            x, y = rand_in(rng, 1)
            bright = (i + f) % 2 == 0
            c.set(x, y, P["gm_hi"] if bright else P["gm_glow"])
            if level == 3 and bright:
                for dx, dy in ((1, 0), (-1, 0), (0, -1), (0, 1)):
                    c.set(x + dx, y + dy, P["gm_glow"])
    return draw


def make_overlays():
    families = {
        "flowers": (ov_flowers, 1), "lush": (ov_lush, 1), "dirt": (ov_dirt, 1),
        "stones": (ov_stones, 1), "mycelium": (ov_mycelium, 1), "glow": (ov_glow, 2),
    }
    for name, (fn, frames) in families.items():
        for level in (1, 2, 3):
            for v in "ab":
                overlay("ov.%s.%d%s" % (name, level, v), fn(level), frames=frames,
                        durations=[0.9, 0.9] if frames > 1 else None)


def flowers_extra(colors, n):
    def fn(c, rng, f):
        for _ in range(n):
            x, y = rng.randint(4, 27), rng.randint(3, 12)
            if in_diamond(x, y):
                c.set(x, y, P[rng.choice(colors)])
    return fn


def glowmoss_extra(c, rng, f):
    for _ in range(9):
        x, y = rng.randint(4, 27), rng.randint(2, 13)
        if in_diamond(x, y):
            c.set(x, y, P["gm_hi"] if (f + x) % 2 == 0 else P["gm_glow"])


def rock_extra(c, rng, f):
    for _ in range(3):
        x, y = rng.randint(6, 24), rng.randint(4, 10)
        for i in range(rng.randint(2, 4)):
            if in_diamond(x + i, y + (i % 2)):
                c.set(x + i, y + (i % 2), P["rock_d"])
    for _ in range(4):
        x, y = rng.randint(6, 25), rng.randint(3, 12)
        if in_diamond(x, y):
            c.set(x, y, P["rock_ll"])


def mossrock_extra(c, rng, f):
    rock_extra(c, rng, f)
    for _ in range(3):
        cx, cy = rng.randint(8, 23), rng.randint(5, 10)
        for y in range(cy - 2, cy + 2):
            for x in range(cx - 3, cx + 4):
                if in_diamond(x, y) and (x - cx) ** 2 / 9 + (y - cy) ** 2 / 3 <= 1:
                    c.set(x, y, P["moss_l"] if rng.random() < 0.7 else P["moss"])


def loam_extra(c, rng, f):
    for _ in range(3):
        x, y = rng.randint(6, 22), rng.randint(4, 11)
        for i in range(rng.randint(3, 6)):
            nx, ny = x + i, y + (1 if i % 3 == 2 else 0)
            if in_diamond(nx, ny):
                c.set(nx, ny, P["loam_root"])


def pool_extra(c, rng, f):
    for y in range(16):
        for x in range(32):
            dx, dy = (x + 0.5 - 16) / 12, (y + 0.5 - 8) / 5.5
            d = dx * dx + dy * dy
            if d <= 1:
                c.px[y][x] = P["water"] if d < 0.75 else P["mud_d"]
                if d < 0.3:
                    c.px[y][x] = P["water_d"]
    # ripple, shifts per frame
    for i in range(5):
        x = 10 + i + f * 2
        c.set(x, 6, P["water_l"])
    c.set(20 - f, 9, P["water_hi"])
    c.set(21 - f, 9, P["water_l"])


def crystal_extra(c, rng, f):
    rock_extra(c, rng, f)
    for _ in range(5):
        x, y = rng.randint(7, 24), rng.randint(4, 12)
        if in_diamond(x, y) and in_diamond(x, y - 2):
            col = rng.choice(["cr_cyan", "cr_violet"])
            c.set(x, y, P["cr_dcyan"])
            c.set(x, y - 1, P[col])
            c.set(x, y - 2, P["cr_white"])


def cave_extra(c, rng, f):
    for y in range(16):
        for x in range(32):
            dx, dy = (x + 0.5 - 16) / 11, (y + 0.5 - 8.5) / 5
            d = dx * dx + dy * dy
            if d <= 1:
                if d > 0.78:
                    c.px[y][x] = P["cave_l"]
                elif d > 0.5:
                    c.px[y][x] = P["cave_m"]
                elif d > 0.22:
                    c.px[y][x] = P["cave"]
                else:
                    c.px[y][x] = P["cave_d"]
    # rim highlight on the far edge
    for x in range(9, 23):
        y = 8.5 - 5 * math.sqrt(max(0, 1 - ((x + 0.5 - 16) / 11) ** 2))
        c.set(x, int(y), P["rock_l"])


def make_ground():
    os.makedirs(os.path.join(OUT, "Palettes"), exist_ok=True)
    with open(os.path.join(OUT, "Palettes", "pal.ground.json"), "w") as fh:
        json.dump({"id": "pal.ground", "colors": GROUND_PALETTE}, fh, indent=1)
        fh.write("\n")
    ground_tile("tile.soil.a", "soil", [("soil_d", .18), ("soil_l", .08), ("leaf", .03)])
    ground_tile("tile.soil.b", "soil", [("soil_d", .14), ("soil_l", .12), ("leaf", .015)], seed=3)
    # Low-stat transition tiles: soil starting to change, so zone edges fade out.
    ground_tile("tile.soil.damp", "soil", [("mud_m", .3), ("soil_d", .15), ("mud_l", .03)])
    ground_tile("tile.soil.pebbly", "soil", [("soil_d", .15), ("rock", .07), ("rock_l", .04)])
    ground_tile("tile.soil.dark", "soil_d", [("loam", .3), ("soil", .1), ("loam_root", .03)])
    ground_tile("tile.grass.sparse", "soil", [("grass", .35), ("grass_d", .1), ("grass_l", .08)])
    # Base meadow grass: calm texture with small tufts (less single-pixel noise).
    for i, sid in enumerate(("tile.grass.a", "tile.grass.b", "tile.grass.c")):
        ground_tile(sid, "grass", [("grass_d", .05), ("grass_l", .04)], lip="grassy", seed=i * 7,
                    extra=grass_tufts(("grass_l", "grass_d", "grass_ll"), 6 + i * 2))
    # Forest edge beyond the map (deeper, darker grass).
    for i, sid in enumerate(("tile.edge.a", "tile.edge.b")):
        ground_tile(sid, "grass_dd", [("lush_d", .1), ("grass_d", .12)], lip="grassy", seed=i * 5,
                    extra=grass_tufts(("grass_d", "lush_d"), 8))
    make_overlays()
    ground_tile("tile.lush.a", "lush", [("lush_d", .2), ("lush_l", .18), ("lush_ll", .05)])
    ground_tile("tile.meadow.a", "grass", [("grass_d", .12), ("grass_l", .18)],
                extra=flowers_extra(["pink", "white", "yellow"], 7))
    ground_tile("tile.bloom.a", "lush", [("lush_d", .12), ("lush_l", .2)],
                extra=flowers_extra(["pink", "white", "yellow", "violet"], 18))
    ground_tile("tile.mud.a", "mud", [("mud_d", .2), ("mud_m", .2), ("mud_l", .04)])
    ground_tile("tile.moss.a", "moss", [("moss_d", .18), ("moss_l", .2), ("moss_ll", .05)])
    ground_tile("tile.glowmoss.a", "gm", [("gm_m", .25), ("moss_d", .1)], extra=glowmoss_extra,
                frames=2, durations=[0.9, 0.9])
    ground_tile("tile.rock.a", "rock", [("rock_l", .12), ("rock_d", .08)], lip="rock", extra=rock_extra)
    ground_tile("tile.rock.b", "rock", [("rock_l", .08), ("rock_d", .12)], lip="rock", extra=rock_extra, seed=9)
    ground_tile("tile.mossrock.a", "rock", [("rock_l", .1), ("rock_d", .1)], lip="rock", extra=mossrock_extra)
    ground_tile("tile.loam.a", "loam", [("loam_d", .25), ("loam_m", .15)], extra=loam_extra, lip="dark")
    ground_tile("tile.pool.a", "mud", [("mud_d", .2), ("moss", .06)], extra=pool_extra,
                frames=2, durations=[0.8, 0.8])
    ground_tile("tile.crystal.a", "rock", [("rock_l", .08), ("rock_d", .1)], lip="rock", extra=crystal_extra)
    ground_tile("tile.cave.a", "rock", [("rock_l", .1), ("rock_d", .12)], lip="rock", extra=cave_extra)


# ------------------------------------------------------------------ creatures
# Palette layout shared by creatures so glimmer swaps (in creatures.json) can
# target the same indices: 1 outline, 2 main, 3 light, 4 body/secondary,
# 5 accent, 6 eye, 7 shade.

def creature_frames(draw):
    frames = []
    for dy in (0, 1):
        c = Canvas(16, 16)
        draw(c, dy)
        c.outline(1)
        frames.append(c)
    return frames


def fungling(c, dy):
    # stem / face
    c.rect(5, 8 + dy, 10, 13, 4)
    c.set(4, 13, 0)
    c.set(5, 14, 4); c.set(6, 14, 4); c.set(9, 14, 4); c.set(10, 14, 4)
    # cap
    c.ellipse(8, 7.5 + dy, 6.6, 5, 2, clip=lambda x, y: y <= 7 + dy)
    for x in range(2, 14):
        c.set(x, 8 + dy, 7)
    for (x, y) in ((5, 4), (6, 4), (10, 5), (8, 3), (4, 6), (11, 6)):
        c.set(x, y + dy, 3)
    c.set(6, 10 + dy, 6); c.set(9, 10 + dy, 6)
    c.set(5, 11 + dy, 5); c.set(10, 11 + dy, 5)
    c.set(7, 12, 7); c.set(8, 12, 7)


def sproutling(c, dy):
    c.ellipse(8, 11 + dy * 0.5, 5.5, 3.8, 2)
    c.ellipse(7, 10 + dy * 0.5, 2.5, 1.6, 3)
    c.set(6, 11, 6); c.set(10, 11, 6)
    c.set(5, 14, 4); c.set(6, 14, 4); c.set(9, 14, 4); c.set(10, 14, 4)
    # stem + leaves
    c.line(8, 7, 8, 4 + dy, 4)
    c.ellipse(5.5, 5 + dy, 2.5, 1.3, 3)
    c.ellipse(10.5, 4 + dy, 2.5, 1.3, 3)
    c.set(5, 5 + dy, 2); c.set(11, 4 + dy, 2)
    # flower bud
    c.set(8, 2 + dy, 5); c.set(7, 3 + dy, 5); c.set(9, 3 + dy, 5); c.set(8, 3 + dy, 6 if False else 5)
    c.set(8, 1 + dy, 5)


def geode_critter(c, dy):
    c.ellipse(8, 10.5 + dy * 0.5, 6.5, 4.5, 2, clip=lambda x, y: y <= 13)
    c.rect(3, 12, 12, 13, 7)
    for (x, y) in ((4, 9), (6, 8), (10, 9), (12, 11), (5, 12)):
        c.set(x, y, 3)
    # crystals on the back
    for (x, top) in ((6, 4), (8, 3), (10, 5)):
        for y in range(top + dy, 8):
            c.set(x, y, 5)
        c.set(x, top + dy, 3)
    c.set(6, 11, 6); c.set(10, 11, 6)
    c.set(4, 14, 4); c.set(5, 14, 4); c.set(10, 14, 4); c.set(11, 14, 4)


def make_creatures():
    write("creature.fungling", (16, 16), creature_frames(fungling), anchor=(8, 15), tags=["creature"],
          durations=[0.6, 0.6],
          palette=["transparent", "#2b1d14", "#c4734a", "#f0c09a", "#efe2c8", "#9fe8ff", "#2b1d14", "#a85a38"])
    write("creature.sproutling", (16, 16), creature_frames(sproutling), anchor=(8, 15), tags=["creature"],
          durations=[0.6, 0.6],
          palette=["transparent", "#1f2a14", "#6cc24a", "#b4ec82", "#7a5a32", "#ff8ab8", "#1f2a14", "#4f9a38"])
    write("creature.geodeCritter", (16, 16), creature_frames(geode_critter), anchor=(8, 15), tags=["creature"],
          durations=[0.6, 0.6],
          palette=["transparent", "#1c1824", "#8a7f96", "#b9b0c4", "#5a5066", "#7ce0ff", "#1c1824", "#6c6278"])


# ---------------------------------------------------------------------- items

def item(sprite_id, palette, draw, size=(16, 16), frames=1, durations=None, outline=True, anchor=None, tags=("item",)):
    out = []
    for f in range(frames):
        c = Canvas(*size)
        draw(c, f)
        if outline:
            c.outline(1)
        out.append(c)
    write(sprite_id, size, out, palette=palette, anchor=anchor or (size[0] // 2, size[1] - 1),
          tags=list(tags), durations=durations)


PLANT_PAL = ["transparent", "#1f2a14"]


def make_items():
    # Plants: 1 outline, 2 stem, 3 leaf, 4 leaf light, 5 petal, 6 petal light, 7 center
    def clover(c, f):
        c.line(8, 14, 8, 9, 2)
        for cx, cy in ((6, 7), (10, 7), (8, 5)):
            c.ellipse(cx, cy, 2.2, 2.0, 3)
            c.set(cx - 1, cy - 1, 4)
    item("item.plant.clover", PLANT_PAL + ["#4f8a2c", "#5fbf4a", "#a6e57a", "#fff", "#fff", "#fff"], clover)

    def frond(c, f):
        c.line(8, 14, 8, 6, 2)
        for i, y in enumerate(range(13, 7, -2)):
            c.line(8, y, 8 - 3 + i // 2, y - 2, 3)
            c.line(8, y, 8 + 3 - i // 2, y - 2, 3)
        for (x, y) in ((8, 5), (9, 4), (10, 4), (11, 5), (11, 6), (10, 7), (9, 6)):
            c.set(x, y, 4)
    item("item.plant.frond", PLANT_PAL + ["#3f7a2c", "#4fae3a", "#8ad46b", "#fff", "#fff", "#fff"], frond)

    def bluebell(c, f):
        c.line(6, 14, 6, 6, 2)
        c.line(6, 6, 9, 3, 2)
        for (x, y) in ((10, 5), (8, 8), (11, 9)):
            c.line(x - 1, y - 2, x - 2, y - 3, 2)
            c.ellipse(x, y, 1.8, 2, 5)
            c.set(x - 1, y - 1, 6)
        c.ellipse(4, 13, 2, 1, 3)
    item("item.plant.bluebell", PLANT_PAL + ["#4f8a2c", "#5fbf4a", "#a6e57a", "#5a7cff", "#a9bbff", "#fff"], bluebell)

    def cavefern(c, f):
        for (dx, top) in ((-4, 6), (0, 3), (4, 5)):
            c.line(8, 14, 8 + dx, top, 3)
            c.set(8 + dx, top - 1, 4)
            c.set(8 + dx // 2 - 1, (14 + top) // 2, 4)
            c.set(8 + dx // 2 + 1, (14 + top) // 2, 4)
    item("item.plant.cavefern", PLANT_PAL + ["#6a8a6a", "#b8d8c0", "#e8fff0", "#fff", "#fff", "#fff"], cavefern)

    def sunpetal(c, f):
        c.line(8, 14, 8, 8, 2)
        c.ellipse(5.5, 11, 2.5, 1.2, 3)
        c.ellipse(10.5, 12, 2.5, 1.2, 3)
        c.ellipse(8, 5, 4.5, 4, 5)
        c.ellipse(8, 5, 2, 2, 7)
        c.set(6, 3, 6); c.set(5, 4, 6)
    item("item.plant.sunpetal", PLANT_PAL + ["#4f8a2c", "#5fbf4a", "#a6e57a", "#ffd84a", "#fff3a8", "#c2611f"], sunpetal)

    def moonlily(c, f):
        c.line(8, 14, 8, 9, 2)
        c.ellipse(5, 12, 2.5, 1.2, 3)
        for (x, y) in ((5, 6), (11, 6), (8, 4), (6, 8), (10, 8)):
            c.ellipse(x, y, 2, 2, 5)
        c.ellipse(8, 7, 1.6, 1.6, 7 if f == 0 else 6)
    item("item.plant.moonlily", PLANT_PAL + ["#4f8a2c", "#5fbf4a", "#a6e57a", "#e6dcff", "#ffffff", "#7cf2ff"],
         moonlily, frames=2, durations=[0.8, 0.8])

    # Mushrooms: 1 outline, 2 cap, 3 cap light, 4 stem, 5 stem shade, 6 glow
    MPAL = ["transparent", "#2b1d14"]

    def cap_mushroom(cap_rx, cap_ry, spots=(), stem_w=2, top=4):
        def draw(c, f):
            c.rect(8 - stem_w // 2, top + cap_ry, 7 + (stem_w + 1) // 2, 14, 4)
            c.set(7 + (stem_w + 1) // 2, 13, 5)
            c.ellipse(8, top + cap_ry + 0.5, cap_rx, cap_ry + 0.5, 2, clip=lambda x, y: y <= top + cap_ry)
            for (x, y) in spots:
                c.set(x, y, 3)
            if f == 1:
                for (x, y) in spots:
                    c.set(x, y, 6)
        return draw

    item("item.mushroom.brown", MPAL + ["#8a5a36", "#b07a4a", "#efe2c8", "#c9b89a", "#fff"],
         cap_mushroom(5, 3, spots=((6, 5), (7, 4))))

    def puffball(c, f):
        c.ellipse(8, 10.5, 4.5, 4, 2)
        c.ellipse(7, 9, 2, 1.5, 3)
        c.rect(5, 14, 11, 14, 5)
    item("item.mushroom.puffball", MPAL + ["#e8dcc0", "#fffaf0", "#efe2c8", "#b8a888", "#fff"], puffball)

    item("item.mushroom.redcap", MPAL + ["#d23a2c", "#fff4e8", "#efe2c8", "#c9b89a", "#fff"],
         cap_mushroom(6, 4, spots=((5, 6), (8, 4), (10, 6), (7, 7)), stem_w=3, top=3))
    item("item.mushroom.glowcap", MPAL + ["#3aa8b8", "#9ff4ff", "#d8f8f0", "#a8c8c0", "#e8ffff"],
         cap_mushroom(5.5, 3.5, spots=((6, 5), (9, 4), (10, 6)), stem_w=2, top=4), frames=2, durations=[0.7, 0.7])

    def ghostmorel(c, f):
        c.rect(7, 11, 9, 14, 4)
        c.ellipse(8, 7, 3.5, 5, 2)
        for (x, y) in ((7, 4), (9, 6), (7, 8), (9, 9), (8, 3)):
            c.set(x, y, 3 if f == 0 else 6)
    item("item.mushroom.ghostmorel", ["transparent", "#3a4a66c0", "#d8e8ffd0", "#9fb8ffd0", "#f0f6ffe0", "#c8d8f0", "#ffffff"],
         ghostmorel, frames=2, durations=[0.9, 0.9])

    # Geodes (half buried): 1 outline, 2 rock, 3 rock light, 4 dirt, 5 crystal, 6 crystal light
    def geode(crystals=False, deep=False):
        def draw(c, f):
            c.ellipse(8, 11, 5.5, 4.5, 2, clip=lambda x, y: y <= 12)
            c.ellipse(6.5, 9, 2, 1.5, 3)
            c.rect(2, 13, 13, 14, 4)
            c.set(3, 12, 4); c.set(12, 12, 4)
            if crystals:
                for (x, y) in ((9, 8), (10, 9), (7, 11)):
                    c.set(x, y, 5); c.set(x, y - 1, 6)
            if deep:
                for (x, y) in ((10, 8), (5, 11), (9, 11)):
                    c.set(x, y, 5)
        return draw
    item("item.geode.plain", ["transparent", "#2a2430", "#8a8490", "#b8b2c0", "#6b4a2f", "#fff", "#fff"], geode())
    item("item.geode.crystal", ["transparent", "#2a2430", "#8a8490", "#b8b2c0", "#6b4a2f", "#7ce0ff", "#e8ffff"], geode(crystals=True))
    item("item.geode.deep", ["transparent", "#140f1c", "#3e3450", "#625478", "#3e2b2a", "#ff9ef0", "#fff"], geode(deep=True))

    def rough(crystals=False, deep=False):
        def draw(c, f):
            c.ellipse(8, 9.5, 5.5, 5, 2)
            c.ellipse(6.5, 7.5, 2.2, 1.6, 3)
            c.set(10, 12, 4); c.set(11, 11, 4); c.set(9, 13, 4)
            if crystals:
                for (x, y) in ((10, 6), (11, 8), (5, 11)):
                    c.set(x, y, 5); c.set(x, y - 1, 6)
            if deep:
                for (x, y) in ((10, 7), (5, 11), (9, 10)):
                    c.set(x, y, 5)
        return draw
    item("item.rock.rough", ["transparent", "#2a2430", "#8a8490", "#b8b2c0", "#6c6672", "#fff", "#fff"], rough())
    item("item.rock.crystal", ["transparent", "#2a2430", "#8a8490", "#b8b2c0", "#6c6672", "#7ce0ff", "#e8ffff"], rough(crystals=True))
    item("item.rock.deep", ["transparent", "#140f1c", "#3e3450", "#625478", "#2a2238", "#ff9ef0", "#fff"], rough(deep=True))

    # Gems: 1 outline, 2 base, 3 light, 4 dark, 5 sparkle
    def gem(shape):
        def draw(c, f):
            if shape == "round":
                c.ellipse(8, 8.5, 4.5, 4.5, 2)
                c.ellipse(9, 10, 2.5, 2.5, 4)
                c.ellipse(7, 7, 1.6, 1.6, 3)
            elif shape == "point":
                for y in range(3, 14):
                    half = (y - 3) // 2 if y < 9 else (14 - y)
                    c.rect(8 - half, y, 8 + half, y, 2)
                c.line(8, 4, 8, 12, 3)
                c.line(9, 8, 10, 10, 4)
            else:  # cut
                for y in range(4, 13):
                    half = min(5, y - 2) if y < 8 else max(0, 12 - y + 1)
                    c.rect(8 - half, y, 8 + half, y, 2)
                c.rect(6, 5, 9, 6, 3)
                c.rect(9, 9, 11, 10, 4)
            c.set(6, 6, 5)
        return draw
    for gid, shape, base, light, dark in (
        ("quartz", "point", "#dce8f0", "#ffffff", "#a8b8c8"),
        ("amber", "round", "#e89a2c", "#ffd27a", "#b0601c"),
        ("jade", "round", "#3fae6a", "#8fe0a8", "#1f7a46"),
        ("garnet", "cut", "#b8283c", "#f07080", "#7a1426"),
        ("amethyst", "point", "#9a5ad8", "#d4a8ff", "#6a2ea8"),
        ("moonstone", "round", "#b8d0f0", "#f0f8ff", "#7f9cc8"),
        ("starstone", "cut", "#1e2a6a", "#5a70d8", "#0e143a"),
    ):
        pal = ["transparent", "#1a1420", base, light, dark, "#ffffff"]
        if gid == "starstone":
            def star(c, f, _g=gem("cut")):
                _g(c, f)
                for (x, y) in ((7, 9), (10, 7), (9, 11), (5, 8)):
                    c.set(x, y, 5)
            item("item.gem.starstone", pal, star, size=(16, 16))
        else:
            item("item.gem." + gid, pal, gem(shape), size=(16, 16))

    # Seeds
    def seed(c, f):
        c.ellipse(8, 10, 2.5, 3.5, 2)
        c.set(7, 8, 3)
    item("item.seed.wild", ["transparent", "#2b1d14", "#9a6a3a", "#d8a868"], seed)

    SEEDPAL = ["transparent", "#2b1d14", "#5a3d26", "#86603d", "#5fbf4a", "#a6e57a", "#ffd84a"]

    def planted(c, f):
        c.ellipse(8, 13, 4.5, 2, 2)
        c.set(7, 12, 3); c.set(9, 12, 3)
    item("seed.stage.planted", SEEDPAL, planted, tags=("seed",))

    def sprout(c, f):
        c.ellipse(8, 13, 4.5, 2, 2)
        c.line(8, 12, 8, 8, 4)
        c.set(7, 8, 5); c.set(9, 9, 5); c.set(6, 7, 5)
    item("seed.stage.sprout", SEEDPAL, sprout, tags=("seed",))

    def ready(c, f):
        c.ellipse(8, 13, 4.5, 2, 2)
        c.line(8, 12, 8, 5, 4)
        c.ellipse(6, 9, 2, 1, 5)
        c.ellipse(10, 8, 2, 1, 5)
        c.ellipse(8, 4, 1.6, 1.8, 6 if f == 0 else 5)
    item("seed.stage.ready", SEEDPAL, ready, frames=2, durations=[0.5, 0.5], tags=("seed",))


# ---------------------------------------------------------------- decorations

def deco(sprite_id, palette, draw, size=(12, 12), frames=1, durations=None, anchor=None, outline=False):
    out = []
    for f in range(frames):
        c = Canvas(*size)
        draw(c, f)
        if outline:
            c.outline(1)
        out.append(c)
    write(sprite_id, size, out, palette=palette, anchor=anchor or (size[0] // 2, size[1] - 1),
          tags=["decoration"], durations=durations)


def make_decorations():
    G = ["transparent", "#2d5a20", "#4f8a2c", "#79b84a", "#a6e57a"]

    def tuft(seed):
        def draw(c, f):
            rng = random.Random(seed)
            for i in range(5):
                x = 3 + i * 1.5
                h = rng.randint(3, 6)
                c.line(x, 11, x + rng.choice((-1, 0, 1)), 11 - h, rng.choice((2, 3, 4)))
        return draw
    deco("deco.grass.a", G, tuft(1))
    deco("deco.grass.b", G, tuft(2))

    def tree_round(c, f):
        c.rect(9, 20, 11, 28, 5)
        c.set(12, 27, 6)
        c.ellipse(10.5, 11, 8, 8.5, 2)
        c.ellipse(8, 8, 4.5, 4, 3)
        c.ellipse(13, 14, 4, 3, 4)
        for (x, y) in ((6, 6), (9, 4), (12, 8), (5, 11)):
            c.set(x, y, 7)
    deco("deco.tree.a", ["transparent", "#142410", "#3f7a32", "#5ea347", "#2e5c26", "#5a3d26", "#3e2a19", "#7cc35a"],
         tree_round, size=(21, 30), outline=True, anchor=(10, 28))

    def tree_pine(c, f):
        c.rect(9, 24, 11, 28, 5)
        for i, (top, half) in enumerate(((2, 3), (8, 6), (14, 8))):
            for y in range(top, top + 9):
                w = int(half * (y - top + 1) / 9) + 1
                c.rect(10 - w, y, 10 + w, y, 2 if i % 2 == 0 else 4)
            c.line(10, top + 1, 10 - half // 2, top + 8, 3)
    deco("deco.tree.b", ["transparent", "#0f1d12", "#2b5a33", "#3f7a46", "#234a2a", "#5a3d26", "#3e2a19"],
         tree_pine, size=(21, 30), outline=True, anchor=(10, 28))

    def bush(c, f):
        c.ellipse(7, 7, 6, 4, 2)
        c.ellipse(5, 5.5, 3, 2, 3)
        c.set(9, 8, 4); c.set(3, 8, 4)
    deco("deco.bush.a", ["transparent", "#142410", "#3f7a32", "#5ea347", "#2e5c26"], bush, size=(14, 11),
         outline=True, anchor=(7, 10))

    def fern(c, f):
        for dx in (-4, -2, 0, 2, 4):
            top = 3 + abs(dx)
            c.line(6, 11, 6 + dx, top, 2 if dx else 3)
            c.set(6 + dx, top, 4)
    deco("deco.fern.a", G, fern)

    F = ["transparent", "#4f8a2c", "#ff9ccf", "#fff3c4", "#ffd84a", "#c58cff"]

    def flowers(seed):
        def draw(c, f):
            rng = random.Random(seed)
            for _ in range(3):
                x, y = rng.randint(2, 9), rng.randint(6, 9)
                c.line(x, 11, x, y + 1, 1)
                col = rng.choice((2, 3, 4, 5))
                c.set(x, y, col); c.set(x - 1, y, col); c.set(x + 1, y, col); c.set(x, y - 1, col)
                c.set(x, y, 4 if col != 4 else 3)
        return draw
    deco("deco.flowers.a", F, flowers(4))
    deco("deco.flowers.b", F, flowers(8))

    def bigflower(petal):
        def draw(c, f):
            c.line(8, 15, 8, 7, 1)
            c.ellipse(5.5, 12, 2, 1, 1)
            c.ellipse(8, 5, 3.5, 3.5, petal)
            c.ellipse(8, 5, 1.4, 1.4, 4)
        return draw
    deco("deco.bigflower.a", F, bigflower(2), size=(16, 16))
    deco("deco.bigflower.b", F, bigflower(5), size=(16, 16))

    def glowflower(c, f):
        c.line(6, 11, 6, 6, 1)
        c.line(9, 11, 9, 4, 1)
        for (x, y) in ((6, 5), (9, 3)):
            c.ellipse(x + 0.5, y + 0.5, 1.6, 1.6, 2 if f == 0 else 3)
            c.set(x, y, 4)
    deco("deco.glowflower.a", ["transparent", "#3d7a70", "#7cf2ff", "#c8fbff", "#ffffff"], glowflower,
         frames=2, durations=[1.0, 1.0])

    def spores(c, f):
        pts = [((2, 8), (3, 7)), ((6, 4), (6, 3)), ((9, 7), (10, 6)), ((4, 2), (5, 1))]
        for i, (a, b) in enumerate(pts):
            x, y = (a, b)[(f + i) % 2]
            c.set(x, y, 1 + (f + i) % 3)
    deco("deco.spores.a", ["transparent", "#7cf2ff", "#c8fbff", "#5ad0e0"], spores, frames=3, durations=[0.5, 0.5, 0.5])

    def mossrock(c, f):
        c.ellipse(6, 9, 5, 3.5, 2, clip=lambda x, y: y <= 11)
        c.ellipse(5, 7, 3.5, 1.6, 4)
        c.set(8, 9, 3); c.set(3, 10, 3)
    deco("deco.mossrock.a", ["transparent", "#2a2430", "#7c7c86", "#5e5e68", "#6a9a48"], mossrock, outline=True)

    def pebbles(c, f):
        for (x, y) in ((3, 10), (7, 9), (9, 11)):
            c.rect(x, y, x + 1, y, 2)
            c.set(x, y - 1, 3)
    deco("deco.pebbles.a", ["transparent", "#2a2430", "#7c7c86", "#b8b8c4"], pebbles, outline=True)

    def crystals(c, f):
        for (x, top) in ((4, 4), (6, 2), (8, 5)):
            c.line(x, 11, x, top, 2)
            c.line(x + 1, 11, x + 1, top + 1, 4)
            c.set(x, top, 3)
    deco("deco.crystals.a", ["transparent", "#1a1420", "#7ce0ff", "#ffffff", "#4aa8c8"], crystals, outline=True)

    def puddle(c, f):
        c.ellipse(6, 6, 5.5, 2.5, 1)
        c.ellipse(5, 5.5, 2.5, 1, 2)
    deco("deco.puddle.a", ["transparent", "#2a4e6e", "#7fb0d4"], puddle, anchor=(6, 6))

    def roots(c, f):
        c.line(1, 9, 5, 7, 1); c.line(5, 7, 9, 8, 1); c.line(9, 8, 11, 6, 1)
        c.line(4, 10, 7, 9, 2)
    deco("deco.roots.a", ["transparent", "#5a3c30", "#7a5440"], roots, anchor=(6, 9))

    def stalagmite(c, f):
        for y in range(2, 16):
            half = (y - 2) // 4
            c.rect(6 - half, y, 6 + half, y, 2)
        c.line(6, 3, 6, 12, 3)
    deco("deco.stalagmite.a", ["transparent", "#1c1824", "#6c6278", "#9a90a8"], stalagmite, size=(12, 16), outline=True)

    def lichen(c, f):
        for (x, y) in ((3, 5), (4, 5), (4, 6), (7, 4), (8, 4), (8, 5), (6, 7)):
            c.set(x, y, 1 if (x + y) % 2 else 2)
    deco("deco.lichen.a", ["transparent", "#9ab86a", "#c8d88a"], lichen, anchor=(6, 6))

    def leaf(c, f):
        c.ellipse(6, 6, 2.5, 1.5, 1)
        c.line(4, 6, 8, 6, 2)
    deco("deco.leaf.a", ["transparent", "#c2611f", "#8a4a1a"], leaf, anchor=(6, 6))

    def twig(c, f):
        c.line(2, 7, 9, 5, 1)
        c.line(6, 6, 7, 4, 1)
    deco("deco.twig.a", ["transparent", "#5a3d26"], twig, anchor=(6, 6))


if __name__ == "__main__":
    import gen_topdown  # top-down 16x16 ground, overlays and shrub treeline
    gen_topdown.main()
    make_creatures()
    make_items()
    make_decorations()
    import gen_content_sprites  # art for every entry in the spawn-table content
    gen_content_sprites.main()
    import gen_ui  # pixel-art UI icons and effects
    gen_ui.main()
    import gen_geodes  # stone-ball geodes, pixel crack stages, opened geodes
    gen_geodes.main()
    import gen_terrain  # each stat's terrain: rocks/cliffs, holes/caverns, wet/bog, tall grass, spawn markers
    gen_terrain.main()
    count = sum(len(files) for _, _, files in os.walk(OUT))
    print("wrote %d sprite/palette files to %s" % (count, OUT))
