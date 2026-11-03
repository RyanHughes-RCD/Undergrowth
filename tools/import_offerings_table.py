#!/usr/bin/env python3
"""Imports design/Undergrowth_Offerings.xlsx into the game content.

    python3 tools/import_offerings_table.py           # writes requests.json and cosmetics.json (only if changed)
    python3 tools/import_offerings_table.py --check   # preview only: validates and lists what would change
    python3 tools/import_offerings_table.py --stubs   # also writes placeholder sprites for new decor sprite ids

Sheets: Requests (one row per Store listing or Old Log request), Cosmetics (placeable decor) and How to use.
Only rows whose Status is "In game" are exported. Blue cells on yellow are the editable ones; each row's
Check column flags unknown item ids, decor and missing sprites. Importing the unedited spreadsheet
reproduces the JSON exactly, and the workbook is only re-saved when its Lists sheet or Check formulas
need refreshing, so a re-run changes nothing.
"""
import json
import os
import sys

import openpyxl
from openpyxl.styles import Alignment, Font

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "design", "Undergrowth_Offerings.xlsx")
CONTENT = os.path.join(ROOT, "Resources", "Content")
SPRITES = os.path.join(ROOT, "Resources", "Sprites")

REQ_HEADERS = ["Status", "ID", "Name", "Kind", "Coins", "Item 1", "Count 1", "Item 2", "Count 2", "Item 3", "Count 3", "Item 4", "Count 4",
               "Reward type", "Reward id", "Reward count", "Needs Field Guide entries", "Needs request done", "Needs beauty tier",
               "Needs garden day", "Text", "Art notes", "Check"]
COS_HEADERS = ["Status", "ID", "Name", "Sprite", "Size", "Kind", "Colours", "Text", "Art notes", "Check"]
UNLOCKS = ["expansion"]
# shop: bought with coins, again and again. upgrade: bought once, in a chain (Room to grow).
# commission: a one-off request at the Old Log. order: the pool of small daily orders at the Old Log.
KINDS = ["shop", "upgrade", "commission", "order"]
REWARDS = ["cosmetic", "unlock", "item", "coins"]
DECOR_KINDS = ["path", "fence", "bed", "planter", "lantern", "bench", "ornament", "feature"]


def L(i):
    return openpyxl.utils.get_column_letter(i)


# ------------------------------------------------------------------ check formulas

def request_check_formula(r):
    parts = []
    for col in ("F", "H", "J", "L"):
        parts.append(f'IF(AND({col}{r}<>"",COUNTIF(Lists!$A:$A,{col}{r})=0),"Unknown item "&{col}{r}&". ","")')
    for col, cnt in (("F", "G"), ("H", "I"), ("J", "K"), ("L", "M")):
        parts.append(f'IF(AND({col}{r}<>"",N({cnt}{r})<1),"{cnt}{r} needs a count. ","")')
    parts.append(f'IF(AND(F{r}="",N(E{r})<1),"Needs coins or items. ","")')
    parts.append(f'IF(N{r}="cosmetic",IF(COUNTIF(Cosmetics!$B:$B,O{r})=0,"Unknown decor "&O{r}&". ",""),"")')
    parts.append(f'IF(N{r}="unlock",IF(COUNTIF(Lists!$D:$D,O{r})=0,"Unknown unlock "&O{r}&". ",""),"")')
    parts.append(f'IF(N{r}="item",IF(COUNTIF(Lists!$A:$A,O{r})=0,"Unknown item "&O{r}&". ",""),"")')
    parts.append(f'IF(AND(R{r}<>"",COUNTIF($B:$B,R{r})=0),"Unknown request "&R{r}&". ","")')
    parts.append(f'IF(COUNTIF($B:$B,B{r})>1,"Duplicate id. ","")')
    s = "&".join(parts)
    return f'=IF(OR(B{r}="",A{r}="Off"),"",IF({s}="","OK",{s}))'


