#!/usr/bin/env python3
"""Imports design/Undergrowth_Spawn_Table.xlsx into the game's content files.

    pip install openpyxl
    python3 tools/import_spawn_table.py [path/to/Spawn_Table.xlsx]
    python3 tools/gen_placeholders.py      # (re)generate art for any new entries

Writes Resources/Content/{creatures,items,loot}.json. Edit the spreadsheet (the
blue cells), re-run this, and both the web and iOS versions pick up the change.

- Creature special effects are free text in the sheet; their game rules live in
  design/creature_effects.json (merged in here, keyed by creature name).
- Gem/material effects ("Crush into soil: +5 Stone on a tile for 24h") are parsed
  from the text.
- Extra conditions recognised: "Night only", "Daytime only", "during rain",
  "only one per forest" / "only one ... at a time", "Planted during the day",
  "Planted at night", "Checked once per day". Notes like "Melts ... if left
  unpicked for a day" set a 24h lifetime. Other text is kept as flavour.
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
SHEET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "design", "Undergrowth_Spawn_Table.xlsx")
CONTENT = os.path.join(ROOT, "Resources", "Content")
EFFECTS = os.path.join(ROOT, "design", "creature_effects.json")

STATS = ["damp", "glow", "bloom", "verdure", "stone", "depth"]
RARITY = {"common": "common", "uncommon": "uncommon", "rare": "rare", "very rare": "veryRare", "legendary": "legendary"}
# Default spawn scaling (% per point above the minimum) by rarity, used when the sheet leaves it blank.
RARITY_RATE = {"common": 1, "uncommon": 1.5, "rare": 2, "veryRare": 2.5, "legendary": 3}
FAMILY = {"Fungling": "fungling", "Sproutling": "sproutling", "Geode Critter": "geodeCritter", "Wanderer": "wanderer"}
CATEGORY = {"Mushroom": "mushroom", "Plant": "plant", "Seed": "seed", "Geode": "geode", "Gem": "gem", "Material": "material"}


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "")).strip("-")


def item_id(category, name):
    return "%s.%s" % (category, slug(name))


def requires(row):
    req = {}
    for stat, v in zip(STATS, row[5:11]):
        if v:
            req[stat] = {"min": float(v) if v != int(v) else int(v)}
    return req


def extra_flags(text):
    t = (text or "").lower()
    out = {}
    if "night only" in t:
        out["time"] = "night"
    if "daytime only" in t:
        out["time"] = "day"
    if "during rain" in t:
        out["rain"] = True
    if "only one" in t:
        out["oneAtATime"] = True
    if "planted during the day" in t:
        out["plantedTime"] = "day"
    if "planted at night" in t:
        out["plantedTime"] = "night"
    if "checked once per day" in t:
        out["daily"] = True
    if "shallow water only" in t:
        out["terrain"] = "pool"
    return out


def parse_use(text):
    """'Crush into soil: +5 Stone on a tile for 24h' → a soil-boost use."""
    if not text:
        return None
    t = text.strip()
    if "next creature found is a glimmer" in t.lower():
        return {"type": "nextGlimmer", "verb": "Use", "text": t}
    m = re.match(r"(?i)\s*(crush into soil|set into a tile)\s*:\s*(.*)$", t)
    if not m:
        return {"type": "none", "text": t}
    verb, rest = m.group(1).capitalize(), m.group(2)
    stats = {}
    if re.search(r"all six stats", rest, re.I):
        n = int(re.search(r"\+(\d+)", rest).group(1))
        stats = {s: n for s in STATS}
    for n, stat in re.findall(r"\+(\d+)\s+([A-Za-z]+)", rest):
        if stat.lower() in STATS:
            stats[stat.lower()] = int(n)
    use = {"type": "soilBoost", "verb": verb, "stats": stats, "text": t}
    hrs = re.search(r"for\s+(\d+)\s*h", rest, re.I)
    if "permanent" in rest.lower():
        use["permanent"] = True
    elif hrs:
        use["hours"] = int(hrs.group(1))
    return use


def main():
    wb = openpyxl.load_workbook(SHEET, data_only=True)
    ws = wb.worksheets[0]
    rows = [r for r in ws.iter_rows(values_only=True)]
    header = next(i for i, r in enumerate(rows) if r[0] == "Name")
    # Optional spawn-scaling columns ("Damp scaling %/pt" ... "Depth scaling %/pt").
    scale_cols = {}
    for ci, title in enumerate(rows[header]):
        if isinstance(title, str) and "scaling" in title.lower():
            stat = title.split()[0].lower()
            if stat in STATS:
                scale_cols[stat] = ci
    # Optional placement column ("Placement": surface / buried / auto); blank = auto.
    place_col = next((ci for ci, title in enumerate(rows[header]) if isinstance(title, str) and title.strip().lower().startswith("placement")), None)
    loot_start = next(i for i, r in enumerate(rows) if r[0] and str(r[0]).startswith("Geode loot table"))
    entries = [r for r in rows[header + 1:loot_start] if r[0]]

    effects = {}
    if os.path.exists(EFFECTS):
        effects = {k: v for k, v in json.load(open(EFFECTS)).items() if not k.startswith("_")}

    # Name → id for every non-creature entry (for resolving "Inside a X" sources).
    name_to_id = {}
    for r in entries:
        if r[1] != "Creature":
            name_to_id[r[0].lower()] = item_id(CATEGORY[r[1]], r[0])

    items, creatures, loot = [], [], {}
    seed_id = None
    for r in entries:
        name, cat, family, rarity, how = r[0], r[1], r[2], RARITY[str(r[3]).lower()], r[4] or ""
        weight, chance, extra = r[11], r[12], r[13]
        s1, b1, s2, b2, radius, ramp, special, notes = r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21]
        if cat == "Creature":
            fam = FAMILY[family]
            cid = slug(name)
            c = {
                "id": cid, "name": name, "family": fam, "familyName": family, "rarity": rarity,
                "sprite": "creature." + cid, "glimmerSprite": "creature." + cid + ".glimmer",
                "stats": [s1.lower(), s2.lower()],
                "bonuses": {s1.lower(): b1, s2.lower(): b2},
                "radius": radius, "rampHours": ramp, "chance": chance,
                "requires": requires(r),
            }
            flags = extra_flags(extra)
            if fam == "wanderer":
                c["source"] = {"kind": "wanderer"}
            elif how.lower().startswith("inside"):
                names = re.sub(r"(?i)^inside an? ", "", how).split(" or ")
                c["source"] = {"kind": "mushroom", "items": [name_to_id[n.strip().lower()] for n in names]}
            elif how.lower().startswith("cracked from"):
                n = re.sub(r"(?i)^cracked from an? ", "", how).strip()
                c["source"] = {"kind": "geode", "items": [name_to_id[n.lower()]]}
            elif "seed" in how.lower():
                c["source"] = {"kind": "seed"}
            else:
                raise SystemExit("Unrecognised creature source for %s: %r" % (name, how))
            if "plantedTime" in flags:
                c["plantedTime"] = flags["plantedTime"]
            if flags.get("oneAtATime"):
                c["unique"] = True
            c["howFound"] = how
            if special:
                c["special"] = special
            fx = effects.get(name, {})
            if fx.get("effects"):
                c["effects"] = fx["effects"]
            if fx.get("extraContributions"):
                c["extraContributions"] = fx["extraContributions"]
            if fx.get("notYet"):
                c["notYet"] = fx["notYet"]
            if special and name not in effects:
                c["notYet"] = special
            creatures.append(c)
            continue

        category = CATEGORY[cat]
        iid = item_id(category, name)
        it = {"id": iid, "category": category, "name": name, "rarity": rarity, "sprite": "item." + iid}
        flags = extra_flags(extra)
        if notes and "only one" in notes.lower():
            flags["oneAtATime"] = True
        if weight is not None:
            spawn = {"baseWeight": weight, "requires": requires(r)}
            # % change in spawn weight per point a tile stat sits above this item's minimum.
            scaling = {}
            for stat, ci in scale_cols.items():
                v = r[ci] if ci < len(r) else None
                if isinstance(v, (int, float)) and v != 0:
                    scaling[stat] = v
            if not scale_cols or all((r[ci] if ci < len(r) else None) is None for ci in scale_cols.values()):
                rate = RARITY_RATE[rarity]
                scaling = {stat: rate for stat in spawn["requires"]}
            if scaling:
                spawn["statScaling"] = scaling
            for k in ("time", "rain", "oneAtATime", "terrain"):
                if k in flags:
                    spawn[k] = flags[k]
            if notes and "grows in clusters" in notes.lower():
                spawn["cluster"] = True
            if flags.get("terrain"):
                it["flipInWorld"] = True       # vary orientation where it grows
            pv = r[place_col] if place_col is not None and place_col < len(r) else None
            spawn["placement"] = str(pv).strip().lower() if pv and str(pv).strip().lower() in ("surface", "buried", "auto") else "auto"
            if notes and re.search(r"unpicked for a day", notes, re.I):
                spawn["lifetimeHours"] = 24
            it["spawn"] = spawn
        if category == "mushroom":
            it["collectVerb"] = "Pick"
        elif category == "plant":
            it["collectVerb"] = "Pick"
            it["onCollect"] = "loot.plant." + slug(name)
            if rarity != "legendary":
                it["groups"] = ["plants"]
            # Grown from a Mystery Seed: generic planted/sprout, then its own bud, then the plant itself.
            it["growthSprites"] = ["seed.stage.planted", "seed.stage.sprout", "plant.bud." + slug(name), it["sprite"]]
        elif category == "geode":
            it["collectVerb"] = "Dig"
            it["onCrack"] = "loot.crack." + slug(name)
            # Geode art: pixel crack stages (frames) in two patterns, and the opened geode.
            it["crackSprites"] = ["geode.crack.%s.a" % slug(name), "geode.crack.%s.b" % slug(name)]
            it["openSprite"] = "geode.open." + slug(name)
            # In the forest the geode sits half-buried in a dirt mound (bag/guide keep the plain ball).
            it["worldSprite"] = "geode.world." + slug(name)
        elif category == "seed":
            seed_id = iid
            it["onGrow"] = "loot.grow." + slug(name)
            it["growthSprites"] = ["seed.stage.planted", "seed.stage.sprout", "seed.stage.ready"]
            it["inGuide"] = False
        if category in ("gem", "material"):
            use = parse_use(special)
            if use and use["type"] != "none":
                it["use"] = use
            it["howFound"] = how
        flavour = [x for x in (extra, notes) if x]
        if flavour:
            it["guideText"] = ". ".join(str(x).rstrip(".") for x in flavour) + "."
        items.append(it)

    # Seed drop chance (from the Mystery Seed row) → plant pick tables.
    seed_row = next(r for r in entries if r[1] == "Seed")
    seed_chance = seed_row[12] or 0.25
    for it in items:
        if it["category"] == "plant":
            loot[it["onCollect"]] = {"rolls": [
                {"item": it["id"]},
                {"item": seed_id, "chance": seed_chance, "seedDrop": True},
            ]}
    loot["loot.grow." + seed_id.split(".", 1)[1]] = {"rolls": [{"group": "plants"}]}

    # Geode loot table.
    lt_header = rows[loot_start + 1]
    geode_cols = {i: name_to_id[str(h).lower()] for i, h in enumerate(lt_header) if i >= 2 and h}
    picks = {gid: [] for gid in geode_cols.values()}
    for r in rows[loot_start + 2:]:
        if not r[0] or str(r[0]).startswith("Total") or str(r[0]).startswith("Check"):
            continue
        rid = name_to_id[str(r[0]).lower()]
        for i, gid in geode_cols.items():
            if r[i]:
                picks[gid].append({"item": rid, "weight": r[i]})
    for gid, entries_ in picks.items():
        total = sum(e["weight"] for e in entries_)
        if abs(total - 1) > 0.001:
            print("warning: %s loot column totals %.3f, not 100%%" % (gid, total))
        loot["loot.crack." + gid.split(".", 1)[1]] = {"rolls": [
            {"pick": entries_, "rarityPity": "rareGem", "rarityPityMin": "rare"},
        ]}

    def dump(name, data):
        path = os.path.join(CONTENT, name)
        with open(path, "w") as fh:
            if isinstance(data, list):
                fh.write("[\n" + ",\n".join("  " + json.dumps(x) for x in data) + "\n]\n")
            else:
                fh.write("{\n" + ",\n".join("  %s: %s" % (json.dumps(k), json.dumps(v)) for k, v in data.items()) + "\n}\n")

    dump("creatures.json", creatures)
    dump("items.json", items)
    dump("loot.json", loot)
    print("imported %d creatures, %d items, %d loot tables from %s" % (len(creatures), len(items), len(loot), os.path.basename(SHEET)))


if __name__ == "__main__":
    main()
