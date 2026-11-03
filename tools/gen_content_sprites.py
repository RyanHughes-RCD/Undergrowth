#!/usr/bin/env python3
"""Placeholder art for the Plant & Fungi Catalogue (run via gen_placeholders.py).

Reads Resources/Content/items.json and draws a sprite for every plant and fungus from shape templates
and per-entry colours, plus its bud stage (plant.bud.<key>) for the garden, so newly imported rows get
art automatically. Unknown names fall back to a colour picked from the name.
"""
import colorsys
import json
import math
import os
import zlib

from gen_placeholders import Canvas, write, ROOT

CONTENT = os.path.join(ROOT, "Resources", "Content")
OUTLINE = "#22181a"


# ------------------------------------------------------------------ colours

def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(v)))) for v in c)


def mix(a, b, t):
    a, b = rgb(a), rgb(b)
    return hexc([a[i] + (b[i] - a[i]) * t for i in range(3)])


def shade(c, f):
    """f > 0 lightens towards white, f < 0 darkens."""
    return mix(c, "#ffffff", f) if f >= 0 else mix(c, "#000000", -f)


def name_colour(name):
    h = (zlib.crc32(name.encode()) % 360) / 360
    r, g, b = colorsys.hsv_to_rgb(h, 0.55, 0.85)
    return hexc((r * 255, g * 255, b * 255))


def hue_shift(c, dh, dv=0.0):
    r, g, b = [v / 255 for v in rgb(c)]
    h, sat, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((h + dh) % 1, sat, max(0, min(1, v + dv)))
    return hexc((r * 255, g * 255, b * 255))


