#!/usr/bin/env python3
"""Placeholder art for Offerings: decor props, eggs, nests and the Old Log board icon.

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
    board_icon()
    print("wrote Offerings sprites")
