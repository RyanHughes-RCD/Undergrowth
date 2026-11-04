#!/usr/bin/env python3
"""Placeholder art for the Store and Old Log: decor props, relic ornaments and the Old Log board icon.

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

    # Ground-level pieces (raised bed, gravel path) fill their tile and are drawn under what stands on them.
    def raised_bed(c, f):
        c.rect(1, 4, 14, 14, 3)                       # plank frame
        c.rect(1, 4, 14, 4, 4); c.rect(1, 14, 14, 14, 2)
        c.rect(3, 6, 12, 12, 5)                       # deep soil
        for (x, y) in ((4, 7), (9, 8), (6, 11), (11, 10)):
            c.set(x, y, 6)
        c.set(1, 9, 2); c.set(14, 9, 2)
    sprite("decor.raised-bed", WOOD + ["#3e2b22", "#5a3c30"], raised_bed, anchor=(8, 13))

    def gravel(c, f):
        import random
        rng = random.Random(7)
        c.ellipse(8, 8, 7.4, 6.6, 3)                  # a soft, irregular patch of gravel
        for (x, y) in ((1, 4), (14, 11), (3, 14), (12, 2)):
            c.set(x, y, 0)
        for _ in range(26):
            x, y = rng.randint(1, 14), rng.randint(1, 14)
            c.set(x, y, rng.choice((2, 4)))
        for (x, y) in ((4, 5), (11, 9), (7, 12)):
            c.rect(x, y, x + 1, y, 5); c.set(x, y - 1, 4)
    sprite("decor.gravel-path", ["#857a68", "#a89c88", "#c8bca8", "#6e6e78"], gravel, anchor=(8, 13))

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


SCHOOLS = {   # school: (colour, light) for the relic ornaments
    "spore": ("#4a7dff", "#a8c8ff"), "glow": ("#4fe3f0", "#e8ffff"), "bloom": ("#ff79b8", "#ffd0e8"),
    "verdure": ("#4fcf4f", "#c8f8a8"), "shimmer": ("#b7a4e0", "#f4f0ff"), "spirit": ("#7a7ad0", "#d0d0ff"),
}

def relics():
    """Relics (Resources/Content/relics.json): one carved pebble per school in its colour (relic.<school>.common)."""
    STONE_P = ["#5a5468", "#8a8498", "#bcb6c8"]

    def pebble(c, f):                       # common: a smooth pebble with a carved mark
        c.ellipse(8, 10, 5, 4, 3); c.ellipse(7, 9, 3, 2, 4)
        c.rect(7, 9, 9, 9, 5); c.rect(8, 8, 8, 11, 5); c.set(8, 10, 6)

    for school, (col, light) in SCHOOLS.items():
        sprite(f"relic.{school}.common", STONE_P + [col, light], pebble, tags=("relic",))



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
    relics()
    board_icon()
    print("wrote Offerings sprites")
