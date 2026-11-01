#!/usr/bin/env python3
"""Tile spawn workbook: every wild spawn by terrain type and intensity, editable in Excel.

    python3 tools/tile_spawns_workbook.py export   # writes design/Undergrowth_Tile_Spawns.xlsx from the game data
    python3 tools/tile_spawns_workbook.py import [path]   # applies an edited workbook back to the game data

Editable sheets (blue text on yellow) are Items, Terrains and Settings. The view sheets (Single
Stats, Pairs, Triples) are live formulas: each shows, for a tile where the listed stats sit at each
intensity level, the chance that a spawn there is each item. They follow the game's rules
(Game.spawnDetails / categoryDetails / terrainAt in web/js/core.js).

Import writes:
  Items    → design/Undergrowth_Spawn_Table.xlsx (rarity, spawn weight, stat minimums, scaling),
             then runs tools/import_spawn_table.py to rebuild Resources/Content.
  Terrains → tuning.json terrains (requirements, home finds, rules) and combos (requirements, meadow plants x).
  Settings → tuning.json (intensity bands, spawn scaling, category tilt, terrain affinity, …).
Preview inputs on Settings (time of day, rain, Bloom factor) only change the views; they're not imported.
"""
import json
import os
import re
import subprocess
import sys

import openpyxl
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "design", "Undergrowth_Tile_Spawns.xlsx")
MASTER = os.path.join(ROOT, "design", "Undergrowth_Spawn_Table.xlsx")
TUNING = os.path.join(ROOT, "Resources", "tuning.json")
CONTENT = os.path.join(ROOT, "Resources", "Content")

STATS = ["damp", "glow", "bloom", "verdure", "stone", "depth"]
CATS = ["mushroom", "plant", "geode"]
RARITIES = [("common", "Common"), ("uncommon", "Uncommon"), ("rare", "Rare"), ("veryRare", "Very rare"), ("legendary", "Legendary")]
RAR_LABEL = dict(RARITIES)
RAR_KEY = {v.lower(): k for k, v in RARITIES}
CAP = lambda s: s[0].upper() + s[1:]

FONT = "Arial"
F_BASE = Font(name=FONT, size=10)
F_INPUT = Font(name=FONT, size=10, color="0000FF")
F_BOLD = Font(name=FONT, size=10, bold=True)
F_HEAD = Font(name=FONT, size=10, bold=True, color="FFFFFF")
F_TITLE = Font(name=FONT, size=14, bold=True)
F_SUB = Font(name=FONT, size=9, italic=True, color="595959")
F_WORK = Font(name=FONT, size=8, color="808080")
FILL_IN = PatternFill("solid", fgColor="FFF9D6")
FILL_HEAD = PatternFill("solid", fgColor="2F5A26")
FILL_BLOCK = PatternFill("solid", fgColor="DCE9D5")
FILL_CAT = PatternFill("solid", fgColor="EFEFEF")
FILL_WORK = PatternFill("solid", fgColor="F7F7F7")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
PCT = '0.0%;-0.0%;"–"'
NUM = '0.00;-0.00;"–"'


# ------------------------------------------------------------------ data

def load_json(path):
    with open(path) as f:
        return json.load(f)


def load_items():
    raw = load_json(os.path.join(CONTENT, "items.json"))
    items = raw if isinstance(raw, list) else list(raw.values()) if not isinstance(raw, dict) or "items" not in raw else raw["items"]
    if isinstance(items, dict):
        items = list(items.values())
    return [it for it in items if it.get("spawn")]


def conditions(it):
    sp = it["spawn"]
    out = []
    if sp.get("time") in ("night", "day"):
        out.append(sp["time"] + " only")
    if sp.get("rain"):
        out.append("rain only")
    if sp.get("terrain") == "pool":
        out.append("pool only")
    if sp.get("oneAtATime"):
        out.append("one at a time")
    return ", ".join(out)


def needs(it):
    return {k: v.get("min", 0) for k, v in (it["spawn"].get("requires") or {}).items() if v.get("min", 0) > 0}


# ------------------------------------------------------------------ helpers

def style_range(ws, rng, font=None, fill=None, fmt=None, border=None, align=None):
    for row in ws[rng]:
        for c in row:
            if font: c.font = font
            if fill: c.fill = fill
            if fmt: c.number_format = fmt
            if border: c.border = border
            if align: c.alignment = align


def put(ws, ref, value, font=F_BASE, fill=None, fmt=None, align=None, border=None):
    c = ws[ref]
    c.value = value
    c.font = font
    if fill: c.fill = fill
    if fmt: c.number_format = fmt
    if align: c.alignment = align
    if border: c.border = border
    return c


def inp(ws, ref, value, fmt=None):
    return put(ws, ref, value, font=F_INPUT, fill=FILL_IN, fmt=fmt, border=BOX)


def header_row(ws, row, labels, col=1, widths=None):
    for i, lab in enumerate(labels):
        c = ws.cell(row, col + i, lab)
        c.font, c.fill, c.border = F_HEAD, FILL_HEAD, BOX
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    if widths:
        for i, w in enumerate(widths):
            ws.column_dimensions[L(col + i)].width = w


# ------------------------------------------------------------------ export

