#!/usr/bin/env python3
"""Placeholder art for the landscape pieces (Content/landscape.json), one sprite per growth stage.

    python3 tools/gen_landscape_sprites.py

Writes landscape.<id>.<stage> for every stage of each piece's plan (crop plants also get landscape.<id>.fruit, an overlay
of just the crop that's drawn over the grown sprite while it waits to be picked, and an icon for their produce,
produce.<school>.<tier>) (tuning.json -> landscape.plans): a sapling
that grows into a tree, a giant tree's 3x3 ancient form, a large plant young and grown, and water and
structures as built. Drawn from a few shapes per kind (`look` in landscape.json) in each school's colours.
Every sprite stands on the bottom of its footprint (anchor 3px above the bottom edge, like the landmarks);
flat pieces (water, paths, rings) cover their footprint. Placeholder art, meant to be redrawn.

Palette: 1 outline, 2 dark, 3 mid, 4 light, 5 accent, 6 accent light, 7 trunk dark, 8 trunk,
9 stone dark, 10 stone, 11 water dark, 12 water light, 13 pale.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_placeholders import Canvas, write  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "#1b1420"
TRUNK = ["#4a3424", "#7a5a3a"]
STONE = ["#5e5e68", "#9a9aa6"]
SCHOOL = {   # dark, mid, light, accent, accent light, water dark, water light
    "spore": ["#4a3a2e", "#7a5a40", "#a8845a", "#d8c8a8", "#f0e6d0", "#33402f", "#62805e"],
    "glow": ["#1e4a48", "#2f7a6a", "#4fb8a0", "#7cf2ff", "#d8ffff", "#1a3a5a", "#4fd8e8"],
    "bloom": ["#356b2e", "#5aa84a", "#8ad46b", "#ff79b8", "#ffd0e8", "#2a5a8a", "#7ab8e8"],
    "verdure": ["#27552a", "#3f8a3a", "#6fbf4a", "#a8e07a", "#e0ffb0", "#2a5a7a", "#6aa8d8"],
    "shimmer": ["#5a6a9a", "#8a9ad8", "#c8d8ff", "#f4c8ff", "#ffffff", "#4a5a9a", "#b8d8ff"],
    "spirit": ["#34344e", "#55557e", "#9a9ac8", "#e0e0ff", "#ffffff", "#23263a", "#5a6a8a"],
    None: ["#4f6a3a", "#6a8a48", "#8aaa5a", "#c8b898", "#e8dcc0", "#2a5a7a", "#6aa8d8"],
}


def palette(school):
    d, m, l, a, al, wd, wl = SCHOOL[school]
    return ["transparent", OUT, d, m, l, a, al, TRUNK[0], TRUNK[1], STONE[0], STONE[1], wd, wl, "#f4efe0"]


# ---------------------------------------------------------------- trees (drawn bottom-centred in the canvas)

def trunk(c, cx, bottom, top, w):
    c.rect(cx - w // 2, top, cx - w // 2 + w - 1, bottom, 8)
    c.rect(cx - w // 2, top, cx - w // 2, bottom, 7)
    c.rect(cx - w // 2 - 1, bottom - 1, cx + w // 2 + 1, bottom, 7)        # root flare


def blob(c, cx, cy, rx, ry, dots=None):
    c.ellipse(cx, cy, rx, ry, 2)
    c.ellipse(cx - rx * 0.12, cy - ry * 0.12, rx * 0.85, ry * 0.8, 3)
    c.ellipse(cx - rx * 0.3, cy - ry * 0.35, rx * 0.45, ry * 0.4, 4)
    if dots:
        n = int(rx * ry / 6)
        for i in range(n):
            a = i * 2.39996
            r = math.sqrt((i + 0.5) / n)
            c.set(cx + math.cos(a) * r * rx * 0.85, cy + math.sin(a) * r * ry * 0.8, dots)


def tree(c, look, W, H, s):
    """A tree filling `s` (0..1) of the canvas width, standing on its bottom."""
    cx, bottom = W / 2, H - 3
    tw = max(6, W * s)
    if look == "conifer":
        th = min(H - 3, tw * 1.7)
        trunk(c, int(cx), bottom, int(bottom - th * 0.25), max(2, int(tw * 0.14)))
        tiers = 3 if tw > 14 else 2
        for i in range(tiers):
            y0 = bottom - th * 0.2 - i * th * 0.27
            hw = tw / 2 * (1 - i * 0.25)
            for k in range(int(th * 0.34)):
                w = hw * (k / (th * 0.34))
                c.rect(cx - w, y0 - th * 0.34 + k, cx + w, y0 - th * 0.34 + k, 2 if k > th * 0.24 else 3)
            c.line(cx - hw * 0.3, y0 - th * 0.2, cx, y0 - th * 0.32, 4)
        c.set(cx, bottom - th, 5)
        return
    if look == "toadstool":
        stem_h = tw * 0.55
        c.rect(cx - tw * 0.12, bottom - stem_h, cx + tw * 0.12, bottom, 13)
        c.rect(cx - tw * 0.12, bottom - stem_h, cx - tw * 0.08, bottom, 10)
        c.ellipse(cx, bottom - stem_h, tw / 2, tw * 0.3, 2)
        c.ellipse(cx, bottom - stem_h - tw * 0.04, tw / 2 - 1, tw * 0.26, 3)
        for i, (dx, dy) in enumerate(((-0.25, -0.12), (0.1, -0.2), (0.28, -0.05), (-0.05, -0.02))):
            c.ellipse(cx + dx * tw, bottom - stem_h + dy * tw, max(1, tw * 0.05), max(1, tw * 0.04), 6)
        return
    if look == "birch" or look == "crystalbirch":
        for k, ox in enumerate((-0.22, 0.05, 0.25) if tw > 10 else (0,)):
            x = cx + ox * tw
            h = tw * (1.5 - abs(ox))
            c.rect(x, bottom - h, x + 1, bottom, 13)
            for j in range(int(h / 4)):
                c.set(x, bottom - 2 - j * 4, 9)
            if look == "crystalbirch":
                for j in range(4):
                    c.set(x + (-2 if j % 2 else 2), bottom - h * 0.5 - j * 2, 5)
                    c.set(x + (-1 if j % 2 else 1), bottom - h * 0.6 - j * 2, 6)
                c.ellipse(x, bottom - h * 0.75, tw * 0.22, tw * 0.3, 3)
                c.set(x, bottom - h * 0.85, 6)
            else:
                blob(c, x, bottom - h * 0.75, tw * 0.22, tw * 0.3)
        return
    if look == "log":
        y = bottom - 5
        c.rect(2, y - 3, W - 6, y + 3, 8)
        c.rect(2, y - 3, W - 6, y - 2, 7)
        c.ellipse(W - 5, y, 3, 4, 7)
        c.ellipse(W - 5, y, 2, 3, 2)
        for x in range(6, W - 8, 7):
            c.ellipse(x, y - 3, 2, 1.2, 3)
        c.ellipse(8, y - 4, 1.5, 1, 5)
        c.ellipse(W // 2, y - 4, 1.5, 1, 6)
        return
    # round, weeping, blossom, crystal: trunk + canopy
    canopy_ry = tw * 0.42
    top = bottom - tw * 1.05
    trunk(c, int(cx), bottom, int(top + canopy_ry), max(2, int(tw * 0.14)))
    ccx, ccy = cx, top + canopy_ry
    if look == "crystal":
        for i in range(-2, 3):
            x = ccx + i * tw * 0.17
            hgt = canopy_ry * (1.6 - abs(i) * 0.3)
            for k in range(int(hgt)):
                w = max(1, (hgt - k) * 0.35)
                c.rect(x - w, ccy + canopy_ry * 0.5 - k, x + w, ccy + canopy_ry * 0.5 - k, 3 if k < hgt * 0.6 else 4)
            c.set(x, ccy + canopy_ry * 0.5 - hgt, 6)
            c.line(x - 1, ccy, x - 1, ccy - hgt * 0.4, 5)
        return
    blob(c, ccx, ccy, tw / 2, canopy_ry, 5 if look == "blossom" else None)
    if look == "blossom":
        for i in range(int(tw / 3)):
            c.set(cx - tw * 0.6 + (i * 7) % int(tw * 1.2 + 1), bottom - 1 - (i % 2), 6)
    if look == "weeping":
        for i in range(int(tw / 2.2)):
            x = ccx - tw / 2 + 1 + i * 2.2
            c.line(x, ccy, x + (1 if i % 2 else -1), ccy + canopy_ry * 1.25, 2 if i % 2 else 3)
            if i % 3 == 0:
                c.set(x, ccy + canopy_ry * 1.25, 5)


# ---------------------------------------------------------------- water, plants, structures

def water(c, look, W, H):
    cx, bottom = W / 2, H - 3
    if look == "pool":
        c.ellipse(cx, bottom - H * 0.36, W / 2 - 1, H * 0.38, 9)
        c.ellipse(cx, bottom - H * 0.36, W / 2 - 3, H * 0.32, 11)
        c.ellipse(cx - W * 0.1, bottom - H * 0.42, W * 0.2, H * 0.08, 12)
        c.set(cx + W * 0.2, bottom - H * 0.3, 6)
        c.set(cx - W * 0.25, bottom - H * 0.25, 5)
    elif look == "puddle":
        c.ellipse(cx, bottom - 4, 6.5, 3.6, 2)
        c.ellipse(cx, bottom - 4, 5, 2.6, 11)
        c.set(cx - 2, bottom - 5, 12); c.set(cx + 2, bottom - 4, 5)
    elif look == "trough":
        c.rect(2, bottom - 8, 13, bottom, 9)
        c.rect(3, bottom - 7, 12, bottom - 2, 10)
        c.rect(4, bottom - 6, 11, bottom - 3, 11)
        c.set(5, bottom - 5, 12); c.set(3, bottom - 8, 3); c.set(12, bottom - 8, 3)
    elif look == "spring":
        c.ellipse(cx, bottom - 4, 6, 3.4, 9)
        c.ellipse(cx, bottom - 4, 4.6, 2.4, 11)
        for x in (2, 4, 12, 14):
            c.line(x, bottom - 3, x + (1 if x > 8 else -1) * 0, bottom - 11 + (x % 3), 3)
        c.set(cx, bottom - 5, 12)
    elif look == "barrel":
        c.rect(4, bottom - 11, 11, bottom, 8)
        c.rect(4, bottom - 11, 4, bottom, 7)
        c.rect(4, bottom - 8, 11, bottom - 8, 9); c.rect(4, bottom - 3, 11, bottom - 3, 9)
        c.rect(5, bottom - 11, 10, bottom - 11, 11); c.set(6, bottom - 11, 12)
    elif look == "fountain":
        c.ellipse(cx, bottom - 3, 6.5, 2.6, 9)
        c.ellipse(cx, bottom - 3, 5, 1.8, 11)
        c.rect(cx - 1, bottom - 10, cx, bottom - 3, 10)
        c.ellipse(cx, bottom - 10, 2.5, 1.2, 5)
        c.set(cx - 2, bottom - 8, 12); c.set(cx + 2, bottom - 7, 12)


def plant(c, look, W, H, s):
    cx, bottom = W / 2, H - 3
    r = 4 + 3.5 * s
    if look in ("bush", "thicket", "hedge"):
        if look == "hedge":
            c.rect(cx - r, bottom - r * 1.6, cx + r, bottom, 2)
            c.rect(cx - r + 1, bottom - r * 1.6 + 1, cx + r - 2, bottom - 2, 3)
            c.rect(cx - r + 2, bottom - r * 1.6 + 1, cx, bottom - r, 4)
            return
        blob(c, cx, bottom - r * 0.9, r, r * 0.85, 5 if look == "bush" else None)
        if look == "thicket":
            for i in range(5):
                c.line(cx - r + i * r / 2, bottom, cx - r + i * r / 2 + 1, bottom - r * 1.7, 2)
                c.set(cx - r + i * r / 2 + 1, bottom - r * 1.7, 5)
    elif look == "spire":
        for ox in (-3, 0, 3) if s > 0.5 else (0,):
            h = r * 2.2 - abs(ox)
            c.line(cx + ox, bottom, cx + ox, bottom - h, 2)
            for k in range(int(h * 0.5)):
                c.set(cx + ox + (1 if k % 2 else -1), bottom - h + k * 1.3, 5 if k % 3 else 6)
        c.ellipse(cx, bottom - 1, r * 0.8, 1.6, 3)
    elif look == "fern":
        for i in range(-3, 4):
            c.line(cx, bottom, cx + i * r * 0.32, bottom - r * (1.6 - abs(i) * 0.15), 3 if i % 2 else 2)
            if look == "fern" and i % 2 == 0:
                c.set(cx + i * r * 0.32, bottom - r * (1.6 - abs(i) * 0.15), 5)
    elif look == "caps":
        for ox, hh in ((-3, 0.7), (1, 1.0), (4, 0.6)):
            h = r * 1.5 * hh
            c.rect(cx + ox, bottom - h, cx + ox, bottom, 13)
            c.ellipse(cx + ox, bottom - h, 2.2 * (0.6 + s * 0.4) + 0.5, 1.6, 3)
            c.set(cx + ox, bottom - h - 1, 5)
    elif look == "puffball":
        for ox, oy, rr in ((-3, 0, 2.6), (2, -1, 3.2), (4.5, 1, 2)):
            c.ellipse(cx + ox, bottom - 2 + oy - rr * 0.6, rr * (0.6 + s * 0.4), rr * (0.55 + s * 0.35), 13)
            c.set(cx + ox - 1, bottom - 3 + oy - rr, 6)
    elif look == "reeds":
        for i in range(-3, 4):
            h = r * (1.8 - abs(i) * 0.15)
            c.line(cx + i * 1.4, bottom, cx + i * 1.6, bottom - h, 3 if i % 2 else 4)
            c.set(cx + i * 1.6, bottom - h, 6)


def structure(c, look, W, H, s=1.0):
    cx, bottom = W / 2, H - 3
    if look == "ring":
        rx, ry = (W / 2 - 3) * s, (H / 2 - 3) * s
        cy = H / 2
        n = max(6, int(12 * s))
        for i in range(n):
            a = i / n * math.tau
            x, y = cx + math.cos(a) * rx, cy + math.sin(a) * ry
            c.rect(x, y - 2, x, y, 13)
            c.ellipse(x, y - 2, 1.8, 1.1, 5 if i % 2 else 3)
    elif look == "seat":
        c.rect(2, bottom - 5, 13, bottom - 1, 8)
        c.rect(2, bottom - 5, 13, bottom - 5, 7)
        c.ellipse(13, bottom - 3, 1.5, 2.2, 7)
        c.ellipse(5, bottom - 6, 1.5, 1, 5); c.ellipse(9, bottom - 6, 1.2, 0.9, 6)
    elif look == "mound":
        c.ellipse(cx, bottom - 2, W / 2 - 1, 9, 3)
        c.ellipse(cx - 3, bottom - 6, W / 2 - 6, 6, 4)
        c.ellipse(cx, bottom - 2, 3, 4, 8); c.rect(cx - 3, bottom - 2, cx + 3, bottom, 8)
        c.set(cx + 1, bottom - 3, 5)
    elif look == "arch":
        for x in (3, W - 5):
            c.rect(x, bottom - 18, x + 2, bottom, 10 if look == "arch" else 8)
        for i in range(W - 6):
            y = bottom - 18 - math.sin((i / (W - 7)) * math.pi) * 5
            c.rect(3 + i, y, 3 + i, y + 2, 3)
            if i % 3 == 0:
                c.set(3 + i, y - 1, 5)
    elif look == "shrine":
        c.rect(3, bottom - 12, 12, bottom, 8)
        c.rect(4, bottom - 11, 11, bottom - 1, 7)
        for x, y in ((5, bottom - 9), (8, bottom - 9), (6, bottom - 5), (9, bottom - 5)):
            c.rect(x, y, x + 1, y + 2, 6)
            c.set(x, y, 5)
        c.rect(2, bottom - 13, 13, bottom - 13, 8)
    elif look == "skep":
        c.ellipse(cx, bottom - 6, 5.5, 6.5, 8)
        for y in range(bottom - 11, bottom, 3):
            c.rect(cx - 5, y, cx + 5, y, 7)
        c.ellipse(cx, bottom - 2, 1.5, 1.2, 1)
        c.set(cx + 4, bottom - 9, 5); c.set(cx - 5, bottom - 7, 5)
    elif look in ("stone", "waystone"):
        c.rect(cx - 3, bottom - 14, cx + 3, bottom, 9)
        c.rect(cx - 2, bottom - 15, cx + 2, bottom - 1, 10)
        c.rect(cx - 2, bottom - 15, cx - 1, bottom - 5, 13)
        if look == "waystone":
            c.line(cx, bottom - 12, cx, bottom - 6, 5); c.line(cx - 1, bottom - 9, cx + 1, bottom - 9, 5)
        c.set(cx + 2, bottom - 4, 3); c.set(cx - 3, bottom - 2, 3)
    elif look == "lantern":
        c.rect(cx - 1, bottom - 6, cx + 1, bottom, 9)
        c.rect(cx - 4, bottom - 11, cx + 4, bottom - 6, 10)
        c.rect(cx - 2, bottom - 10, cx + 2, bottom - 7, 6)
        c.rect(cx - 5, bottom - 13, cx + 5, bottom - 12, 9)
    elif look == "geode":
        c.ellipse(cx, bottom - 5, 6, 5, 9)
        c.ellipse(cx, bottom - 6, 4.5, 3.5, 3)
        for i in range(5):
            c.set(cx - 3 + i * 1.5, bottom - 6 + (i % 2), 6 if i % 2 else 5)
    elif look == "obelisk":
        for k in range(18):
            w = max(0.5, 3 - k * 0.15)
            c.rect(cx - w, bottom - k, cx + w, bottom - k, 3 if k % 5 else 4)
        c.set(cx, bottom - 18, 6); c.line(cx - 1, bottom - 4, cx - 1, bottom - 14, 6)
    elif look == "platform":
        for x in (5, W - 7):
            c.rect(x, bottom - 20, x + 1, bottom, 8)
        c.rect(2, bottom - 22, W - 3, bottom - 19, 8)
        c.rect(2, bottom - 22, W - 3, bottom - 22, 7)
        c.rect(3, bottom - 28, 3, bottom - 22, 7); c.rect(W - 4, bottom - 28, W - 4, bottom - 22, 7)
        c.rect(3, bottom - 28, W - 4, bottom - 28, 7)
        for y in range(bottom - 18, bottom, 3):
            c.rect(W // 2 - 2, y, W // 2 + 2, y, 8)
        c.line(W // 2 - 2, bottom - 19, W // 2 - 2, bottom, 7); c.line(W // 2 + 2, bottom - 19, W // 2 + 2, bottom, 7)
    elif look == "boardwalk":
        for y in range(1, 16, 4):
            c.rect(0, y, 15, y + 2, 8)
            c.rect(0, y + 2, 15, y + 2, 7)
    elif look == "mosspath":
        for (x, y, r) in ((4, 4, 3), (11, 6, 3.4), (6, 11, 3.2), (12, 13, 2.4)):
            c.ellipse(x, y, r, r * 0.8, 3)
            c.ellipse(x - 1, y - 1, r * 0.5, r * 0.4, 4)
    elif look == "wall":
        c.rect(0, bottom - 8, 15, bottom, 9)
        for y in range(bottom - 8, bottom, 3):
            for x in range((y % 2) * 3, 16, 6):
                c.rect(x, y, x + 4, y + 1, 10)
        c.set(3, bottom - 9, 3); c.set(11, bottom - 9, 3)
    elif look == "swing":
        c.rect(2, bottom - 18, 2, bottom, 8); c.rect(13, bottom - 18, 13, bottom, 8)
        c.rect(1, bottom - 19, 14, bottom - 18, 7)
        c.line(5, bottom - 17, 5, bottom - 5, 13); c.line(10, bottom - 17, 10, bottom - 5, 13)
        c.rect(4, bottom - 5, 11, bottom - 4, 8)
    elif look == "bridge":
        for i in range(16):
            y = 6 - math.sin(i / 15 * math.pi) * 3
            c.rect(i, y, i, y + 5, 8)
            c.set(i, y + 5, 7)
            if i % 4 == 0:
                c.rect(i, y - 3, i, y, 7)
        c.line(0, 3, 15, 3, 7)
    elif look == "ford":
        for (x, y) in ((3, 4), (9, 7), (4, 11), (11, 13)):
            c.ellipse(x, y, 2.6, 2, 10)
            c.set(x - 1, y - 1, 13)


# ---------------------------------------------------------------- crop plants and their produce

def crop_plant(c, look, W, H, s):
    """A crop plant without its fruit (fruit is added by fruit())."""
    cx, bottom = W / 2, H - 3
    if look in ("fruittree", "weeping"):
        tree(c, "weeping" if look == "weeping" else "round", W, H, s)
    elif look == "berrybush":
        r = 4 + 3 * s
        blob(c, cx, bottom - r * 0.9, r, r * 0.85)
    elif look == "vine":
        h = 8 + 8 * s
        for x in (cx - 4, cx + 4):
            c.line(x, bottom, x, bottom - h, 8)
        c.line(cx - 4, bottom - h, cx + 4, bottom - h, 8)
        for i in range(int(h / 2)):
            c.ellipse(cx - 4 + (i % 3) * 4, bottom - 1 - i * 2, 1.8, 1.4, 2 if i % 2 else 3)
    elif look == "patch":
        for i in range(-2, 3):
            c.ellipse(cx + i * 2.6, bottom - 2 - (i % 2), 2 + s, 1.6 + s * 0.6, 3 if i % 2 else 4)
    elif look == "shrooms":
        for ox, hh in ((-4, 0.6), (-1, 0.9), (3, 0.7)):
            h = (3 + 3 * s) * hh + 1
            c.rect(cx + ox, bottom - h, cx + ox, bottom, 13)
            c.ellipse(cx + ox, bottom - h, 1.8 + s, 1.3, 3)
    elif look == "croplog":
        c.rect(1, bottom - 5, W - 2, bottom - 1, 8)
        c.rect(1, bottom - 5, W - 2, bottom - 5, 7)
        c.ellipse(W - 2, bottom - 3, 1.4, 2.2, 7)
    elif look == "cropreeds":
        for i in range(-2, 3):
            h = 7 + 6 * s - abs(i)
            c.line(cx + i * 2, bottom, cx + i * 2.2, bottom - h, 3 if i % 2 else 4)


def fruit(c, look, W, H, s):
    """The crop on a grown plant, in its produce colour (palette 5 and 6)."""
    cx, bottom = W / 2, H - 3
    if look in ("fruittree", "weeping"):
        tw = (W + 6) * s
        ccy = bottom - tw * 1.05 + tw * 0.42
        for i in range(9):
            a = i * 2.39996
            r = math.sqrt((i + 0.5) / 9)
            x, y = cx + math.cos(a) * r * tw * 0.38, ccy + math.sin(a) * r * tw * 0.3 + (tw * 0.35 if look == "weeping" else 0)
            c.ellipse(x, y, 1.6, 1.6, 5); c.set(x - 1, y - 1, 6)
    elif look in ("berrybush", "vine", "patch", "cropreeds"):
        pts = {"berrybush": ((-3, -6), (2, -8), (4, -4), (-1, -3), (0, -9)), "vine": ((-4, -6), (0, -10), (4, -7), (-4, -12), (4, -13)),
               "patch": ((-5, -3), (0, -4), (4, -3)), "cropreeds": ((-4, -8), (0, -11), (4, -9), (-2, -5), (2, -6))}[look]
        for dx, dy in pts:
            c.ellipse(cx + dx, bottom + dy, 1.4, 1.4, 5); c.set(cx + dx - 1, bottom + dy - 1, 6)
    elif look == "shrooms":
        for ox in (-4, -1, 3):
            c.set(cx + ox, bottom - 7, 6)
            c.ellipse(cx + ox + 1, bottom - 1, 1.5, 1.1, 5)
    elif look == "croplog":
        for x in range(3, W - 3, 4):
            c.ellipse(x, bottom - 6, 1.8, 1.1, 5); c.set(x - 1, bottom - 7, 6)


def produce_icon(look, color):
    """A 12x12 icon for a crop: 1 outline, 2 colour, 3 light, 4 dark, 5 leaf, 6 stem."""
    c = Canvas(12, 12)
    if look == "berry":
        for x, y in ((4, 7), (8, 7), (6, 4), (6, 9)):
            c.ellipse(x, y, 2.4, 2.4, 2); c.set(x - 1, y - 1, 3)
        c.line(6, 1, 6, 3, 6)
    elif look == "fruit":
        c.ellipse(6, 7, 4.2, 4, 2); c.ellipse(4.8, 5.6, 1.4, 1.2, 3); c.ellipse(7.5, 9, 1.6, 1, 4)
        c.line(6, 1, 6, 3, 6); c.ellipse(8.4, 2.4, 1.8, 1, 5)
    elif look == "nut":
        c.ellipse(6, 7, 3.8, 4, 2); c.ellipse(6, 4, 4, 1.8, 4); c.set(5, 6, 3)
    elif look == "cap":
        c.ellipse(6, 5, 4.6, 2.8, 2); c.ellipse(4.6, 4, 1.6, 1, 3)
        c.rect(5, 6, 7, 10, 3)
    elif look == "gourd":
        c.ellipse(6, 8, 3.8, 3.4, 2); c.ellipse(6, 4, 2.2, 2, 2); c.set(5, 7, 3); c.line(6, 1, 7, 2, 6)
    elif look == "star":
        for k in range(5):
            a = -math.pi / 2 + k * math.tau / 5
            c.line(6, 6, 6 + math.cos(a) * 5, 6 + math.sin(a) * 5, 2)
        c.ellipse(6, 6, 2, 2, 3)
    elif look == "leaf":
        for (x, y) in ((4, 7), (7, 5), (6, 9)):
            c.ellipse(x, y, 2.6, 1.6, 2); c.set(x, y, 3)
        c.line(6, 11, 6, 6, 6)
    elif look == "crystal":
        for x, h in ((4, 6), (7, 8), (9, 5)):
            for k in range(h):
                w = max(0, (h - k) // 3)
                c.rect(x - w, 11 - k, x + w, 11 - k, 2 if k < h - 2 else 3)
    elif look == "pod":
        c.ellipse(6, 6, 2.4, 4.6, 2)
        for y in (3, 6, 9):
            c.set(6, y, 3)
        c.line(6, 0, 6, 2, 6)
    c.outline(1)
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    dark = "#%02x%02x%02x" % (int(r * 0.6), int(g * 0.6), int(b * 0.6))
    light = "#%02x%02x%02x" % (min(255, r + 70), min(255, g + 70), min(255, b + 70))
    return c, ["transparent", OUT, color, light, dark, "#4f9a3a", "#6a4a2a"]


# ---------------------------------------------------------------- sizes and stages

def stage_scale(plan_name, stage, plan):
    """How big a growing piece is drawn at a stage, as a share of its final size."""
    order = [s["stage"] for s in plan]
    i, n = order.index(stage), len(order)
    if plan_name == "giant":
        return {"sapling": 0.26, "young": 0.45, "grown": 0.68, "ancient": 1.0}[stage]
    if plan_name in ("tree", "crop3", "crop4"):
        return {"sapling": 0.38, "young": 0.66, "grown": 1.0}[stage]
    return (i + 1) / n if n > 1 else 1.0


def build(d, plans):
    plan = plans.get(d["plan"]) or [{"stage": "built"}]
    w, h = d["size"]
    W = w * 16
    flat = d["kind"] == "water" or d.get("ground") or d["look"] == "ring"
    for st in plan:
        stage = st["stage"]
        s = stage_scale(d["plan"], stage, plan)
        if d["kind"] == "crop":
            if d["look"] in ("fruittree", "weeping"):
                tw = max(10, (W + 6) * s)
                cw, ch = int(max(W, tw) + 2), int(tw * 1.2) + 6
            else:
                cw, ch = W + 2, 22
            c = Canvas(cw, ch)
            sc = (max(10, (W + 6) * s)) / cw if d["look"] in ("fruittree", "weeping") else s
            crop_plant(c, d["look"], cw, ch, sc)
            c.outline(1)
            write(f"landscape.{d['id']}.{stage}", (cw, ch), [c], palette=crop_palette(d), anchor=(cw // 2, ch - 3), tags=["landscape", "crop"])
            if stage == plan[-1]["stage"]:
                # The crop as an overlay: only the fruit, the same size and anchor as the grown sprite, drawn on
                # top of it while the crop waits to be picked (so the fruit can be redrawn on its own).
                f = Canvas(cw, ch)
                fruit(f, d["look"], cw, ch, sc)          # no outline of its own: the fruit sits on the canopy
                write(f"landscape.{d['id']}.fruit", (cw, ch), [f], palette=crop_palette(d), anchor=(cw // 2, ch - 3), tags=["landscape", "crop", "overlay"])
            continue
        if d["kind"] == "tree":
            if d["look"] == "log":
                cw, ch = W, 16
            else:
                tw = max(10, (W + 6) * s)
                cw = int(max(W, tw) + 2)
                tall = 1.75 if d["look"] == "conifer" else 1.55 if d["look"] in ("birch", "crystalbirch") else 1.2
                ch = int(tw * tall) + 6
            c = Canvas(cw, ch)
            tree(c, d["look"], cw, ch, (max(10, (W + 6) * s)) / cw if d["look"] != "log" else 1)
        elif d["kind"] == "water":
            cw, ch = W, h * 16 + (2 if d["look"] in ("pool", "puddle") else 6)
            c = Canvas(cw, ch)
            water(c, d["look"], cw, ch)
        elif d["kind"] == "plant":
            cw, ch = W + 2, 22
            c = Canvas(cw, ch)
            plant(c, d["look"], cw, ch, s)
        else:
            if d["look"] == "ring":
                cw, ch = W, h * 16
            elif flat:
                cw, ch = W, h * 16
            else:
                cw, ch = W, {"platform": 36, "arch": 26, "obelisk": 24}.get(d["look"], 20)
            c = Canvas(cw, ch)
            structure(c, d["look"], cw, ch, s)
        if not (flat and d["look"] in ("boardwalk", "mosspath", "ford")):
            c.outline(1)
        anchor = (cw // 2, ch - 3)
        write(f"landscape.{d['id']}.{stage}", (cw, ch), [c], palette=palette(d["school"]), anchor=anchor, tags=["landscape"])


def crop_palette(d):
    """The school's palette with its accent swapped for the crop's own colour."""
    pal = palette(d["school"])
    col = d["produce"]["color"]
    r, g, b = (int(col[i:i + 2], 16) for i in (1, 3, 5))
    pal[5], pal[6] = col, "#%02x%02x%02x" % (min(255, r + 70), min(255, g + 70), min(255, b + 70))
    return pal


def main():
    with open(os.path.join(ROOT, "Resources", "Content", "landscape.json")) as fh:
        pieces = json.load(fh)
    with open(os.path.join(ROOT, "Resources", "tuning.json")) as fh:
        plans = json.load(fh).get("landscape", {}).get("plans", {})
    n = 0
    for d in pieces:
        build(d, plans)
        n += len(plans.get(d["plan"]) or [1]) + (1 if d["kind"] == "crop" else 0)
        if d.get("produce"):
            c, pal = produce_icon(d["produce"]["look"], d["produce"]["color"])
            write(d["produce"]["id"], (12, 12), [c], palette=pal, anchor=(6, 11), tags=["produce"])
    print("landscape sprites: %d (%d pieces), produce icons: %d" % (n, len(pieces), sum(1 for d in pieces if d.get("produce"))))


if __name__ == "__main__":
    main()
