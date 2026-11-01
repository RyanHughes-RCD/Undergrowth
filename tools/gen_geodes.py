#!/usr/bin/env python3
"""Geode art: rounded stone balls with pixel shading, stepped pixel cracks, opened halves.

For every geode in Resources/Content/items.json this writes:
  item.geode.<id>            unopened stone ball (map + bag)            16x16
  geode.crack.<id>.a / .b    crack overlay, 5 frames = 5 crack stages   16x16
  geode.open.<id>            opened geode: hollow lined with crystals   16x16
  geode.world.<id>           in the forest: the stone pushing up out of a
                             raised dirt mound (map only; linked as worldSprite) 20x16
The importer links them from the item data (openSprite, crackSprites).

Style rules: light from the top-left everywhere; 5 stone tones with 2x2 ordered
dithering only at tone boundaries; texture from deliberate mineral clusters,
crevices and raised highlights (no random single-pixel noise); slightly irregular
round silhouettes; cracks are stepped 1-2px lines that branch and grow per stage.
"""
import colorsys
import json
import math
import os
import random
import zlib

from gen_placeholders import Canvas, write, ROOT

CONTENT = os.path.join(ROOT, "Resources", "Content")
S = 16
LIGHT = (-0.62, -0.78)  # top-left
BAYER = [[0.0, 0.5], [0.75, 0.25]]

# base stone colour, crystal/inside colour, feature
GEODES = {
    "pebble-geode":       ("#8c8692", "#e8eef4", None),
    "mossy-geode":        ("#7f8a7c", "#7ae0a0", "moss"),
    "rootbound-geode":    ("#8e7c68", "#f0a840", "roots"),
    "deep-geode":         ("#4a3e5c", "#ff8ae0", "glints"),
    "glimmering-geode":   ("#5e6f8e", "#8cf0ff", "crystals"),
    "ancient-heartstone": ("#6a2e2c", "#ffc84a", "veins"),
}


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(v)))) for v in c)


