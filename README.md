# Undergrowth (working title)

A cozy top-down pixel-art forest clearing, framed by a shrub treeline. Place creatures and they slowly reshape the land around them. The forest's look comes from whatever mix of stats each tile ends up with. Plants, mushrooms and geodes sprout across the forest for you to collect.

## Running it

Requirements: Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
xcodegen generate
open Undergrowth.xcodeproj
```

Then run the **Undergrowth** scheme on an iOS 17+ simulator or device. You may need to set a development team under Signing & Capabilities when running on a device.

The game logic lives in a plain Swift package that also builds on Linux. Run its tests with:

```bash
cd Packages/UndergrowthCore && swift test
```

## Web prototype (play in a phone browser)

`web/` is a dependency-free JavaScript port of the game logic and renderer. It reads the same `Resources/` data as the iOS app, so the two versions share sprites, tuning, creatures, items, loot and tile rules.

- **Live:** the workflow `.github/workflows/pages.yml` builds and deploys it to GitHub Pages on every push that touches `web/`, `Resources/` or the build script. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
- **Local:** build it, then serve it.

```bash
python3 tools/build_web.py
```
```bash
python3 -m http.server -d dist 8000
```

Then open <http://localhost:8000>.
- **On iPhone:** open the Pages URL in Safari, tap Share, then *Add to Home Screen*. It launches full-screen like an app.
- **Saves:** stored in the browser's `localStorage`. They're separate from the iOS app's saves, and Safari may clear them after a long period without visiting.
- **Same gameplay as the iOS app:** `web/js/core.js` mirrors `UndergrowthCore`. When game rules change, update both.

## Opening and early progression (web version)

- **New forest:** a 7×14 clearing in the middle of the 40×56 forest, with all stats at 0. The Old Log sits at its centre (`Content/landmarks.json`). Only spawns with no stat requirements can appear, straight from the normal spawn rules.
- **Tutorial:** forage, then plant, dig, crack, place, and watch. The pointer and the coach card guide each step, and each step only advances when you do it.
  - The guaranteed results ride on the tutorial's own spawns: the Clover always drops a seed, and the Pebble Geode always holds a Common creature.
  - The creature's family is set by `tutorial.creatureFamily`: `"random"` or `"choose"`.
  - The tutorial creature ramps up in `tutorial.rampSeconds` (60) the first time it's placed. Placing it again later uses its normal time.
  - Progress is saved, so quitting resumes at the same step. The 🐞 menu can replay or skip the tutorial.
- **Slots:** 1 to start, then more on the days in `slotUnlocks.unlockDays` (counted from first play). Locked slots show their day.
- **Blend celebration:** fires once, the first time two creatures each give a tile `blend.minEach` or more.
- **Forest expansion:** the clearing grows by `ringTiles` (2) tiles on each side when the `expansion` conditions are met, at most every `minHoursBetween` hours. Newly revealed tiles fade influence in over `revealRampSeconds`, and nothing reaches past the treeline.
- **Starter tasks:** after the tutorial, a few goals at a time appear under Tasks. Examples are picking 5 mushrooms, harvesting a seed, cracking 3 geodes, and having two creatures out at once. Each gives a reward to claim. They're defined in `Content/tasks.json` (text, counter, target, reward).
- **Spawns:** the cap is `spawns.maxPerOpenTile` × open tiles, at least `minCap` and at most `maxTotal`.
- **First-Uncommon hint:** shows once, the first time any tile meets an Uncommon spawn's stat requirements.
- **Story and hint text:** all in `Content/story.json`, including the Old Log's Field Guide entry and the Heartwood Sapling teaser.
- **Older saves:** forests from before this update open fully, with the tutorial marked done.

The iOS app doesn't have these yet. It ignores the new data files.

## How to play

The forest is 40×56 tiles (`tuning.json` → `grid`). You start in a small clearing that grows outward over time. At full zoom-out the clearing plus a thin treeline border (`visuals.viewBorderTiles`, half a tile) fills the screen width at a crisp whole-pixel scale, and you can never pan past that border. Drag to explore the rest of the clearing. Pinch to zoom in.


- **You start with no creatures.** Tap things that grow in the forest:
  - **Mushrooms**: pick them; Funglings sometimes hide inside.
  - **Plants**: pick them; they sometimes drop a Mystery Seed. Plant the seed from the Bag, and it grows into a plant or, sometimes, a Sproutling.
  - **Geodes**: dig them up, then crack them from the Bag. Inside is a gem or, sometimes, a Geode Critter.
  - **Wanderers** turn up on their own once a tile meets their conditions (checked once a day). Tap one to befriend it.
- **Finding creatures**
  - Each species has its own find chance and tile conditions: the tile where the mushroom was picked, the seed planted, or the geode dug.
  - A pity counter per family guarantees a find after enough misses.
  - Every creature rolls 60–100% of its species' maximum bonuses. 1% are **Glimmers**: +50% bonuses, +1 radius, and a shiny palette.
- **Placing creatures**
  - Place up to 3 creatures (a config value) from the Burrow.
  - Each one ramps up over its own species time (12–48 hours) and fades over the same time after you return it.
  - Rarer creatures have special effects, listed on their detail page.
- **Gems and materials**
  - Gems can be crushed into a tile for a timed stat boost.
  - A Heartstone Core boosts a tile permanently.
  - A Moonfall Shard makes your next creature find a Glimmer.
- **Time and weather**: some things only spawn at night (from 20:00 to 06:00 local time), in the daytime, or in the rain. The HUD shows the time (☀️/🌙) and 🌧 when it's raining.
- **Tiles**
  - Tap a tile to see its stats.
  - Every stat adds its own overlay (wildflowers, lush grass, dirt, pebbles, mycelium, glow), and the overlays stack.
  - Strong mixes become special tiles.
- **Field Guide**: grouped by creature family and item type, with glimmer slots and silhouettes for things you haven't found.
- **Debug menu (🐞)**: speed up time (60×, 600×, 3600×), skip ahead, show a stat overlay, give items, or give any species (normal or glimmer). Turn it off with `"debugTools": false` in `tuning.json`.

Progress continues while the app is closed. Everything is computed from real timestamps, so the forest catches up when you reopen it.

## Spawn table (design data)

`design/Undergrowth_Spawn_Table.xlsx` is the source of truth for species, items, spawn conditions, drop chances and geode loot.

After editing it (the blue cells), regenerate the content and art:

```bash
pip install openpyxl
```
```bash
python3 tools/import_spawn_table.py
```
```bash
python3 tools/gen_placeholders.py
```

- **Special effects:** creature "Special effect" text can't be read automatically, so its rules live in `design/creature_effects.json`, keyed by creature name. Anything not built yet is listed in a creature's details as "Not in the game yet". Right now that covers fossils, the underground layer, hybrid plants and visible fairy rings.
- **Gem effects** ("Crush into soil: +5 Stone on a tile for 24h") are read from the text.
- **Extra conditions** that are understood: night only, daytime only, during rain, only one per forest, planted during the day or at night, and checked once per day. Notes like "melts if left unpicked for a day" set a 24h lifetime.
- **Spawn stat scaling** (columns W–AB, "Damp scaling %/pt" … "Depth scaling %/pt"): each number is the % change in that item's spawn weight per point a tile stat sits above the item's minimum for it (0 if the item has no minimum). Negative numbers make an item rarer as that stat rises.
  - Multiplier = 1 + Σ (scaling ÷ 100) × max(0, stat − min). It is clamped to `spawns.scaling.minMultiplier`..`maxMultiplier` in `tuning.json` (0.25..4). Effective weight = base weight × multiplier.
  - Minimums, time of day, rain and one-at-a-time still gate whether an item can spawn at all.
  - If every scaling cell is left blank, the importer falls back to a rate per required stat by rarity: Common 1, Uncommon 1.5, Rare 2, Very rare 2.5, Legendary 3.
  - **Category first:** each spawn first picks mushroom, plant or geode (among categories that have something qualifying on that tile), then an item within it by effective weight.
  - **Category tilt:** a category's weight is `spawns.categoryWeights` × a multiplier from the tile's own-family stats (`spawns.categoryScaling`, % per point, clamped to 0.25..6). The default is +10% per point of Damp/Glow for mushrooms, Bloom/Verdure for plants and Stone/Depth for geodes. So an area full of Geode Critters turns up mostly geodes: one Common critter nearby gives about 50% geodes and 25% each of the others.
  - **Seeds** choose their plant when planted, using the same weights for that tile at that time. The choice is saved on the seed, so a plant item can carry its own `growthSprites` (otherwise the stages are the generic seed stages ending in the plant's sprite).
  - **Spawn inspector:** in 🐞 Debug, turn on "Spawn inspector", then tap any tile. It shows the tile's stats and every qualifying item with its base, multiplier, weight and % within its category, plus what a Mystery Seed planted there now could grow into.
- **Unclear sheet entries** and how I read them:
  - "Turns low ground into pond tiles" (Bog Wisp): Damp 25+ in its radius.
  - "Use on a creature source item" (Moonfall Shard): the next creature you find is a Glimmer.
  - "+10% Sproutling chance" (Hybridizer): ×1.1.

## Project layout

```
project.yml                     XcodeGen spec
App/                            iOS app (SwiftUI + SpriteKit)
  GameStore.swift               owns the Game, clock, saving, UI state
  Rendering/ForestScene.swift   top-down renderer, fit-to-screen camera, taps
  Rendering/TileMath.swift      grid ⇄ screen (16×16 tiles)
  Rendering/TextureCache.swift  sprite data → CGImage/SKTexture (nearest-neighbor)
  Screens/                      HUD, Burrow, Bag, Geode cracking, Field Guide
