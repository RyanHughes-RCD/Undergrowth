#!/usr/bin/env python3
"""Soil and water art (run via gen_placeholders.py).

tile.<school>.<level>a / b: grass with its greens moved toward the school's colour and motif specks (caps for
Spore, motes for Glow, petals for Bloom...), more strongly at each maturity level 1-4. Plain soil is the
ordinary grass (gen_topdown.py). tile.water.a / b: the pool and its streams.
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
# (level, how far the greens move, motif specks): soil matures from 1 (just changed) to 4 (long held), each level
# more strongly its school's colour, and deeper: the shadows darken toward the school's hue at each level.
GROUND_LEVELS = [(1, 0.26, 1), (2, 0.48, 3), (3, 0.7, 5), (4, 0.9, 8)]
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
    pal[P["grass_d"]] = _mix(pal[P["grass_d"]], "#0c120c", 0.12 + 0.3 * amount)   # deeper shadows as it matures
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



# ------------------------------------------------------------------ soil details
# Small things that grow on a school's soil (detail.<school>.a / b), drawn over some of its tiles by the
# renderer: more often the more mature the soil (tuning.visuals.soilDetails). Pixel maps: '.' transparent,
# digits index the palette after it.
SOIL_DETAILS = {
    "verdure": [  # a tuft of grass; a clover patch
        (["......", "..1.1.", ".121.1", ".1212.", "121221", ".2222."], ["#3e9a2e", "#66cc44"]),
        (["......", ".11.11", "122122", ".1221.", "..33..", "...3.."], ["#3a8a2a", "#6ad04a", "#2e6a20"]),
    ],
    "bloom": [  # wildflowers: two pink and a yellow; a little white cluster
        ([".1....", "121.3.", ".1.343", ".4..3.", ".4.4..", "..44.."], ["#ff8cc4", "#fff3a0", "#ffd84a", "#4a8a2a"]),
        (["......", ".1.1..", "121212", ".1.1..", ".3.3..", "..3..."], ["#fff8f0", "#ffd84a", "#4a8a2a"]),
    ],
    "spore": [  # two little caps; a puffball
        (["......", ".11...", "1221.1", ".33.121", ".33..3.", "......."], ["#b07a4a", "#e8c89a", "#e8dcc0"]),
        (["......", "..11..", ".1221.", ".1111.", "..33..", "......"], ["#e8dcc0", "#ffffff", "#a8987a"]),
    ],
    "glow": [  # glowing moss buttons; a foxfire sprig
        (["......", ".1..1.", "121.12", ".1...1", "..1...", ".121.."], ["#5ad8e8", "#d8fcff"]),
        (["..1...", ".121..", "..3.1.", "..3121", ".33.3.", "..3..."], ["#7cf2ff", "#ffffff", "#2a6a5a"]),
    ],
    "shimmer": [  # a crystal shard; glinting pebbles
        (["...1..", "..121.", "..131.", ".1331.", ".1331.", "..44.."], ["#c8b4f4", "#ffffff", "#9a84d8", "#6a5a8a"]),
        (["......", ".12...", ".33..1", "....12", "..12.3", "..3..."], ["#d8ccff", "#ffffff", "#8a7ab0"]),
    ],
    "spirit": [  # a pale ghost-flower; a little cairn
        (["..1...", ".121..", "..1...", "..3.1.", "..3121", "..3.3."], ["#e0e0ff", "#ffffff", "#7a7ab0"]),
        (["......", "..11..", ".1221.", ".3333.", "312213", ".3333."], ["#9a9ab4", "#c8c8e0", "#6a6a84"]),
    ],
}


def soil_details():
    for school, variants in SOIL_DETAILS.items():
        for v, (rows, cols) in zip("ab", variants):
            w = max(len(r) for r in rows)
            c = Canvas(w, len(rows))
            for y, row in enumerate(rows):
                for x, ch in enumerate(row):
                    if ch != ".":
                        c.set(x, y, int(ch))
            write("detail.%s.%s" % (school, v), (w, len(rows)), [c], palette=["transparent"] + cols,
                  anchor=(w // 2, len(rows)), tags=["tile"])


def water():
    """The stream bed: clear blue, deeper in the middle, with a few soft ripples (tile.water.a / b).
    The moving ripples and the bank edges are drawn over it by the renderer, flowing downstream."""
    pal = ["transparent", "#24527c", "#3a76a8", "#4f8cbc", "#7fb0d4", "#d8f0ff", "#2e6492"]
    for v in "ab":
        rng = rng_for("tile.water." + v)
        c = Canvas(T, T)
        for y in range(T):
            for x in range(T):
                d = min(x, y, T - 1 - x, T - 1 - y)              # deeper away from the banks
                r = rng.random()
                c.px[y][x] = (1 if r < .35 else 6) if d >= 4 else (6 if r < .25 else 2)
        for _ in range(3):                                # a few soft, still ripples
            x, y = rng.randint(2, 11), rng.randint(2, 13)
            for i in range(rng.randint(2, 3)):
                c.set(x + i, y, 6 if c.px[y][x + i] == 1 else 3)
        write("tile.water." + v, (T, T), [c], palette=pal, anchor=(8, 8), tags=["tile"])


def main():
    school_ground()
    soil_details()
    water()