def shiny(c):
    r, g, b = [v / 255 for v in rgb(c)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((h + 0.42) % 1, min(1, s * 1.15 + 0.1), min(1, v * 1.1 + 0.08))
    return hexc((r * 255, g * 255, b * 255))


STAT_COLOURS = {
    "spore": "#5a8ad8", "glow": "#7ce8f4", "bloom": "#ff8ab8",
    "verdure": "#6cc24a", "shimmer": "#9a92a8", "spirit": "#7a5aa0",
}


# ------------------------------------------------------------------ helpers

def sprite(sid, palette, draw, size=(16, 16), frames=1, durations=None, anchor=None, outline=True, tags=("item",)):
    out = []
    for f in range(frames):
        c = Canvas(*size)
        draw(c, f)
        if outline:
            c.outline(1)
        out.append(c)
    write(sid, size, out, palette=palette, anchor=anchor or (size[0] // 2, size[1] - 1),
          tags=list(tags), durations=durations)


def pal(*colours):
    return ["transparent", OUTLINE] + list(colours)


# ------------------------------------------------------------------ mushrooms
# palette indices: 2 cap, 3 cap light, 4 stem, 5 stem shade, 6 accent

MUSHROOMS = {
    "brown-button-cap": ("dome", "#8a5a36", "#efe2c8", None),
    "red-toadstool": ("toad", "#d23a2c", "#efe2c8", "#fff4e8"),
    "puffball": ("puff", "#e8dcc0", None, None),
    "shelf-fungus": ("shelf", "#b07a3a", "#7a5a3a", "#e0b070"),
    "glowcap": ("dome", "#3aa8b8", "#d8f8f0", "#e8ffff"),
    "crystal-cap": ("cone", "#8fd8ff", "#d8eef8", "#ffffff"),
    "moonlight-morel": ("morel", "#d8e4ff", "#eef2ff", "#ffffff"),
    "ink-cap": ("ink", "#d8d4cc", "#efe8dc", "#2a2a34"),
    "oyster-mushroom": ("oyster", "#c8c0b0", "#e8e0d0", None),
    "turkey-tail": ("fan", "#7a4a2a", "#e0c8a0", "#c88a4a"),
    "chanterelle": ("trumpet", "#f0a830", "#f8c860", None),
    "pebble-cap": ("flat", "#9a9aa6", "#d8d4cc", "#c8c8d0"),
    "lions-mane": ("shaggy", "#f4efe4", None, "#d8d0c0"),
    "blue-stain-cap": ("dome", "#7a8aa0", "#e8e4dc", "#3a6ad8"),
    "earthstar": ("star", "#a07850", None, "#d0b090"),
    "bloom-bonnet": ("bell", "#ff9ccf", "#f4e8ec", "#fff0f6"),
    "ghost-fungus": ("fan", "#d8f0e0", "#f0fff6", "#9ff4c8"),
    "coral-fungus": ("coral", "#ff8a70", None, "#ffc0a8"),
    "cave-truffle": ("truffle", "#4a3426", None, "#7a5a40"),
    "starlight-bonnet": ("bell", "#3a3a8a", "#d8d8f0", "#fff8b0"),
    "amethyst-deceiver": ("dome", "#9a5ad8", "#c8a8e8", "#d4a8ff"),
    "ancient-sporecrown": ("crown", "#c8a040", "#efe2c8", "#9ff4ff"),
    "foxfire-button": ("dome", "#4a8a6a", "#e8f0dc", "#b8ff9a"),
    "velvet-shank": ("flat", "#b8743a", "#5a3a22", "#e0a060"),
    "ember-cap": ("dome", "#d86a2a", "#f0e0c8", "#ffc070"),
    "veil-cap": ("bell", "#c8c8f0", "#e8e8ff", "#9a9ad0"),
    # Plant & Fungi Catalogue (fungi)
    "mirrorcap": ("dome", "#c8ccd8", "#eef0f4", "#ffffff"),
    "glimmerlace": ("coral", "#d8d0f0", None, "#b0f0f0"),
    "opaline-shelf": ("shelf", "#e0c8e8", "#f4e8f8", "#9ae8e0"),
    "honey-mushroom": ("dome", "#d8a040", "#f0e0b0", "#f8d070"),
    "jack-o-lantern-mushroom": ("trumpet", "#f08a20", "#f8b050", "#ffd070"),
    "bluebell-glowcap": ("bell", "#5a8ae8", "#d8e4ff", "#a8d0ff"),
    "nightlight-bracket": ("shelf", "#4a6a5a", "#d8f0e0", "#9ff4c8"),
    "starspore": ("puff", "#e8f0ff", None, "#7cf2ff"),
    "veil-shank": ("cone", "#d0d0ec", "#eeeeff", "#a8a8d8"),
    "wisp-puff": ("puff", "#e8e8f8", None, "#c8c8f4"),
    "shaggy-inkcap": ("shaggy", "#f4f0e8", None, "#2a2a34"),
    "fly-agaric": ("toad", "#e03020", "#f4ecdc", "#ffffff"),
    "dead-mans-fingers": ("coral", "#2a2a2a", None, "#5a5a5a"),
    "violet-webcap": ("dome", "#8a4ad0", "#c8a8e8", "#d8b8ff"),
    "stinkhorn": ("cone", "#6a5a2a", "#f0ead8", "#3a3018"),
    "morel": ("morel", "#a07850", "#efe2c8", "#c8a070"),
    "spore-lantern": ("puff", "#d8c090", None, "#fff0b0"),
    "crown-puffball": ("crown", "#efe6d0", "#f8f4e8", "#d8c8a0"),
    "green-elf-cup": ("trumpet", "#3aa84a", "#7ad86a", "#a8f0a0"),
    "ring-morel": ("morel", "#c8a070", "#efe2c8", "#fff0d0"),
    "wisp-cap": ("bell", "#dcdcf4", "#f0f0ff", "#b0b0e8"),
}
GLOWING = {"bluebell-glowcap", "nightlight-bracket", "starspore", "jack-o-lantern-mushroom", "spore-lantern", "foxfire-button", "ember-cap", "wisp-cap", "glowcap", "crystal-cap", "moonlight-morel", "ghost-fungus", "starlight-bonnet", "ancient-sporecrown"}


def draw_mushroom(shape, cap, stem, accent):
    stem = stem or "#efe2c8"
    accent = accent or shade(cap, 0.45)
    palette = pal(cap, shade(cap, 0.35), stem, shade(stem, -0.2), accent)

    def d(c, f):
        glow = 6 if f == 1 else 3
        if shape in ("dome", "toad", "cone", "bell", "flat", "ink"):
            top = {"dome": 4, "toad": 3, "cone": 2, "bell": 3, "flat": 6, "ink": 2}[shape]
            c.rect(7, top + 3, 9, 14, 4)
            c.set(9, 13, 5)
            if shape == "dome":
                c.ellipse(8, top + 4, 5.5, 4, 2, clip=lambda x, y: y <= top + 3)
                c.set(6, top + 1, glow); c.set(9, top, glow); c.set(10, top + 2, glow)
            elif shape == "toad":
                c.ellipse(8, top + 5, 6.5, 5, 2, clip=lambda x, y: y <= top + 4)
                for (x, y) in ((5, top + 2), (8, top + 1), (11, top + 3), (7, top + 3)):
                    c.set(x, y, 6)
            elif shape == "cone":
                for y in range(top, top + 6):
                    half = (y - top) // 1 // 1
                    c.rect(8 - min(half, 5), y, 8 + min(half, 5), y, 2)
                c.line(8, top + 1, 6, top + 5, 3 if f == 0 else 6)
            elif shape == "bell":
                c.ellipse(8, top + 4, 4.5, 5, 2, clip=lambda x, y: y <= top + 6)
                c.set(7, top + 2, glow); c.set(9, top + 4, glow)
            elif shape == "flat":
                c.ellipse(8, top + 1.5, 6.5, 2, 2)
                c.rect(4, top, 12, top, 3)
            elif shape == "ink":
                c.ellipse(8, top + 5, 3.5, 6, 2, clip=lambda x, y: y <= top + 8)
                for x in range(5, 12, 2):
                    c.set(x, top + 9, 6)
                c.set(7, top + 3, 3)
        elif shape == "puff":
            c.ellipse(8, 10.5, 5, 4.5, 2)
            c.ellipse(6.5, 8.5, 2, 1.6, 3)
            c.rect(5, 14, 11, 14, 5)
        elif shape == "shelf":
            c.rect(3, 4, 4, 14, 4)
            for i, y in enumerate((5, 9, 12)):
                c.ellipse(8, y, 6 - i, 1.6, 2)
                c.rect(5, y - 1, 12 - i, y - 1, 3)
        elif shape == "morel":
            c.rect(7, 11, 9, 14, 4)
            c.ellipse(8, 7, 3.5, 5, 2)
            for (x, y) in ((7, 4), (9, 6), (7, 8), (9, 9), (8, 3)):
                c.set(x, y, 3 if f == 0 else 6)
        elif shape == "oyster":
            for (x, y, r) in ((6, 9, 4), (10, 7, 3.5), (9, 12, 3)):
                c.ellipse(x, y, r, r * 0.6, 2)
                c.set(x - 1, y - 1, 3)
            c.rect(7, 13, 8, 14, 4)
        elif shape == "fan":
            for i, col in enumerate((2, 6, 3, 2)):
                c.ellipse(8, 13, 7 - i * 1.5, 7 - i * 1.5, col, clip=lambda x, y: y <= 12)
            if f == 1:
                c.set(6, 8, 6); c.set(10, 9, 6)
        elif shape == "trumpet":
            for y in range(4, 15):
                half = max(1, (14 - y) // 2)
                c.rect(8 - half, y, 8 + half, y, 2 if y > 5 else 3)
        elif shape == "shaggy":
            c.ellipse(8, 8, 5, 5, 2)
            for x in range(4, 13, 2):
                c.line(x, 8, x, 13 - (x % 3), 6)
        elif shape == "star":
            for (dx, dy) in ((-6, 0), (6, 0), (-4, -3), (4, -3), (-4, 3), (4, 3)):
                c.line(8, 11, 8 + dx, 11 + dy * 0.5, 2)
            c.ellipse(8, 9, 2.5, 2.5, 6)
        elif shape == "coral":
            for x0 in (5, 8, 11):
                c.line(x0, 14, x0 - 1, 6, 2)
                c.line(x0 - 1, 9, x0 - 3, 5, 2)
                c.line(x0 - 1, 8, x0 + 1, 4, 3)
        elif shape == "truffle":
            c.ellipse(8, 11, 5, 4, 2)
            for (x, y) in ((6, 9), (9, 10), (7, 12), (10, 12)):
                c.set(x, y, 6)
            c.rect(2, 14, 13, 14, 5)
        elif shape == "crown":
            c.rect(7, 9, 9, 14, 4)
            for (x, y, r) in ((5, 7, 3), (11, 7, 3), (8, 4, 3.5)):
                c.ellipse(x, y + 1, r, r * 0.8, 2, clip=lambda xx, yy, yy0=y: yy <= yy0 + 1)
                c.set(x, y - 1, glow)
            if f == 1:
                c.set(3, 3, 6); c.set(13, 2, 6); c.set(8, 0, 6)
    return palette, d


# ------------------------------------------------------------------ plants
# palette: 2 stem, 3 leaf, 4 leaf light, 5 petal, 6 petal light, 7 centre

PLANTS = {
    "clover": ("cloverpatch", "#5fbf4a", None, None),
    "fern": ("fern", "#4fae3a", None, None),
    "wildflower": ("daisies", "#5fbf4a", "#ff9ccf", "#ffd84a"),
    "bluebell": ("bells", "#4f8a2c", "#5a7cff", None),
    "moss-rose": ("rose", "#6a9a48", "#ff6a8a", "#ffd0dc"),
    "sunpetal": ("sunflower", "#5fbf4a", "#ffd84a", "#c2611f"),
    "glowbloom": ("tulip", "#3d7a70", "#7cf2ff", "#ffffff"),
    "cave-lily": ("lily", "#6a8a6a", "#c8b8f0", "#f0e8ff"),
    "dandelion": ("dandelion", "#5fbf4a", "#ffd84a", "#fff3a8"),
    "moss-tuft": ("mosstuft", "#6a9a48", None, None),
    "sorrel": ("hearts", "#6cc24a", "#fff0f0", None),
    "violet": ("violet", "#4f8a2c", "#8a5ad8", "#ffd84a"),
    "pebblewort": ("pebblewort", "#8aa880", "#c8d8c0", None),
    "foxglove": ("foxglove", "#4f8a2c", "#d870c0", "#f0c0e8"),
    "wild-strawberry": ("berry", "#5fbf4a", "#e0302c", "#fff0a0"),
    "trillium": ("trillium", "#4f8a2c", "#f8f4f0", "#ffd84a"),
    "stonecrop": ("stonecrop", "#8ab060", "#ffd84a", None),
    "moonflower": ("trumpet", "#4f8a2c", "#f4f4ff", "#bfe8ff"),
    "pitcher-plant": ("pitcher", "#6a9a3a", "#b0402c", None),
    "crystal-thistle": ("thistle", "#6a8a7a", "#7ce0ff", "#e8ffff"),
    "ghost-orchid": ("orchid", "#9ab8a0", "#ffffff", "#e8f0ff"),
    "deeproot-lantern": ("lantern", "#5a4a30", "#ffb040", "#fff0b0"),
    "water-reed": ("reeds", "#5ea347", "#7a4a24", "#b0804a"),
    "heartwood-sapling": ("sapling", "#7a4a2a", "#5ea347", "#ffd84a"),
    "hollow-root": ("roots", "#5a9a3a", "#8a5a34", "#c8a070"),
    "primrose": ("primrose", "#5fbf4a", "#f8e070", "#e8a030"),
    "forget-me-not": ("forgetmenot", "#4f9440", "#6a9cff", "#ffe060"),
    "poppy": ("poppy", "#4f8a2c", "#e8302c", "#1b1420"),
    "snowdrop": ("snowdrop", "#5fa04a", "#f4f8ff", "#9ad87a"),
    "columbine": ("columbine", "#4f8a2c", "#9a5ad8", "#f8e8a0"),
    "bleeding-heart": ("bleedingheart", "#5a9a3a", "#ff6aa8", "#ffffff"),
    "meadow-daisy": ("flower", "#5fbf4a", "#f8f8f0", "#ffd84a"),
    # More Bloom flowers
    "marigold": ("flower", "#4f8a2c", "#f08a20", "#c85a10"),
    "sweet-pea": ("rose", "#5fbf4a", "#f0b0e0", "#c8a0f0"),
    "lavender": ("foxglove", "#6a8a5a", "#a07ae0", "#d8c8ff"),
    "sunfire-daisy": ("daisies", "#4f8a2c", "#ffb020", "#ff6020"),
    "petalwhirl": ("bigflower", "#4f8a2c", "#ff9ccf", "#fff3c4"),
    # Plant & Fungi Catalogue (flora)
    "silver-ragwort": ("rosette", "#a8b0b8", "#e8e8f0", "#ffffff"),
    "jewelweed": ("trumpet", "#4f9440", "#f0a030", "#ffd84a"),
    "pearlroot": ("rosette", "#c8d0d8", "#f4f0ff", "#ffffff"),
    "glassreed": ("reeds", "#b8d8e0", "#e8f8ff", "#ffffff"),
    "prismbell": ("bells", "#6a8a7a", "#d8f0ff", "#ffc8f0"),
    "opal-fern": ("fern", "#b8c8d8", None, None),
    "rainbow-eucalyptus": ("sapling", "#c8783a", "#7ac0a0", "#c8a0f0"),
    "cornflower": ("flower", "#4f8a2c", "#4a7aff", "#2a3a8a"),
    "cosmos": ("daisies", "#5fbf4a", "#ff7ab8", "#ffd84a"),
    "lupine": ("foxglove", "#4f8a2c", "#8a6ae8", "#d8c8ff"),
    "anemone": ("poppy", "#4f8a2c", "#e83060", "#1b1420"),
    "mooncup-blossom": ("tulip", "#4f7a5a", "#f0f0e8", "#c8e0ff"),
    "stargrass": ("tuft", "#3f7a4a", "#e8f8ff", "#7cf2ff"),
    "lantern-lily": ("lantern", "#3f6a4a", "#ffd070", "#fff8d0"),
    "moonpetal": ("lily", "#3f6a5a", "#a8c8ff", "#e8f4ff"),
    "foxfire-orchid": ("orchid", "#5a8a6a", "#e8fff0", "#9ff4c8"),
    "moonwort": ("fern", "#6a8a6a", None, None),
    "ghostpipe": ("snowdrop", "#e8e8f0", "#f8f8ff", "#c8c8d8"),
    "white-sage": ("rosette", "#a8b8a8", "#e8f0e8", "#ffffff"),
    "ancestors-lace": ("daisies", "#5a7a6a", "#f4f4f8", "#e8e0c8"),
    "wispwillow": ("sapling", "#6a6a8a", "#a8b8d8", "#d8e0ff"),
    "corpse-flower": ("tulip", "#4a5a3a", "#8a2030", "#e0c0a0"),
    "wood-sorrel": ("cloverpatch", "#5fbf4a", "#f8f0f4", "#ffd84a"),
    "wild-ginger": ("rosette", "#3f8a3a", "#7a3a2a", "#a05a3a"),
    "hosta": ("rosette", "#3fa04a", "#c8e8a0", "#e8f8d0"),
    "maidenhair-fern": ("fern", "#4fae3a", None, None),
    "ostrich-fern": ("fern", "#2f8a2a", None, None),
    "solomons-seal": ("bells", "#4f9440", "#f0f4e0", "#c8e0a0"),
    "hellebore": ("trillium", "#3f7a3a", "#d8a8c8", "#f0e0a0"),
    "canopy-bells": ("bells", "#2f8a2a", "#a8e070", "#d8f8a0"),
    "heartleaf-canopy": ("sapling", "#5a4a30", "#3fae3a", "#8ad46b"),
    "lantern-flower": ("lantern", "#3f6a4a", "#7cf2ff", "#e8ffff"),
    "starwort": ("lily", "#3f6a4a", "#e8f0ff", "#7cf2ff"),
    "buttercup": ("rose", "#5fbf4a", "#ffd84a", "#fff3c4"),
    "wild-rose": ("rose", "#4f8a2c", "#ff8ab8", "#ffd84a"),
    "sun-lily": ("lily", "#4f8a2c", "#ffb030", "#fff0a0"),
    "dawn-peony": ("rose", "#4f8a2c", "#ffc0d0", "#fff0e0"),
    "greenheart-vine": ("fern", "#2aa82a", None, None),
    "prism-rose": ("rose", "#6a8a7a", "#c8b4f4", "#f4f0ff"),
    "mistbell": ("bells", "#5a7a6a", "#c8c8f4", "#9a9ad0"),
    "honeybell": ("snowdrop", "#5fa04a", "#ffd870", "#ffb030"),
    "feather-fern": ("fern", "#4f9440", None, None),
    "glassbell": ("snowdrop", "#7a9a9a", "#d8ccf8", "#f4f0ff"),
}
PLANT_GLOW = {"sunfire-daisy", "stargrass", "lantern-lily", "moonpetal", "foxfire-orchid", "prismbell", "opal-fern", "lantern-flower", "starwort", "prism-rose", "glassbell", "glowbloom", "moonflower", "deeproot-lantern", "crystal-thistle"}


def draw_plant(shape, leaf, petal, centre):
    petal = petal or shade(leaf, 0.4)
    centre = centre or shade(petal, 0.5)
    palette = pal(shade(leaf, -0.25), leaf, shade(leaf, 0.35), petal, shade(petal, 0.4), centre)

    def d(c, f):
        hi = 6 if f == 1 else 7
        if shape == "clover":
            c.line(8, 14, 8, 9, 2)
            for cx, cy in ((6, 7), (10, 7), (8, 5)):
                c.ellipse(cx, cy, 2.2, 2, 3); c.set(cx - 1, cy - 1, 4)
        elif shape == "fern":
            c.line(8, 14, 8, 4, 2)
            for i, y in enumerate(range(13, 5, -2)):
                c.line(8, y, 4 + i // 2, y - 2, 3); c.line(8, y, 12 - i // 2, y - 2, 3)
            c.set(8, 3, 4)
        elif shape in ("flower", "bigflower"):
            c.line(8, 14, 8, 8, 2)
            c.ellipse(5.5, 11, 2.5, 1.2, 3); c.ellipse(10.5, 12, 2.5, 1.2, 3)
            r = 4.5 if shape == "bigflower" else 3
            c.ellipse(8, 6, r, r * 0.9, 5)
            c.ellipse(8, 6, r * 0.45, r * 0.45, hi)
            c.set(6, 4, 6)
        elif shape == "bells":
            c.line(6, 14, 6, 6, 2); c.line(6, 6, 9, 3, 2)
            for (x, y) in ((10, 5), (8, 8), (11, 9)):
                c.ellipse(x, y, 1.8, 2, 5); c.set(x - 1, y - 1, 6)
        elif shape == "rose":
            c.ellipse(8, 13, 6, 2, 3)
            c.ellipse(8, 9, 3.5, 3, 5)
            c.set(8, 9, 6); c.set(7, 8, 7); c.set(9, 10, 6)
        elif shape == "lily":
            c.line(8, 14, 8, 7, 2)
            for dx in (-3, 0, 3):
                c.line(8, 7, 8 + dx, 3, 5)
            c.set(8, 6, hi)
            c.ellipse(6, 12, 2.5, 1, 3)
        elif shape == "dandelion":
            c.line(8, 14, 8, 7, 2)
            c.ellipse(5, 13, 2.5, 1, 3)
            c.ellipse(8, 5, 3.5, 3.5, 5 if f == 0 else 6)
            c.set(8, 5, 7)
        elif shape == "tuft":
            c.ellipse(8, 12, 6, 3.5, 3)
            for (x, y) in ((5, 11), (8, 10), (11, 11), (7, 12), (10, 13)):
                c.set(x, y, 4)
        elif shape == "sorrel":
            c.line(8, 14, 8, 9, 2)
            for cx, cy in ((6, 8), (10, 8), (8, 6)):
                c.ellipse(cx, cy, 2, 1.8, 3)
            c.set(11, 4, 5); c.set(12, 5, 5)
        elif shape == "rosette":
            for (dx, dy) in ((-4, 0), (4, 0), (0, -3), (-3, -2), (3, -2), (0, 1)):
                c.ellipse(8 + dx * 0.8, 11 + dy, 2.2, 1.4, 3)
            c.ellipse(8, 10, 1.8, 1.4, 4)
            if petal:
                c.set(8, 8, 5); c.set(5, 9, 5); c.set(11, 9, 5)
        elif shape == "foxglove":
            c.line(8, 14, 8, 2, 2)
            for i, y in enumerate(range(4, 12, 2)):
                x = 9 if i % 2 else 7
                c.ellipse(x, y, 1.6, 1.4, 5); c.set(x, y, 6)
        elif shape == "berry":
            c.line(7, 14, 7, 8, 2)
            c.ellipse(5, 9, 2.5, 1.5, 3); c.ellipse(10, 10, 2.5, 1.5, 3)
            c.ellipse(9, 6, 2, 2.2, 5); c.set(9, 5, 7); c.set(8, 6, 7)
        elif shape == "trillium":
            c.line(8, 14, 8, 9, 2)
            c.ellipse(5, 11, 2.5, 1.2, 3); c.ellipse(11, 11, 2.5, 1.2, 3)
            for (x, y) in ((8, 4), (5, 8), (11, 8)):
                c.ellipse(x, y, 2.2, 2.2, 5)
            c.set(8, 7, 7)
        elif shape == "pitcher":
            c.ellipse(8, 9, 3.5, 5, 3)
            c.ellipse(8, 5, 3, 1.2, 5)
            c.line(6, 7, 6, 12, 5)
            c.rect(6, 14, 10, 14, 2)
        elif shape == "thistle":
            c.line(8, 14, 8, 8, 2)
            c.line(8, 11, 5, 9, 3); c.line(8, 11, 11, 9, 3)
            c.ellipse(8, 7, 2.5, 2, 3)
            for x in range(6, 11):
                c.set(x, 4, 5 if (x + f) % 2 else 6)
            c.set(7, 3, 6); c.set(9, 3, 6)
        elif shape == "orchid":
            c.line(9, 14, 8, 6, 2)
            c.ellipse(6, 13, 3, 1, 3)
            c.ellipse(6, 6, 2.5, 1.6, 5); c.ellipse(11, 6, 2.5, 1.6, 5); c.ellipse(8.5, 4, 1.6, 2, 5)
            c.set(8, 7, 7)
        elif shape == "primrose":                       # a low rosette of leaves with a few 5-petal pale flowers
            for (x, y) in ((4, 13), (12, 13), (8, 14), (6, 12), (10, 12)):
                c.ellipse(x, y, 2, 1, 3); c.set(x - 1, y - 1, 4)
            for (cx, cy) in ((5, 8), (11, 9), (8, 6)):
                for (dx, dy) in ((0, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)):
                    c.set(cx + dx, cy + dy, 5)
                c.set(cx, cy - 1, 6); c.set(cx, cy, 7)
                c.line(cx, cy + 2, cx, 12, 2)
        elif shape == "forgetmenot":                    # many tiny blue flowers with yellow eyes on fine stems
            for (x, top) in ((4, 7), (7, 4), (10, 6), (12, 9), (6, 10)):
                c.line(x, 14, x, top + 1, 2)
            for (cx, cy) in ((4, 6), (7, 3), (10, 5), (12, 8), (6, 9), (9, 8), (3, 9)):
                for (dx, dy) in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    c.set(cx + dx, cy + dy, 5)
                c.set(cx, cy, 7)
            c.ellipse(8, 14, 5, 1, 3)
        elif shape == "poppy":                           # one big red cup on a tall hairy stem, plus a bud
            c.line(8, 14, 8, 6, 2); c.line(11, 14, 12, 9, 2)
            c.ellipse(8, 4.5, 4, 3, 5)
            c.ellipse(7, 3.5, 2, 1.3, 6)
            c.set(8, 5, 7); c.set(7, 5, 7); c.set(9, 5, 7); c.set(8, 6, 7)
            c.ellipse(12, 8, 1.2, 1.6, 3); c.set(12, 7, 5)
            c.ellipse(5, 12, 2.2, 1, 3); c.ellipse(11, 13, 2, 1, 3)
        elif shape == "snowdrop":                        # arching stems with nodding white bells
            for (x0, h, d) in ((6, 9, 1), (10, 8, -1), (8, 10, 1)):
                c.line(x0, 14, x0, 14 - h, 2)
                tip = (x0 + d * 2, 14 - h + 1)
                c.line(x0, 14 - h, tip[0], tip[1], 2)
                c.ellipse(tip[0], tip[1] + 2, 1.4, 2, 5)
                c.set(tip[0], tip[1] + 3, 7); c.set(tip[0] - 1, tip[1] + 1, 6)
            for x in (5, 7, 9, 11):
                c.line(x, 14, x + (1 if x < 8 else -1), 10, 3)
        elif shape == "columbine":                       # spurred violet flowers with pale centres on branching stems
            c.line(8, 14, 8, 5, 2); c.line(8, 9, 4, 6, 2); c.line(8, 8, 12, 5, 2)
            for (cx, cy) in ((4, 5), (12, 4), (8, 3)):
                c.ellipse(cx, cy, 2, 1.6, 5)
                c.set(cx - 2, cy - 2, 5); c.set(cx + 2, cy - 2, 5)
                c.set(cx, cy, 7); c.set(cx, cy + 1, 7)
            c.ellipse(6, 12, 2, 1, 3); c.ellipse(10, 12, 2, 1, 3); c.set(9, 11, 4)
        elif shape == "bleedingheart":                   # an arching stem hung with little pink hearts
            for x in range(3, 14):
                y = 4 + int(((x - 8) ** 2) * 0.12)
                c.set(x, y, 2)
            c.line(3, 6, 3, 14, 2)
            for i, x in enumerate((5, 7, 9, 11, 13)):
                y = 5 + int(((x - 8) ** 2) * 0.12) + 1
                c.set(x - 1, y, 5); c.set(x, y, 5); c.set(x, y + 1, 5); c.set(x - 1, y + 1, 5); c.set(x - 1, y + 2, 6 if i % 2 else 5)
                c.set(x, y + 2, 7 if i == 2 else 5)
            c.ellipse(6, 13, 2.5, 1, 3); c.ellipse(11, 13, 2.5, 1, 3); c.set(5, 12, 4)
        elif shape == "roots":                          # hollow root: a knot of bare roots with a few leaves
            for (x0, y0, x1, y1) in ((8, 9, 3, 14), (8, 9, 13, 14), (8, 9, 6, 15), (8, 9, 11, 15)):
                c.line(x0, y0, x1, y1, 5)
            c.ellipse(8, 10, 2.5, 1.6, 5); c.set(7, 9, 6); c.set(9, 11, 7)
            c.line(8, 9, 8, 5, 2)
            c.ellipse(6, 5, 2, 1.2, 3); c.ellipse(10, 4, 2, 1.2, 3); c.set(10, 3, 4); c.set(6, 4, 4)
        elif shape == "lantern":
            c.line(8, 14, 8, 5, 2)
            c.line(8, 5, 11, 4, 2)
            c.ellipse(11, 8, 2.5, 3, 5 if f == 0 else 6)
            c.set(11, 8, 7)
            c.ellipse(5, 12, 2.5, 1, 3)
        elif shape == "cloverpatch":                    # low three-leaf clovers with a round white flower head
            for (cx, cy) in ((4, 12), (11, 13), (7, 10)):
                for (dx, dy) in ((-1, 0), (1, 0), (0, -1)):
                    c.ellipse(cx + dx * 1.3, cy + dy * 1.3, 1.3, 1.2, 3)
                c.set(cx, cy, 4)
            c.line(9, 12, 9, 6, 2)
            c.ellipse(9, 5, 1.8, 1.8, 5); c.set(8, 4, 6); c.set(10, 5, 7)
        elif shape == "hearts":                         # sorrel: heart-shaped leaves on thin stems, tiny bells
            for (x, top) in ((5, 7), (8, 5), (11, 8)):
                c.line(x, 14, x, top + 2, 2)
                c.set(x - 1, top, 3); c.set(x + 1, top, 3); c.ellipse(x, top + 1.2, 1.6, 1.2, 3)
                c.set(x - 1, top, 4)
            c.line(13, 14, 13, 4, 2); c.set(13, 3, 5); c.set(12, 4, 5)
        elif shape == "mosstuft":                       # moss mound with thin spore stalks (brown tips)
            c.ellipse(8, 13, 6, 2.6, 3)
            c.ellipse(6.5, 12, 3, 1.4, 4)
            for x in (5, 8, 10, 12):
                c.line(x, 12, x, 6 + (x % 3), 2)
                c.set(x, 5 + (x % 3), 7)
        elif shape == "pebblewort":                     # a pale rosette tucked between grey pebbles
            for (dx, dy) in ((-3, 0), (3, 0), (0, -2), (-2, -2), (2, -2)):
                c.ellipse(8 + dx, 11 + dy, 1.8, 1.1, 3)
            c.ellipse(8, 10, 1.4, 1, 4)
            for (x, y) in ((3, 13), (12, 13), (5, 14), (10, 14)):
                c.rect(x, y, x + 1, y, 6)
        elif shape == "stonecrop":                      # succulent stars with clusters of yellow flowers
            for (cx, cy) in ((5, 12), (11, 12)):
                for (dx, dy) in ((-2, 0), (2, 0), (0, -2), (0, 1)):
                    c.line(cx, cy, cx + dx, cy + dy, 3)
                c.set(cx, cy, 4)
            c.line(8, 13, 8, 6, 2)
            for (x, y) in ((7, 5), (9, 5), (8, 4), (6, 6), (10, 6)):
                c.set(x, y, 5)
            c.set(8, 5, 7)
        elif shape == "violet":                         # low heart leaves and a nodding five-petal flower
            c.ellipse(5, 12, 2.6, 1.8, 3); c.ellipse(11, 12.5, 2.6, 1.8, 3); c.set(4, 11, 4)
            c.line(8, 13, 8, 8, 2); c.line(8, 8, 10, 7, 2)
            for (dx, dy) in ((0, -2), (-2, -1), (2, -1), (-1, 1), (1, 1)):
                c.set(10 + dx, 6 + dy, 5)
            c.set(10, 6, 7)
        elif shape == "daisies":                        # a few tall daisies of different heights
            for (x, top) in ((5, 6), (9, 3), (12, 8)):
                c.line(x, 14, x, top + 1, 2)
                for (dx, dy) in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    c.set(x + dx, top + dy, 5)
                c.set(x, top, 7)
            c.ellipse(7, 13, 2.5, 1, 3)
        elif shape == "sunflower":                      # one tall sunflower: big yellow ring, brown seed head
            c.line(8, 15, 8, 8, 2)
            c.ellipse(5.5, 11, 2.5, 1.2, 3); c.ellipse(10.5, 12, 2.5, 1.2, 3)
            c.ellipse(8, 5, 4.8, 4.5, 5)
            c.ellipse(8, 5, 2.4, 2.3, 7)
            c.set(6, 2, 6); c.set(7, 4, hi)
        elif shape == "tulip":                          # glowbloom: a closed glowing cup on a stem
            c.line(8, 15, 8, 8, 2)
            c.ellipse(5, 12, 2.5, 1.2, 3); c.ellipse(11, 11, 2.5, 1.2, 3)
            c.ellipse(8, 5.5, 3, 3.6, 5)
            c.line(6, 2, 6, 4, 5); c.line(10, 2, 10, 4, 5); c.set(8, 2, 5)
            c.set(8, 5, hi); c.set(7, 4, 6)
        elif shape == "trumpet":                        # moonflower: a vine with pale trumpet blooms
            c.line(4, 15, 6, 9, 2); c.line(6, 9, 10, 6, 2)
            c.ellipse(4, 11, 1.8, 1.2, 3); c.ellipse(9, 8, 1.8, 1.2, 3)
            for (x, y) in ((11, 4), (5, 7)):
                c.ellipse(x, y, 2.6, 2.2, 5); c.set(x, y, 7); c.set(x - 1, y - 1, 6)
        elif shape == "reeds":                          # water reeds: spaced bright stalks, two cattail heads
            for (x, top, lean) in ((3, 5, -1), (6, 2, 0), (9, 3, 0), (12, 6, 1)):
                for y in range(top, 15):
                    c.set(x + (lean if y < top + 3 else 0), y, 4 if y < top + 4 else 3)
            for (x, y) in ((6, 4), (9, 6)):
                c.rect(x, y, x, y + 3, 5); c.set(x, y, 6)
            c.rect(2, 14, 13, 14, 2)
        elif shape == "sapling":
            c.rect(7, 9, 8, 15, 2)
            c.ellipse(8, 6, 5.5, 4.5, 3)
            c.ellipse(6.5, 4.5, 2.5, 1.8, 4)
            c.set(10, 7, 7 if f == 0 else 6)
    return palette, d


# ------------------------------------------------------------------ main

def main():
    items = json.load(open(os.path.join(CONTENT, "items.json")))
    for it in items:
        key = it["id"].split(".", 1)[1]
        cat = it["category"]
        if cat == "mushroom":
            shape, cap, stem, accent = MUSHROOMS.get(key, ("dome", name_colour(key), None, None))
            palette, d = draw_mushroom(shape, cap, stem, accent)
            anim = key in GLOWING

            # Its bud stage while growing in the garden: a little closed button on a short stem.
            def bud(c, f, key=key):
                h = 3 + (sum(map(ord, key)) % 2)
                c.rect(7, 15 - h, 8, 14, 4)
                c.set(8, 14, 5)
                c.ellipse(7.5, 14 - h, 2.6, 1.8, 2, clip=lambda x, y, t=14 - h: y <= t)
                c.set(7, 13 - h, 3)
        elif cat == "plant":
            shape, leaf, petal, centre = PLANTS.get(key, ("flower", "#5fbf4a", name_colour(key), None))
            palette, d = draw_plant(shape, leaf, petal, centre)
            anim = key in PLANT_GLOW
            leafy = petal is None

            # Its bud stage while growing in the garden (stem, leaves and a closed bud in its colour).
            def bud(c, f, leafy=leafy, key=key):
                h = 6 + (sum(map(ord, key)) % 4)
                c.line(8, 14, 8, 15 - h, 2)
                c.ellipse(6, 12, 2, 1, 3); c.ellipse(10, 11, 2, 1, 3)
                top = 15 - h
                if leafy:
                    c.ellipse(8, top, 1.8, 1.6, 4); c.set(7, top - 1, 3)
                else:
                    c.ellipse(8, top, 1.4, 2, 5); c.set(8, top + 1, 3); c.set(7, top - 1, 6)
        else:
            continue
        sprite(it["sprite"], palette, d, frames=2 if anim else 1, durations=[0.8, 0.8] if anim else None)
        sprite("plant.bud." + key, palette, bud, tags=("plant", "bud"))
    # Remove placeholder art for catalogue entries that are no longer in the content.
    used = {it["sprite"] for it in items} | {"plant.bud." + it["id"].split(".", 1)[1] for it in items}
    removed = 0
    for folder in ("item", "plant"):
        d = os.path.join(ROOT, "Resources", "Sprites", folder)
        for name in os.listdir(d) if os.path.isdir(d) else []:
            if name.endswith(".json") and name[:-5] not in used:
                os.remove(os.path.join(d, name))
                removed += 1
    print("content sprites: %d catalogue entries (+ buds); removed %d unused" % (len(items), removed))


if __name__ == "__main__":
    main()