Packages/UndergrowthCore/       pure-Swift game logic (no UIKit), unit tested
  Sources/UndergrowthCore/
    Model/      stats, grid, creatures, placements, save state
    Sim/        StatEngine (ramp/decay/falloff), Game, Loot + pity
    Content/    Tuning + content definitions + loader/validator
    Sprites/    SpriteData format, SpriteRegistry
    Visuals/    TileRuleEngine (stats → ground/decorations/tint)
    Naming/     ForestNamer
    Persistence/SaveStore (versioned JSON)
  Sources/forest-preview/       renders a forest to an image (no device needed)
Resources/                      all data, copied into the app as a folder
  tuning.json                   every tuning number
  Content/*.json                creatures, items, loot, tile rules, name parts
  Sprites/**/*.json             one sprite per file; Sprites/Palettes/ for shared palettes
tools/gen_placeholders.py       regenerates the placeholder art (+ gen_topdown.py for tiles/overlays/shrubs,
                                gen_content_sprites.py for spawn-table entries, gen_ui.py for pixel UI
                                icons, gen_geodes.py for geode balls/crack stages/opened geodes)
web/fonts/                      Pixelify Sans (SIL OFL, licence included) for all UI text
tools/import_spawn_table.py     spreadsheet → Resources/Content JSON
design/                         the spawn table + creature effect definitions
```

## Data formats

### Sprites (`Resources/Sprites/**/<id>.json`)

```json
{
  "id": "creature.fungling",
  "size": [16, 16],
  "anchor": [8, 15],
  "palette": ["transparent", "#2b1d14", "#c4734a", "..."],
  "frames": [ { "duration": 0.6, "rows": ["......1111......", "..."] } ],
  "tags": ["creature"]
}
```

- **Rows** are written one character per pixel. Each character is a palette index in base-62 (`0-9a-zA-Z`), and `.` means index 0 (transparent). A palette can hold up to 62 colours, as `#RRGGBB` or `#RRGGBBAA`.
- **`paletteRef`** can replace `palette` to point at a shared palette in `Sprites/Palettes/`. The ground tiles use `pal.ground`.
- **`anchor`** is measured in pixel-edge coordinates from the top-left.
  - Objects anchor at their feet.
  - Ground tiles and overlays are 16×16 squares anchored at their centre `[8, 8]`. Shrubs and objects anchor at their base.
