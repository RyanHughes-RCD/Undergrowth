#!/usr/bin/env python3
"""Landmark sprites from the pixel-art pictures in design/ (landmark_*.jpg). Only the Old Log is left;
the animation helpers (ripples, sparkles) stay for any future landmark picture.

Each source is pixel art drawn on a 20px grid on a white background. This reads one colour per art
pixel, shrinks it to its in-game width (LANDMARKS below; tiles are 16 art px), keeps the source's
own colours, and redraws a clean 1px dark outline so edges stay crisp after scaling. Greenery
(grass, moss, vines) is left unoutlined, as in the sources.

A landmark entry can ask for animation frames drawn on top ("anim": "ripples" across water, or
"sparkles" replacing baked-in ones).

    python3 tools/gen_landmark_art.py

Writes Resources/Sprites/landmark/<id>.json. gen_topdown.py and gen_offerings_sprites.py (via
gen_placeholders.py) call this too, so re-running the placeholder art keeps these.
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESIGN = os.path.join(ROOT, "design")
OUT_DIR = os.path.join(ROOT, "Resources", "Sprites", "landmark")
CELL = 20          # source art pixel size (in source pixels)
COLORS = 15        # palette size per sprite, outline, transparency and effect colours not counted
OUTLINE = (27, 20, 18)
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

# id: source picture, in-game width (art px), how far the anchor sits above the bottom row
# (objects stand on the anchor), and an optional animation.
LANDMARKS = {
    "landmark.old-log": {"source": "landmark_old_log.jpg", "width": 40, "anchorUp": 4},
}


def native_grid(img):
    """One colour per source art pixel (None for background), cropped to the art."""
    w, h = img.size
    cols, rows = w // CELL, h // CELL
    px = img.load()
    grid = []
    for gy in range(rows):
        row = []
        for gx in range(cols):
            # Median of a small patch at the cell centre (JPEG noise at the edges is skipped).
            samples = [px[gx * CELL + CELL // 2 + dx, gy * CELL + CELL // 2 + dy] for dx in (-3, 0, 3) for dy in (-3, 0, 3)]
            r, g, b = (sorted(s[i] for s in samples)[4] for i in range(3))
            row.append(None if min(r, g, b) > 232 else (r, g, b))
        grid.append(row)
    ys = [y for y, row in enumerate(grid) if any(row)]
    xs = [x for x in range(cols) if any(grid[y][x] for y in range(rows))]
    return [row[min(xs):max(xs) + 1] for row in grid[min(ys):max(ys) + 1]]


def is_dark(c):
    return c is not None and sum(c) < 120


def components(w, h, filled, diag=False):
    """Connected groups of filled cells."""
    seen, out = set(), []
    steps = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (1, -1), (-1, 1), (-1, -1)] if diag else [])
    for y in range(h):
        for x in range(w):
            if not filled(x, y) or (x, y) in seen:
                continue
            comp, stack = [], [(x, y)]
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for dx, dy in steps:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and filled(nx, ny) and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            out.append(comp)
    return out


def strip_loose(grid):
    """Removes bits with no dark outline in them (the fairy ring's baked-in sparkles)."""
    h, w = len(grid), len(grid[0])
    for comp in components(w, h, lambda x, y: grid[y][x] is not None, diag=True):
        if not any(is_dark(grid[y][x]) for x, y in comp):
            for x, y in comp:
                grid[y][x] = None


def gather(grid, spread):
    """Pieces (8-connected groups) keep their size; their centres move in by `spread`. Back to front."""
    h, w = len(grid), len(grid[0])
    comps = components(w, h, lambda x, y: grid[y][x] is not None, diag=True)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    placed = []
    for comp in comps:
        mx = sum(x for x, _ in comp) / len(comp)
        my = max(y for _, y in comp)                  # by the foot, so nearer pieces draw over farther
        dx, dy = round((mx - cx) * (spread - 1)), round((my - cy) * (spread - 1))
        placed.append((my + dy, [(x + dx, y + dy, grid[y][x]) for x, y in comp]))
    placed.sort(key=lambda p: p[0])
    pts = [(x, y) for _, cells in placed for x, y, _ in cells]
    x0, y0 = min(x for x, _ in pts), min(y for _, y in pts)
    W, H = max(x for x, _ in pts) - x0 + 1, max(y for _, y in pts) - y0 + 1
    out = [[None] * W for _ in range(H)]
    for _, cells in placed:
        for x, y, c in cells:
            out[y - y0][x - x0] = c
    return out


def convert(cfg):
    img = Image.open(os.path.join(DESIGN, cfg["source"])).convert("RGB")
    grid = native_grid(img)
    if cfg.get("stripLoose"):
        strip_loose(grid)
    if cfg.get("spread"):
        grid = gather(grid, cfg["spread"])
        return native_sprite(grid)
    sh, sw = len(grid), len(grid[0])
    scale = cfg["width"] / sw
    tw, th = cfg["width"], max(1, round(sh * scale))

    # Palette from the source's own (non-outline) colours.
    body = [c for row in grid for c in row if c is not None and not is_dark(c)]
    pimg = Image.new("RGB", (len(body), 1))
    pimg.putdata(body)
    q = pimg.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:COLORS * 3]
    palette = [tuple(pal[i * 3:i * 3 + 3]) for i in range(COLORS)]

    def nearest(c):
        return min(range(len(palette)), key=lambda i: sum((a - b) ** 2 for a, b in zip(palette[i], c)))

    # Area resample: a target pixel is solid if most of the source area it covers is art; its colour
    # is the commonest palette colour there (dark lines win only when they cover a good share).
    out = [[None] * tw for _ in range(th)]
    for ty in range(th):
        for tx in range(tw):
            x0, x1 = tx / scale, (tx + 1) / scale
            y0, y1 = ty / scale, (ty + 1) / scale
            votes, dark, total, filled = {}, 0.0, 0.0, 0.0
            for sy in range(int(y0), min(sh, int(y1 + 0.999))):
                for sx in range(int(x0), min(sw, int(x1 + 0.999))):
                    wgt = max(0, min(x1, sx + 1) - max(x0, sx)) * max(0, min(y1, sy + 1) - max(y0, sy))
                    if wgt <= 0:
                        continue
                    total += wgt
                    c = grid[sy][sx]
                    if c is None:
                        continue
                    filled += wgt
                    if is_dark(c):
                        dark += wgt
                    else:
                        k = nearest(c)
                        votes[k] = votes.get(k, 0) + wgt
            if total == 0 or filled / total < 0.5:
                continue
            out[ty][tx] = "dark" if not votes or dark > 0.55 * filled else max(votes, key=votes.get)

    # Specks left from thin source lines (lone pixels or pairs) are dropped.
    for comp in components(tw, th, lambda x, y: out[y][x] is not None):
        if len(comp) < 3:
            for x, y in comp:
                out[y][x] = None

    def green(v):
        if v is None or v == "dark":
            return False
        r, g, b = palette[v]
        return g > r + 8 and g > b

    def solid(x, y):
        return 0 <= x < tw and 0 <= y < th and out[y][x] is not None
    final = [row[:] for row in out]
    for y in range(th):
        for x in range(tw):
            if out[y][x] is None or green(out[y][x]):
                continue
            if not all(solid(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                final[y][x] = "dark"
    return final, palette


def native_sprite(grid):
    """A source used at its own size: colours mapped to a shared palette, dark pixels as outline."""
    body = [c for row in grid for c in row if c is not None and not is_dark(c)]
    pimg = Image.new("RGB", (len(body), 1))
    pimg.putdata(body)
    q = pimg.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:COLORS * 3]
    palette = [tuple(pal[i * 3:i * 3 + 3]) for i in range(COLORS)]

    def nearest(c):
        return min(range(len(palette)), key=lambda i: sum((a - b) ** 2 for a, b in zip(palette[i], c)))
    return [[None if c is None else "dark" if is_dark(c) else nearest(c) for c in row] for row in grid], palette


def pad(grid, n):
    w = len(grid[0])
    return [[None] * (w + 2 * n) for _ in range(n)] + [[None] * n + row + [None] * n for row in grid] + [[None] * (w + 2 * n) for _ in range(n)]


# ---------------------------------------------------------------- animations
# Frames are copies of the base grid with effect pixels drawn on; effect colours are extra palette
# entries named "fx0", "fx1", ...

def ripples(base, palette):
    """Moonwell: two rings spread across the water in turn and fade, over 10 frames."""
    h, w = len(base), len(base[0])

    def water(v):
        if v is None or v == "dark" or isinstance(v, str):
            return False
        r, g, b = palette[v]
        return b > r + 40 and b > 110
    cells = [(x, y) for y in range(h) for x in range(w) if water(base[y][x])]
    if not cells:
        return [base], [], [1.0]
    cx = sum(x for x, _ in cells) / len(cells)
    cy = sum(y for _, y in cells) / len(cells)
    rx = max(abs(x - cx) for x, _ in cells) + 0.5
    ry = max(abs(y - cy) for _, y in cells) + 0.5
    n = 10
    fx = ["#e8ffff", "#a8f0ff", "#6fd6ec"]           # bright, mid, faint ring
    frames = []
    # Each ripple: centre (fraction of the water), start frame; its ring grows over 6 frames.
    drops = [((-0.25, -0.1), 0), ((0.3, 0.15), 5)]
    for f in range(n):
        g = [row[:] for row in base]
        for (ox, oy), start in drops:
            age = (f - start) % n
            if age >= 6:
                continue
            k = (age + 1) / 6
            col = "fx0" if age < 2 else "fx1" if age < 4 else "fx2"
            px0, py0 = cx + ox * rx, cy + oy * ry
            rr = 0.15 + k * 0.6                          # ring radius as a share of the pool
            for x, y in cells:
                d = math.hypot((x - px0) / rx, (y - py0) / ry)
                if abs(d - rr) < 0.07 + 0.02 * (1 - k):
                    g[y][x] = col
        frames.append(g)
    return frames, fx, [0.16] * n


def sparkles(base, palette):
    """Fairy Ring: little stars twinkle on and off around the ring, over 12 frames."""
    h, w = len(base), len(base[0])
    rnd = random.Random(7)
    pts = [(x, y) for y in range(h) for x in range(w) if base[y][x] is not None]
    cx = sum(x for x, _ in pts) / len(pts)
    cy = sum(y for _, y in pts) / len(pts)
    rx = (max(x for x, _ in pts) - min(x for x, _ in pts)) / 2
    ry = (max(y for _, y in pts) - min(y for _, y in pts)) / 2
    fx = ["#fffbe8", "#ffe9a0", "#b8d8ff"]           # white core, gold, blue
    n = 12
    stars = []
    tries = 0
    while len(stars) < 14 and tries < 2000:
        tries += 1
        a = rnd.random() * math.pi * 2
        s = rnd.choice([0.7, 0.85, 1.0, 1.12])         # inside the ring, on it, or just outside
        x, y = round(cx + math.cos(a) * rx * s), round(cy + math.sin(a) * ry * s)
        if not (1 <= x < w - 1 and 1 <= y < h - 1) or base[y][x] is not None:
            continue
        if any(abs(x - sx) + abs(y - sy) < 5 for sx, sy, _, _ in stars):
            continue
        stars.append((x, y, rnd.randrange(n), rnd.choice(["fx1", "fx2"])))
    # A star's life: dot, small cross, bright cross, small cross, dot, then dark for the rest.
    life = ["dot", "cross", "big", "cross", "dot"]
    frames = []
    for f in range(n):
        g = [row[:] for row in base]

        def put(x, y, col):
            if 0 <= x < w and 0 <= y < h and g[y][x] is None:
                g[y][x] = col
        for x, y, start, col in stars:
            age = (f - start) % n
            if age >= len(life):
                continue
            stage = life[age]
            if stage == "dot":
                put(x, y, col)
            else:
                put(x, y, "fx0")
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    put(x + dx, y + dy, col)
                if stage == "big":
                    for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                        put(x + dx, y + dy, col)
        frames.append(g)
    return frames, fx, [0.12] * n


ANIMS = {"ripples": ripples, "sparkles": sparkles}


def write(sprite_id, cfg):
    base, palette = convert(cfg)
    if cfg.get("anim") == "sparkles":
        base = pad(base, 3)
    frames, fx, durations = [base], [], None
    if cfg.get("anim"):
        frames, fx, durations = ANIMS[cfg["anim"]](base, palette)
    th, tw = len(base), len(base[0])
    hexes = ["transparent", "#%02x%02x%02x" % OUTLINE] + ["#%02x%02x%02x" % c for c in palette] + fx

    def ch(v):
        if v is None:
            return "."
        if v == "dark":
            return "1"
        if isinstance(v, str):                          # "fxN"
            return ALPHABET[2 + len(palette) + int(v[2:])]
        return ALPHABET[v + 2]
    out_frames = []
    for i, g in enumerate(frames):
        fr = {"rows": ["".join(ch(v) for v in row) for row in g]}
        if durations:
            fr["duration"] = durations[i]
        out_frames.append(fr)
    if cfg.get("flat"):
        # Flat ground pieces: the art's middle sits on the tile's centre (the foot line is 5px lower).
        anchor = [tw // 2, th // 2 + 5]
    else:
        anchor = [tw // 2, th - cfg.get("anchorUp", 4)]
    data = {"id": sprite_id, "size": [tw, th], "anchor": anchor, "palette": hexes, "frames": out_frames, "tags": ["landmark"]}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, sprite_id + ".json"), "w") as fh:
        json.dump(data, fh, indent=1)
        fh.write("\n")
    print("wrote %s (%dx%d, %d frame%s)" % (sprite_id, tw, th, len(out_frames), "" if len(out_frames) == 1 else "s"))


def main(only=None):
    for sprite_id, cfg in LANDMARKS.items():
        if only and sprite_id not in only:
            continue
        if os.path.exists(os.path.join(DESIGN, cfg["source"])):
            write(sprite_id, cfg)


if __name__ == "__main__":
    main()
