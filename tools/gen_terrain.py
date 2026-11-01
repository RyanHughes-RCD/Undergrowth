#!/usr/bin/env python3
"""Terrain art for each stat's identity (run via gen_placeholders.py).

Stone builds up (rocky ground, rocks, boulders, ledges, cliff tops; mossy when Verdure is there too),
Depth digs down (bare dark soil, burrows, holes, cavern openings), Damp is wet (wet soil, bog,
drips), Verdure is tall (tall grass, vines over rocks), Bloom closes at night (buds), plus the
markers for buried spawns (loose soil) and spawns hidden in tall grass (a rustling clump).
Ground tiles and overlays use the shared ground palette; decorations carry their own palettes.
"""
from gen_placeholders import Canvas, write, deco, P
from gen_topdown import tile, overlay, blob, rng_for, T

OUTLINE = "#1b1420"
ROCK = ["transparent", OUTLINE, "#7c7c86", "#9a9aa6", "#5e5e68", "#b8b8c4", "#45454e"]       # 2 mid 3 light 4 dark 5 highlight 6 deep
MOSS = ["#4f7a3a", "#6a9a48", "#83b45a", "#2f5a26"]
SOIL = ["transparent", "#24160e", "#3e2b2a", "#2e1f22", "#5a3c30", "#7a5232", "#120c18", "#221a2c"]   # 1 outline 2 loam 3 dark 4 rim 5 lit rim 6 void 7 deep


def ground_tiles():
    # Stone: rocky ground, then a raised cliff top (the renderer adds the cliff face below it).
    def rocky(c, rng, f):
        for _ in range(4):
            x, y = rng.randint(2, 13), rng.randint(2, 13)
            blob(c, x, y, rng.uniform(1.6, 2.8), rng.uniform(1.2, 2), P["rock"], edge=P["rock_d"])
            c.set(x - 1, y - 1, P["rock_l"])
    tile("tile.rock.a", "soil_d", [("rock_d", .12), ("soil", .1)], extra=rocky)

    def cliff(c, rng, f, mossy=False):
        for _ in range(3):                                   # cracks
            x, y = rng.randint(2, 12), rng.randint(2, 12)
            for i in range(rng.randint(3, 5)):
                c.set(x, y, P["rock_d"]); x += rng.choice((0, 1)); y += 1
        c.rect(0, 0, T - 1, 0, P["rock_ll"])                # lit top-left edges
        c.rect(0, 0, 0, T - 1, P["rock_l"])
        if mossy:                                            # Verdure softens Stone: moss over the top
            for (x, y, r) in ((4, 4, 3.2), (11, 9, 2.6), (6, 12, 2)):
                blob(c, x, y, r, r * .8, P["moss"], edge=P["moss_d"])
                c.set(x - 1, y - 1, P["moss_ll"])
    tile("tile.cliff.a", "rock", [("rock_l", .12), ("rock_d", .1), ("rock_ll", .03)], extra=cliff)
    tile("tile.cliff.moss", "rock", [("rock_l", .1), ("rock_d", .1), ("moss", .05)], extra=lambda c, r, f: cliff(c, r, f, True))

    # Depth: bare dark soil (looks fairly empty on top), then a cavern opening.
    def bare(c, rng, f):
        for _ in range(2):
            x, y = rng.randint(1, 13), rng.randint(1, 13)
            c.line(x, y, x + rng.randint(2, 4), y + rng.randint(-1, 1), P["loam_root"])
    tile("tile.bare.a", "loam", [("loam_d", .18), ("loam_m", .1)], extra=bare)

    def cavern(c, rng, f):
        c.ellipse(8, 8.5, 7.2, 6.4, P["loam_m"])            # rim
        c.ellipse(8, 8.8, 6.2, 5.4, P["cave_l"])
        c.ellipse(8, 9.4, 5.2, 4.4, P["cave_m"])
        c.ellipse(8, 9.8, 4, 3.3, P["cave"])
        c.ellipse(8, 10.2, 2.6, 2, P["cave_d"])
        for x in range(4, 12):                               # lit far wall (light from the top-left)
            c.set(x, 13 if 5 < x < 10 else 12, P["loam_root"])
    tile("tile.cavern.a", "loam_d", [("loam", .15)], extra=cavern)

    # Damp: darker wet soil with glints, and boggy low ground.
    def wet(c, rng, f):
        for _ in range(3):
            x, y = rng.randint(1, 14), rng.randint(1, 14)
            c.set(x, y, P["water_hi"])
    tile("tile.wet.a", "mud", [("mud_d", .2), ("mud_m", .12), ("moss_d", .04)], extra=wet)

    def bog(c, rng, f):
        for _ in range(3):
            x, y = rng.randint(3, 12), rng.randint(3, 12)
            blob(c, x, y, rng.uniform(2.2, 3.6), rng.uniform(1.6, 2.6), P["water"], edge=P["water_d"])
            c.set(x - 1, y - 1, P["water_l"]); c.set(x, y - 1, P["water_hi"])
        for _ in range(3):                                   # reeds
            x, y = rng.randint(1, 14), rng.randint(3, 14)
            c.set(x, y, P["moss"]); c.set(x, y - 1, P["moss_l"])
    tile("tile.bog.a", "mud_d", [("mud", .2), ("water_d", .08)], extra=bog)