- **Missing sprite ids** render as a magenta "?" instead of crashing.

### Content (`Resources/Content/`)

| File | What it holds |
|---|---|
| `creatures.json` | Creature types: name, stats, sprite, optional `glimmerSprite` or `glimmerPaletteSwap` (palette index → colour). |
| `items.json` | Everything collectible: `category`, `rarity`, `sprite`, and an optional `spawn` rule. The spawn rule is `baseWeight`, plus `statWeights` (weight × `1 + Σ w·stat/100`) and `requires` (minimum/maximum stat thresholds). It also holds loot hooks: `onCollect`, `onCrack`, `onGrow` with `growthSprites`, and `groups`. |
| `loot.json` | Loot tables made of `rolls`. Each roll gives a `creature`, `item` or `group` pick. Options: `chance`, `count`, `minRarity`, `pity` / `rarityPity` counters, and `exclusive`. |
| `tileRules.json` | Visual rules, each with a `when` / `any` stat condition. **Ground**: the highest-priority match wins. **Decoration**: each matching rule may add one decoration, with probability `density`. **Tint**: a colour whose strength scales with a stat. |
| `nameParts.json` | Words used to name the forest, per stat. |

`tuning.json` holds all the numbers:
- grid size and slot count
- ramp and decay times, and the falloff curve
- creature trait ranges per type (keyed by creature id), and glimmer chance
- spawn rates, seed grow times, rarity weights, and pity thresholds

