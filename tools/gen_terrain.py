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


# ------------------------------------------------------------------ 9 intensity stages per stat
# Each stat adds to the base grass (never the whole tile); stage 1 is a hint, stage 9 is dramatic.
# Overlays: ov.<stat>.s<n><a|b> (16x16, ground palette). Stone: deco.spikes.<n><a|b> (rises up).
STAGES = range(1, 10)
SPIKE = ["transparent", OUTLINE, "#8a8a96", "#b4b4c0", "#5e5e6a", "#dcdce6", "#44444e", "#9a9aa6"]


def stone_spikes():
    for n in STAGES:
        for v in "ab":
            rng = rng_for("spikes%d%s" % (n, v))
            heights = [0, 0, 3, 4, 6, 8, 11, 14, 18][n - 1]
            count = [0, 0, 1, 2, 2, 3, 3, 4, 5][n - 1]
            pebbles = [2, 4, 5, 4, 4, 3, 3, 3, 4][n - 1]
            H = 22

            def draw(c, f, rng=rng, heights=heights, count=count, pebbles=pebbles):
                # gravel at the base
                for _ in range(pebbles):
                    x, y = rng.randint(2, 13), rng.randint(H - 4, H - 2)
                    c.set(x, y, 2); c.set(x + 1, y, 4)
                    if rng.random() < .5:
                        c.set(x, y - 1, 3)
                # spikes: tallest in the middle, lit on the left, shaded on the right
                xs = sorted(rng.sample(range(3, 13), count)) if count else []
                for i, x in enumerate(xs):
                    mid = abs(i - (count - 1) / 2)
                    h = max(2, int(round(heights * (1 - 0.28 * mid) * rng.uniform(.85, 1.05))))
                    w = 1 + (1 if heights >= 6 else 0) + (1 if heights >= 14 and mid < 1 else 0)
                    for k in range(h):
                        y = H - 2 - k
                        half = max(0, round(w * (1 - k / h)))
                        for dx in range(-half, half + 1):
                            col = 3 if dx < 0 else (4 if dx > 0 else 2)
                            if k > h - 3 and dx == 0:
                                col = 5 if heights >= 8 else 3
                            c.set(x + dx, y, col)
                    if heights >= 11:               # a crack line on big spikes
                        for k in range(2, h // 2):
                            c.set(x + (1 if k % 3 else 0), H - 2 - k, 6)
                    c.set(x - half - 0, H - 1, 6)
            deco("deco.spikes.%d%s" % (n, v), SPIKE, draw, size=(16, H), anchor=(8, H - 2), outline=n >= 3)

            def mossy(c, f, draw=draw, seed=n * 10 + ord(v)):
                # Verdure softens Stone: the same spikes with moss over their bases and shoulders.
                draw(c, f)
                r2 = rng_for("mossy%d" % seed)
                rock = [row[:] for row in c.px]                       # decide from the untouched spikes
                for y in range(c.h):
                    for x in range(c.w):
                        if rock[y][x] not in (2, 3, 4, 6):
                            continue
                        top = y == 0 or rock[y - 1][x] in (0, 1)        # the upper edge of the rock
                        if (top and r2.random() < (.25 if n <= 4 else .45)) or (n >= 5 and y >= H - 3 and r2.random() < .4):
                            c.set(x, y, 8 if r2.random() < .6 else 9)
                for _ in range(1 + n // 2):                            # a few moss tufts at the foot
                    x = r2.randint(2, 13)
                    if c.get(x, H - 2) == 0:
                        c.set(x, H - 2, 8)
            deco("deco.spikes.moss.%d%s" % (n, v), SPIKE + ["#7aa82e", "#b4dc5a"], mossy, size=(16, H), anchor=(8, H - 2), outline=n >= 3)


def staged_overlays():
    def dirt(n):
        def d(c, rng, f):
            if n == 1:
                for _ in range(3):
                    c.set(*pt(rng, 2), P["dirt"])
                return
            r = [0, .9, 1.4, 2, 2.6, 3.2, 3.9, 4.6, 5.3][n - 1]
            patches = [0, 1, 1, 1, 2, 2, 2, 2, 2][n - 1]
            centres = [(8 + rng.uniform(-2, 2), 8 + rng.uniform(-2, 2))]
            if patches > 1:
                centres.append((8 + rng.uniform(-4, 4), 8 + rng.uniform(-4, 4)))
            for i, (x, y) in enumerate(centres):
                rr = r * (1 if i == 0 else .6)
                blob(c, x, y, rr, rr * .8, P["dirt"], edge=P["dirt_d"])
                c.ellipse(x - rr * .3, y - rr * .3, rr * .45, rr * .3, P["dirt_l"])
            for _ in range([0, 1, 1, 2, 2, 3, 3, 4, 5][n - 1]):     # roots
                x, y = centres[0][0] + rng.uniform(-r, r), centres[0][1] + rng.uniform(-r, r)
                dx = rng.choice((-1, 1))
                for k in range(rng.randint(2, 3 + n // 2)):
                    c.set(x, y, P["loam_root"]); x += dx; y += rng.choice((0, 0, 1, -1))
            if n >= 7:                                               # a burrow hole
                hr = 1.2 + (n - 7) * .6
                x, y = centres[0]
                c.ellipse(x, y + .5, hr + .6, hr * .7 + .4, P["loam_d"])
                c.ellipse(x, y + .7, hr, hr * .6, P["cave_d"])
        return d

    def damp(n):
        def d(c, rng, f):
            glints = [2, 4, 3, 4, 4, 4, 5, 5, 6][n - 1]
            if n >= 3:
                spots = [0, 0, 1, 2, 1, 1, 1, 2, 2][n - 1]
                for i in range(spots):
                    x, y = pt(rng, 4)
                    r = [0, 0, 1.6, 1.8, 3, 3.4, 3.8, 4.2, 5.5][n - 1] * (1 if i == 0 else .7)
                    blob(c, x, y, r, r * .75, P["grass_dd"], edge=P["lush_d"])   # dark, soaked grass
                    c.set(x, y, P["water_l"])
            if n >= 6:
                pools = [0] * 5 + [1, 1, 2, 2]
                for i in range(pools[n - 1]):
                    x, y = pt(rng, 4)
                    r = 1.2 + (n - 6) * .5
                    blob(c, x, y, r + .5, r * .7 + .4, P["water"], edge=P["water_d"])
                    c.set(x - 1, y - 1, P["water_hi"])
            for _ in range(glints):
                x, y = pt(rng, 1)
                c.set(x, y, P["water_hi"] if (n < 3 or rng.random() < .6) else P["water_l"])
        return d

    def glow(n):
        def d(c, rng, f):
            if n >= 4:                                              # glowing moss dots
                for _ in range(n - 2):
                    x, y = pt(rng, 2)
                    c.set(x, y, P["gm_m"]); c.set(x + 1, y, P["gm"])
            if n >= 7:                                              # tiny glowing caps
                for _ in range(n - 6):
                    x, y = pt(rng, 3)
                    c.set(x, y, P["gm_glow"]); c.set(x - 1, y, P["gm_glow"]); c.set(x + 1, y, P["gm_glow"])
                    c.set(x, y + 1, P["gm_hi"])
            for i in range(n * 2):                                  # motes, twinkling between frames
                x, y = pt(rng, 1)
                if (i + f) % 2 == 0 or n >= 6:
                    c.set(x, y, P["gm_hi"] if n >= 5 else P["gm_glow"])
        return d

    FLOWERS = ["pink", "white", "yellow", "violet"]

    def bloom(n):
        def d(c, rng, f):
            total = [1, 2, 3, 4, 5, 6, 7, 9, 12][n - 1]
            big = [0, 0, 0, 0, 0, 1, 2, 3, 5][n - 1]
            for i in range(total):
                x, y = pt(rng, 2)
                col = P[FLOWERS[rng.randint(0, 3)]]
                if n >= 3:
                    c.set(x, y + 1, P["lush_d"])                    # stem
                if i < big:                                         # a proper blossom
                    for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                        c.set(x + dx, y + dy, col)
                    c.set(x, y, P["yellow"] if col != P["yellow"] else P["white"])
                elif n >= 4:
                    c.set(x, y, col); c.set(x + 1, y, col)
                else:
                    c.set(x, y, col)
        return d

    def verdure(n):
        def d(c, rng, f):
            blades = 3 + n * 3
            tall = 2 + n
            for _ in range(blades):
                x, y = rng.randint(0, 15), rng.randint(tall // 2 + 1, 15)
                h = rng.randint(max(1, tall // 2), tall)
                lean = rng.choice((-1, 0, 1)) if h > 4 else 0
                for k in range(h):
                    col = P["lush_d"] if k < h / 3 else (P["lush"] if k < h - 1 else P["lush_l"])
                    c.set(x + (lean if k > h * .6 else 0), y - k, col)
            if n >= 6:                                              # leafy fronds
                for _ in range(n - 4):
                    x, y = pt(rng, 3)
                    for k in range(3):
                        c.set(x - k, y - k, P["lush"]); c.set(x + k, y - k, P["lush"])
                    c.set(x, y - 3, P["lush_ll"])
        return d

    fams = {"dirt": dirt, "damp": damp, "glow": glow, "bloom": bloom, "verdure": verdure}
    for name, fn in fams.items():
        for n in STAGES:
            for v in "ab":
                frames = 2 if name == "glow" else 1
                overlay("ov.%s.s%d%s" % (name, n, v), fn(n), frames=frames, durations=[0.9, 0.9] if frames > 1 else None)


def combo_art():
    # Stone + Damp + Verdure: patches of moss creeping over everything.
    def moss(c, rng, f):
        for _ in range(4):
            x, y = pt(rng, 3)
            r = rng.uniform(2.2, 3.6)
            blob(c, x, y, r, r * .8, P["moss"], edge=P["moss_d"])
            c.ellipse(x - r * .3, y - r * .3, r * .5, r * .35, P["moss_l"])
            c.set(x + 1, y, P["moss_ll"])
    for v in "ab":
        overlay("ov.moss.%s" % v, moss)

    # Bloom + Verdure: a tangle of flowers through long grass.
    def meadow(c, rng, f):
        for _ in range(10):
            x, y = rng.randint(0, 15), rng.randint(5, 15)
            for k in range(rng.randint(3, 6)):
                c.set(x, y - k, P["lush"] if k else P["lush_d"])
        for _ in range(7):
            x, y = pt(rng, 2)
            col = P[("pink", "white", "yellow", "violet")[rng.randint(0, 3)]]
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                c.set(x + dx, y + dy, col)
            c.set(x, y, P["yellow"])
    for v in "ab":
        overlay("ov.meadow.%s" % v, meadow)


def named_terrain_art():
    """One overlay per named terrain (tuning.terrains): ov.terrain.<id>.a/b. Glowing ones twinkle (2 frames)."""
    def specks(c, rng, n, cols, m=1):
        for _ in range(n):
            x, y = pt(rng, m)
            c.set(x, y, P[cols[rng.randint(0, len(cols) - 1)]])

    def twinkle(c, rng, f, n, lit="gm_glow", hi="gm_hi"):
        for i in range(n):
            x, y = pt(rng, 1)
            on = (i + f) % 2 == 0
            c.set(x, y, P[hi if on else lit])
            if on:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if rng.random() < .5:
                        c.set(x + dx, y + dy, P[lit])

    def flowers(c, rng, n, cols, centre="yellow"):
        for _ in range(n):
            x, y = pt(rng, 2)
            col = P[cols[rng.randint(0, len(cols) - 1)]]
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                c.set(x + dx, y + dy, col)
            c.set(x, y, P[centre])

    def rocks(c, rng, n, r=(1.2, 2.2), lit="rock_l", base="rock", edge="rock_d"):
        for _ in range(n):
            x, y = pt(rng, 3)
            rr = rng.uniform(*r)
            blob(c, x, y, rr, rr * .75, P[base], edge=P[edge])
            c.set(x - 1, y - 1, P[lit])

    def puddles(c, rng, n, base="water", hi="water_hi", edge="mud_d"):
        for _ in range(n):
            x, y = pt(rng, 3)
            rr = rng.uniform(1.6, 2.8)
            blob(c, x, y, rr, rr * .6, P[base], edge=P[edge])
            c.set(x - 1, y, P[hi])

    def crystals(c, rng, n, cols=("cr_cyan", "cr_dcyan"), hi="cr_white", f=0):
        for i in range(n):
            x, y = pt(rng, 3)
            h = rng.randint(2, 4)
            for k in range(h):
                c.set(x, y - k, P[cols[0]]); c.set(x + 1, y - k, P[cols[1]])
            c.set(x, y - h, P[hi] if (i + f) % 2 == 0 else P[cols[0]])
            c.set(x - 1, y, P[cols[1]])

    def fronds(c, rng, n, col="lush", lit="lush_l", dark="lush_d"):
        for _ in range(n):
            x, y = rng.randint(2, 13), rng.randint(6, 15)
            d = 1 if rng.random() < .5 else -1
            for k in range(5):
                c.set(x + d * (k // 2), y - k, P[col])
                if k % 2 == 0:
                    c.set(x + d * (k // 2) - 1, y - k, P[lit]); c.set(x + d * (k // 2) + 1, y - k, P[dark])

    def roots(c, rng, n, col="loam_root", dark="loam_d"):
        for _ in range(n):
            x, y = pt(rng, 1)
            dx, dy = rng.choice(((1, 0), (1, 1), (0, 1), (-1, 1)))
            for k in range(rng.randint(4, 8)):
                c.set(x, y, P[col]); c.set(x, y + 1, P[dark])
                x += dx if rng.random() < .8 else 0
                y += dy if rng.random() < .6 else 0

    def patches(c, rng, n, base, edge, r=(2, 3.2)):
        for _ in range(n):
            x, y = pt(rng, 3)
            rr = rng.uniform(*r)
            blob(c, x, y, rr, rr * .7, P[base], edge=P[edge])

    def wisps(c, rng, f, n):
        for i in range(n):
            x, y = pt(rng, 3)
            y -= (i + f) % 2
            c.ellipse(x + .5, y + .5, 1.6, 1.6, P["gm_glow"])
            c.set(x, y, P["gm_hi"]); c.set(x + 1, y, P["gm_hi"])

    def mossy_rocks(c, rng, n):
        for _ in range(n):
            x, y = pt(rng, 4)
            rr = rng.uniform(2.2, 3)
            blob(c, x, y, rr, rr * .75, P["rock"], edge=P["rock_d"])
            c.ellipse(x + .5, y - rr * .35, rr * .9, rr * .4, P["moss_l"])
            c.set(x - 1, y - 1, P["moss_ll"]); c.set(x + 1, y + 1, P["rock_l"])
            for k in range(rng.randint(2, 3)):
                c.set(x - 2 + k * 2, y + int(rr * .6), P["moss"])

    A = {
        "rain-garden": (1, lambda c, r, f: (puddles(c, r, 2), flowers(c, r, 4, ("pink", "violet", "white")), specks(c, r, 6, ("water_l",)))),
        "dripstone-ledge": (1, lambda c, r, f: (rocks(c, r, 3, (1.8, 2.6)), specks(c, r, 8, ("water_l", "water_hi")), puddles(c, r, 1))),
        "fernbrake": (1, lambda c, r, f: (patches(c, r, 2, "mud_m", "mud_d", (1.6, 2.4)), fronds(c, r, 7, "lush_l", "lush_ll", "grass_dd"))),
        "crystal-outcrop": (2, lambda c, r, f: (rocks(c, r, 2), crystals(c, r, 4, f=f))),
        "lantern-hollow": (2, lambda c, r, f: (patches(c, r, 2, "cave_m", "cave_d"), roots(c, r, 2), twinkle(c, r, f, 6))),
        "moonlit-garden": (2, lambda c, r, f: (flowers(c, r, 5, ("white", "white", "violet"), "cr_white"), twinkle(c, r, f, 4, "gm_hi", "cr_white"))),
        "wisp-thicket": (2, lambda c, r, f: (fronds(c, r, 5, "lush_l", "lush_ll", "grass_dd"), wisps(c, r, f, 3))),
        "rock-garden": (1, lambda c, r, f: (rocks(c, r, 4, (1, 1.8)), flowers(c, r, 4, ("pink", "yellow", "violet"), "white"))),
        "sunken-garden": (1, lambda c, r, f: (patches(c, r, 2, "loam", "loam_d"), flowers(c, r, 4, ("violet", "pink", "white")))),
        "geode-bed": (1, lambda c, r, f: (patches(c, r, 3, "dirt", "dirt_d"), crystals(c, r, 3, ("cr_violet", "rock_d"), "cr_white"))),
        "overgrown-rocks": (1, lambda c, r, f: (mossy_rocks(c, r, 3), fronds(c, r, 3, "moss_l", "moss_ll", "moss_d"))),
        "root-tangle": (1, lambda c, r, f: (patches(c, r, 2, "loam", "loam_d"), roots(c, r, 6))),
        "glowworm-grotto": (2, lambda c, r, f: (patches(c, r, 3, "cave_d", "cave"), twinkle(c, r, f, 12, "cr_cyan", "cr_white"))),
        "heartwood-grove": (2, lambda c, r, f: (roots(c, r, 4), fronds(c, r, 3), flowers(c, r, 3, ("pink", "white")), twinkle(c, r, f, 3, "yellow", "white"))),
        "heartstone-vein": (2, lambda c, r, f: (rocks(c, r, 3, (2, 2.8)), roots(c, r, 2, "cr_violet", "cr_dcyan"), twinkle(c, r, f, 4, "cr_violet", "cr_white"))),
        "amethyst-seep": (2, lambda c, r, f: (puddles(c, r, 2), crystals(c, r, 4, ("cr_violet", "rock_d"), "cr_white", f=f))),
    }
    # Foxfire Fen: static roots through wet mud; a matching glow layer traces the same roots and the
    # renderer pulses its opacity (tileRules "pulse"), so the ground seems to breathe.
    def foxfire_roots(rng):
        paths = []
        for _ in range(3):
            x, y = rng.randint(1, 14), rng.randint(1, 6)
            pts = []
            for k in range(rng.randint(7, 11)):
                pts.append((x, y))
                x += rng.choice((-1, 0, 1, 1))
                y += 1 if rng.random() < .75 else 0
                if not (0 <= x < T and 0 <= y < T):
                    break
            paths.append(pts)
        return paths

    for v in "ab":
        sid = "ov.terrain.foxfire-fen.%s" % v
        paths = foxfire_roots(rng_for(sid, 5))

        def base(c, rng, f, paths=paths):
            patches(c, rng, 3, "mud", "mud_d")
            for pts in paths:
                for (x, y) in pts:
                    c.set(x, y, P["loam_root"]); c.set(x, y + 1, P["loam_d"])

        def glow(c, rng, f, paths=paths):
            for pts in paths:
                for i, (x, y) in enumerate(pts):
                    c.set(x, y, P["gm_hi"] if i % 3 == 0 else P["gm_glow"])
                    if i % 3 == 0:
                        for dx, dy in ((1, 0), (-1, 0)):
                            c.set(x + dx, y + dy, P["gm_glow"])
        overlay(sid, base)
        overlay("ov.terrain.foxfire-fen.glow.%s" % v, glow)

    for tid, (frames, fn) in A.items():
        for v in "ab":
            def draw(c, rng, f, fn=fn):
                fn(c, rng, f)
            overlay("ov.terrain.%s.%s" % (tid, v), draw, frames=frames, durations=[0.9, 0.9] if frames > 1 else None)


def lily_pads():
    """Lily pads for larger pools: round pads with a notch, one with a flower."""
    pal = ["transparent", "#183a1c", "#3f8a3a", "#5bb04a", "#2d6a2c", "#ffd0e0", "#ff9ccf", "#ffd84a"]

    def pad(c, f, rx=4.2, ry=2.8, flower=False):
        cx, cy = c.w / 2, c.h / 2
        c.ellipse(cx, cy, rx, ry, 2)
        c.ellipse(cx - rx * .3, cy - ry * .35, rx * .5, ry * .4, 3)
        c.ellipse(cx + rx * .35, cy + ry * .3, rx * .45, ry * .35, 4)
        for i in range(int(rx) + 1):                       # the notch
            c.set(cx + i, cy, 0)
        c.set(cx - 1, cy, 4)
        if flower:
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                c.set(cx - 1 + dx, cy - 1 + dy, 6)
            c.set(cx - 1, cy - 1, 7)
    deco("deco.lilypad.a", pal, pad, size=(11, 7), anchor=(5, 3), outline=True)
    deco("deco.lilypad.b", pal, lambda c, f: pad(c, f, 3, 2.1), size=(9, 6), anchor=(4, 3), outline=True)
    deco("deco.lilypad.flower", pal, lambda c, f: pad(c, f, 4.2, 2.8, True), size=(11, 7), anchor=(5, 3), outline=True)


def pt(rng, m=1):
    return rng.randint(m, T - 1 - m), rng.randint(m, T - 1 - m)


_old_main = main


def main():
    _old_main()
    stone_spikes()
    staged_overlays()
    combo_art()
    named_terrain_art()
    lily_pads()