def overlays():
    # Verdure on Stone: vines creeping over rock.
    def vines(level):
        def d(c, rng, f):
            for _ in range(1 + level):
                x, y = rng.randint(0, 15), 0 if rng.random() < .5 else rng.randint(0, 6)
                for i in range(rng.randint(5, 10)):
                    c.set(x, y, P["lush"] if i % 3 else P["lush_l"])
                    if i % 4 == 2:
                        c.set(x + 1, y, P["lush_d"])
                    y += 1; x += rng.choice((-1, 0, 0, 1))
        return d
    for level in (1, 2):
        for v in "ab":
            overlay("ov.vines.%d%s" % (level, v), vines(level))

    # Bloom when closed (night / outside its cycle): green buds with a hint of colour.
    def buds(level):
        def d(c, rng, f):
            for _ in range(2 + level * 2):
                x, y = rng.randint(1, 14), rng.randint(2, 14)
                c.set(x, y, P["lush_d"]); c.set(x, y - 1, P["lush"])
                c.set(x, y - 2, P["pink"] if rng.random() < .6 else P["violet"])
        return d
    for level in (1, 2):
        for v in "ab":
            overlay("ov.buds.%d%s" % (level, v), buds(level))


def stone_decorations():
    def rock(c, f, w=4, h=3):
        c.ellipse(5, 6, w, h, 2, clip=lambda x, y: y <= 7)
        c.ellipse(4, 5, w * .55, h * .5, 3)
        c.set(3, 4, 5)
        c.rect(2, 7, 8, 7, 4)
    deco("deco.rock.a", ROCK, rock, size=(10, 9), outline=True)
    deco("deco.rock.b", ROCK, lambda c, f: rock(c, f, 3.4, 2.6), size=(10, 9), outline=True)

    def boulder(c, f, mossy=False):
        c.ellipse(8, 9, 6.5, 5.5, 2, clip=lambda x, y: y <= 12)
        c.ellipse(6.5, 7, 3.6, 2.8, 3)
        c.ellipse(5.5, 6, 1.6, 1, 5)
        c.ellipse(10.5, 11, 3.2, 1.6, 4)
        c.rect(3, 12, 13, 12, 6)
        c.set(9, 8, 4); c.set(10, 8, 4); c.set(11, 9, 4)       # a crack
        if mossy:                                               # moss cap + trailing vines, inside the rock
            inside = {(x, y) for y in range(c.h) for x in range(c.w) if c.get(x, y)}
            for y in range(c.h):
                for x in range(c.w):
                    if (x, y) in inside and ((x + .5 - 7.5) / 5.6) ** 2 + ((y + .5 - 5.2) / 2.6) ** 2 <= 1:
                        c.set(x, y, 7 if (x + y) % 5 else 8)
            for (x, y) in ((4, 7), (4, 8), (5, 9), (11, 7), (12, 8), (12, 9), (8, 7)):
                if (x, y) in inside:
                    c.set(x, y, 9)
    deco("deco.boulder.a", ROCK, boulder, size=(16, 14), outline=True)
    deco("deco.boulder.moss", ROCK + MOSS[:2] + [MOSS[3]], lambda c, f: boulder(c, f, True), size=(16, 14), outline=True)

    def ledge(c, f):
        # A raised slab of rock: uneven lit top, darker front face with cracks.
        tops = [4, 3, 3, 3, 2, 2, 3, 3, 3, 2, 3, 3, 4, 4]
        bottoms = [10, 11, 11, 11, 11, 11, 10, 11, 11, 11, 11, 10, 10, 9]
        for i, x in enumerate(range(1, 15)):
            t, b = tops[i], bottoms[i]
            c.rect(x, t, x, t + 4, 3)
            c.set(x, t, 5 if x < 9 else 3)
            c.rect(x, t + 5, x, b, 4)
            c.set(x, b, 6)
        for (x, y) in ((4, 8), (4, 9), (9, 7), (10, 8), (10, 9), (12, 8)):
            c.set(x, y, 6)
        for (x, y) in ((5, 5), (6, 5), (11, 4)):
            c.set(x, y, 2)
    deco("deco.ledge.a", ROCK, ledge, size=(16, 13), outline=True)


