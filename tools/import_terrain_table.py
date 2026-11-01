#!/usr/bin/env python3
"""Imports design/Undergrowth_Terrain_Table.xlsx into Resources/Content/tileRules.json.

    pip install openpyxl
    python3 tools/import_terrain_table.py [path/to/Terrain_Table.xlsx] [--stubs] [--check]

Only rows whose Status is "In game" are written. Sheets: Ground Tiles, Overlays,
Decorations, Tints (see the workbook's "How to use" tab for every column).

--stubs  creates a placeholder sprite (a copy of tile.grass.a, or a blank 16x16
         for overlays/decorations) for every sprite id that doesn't exist yet,
         so new terrain renders right away and can be drawn in the Sprite Workshop.
--check  validates and prints what would change, without writing anything.
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
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FLAGS = {a for a in sys.argv[1:] if a.startswith("--")}
SHEET = ARGS[0] if ARGS else os.path.join(ROOT, "design", "Undergrowth_Terrain_Table.xlsx")
OUT = os.path.join(ROOT, "Resources", "Content", "tileRules.json")
SPRITES = os.path.join(ROOT, "Resources", "Sprites")

STATS = ["damp", "glow", "bloom", "verdure", "stone", "depth"]
KEYS = set(STATS) | {"share_" + s for s in STATS} | {"elev", "glowVis", "bloomVis", "total"}
COND = re.compile(r"^\s*([A-Za-z_]+)\s*(>=|<=|≥|≤|>|<)\s*(-?[0-9.]+)\s*(%?)\s*$")

problems = []


def num(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    f = float(str(v).strip().rstrip("%")) / (100 if str(v).strip().endswith("%") else 1)
    return int(f) if f == int(f) else round(f, 4)


def add(bounds, key, op, val):
    b = bounds.setdefault(key, {})
    b["min" if op in (">=", "≥", ">") else "max"] = val


def parse_conditions(text, where):
    """'share_depth <= 30%; stone <= 40' -> {key: {min/max}}"""
    out = {}
    for part in re.split(r"[;\n]", text or ""):
        if not part.strip():
            continue
        m = COND.match(part)
        if not m or m.group(1) not in KEYS:
            problems.append("%s: can't read condition %r" % (where, part.strip()))
            continue
        key, op, val, pct = m.groups()
        val = float(val) / (100 if pct else 1)
        add(out, key, op, int(val) if val == int(val) else round(val, 4))
    return out


def read_sheet(wb, name):
    ws = wb[name]
    head = [str(c.value).strip() if c.value is not None else "" for c in ws[4]]
    rows = []
    for i, row in enumerate(ws.iter_rows(min_row=5, values_only=True), start=5):
        rec = dict(zip(head, row))
        if not any(v not in (None, "") for v in row):
            continue
        rec["_where"] = "%s row %d" % (name, i)
        rows.append(rec)
    return rows


def conditions(rec):
    where = rec["_where"]
    when = {}
    for s in STATS:
        v = num(rec.get(s.title() + " ≥"))
        if v is not None:
            add(when, s, ">=", v)
    main, share = (rec.get("Main stat") or "").strip().lower(), num(rec.get("Main share ≥"))
    if main or share is not None:
        if main not in STATS or share is None:
            problems.append("%s: Main stat and Main share need to be filled in together" % where)
        else:
            add(when, "share_" + main, ">=", share if share <= 1 else share / 100)
    for col, op in (("Elevation ≥", ">="), ("Elevation ≤", "<=")):
        v = num(rec.get(col))
        if v is not None:
            add(when, "elev", op, v)
    for k, b in parse_conditions(rec.get("Other conditions"), where).items():
        when.setdefault(k, {}).update(b)
    anys = []
    for grp in re.split(r"\s+OR\s+", rec.get("Any of") or "", flags=re.I):
        if grp.strip():
            anys.append(parse_conditions(grp, where))
    return when, anys


def sprites(rec, where):
    ids = [s.strip() for s in re.split(r"[,\n]", rec.get("Sprites") or "") if s.strip()]
    if not ids:
        problems.append("%s: no sprites" % where)
    return ids


def rule(rec, layer, **extra):
    when, anys = conditions(rec)
    rid = (rec.get("Rule ID") or "").strip()
    if not rid:
        problems.append("%s: missing Rule ID" % rec["_where"])
    r = {"id": rid, "layer": layer}
    r.update(extra)
    r["when"] = when
    r["sprites"] = sprites(rec, rec["_where"])
    if anys:
        r["any"] = anys
    return r


def live(rec):
    return str(rec.get("Status") or "").strip().lower() == "in game"


def main():
    wb = openpyxl.load_workbook(SHEET, data_only=True)
    out = []
    for rec in filter(live, read_sheet(wb, "Ground Tiles")):
        r = rule(rec, "ground", priority=num(rec.get("Priority")) or 0)
        if str(rec.get("Hide overlays") or "").strip().lower() in ("yes", "y", "true"):
            r["suppressOverlays"] = True
        out.append(r)
    out.sort(key=lambda r: -r["priority"])  # stable: equal priorities keep sheet order
    for rec in filter(live, read_sheet(wb, "Overlays")):
        grp = (rec.get("Group") or "").strip() or None
        r = rule(rec, "overlay", group=grp, priority=num(rec.get("Level")) or 0)
        if not grp:
            del r["group"]
        out.append(r)
    for rec in filter(live, read_sheet(wb, "Decorations")):
        dens = num(rec.get("Density"))
        if dens is not None and not 0 <= dens <= 1:
            problems.append("%s: Density must be between 0 and 1" % rec["_where"])
        out.append(rule(rec, "decoration", priority=num(rec.get("Priority")) or 0, density=1 if dens is None else dens))
    for rec in filter(live, read_sheet(wb, "Tints")):
        col = str(rec.get("Colour") or "").strip()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", col):
            problems.append("%s: Colour should look like #243a52" % rec["_where"])
        out.append({"id": rec.get("Rule ID"), "layer": "tint", "stat": (rec.get("Stat") or "").strip(), "color": col.lower(),
                    "strength": num(rec.get("Strength")) or 0})

    ids = [r["id"] for r in out]
    for d in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append("Rule ID %r is used more than once" % d)
    pris = [r["priority"] for r in out if r["layer"] == "ground"]
    for p in sorted({p for p in pris if pris.count(p) > 1}):
        problems.append("Two ground tiles share priority %s; give one a different number" % p)

    have = set()
    folder = {}
    for d, _, fs in os.walk(SPRITES):
        for f in fs:
            if f.endswith(".json"):
                have.add(f[:-5])
    missing = []
    for r in out:
        for s in r.get("sprites", []):
            if s not in have and s not in missing:
                missing.append(s)
                folder[s] = r["layer"]

    if problems:
        print("Fix these in the sheet, then run again:")
        for p in problems:
            print("  - " + p)
        sys.exit(1)

    old = json.load(open(OUT)) if os.path.exists(OUT) else []
    old_ids, new_ids = {r["id"] for r in old}, set(ids)
    print("Ground %d, overlays %d, decorations %d, tints %d" % tuple(sum(r["layer"] == l for r in out) for l in ("ground", "overlay", "decoration", "tint")))
    if new_ids - old_ids:
        print("Added:   " + ", ".join(sorted(new_ids - old_ids)))
    if old_ids - new_ids:
        print("Removed: " + ", ".join(sorted(old_ids - new_ids)))
    changed = sorted(r["id"] for r in out for o in old if o["id"] == r["id"] and o != r)
    if changed:
        print("Changed: " + ", ".join(changed))
    if missing:
        print("Sprites that don't exist yet: " + ", ".join(missing) + ("" if "--stubs" in FLAGS else "  (add --stubs to create placeholders)"))

    if "--check" in FLAGS:
        print("Check only: nothing written.")
        return
    if "--stubs" in FLAGS:
        grass = json.load(open(os.path.join(SPRITES, "tile", "tile.grass.a.json")))
        for s in missing:
            sub = s.split(".")[0]
            if folder[s] == "ground" or sub == "tile":
                data = dict(grass, id=s, frames=[{"rows": list(grass["frames"][0]["rows"])}])
            else:
                data = {"id": s, "size": [16, 16], "anchor": [8, 15], "palette": ["transparent", "#ff00ff"],
                        "frames": [{"rows": ["." * 16] * 7 + ["......1111......"] * 2 + ["." * 16] * 7}], "tags": [folder[s]]}
            os.makedirs(os.path.join(SPRITES, sub), exist_ok=True)
            with open(os.path.join(SPRITES, sub, s + ".json"), "w") as fh:
                json.dump(data, fh, indent=1)
                fh.write("\n")
            print("  created placeholder Resources/Sprites/%s/%s.json" % (sub, s))
    with open(OUT, "w") as fh:  # one rule per line, like the hand-kept file
        fh.write("[\n" + ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in out) + "\n]\n")
    print("Wrote " + os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