### User content

At launch the app also loads `Documents/UserContent/`, which uses the same layout as `Resources/`, minus `tuning.json`. Anything there with the same id **overrides** the bundled version, and anything new is added. A player-made sprite, plus an `items.json` entry with a `spawn` rule, joins the spawn pool and the Field Guide with no code changes. This is the hook for the future sprite editor.

Run `ContentDatabase.validate()` (covered by the unit tests) to catch missing sprite ids, unknown loot tables and malformed sprites.

### Preview without a device

```bash
cd Packages/UndergrowthCore
swift run forest-preview ../../Resources /tmp/forest.ppm 24
```

This command builds a forest, places the starter creatures, simulates 24 hours, and renders the result to an image using the real rules.

## Left out of v0.1, with room made for it

- **Friend visits:** `ForestState` is a self-contained snapshot.
- **Trading:** creatures have UUIDs and carry their own traits.
- **Keystone slot:** `slots` is a list of `{kind, placementID}`, so a keystone is just another kind.
- **New stats and resident animals:** stats and item categories are data strings.
- **Sprite editor:** this would use the user content root and `TextureCache.invalidate()`.

## Look and feel (web)

- **Font:** all text uses Pixelify Sans (SIL OFL), self-hosted in `web/fonts/` with its licence. The sizes are `--t-title` / `--t-head` / `--t-body` / `--t-small` / `--t-tiny` in `style.css`.
- **Pixel frames:** panels, buttons, tabs and cards use stepped, notched-corner frames built from box-shadows. There are no rounded corners or blur effects.
- **Icons:** pixel sprites in the registry (`ui.icon.*`, `ui.burst`), drawn by `tools/gen_ui.py`. There are no emoji.
- **Geodes:** each geode type has three data sprites, linked from its item (`crackSprites`, `openSprite`):
  - `item.geode.*`: a rounded stone ball.
  - `geode.crack.<id>.a` and `.b`: five crack stages as frames.
  - `geode.open.<id>`: the opened geode.
- **Creature radius:** every radius was doubled in the spreadsheet, and the glimmer radius bonus is now +2. Save version 4 doubles the radius of creatures you already own.