def depth_decorations():
    def hole(c, f, rx, ry, cx, cy):
        c.ellipse(cx, cy + .6, rx + 1.4, ry + 1.2, 4)           # kicked-up dirt rim
        c.ellipse(cx - .6, cy, rx + .8, ry + .5, 5, clip=lambda x, y: y < cy)
        c.ellipse(cx, cy + .4, rx, ry, 7)
        c.ellipse(cx, cy + .8, rx * .7, ry * .65, 6)
    deco("deco.burrow.a", SOIL, lambda c, f: hole(c, f, 2.4, 1.4, 5, 4), size=(10, 7), anchor=(5, 5))
    deco("deco.hole.a", SOIL, lambda c, f: hole(c, f, 4, 2.4, 7.5, 5.5), size=(15, 10), anchor=(7, 8))


def damp_decorations():
    pal = ["transparent", "#2a4e6e", "#7fb0d4", "#c8e6ff"]

    def drip(c, f):
        # A droplet falls (frames 0-2), then a ring spreads (3-4).
        if f < 3:
            y = 1 + f * 3
            c.set(3, y, 2); c.set(3, y + 1, 3)
        else:
            r = 1.2 + (f - 3) * 1.2
            c.ellipse(3.5, 10.5, r + .6, r * .45 + .4, 1)
            c.ellipse(3.5, 10.5, max(.1, r - .6), max(.1, r * .45 - .3), 0)
    deco("deco.drip.a", pal, drip, size=(7, 12), frames=5, durations=[0.18, 0.18, 0.18, 0.3, 1.6], anchor=(3, 11))


def verdure_decorations():
    pal = ["transparent", "#1f3d16", "#3f7a2c", "#5ea347", "#8ccf63", "#2d5a20"]

    def tall(c, f, n=7, seed=0):
        rng = rng_for("tall%d" % seed)
        for i in range(n):
            x = 1 + i * 10 / n + rng.uniform(-.5, .5)
            h = rng.randint(9, 14)
            lean = (1 if f else -1) * (0.5 if i % 2 else 0.25) + rng.uniform(-.2, .2)
            for k in range(h):
                c.set(x + lean * k * k / (h * 2.5), 15 - k, 2 if k < h * .5 else (3 if k < h - 2 else 4))
            c.set(x, 15, 5)
    deco("deco.tallgrass.a", pal, lambda c, f: tall(c, f, 7, 1), size=(12, 16), frames=2, durations=[1.4, 1.6])
    deco("deco.tallgrass.b", pal, lambda c, f: tall(c, f, 5, 2), size=(12, 16), frames=2, durations=[1.7, 1.3])


def spawn_markers():
    # Buried: a patch of loose, turned soil with a few clods (what's inside is a surprise).
    def buried(c, f):
        c.ellipse(7, 5, 6.5, 3.4, 4)
        c.ellipse(6, 4.2, 4.5, 2, 5)
        for (x, y) in ((3, 4), (9, 3), (6, 6), (11, 5)):
            c.set(x, y, 3)
        for (x, y) in ((4, 3), (10, 2), (8, 5)):
            c.set(x, y, 2)
        c.set(7, 4, 3); c.set(8, 3, 3); c.set(6, 3, 3)                 # a small X of cracks
        c.set(8, 5, 3); c.set(6, 5, 3)
    deco("spawn.buried.a", ["transparent", "#24160e", "#a37a4e", "#2e1f14", "#5a3d26", "#7a5232"], buried,
         size=(14, 8), anchor=(7, 6), outline=False)

    # Hidden in tall grass: a dense clump; the renderer gives it an occasional rustle.
    pal = ["transparent", "#1b1420", "#2d5a20", "#4f8a2c", "#79b84a", "#a6e57a"]

    def clump(c, f):
        rng = rng_for("clump")
        for i in range(11):
            x = 1 + i * 1.2 + rng.uniform(-.3, .3)
            h = rng.randint(8, 13)
            lean = (0.45 if f else -0.45) * (1 if i % 2 else -0.6)
            for k in range(h):
                c.set(x + lean * k * k / (h * 3), 13 - k, 2 if k < 3 else (3 if k < h - 3 else (4 if k < h - 1 else 5)))
        c.rect(2, 12, 12, 13, 2)
    deco("spawn.rustle.a", pal, clump, size=(15, 14), frames=2, durations=[0.12, 0.12], anchor=(7, 13))


def main():
    ground_tiles()
    overlays()
    stone_decorations()
    depth_decorations()
    damp_decorations()
    verdure_decorations()
    spawn_markers()
