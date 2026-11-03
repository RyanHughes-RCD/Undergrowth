#!/usr/bin/env python3
"""Placeholder art for the garden (run via gen_placeholders.py, or on its own).

    python3 tools/gen_garden_sprites.py

Writes:
  packet.<plant id>     a named seed packet for every plant in Content/plants.json (gifts and colour varieties use
                        these): a band in its soil's colour and a little flower or cap in the plant's own colour
  packet.<school>.<tier> a blind seed packet (Common, Uncommon or Rare seeds of a school): a question mark, and
                        a trim for the tier
  amend.<school>        a cloth sack of soil amendment for each school (Content/amendments.json), and
  amend.plain           a sack of plain garden loam
  garden.tin            the opening's old seed tin
  ui.icon.coin          the coin
All placeholder art, meant to be redrawn.
"""
import colorsys
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_placeholders import Canvas, write, ROOT  # noqa: E402

CONTENT = os.path.join(ROOT, "Resources", "Content")
SPRITES = os.path.join(ROOT, "Resources", "Sprites")
OUT = "#1b1420"
# Each school's colour (matches the UI's SCHOOL_COLORS) and a lighter tone.
SCHOOL = {
    "spore": ("#a87a54", "#d8b890"), "glow": ("#3fb8c8", "#a8f4ff"), "bloom": ("#e05a9a", "#ffb8d8"),
    "verdure": ("#3f9a3a", "#a8e07a"), "shimmer": ("#8a7ac8", "#ddd0ff"), "spirit": ("#6a6ab8", "#c8c8f4"),
    None: ("#8a6440", "#c49a6c"),
}


def load(name):
    with open(os.path.join(CONTENT, name)) as f:
        return json.load(f)


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in c)


def accent_of(sprite_id):
    """The plant's own colour: the most used vivid, non-green colour in its catalogue sprite."""
    path = os.path.join(SPRITES, sprite_id.split(".")[0], sprite_id + ".json")
    try:
        sp = json.load(open(path))
    except OSError:
        return "#e8d8a0", "#fff6d0"
    pal = sp.get("palette") or []
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    counts = {}
    for row in sp["frames"][0]["rows"]:
        for ch in row:
            if ch != ".":
                counts[alphabet.index(ch)] = counts.get(alphabet.index(ch), 0) + 1
    best, score = None, -1
    for i, n in counts.items():
        if i >= len(pal) or not pal[i].startswith("#") or len(pal[i]) < 7:
            continue
        h, s, v = colorsys.rgb_to_hsv(*rgb(pal[i][:7]))
        green = 0.2 < h < 0.45
        sc = n * (s + 0.25) * v * (0.15 if green else 1)
        if v > 0.35 and sc > score:
            best, score = pal[i][:7], sc
    best = best or "#e8d8a0"
    h, s, v = colorsys.rgb_to_hsv(*rgb(best))
    return best, hexc(colorsys.hsv_to_rgb(h, s * 0.55, min(1, v * 0.6 + 0.45)))


