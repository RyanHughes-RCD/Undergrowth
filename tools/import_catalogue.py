#!/usr/bin/env python3
"""Imports design/Undergrowth_Catalogue.xlsx (the Plant & Fungi Catalogue) into Resources/Content/items.json.

    pip install openpyxl
    python3 tools/import_catalogue.py           # writes items.json (only if it changed)
    python3 tools/import_catalogue.py --check   # preview only

One row per plant or fungus: Name, Category (Mushroom / Plant), Rarity, School (blank = plain ground) and a
Description (shown in the Field Guide). Ids are "<category>.<slug of name>" and sprites "item.<id>", the same
as before, so existing art and Field Guide discoveries keep working. Garden plants (Content/plants.json)
name the catalogue item they yield; the foraging patch picks from the plain ones (tuning.json → forage).
"""
import json
import os
import re
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("This needs openpyxl:  pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "design", "Undergrowth_Catalogue.xlsx")
OUT = os.path.join(ROOT, "Resources", "Content", "items.json")
SCHOOLS = ["spore", "glow", "bloom", "verdure", "shimmer", "spirit"]
RARITY = {"common": "common", "uncommon": "uncommon", "rare": "rare", "very rare": "veryRare", "legendary": "legendary"}
CATEGORY = {"mushroom": "mushroom", "plant": "plant"}


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "")).strip("-")


def read(errors):
    ws = openpyxl.load_workbook(SHEET)["Catalogue"]
    items, seen = [], set()
    for r in range(5, ws.max_row + 1):
        name, cat, rar, school, desc = (ws.cell(r, c).value for c in range(1, 6))
        if not name:
            continue
        name = str(name).strip()
        category = CATEGORY.get(str(cat or "").strip().lower())
        rarity = RARITY.get(str(rar or "").strip().lower())
        if not category:
            errors.append(f"row {r} ({name}): category must be Mushroom or Plant")
            continue
        if not rarity:
            errors.append(f"row {r} ({name}): rarity must be one of {', '.join(RARITY)}")
            continue
        iid = f"{category}.{slug(name)}"
        if iid in seen:
            errors.append(f"row {r} ({name}): duplicate id {iid}")
        seen.add(iid)
        it = {"id": iid, "category": category, "name": name, "rarity": rarity, "sprite": "item." + iid}
        if school:
            s = str(school).strip().lower()
            if s not in SCHOOLS:
                errors.append(f"row {r} ({name}): school must be blank or one of {', '.join(SCHOOLS)}")
            it["school"] = s
        if desc and str(desc).strip():
            it["guideText"] = str(desc).strip()
        items.append(it)
    return items


def main(argv):
    errors = []
    items = read(errors)
    if errors:
        print("Problems:")
        for e in errors:
            print("  -", e)
        return 1
    new = "[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in items) + "\n]\n"
    old = open(OUT).read() if os.path.exists(OUT) else None
    print(f"items.json: {len(items)} entries, {'unchanged' if old == new else 'changed'}")
    if old != new and "--check" not in argv:
        with open(OUT, "w") as f:
            f.write(new)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
