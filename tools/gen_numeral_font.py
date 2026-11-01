#!/usr/bin/env python3
"""UG Numerals: a tiny pixel font for numbers, used alongside Pixelify Sans.

    pip install fonttools brotli
    python3 tools/gen_numeral_font.py

Pixelify Sans is kept for all text. Its digits are hard to tell apart at phone sizes
(5/S, 3/8, 0/8) and proportional (a "1" is narrower, so counters jiggle), so this
font supplies only digits and number punctuation, drawn on the same pixel grid:
  - 5x7 digits with a slashed 0, a flat-topped open 3, a square-cornered 5, a footed 1
    and a straight-stemmed 7;
  - every digit has the same advance (tabular), matching Pixelify's digit width;
  - same height, baseline and pixel size as Pixelify Sans, so it sits in text seamlessly.
CSS loads it first with a unicode-range, so the browser uses it for numbers only.
Writes web/fonts/ug-numerals-400.woff2 and -700.woff2 (the bold has wider pixels).
"""
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "fonts")

UPM = 1000
PX = 92          # one pixel, in font units (Pixelify Sans' grid)
BOTTOM = -12     # Pixelify's digit baseline overshoot
LSB = 60

GLYPHS = {
    # name: (codepoint, advance, rows top→bottom; '#' = pixel; rows may extend below the baseline)
    "zero": (0x30, "digit", [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."]),
    "one": (0x31, "digit", ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"]),
    "two": (0x32, "digit", [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
    "three": (0x33, "digit", ["####.", "....#", "....#", ".###.", "....#", "....#", "####."]),
    "four": (0x34, "digit", ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
    "five": (0x35, "digit", ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
    "six": (0x36, "digit", ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."]),
    "seven": (0x37, "digit", ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
    "eight": (0x38, "digit", [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]),
    "nine": (0x39, "digit", [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]),
    "percent": (0x25, "digit", ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"]),
    "plus": (0x2B, "digit", [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."]),
    "minus": (0x2212, "digit", [".....", ".....", ".....", "#####", ".....", ".....", "....."]),
    "multiply": (0xD7, "digit", [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."]),
    "slash": (0x2F, "digit", ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."]),
    "period": (0x2E, "dot", [".", ".", ".", ".", ".", ".", "#"]),
    "colon": (0x3A, "dot", [".", ".", "#", ".", ".", "#", "."]),
    "comma": (0x2C, "comma", ["..", "..", "..", "..", "..", "..", ".#", "#."]),
}

ADVANCE = {
    400: {"digit": 586, "dot": 222, "comma": 267},
    700: {"digit": 603, "dot": 249, "comma": 293},
}


def glyph(rows, widen):
    """Pixels as rectangles; each horizontal run becomes one rectangle."""
    pen = TTGlyphPen(None)
    top = BOTTOM + 7 * PX
    drawn = False
    for r, row in enumerate(rows):
        y1 = top - r * PX
        y0 = y1 - PX
        x = 0
        while x < len(row):
            if row[x] != "#":
                x += 1
                continue
            start = x
            while x < len(row) and row[x] == "#":
                x += 1
            x0, x1 = LSB + start * PX, LSB + x * PX + widen
            pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
            drawn = True
    if not drawn:
        pen.moveTo((0, 0)); pen.lineTo((0, 0)); pen.closePath()
    return pen.glyph()


def build(weight):
    widen = 0 if weight == 400 else 18
    names = [".notdef", "space"] + list(GLYPHS)
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    cmap = {0x20: "space"}
    cmap.update({cp: name for name, (cp, _, _) in GLYPHS.items()})
    fb.setupCharacterMap(cmap)
    glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (ADVANCE[weight]["digit"], 0), "space": (ADVANCE[weight]["digit"], 0)}
    for name, (cp, kind, rows) in GLYPHS.items():
        glyphs[name] = glyph(rows, widen)
        metrics[name] = (ADVANCE[weight][kind], LSB)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=920, descent=-280)
    style = "Regular" if weight == 400 else "Bold"
    fb.setupNameTable({"familyName": "UG Numerals", "styleName": style,
                       "copyright": "Made for Undergrowth. Free to use under the SIL Open Font License 1.1."})
    fb.setupOS2(sTypoAscender=920, sTypoDescender=-280, usWinAscent=920, usWinDescent=280,
                sCapHeight=700, sxHeight=450, usWeightClass=weight, fsSelection=0x20 if weight == 700 else 0x40)
    fb.setupPost()
    if weight == 700:
        fb.updateHead(macStyle=1)
    fb.font.flavor = "woff2"
    path = os.path.join(OUT, "ug-numerals-%d.woff2" % weight)
    fb.save(path)
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    for w in (400, 700):
        print("wrote", os.path.relpath(build(w), ROOT))


if __name__ == "__main__":
    main()
