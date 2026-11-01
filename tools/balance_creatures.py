#!/usr/bin/env python3
"""Applies design/creature_balance.json to the spawn spreadsheet's creature rows.

    python3 tools/balance_creatures.py         # writes Stat 1/2/3, bonuses, radius, ramp into the sheet
    python3 tools/import_spawn_table.py        # then rebuild the content as usual

The sheet stays the source of truth: after this runs you can still hand-edit any creature there.
Per rarity: a primary bonus, an optional secondary (and a third for legendaries), a radius and a ramp
time. Each creature picks its stats and a variant (focused / broad / pure / dual / standard) so
creatures of the same rarity differ in shape, not just in stat name.
"""
import json
import os

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "design", "Undergrowth_Spawn_Table.xlsx")
CONFIG = os.path.join(ROOT, "design", "creature_balance.json")
RARITY = {"common": "common", "uncommon": "uncommon", "rare": "rare", "very rare": "veryRare", "legendary": "legendary"}


def main():
    cfg = json.load(open(CONFIG))
    wb = openpyxl.load_workbook(SHEET)
    ws = wb.worksheets[0]
    hdr = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value == "Name")
    cols = {str(ws.cell(hdr, c).value).strip(): c for c in range(1, ws.max_column + 1) if ws.cell(hdr, c).value}
    last = max(cols.values())
    for name in ("Stat 3", "Stat 3 max bonus"):                 # optional third stat (legendaries)
        if name not in cols:
            last += 1
            ws.cell(hdr, last).value = name
            src = ws.cell(hdr, cols["Stat 2"])
            from copy import copy
            dst = ws.cell(hdr, last)
            dst.font, dst.fill, dst.alignment, dst.border = copy(src.font), copy(src.fill), copy(src.alignment), copy(src.border)
            cols[name] = last
    changed = 0
    for r in range(hdr + 1, ws.max_row + 1):
        if ws.cell(r, 2).value != "Creature":
            continue
        name = ws.cell(r, 1).value
        spec = cfg["creatures"].get(name)
        if not spec:
            print("not in balance file (left as is):", name)
            continue
        rar = cfg["rarity"][RARITY[str(ws.cell(r, 4).value).lower()]]
        var = cfg["variants"][spec.get("variant", "standard")]
        primary = round(rar["primary"] * var["primary"])
        secondary = round(rar.get("secondary", 0) * var["secondary"]) if spec.get("secondary") else 0
        third = rar.get("third", 0) if spec.get("third") else 0
        radius = max(1, rar["radius"] + var["radius"])
        ws.cell(r, cols["Stat 1"]).value = spec["primary"].capitalize()
        ws.cell(r, cols["Stat 1 max bonus"]).value = primary
        ws.cell(r, cols["Stat 2"]).value = spec["secondary"].capitalize() if secondary else None
        ws.cell(r, cols["Stat 2 max bonus"]).value = secondary or None
        ws.cell(r, cols["Stat 3"]).value = spec["third"].capitalize() if third else None
        ws.cell(r, cols["Stat 3 max bonus"]).value = third or None
        ws.cell(r, cols["Influence radius (tiles)"]).value = radius
        ws.cell(r, cols["Ramp to cap (hours)"]).value = rar["rampHours"]
        changed += 1
    wb.save(SHEET)
    print("balanced %d creatures in %s" % (changed, os.path.relpath(SHEET, ROOT)))


if __name__ == "__main__":
    main()
