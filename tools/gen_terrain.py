#!/usr/bin/env python3
"""Soil art: one ground tile pair per garden school (run via gen_placeholders.py).

tile.<school>.3a / .3b: grass with its greens moved toward the school's colour and a few motif specks
(caps for Spore, motes for Glow, petals for Bloom...). Plain soil is the ordinary grass (gen_topdown.py).
"""
from gen_placeholders import Canvas, write, P, GROUND_PALETTE
from gen_topdown import rng_for, T


# ------------------------------------------------------------------ school ground: grass that takes on its terrain
# Each school's soil is the ordinary grass tile with its greens shifted toward the school's hue, plus a few
# motif specks (tile.<school>.3a / .3b). A garden tile shows its soil this way (render.js soilVisual). Each
# tile carries its own copy of the ground palette (the shared one is full).
SCHOOL_GROUND = {   # school: (grass hue it moves toward, motif colours)
    "spore": ("#22443e", ["#e8dcc0", "#d8b890"]),
    "glow": ("#2f7a72", ["#7cf2ff", "#c8fbff"]),
    "bloom": ("#a09a3a", ["#ff9ccf", "#fff3c4"]),
    "verdure": ("#2aa82a", ["#a8f07a", "#6ad04a"]),
    "shimmer": ("#8a84b8", ["#f4f0ff", "#c8b4f4"]),
    "spirit": ("#4a4c8a", ["#c8c8f4", "#9a9ad0"]),
}
GROUND_LEVELS = [(3, 0.64, 5)]   # (level, how far the greens move, motif specks): one look per soil, clearly unlike grass
GRASS_SLOTS = ("grass", "grass_l", "grass_d", "grass_ll")
MOTIF_SLOTS = ("pink", "white")                                             # flower slots the grass tile never uses


def _mix(a, b, t):
    a, b = a.lstrip("#"), b.lstrip("#")
    ca = [int(a[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(b[i:i + 2], 16) for i in (0, 2, 4)]
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(ca, cb))


def _grass_canvas(sid, variant):
    """The same pixels as tile.grass.<variant> (gen_topdown.make_ground)."""
    i = "abc".index(variant)
    rng = rng_for("tile.grass." + variant)
    c = Canvas(T, T)
    for y in range(T):
        for x in range(T):
            c.px[y][x] = P["grass"]
            for name, prob in [("grass_d", .07), ("grass_l", .05), ("grass_ll", .01)]:
                if rng.random() < prob:
                    c.px[y][x] = P[name]
    r2 = rng_for("tile.grass." + variant, 7)
    for _ in range(3 + i):
        x, y = r2.randint(0, 14), r2.randint(1, 15)
        col = P[r2.choice(("grass_l", "grass_d", "grass_ll"))]
        c.set(x, y, col); c.set(x + 1, y - 1, col)
    return c


def _ground_tile(sid, variant, hue, amount, motifs, specks):
    pal = list(GROUND_PALETTE)
    for name in GRASS_SLOTS:
        pal[P[name]] = _mix(GROUND_PALETTE[P[name]], hue, amount)
    for slot, col in zip(MOTIF_SLOTS, motifs):
        pal[P[slot]] = col
    c = _grass_canvas(sid, variant)
    rng = rng_for(sid, 3)
    for _ in range(specks):
        x, y = rng.randint(1, 14), rng.randint(1, 14)
        c.set(x, y, P[rng.choice(MOTIF_SLOTS[:len(motifs)])])
    write(sid, (T, T), [c], palette=pal, anchor=(8, 8), tags=["tile"])


def school_ground():
    for school, (hue, motifs) in SCHOOL_GROUND.items():
        for level, amount, specks in GROUND_LEVELS:
            for v in "ab":
                _ground_tile("tile.%s.%d%s" % (school, level, v), "ab"[("ab".index(v) + level) % 2], hue, amount, motifs, specks)



def main():
    school_ground()