class Export:
    def __init__(self):
        self.t = load_json(TUNING)
        self.items = load_items()
        self.items.sort(key=lambda it: (CATS.index(it["category"]), [k for k, _ in RARITIES].index(it["rarity"]), it["name"]))
        self.by_id = {it["id"]: it for it in self.items}
        self.wb = openpyxl.Workbook()
        self.S = {}       # settings key -> absolute ref
        self.item_row = {}
        self.ter_row = {}

    def run(self):
        wb = self.wb
        self.readme = wb.active
        self.readme.title = "Read Me"
        self.settings()
        self.items_sheet()
        self.terrains_sheet()
        self.views()
        self.readme_sheet()
        wb.save(OUT)
        return OUT

    # ---- Settings
    def settings(self):
        ws = self.wb.create_sheet("Settings")
        t = self.t
        ws.column_dimensions["A"].width = 34
        ws.column_dimensions["B"].width = 12
        ws.column_dimensions["C"].width = 90
        put(ws, "A1", "Spawn settings", F_TITLE)
        put(ws, "A2", "Blue cells on yellow are editable and are imported into the game, except the Preview section, which only changes the view sheets.", F_SUB)
        r = 4

        def section(title):
            nonlocal r
            r += 1
            put(ws, f"A{r}", title, F_BOLD, fill=FILL_BLOCK)
            ws[f"B{r}"].fill = FILL_BLOCK
            ws[f"C{r}"].fill = FILL_BLOCK
            r += 1

        def row(key, label, value, note="", fmt=None, editable=True):
            nonlocal r
            put(ws, f"A{r}", label)
            if editable:
                inp(ws, f"B{r}", value, fmt)
            else:
                put(ws, f"B{r}", value, fmt=fmt, border=BOX)
            put(ws, f"C{r}", note, F_SUB)
            self.S[key] = f"Settings!$B${r}"
            r += 1

        section("Preview (view sheets only, not imported)")
        row("time", "Time of day", "Day", "Day or Night. Night-only / day-only finds and Glow's strength follow this.")
        dv = DataValidation(type="list", formula1='"Day,Night"', allow_blank=False); ws.add_data_validation(dv); dv.add(self.S["time"].split("!")[1].replace("$", ""))
        row("rain", "Raining", "No", "Yes or No. Rain-only finds need rain.")
        dv2 = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False); ws.add_data_validation(dv2); dv2.add(self.S["rain"].split("!")[1].replace("$", ""))
        bc = t["terrain"]["bloomCycle"]
        row("bloomF", "Bloom factor", bc.get("maxFactor", 1.3), f"How strongly Bloom counts right now: {bc.get('minFactor')} at night/closed, {bc.get('maxFactor')} at its midday peak.")

        section("Intensity bands (a stat's level on a tile)")
        self.band_rows = []
        for i, b in enumerate(t["intensity"]["bands"]):
            put(ws, f"A{r}", f"Level {i + 1}")
            inp(ws, f"B{r}", b["min"])
            inp(ws, f"C{r}", b["label"])
            self.band_rows.append(r)
            r += 1
        self.BANDS = f"Settings!$B${self.band_rows[0]}:$B${self.band_rows[-1]}"
        put(ws, f"A{r}", "Each row: the minimum value for that level (column B) and its name (column C). Below the first level a stat counts for nothing.", F_SUB)
        r += 1

        sp = t["spawns"]
        section("Item weights (stat scaling clamp)")
        row("scaleMin", "Scaling multiplier: lowest", sp["scaling"]["minMultiplier"], "Multiplier = 1 + Σ (scaling % ÷ 100) × (tile stat − the item's minimum), clamped to these.")
        row("scaleMax", "Scaling multiplier: highest", sp["scaling"]["maxMultiplier"])

        section("Category first (mushroom / plant / geode)")
        cs, cw = sp["categoryScaling"], sp["categoryWeights"]
        row("catMin", "Category multiplier: lowest", cs["minMultiplier"], "Each spawn first picks a category: weight × (1 + Σ % per point × tile stat), clamped to these.")
        row("catMax", "Category multiplier: highest", cs["maxMultiplier"])
        for c in CATS:
            row("catW_" + c, f"{CAP(c)}s: base weight", cw.get(c, 1))
        put(ws, f"A{r}", "Category tilt (% per stat point)", F_BOLD)
        for i, s in enumerate(STATS):
            put(ws, f"{L(2 + i)}{r}", CAP(s), F_BOLD, align=Alignment(horizontal="center"))
        r += 1
        self.catpct = {}
        for c in CATS:
            put(ws, f"A{r}", f"{CAP(c)}s")
            for i, s in enumerate(STATS):
                ref = f"{L(2 + i)}{r}"
                inp(ws, ref, (cs.get(c) or {}).get(s, 0))
                self.catpct[(c, s)] = f"Settings!${L(2 + i)}${r}"
            r += 1
        for col in "DEFG":
            ws.column_dimensions[col].width = 10

        section("Terrain affinity (what spawns on developed ground)")
        ta = sp["terrainAffinity"]
        for k, lab in RARITIES:
            row("aff_" + k, f"Needs met: {lab} ×", ta["byRarity"].get(k, 1), "An item whose stat needs are met on the tile is multiplied by this (rarer = much stronger pull)." if k == "common" else "")
        self.AFF_NAMES = None
        row("perExtra", "Per level above its need: +", ta.get("perExtraLevel", 0), "Each intensity level the tile is above the item's need adds this (averaged over its needs)…")
        row("extraCap", "…counted up to this many levels", ta.get("extraLevelCap", 2))
        row("grace", "Overshoot grace (levels)", ta.get("overshootGrace", 2), "Beyond this many levels above its need, an item fades…")
        row("overFade", "Overshoot fade per level", ta.get("overshootFadePerLevel", 0.25), "…by this much per extra level (so rich ground favours the items made for it).")
        row("genFade", "Plain items: fade per level", ta.get("genericFadePerLevel", 0.4), "Items with no needs fade by this per level on ground whose stats favour a different category…")
        row("genMin", "Fades stop at ×", ta.get("genericMinFactor", 0.08), "…down to this. Also the floor for the overshoot fade.")

        section("Named terrains")
        row("homeMult", "Home finds ×", t["terrains"].get("homeMult", 3), "A terrain's home finds (Terrains sheet) are this much likelier there, once their own needs are met.")

        section("Plants on Bloom")
        b = t["terrain"]["bloom"]
        row("varPer", "Variety per Bloom point", b.get("varietyPerPoint", 0.012), "High Bloom flattens plant weights (weight ^ exponent) so more kinds of plant turn up: exponent = 1 − this × Bloom × Bloom factor…")
        row("varMin", "Lowest variety exponent", b.get("minVarietyExponent", 0.35), "…never below this.")

        section("Glow by time of day")
        gc = t["terrain"]["glowCycle"]
        row("glowDay", "Glow factor by day", gc.get("dayFactor", 0.4), "How strongly Glow counts toward spawns by day…")
        row("glowNight", "Glow factor at night", gc.get("nightFactor", 1.6), "…and at night.")
        row("glowDepth", "Depth for full Glow by day", gc.get("depthForFullGlow", 40), "On deep ground Glow counts in full even by day (from this much Depth).")

        section("Where spawns land (not in the view sheets)")
        lw = sp["locationWeighting"]
        for i, lab in enumerate(["no effects", "one effect", "two effects", "three or more"]):
            row(f"loc{i}", f"Tile weight with {lab} ×", lw["generalByEffectCount"][i], "Effects: creatures reaching the tile, soil boosts, special-effect areas, combos and named terrains." if i == 0 else "")
        row("locPer", "+ per stat point on the tile", lw.get("perStatPoint", 0.05), "Tile weight × (1 + min(cap, this × the tile's stat total)).")
        row("locCap", "Intensity bonus cap", lw.get("maxIntensityBonus", 3))
        row("locMax", "Highest tile weight", lw.get("maxWeight", 24))
        row("blank", "Blank tile: spawn goes ahead", sp.get("blankTileSpawnChance", 1), "A spawn that lands on a tile with no effects only goes ahead this share of the time.", fmt="0%")
        mg = t["terrain"]["damp"]["mushroomGrowth"]
        row("mgPer", "Damp: extra mushrooms per point", mg.get("perPoint", 0.08), "Damp tiles get extra mushroom-only chances: usual rate × min(cap, Damp × this).")
        row("mgMax", "Damp: extra mushrooms cap", mg.get("maxBonus", 1))
        ws.freeze_panes = "A4"
        self.ws_settings = ws

    # ---- Items
    def items_sheet(self):
        ws = self.wb.create_sheet("Items", 1)
        put(ws, "A1", "Wild spawns", F_TITLE)
        put(ws, "A2", "Edit the blue cells: rarity, spawn weight, stat minimums (0 = no need) and scaling (% weight per point the tile is above the minimum; negative = rarer as the stat rises). Name, category and conditions are reference only.", F_SUB)
        heads = ["Name", "Category", "Rarity", "Spawn weight"] + [f"{CAP(s)} min" for s in STATS] + [f"{CAP(s)} %/pt" for s in STATS] + ["Conditions", "Notes"]
        header_row(ws, 4, heads, widths=[20, 10, 11, 9] + [8] * 12 + [22, 50])
        ws.row_dimensions[4].height = 30
        rar_dv = DataValidation(type="list", formula1='"' + ",".join(v for _, v in RARITIES) + '"'); ws.add_data_validation(rar_dv)
        r = 5
        for it in self.items:
            sp = it["spawn"]
            req = needs(it)
            put(ws, f"A{r}", it["name"], border=BOX)
            put(ws, f"B{r}", CAP(it["category"]), border=BOX)
            inp(ws, f"C{r}", RAR_LABEL[it["rarity"]]); rar_dv.add(f"C{r}")
            inp(ws, f"D{r}", sp.get("baseWeight", 0))
            for i, s in enumerate(STATS):
                inp(ws, f"{L(5 + i)}{r}", req.get(s, 0))
                inp(ws, f"{L(11 + i)}{r}", (sp.get("statScaling") or {}).get(s, 0))
            put(ws, f"Q{r}", conditions(it), border=BOX)
            put(ws, f"R{r}", it.get("guideText", ""), F_SUB, border=BOX)
            self.item_row[it["id"]] = r
            r += 1
        self.items_last = r - 1
        ws.freeze_panes = "B5"
        ws.auto_filter.ref = f"A4:R{r - 1}"

    def I(self, iid, col):
        return f"Items!${col}${self.item_row[iid]}"

    def need_ref(self, iid, s):
        return self.I(iid, L(5 + STATS.index(s)))

    def scale_ref(self, iid, s):
        return self.I(iid, L(11 + STATS.index(s)))

    # ---- Terrains
    def terrains_sheet(self):
        ws = self.wb.create_sheet("Terrains", 2)
        put(ws, "A1", "Terrains", F_TITLE)
        put(ws, "A2", "A tile becomes a named terrain when every listed stat reaches its minimum (blank = not part of it). Home finds: item names, separated by commas. Rules multiply home finds at night / by day / in rain, tilt a category (after the category clamp), or pull spawns onto the terrain.", F_SUB)
        heads = ["Name", "Kind"] + [f"{CAP(s)} min" for s in STATS] + ["Home finds (comma-separated names)", "Home × at night", "Home × by day", "Home × in rain", "Mushrooms ×", "Plants ×", "Geodes ×", "Spawn pull ×", "Notes"]
        header_row(ws, 4, heads, widths=[18, 8] + [8] * 6 + [60, 9, 9, 9, 10, 9, 9, 9, 60])
        ws.row_dimensions[4].height = 30
        names_by_id = {it["id"]: it["name"] for it in self.items}
        terrain_text = {d["id"]: d.get("text", "") for d in load_json(os.path.join(CONTENT, "terrain.json"))}
        r = 5
        self.terrains = []
        for tid, d in self.t["terrains"].items():
            if not isinstance(d, dict) or "requires" not in d:
                continue
            kind = "Triple" if len(d["requires"]) > 2 else "Pair"
            put(ws, f"A{r}", d["name"], border=BOX)
            put(ws, f"B{r}", kind, border=BOX)
            for i, s in enumerate(STATS):
                inp(ws, f"{L(3 + i)}{r}", d["requires"][s]["min"] if s in d["requires"] else None)
            inp(ws, f"I{r}", ", ".join(names_by_id.get(h, h) for h in d.get("home", [])))
            ws[f"I{r}"].alignment = Alignment(wrap_text=True, vertical="top")
            rule = d.get("rule", {})
            for col, key in (("J", "night"), ("K", "day"), ("L", "rain"), ("P", "location")):
                inp(ws, f"{col}{r}", rule.get(key, 1))
            for col, c in (("M", "mushroom"), ("N", "plant"), ("O", "geode")):
                inp(ws, f"{col}{r}", (rule.get("category") or {}).get(c, 1))
            put(ws, f"Q{r}", terrain_text.get(tid, ""), F_SUB, border=BOX)
            ws[f"Q{r}"].alignment = Alignment(wrap_text=True, vertical="top")
            self.ter_row[tid] = r
            self.terrains.append((tid, d, r))
            r += 1
        # Combos (pool, moss, meadow): requirements, and the meadow's plant multiplier.
        r += 1
        put(ws, f"A{r}", "Combo tiles (they work alongside named terrains)", F_BOLD, fill=FILL_BLOCK)
        r += 1
        combo_notes = {"pool": "Shallow water: only items that need Damp can spawn on it; Water Reed grows only here.",
                       "moss": "Moss over ground and stone; bugs gather. No spawn effect.",
                       "meadow": "Plants are this much likelier to be the category chosen (Plants ×, applied before the category clamp)."}
        self.combo_row = {}
        for cid in ("pool", "moss", "meadow"):
            d = self.t["combos"][cid]
            put(ws, f"A{r}", d["name"], border=BOX)
            put(ws, f"B{r}", "Combo", border=BOX)
            for i, s in enumerate(STATS):
                inp(ws, f"{L(3 + i)}{r}", d["requires"][s]["min"] if s in d["requires"] else None)
            if cid == "meadow":
                inp(ws, f"N{r}", d.get("plantCategoryMult", 3))
            put(ws, f"Q{r}", combo_notes[cid], F_SUB, border=BOX)
            self.combo_row[cid] = r
            r += 1
        ws.freeze_panes = "C5"

    def T(self, tid, col):
        return f"Terrains!${col}${self.ter_row[tid]}"

    def treq(self, tid, s):
        return self.T(tid, L(3 + STATS.index(s)))

    def C(self, cid, col):
        return f"Terrains!${col}${self.combo_row[cid]}"

    # ---- Views
    def views(self):
        ter = [(tid, d) for tid, d, _ in self.terrains]
        singles = [("Plain ground", [])] + [(f"{CAP(s)}", [s]) for s in STATS]
        pairs, triples = [], []
        for i in range(6):
            for j in range(i + 1, 6):
                K = [STATS[i], STATS[j]]
                pairs.append((self.block_title(K), K))
        for tid, d in ter:
            if len(d["requires"]) == 3:
                K = [s for s in STATS if s in d["requires"]]
                triples.append((self.block_title(K), K))
        moss = [s for s in STATS if s in self.t["combos"]["moss"]["requires"]]
        triples.append((self.block_title(moss), moss))
        self.view_sheets = []
        for name, blocks in (("Single Stats", singles), ("Pairs", pairs), ("Triples", triples)):
            ws = self.wb.create_sheet(name)
            self.view_sheet(ws, name, blocks)
            self.view_sheets.append((name, [b[0] for b in blocks]))

    def candidates(self, K):
        """Named terrains a tile with exactly the stats K could form, most specific first (same order the game picks)."""
        out = []
        for tid, d, _ in self.terrains:
            keys = set(d["requires"])
            if keys <= set(K):
                out.append((tid, d))
        out.sort(key=lambda x: -len(x[1]["requires"]))     # stable: definition order within a size (the game's tie-break)
        return out

    def block_title(self, K):
        names = [d["name"] for tid, d, _ in self.terrains if set(d["requires"]) == set(K)]
        for cid in ("pool", "moss", "meadow"):
            if set(self.t["combos"][cid]["requires"]) == set(K):
                names.append(self.t["combos"][cid]["name"])
        base = " + ".join(CAP(s) for s in K)
        return f"{base} ({', '.join(names)})" if names else base

    def view_sheet(self, ws, title, blocks):
        nb = len(self.band_rows)
        put(ws, "A1", f"{title}: spawn chances by intensity", F_TITLE)
        put(ws, "A2", "Each block is a tile where the listed stats all sit at the level in the column (other stats 0). Cells: the chance that a spawn on that tile is that item (category chosen first, then the item). "
            "Live formulas from Items, Terrains and Settings; time of day and rain come from Settings → Preview. Grey working columns on the right show each item's weight.", F_SUB)
        ws.column_dimensions["A"].width = 24
        ws.column_dimensions["B"].width = 10
        ws.column_dimensions["C"].width = 10
        ws.column_dimensions["D"].width = 14
        for k in range(nb):
            ws.column_dimensions[L(5 + k)].width = 10
            ws.column_dimensions[L(6 + nb + k)].width = 8
        ws.column_dimensions[L(5 + nb)].width = 3
        r = 4
        for name, K in blocks:
            r = self.block(ws, r, name, K) + 2
        ws.freeze_panes = "B4"

    def block(self, ws, r, name, K):
        nb = len(self.band_rows)
        plain = not K
        ncol = 1 if plain else nb
        V = [5 + k for k in range(ncol)]                 # chance columns
        Wc = [6 + nb + k for k in range(ncol)]           # weight (working) columns
        # Title
        put(ws, f"A{r}", name if K else "Plain ground (no stats)", F_BOLD, fill=FILL_BLOCK)
        for col in range(2, 6 + 2 * nb):
            ws.cell(r, col).fill = FILL_BLOCK
        r += 1
        # Header: level names
        put(ws, f"A{r}", "Item", F_HEAD, fill=FILL_HEAD)
        put(ws, f"B{r}", "Category", F_HEAD, fill=FILL_HEAD)
        put(ws, f"C{r}", "Rarity", F_HEAD, fill=FILL_HEAD)
        put(ws, f"D{r}", "Conditions", F_HEAD, fill=FILL_HEAD)
        for k in range(ncol):
            c = ws.cell(r, V[k], "Any" if plain else f"=Settings!$C${self.band_rows[k]}")
            c.font, c.fill, c.alignment = F_HEAD, FILL_HEAD, Alignment(horizontal="center")
            w = ws.cell(r, Wc[k], "weight" if plain else f"=Settings!$C${self.band_rows[k]}")
            w.font, w.fill, w.alignment = F_WORK, FILL_WORK, Alignment(horizontal="center")
        hdr = r
        r += 1
        # Working rows
        rows = {}

        def work(key, label, fn, fmt=None):
            nonlocal r
            put(ws, f"A{r}", label, F_WORK, fill=FILL_WORK)
            for col in "BCD":
                ws[f"{col}{r}"].fill = FILL_WORK
            for k in range(ncol):
                c = ws.cell(r, V[k], fn(k))
                c.font, c.fill = F_WORK, FILL_WORK
                if fmt: c.number_format = fmt
                c.alignment = Alignment(horizontal="center")
            rows[key] = r
            r += 1

        cell = lambda key, k: f"{L(V[k])}${rows[key]}"
        work("v", "Stat value on the tile", lambda k: 0 if plain else f"=Settings!$B${self.band_rows[k]}")
        val = lambda s, k: cell("v", k) if s in K else "0"
        work("lvl", "Intensity level", lambda k: f"=COUNTIF({self.BANDS},\"<=\"&{cell('v', k)})")
        S = self.S
        night = f"({S['time']}=\"Night\")"
        if "glow" in K:
            dref = val("depth", 0)
            work("gf", "Glow factor", lambda k: f"=IF({night},{S['glowNight']},{S['glowDay']}+({S['glowNight']}-{S['glowDay']})*MIN(1,{val('depth', k)}/{S['glowDepth']}))", "0.00")
        fac = lambda s, k: (cell("gf", k) if s == "glow" else S["bloomF"] if s == "bloom" else "1")
        work("vexp", "Plant variety exponent", lambda k: f"=MAX({S['varMin']},1-{S['varPer']}*{val('bloom', k)}*{S['bloomF']})", "0.00")
        # Combos and the named terrain that forms
        def forms(reqref_fn, keys, k):
            conds = [f"OR({reqref_fn(s)}=\"\",{val(s, k)}>={reqref_fn(s)})" for s in STATS]
            # every listed stat must be part of this tile (min set and stat > 0) and meet its min
            return "AND(" + ",".join(conds) + f",{cell('v', k)}>0)"
        has_pool = set(self.t["combos"]["pool"]["requires"]) <= set(K)
        has_meadow = set(self.t["combos"]["meadow"]["requires"]) <= set(K)
        if has_pool:
            work("pool", "Shallow pool forms", lambda k: f"=IF({forms(lambda s: self.C('pool', L(3 + STATS.index(s))), K, k)},\"Yes\",\"No\")")
        if has_meadow:
            work("meadow", "Wild meadow forms", lambda k: f"=IF({forms(lambda s: self.C('meadow', L(3 + STATS.index(s))), K, k)},\"Yes\",\"No\")")
        cands = self.candidates(K)
        if cands:
            def active(k):
                expr = '"–"'
                for tid, d in reversed(cands):
                    expr = f"IF({forms(lambda s, tid=tid: self.treq(tid, s), K, k)},{self.T(tid, 'A')},{expr})"
                return "=" + expr
            work("ter", "Named terrain", active)
        r_items0 = r
        # Item rows
        eligible_items = [it for it in self.items if set(needs(it)) <= set(K)]
        tlookup = "Terrains!$A$5:$A$40"

        def tcol(col):
            return f"Terrains!${col}$5:${col}$40"

        for it in eligible_items:
            iid = it["id"]
            put(ws, f"A{r}", f"={self.I(iid, 'A')}", border=BOX)
            put(ws, f"B{r}", f"={self.I(iid, 'B')}", border=BOX)
            put(ws, f"C{r}", f"={self.I(iid, 'C')}", border=BOX)
            put(ws, f"D{r}", f"=IF({self.I(iid, 'Q')}=\"\",\"\",{self.I(iid, 'Q')})", F_SUB, border=BOX)
            cond = self.I(iid, "Q")
            for k in range(ncol):
                v = cell("v", k)
                parts = [f"{self.need_ref(iid, s)}<={val(s, k)}" for s in STATS]
                parts.append(f"IF(ISNUMBER(SEARCH(\"night only\",{cond})),{night},TRUE)")
                parts.append(f"IF(ISNUMBER(SEARCH(\"day only\",{cond})),NOT({night}),TRUE)")
                parts.append(f"IF(ISNUMBER(SEARCH(\"rain only\",{cond})),{S['rain']}=\"Yes\",TRUE)")
                pool_ok = (cell("pool", k) + '="Yes"') if has_pool else "FALSE"
                parts.append(f"IF(ISNUMBER(SEARCH(\"pool only\",{cond})),{pool_ok},TRUE)")
                if has_pool:
                    parts.append(f"IF({cell('pool', k)}=\"Yes\",{self.need_ref(iid, 'damp')}>0,TRUE)")
                elig = "AND(" + ",".join(parts) + ")"
                scal = "+".join(f"{self.scale_ref(iid, s)}/100*MAX(0,{val(s, k)}-{self.need_ref(iid, s)})*{fac(s, k)}" for s in K) or "0"
                mult = f"MIN({S['scaleMax']},MAX({S['scaleMin']},1+{scal}))"
                nneeds = f"COUNTIF({self.I(iid, 'E')}:{self.I(iid, 'J').split('!')[1]},\">0\")"
                lvl = cell("lvl", k)
                extra_terms = "+".join(f"IF({self.need_ref(iid, s)}>0,MAX(0,{lvl}-COUNTIF({self.BANDS},\"<=\"&{self.need_ref(iid, s)})),0)" for s in K) or "0"
                extra = f"({extra_terms})/MAX(1,{nneeds})"
                rar = self.I(iid, "C")
                aff_lookup = "IF(" + ",IF(".join(f"{rar}=\"{lab}\",{S['aff_' + key]}" for key, lab in RARITIES[:-1]) + f",{S['aff_legendary']}" + ")" * (len(RARITIES) - 1)
                favoured = "OR(" + ",".join(f"AND({self.I(iid, 'B')}=\"{CAP(c)}\",OR(" + ",".join(f"{self.catpct[(c, s)]}>0" for s in K) + "))" for c in CATS) + ")" if K else "FALSE"
                aff = (f"IF({nneeds}>0,{aff_lookup}*(1+{S['perExtra']}*MIN({extra},{S['extraCap']}))*MAX({S['genMin']},1-{S['overFade']}*MAX(0,{extra}-{S['grace']})),"
                       f"IF(AND({lvl}>0,NOT({favoured})),MAX({S['genMin']},1-{S['genFade']}*{lvl}),1))")
                home = "1"
                if cands:
                    tn = cell("ter", k)
                    homecell = f"INDEX({tcol('I')},MATCH({tn},{tlookup},0))"
                    rule = (f"IF({night},INDEX({tcol('J')},MATCH({tn},{tlookup},0)),INDEX({tcol('K')},MATCH({tn},{tlookup},0)))"
                            f"*IF({S['rain']}=\"Yes\",INDEX({tcol('L')},MATCH({tn},{tlookup},0)),1)")
                    is_home = f"ISNUMBER(SEARCH(\",\"&{self.I(iid, 'A')}&\",\",\",\"&SUBSTITUTE({homecell},\", \",\",\")&\",\"))"
                    home = f"IF({tn}=\"–\",1,IF({is_home},{S['homeMult']}*{rule},1))"
                w = f"IF({elig},{self.I(iid, 'D')}*{mult}*({aff})*{home},0)"
                if it["category"] == "plant":
                    w = f"POWER({w},{cell('vexp', k)})"
                c = ws.cell(r, Wc[k], "=" + w)
                c.font, c.fill, c.number_format = F_WORK, FILL_WORK, NUM
            r += 1
        r_items1 = r - 1
        # Category rows
        put(ws, f"A{r}", "Category chosen", F_BOLD, fill=FILL_CAT)
        for col in range(2, 5):
            ws.cell(r, col).fill = FILL_CAT
        r += 1
        cat_rows = {}
        for cat in CATS:
            put(ws, f"A{r}", f"{CAP(cat)}s", fill=FILL_CAT, border=BOX)
            for col in range(2, 5):
                ws.cell(r, col).fill = FILL_CAT
            for k in range(ncol):
                wcol = L(Wc[k])
                tilt = "+".join(f"{self.catpct[(cat, s)]}/100*{val(s, k)}*{fac(s, k)}" for s in K) or "0"
                base_raw = f"IF({cell('meadow', k)}=\"Yes\",{self.C('meadow', 'N')},1)" if (cat == "plant" and has_meadow) else "1"
                tmult = "1"
                if cands:
                    tn = cell("ter", k)
                    col = {"mushroom": "M", "plant": "N", "geode": "O"}[cat]
                    tmult = f"IF({tn}=\"–\",1,INDEX({tcol(col)},MATCH({tn},{tlookup},0)))"
                anyw = f"SUMIF($B${r_items0}:$B${r_items1},\"{CAP(cat)}\",{wcol}${r_items0}:{wcol}${r_items1})" if eligible_items else "0"
                f = f"=IF({anyw}>0,{S['catW_' + cat]}*MIN({S['catMax']},MAX({S['catMin']},{base_raw}+{tilt}))*{tmult},0)"
                c = ws.cell(r, Wc[k], f)
                c.font, c.fill, c.number_format = F_WORK, FILL_WORK, NUM
            cat_rows[cat] = r
            r += 1
        c0, c1 = cat_rows[CATS[0]], cat_rows[CATS[-1]]
        for cat in CATS:
            rr = cat_rows[cat]
            for k in range(ncol):
                wcol = L(Wc[k])
                c = ws.cell(rr, V[k], f"=IF(SUM({wcol}${c0}:{wcol}${c1})>0,{wcol}{rr}/SUM({wcol}${c0}:{wcol}${c1}),0)")
                c.number_format, c.font, c.fill, c.border = PCT, F_BASE, FILL_CAT, BOX
        # Item chances = category share × share within the category
        for rr in range(r_items0, r_items1 + 1):
            for k in range(ncol):
                wcol, vcol = L(Wc[k]), L(V[k])
                catshare = "IF($B{r}=\"Mushroom\",{m},IF($B{r}=\"Plant\",{p},{g}))".format(
                    r=rr, m=f"{vcol}${cat_rows['mushroom']}", p=f"{vcol}${cat_rows['plant']}", g=f"{vcol}${cat_rows['geode']}")
                incat = f"SUMIF($B${r_items0}:$B${r_items1},$B{rr},{wcol}${r_items0}:{wcol}${r_items1})"
                c = ws.cell(rr, V[k], f"=IF({incat}>0,{catshare}*{wcol}{rr}/{incat},0)")
                c.number_format, c.font, c.border = PCT, F_BASE, BOX
        # Highlight the likeliest finds
        rng = f"{L(V[0])}{r_items0}:{L(V[-1])}{r_items1}"
        ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThanOrEqual", formula=["0.1"], fill=PatternFill("solid", fgColor="C6E0B4")))
        return r

    # ---- Read Me
    def readme_sheet(self):
        ws = self.readme
        ws.column_dimensions["A"].width = 22
        ws.column_dimensions["B"].width = 110
        put(ws, "A1", "Undergrowth: tile spawns", F_TITLE)
        lines = [
            ("What this is", "Every wild spawn in the game, broken up by terrain type and intensity. Edit it, save it, and send it back; it's applied with tools/tile_spawns_workbook.py import."),
            ("Editable cells", "Blue text on a yellow fill. Everything else is reference or formulas. Don't add or delete rows or columns on the editable sheets; change values only."),
            ("Items", "One row per wild spawn: rarity, spawn weight, the minimum each stat needs (0 = no need) and how its weight scales per point above that minimum."),
            ("Terrains", "Named terrains (stat pairs and the legendary triples) and combo tiles: the minimums that form them, their home finds (comma-separated item names) and their rules."),
            ("Settings", "Intensity levels, how weights scale, the category tilt, terrain affinity, and where spawns land. The Preview section (time of day, rain, Bloom factor) only changes the view sheets."),
            ("Single Stats / Pairs / Triples", "The views: for a tile where the listed stats all sit at each intensity level, the chance that a spawn there is each item. The category is picked first (rows at the bottom of each block), then the item within it. They update as you edit."),
            ("Example", "To make Crystal Cap show up on Moderate Glow + Stone: on Items, set its Glow min and Stone min to 16 (both were 50). The Pairs sheet's Glow + Stone block then shows it from the Moderate column."),
            ("Not in the views", "Where on the map spawns land (Settings → Where spawns land), Damp's extra mushroom growth, reeds clustering, one-at-a-time limits and creature special effects. Those still apply in the game."),
            ("Glow and Bloom", "Glow counts less by day (more on deep ground) and more at night; Bloom follows its daily cycle (Bloom factor). Both affect stat scaling, the category tilt, and the plant variety on Bloom."),
        ]
        r = 3
        for a, b in lines:
            put(ws, f"A{r}", a, F_BOLD)
            put(ws, f"B{r}", b)
            ws[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="top")
            ws[f"A{r}"].alignment = Alignment(vertical="top")
            r += 1
        r += 1
        put(ws, f"A{r}", "Legend", F_BOLD)
        r += 1
        inp(ws, f"A{r}", 16)
        put(ws, f"B{r}", "An editable value (blue on yellow)")
        r += 1
        put(ws, f"A{r}", 0.125, fmt=PCT, border=BOX, fill=PatternFill("solid", fgColor="C6E0B4"))
        put(ws, f"B{r}", "A chance of 10% or more (highlighted in the views)")
        r += 1
        put(ws, f"A{r}", "–", border=BOX)
        put(ws, f"B{r}", "Can't spawn there (0%)")
        r += 1
        put(ws, f"A{r}", "weight", F_WORK, fill=FILL_WORK)
        put(ws, f"B{r}", "Working values (grey): an item's weight before it's turned into a chance")
        r += 2
        put(ws, f"A{r}", "View sheets", F_BOLD)
        r += 1
        for name, blocks in self.view_sheets:
            put(ws, f"A{r}", name)
            put(ws, f"B{r}", "; ".join(blocks))
            ws[f"B{r}"].alignment = Alignment(wrap_text=True)
            r += 1


