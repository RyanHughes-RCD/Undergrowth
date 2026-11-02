#!/usr/bin/env python3
"""The Old Log landmark sprite (an old mossy stump), from design/stump_source.jpg.

The source is pixel art drawn on a 20px grid on a white background. This reads one colour per art
pixel, shrinks it to the in-game size (WIDTH art px, about two and a half tiles: the stump covers
two tiles and its roots and grass spill a little past them), keeps the source's own colours, and
redraws a clean 1px dark outline so the edge stays crisp after scaling.

    python3 tools/gen_stump.py

Writes Resources/Sprites/landmark/landmark.old-log.json. gen_topdown.py (via gen_placeholders.py)
calls this too, so re-running the placeholder art keeps the stump.
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "design", "stump_source.jpg")
OUT = os.path.join(ROOT, "Resources", "Sprites", "landmark", "landmark.old-log.json")
CELL = 20          # source art pixel size (in source pixels)
WIDTH = 40         # in-game width in art pixels (tiles are 16)
COLORS = 15        # palette size, outline and transparency not counted
OUTLINE = (27, 20, 18)
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def native_grid(img):
    """One colour per source art pixel (None for background)."""
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
            row.append(None if min(r, g, b) > 225 else (r, g, b))
        grid.append(row)
    # Crop to the art.
    ys = [y for y, row in enumerate(grid) if any(row)]
    xs = [x for x in range(cols) if any(grid[y][x] for y in range(rows))]
    return [row[min(xs):max(xs) + 1] for row in grid[min(ys):max(ys) + 1]]


def is_dark(c):
    return c is not None and sum(c) < 120


def main():
    img = Image.open(SOURCE).convert("RGB")
    grid = native_grid(img)
    sh, sw = len(grid), len(grid[0])
    scale = WIDTH / sw
    tw, th = WIDTH, max(1, round(sh * scale))

    # Shared palette from the source's own (non-outline) colours.
    body = [c for row in grid for c in row if c is not None and not is_dark(c)]
    pimg = Image.new("RGB", (len(body), 1))
    pimg.putdata(body)
    q = pimg.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:COLORS * 3]
    palette = [tuple(pal[i * 3:i * 3 + 3]) for i in range(COLORS)]

    def nearest(c):
        return min(range(len(palette)), key=lambda i: sum((a - b) ** 2 for a, b in zip(palette[i], c)))

    # Area resample: each target pixel looks at the source pixels it covers. It's solid if most of
    # that area is art; its colour is the commonest palette colour there (dark lines win only when
    # they cover a good share, so cracks survive but don't swallow the bark).
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
            if not votes or dark > 0.55 * filled:
                out[ty][tx] = "dark"
            else:
                out[ty][tx] = max(votes, key=votes.get)

    # Specks left from thin source lines (lone pixels or pairs) are dropped.
    seen = set()
    for y in range(th):
        for x in range(tw):
            if out[y][x] is None or (x, y) in seen:
                continue
            comp, stack = [], [(x, y)]
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < tw and 0 <= ny < th and out[ny][nx] is not None and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) < 3:
                for cx, cy in comp:
                    out[cy][cx] = None

    # Clean 1px outline: wood touching background (4-way) becomes the outline colour. Greenery (the
    # grass and sprigs) is left unoutlined, as in the source.
    def solid(x, y):
        return 0 <= x < tw and 0 <= y < th and out[y][x] is not None

    def green(v):
        if v is None or v == "dark":
            return False
        r, g, b = palette[v]
        return g > r + 8 and g > b
    final = [row[:] for row in out]
    for y in range(th):
        for x in range(tw):
            if out[y][x] is None or green(out[y][x]):
                continue
            if not all(solid(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                final[y][x] = "dark"

    hexes = ["transparent", "#%02x%02x%02x" % OUTLINE] + ["#%02x%02x%02x" % c for c in palette]
    rows = []
    for row in final:
        s = ""
        for v in row:
            s += "." if v is None else ("1" if v == "dark" else ALPHABET[v + 2])
        rows.append(s)
    # Anchor: the stump's base sits on the tile's foot line, centred between its two tiles.
    data = {"id": "landmark.old-log", "size": [tw, th], "anchor": [tw // 2, th - 4], "palette": hexes,
            "frames": [{"rows": rows}], "tags": ["landmark"]}
    with open(OUT, "w") as fh:
        json.dump(data, fh, indent=1)
        fh.write("\n")
    print("wrote %s (%dx%d from %dx%d source pixels)" % (OUT, tw, th, sw, sh))


if __name__ == "__main__":
    main()