def cosmetic_check_formula(r):
    kinds = ",".join(f'F{r}="{k}"' for k in DECOR_KINDS)
    return (f'=IF(OR(B{r}="",A{r}="Off"),"",IF(COUNTIF(Lists!$C:$C,D{r})=0,"Missing sprite "&D{r}&" (import with --stubs)",'
            f'IF(NOT(OR({kinds})),"Unknown kind "&F{r},IF(COUNTIF($B:$B,B{r})>1,"Duplicate id","OK"))))')


# ------------------------------------------------------------------ helpers

def load(name):
    p = os.path.join(CONTENT, name)
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)


def sprite_ids():
    out = set()
    for dp, _, files in os.walk(SPRITES):
        if os.path.basename(dp) == "Palettes":
            continue
        out.update(f[:-5] for f in files if f.endswith(".json"))
    return out


def num(v):
    if v is None or v == "":
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def text(v):
    return str(v).strip() if v is not None and str(v).strip() != "" else None


def rows(ws, ncols):
    for r in range(5, ws.max_row + 1):
        vals = [ws.cell(r, c).value for c in range(1, ncols + 1)]
        if text(vals[1]):
            yield r, vals


def parse_colours(v):
    out = []
    for part in (text(v) or "").split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.rsplit(" ", 1)
        if len(bits) != 2 or not bits[1].startswith("#") or len(bits[1]) != 7:
            raise ValueError(f"colour {part!r} should look like 'Oak #8a5a36'")
        out.append({"name": bits[0].strip(), "color": bits[1].lower()})
    return out


# ------------------------------------------------------------------ read

def garden_item_ids():
    """Seed packets (packet.<plant id>, from plants.json) and soil amendments (amendments.json): Bag items
    the game builds from their own files, which listings may give or ask for too."""
    plants = load("plants.json") or []
    out = ["packet." + p["id"] for p in plants] + [a["id"] for a in load("amendments.json") or []]
    # Colour varieties: their seed packets (packet.<variety id>) and produce (<plant's item>.<variety>).
    for p in plants:
        for v in p.get("varieties", []):
            out += ["packet." + v["id"], p["item"] + "." + v["id"].split(".", 1)[1]]
    return out


def read(wb, errors):
    items = {i["id"] for i in load("items.json")} | set(garden_item_ids())
    cosmetics = []
    for r, v in rows(wb["Cosmetics"], len(COS_HEADERS)):
        if text(v[0]) != "In game":
            continue
        size = (text(v[4]) or "1x1").lower().split("x")
        c = {"id": text(v[1]), "name": text(v[2]), "sprite": text(v[3]), "size": [int(size[0]), int(size[1])], "kind": text(v[5]) or "feature"}
        if c["kind"] not in DECOR_KINDS:
            errors.append(f"Cosmetics row {r}: kind must be one of {', '.join(DECOR_KINDS)}")
        try:
            cols = parse_colours(v[6])
        except ValueError as e:
            errors.append(f"Cosmetics row {r}: {e}")
            cols = []
        if cols:
            c["colors"] = cols
        if text(v[7]):
            c["text"] = text(v[7])
        cosmetics.append(c)
    cos_ids = {c["id"] for c in cosmetics}

    requests = []
    all_ids = [text(v[1]) for _, v in rows(wb["Requests"], len(REQ_HEADERS))]
    for r, v in rows(wb["Requests"], len(REQ_HEADERS)):
        if text(v[0]) != "In game":
            continue
        rid, kind = text(v[1]), text(v[3])
        if kind not in KINDS:
            errors.append(f"Requests row {r} ({rid}): kind must be one of {', '.join(KINDS)}")
        coins = num(v[4]) or 0
        its = []
        for k in range(4):
            iid, cnt = text(v[5 + 2 * k]), num(v[6 + 2 * k])
            if not iid:
                continue
            if iid not in items:
                errors.append(f"Requests row {r} ({rid}): unknown item {iid!r}")
            if not cnt or cnt < 1:
                errors.append(f"Requests row {r} ({rid}): {iid} needs a count of at least 1")
            its.append({"item": iid, "count": cnt})
        if not its and coins < 1:
            errors.append(f"Requests row {r} ({rid}): needs coins or at least one item")
        rtype, rref, rcount = text(v[13]), text(v[14]), num(v[15]) or 1
        if rtype not in REWARDS:
            errors.append(f"Requests row {r} ({rid}): reward type must be one of {', '.join(REWARDS)}")
        if rtype == "cosmetic" and rref not in cos_ids:
            errors.append(f"Requests row {r} ({rid}): unknown decor {rref!r} (or its Cosmetics row isn't 'In game')")
        if rtype == "unlock" and rref not in UNLOCKS:
            errors.append(f"Requests row {r} ({rid}): unlock must be one of {', '.join(UNLOCKS)}")
        if rtype == "item" and rref not in items:
            errors.append(f"Requests row {r} ({rid}): unknown item {rref!r}")
        reward = {"type": rtype}
        if rref and rtype != "coins":
            reward["id"] = rref
        reward["count"] = rcount
        req = {}
        if num(v[16]) is not None:
            req["guide"] = num(v[16])
        if text(v[17]):
            if text(v[17]) not in all_ids:
                errors.append(f"Requests row {r} ({rid}): unknown request {text(v[17])!r}")
            req["request"] = text(v[17])
        if num(v[18]) is not None:
            req["beauty"] = num(v[18])
        if num(v[19]) is not None:
            req["day"] = num(v[19])
        out = {"id": rid, "name": text(v[2]), "kind": kind}
        if coins:
            out["coins"] = coins
        out["items"] = its
        out["reward"] = reward
        if req:
            out["requires"] = req
        if text(v[20]):
            out["text"] = text(v[20])
        requests.append(out)
    if len({x["id"] for x in requests}) != len(requests):
        errors.append("Requests: duplicate ids")
    return requests, cosmetics