# ------------------------------------------------------------------ import

def dump_tuning(obj):
    """JSON with short containers kept on one line (like the hand-written tuning.json)."""
    def enc(o, ind):
        flat = json.dumps(o, ensure_ascii=False)
        if not isinstance(o, (dict, list)) or len(flat) + ind <= 140:
            return flat
        pad, pad2 = " " * ind, " " * (ind + 2)
        if isinstance(o, dict):
            return "{\n" + ",\n".join(f"{pad2}{json.dumps(k)}: {enc(v, ind + 2)}" for k, v in o.items()) + f"\n{pad}}}"
        return "[\n" + ",\n".join(pad2 + enc(v, ind + 2) for v in o) + f"\n{pad}]"
    return enc(obj, 0) + "\n"


def num(v, default=0):
    if v is None or v == "":
        return default
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    return float(str(v).strip())


def do_import(path):
    wb = openpyxl.load_workbook(path, data_only=False)
    changes = []
    t = load_json(TUNING)
    items = load_items()
    by_name = {it["name"]: it for it in items}

    # --- Items → master spreadsheet
    ws = wb["Items"]
    master = openpyxl.load_workbook(MASTER)
    ms = master.worksheets[0]
    mh = next(r for r in range(1, ms.max_row + 1) if ms.cell(r, 1).value == "Name")
    mcols = {str(ms.cell(mh, c).value).strip(): c for c in range(1, ms.max_column + 1) if ms.cell(mh, c).value}
    mrow = {ms.cell(r, 1).value: r for r in range(mh + 1, ms.max_row + 1) if ms.cell(r, 2).value in ("Mushroom", "Plant", "Geode")}
    for r in range(5, ws.max_row + 1):
        name = ws.cell(r, 1).value
        if not name or name not in mrow:
            continue
        mr = mrow[name]
        rar = str(ws.cell(r, 3).value or "").strip()
        if rar.lower() not in RAR_KEY:
            raise SystemExit(f"Items row {r} ({name}): unknown rarity {rar!r}")
        new = {"Rarity": RAR_LABEL[RAR_KEY[rar.lower()]], "Spawn weight (wild)": num(ws.cell(r, 4).value)}
        for i, s in enumerate(STATS):
            new[CAP(s)] = num(ws.cell(r, 5 + i).value)
            new[f"{CAP(s)} scaling %/pt"] = num(ws.cell(r, 11 + i).value)
        for col, v in new.items():
            c = mcols[col]
            old = ms.cell(mr, c).value
            if (old if old is not None else 0) != v and not (isinstance(old, str) and old == v):
                changes.append(f"{name}: {col} {old} → {v}")
                ms.cell(mr, c).value = v
    item_changes = len(changes)
    if item_changes:
        master.save(MASTER)

    # --- Terrains → tuning.terrains / combos
    ws = wb["Terrains"]
    name_to_tid = {d["name"]: tid for tid, d in t["terrains"].items() if isinstance(d, dict) and "name" in d}
    name_to_cid = {d["name"]: cid for cid, d in t["combos"].items() if isinstance(d, dict) and "name" in d}
    for r in range(5, ws.max_row + 1):
        name = ws.cell(r, 1).value
        reqs = {}
        for i, s in enumerate(STATS):
            v = ws.cell(r, 3 + i).value
            if v not in (None, ""):
                reqs[s] = {"min": num(v)}
        if name in name_to_tid:
            tid = name_to_tid[name]
            d = t["terrains"][tid]
            if len(reqs) < 2:
                raise SystemExit(f"Terrains row {r} ({name}): a terrain needs at least two stats")
            home_names = [x.strip() for x in str(ws.cell(r, 9).value or "").split(",") if x.strip()]
            missing = [h for h in home_names if h not in by_name]
            if missing:
                raise SystemExit(f"Terrains row {r} ({name}): unknown home find(s): {', '.join(missing)}")
            home = [by_name[h]["id"] for h in home_names]
            rule = {}
            for col, key in ((10, "night"), (11, "day"), (12, "rain"), (16, "location")):
                v = num(ws.cell(r, col).value, 1)
                if v != 1:
                    rule[key] = v
            cat = {}
            for col, c in ((13, "mushroom"), (14, "plant"), (15, "geode")):
                v = num(ws.cell(r, col).value, 1)
                if v != 1:
                    cat[c] = v
            if cat:
                rule["category"] = cat
            for key, new in (("requires", reqs), ("home", home), ("rule", rule)):
                if d.get(key) != new:
                    changes.append(f"Terrain {name}: {key} {json.dumps(d.get(key))} → {json.dumps(new)}")
                    d[key] = new
        elif name in name_to_cid:
            cid = name_to_cid[name]
            d = t["combos"][cid]
            if reqs != d["requires"]:
                changes.append(f"Combo {name}: requires {json.dumps(d['requires'])} → {json.dumps(reqs)}")
                d["requires"] = reqs
            if cid == "meadow":
                v = num(ws.cell(r, 14).value, d.get("plantCategoryMult", 3))
                if v != d.get("plantCategoryMult"):
                    changes.append(f"Combo {name}: plants × {d.get('plantCategoryMult')} → {v}")
                    d["plantCategoryMult"] = v

    # --- Settings → tuning
    ws = wb["Settings"]
    labels = {}
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if isinstance(a, str):
            labels.setdefault(a.strip(), r)

    def val(label, col=2):
        if label not in labels:
            raise SystemExit(f"Settings: row {label!r} not found")
        return ws.cell(labels[label], col).value

    def setp(path_keys, v, what):
        o = t
        for k in path_keys[:-1]:
            o = o[k]
        if o.get(path_keys[-1]) != v:
            changes.append(f"{what}: {o.get(path_keys[-1])} → {v}")
            o[path_keys[-1]] = v

    bands = []
    for i in range(len(t["intensity"]["bands"])):
        bands.append({"min": num(val(f"Level {i + 1}")), "label": str(val(f"Level {i + 1}", 3))})
    if [b["min"] for b in bands] != sorted(b["min"] for b in bands):
        raise SystemExit("Settings: intensity level minimums must rise from Level 1 to the last level")
    setp(["intensity", "bands"], bands, "Intensity bands")
    setp(["intensity", "minInfluence"], bands[0]["min"], "Influence floor (Level 1 minimum)")
    sp = ["spawns"]
    setp(sp + ["scaling", "minMultiplier"], num(val("Scaling multiplier: lowest")), "Scaling lowest")
    setp(sp + ["scaling", "maxMultiplier"], num(val("Scaling multiplier: highest")), "Scaling highest")
    setp(sp + ["categoryScaling", "minMultiplier"], num(val("Category multiplier: lowest")), "Category lowest")
    setp(sp + ["categoryScaling", "maxMultiplier"], num(val("Category multiplier: highest")), "Category highest")
    tilt_row = labels["Category tilt (% per stat point)"]
    for ci, c in enumerate(CATS):
        setp(sp + ["categoryWeights", c], num(val(f"{CAP(c)}s: base weight")), f"{CAP(c)}s base weight")
        tilt = {}
        for i, s in enumerate(STATS):
            v = num(ws.cell(tilt_row + 1 + ci, 2 + i).value)
            if v:
                tilt[s] = v
        setp(sp + ["categoryScaling", c], tilt, f"{CAP(c)} category tilt")
    for k, lab in RARITIES:
        setp(sp + ["terrainAffinity", "byRarity", k], num(val(f"Needs met: {lab} ×")), f"Affinity {lab}")
    for label, key in (("Per level above its need: +", "perExtraLevel"), ("…counted up to this many levels", "extraLevelCap"), ("Overshoot grace (levels)", "overshootGrace"),
                       ("Overshoot fade per level", "overshootFadePerLevel"), ("Plain items: fade per level", "genericFadePerLevel"), ("Fades stop at ×", "genericMinFactor")):
        setp(sp + ["terrainAffinity", key], num(val(label)), f"Affinity {key}")
    setp(["terrains", "homeMult"], num(val("Home finds ×")), "Home finds ×")
    setp(["terrain", "bloom", "varietyPerPoint"], num(val("Variety per Bloom point")), "Bloom variety per point")
    setp(["terrain", "bloom", "minVarietyExponent"], num(val("Lowest variety exponent")), "Lowest variety exponent")
    setp(["terrain", "glowCycle", "dayFactor"], num(val("Glow factor by day")), "Glow by day")
    setp(["terrain", "glowCycle", "nightFactor"], num(val("Glow factor at night")), "Glow at night")
    setp(["terrain", "glowCycle", "depthForFullGlow"], num(val("Depth for full Glow by day")), "Depth for full Glow")
    gbe = [num(val(f"Tile weight with {lab} ×")) for lab in ("no effects", "one effect", "two effects", "three or more")]
    setp(sp + ["locationWeighting", "generalByEffectCount"], gbe, "Tile weight by effect count")
    setp(sp + ["locationWeighting", "perStatPoint"], num(val("+ per stat point on the tile")), "Tile weight per stat point")
    setp(sp + ["locationWeighting", "maxIntensityBonus"], num(val("Intensity bonus cap")), "Intensity bonus cap")
    setp(sp + ["locationWeighting", "maxWeight"], num(val("Highest tile weight")), "Highest tile weight")
    setp(sp + ["blankTileSpawnChance"], num(val("Blank tile: spawn goes ahead")), "Blank tile spawn chance")
    setp(["terrain", "damp", "mushroomGrowth", "perPoint"], num(val("Damp: extra mushrooms per point")), "Damp mushroom growth per point")
    setp(["terrain", "damp", "mushroomGrowth", "maxBonus"], num(val("Damp: extra mushrooms cap")), "Damp mushroom growth cap")

    if len(changes) > item_changes:
        with open(TUNING, "w") as f:
            f.write(dump_tuning(t))
    if item_changes:
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "import_spawn_table.py")], check=True)
    print(f"{len(changes)} change(s) applied:" if changes else "No changes.")
    for c in changes:
        print("  -", c)
    return changes


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "export"
    if cmd == "export":
        print("wrote", os.path.relpath(Export().run(), ROOT))
    elif cmd == "import":
        do_import(sys.argv[2] if len(sys.argv) > 2 else OUT)
    else:
        raise SystemExit(__doc__)
