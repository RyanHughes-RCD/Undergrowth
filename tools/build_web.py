#!/usr/bin/env python3
"""Builds the web prototype into dist/ for GitHub Pages (stdlib only).

Copies web/ and bundles the shared game data from Resources/ (tuning, content
files, every sprite and palette) into dist/content.json, so the browser loads
one file. (The iOS app reads Resources/ directly, with its own frozen ios/tuning.json.)

    python3 tools/build_web.py            # build
    python3 -m http.server -d dist 8000   # then open http://localhost:8000
"""
import json
import os
import shutil

# Resources/Content files bundled for the browser (each becomes bundle[<name>]).
CONTENT_FILES = ("items", "nameParts", "landmarks", "story", "opening", "visitors", "relics", "requests", "cosmetics", "plants", "amendments")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "Resources")
OUT = os.path.join(ROOT, "dist")


def load(path):
    with open(path) as fh:
        return json.load(fh)


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(os.path.join(ROOT, "web"), OUT)

    sprites, palettes = [], []
    sprite_dir = os.path.join(RES, "Sprites")
    for dirpath, _, files in sorted(os.walk(sprite_dir)):
        for name in sorted(files):
            if not name.endswith(".json"):
                continue
            data = load(os.path.join(dirpath, name))
            (palettes if os.path.basename(dirpath) == "Palettes" else sprites).append(data)

    content = os.path.join(RES, "Content")
    bundle = {
        "tuning": load(os.path.join(RES, "tuning.json")),
        **{k: load(os.path.join(content, k + ".json")) for k in CONTENT_FILES},
        "sprites": sprites,
        "palettes": palettes,
    }
    with open(os.path.join(OUT, "content.json"), "w") as fh:
        json.dump(bundle, fh, separators=(",", ":"))
    # Pages: serve files as-is (no Jekyll processing).
    open(os.path.join(OUT, ".nojekyll"), "w").close()
    print("built %s (%d sprites, %d palettes)" % (OUT, len(sprites), len(palettes)))


if __name__ == "__main__":
    main()