# ------------------------------------------------------------------ sheet upkeep

def refresh_lists(wb):
    """Rebuilds the Lists sheet (valid ids for the Check formulas) and every row's Check formula.
    Returns True if anything in the workbook changed."""
    items = load("items.json")
    cols = [("Item ids", [i["id"] for i in items] + garden_item_ids()), ("Item names", [i["name"] for i in items]),
            ("Sprite ids", sorted(sprite_ids())), ("Unlock ids", UNLOCKS)]
    changed = False
    for name, ncol, fn in (("Requests", len(REQ_HEADERS), request_check_formula), ("Cosmetics", len(COS_HEADERS), cosmetic_check_formula)):
        for r, _ in rows(wb[name], ncol):
            f = fn(r)
            if wb[name].cell(r, ncol).value != f:
                wb[name].cell(r, ncol).value = f
                changed = True
    want = [[h] + list(v) for h, v in cols]
    old = wb["Lists"] if "Lists" in wb.sheetnames else None
    if old is not None:
        have = [[old.cell(r, c).value for r in range(1, old.max_row + 1)] for c in range(1, old.max_column + 1)]
        have = [[x for x in col if x is not None] for col in have]
        if have == want and not changed:
            return False
        del wb["Lists"]
    ws = wb.create_sheet("Lists")
    for c, col in enumerate(want, start=1):
        for r, v in enumerate(col, start=1):
            ws.cell(r, c, v).font = Font(name="Arial", bold=True) if r == 1 else Font(name="Arial", size=9)
        ws.column_dimensions[L(c)].width = 30
    return True


