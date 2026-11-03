#!/usr/bin/env python3
"""Pixel-art UI icons and effects (run via gen_placeholders.py).

Every icon is a regular data sprite in the registry (ids "ui.icon.*", "ui.burst"),
so the UI has no emoji or system glyphs and the future sprite editor can restyle it.
Icons are 12x12 with a 1px dark outline and light from the top-left.
"""
import math

from gen_placeholders import Canvas, write

OUT = "#1b1420"


def icon(name, palette, draw, size=12, outline=True, frames=1, durations=None):
    out = []
    for f in range(frames):
        c = Canvas(size, size)
        draw(c, f)
        if outline:
            c.outline(1)
        out.append(c)
    write("ui.icon." + name, (size, size), out, palette=["transparent", OUT] + palette,
          anchor=(size // 2, size // 2), tags=["ui"], durations=durations)


def make_icons():
    # 2 main, 3 light, 4 dark, 5 accent
    def bag(c, f):
        c.rect(2, 4, 9, 10, 2)
        c.rect(2, 4, 9, 5, 4)
        c.rect(5, 5, 6, 6, 5)
        c.line(3, 4, 4, 1, 4); c.line(8, 4, 7, 1, 4); c.rect(4, 1, 7, 1, 4)
        c.rect(3, 6, 3, 9, 3)
    icon("bag", ["#c0603a", "#e88a5a", "#7a3422", "#ffd84a"], bag)

    def book(c, f):
        c.rect(2, 1, 9, 10, 2)
        c.rect(2, 1, 3, 10, 4)
        c.rect(5, 3, 8, 3, 3); c.rect(5, 5, 8, 5, 3); c.rect(5, 7, 7, 7, 3)
    icon("guide", ["#3f7a46", "#d8e8c0", "#234a2a"], book)

    def bug(c, f):
        c.ellipse(6, 7, 4.5, 4, 2)
        c.rect(4, 1, 7, 3, 4)
        c.line(6, 3, 6, 10, 4)
        for (x, y) in ((4, 6), (8, 6), (4, 9), (8, 9)):
            c.set(x, y, 4)
        c.set(4, 5, 3)
    icon("bug", ["#d8323c", "#ff8a8a", "#1b1420"], bug)

    def fast(c, f):
        for x0 in (1, 6):
            for i in range(5):
                c.rect(x0 + i, 1 + i, x0 + i, 10 - i, 2 if i < 3 else 3)
    icon("fast", ["#ffd84a", "#fff3a8"], fast)

    def lock(c, f):
        c.rect(2, 5, 9, 10, 2)
        c.rect(3, 1, 4, 5, 4); c.rect(7, 1, 8, 5, 4); c.rect(4, 0, 7, 1, 4)
        c.rect(5, 7, 6, 8, 4)
        c.rect(3, 6, 3, 9, 3)
    icon("lock", ["#c9a43a", "#f0d878", "#6a5420"], lock)

    def sparkle(c, f):
        c.rect(5, 1, 6, 10, 2); c.rect(1, 5, 10, 6, 2)
        c.rect(4, 4, 7, 7, 2)
        c.rect(5, 5, 6, 6, 3)
    icon("sparkle", ["#ffd84a", "#ffffff"], sparkle)

    def moon(c, f):
        c.ellipse(6, 6, 5, 5, 2)
        c.ellipse(8.5, 4.5, 4, 4, 0)
        c.set(3, 5, 3)
    icon("moon", ["#e8e0b0", "#ffffff"], moon)

    def sun(c, f):
        c.ellipse(6, 6, 3.2, 3.2, 2)
        for (x, y) in ((6, 0), (6, 11), (0, 6), (11, 6), (2, 2), (9, 2), (2, 9), (9, 9)):
            c.set(x if x < 11 else 10, y if y < 11 else 10, 3)
        c.set(5, 5, 3)
    icon("sun", ["#ffc83a", "#fff3a8"], sun)

    def leaf(c, f):
        c.ellipse(6.5, 5.5, 3.5, 4.5, 2)
        c.line(3, 10, 8, 3, 4)
        c.set(5, 3, 3)
    icon("leaf", ["#5ea347", "#a6e57a", "#2e5c26"], leaf)

    def close(c, f):
        for i in range(8):
            c.rect(2 + i, 2 + i, 3 + i, 2 + i, 2)
            c.rect(9 - i, 2 + i, 10 - i, 2 + i, 2)
    icon("close", ["#f2efe6"], close)

    def back(c, f):
        for i in range(4):
            c.rect(3 + i, 5 - i, 4 + i, 6 + i, 2)
        c.rect(4, 5, 9, 6, 2)
    icon("back", ["#f2efe6"], back)

    def chevron(c, f):
        for i in range(4):
            c.rect(4 + i, 2 + i, 5 + i, 2 + i, 2)
            c.rect(4 + i, 9 - i, 5 + i, 9 - i, 2)
    icon("chevron", ["#9a968c"], chevron, outline=False)

    def plus(c, f):
        c.rect(5, 2, 6, 9, 2); c.rect(2, 5, 9, 6, 2)
    icon("plus", ["#8a948a"], plus, outline=False)

    def heart(c, f):
        c.ellipse(4, 4.5, 2.5, 2.5, 2); c.ellipse(8, 4.5, 2.5, 2.5, 2)
        for y in range(5, 11):
            half = max(0, 10 - y)
            c.rect(6 - half, y, 5 + half, y, 2)
        c.set(3, 3, 3)
    icon("heart", ["#e04a6a", "#ffb0c0"], heart)

    def stall(c, f):
        # A little market stall: striped awning over a wooden counter (the Store tab).
        for x in range(1, 11):
            c.rect(x, 1, x, 3, 2 if (x // 2) % 2 == 0 else 3)
        for x in range(1, 11, 2):
            c.set(x, 4, 2 if (x // 2) % 2 == 0 else 3)
        c.rect(2, 5, 2, 10, 4); c.rect(9, 5, 9, 10, 4)            # posts
        c.rect(2, 7, 9, 10, 4)                                     # counter
        c.rect(3, 7, 8, 7, 5)                                      # counter top (lit)
        c.set(4, 6, 6); c.set(7, 6, 6)                             # goods on the counter
    icon("store", ["#d8584a", "#f4ead0", "#8a6440", "#c49a6c", "#ffd84a"], stall)


def make_burst():
    """Stepped pixel rays for reveal moments (2 frames, alternate ray sets)."""
    frames = []
    size = 48
    for f in range(2):
        c = Canvas(size, size)
        cx = cy = size / 2 - 0.5
        n = 12
        for i in range(n):
            if i % 2 != f:
                continue
            a = i * math.pi * 2 / n
            for r in range(6, 23):
                w = 1 if r < 14 else 2
                x = cx + math.cos(a) * r
                y = cy + math.sin(a) * r
                for d in range(w):
                    c.set(x + d * -math.sin(a), y + d * math.cos(a), 2 if r < 16 else 3)
        frames.append(c)
    write("ui.burst", (size, size), frames, palette=["transparent", OUT, "#fff3b0", "#ffd84a"],
          anchor=(size // 2, size // 2), tags=["ui"], durations=[0.25, 0.25])


def main():
    make_icons()
    make_burst()

