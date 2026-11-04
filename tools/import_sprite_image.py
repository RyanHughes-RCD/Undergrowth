#!/usr/bin/env python3
"""Turns a drawn pixel-art picture (an upscaled PNG/JPG on a white background) into a game sprite.

    pip install pillow
    python3 tools/import_sprite_image.py                      # every picture in ART below
    python3 tools/import_sprite_image.py landmark.well        # just one

How it works:
1. The picture's art pixels are found on its grid (`cell` source pixels per art pixel; each cell is read
   at its centre). Near-white is background and becomes transparent.
2. By default one art pixel is one game pixel, so the art keeps its size. With `width` it's scaled to that
   many game pixels (each covers a block of art pixels: opaque if most of the block is, in the block's
   average colour) and its edge is redrawn as a 1px outline.
3. Colours are reduced to at most `colors` (plus transparent; this also clears the JPEG noise), and the
   sprite is written to Resources/Sprites/<prefix>/<id>.json, standing on its bottom rows.

The source pictures live in design/art/. Re-running it reproduces the sprites exactly.
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_placeholders import Canvas, write  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# sprite id: source picture, art-pixel size in the picture, colours, tags; optional `width` scales the art
# (without it, one art pixel is one game pixel: the picture keeps its own size)
ART = {
    "landmark.stump": {"src": "design/art/tree_stump.jpg", "cell": 20, "colors": 32, "tags": ["landmark"]},
    "landmark.well": {"src": "design/art/wishing_well.jpg", "cell": 20, "colors": 32, "tags": ["landmark"]},
}
WHITE = 690          # r+g+b above this is background


def native(path, cell):
    """The picture's art pixels: a grid of (r, g, b) or None for background, cropped to the art."""
    im = Image.open(os.path.join(ROOT, path)).convert("RGB")
    W, H = im.size
    px = im.load()
    cols, rows = W // cell, H // cell
    grid = []
    for gy in range(rows):
        row = []
        for gx in range(cols):
            # average a small block at the cell's centre (JPEG noise)
            cx, cy = gx * cell + cell // 2, gy * cell + cell // 2
            acc = [0, 0, 0]
            n = 0
            for dy in (-2, 0, 2):
                for dx in (-2, 0, 2):
                    if 0 <= cx + dx < W and 0 <= cy + dy < H:
                        r, g, b = px[cx + dx, cy + dy]
                        acc[0] += r; acc[1] += g; acc[2] += b; n += 1
            c = tuple(v // n for v in acc)
            row.append(None if sum(c) > WHITE else c)
        grid.append(row)
    ys = [y for y, r in enumerate(grid) if any(r)]
    xs = [x for x in range(cols) if any(grid[y][x] for y in range(rows))]
    return [r[min(xs):max(xs) + 1] for r in grid[min(ys):max(ys) + 1]]


def scale(grid, width):
    """Scale art pixels to `width` game pixels: block coverage decides opacity, the block's average its colour."""
    h0, w0 = len(grid), len(grid[0])
    k = w0 / width
    height = max(1, round(h0 / k))
    out = []
    for y in range(height):
        row = []
        for x in range(width):
            y0, y1 = int(y * k), max(int(y * k) + 1, int((y + 1) * k))
            x0, x1 = int(x * k), max(int(x * k) + 1, int((x + 1) * k))
            cells = [grid[yy][xx] for yy in range(y0, min(y1, h0)) for xx in range(x0, min(x1, w0))]
            solid = [c for c in cells if c]
            if not cells or len(solid) * 2 < len(cells):
                row.append(None)
                continue
            # lean towards the darkest pixels a little, so outlines and shading survive the scale
            solid.sort(key=sum)
            keep = solid[: max(1, (len(solid) * 3 + 3) // 4)]
            row.append(tuple(sum(c[i] for c in keep) // len(keep) for i in range(3)))
        out.append(row)
    return out


def quantize(grid, colors):
    """At most `colors` colours: returns (palette hex list, index grid with 0 = transparent)."""
    pts = [c for r in grid for c in r if c]
    im = Image.new("RGB", (len(pts), 1))
    im.putdata(pts)
    q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[: 3 * colors]
    data = list(q.tobytes())
    used = sorted(set(data))
    # the darkest colour first (it becomes the outline), then the rest from dark to light
    used.sort(key=lambda i: sum(pal[3 * i: 3 * i + 3]))
    remap = {i: n + 1 for n, i in enumerate(used)}
    hexes = ["#%02x%02x%02x" % tuple(pal[3 * i: 3 * i + 3]) for i in used]
    out, k = [], 0
    for r in grid:
        row = []
        for c in r:
            if c:
                row.append(remap[data[k]]); k += 1
            else:
                row.append(0)
        out.append(row)
    return hexes, out


def outline(idx):
    """Opaque pixels on the edge (next to transparency or the border) take the darkest colour."""
    h, w = len(idx), len(idx[0])
    edge = []
    for y in range(h):
        for x in range(w):
            if not idx[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h) or not idx[ny][nx]:
                    edge.append((x, y))
                    break
    for x, y in edge:
        idx[y][x] = 1


def build(sid, cfg):
    grid = native(cfg["src"], cfg["cell"])
    if cfg.get("width"):
        grid = scale(grid, cfg["width"])
    hexes, idx = quantize(grid, cfg["colors"])
    hexes[0] = "#1b1420"            # the darkest colour is the outline: use the game's outline colour
    if cfg.get("width"):
        outline(idx)
    h, w = len(idx), len(idx[0])
    c = Canvas(w, h)
    for y in range(h):
        for x in range(w):
            c.px[y][x] = idx[y][x]
    write(sid, (w, h), [c], palette=["transparent"] + hexes, anchor=(w // 2, h - 3), tags=cfg.get("tags"))
    print("%s: %dx%d, %d colours" % (sid, w, h, len(hexes)))


def main():
    only = sys.argv[1:]
    for sid, cfg in ART.items():
        if not only or sid in only:
            build(sid, cfg)


if __name__ == "__main__":
    main()
