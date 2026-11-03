#!/usr/bin/env python3
"""Placeholder art for Offerings: decor props, eggs, nests, school seeds, landmarks and the Old Log board icon.

    python3 tools/gen_offerings_sprites.py

Decor sprites (decor.<id>) keep their main colour in palette indices 2 (dark), 3 (mid) and 4 (light),
so the game can recolour a placed prop (cosmetics.json "colors") by swapping just those three.
Index 1 is the outline; 5+ are fixed details. All of this is placeholder art meant to be redrawn.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_placeholders import Canvas, write  # noqa: E402

OUT = "#1b1420"


def sprite(sid, palette, draw, size=(16, 16), anchor=(8, 15), frames=1, durations=None, tags=("decor",)):
    out = []
    for f in range(frames):
        c = Canvas(*size)
        draw(c, f)
        c.outline(1)
        out.append(c)
    write(sid, size, out, palette=["transparent", OUT] + palette, anchor=anchor, tags=list(tags), durations=durations)


WOOD = ["#5a3a22", "#8a5a36", "#b07a48"]
STONE = ["#5e5e68", "#8a8a96", "#b8b8c4"]
MOSS = ["#3f6a2e", "#5f9a40", "#8fc860"]


def decor():
    def bench(c, f):
        c.rect(2, 7, 13, 8, 4)          # seat
        c.rect(2, 9, 13, 9, 2)
        c.rect(3, 10, 4, 14, 2); c.rect(11, 10, 12, 14, 2)   # legs
        c.rect(2, 3, 13, 4, 3)          # backrest
        c.rect(3, 5, 3, 6, 2); c.rect(12, 5, 12, 6, 2)
        for x in (5, 8, 11):
            c.set(x, 3, 5)               # moss tufts
    sprite("decor.mossy-bench", WOOD + [MOSS[2]], bench)

    def lantern(c, f):
        c.rect(7, 4, 8, 14, 2)            # post
        c.rect(5, 14, 10, 14, 2)
        c.rect(5, 1, 10, 2, 3)            # hood
        c.rect(5, 3, 10, 7, 6 if f else 5)      # glass, glowing
        c.rect(6, 4, 9, 6, 7)
        c.rect(5, 8, 10, 8, 3)
    sprite("decor.glow-lantern", WOOD + ["#7cf2ff", "#3aa8b8", "#e8ffff"], lantern, frames=2, durations=[0.8, 0.8])

    def stones(c, f):
        for (x, y, rx) in ((4, 12, 2.6), (10, 13, 2.4), (7, 9, 2.2)):
            c.ellipse(x, y, rx, rx * 0.6, 3)
            c.ellipse(x - 0.6, y - 0.6, rx * 0.5, rx * 0.3, 4)
            c.set(int(x + rx * 0.4), int(y + 0.5), 2)
    sprite("decor.stepping-stones", STONE, stones)

    def planter(c, f):
        c.rect(3, 9, 12, 14, 3)
        c.rect(3, 9, 12, 9, 4)
        c.rect(3, 13, 12, 14, 2)
        for (x, col) in ((4, 5), (6, 6), (8, 5), (10, 6), (11, 7)):
            c.set(x, 6, col); c.set(x, 7, 8); c.set(x, 8, 8)
            c.set(x - 1, 6, col)
    sprite("decor.flower-planter", WOOD + ["#ffd84a", "#ff9ccf", "#f4f4ff", "#4f9440"], planter)

    def birdbath(c, f):
        c.ellipse(8, 5, 6, 2.2, 3)
        c.ellipse(8, 4.6, 4.6, 1.4, 5)          # water
        c.set(6, 4, 6)
        c.rect(7, 7, 8, 13, 2)
        c.rect(5, 13, 10, 14, 3)
    sprite("decor.birdbath", STONE + ["#4aa8d8", "#c8f0ff"], birdbath)

    def crystal_lamp(c, f):
        c.rect(5, 12, 10, 14, 3)
        c.rect(6, 11, 9, 11, 4)
        for (x, h) in ((6, 6), (8, 8), (10, 5)):
            for k in range(h):
                c.set(x, 11 - k, 5 if (k + f) % 3 else 6)
                c.set(x + 1 if x < 10 else x - 1, 11 - k, 7)
    sprite("decor.crystal-lamp", STONE + ["#c8a8ff", "#ffffff", "#8a5ad8"], crystal_lamp, frames=2, durations=[0.9, 0.9])

    def toadstool_ring(c, f):
        for (x, y) in ((3, 10), (8, 8), (13, 10), (5, 14), (11, 14)):
            c.rect(x, y, x, y + 1, 6)
            c.ellipse(x, y - 0.5, 1.6, 1, 3)
            c.set(x - 1, y - 1, 5)
    sprite("decor.toadstool-ring", ["#8a2a22", "#d23a2c", "#e86a5a", "#fff4e8", "#efe2c8"], toadstool_ring)

    def wind_chime(c, f):
        c.rect(3, 2, 12, 2, 3)            # bar
        c.rect(7, 0, 8, 1, 2)
        for i, x in enumerate((4, 6, 8, 10, 12)):
            ln = 5 + (i % 3) * 2
            for k in range(ln):
                c.set(x + ((f + i) % 2 if k > ln - 3 else 0), 3 + k, 5 if k < ln - 2 else 6)
    sprite("decor.wind-chime", WOOD + ["#9a9aa6", "#d8f0ff"], wind_chime, frames=2, durations=[0.6, 0.6], anchor=(8, 15))

    def root_arch(c, f):
        for x0 in (2, 12):
            c.rect(x0, 5, x0 + 1, 15, 3)
            c.set(x0, 8, 2); c.set(x0 + 1, 12, 2)
        for x in range(3, 13):
            y = 3 + int(abs(x - 7.5) * 0.45)
            c.set(x, y, 3); c.set(x, y + 1, 2)
        for (x, y) in ((4, 3), (9, 2), (12, 4), (6, 2)):
            c.set(x, y, 5)
    sprite("decor.root-arch", WOOD + [MOSS[2]], root_arch)

    def log_stool(c, f):
        c.ellipse(8, 9, 5, 2, 4)
        c.rect(3, 9, 12, 14, 3)
        c.ellipse(8, 9, 3, 1.2, 5)
        c.set(8, 9, 2)
        c.rect(3, 13, 12, 14, 2)
    sprite("decor.log-stool", WOOD + ["#d8b080"], log_stool)

    def cairn(c, f):
        c.ellipse(8, 13, 5, 1.8, 2)
        c.ellipse(8, 11, 4, 1.6, 3)
        c.ellipse(8, 8.5, 3, 1.3, 4)
        c.ellipse(8, 6.2, 2, 1, 3)
        c.set(7, 6, 4)
    sprite("decor.pebble-cairn", STONE, cairn)

    def fence(c, f):
        for x in (2, 7, 12):
            c.rect(x, 6, x + 1, 14, 3)
            c.set(x, 6, 4)
        c.rect(2, 8, 13, 8, 2)
        c.rect(2, 11, 13, 11, 2)
    sprite("decor.twig-fence", WOOD, fence)

    def mushroom_lamp(c, f):
        c.rect(7, 8, 8, 14, 5)
        c.ellipse(8, 6, 5, 3, 3, clip=lambda x, y: y <= 7)
        c.ellipse(7, 4.5, 2, 1, 4)
        c.set(5, 7, 6 if f else 7); c.set(11, 7, 7 if f else 6)
    sprite("decor.mushroom-lamp", ["#8a2a22", "#c84a3a", "#e87a6a", "#efe2c8", "#fff3a8", "#ffd84a"], mushroom_lamp, frames=2, durations=[1.2, 1.2])


FAMILY_EGG = {   # shell, shell light, spot
    "fungling": ("#e8dcc0", "#fff6e4", "#a0603a"),
    "sproutling": ("#a8d890", "#e0f8c8", "#4f8a2c"),
    "geodeCritter": ("#9a9aa6", "#d0d0dc", "#5a5066"),
}
TIER_ACCENT = {"common": None, "uncommon": "#5fd35a", "rare": "#5a9cff", "veryRare": "#c58cff", "legendary": "#ffc84a"}


def eggs():
    """One egg per family and tier: the family's shell, the tier's colour as a band (and a sparkle for rare+)."""
    for fam, (shell, light, spot) in FAMILY_EGG.items():
        for tier, accent in TIER_ACCENT.items():
            pal = [shell, light, spot, accent or spot, "#ffffff"]

            def egg(c, f, tier=tier, accent=accent):
                c.ellipse(8, 9.5, 4.6, 5.6, 2)
                c.ellipse(6.6, 7, 1.6, 2.2, 3)
                for (x, y) in ((9, 6), (10, 11), (6, 12), (8, 9)):
                    c.set(x, y, 4)
                if accent:
                    for x in range(4, 13):
                        if c.get(x, 10) not in (0, None):
                            c.set(x, 10, 5)
                if tier in ("rare", "veryRare", "legendary") and f == 1:
                    c.set(12, 3, 6); c.set(13, 4, 6); c.set(11, 4, 6); c.set(12, 5, 6)
            frames = 2 if tier in ("rare", "veryRare", "legendary") else 1
            sprite(f"egg.{fam}.{tier}", pal, egg, frames=frames, durations=[0.9, 0.9] if frames > 1 else None, tags=("egg",))

    def nest(c, f):
        c.ellipse(8, 12, 7, 3.2, 2)
        c.ellipse(8, 11.4, 5.2, 2, 3)
        for x in range(1, 16, 2):
            c.set(x, 12 + (x % 3) - 1, 4)
        c.ellipse(8, 11.6, 3.6, 1.2, 5)
    sprite("egg.nest", WOOD + ["#3a2616"], nest)

    def nest_front(c, f):
        # The front lip of the nest, drawn over an egg sitting in it (same shape as the nest's lower half).
        nest(c, f)
        for y in range(0, 12):
            for x in range(16):
                c.set(x, y, 0)
        for x in range(4, 13):
            if c.get(x, 12) == 5:
                c.set(x, 12, 0)
    sprite("egg.nest.front", WOOD + ["#3a2616"], nest_front)


SCHOOLS = {   # school: (colour, light) for the school seeds (matches the UI's stat colours)
    "spore": ("#4a7dff", "#a8c8ff"), "glow": ("#4fe3f0", "#e8ffff"), "bloom": ("#ff79b8", "#ffd0e8"),
    "verdure": ("#4fcf4f", "#c8f8a8"), "shimmer": ("#b7a4e0", "#f4f0ff"), "spirit": ("#7a7ad0", "#d0d0ff"),
}


def school_seeds():
    """School seeds (Resources/Content/schoolSeeds.json): a seed with its school's colour in the Bag
    (seed.school.<school>), and the mound with a school-coloured sprout shown where one is buried
    (seed.buried.<school>)."""
    for school, (col, light) in SCHOOLS.items():
        def seed(c, f):
            c.ellipse(8, 10, 3.6, 4.4, 2)              # seed body
            c.ellipse(7, 9, 1.6, 2.4, 3)
            c.rect(6, 11, 10, 12, 4)                   # school band
            c.set(7, 11, 5)
            c.set(9, 6, 5); c.set(11, 8, 5)            # a glint
        sprite(f"seed.school.{school}", ["#7a5232", "#b07a48", col, light], seed, tags=("seed",))

        def marker(c, f):
            c.ellipse(8, 13, 6, 2.6, 2)                # the mound of fresh earth
            c.ellipse(7, 12.4, 3.6, 1.4, 3)
            c.set(4, 14, 4); c.set(11, 14, 4)
            c.rect(8, 7, 8, 11, 6)                     # sprout stem
            c.set(7, 7, 5); c.set(6, 6, 5); c.set(9, 6, 5); c.set(10, 5, 5)   # two leaves
            c.set(6, 5, 7 if f == 0 else 5); c.set(10, 4, 5 if f == 0 else 7)
        sprite(f"seed.buried.{school}", ["#5a3c22", "#8a6038", "#3e2a18", col, "#3f7a2e", light], marker,
               frames=2, durations=[1.4, 1.4], tags=("seed", "marker"))


def relics():
    """Relics (Resources/Content/relics.json): Bag icons relic.<school>.<tier> (one shape per tier, in
    the school's colour), the stone set in the ground where one is buried (relic.world.<school>, a
    pulsing rune), and the unknown starter relic before its school is chosen (relic.unknown)."""
    STONE_P = ["#5a5468", "#8a8498", "#bcb6c8"]

    def pebble(c, f):                       # common: a smooth pebble with a carved mark
        c.ellipse(8, 10, 5, 4, 3); c.ellipse(7, 9, 3, 2, 4)
        c.rect(7, 9, 9, 9, 5); c.rect(8, 8, 8, 11, 5); c.set(8, 10, 6)

    def charm(c, f):                        # uncommon: an amulet on a loop
        c.ellipse(8, 4, 2, 2, 2); c.ellipse(8, 4, 1, 1, 0)
        c.ellipse(8, 10, 4.5, 4.5, 3); c.ellipse(8, 10, 3, 3, 5); c.ellipse(7, 9, 1.4, 1.4, 6)

    def idol(c, f):                         # rare: a small carved figure
        c.rect(5, 6, 11, 14, 3); c.rect(6, 7, 10, 13, 4)
        c.ellipse(8, 4.5, 3.2, 2.2, 5); c.set(7, 9, 6); c.set(9, 9, 6); c.rect(7, 11, 9, 11, 2)

    def crown(c, f):                        # very rare: a circlet with points
        c.rect(3, 9, 13, 13, 3); c.rect(4, 10, 12, 12, 4)
        for x in (3, 8, 13):
            c.rect(x - 1, 6, x, 8, 5); c.set(x, 5, 6)
        c.set(8, 11, 6)

    def star(c, f):                         # legendary: a radiant gem
        for (dx, dy) in ((0, -6), (0, 6), (-6, 0), (6, 0), (-4, -4), (4, -4), (-4, 4), (4, 4)):
            c.set(8 + dx, 9 + dy, 6)
        c.ellipse(8, 9, 4, 4, 3); c.ellipse(8, 9, 2.6, 2.6, 5); c.set(7, 8, 6)

    shapes = {"common": pebble, "uncommon": charm, "rare": idol, "veryRare": crown, "legendary": star}
    for school, (col, light) in SCHOOLS.items():
        for tier, fn in shapes.items():
            sprite(f"relic.{school}.{tier}", STONE_P + [col, light], fn, tags=("relic",))

        def world(c, f, col=col):           # a stone set in the ground, its rune pulsing
            c.ellipse(8, 13, 6, 2.4, 2)
            c.rect(5, 6, 11, 13, 3); c.rect(6, 7, 10, 12, 4); c.ellipse(8, 6, 3, 1.6, 4)
            rune = 5 if f == 0 else 6
            c.rect(8, 8, 8, 11, rune); c.set(7, 9, rune); c.set(9, 10, rune)
        sprite(f"relic.world.{school}", STONE_P + [col, light], world, frames=2, durations=[1.2, 1.2], tags=("relic", "marker"))

    def unknown(c, f):                      # the starter relic before its school is chosen
        c.ellipse(8, 10, 5, 4.4, 3); c.ellipse(7, 9, 3, 2.2, 4)
        c.set(8, 10, 5); c.set(7, 9, 5)
        c.set(12 - f * 6, 5 + f, 6); c.set(3 + f * 9, 12 - f * 3, 6)
    sprite("relic.unknown", STONE_P + ["#d8d0f0", "#ffffff"], unknown, frames=2, durations=[0.8, 0.8], tags=("relic",))


def landmarks():
    """Earned landmarks (Resources/Content/landmarks.json 'earned'): they form where two stats are strong
    across a 3x3 patch and stay for good. 28x24, anchored at the base."""
    size, anchor = (28, 24), (14, 21)

    def cave(c, f):                      # a mound of crystal with a dark, glittering mouth
        c.ellipse(14, 15, 12, 8, 3, clip=lambda x, y: y <= 21)
        c.ellipse(10, 11, 5, 3, 4)
        c.ellipse(14, 17, 5, 4.5, 5, clip=lambda x, y: y <= 21)
        c.ellipse(14, 18, 3, 3, 6, clip=lambda x, y: y <= 21)
        for (x, y) in ((4, 14), (22, 12), (19, 7), (7, 18)):
            c.set(x, y, 2)
        c.rect(3, 21, 25, 21, 2)
    sprite("landmark.crystal-grotto", ["#7a6aa8", "#a898d8", "#d8ccf4", "#2a2448", "#120c18"], cave, size=size, anchor=anchor, tags=("landmark",))

    def fruit_tree(c, f):                # a round crown with red fruit on a short trunk
        c.rect(12, 13, 15, 21, 2)
        c.set(11, 21, 2); c.set(16, 21, 2)
        c.ellipse(14, 9, 10, 7.5, 3)
        c.ellipse(11, 7, 5, 3.5, 4)
        for (x, y) in ((8, 10), (13, 5), (18, 8), (20, 12), (10, 13), (16, 11)):
            c.set(x, y, 5); c.set(x + 1, y, 5); c.set(x, y + 1, 6)
    sprite("landmark.fruit-tree", ["#6a4426", "#3f8a3a", "#6cc24a", "#e0302c", "#ff8a70"], fruit_tree, size=size, anchor=anchor, tags=("landmark",))

    def moonwell(c, f):                  # a stone ring around glowing water
        c.ellipse(14, 17, 10, 4.5, 2)
        c.ellipse(14, 16.5, 7.5, 3, 4 if f == 0 else 5)
        c.ellipse(12, 16, 3, 1, 5 if f == 0 else 6)
        for x in (5, 9, 14, 19, 23):
            c.set(x, 19, 3)
        for (x, y) in ((10, 10), (17, 8), (14, 12)):
            c.set(x, y - f, 6)
    sprite("landmark.moonwell", ["#6a6a78", "#9a9aa6", "#3aa8b8", "#7cf2ff", "#e8ffff"], moonwell, size=size, anchor=anchor, frames=2, durations=[1.1, 1.1], tags=("landmark",))

    def singing_crystals(c, f):          # three upright crystals with glowing marks
        for (x, h) in ((6, 12), (14, 16), (22, 11)):
            c.rect(x - 2, 21 - h, x + 2, 21, 2)
            c.rect(x - 2, 21 - h, x - 1, 21, 3)
            c.set(x, 21 - h + 4, 4 if f == 0 else 5); c.set(x, 21 - h + 5, 4)
        c.rect(2, 21, 26, 21, 6)
    sprite("landmark.singing-crystals", ["#8a7ac0", "#c0b0ea", "#7cf2e8", "#f4f0ff", "#3a3456"], singing_crystals, size=size, anchor=anchor, frames=2, durations=[1.3, 1.3], tags=("landmark",))

    def fairy_ring(c, f):                # a ring of pale mushrooms in the grass
        import math
        for i in range(9):
            a = i / 9 * 6.283
            x, y = 14 + math.cos(a) * 10, 16 + math.sin(a) * 4.5
            c.rect(int(x), int(y), int(x), int(y) + 1, 4)
            c.ellipse(x, y - 0.5, 1.8, 1.1, 2 if (i + f) % 3 else 3)
        c.set(14, 15, 5 if f else 4)
    sprite("landmark.fairy-ring", ["#d8c0e8", "#ffffff", "#efe2c8", "#ffd84a"], fairy_ring, size=size, anchor=anchor, frames=2, durations=[0.9, 0.9], tags=("landmark",))

    def spring(c, f):                    # water welling up between mossy stones
        c.ellipse(14, 17, 9, 4, 4)
        for (x, y) in ((6, 16), (22, 17), (10, 20), (19, 20), (14, 13)):
            c.ellipse(x, y, 2.5, 1.8, 2); c.set(x - 1, y - 1, 3)
        c.ellipse(14, 17, 5, 2, 5)
        for k in range(3):
            c.set(13 + k, 14 - (k + f) % 2, 6)
    sprite("landmark.spring", ["#8a8a96", "#7aa85a", "#2f6aa8", "#4a90d8", "#c8f0ff"], spring, size=size, anchor=anchor, frames=2, durations=[0.6, 0.6], tags=("landmark",))

    def nest_hollow(c, f):               # a hollow stump lined with moss and twigs
        c.rect(7, 9, 21, 21, 2)
        c.rect(7, 9, 9, 21, 3)
        c.ellipse(14, 9, 7, 2.5, 4)
        c.ellipse(14, 9, 5, 1.6, 5)
        for x in range(8, 21, 3):
            c.set(x, 8, 6)
        c.rect(5, 21, 23, 21, 2)
    sprite("landmark.nest-hollow", ["#6a4426", "#8a5a36", "#3a2616", "#1b120c", "#7aa85a"], nest_hollow, size=size, anchor=anchor, tags=("landmark",))

    def fruit(c, f):
        c.ellipse(8, 10, 4.5, 4.2, 2)
        c.ellipse(6.5, 8.5, 1.6, 1.2, 3)
        c.rect(8, 4, 8, 6, 4)
        c.ellipse(10, 5, 2, 1, 5)
    sprite("item.material.forest-fruit", ["#d8302c", "#ff8a70", "#6a4426", "#4fae3a"], fruit, tags=("item",))


def spirit_well():
    """The Spirit Well: an old round well of mossy stone with a little wooden roof and a faintly
    glowing surface (forest view, 28x24), and its stone rim seen from above for the Wishing screen
    (the screen draws the water, ripples and glow inside it)."""
    pal = ["#5e5e68", "#8a8a96", "#b8b8c4", "#3f6a2e", "#7aa85a", "#5a3a22", "#8a5a36", "#9ff4e8", "#2f7a8a"]

    def well(c, f):
        c.rect(5, 3, 6, 15, 7); c.rect(21, 3, 22, 15, 7)          # posts
        for x in range(3, 25):                                     # roof
            y = 3 - (1 if 8 < x < 19 else 0) - (1 if 11 < x < 16 else 0)
            c.set(x, y, 8); c.set(x, y + 1, 7)
        c.rect(13, 5, 14, 9, 7)                                    # rope
        c.ellipse(14, 17, 10, 4.2, 3)                              # stone rim
        c.ellipse(14, 16.6, 7.4, 2.6, 10)                          # water
        c.ellipse(12, 16, 3, 1, 9 if f == 0 else 2)                # glint
        c.rect(4, 17, 24, 21, 3)                                   # stone body
        for (x, y) in ((6, 19), (11, 20), (16, 19), (21, 20), (8, 18), (19, 18)):
            c.set(x, y, 2); c.set(x + 1, y, 4)
        for (x, y) in ((5, 17), (9, 21), (17, 21), (23, 18), (13, 18)):
            c.set(x, y, 5); c.set(x, y - 1, 6)                     # moss
        if f == 1:
            c.set(10, 12, 9); c.set(18, 11, 9)                     # rising motes
    sprite("landmark.spirit-well", pal, well, size=(28, 24), anchor=(14, 21), frames=2, durations=[1.0, 1.0], tags=("landmark",))

    def rim(c, f):                        # top-down: a ring of mossy stones around a round opening
        import math
        cx = cy = 31.5
        for y in range(64):
            for x in range(64):
                d = math.hypot(x - cx, y - cy)
                if 22 <= d <= 30:
                    a = math.atan2(y - cy, x - cx)
                    block = int((a + math.pi) / (2 * math.pi) * 18)
                    seam = abs(((a + math.pi) / (2 * math.pi) * 18) - round((a + math.pi) / (2 * math.pi) * 18)) < 0.06 or abs(d - 26) < 0.5
                    col = 2 if seam else (3 if block % 3 else 4)
                    if d < 23.2:
                        col = 2
                    if (x * 7 + y * 3 + block) % 23 == 0 and d > 25:
                        col = 5
                    if (x * 5 + y * 11) % 29 == 0 and d > 26:
                        col = 6
                    c.set(x, y, col)
    sprite("wish.well-top", pal, rim, size=(64, 64), anchor=(32, 32), tags=("ui",))


def board_icon():
    def board(c, f):
        c.rect(1, 2, 10, 8, 3)
        c.rect(2, 3, 9, 7, 4)
        c.rect(3, 4, 6, 4, 2); c.rect(3, 6, 8, 6, 2)
        c.rect(2, 9, 2, 11, 2); c.rect(9, 9, 9, 11, 2)
        c.set(5, 1, 5); c.set(6, 1, 5)
    sprite("ui.icon.board", WOOD + ["#c84a3a"], board, size=(12, 12), anchor=(6, 11), tags=("ui", "icon"))


if __name__ == "__main__":
    decor()
    eggs()
    school_seeds()
    relics()
    landmarks()
    spirit_well()
    board_icon()
    import gen_landmark_art  # landmarks drawn from design/landmark_*.jpg replace the placeholders above
    gen_landmark_art.main()
    print("wrote Offerings sprites")