HOW_TO = [
    ("What this is", "The Store's listings and the Old Log's requests (what they ask for and what they give), and the decor props."),
    ("Edit", "Blue text on yellow cells. Add a row to add a listing or prop; set Status to 'Off' to take one out without deleting it, or 'Idea' for drafts."),
    ("Requests", "Kind: shop (bought with coins, again and again), upgrade (bought once, chained with 'Needs request done': Room to grow), commission (a one-off request "
                 "at the Old Log) or order (the pool of daily orders at the Old Log). Coins: the price, if any. Up to four items (ids from the Lists sheet, seed "
                 "packets and amendments included) with counts. Reward type: cosmetic (a prop id from Cosmetics), item (an item id), unlock (expansion) or coins "
                 "(Reward count = how many). Gating: a Field Guide count, another request done first, a beauty tier (0-5) and/or a garden day."),
    ("Cosmetics", "Placeable decor. Sprite: a sprite id (new ones get placeholders with --stubs). Kind: path, fence, bed, planter, lantern, bench, ornament or feature "
                  "(what it does is in tuning.json garden.decor). Colours: 'Name #hex' pairs; the first is the natural colour."),
    ("Check column", "Formulas: OK, or what's wrong (unknown item, decor, unlock or request id, missing count, missing sprite, duplicate id)."),
    ("Import", "python3 tools/import_offerings_table.py (add --check to preview, --stubs for placeholder sprites). It rewrites Resources/Content/requests.json and cosmetics.json, then python3 tools/build_web.py bundles them."),
]


def write_how_to(ws):
    """Rewrites the How to use sheet's text. Returns True if it changed."""
    want = [("Undergrowth: Offerings", None), (None, None)] + HOW_TO
    have = [(ws.cell(r, 1).value, ws.cell(r, 2).value) for r in range(1, max(ws.max_row, len(want)) + 1)]
    if have[:len(want)] == want and all(a is None and b is None for a, b in have[len(want):]):
        return False
    for r in range(1, ws.max_row + 1):
        ws.cell(r, 1).value = None
        ws.cell(r, 2).value = None
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 110
    ws["A1"] = "Undergrowth: Offerings"
    ws["A1"].font = Font(name="Arial", size=14, bold=True)
    for i, (a, b) in enumerate(HOW_TO, start=3):
        ws.cell(i, 1, a).font = Font(name="Arial", bold=True)
        c = ws.cell(i, 2, b)
        c.font = Font(name="Arial")
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(i, 1).alignment = Alignment(vertical="top")
    return True


def write_stubs(cosmetics):
    have = sprite_ids()
    made = []
    for x in cosmetics:
        sid = x.get("sprite")
        if not sid or sid in have:
            continue
        rows_ = ["................"] * 3 + ["...1111111111..."] + ["...1233333321..."] * 8 + ["...1222222221..."] + ["...1111111111..."] + ["................"] * 2
        data = {"id": sid, "size": [16, 16], "anchor": [8, 15], "palette": ["transparent", "#1b1420", "#5a3a22", "#b07a48"],
                "frames": [{"rows": rows_}], "tags": ["placeholder"]}
        folder = os.path.join(SPRITES, sid.split(".")[0])
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, sid + ".json"), "w") as f:
            json.dump(data, f, indent=1)
            f.write("\n")
        made.append(sid)
    return made


def main(argv):
    check = "--check" in argv
    stubs = "--stubs" in argv
    wb = openpyxl.load_workbook(SHEET)
    errors = []
    requests, cosmetics = read(wb, errors)
    if stubs and not check:
        made = write_stubs(cosmetics)
        if made:
            print("placeholder sprites:", ", ".join(made))
    have = sprite_ids()
    for x in cosmetics:
        if x.get("sprite") and x["sprite"] not in have:
            errors.append(f"{x['id']}: sprite {x['sprite']} doesn't exist (run with --stubs for a placeholder)")
    if errors:
        print("Problems:")
        for e in errors:
            print("  -", e)
        return 1
    for name, data in (("requests.json", requests), ("cosmetics.json", cosmetics)):
        path = os.path.join(CONTENT, name)
        new = "[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in data) + "\n]\n"
        old = open(path).read() if os.path.exists(path) else None
        state = "unchanged" if old == new else ("new" if old is None else "changed")
        print(f"{name}: {len(data)} entries, {state}")
        if not check and old != new:
            with open(path, "w") as f:
                f.write(new)
    if not check:
        how = write_how_to(wb["How to use"]) if "How to use" in wb.sheetnames else False
        if refresh_lists(wb) or how:
            wb.save(SHEET)
            print("workbook: Lists, Check formulas or How to use refreshed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
