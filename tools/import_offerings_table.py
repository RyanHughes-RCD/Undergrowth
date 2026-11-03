#!/usr/bin/env python3
"""Imports design/Undergrowth_Offerings.xlsx into the game content.

    python3 tools/import_offerings_table.py           # writes requests.json, cosmetics.json, eggs.json and schoolSeeds.json
    python3 tools/import_offerings_table.py --check   # preview only: validates and lists what would change
    python3 tools/import_offerings_table.py --stubs   # also writes placeholder sprites for new sprite ids

Sheets: Requests (one row per Old Log request), Cosmetics (placeable decor), Eggs and School Seeds (when
present) and How to use. Only rows whose Status is "In game" are exported. Blue cells on yellow are the editable
ones; each row's Check column flags unknown item ids, decor, unlocks, eggs and missing sprites.
Importing the unedited spreadsheet reproduces the JSON exactly. After importing, the Lists sheet
(valid ids for the Check formulas) is refreshed and the workbook saved.
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

REQ_HEADERS = ["Status", "ID", "Name", "Kind", "Item 1", "Count 1", "Item 2", "Count 2", "Item 3", "Count 3", "Item 4", "Count 4",
               "Reward type", "Reward id", "Reward count", "Needs Field Guide entries", "Needs request done", "Needs forest day",
               "Text", "Art notes", "Check"]
COS_HEADERS = ["Status", "ID", "Name", "Sprite", "Size", "Compost price", "Colours", "Text", "Art notes", "Check"]
EGG_HEADERS = ["Status", "ID", "Family", "Tier", "Name", "Sprite", "Hatch hours", "Foraging weight", "Text", "Check"]
SEED_HEADERS = ["Status", "ID", "Name", "School", "Sprite", "Marker sprite", "Text", "Check"]
SEED_SHEET = "School Seeds"
UNLOCKS = ["slot", "nest", "expansion", "trowel"]
KINDS = ["cosmetic", "unlock", "egg", "visitor", "shop", "upgrade"]
REWARDS = ["cosmetic", "unlock", "egg", "compost", "item", "upgrade"]
STATS = ["spore", "glow", "bloom", "verdure", "shimmer", "spirit"]
TUNING = os.path.join(ROOT, "Resources", "tuning.json")


def upgrade_ids():
    with open(TUNING) as f:
        return [k for k, v in json.load(f).get("upgrades", {}).items() if isinstance(v, dict)]
TIERS = ["common", "uncommon", "rare", "veryRare", "legendary"]


def L(i):
    return openpyxl.utils.get_column_letter(i)


# ------------------------------------------------------------------ check formulas (shared with the seed script)

def request_check_formula(r):
    parts = []
    for col in ("E", "G", "I", "K"):
        parts.append(f'IF(AND({col}{r}<>"",COUNTIF(Lists!$A:$A,{col}{r})=0),"Unknown item "&{col}{r}&". ","")')
    for col, cnt in (("E", "F"), ("G", "H"), ("I", "J"), ("K", "L")):
        parts.append(f'IF(AND({col}{r}<>"",N({cnt}{r})<1),"{cnt}{r} needs a count. ","")')
    parts.append(f'IF(M{r}="cosmetic",IF(COUNTIF(Cosmetics!$B:$B,N{r})=0,"Unknown decor "&N{r}&". ",""),"")')
    parts.append(f'IF(M{r}="unlock",IF(COUNTIF(Lists!$D:$D,N{r})=0,"Unknown unlock "&N{r}&". ",""),"")')
    parts.append(f'IF(M{r}="egg",IF(COUNTIF(Lists!$E:$E,N{r})=0,"Unknown egg "&N{r}&". ",""),"")')
    parts.append(f'IF(M{r}="upgrade",IF(COUNTIF(Lists!$G:$G,N{r})=0,"Unknown upgrade "&N{r}&". ",""),"")')
    parts.append(f'IF(M{r}="item",IF(COUNTIF(Lists!$A:$A,N{r})+COUNTIF(Lists!$E:$E,N{r})+COUNTIF(Lists!$H:$H,N{r})=0,"Unknown item "&N{r}&". ",""),"")')
    parts.append(f'IF(AND(Q{r}<>"",COUNTIF($B:$B,Q{r})=0),"Unknown request "&Q{r}&". ","")')
    parts.append(f'IF(COUNTIF($B:$B,B{r})>1,"Duplicate id. ","")')
    s = "&".join(parts)
    return f'=IF(OR(B{r}="",A{r}="Off"),"",IF({s}="","OK",{s}))'


def cosmetic_check_formula(r):
    return (f'=IF(OR(B{r}="",A{r}="Off"),"",IF(COUNTIF(Lists!$C:$C,D{r})=0,"Missing sprite "&D{r}&" (import with --stubs)",'
            f'IF(COUNTIF($B:$B,B{r})>1,"Duplicate id","OK")))')


def seed_check_formula(r):
    schools = ",".join(f'D{r}="{s}"' for s in STATS)
    return (f'=IF(OR(B{r}="",A{r}="Off"),"",IF(NOT(OR({schools})),"Unknown school "&D{r},'
            f'IF(COUNTIF(Lists!$C:$C,E{r})=0,"Missing sprite "&E{r}&" (import with --stubs)",'
            f'IF(COUNTIF(Lists!$C:$C,F{r})=0,"Missing sprite "&F{r}&" (import with --stubs)",'
            f'IF(COUNTIF($B:$B,B{r})>1,"Duplicate id","OK")))))')


def egg_check_formula(r):
    return (f'=IF(OR(B{r}="",A{r}="Off"),"",IF(COUNTIF(Lists!$C:$C,F{r})=0,"Missing sprite "&F{r}&" (import with --stubs)",'
            f'IF(COUNTIF(Lists!$F:$F,C{r})=0,"Unknown family "&C{r},IF(COUNTIF($B:$B,B{r})>1,"Duplicate id","OK"))))')


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
    r = 5
    while r <= ws.max_row:
        vals = [ws.cell(r, c).value for c in range(1, ncols + 1)]
        if text(vals[1]):
            yield r, vals
        r += 1


def dump_list(path, data):
    s = "[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in data) + "\n]\n"
    with open(path, "w") as f:
        f.write(s)
    return s


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

def read(wb, errors):
    items = {i["id"]: i for i in load("items.json")}
    families = {c["family"] for c in load("creatures.json")}

    eggs = []
    if "Eggs" in wb.sheetnames:
        for r, v in rows(wb["Eggs"], len(EGG_HEADERS)):
            if text(v[0]) != "In game":
                continue
            eid, fam, tier = text(v[1]), text(v[2]), text(v[3])
            if fam not in families:
                errors.append(f"Eggs row {r}: unknown family {fam!r}")
            if tier not in TIERS:
                errors.append(f"Eggs row {r}: tier must be one of {', '.join(TIERS)}")
            e = {"id": eid, "family": fam, "tier": tier, "name": text(v[4]), "sprite": text(v[5]),
                 "hatchHours": num(v[6]), "foragingWeight": num(v[7])}
            if text(v[8]):
                e["text"] = text(v[8])
            eggs.append(e)
    egg_ids = {e["id"] for e in eggs}

    # School seeds: one per garden school, buried from the Bag (numbers in tuning.json schoolSeeds).
    seeds = []
    if SEED_SHEET in wb.sheetnames:
        for r, v in rows(wb[SEED_SHEET], len(SEED_HEADERS)):
            if text(v[0]) != "In game":
                continue
            school = (text(v[3]) or "").lower()
            if school not in STATS:
                errors.append(f"{SEED_SHEET} row {r}: school must be one of {', '.join(STATS)} (got {text(v[3])!r})")
            sd = {"id": text(v[1]), "name": text(v[2]), "school": school, "sprite": text(v[4]), "marker": text(v[5])}
            if text(v[6]):
                sd["text"] = text(v[6])
            seeds.append(sd)
    seed_ids = {x["id"] for x in seeds}
    ups = set(upgrade_ids())

    cosmetics = []
    for r, v in rows(wb["Cosmetics"], len(COS_HEADERS)):
        if text(v[0]) != "In game":
            continue
        size = (text(v[4]) or "1x1").lower().split("x")
        c = {"id": text(v[1]), "name": text(v[2]), "sprite": text(v[3]), "size": [int(size[0]), int(size[1])]}
        if num(v[5]) is not None:
            c["compost"] = num(v[5])
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
        its = []
        for k in range(4):
            iid, cnt = text(v[4 + 2 * k]), num(v[5 + 2 * k])
            if not iid:
                continue
            if iid not in items:
                errors.append(f"Requests row {r} ({rid}): unknown item {iid!r}")
            if not cnt or cnt < 1:
                errors.append(f"Requests row {r} ({rid}): {iid} needs a count of at least 1")
            its.append({"item": iid, "count": cnt})
        if not its:
            errors.append(f"Requests row {r} ({rid}): needs at least one item")
        rtype, rref, rcount = text(v[12]), text(v[13]), num(v[14]) or 1
        if rtype not in REWARDS:
            errors.append(f"Requests row {r} ({rid}): reward type must be one of {', '.join(REWARDS)}")
        if rtype == "cosmetic" and rref not in cos_ids:
            errors.append(f"Requests row {r} ({rid}): unknown decor {rref!r} (or its Cosmetics row isn't 'In game')")
        if rtype == "unlock" and rref not in UNLOCKS:
            errors.append(f"Requests row {r} ({rid}): unlock must be one of {', '.join(UNLOCKS)}")
        if rtype == "egg" and rref not in egg_ids:
            errors.append(f"Requests row {r} ({rid}): unknown egg {rref!r}")
        if rtype == "upgrade" and rref not in ups:
            errors.append(f"Requests row {r} ({rid}): unknown upgrade {rref!r} (tuning.json upgrades)")
        if rtype == "item" and rref not in items and rref not in egg_ids and rref not in seed_ids:
            errors.append(f"Requests row {r} ({rid}): unknown item {rref!r}")
        reward = {"type": rtype}
        if rref:
            reward["id"] = rref
        reward["count"] = rcount
        req = {}
        if num(v[15]) is not None:
            req["guide"] = num(v[15])
        if text(v[16]):
            if text(v[16]) not in all_ids:
                errors.append(f"Requests row {r} ({rid}): unknown request {text(v[16])!r}")
            req["request"] = text(v[16])
        if num(v[17]) is not None:
            req["day"] = num(v[17])
        out = {"id": rid, "name": text(v[2]), "kind": kind, "items": its, "reward": reward}
        if req:
            out["requires"] = req
        if text(v[18]):
            out["text"] = text(v[18])
        requests.append(out)
    if len({x["id"] for x in requests}) != len(requests):
        errors.append("Requests: duplicate ids")
    return requests, cosmetics, eggs, seeds


# ------------------------------------------------------------------ sheet upkeep

def refresh_lists(wb):
    if "Lists" in wb.sheetnames:
        del wb["Lists"]
    ws = wb.create_sheet("Lists")
    items = load("items.json")
    eggs = load("eggs.json") or []
    if "Eggs" in wb.sheetnames:
        eggs_sheet = [text(v[1]) for _, v in rows(wb["Eggs"], len(EGG_HEADERS)) if text(v[0]) == "In game"]
    else:
        eggs_sheet = []
    families = sorted({c["family"] for c in load("creatures.json")})
    cols = [("Item ids", [i["id"] for i in items]), ("Item names", [i["name"] for i in items]),
            ("Sprite ids", sorted(sprite_ids())), ("Unlock ids", UNLOCKS),
            ("Egg ids", sorted(set(eggs_sheet) | {e["id"] for e in eggs})), ("Families", families),
            ("Upgrade ids", upgrade_ids()),
            ("School seed ids", [text(v[1]) for _, v in rows(wb[SEED_SHEET], len(SEED_HEADERS))] if SEED_SHEET in wb.sheetnames else [])]
    # Keep every row's Check formula current (new checks reach rows added before them).
    for name, ncol, fn in (("Requests", len(REQ_HEADERS), request_check_formula), ("Cosmetics", len(COS_HEADERS), cosmetic_check_formula),
                           ("Eggs", len(EGG_HEADERS), egg_check_formula), (SEED_SHEET, len(SEED_HEADERS), seed_check_formula)):
        if name in wb.sheetnames:
            for r, _ in rows(wb[name], ncol):
                wb[name].cell(r, ncol).value = fn(r)
    for c, (head, vals) in enumerate(cols, start=1):
        ws.cell(1, c, head).font = Font(name="Arial", bold=True)
        for r, v in enumerate(vals, start=2):
            ws.cell(r, c, v).font = Font(name="Arial", size=9)
        ws.column_dimensions[L(c)].width = 30
    ws.sheet_state = "visible"


def write_how_to(ws):
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 110
    ws["A1"] = "Undergrowth: Offerings"
    ws["A1"].font = Font(name="Arial", size=14, bold=True)
    lines = [
        ("What this is", "Everything players can earn at the Old Log: requests (what they ask for and what they give), decor props, and eggs."),
        ("Edit", "Blue text on yellow cells. Add a row to add a request, prop or egg; set Status to 'Off' to take one out without deleting it, or 'Idea' for drafts."),
        ("Requests", "Up to four items (item ids from the Lists sheet) with counts. Reward type: cosmetic (a prop id from Cosmetics), unlock (slot, nest, expansion, trowel), egg (an egg id) or compost (count = points). "
                     "Gating: a Field Guide count, another request done first, and/or a forest day. Mix items from different terrains so each request asks for two or three kinds of ground."),
        ("Cosmetics", "Placeable props with no effect on stats. Sprite: a sprite id (new ones get placeholders with --stubs). Compost price: blank if it only comes from a request. Colours: 'Name #hex' pairs; the first is the natural colour."),
        ("Eggs", "One row per family and tier: hatch time and how often foraged eggs come in that tier."),
        ("Check column", "Formulas: OK, or what's wrong (unknown item, decor, unlock, egg or request id, missing count, missing sprite, duplicate id)."),
        ("Import", "python3 tools/import_offerings_table.py (add --check to preview, --stubs for placeholder sprites). It rewrites Resources/Content/requests.json, cosmetics.json, eggs.json and schoolSeeds.json, then python3 tools/build_web.py bundles them."),
        ("Example", "Row 'mossy-bench': 3 Clover (plain ground), 2 Brown Button Cap (plain ground) and 2 Pebble Cap (Shimmer) give the Mossy bench prop."),
    ]
    for i, (a, b) in enumerate(lines, start=3):
        ws.cell(i, 1, a).font = Font(name="Arial", bold=True)
        c = ws.cell(i, 2, b)
        c.font = Font(name="Arial")
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(i, 1).alignment = Alignment(vertical="top")


def write_stubs(cosmetics, eggs):
    have = sprite_ids()
    made = []
    for x in cosmetics + eggs:
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
    requests, cosmetics, eggs, seeds = read(wb, errors)
    if stubs and not check:
        made = write_stubs(cosmetics, eggs + seeds)
        if made:
            print("placeholder sprites:", ", ".join(made))
    have = sprite_ids()
    for x in cosmetics + eggs + seeds:
        for key in ("sprite", "marker"):
            if x.get(key) and x[key] not in have:
                errors.append(f"{x['id']}: sprite {x[key]} doesn't exist (run with --stubs for a placeholder)")
    if errors:
        print("Problems:")
        for e in errors:
            print("  -", e)
        return 1
    outputs = [("requests.json", requests), ("cosmetics.json", cosmetics)]
    if "Eggs" in wb.sheetnames:
        outputs.append(("eggs.json", eggs))
    if SEED_SHEET in wb.sheetnames:
        outputs.append(("schoolSeeds.json", seeds))
    for name, data in outputs:
        path = os.path.join(CONTENT, name)
        new = "[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in data) + "\n]\n"
        old = open(path).read() if os.path.exists(path) else None
        state = "unchanged" if old == new else ("new" if old is None else "changed")
        print(f"{name}: {len(data)} entries, {state}")
        if not check and old != new:
            with open(path, "w") as f:
                f.write(new)
    if not check:
        refresh_lists(wb)
        wb.save(SHEET)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