def tone(c, dv, ds=0.0, dh=0.0):
    r, g, b = [v / 255 for v in rgb(c)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((h + dh) % 1, max(0, min(1, s + ds)), max(0, min(1, v + dv)))
    return hexc((r * 255, g * 255, b * 255))


FEATURE_COLOURS = {"moss": ("#3f6a2a", "#7cb84a"), "roots": ("#4a2e1a", "#9a6a3a")}


def palette_for(base, inner, kind=None):
    # 0 transparent, 1 outline, 2..6 stone tones (deep→highlight), 7 crevice, 8 ground shadow,
    # 9 feature dark, 10 feature light, 11 crystal, 12 crystal light, 13 cavity, 14 cavity dark
    return ["transparent", "#140f16",
            tone(base, -0.30, 0.05, 0.01), tone(base, -0.15, 0.03), base, tone(base, 0.13, -0.03, -0.01), tone(base, 0.25, -0.08, -0.02),
            tone(base, -0.38, 0.06), "#00000055",
            *FEATURE_COLOURS.get(kind, ("#3f6a2a", "#7cb84a")),
            inner, tone(inner, 0.2, -0.25),
            tone(base, -0.42, 0.04), tone(base, -0.52, 0.04)]


def shape(gid):
    """Slightly irregular round silhouette: radius varies smoothly with angle."""
    rng = random.Random(zlib.crc32(gid.encode()))
    big = gid == "ancient-heartstone"
    r0 = 6.9 if big else 6.2
    a1, p1 = rng.uniform(0.25, 0.45), rng.uniform(0, 6.28)
    a2, p2 = rng.uniform(0.1, 0.25), rng.uniform(0, 6.28)
    cx, cy = 7.5 + rng.choice((-0.25, 0.25)), 7.3
    def radius(theta):
        return r0 + a1 * math.sin(3 * theta + p1) + a2 * math.sin(5 * theta + p2)
    inside = set()
    for y in range(S):
        for x in range(S):
            dx, dy = x + 0.5 - cx, (y + 0.5 - cy) * 1.06  # a touch squat: it sits on the ground
            if math.hypot(dx, dy) <= radius(math.atan2(dy, dx)):
                inside.add((x, y))
    return inside, (cx, cy), r0


def shade(c, inside, centre, r0):
    cx, cy = centre
    for (x, y) in inside:
        nx, ny = (x + 0.5 - cx) / r0, (y + 0.5 - cy) / r0
        nz = math.sqrt(max(0.0, 1 - min(1.0, nx * nx + ny * ny)))
        lit = -(nx * LIGHT[0] + ny * LIGHT[1]) * 0.55 + nz * 0.55          # -0.55..1.1
        v = max(0.0, min(0.999, (lit + 0.45) / 1.5)) * 5                    # 0..5 bands
        band = int(v)
        frac = v - band
        if frac > 0.62 and BAYER[y % 2][x % 2] < (frac - 0.62) / 0.38:      # dither only near the boundary
            band = min(4, band + 1)
        c.set(x, y, 2 + min(4, band))


def texture(c, inside, rng):
    """Deliberate mineral clusters, crevices and raised spots — no scattered noise."""
    pts = sorted(inside)
    for _ in range(5):  # mineral clusters (2-3 px, one tone lighter or darker than what's there)
        x, y = rng.choice(pts)
        cur = c.get(x, y)
        if cur not in (3, 4, 5):
            continue
        t = cur + (1 if rng.random() < 0.5 else -1)
        for (dx, dy) in ((0, 0), (1, 0), (0, 1))[: rng.randint(2, 3)]:
            if (x + dx, y + dy) in inside and c.get(x + dx, y + dy) in (3, 4, 5):
                c.set(x + dx, y + dy, t)
    for _ in range(2):  # crevices: short stepped dark lines, mostly on the shaded lower-right
        x, y = rng.choice([p for p in pts if p[0] + p[1] > 14] or pts)
        for i in range(rng.randint(2, 4)):
            if (x, y) in inside and c.get(x, y) != 1:
                c.set(x, y, 7)
            x += rng.choice((1, 1, 0))
            y += 1 if i % 2 else 0
    for _ in range(3):  # raised bumps: a highlight pixel with a shadow pixel under it
        x, y = rng.choice([p for p in pts if p[0] + p[1] < 16] or pts)
        if (x, y + 1) in inside:
            c.set(x, y, 6)
            c.set(x, y + 1, 3)


def features(c, inside, kind, rng, f):
    pts = sorted(inside)
    if kind == "moss":
        for (cx, cy, w) in ((5, 3, 4), (9, 2, 3), (3, 6, 2)):
            for i in range(w):
                for j in range(2 if i not in (0, w - 1) else 1):
                    p = (cx + i, cy + j)
                    if p in inside:
                        c.set(*p, 10 if j == 0 else 9)
    elif kind == "roots":
        for (x, y, dx) in ((2, 5, 1), (13, 9, -1)):
            for i in range(9):
                p = (x, y)
                if p in inside:
                    c.set(*p, 9 if i % 3 else 10)
                x += dx
                y += 1 if i % 2 else 0
    elif kind == "glints":
        for i, (x, y) in enumerate(((10, 5), (5, 9), (11, 10), (7, 4))):
            if (x, y) in inside:
                c.set(x, y, 12 if (i + f) % 2 == 0 else 11)
    elif kind == "crystals":
        for (x, y) in ((4, 3), (10, 2), (12, 5)):
            for k in range(3):
                if (x, y + k) in inside or k == 0:
                    c.set(x, y + k - 1, 12 if k == 0 else 11)
            if f == 1:
                c.set(x, y - 2, 12)
    elif kind == "veins":
        x, y = 3, 6
        for i in range(11):
            c.set(x, y, 11 if (i + f) % 3 else 12)
            x += 1
            y += (1 if i in (2, 6) else (-1 if i == 8 else 0))
        c.set(8, 3, 11); c.set(8, 4, 11); c.set(9, 4, 12 if f else 11)


def ball(gid, kind, f, rng_salt=0):
    inside, centre, r0 = shape(gid)
    c = Canvas(S, S)
    # soft ground shadow under the ball
    for x in range(3, 13):
        c.set(x, 15, 8)
    shade(c, inside, centre, r0)
    texture(c, inside, random.Random(zlib.crc32(gid.encode()) + rng_salt))
    if kind:
        features(c, inside, kind, random.Random(7), f)
    # outline (keep the ground shadow as-is)
    for y in range(S):
        for x in range(S):
            if (x, y) in inside:
                continue
            if any((x + dx, y + dy) in inside for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                if c.get(x, y) in (0, 8):
                    c.set(x, y, 1)
    return c, inside


def stepped(c, x, y, dx, steps, rng, inside, thick, sideways=False):
    """A connected, stepped pixel crack. Main cracks fall one row per step and
    sidestep half the time; branches run sideways and drop now and then."""
    path = []
    for i in range(steps):
        if (x, y) in inside:
            c.set(x, y, 2)
            if thick and i % 4 in (1, 2) and (x + dx, y) in inside:
                c.set(x + dx, y, 2)  # widen in short runs so thickness varies
            path.append((x, y))
        if sideways:
            x += dx
            if rng.random() < 0.4:
                y += 1
        else:
            y += 1
            if rng.random() < 0.5:
                x += dx
        if rng.random() < 0.12:
            dx = -dx
    return path


def crack_frames(gid, inside, variant):
    """5 stages; each stage keeps everything from the previous one and adds more."""
    rng = random.Random(zlib.crc32((gid + variant).encode()))
    xs = [p[0] for p in inside]
    top = min(p[1] for p in inside)
    mid = (min(xs) + max(xs)) // 2
    start = (mid + rng.choice((-2, -1, 1)), top + 1)
    plan = []  # list of (stage, kind, args)
    plan.append((1, "main", (start[0], start[1], rng.choice((-1, 1)), 4, False)))
    plan.append((2, "main", (None, None, None, 5, True)))           # main crack continues, thicker
    plan.append((3, "branch", (2, rng.choice((-1, 1)), 4)))
    plan.append((4, "branch", (5, rng.choice((-1, 1)), 5)))
    plan.append((4, "second", (mid + rng.choice((-4, 4)), top + 3, 4)))
    plan.append((5, "branch", (7, rng.choice((-1, 1)), 6)))
    plan.append((5, "second", (mid + rng.choice((-3, 3)), top + 6, 5)))
    frames = []
    for stage in range(1, 6):
        c = Canvas(S, S)
        r = random.Random(zlib.crc32((gid + variant).encode()))
        main_path, pos = [], None
        for st, kind, args in plan:
            if st > stage:
                continue
            if kind == "main":
                x, y, dx, steps, thick = args
                if x is None:
                    x, y = pos if pos else start
                    dx = 1
                path = stepped(c, x, y, dx if dx else 1, steps, r, inside, thick and stage >= 2)
                main_path += path
                pos = (path[-1][0], path[-1][1] + 1) if path else pos
            elif kind == "branch" and main_path:
                at, dx, steps = args
                bx, by = main_path[min(at, len(main_path) - 1)]
                stepped(c, bx + dx, by, dx, steps, r, inside, False, sideways=True)
            elif kind == "second":
                x, y, steps = args
                stepped(c, x, y, r.choice((-1, 1)), steps, r, inside, False)
        frames.append(c)
    return frames


def opened(gid, base, inner, kind):
    """The geode split open: a stone shell around a dark hollow lined with crystals."""
    inside, (cx, cy), r0 = shape(gid)
    c, _ = ball(gid, kind, 0)
    rng = random.Random(zlib.crc32(gid.encode()) + 99)
    cav = set()
    for (x, y) in inside:
        dx, dy = x + 0.5 - cx, (y + 0.5 - cy) * 1.06
        if math.hypot(dx, dy) <= r0 - 2.3:
            cav.add((x, y))
    for (x, y) in cav:
        c.set(x, y, 14 if (y + 0.5 - cy) < -1 else 13)  # deeper at the top of the hollow
    # crystals: stepped points growing inward from the hollow's wall
    edge = [p for p in cav if any((p[0] + dx, p[1] + dy) not in cav for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    rng.shuffle(edge)
    for (x, y) in edge[: max(8, len(edge) * 2 // 3)]:
        ix = 1 if x + 0.5 < cx else -1 if x + 0.5 > cx + 1 else 0
        iy = 1 if y + 0.5 < cy else -1 if y + 0.5 > cy + 1 else 0
        length = rng.randint(1, 3)
        for k in range(length):
            p = (x + ix * k, y + iy * k)
            if p in cav:
                c.set(*p, 12 if k == length - 1 else 11)
    return c


# Soil for the world mound, matched to the ground palette's soil/dirt tones (gen_placeholders GROUND_PALETTE).
SOIL = ["#2a1b10", "#3a2719", "#5a3d26", "#6b4a2f", "#86603d", "#a37a4e", "#4a7330", "#79a94a"]
WW, WH = 20, 16


def world(gid, kind):
    """The geode half-buried in a small raised mound of dirt (16x16 ball → 20x16 world sprite).

    Palette = geode palette + SOIL at 15..22: 15 seam (darkest), 16 shadow, 17 soil dark, 18 soil,
    19 soil light, 20 crest highlight, 21/22 grass tufts.
    """
    stone, inside = ball(gid, kind, 0)
    rng = random.Random(zlib.crc32(("world" + gid).encode()))
    ox, oy = 2, 1
    c = Canvas(WW, WH)
    # Mound: dirt heaped up against the stone (high shoulders, steep ends) with a jagged pixel top edge.
    top = {}
    for x in range(WW):
        u = (x + 0.5 - 10) / 9.8
        if abs(u) >= 1:
            continue
        h = 1.6 + 4.2 * (1 - u ** 4)                         # rows above the bottom of the sprite
        top[x] = int(round(15.5 - h)) + (1 if rng.random() < 0.25 else 0) - (1 if 0.35 < abs(u) < 0.75 and rng.random() < 0.3 else 0)
    mound = {(x, y) for x, t in top.items() for y in range(max(0, t), WH)}
    # Front lip of soil in front of the stone's base (jagged); below it the stone is buried.
    lip = {x: min(12, top[x] + 1) + (1 if rng.random() < 0.3 else 0) for x in top}
    stone_px = {(x + ox, y + oy) for (x, y) in inside if y + oy < lip.get(x + ox, 99)}
    # Paint the mound with light from the top-left: crest highlight, soil body, darker toward the bottom-right.
    def body(x, y, crest_row):
        d = y - crest_row
        if d == 0:
            return 20 if x < 10 else 19
        if d == 1:
            return 19 if x < 8 else 18
        if y == WH - 1:
            return 17 if x < 10 else 16
        return 18 if (x - 6) / 12 + d / 6 < 0.7 else 17
    for (x, y) in mound:
        c.set(x, y, body(x, y, top[x]))
    # Dirt texture: a few clods (one light pixel over a dark one) and specks.
    pts = sorted(p for p in mound if p[1] > top[p[0]] + 1 and p[1] < WH - 1)
    for _ in range(4):
        x, y = rng.choice(pts)
        if (x, y + 1) in mound:
            c.set(x, y, 19); c.set(x, y + 1, 16)
    for _ in range(3):
        c.set(*rng.choice(pts), 17)
    # The stone, emerging from the soil.
    for (x, y) in stone_px:
        c.set(x, y, stone.get(x - ox, y - oy))
    # Where the stone meets the earth: a dark seam right under/beside it, then a lit crest of pushed-up
    # soil just below, so the rim reads as raised and the stone as coming up out of the ground.
    for (x, y) in sorted(mound):
        if (x, y) in stone_px:
            continue
        under = (x, y - 1) in stone_px
        beside = (x - 1, y) in stone_px or (x + 1, y) in stone_px
        if under or beside:
            c.set(x, y, 15)
            if under and (x, y + 1) in mound and (x, y + 2) in mound:
                c.set(x, y + 1, 20 if x < 10 else 19)
                c.set(x, y + 2, 18 if x < 10 else 17)
    # Grass tufts creeping onto the mound edges.
    for x in (min(top), max(top)):
        t = top[x]
        c.set(x, t, 22); c.set(x, t + 1, 21)
    # Outline: stone everywhere it meets air; mound along its top and sides (not the bottom row).
    solid = mound | stone_px
    for y in range(WH):
        for x in range(WW):
            if (x, y) in solid:
                continue
            if any((x + dx, y + dy) in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                c.set(x, y, 1)
    return c


def main():
    items = json.load(open(os.path.join(CONTENT, "items.json")))
    made = 0
    for it in items:
        if it["category"] != "geode":
            continue
        key = it["id"].split(".", 1)[1]
        base, inner, kind = GEODES.get(key, ("#8c8692", "#e8eef4", None))
        pal = palette_for(base, inner, kind)
        animated = kind in ("glints", "crystals", "veins")
        frames = [ball(key, kind, f)[0] for f in range(2 if animated else 1)]
        write(it["sprite"], (S, S), frames, palette=pal, anchor=(8, 15), tags=["item", "geode"],
              durations=[0.7, 0.7] if animated else None)
        inside = shape(key)[0]
        crack_pal = ["transparent", "#140f16", "#0c080c", tone(base, 0.28, -0.1)]
        for variant in ("a", "b"):
            write("geode.crack.%s.%s" % (key, variant), (S, S), crack_frames(key, inside, variant),
                  palette=crack_pal, anchor=(8, 15), tags=["geode", "crack"])
        write("geode.open.%s" % key, (S, S), [opened(key, base, inner, kind)], palette=pal, anchor=(8, 15),
              tags=["geode", "open"])
        write("geode.world.%s" % key, (WW, WH), [world(key, kind)], palette=pal + SOIL, anchor=(10, 15),
              tags=["geode", "world"])
        made += 1
    print("geodes: %d types (ball, 2 crack sets x 5 stages, opened)" % made)


if __name__ == "__main__":
    main()
