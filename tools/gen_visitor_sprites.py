#!/usr/bin/env python3
"""Placeholder art for the visitors (run via gen_placeholders.py, or on its own).

    python3 tools/gen_visitor_sprites.py

One 16x16 sprite with two frames (a wing beat, a step, a blink) for each animal in Content/visitors.json:
visitor.<id>. Drawn from a few body templates (winged insect, bee, bird, owl, fox, hare, squirrel,
salamander, woodlouse, stag, tortoise, crane) in each animal's colours. (The Stump and the
wishing well come from drawn art: tools/import_sprite_image.py.) Placeholder art, meant to be redrawn.
Palette: 1 outline, 2 body, 3 light, 4 dark, 5 accent, 6 eye, 7 glow.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_placeholders import Canvas, write  # noqa: E402

OUT = "#1b1420"


def moth(c, f, clear=False):
    """Winged insect from above: four wings that open and close, a thin body."""
    span = 6 if f == 0 else 4
    for side in (-1, 1):
        c.ellipse(8 + side * span * 0.55, 6.5, span * 0.55, 3.2, 2)
        c.ellipse(8 + side * span * 0.45, 10.5, span * 0.42, 2.4, 3)
        c.set(8 + side * (span - 1), 6, 5)
        c.set(8 + side * 2, 7, 3 if clear else 5)
    c.rect(8, 4, 8, 12, 4)
    c.set(7, 3, 4); c.set(9, 3, 4); c.set(6, 2, 4); c.set(10, 2, 4)


def bee(c, f, glow_tail=False):
    """A round, striped flier with little wings."""
    c.ellipse(8, 10, 4.2, 3.4, 2)
    for x in (6, 9):
        c.rect(x, 8, x, 12, 4)
    if glow_tail:
        c.ellipse(11, 10, 1.8, 1.6, 7)
    c.ellipse(4.5, 9.5, 1.6, 1.6, 4)
    c.set(4, 9, 6)
    wy = 6 if f == 0 else 7
    c.ellipse(7, wy, 2.2, 1.6, 3); c.ellipse(10, wy, 2.2, 1.6, 3)


def hummingbird(c, f):
    c.ellipse(7, 9, 3.6, 2.6, 2)                 # body
    c.ellipse(6, 10, 2, 1.2, 5)                  # ruby throat
    c.ellipse(4.5, 7.5, 1.8, 1.6, 2)             # head
    c.set(4, 7, 6)
    c.line(3, 8, 0, 9, 4)                        # long beak
    c.line(10, 10, 13, 12, 4)                    # tail
    wy = 4 if f == 0 else 6
    c.ellipse(9, wy, 3.4, 1.4, 3)


def owl(c, f):
    c.ellipse(8, 9.5, 5, 5.5, 2)
    c.ellipse(8, 8, 4.2, 3.4, 3)                 # pale heart-shaped face
    c.set(6, 8, 6 if f == 0 else 4); c.set(10, 8, 6 if f == 0 else 4)
    c.set(8, 9, 5)
    c.rect(6, 15, 7, 15, 5); c.rect(9, 15, 10, 15, 5)
    c.line(3, 10, 4, 13, 4); c.line(13, 10, 12, 13, 4)


def fox(c, f):
    c.ellipse(8, 10, 4.6, 2.6, 2)                # body
    c.ellipse(3.5, 8, 2.4, 2.1, 2)               # head
    c.set(2, 6, 2); c.set(4, 5, 2)               # ears
    c.set(2, 8, 6); c.set(1, 9, 4)
    c.ellipse(13, 8.5, 2.4, 1.8, 3)              # tail, tipped
    c.set(15, 7, 5)
    step = f
    for x in (5, 7, 10, 12):
        c.rect(x, 12, x, 14 - (step if x in (5, 10) else 0), 4)
        c.set(x, 14 - (step if x in (5, 10) else 0), 7)    # glowing paws


def hare(c, f):
    c.ellipse(9, 10.5, 4.4, 3, 2)
    c.ellipse(4.5, 8.5, 2.4, 2.1, 2)
    c.line(4, 6, 3, 2 + f, 3); c.line(5, 6, 6, 2 + f, 3)   # long ears
    c.set(3, 8, 6)
    c.ellipse(13, 9.5, 1.4, 1.3, 3)
    c.set(8, 8, 5); c.set(11, 9, 5)              # mossy tufts
    c.rect(6, 13, 7, 13, 4); c.rect(11, 13, 13, 13, 4)


def squirrel(c, f):
    c.ellipse(7, 10.5, 3.4, 3, 2)
    c.ellipse(5, 7, 2.2, 2, 2)
    c.set(4, 4, 2); c.set(6, 5, 2)
    c.set(4, 7, 6)
    c.ellipse(11.5, 6.5 + f * 0.5, 2.8, 4.6, 3)  # big bushy tail
    c.ellipse(12, 5, 1.6, 2.4, 2)
    c.set(5, 10, 5)                              # a nut held close
    c.rect(6, 13, 9, 13, 4)


def salamander(c, f):
    c.ellipse(8, 10, 5.2, 1.8, 2)
    c.ellipse(3, 9.5, 1.8, 1.6, 2)
    c.set(2, 9, 6)
    c.line(13, 10, 15, 9 - f, 3)                 # tail
    for (x, d) in ((5, 1), (10, -1)):
        c.set(x, 12, 4); c.set(x + d, 13 - f, 4)
        c.set(x, 8, 4); c.set(x + d, 7 + f, 4)
    c.set(7, 9, 5); c.set(10, 10, 5)


def woodlouse(c, f):
    c.ellipse(8, 10, 5, 3.2, 2)
    for x in (5, 7, 9, 11):
        c.rect(x, 7, x, 13, 4)
    c.ellipse(8, 9, 4, 1.6, 3)
    c.set(3, 9, 6)
    c.line(3, 8, 1, 6 + f, 4)
    for x in (5, 8, 11):
        c.set(x, 14 - (f if x == 8 else 0), 4)


def stag(c, f):
    """A deer side-on: long legs, a raised head and branching antlers with little lights in them."""
    c.ellipse(8.5, 9.5, 4.4, 2.4, 2)              # body
    c.ellipse(9, 10.2, 3.4, 1.2, 3)               # pale belly
    c.line(4.5, 8.5, 3.5, 5.5, 2)                 # neck
    c.ellipse(3, 5, 1.8, 1.4, 2)                  # head
    c.set(1, 5.5, 4); c.set(3, 4.5, 6)
    for x0, d in ((3, -1), (4, 1)):               # antlers
        c.line(x0, 3.5, x0 + d * 2, 0.5, 4)
        c.set(x0 + d * 2, 1.5, 4); c.set(x0 + d, 2, 4)
    c.set(1, 0, 7); c.set(6, 0, 7); c.set(5, 2, 7)
    step = f
    for x in (6, 7, 10, 11):
        lift = step if x in (6, 10) else 0
        c.rect(x, 11, x, 14 - lift, 4)
    c.set(13, 8.5, 3)                             # tail
    c.set(8, 8, 5); c.set(10, 8.5, 5)             # moss on its back


def tortoise(c, f):
    """A domed shell like a mirror, mushrooms in its seams, a slow head."""
    c.ellipse(8, 10, 5.6, 3.8, 2)                 # shell
    c.ellipse(7, 8.6, 3, 1.6, 3)                  # mirror shine
    c.set(6, 8, 7); c.set(9, 9, 7)
    c.line(4, 11, 12, 11, 4)                      # seam
    c.set(10, 6.6, 5); c.set(11, 6.6, 5); c.set(10.5, 7.4, 4)   # a little mushroom
    hx = 1.6 if f == 0 else 2.4
    c.ellipse(hx, 11.5, 1.6, 1.3, 4)              # head
    c.set(hx - 0.6, 11, 6)
    for x in (4, 11):
        c.rect(x, 13, x + 1, 14, 4)


def crane(c, f):
    """A tall pale crane on one leg, its neck curved, a pink-tipped wing."""
    c.ellipse(9, 8, 3.6, 2.4, 2)                  # body
    c.ellipse(11, 8.5, 2.4, 1.4, 3)               # wing
    c.set(13, 9, 5); c.set(12, 9.5, 5)
    c.line(6.5, 7, 5, 4, 2); c.line(5, 4, 5.5, 2, 2)   # neck
    c.ellipse(5.5, 1.8, 1.3, 1.1, 2)
    c.set(5, 1, 5)                                # red crown
    c.set(6, 1.8, 6)
    c.line(4.5, 2.2, 2, 3, 4)                     # beak
    c.line(9, 10, 9, 15, 4)                       # standing leg
    if f == 0:
        c.line(9, 12, 11, 11, 4)                  # the tucked leg
    else:
        c.line(10, 10, 10, 15, 4)


ANIMALS = {
    "woodlouse": (woodlouse, ["#7a7a86", "#a8a8b4", "#4a4a56", "#c8c8d0", "#1b1420", "#ffffff"]),
    "salamander": (salamander, ["#e8d8d0", "#fff4ee", "#b89a96", "#c86a7a", "#1b1420", "#ffffff"]),
    "firefly": (lambda c, f: bee(c, f, glow_tail=True), ["#4a3a2a", "#8a7a5a", "#2a2018", "#d84a3a", "#ffffff", "#f4ff8a"]),
    "moth": (moth, ["#4a5a7a", "#8ad8e8", "#2a3450", "#c8ffff", "#ffffff", "#7cf2ff"]),
    "bumble": (bee, ["#f0b830", "#ffe080", "#2a2018", "#ffd84a", "#1b1420", "#ffffff"]),
    "hummingbird": (hummingbird, ["#4f9a5a", "#a8e8b0", "#2a5a34", "#e03050", "#1b1420", "#ffffff"]),
    "rabbit": (hare, ["#8a7a5a", "#c8b890", "#5a4a32", "#6fbf4a", "#1b1420", "#ffffff"]),
    "squirrel": (squirrel, ["#c8602a", "#e8904a", "#8a3a18", "#a87a4a", "#1b1420", "#ffffff"]),
    "glasswing": (lambda c, f: moth(c, f, clear=True), ["#d8e8f0", "#f4fbff", "#6a7888", "#ff9a5a", "#1b1420", "#ffffff"]),
    "prism-moth": (moth, ["#a898d8", "#f4c8ff", "#5a4a8a", "#7cf2ff", "#1b1420", "#ffffff"]),
    "fox": (fox, ["#7a7ad0", "#c8c8f4", "#4a4a8a", "#ffffff", "#1b1420", "#c8fbff"]),
    "owl": (owl, ["#c8a070", "#f4ead8", "#8a6a44", "#d8a050", "#1b1420", "#ffffff"]),
    "stag": (stag, ["#7a5a3a", "#c8a878", "#4a3422", "#6fbf4a", "#ffffff", "#7cf2ff"]),
    "tortoise": (tortoise, ["#8a90b8", "#e8f0ff", "#4a4e6a", "#c8a07a", "#1b1420", "#ffffff"]),
    "crane": (crane, ["#e8e4f0", "#ffffff", "#7a7488", "#ff8ab8", "#1b1420", "#ffffff"]),
}


def main():
    for key, (draw, pal) in ANIMALS.items():
        frames = []
        for f in range(2):
            c = Canvas(16, 16)
            draw(c, f)
            c.outline(1)
            frames.append(c)
        write("visitor." + key, (16, 16), frames, palette=["transparent", OUT] + pal, anchor=(8, 15), tags=["visitor"], durations=[0.5, 0.5])
    print("visitor sprites: %d" % len(ANIMALS))


if __name__ == "__main__":
    main()
