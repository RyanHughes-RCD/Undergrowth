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


# ---------------------------------------------------------------- ground palette
# The shared palette (pal.ground) for the grass and treeline tiles. Slots are kept as they were so the
# existing art keeps its colours.
GROUND_PALETTE = [
    "transparent",
    # 1-4 soil / leaf litter
    "#6b4a2f", "#5a3d26", "#86603d", "#b5662f",
    # 5-8 grass (deep, verdant forest floor)
    "#356b2e", "#4a8a3a", "#27552a", "#6aa64a",
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
    "#d9cfb3", "#b0a587", "#f2ecd9", "#7a5232", "#5b3c22", "#93683f", "#1f4422",
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
    # Growth stages every garden plant shares before its own bud: seed in the soil, then a sprout.
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
    G = ["transparent", "#1d461c", "#33702e", "#4f9440", "#7cbc5a"]

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
    make_items()
    make_decorations()
    import gen_content_sprites  # art for every catalogue plant and fungus (and their buds)
    gen_content_sprites.main()
    import gen_ui  # pixel-art UI icons and effects
    gen_ui.main()
    import gen_garden_sprites  # seed packets, soil amendments, the seed tin, the coin
    gen_garden_sprites.main()
    import gen_terrain  # one soil tile pair per garden school
    gen_terrain.main()
    count = sum(len(files) for _, _, files in os.walk(OUT))
    print("wrote %d sprite/palette files to %s" % (count, OUT))