def sprite(sid, palette, draw, size=(16, 16), anchor=None, frames=1, durations=None, tags=("garden",)):
    out = []
    for f in range(frames):
        c = Canvas(*size)
        draw(c, f)
        c.outline(1)
        out.append(c)
    write(sid, size, out, palette=["transparent", OUT] + palette, anchor=anchor or (size[0] // 2, size[1] - 1),
          tags=list(tags), durations=durations)


def packets():
    """2 paper, 3 paper light, 4 fold shade, 5 band, 6 band light, 7 glyph, 8 glyph light, 9 stem."""
    plants = load("plants.json")
    items = {i["id"]: i for i in load("items.json")}
    for p in plants:
        item = items.get(p["item"], {})
        band, band_l = SCHOOL.get(p.get("school"), SCHOOL[None])
        glyph, glyph_l = accent_of(item.get("sprite", ""))
        fungus = p.get("kind") == "fungus"

        def draw(c, f, fungus=fungus):
            c.rect(3, 2, 12, 14, 2)                    # the packet
            c.rect(4, 3, 11, 13, 3)
            c.rect(3, 2, 12, 4, 5); c.rect(4, 2, 11, 2, 6)    # its band, folded over the top
            c.rect(12, 5, 12, 14, 4)
            if fungus:                                  # a little cap on a stem
                c.rect(7, 10, 8, 12, 3); c.set(8, 12, 4)
                c.ellipse(7.5, 9.5, 3, 2.2, 7, clip=lambda x, y: y <= 9); c.set(6, 8, 8)
            else:                                       # a little flower on a stem
                c.line(7, 12, 7, 9, 9); c.set(8, 11, 9)
                for (dx, dy) in ((0, -1), (1, 0), (-1, 0), (0, 1)):
                    c.set(7 + dx, 8 + dy, 7)
                c.set(7, 8, 8)
        sprite("packet." + p["id"], ["#e8dcc0", "#fff6e4", "#c8b898", band, band_l, glyph, glyph_l, "#4f8a2c"], draw, tags=("garden", "packet"))


TIER_TRIM = {"common": ("#c8b898", "#e8dcc0"), "uncommon": ("#4fa83a", "#a8e07a"), "rare": ("#d8a020", "#ffe070")}


def blind_packets():
    """Blind seed packets, one per school and tier (packet.<school>.<tier>): the school's band, a question
    mark, and a trim for the tier (plain paper, green, gold foil). 2 paper, 3 paper light, 4 fold shade,
    5 band, 6 band light, 7 trim, 8 trim light, 9 mark."""
    for school in ("spore", "glow", "bloom", "verdure", "shimmer", "spirit"):
        band, band_l = SCHOOL[school]
        for tier, (trim, trim_l) in TIER_TRIM.items():
            def draw(c, f, tier=tier):
                c.rect(3, 2, 12, 14, 2)
                c.rect(4, 3, 11, 13, 3)
                c.rect(3, 2, 12, 4, 5); c.rect(4, 2, 11, 2, 6)
                c.rect(12, 5, 12, 14, 4)
                if tier != "common":                       # trim down both sides and along the bottom
                    c.rect(3, 5, 3, 14, 7); c.rect(3, 14, 12, 14, 7); c.set(4, 13, 8)
                if tier == "rare":
                    c.set(11, 6, 8); c.set(5, 11, 8)
                # a question mark
                c.rect(6, 6, 9, 6, 9); c.set(9, 7, 9); c.set(9, 8, 9); c.rect(7, 9, 8, 9, 9); c.set(7, 10, 9); c.set(7, 12, 9)
            sprite(f"packet.{school}.{tier}", ["#e8dcc0", "#fff6e4", "#c8b898", band, band_l, trim, trim_l, band], draw, tags=("garden", "packet"))


def amendments():
    """2 sack, 3 sack light, 4 sack shade, 5 contents, 6 contents light, 7 string."""
    for a in load("amendments.json"):
        col, light = SCHOOL.get(a.get("school"), SCHOOL[None])

        def draw(c, f):
            c.ellipse(8, 11, 5, 4, 2)                   # the sack
            c.ellipse(7, 10, 3, 2.4, 3)
            c.rect(6, 4, 10, 8, 2); c.rect(7, 5, 8, 7, 3)
            c.rect(12, 10, 12, 13, 4)
            c.rect(6, 7, 10, 7, 7)                      # the string
            c.ellipse(8, 4, 3, 1.6, 5, clip=lambda x, y: y <= 4)   # contents showing at the top
            c.set(7, 3, 6); c.set(9, 4, 6)
        sprite(a["id"], ["#c8a878", "#e8d0a0", "#9a7a50", col, light, "#6a4426"], draw, tags=("garden", "amendment"))


def tin():
    def draw(c, f):
        c.rect(3, 6, 12, 13, 2)                         # body
        c.rect(4, 7, 11, 12, 3)
        c.rect(12, 7, 12, 13, 4)
        c.rect(2, 4, 13, 6, 5); c.rect(3, 4, 12, 4, 6)  # lid
        c.rect(6, 9, 9, 10, 7)                          # label
        c.set(5 + 2 * f, 8, 6); c.set(10 - 4 * f, 12, 6)   # a glint that moves
    sprite("garden.tin", ["#5f8a5a", "#8ab880", "#3f5a3a", "#7a9a70", "#c8e8b0", "#e8dcc0"], draw, frames=2, durations=[0.9, 0.9])


def coin():
    def draw(c, f):
        c.ellipse(6, 6, 4.6, 4.6, 2)
        c.ellipse(5.5, 5.5, 3.2, 3.2, 3)
        c.rect(5, 4, 6, 7, 4); c.set(4, 4, 5)
    write("ui.icon.coin", (12, 12), [_outlined(draw, 12)], palette=["transparent", OUT, "#c8901c", "#ffd84a", "#a8700c", "#fff6c0"],
          anchor=(6, 6), tags=["ui"])


def _outlined(draw, size):
    c = Canvas(size, size)
    draw(c, 0)
    c.outline(1)
    return c


def main():
    packets()
    blind_packets()
    amendments()
    tin()
    coin()
    print("garden sprites written")


if __name__ == "__main__":
    main()
