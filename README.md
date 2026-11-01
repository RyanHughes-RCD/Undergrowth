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
  - **Where spawns land (effect-aware):** each spawn attempt picks a free tile in the clearing by weight instead of uniformly. The weight is `base + perStatPoint × (sum of the tile's six stats) + perSource × (creatures whose influence reaches the tile + active soil boosts on it) + perEffect × (creature special effects covering it)`, capped at `maxWeight` (`spawns.locationWeighting` in `tuning.json`, defaults 1 / 0.3 / 3 / 1.5 / 40).
    - Overlapping creatures add up. With nothing active every tile weighs 1, which is the old uniform pick.
    - It is recomputed every spawn tick, so it follows creatures as they ramp, decay or move, and boosts as they expire.
    - Occupied tiles, landmarks and the treeline are never candidates. The overall spawn rate is unchanged.
    - Wanderers arriving use the same weights.
    - In testing, about 5× as many spawns landed near creatures as their share of the map; in the starting clearing it was about 3×.
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

## Each stat's identity (web)

Every tile stat looks and plays differently, even within a creature pair. All the numbers are in `tuning.json` under `terrain` (behaviour) and `visuals` (`elevation`, `glowLight`, `petals`).

- **Elevation:** each tile's height comes from its stats, from −1 to 1: Stone raises it and Depth lowers it (`terrain.elevation`). A raised tile casts a rock face onto the tile below it and gets a lit lip; a sunken tile gets a shadowed back wall.
- **Stone builds upward and lasts:**
  - Looks: rocky ground, then rocks, boulders, ledges and cliff tops.
  - After its creature leaves, Stone fades at 0.25× the normal rate (`terrain.statDecayRate.stone`), so rocky areas stay as landmarks.
  - Geodes on Stone-dominant tiles sit exposed on the surface: tap to collect.
- **Depth digs downward and hides things:**
  - Looks: bare dark soil, burrows, holes, then cavern openings; fairly empty on top.
  - Items whose highest requirement is Depth (Cave Truffle, Deep Geode, Cave Lily…) are buried, and so are geodes on Depth-dominant tiles.
  - Buried things show as loose soil; tap to dig them up and find out what they are.
- **Damp spreads and pools:**
  - An ambient Damp layer (`terrain.ambientDamp`, saved in `state.ambientDamp`) sits on top of creature Damp, so creature ramp-up and fading are unchanged.
  - Each spawn tick it seeps into wetter-to-drier neighbours, flows more easily downhill, and evaporates more slowly on low ground, so hollows turn boggy. High Stone blocks it.
  - Looks: dark wet soil, puddles and drips; bog on low wet ground.
  - Damp tiles grow mushrooms faster: extra mushroom-only spawn attempts, weighted to wetter tiles (`terrain.damp.mushroomGrowth`).
- **Glow follows the clock:**
  - Its effect on spawn weights, and on the forest's category and location weighting, is ×0.4 by day and ×1.6 at night (`terrain.glowCycle`, device local time).
  - Deep tiles glow at full strength even by day.
  - Looks: a faint shimmer by day, a strong pixel halo at night.
- **Bloom has a daily rhythm:**
  - It opens from 6:00, peaks at 12:00 and closes by 19:00, from ×0.15 to ×1.3 (`terrain.bloomCycle`). Its effect on spawn weights follows this cycle.
  - Looks: flowers and drifting petals while open; closed buds at night.
  - High Bloom flattens plant weights for more variety (`terrain.bloom.varietyPerPoint`).
  - It attracts wanderers: they favour blooming tiles and arrive more often there (`wandererBonusPerPoint`).
- **Verdure is mass, speed and hiding:**
  - Looks: thick grass, tall foliage, and vines over rocks.
  - Seeds grow faster on lush tiles (`seedGrowthPerPoint`), and plants there drop extra seeds (`extraSeedPerPoint`).
  - At Verdure ≥ 30 (`hideThreshold`), surface spawns are hidden in tall grass with an occasional rustle. The first tap reveals them; the next collects.
- **Interactions:** Damp pools in low (Depth) ground; Stone blocks Damp; deep tiles glow by day; Verdure grows moss and vines over Stone; Bloom draws wanderers.
- **Tile art:** `Resources/Content/tileRules.json` matches on each stat's share of the tile's total (`share_stone` …), plus `elev`, `glowVis` and `bloomVis`, so the dominant stat drives the look. The art is generated by `tools/gen_terrain.py`.
- **Terrain table:** `design/Undergrowth_Terrain_Table.xlsx` holds every tile rule (ground tiles, overlays, decorations, tints) plus new terrain ideas. Edit the blue cells, set a row's Status to "In game", then run `python3 tools/import_terrain_table.py --stubs` to rewrite `tileRules.json` and create placeholder art for new sprite ids. `--check` previews the changes without writing.
- **Spawn placement:** item data `spawn.placement` is `surface`, `buried` or `auto` (the default). In the spreadsheet, an optional "Placement" column overrides it per item.
- **Debug:** the spawn inspector shows elevation, dominant stat, ambient Damp, the Glow and Bloom factors, and how spawns sit on that tile. It also tags each item that would be buried, hidden or exposed.

## Developer mode (web)

A separate test forest for trying any content or combination without touching your real save.

- **Turn it on:** tap 🐞 (top right), then **Enter developer mode** (or **…with a copy of my forest**). You can also open the game with `?dev=1` in the URL; `?dev=0` turns it off. It stays on across reloads until you turn it off. The 🐞 button turns orange with a **DEV** tag while it's on.
- **Save isolation:**
  - The real forest lives in `localStorage` key `undergrowth.forest.v1`; the test forest in `undergrowth.forest.dev`.
  - Entering developer mode saves the real forest and keeps a backup copy (`undergrowth.forest.v1.backup`).
  - While it's on, nothing is written to the real key. Test forests are marked (`state.dev`), and saving one over the real forest is refused.
  - **Back to my forest** reloads the real forest exactly as it was. Time speed is remembered separately for each.
- **Unlock:**
  - **Unlock everything:** every species and its glimmer, 5 of every item, the whole Field Guide, 6 slots, and the clearing grown to the whole map.
  - Or each part on its own. Creature slots can be set to 3, 6, 9 or 12.
- **Try combinations:**
  - Pick any species, choose full strength and/or glimmer, then tap tiles to place them. A slot is added if all are full.
  - **Remove all creatures** (instantly), **Max strength now**, **Clear wild spawns** and **Run 20 spawn ticks** (to see where things turn up).
- **Saved setups:** name and save the current test forest, then load it back later to flip between garden configurations.
- **Views** (both modes):
  - **Spawn heatmap:** tints tiles by spawn-location weight.
  - **Spawn inspector:** tap a tile for its stats, location weight breakdown and item odds.
  - **Stat overlay.**
- Normal mode keeps only time speed, skip ahead, views and the tutorial/reset tools. Giving items and creatures is in developer mode only.

## Look and feel (web)

- **Font:** all text uses Pixelify Sans (SIL OFL), self-hosted in `web/fonts/` with its licence. The sizes are `--t-title` / `--t-head` / `--t-body` / `--t-small` / `--t-tiny` in `style.css`.
- **Pixel frames:** panels, buttons, tabs and cards use stepped, notched-corner frames built from box-shadows. There are no rounded corners or blur effects.
- **Treeline:** the edge bushes and the ground under them use deep, shadowed greens (`SHRUB_PALETTES` and the edge palette in `tools/gen_topdown.py`), so the clearing has a clear dark border.
- **Movement:** wild spawns (mushrooms, plants, geodes, seed stages) stand still and show their first frame. Placed creatures keep their animation and wander inside their influence radius around the tile they were placed on: walk, pause, repeat, staying in the clearing. This is visual only; their influence still comes from the placement tile, and tapping a creature wherever it is selects it.
- **Canopy light:** a faint dappled-sunlight overlay sways slowly over the forest, so creatures feel small under big trees. The mask is `web/img/sunlight.png`, made by `tools/gen_sunlight.py` from the reference picture's layout. It's seamless and world-anchored, so it moves with the ground when you pan. Settings are in `visuals.sunlight` in `tuning.json`: opacity 0.16, shade 0.1, sway, drift, scale, and night dimming (×0.3). To use a different image, save a seamless greyscale PNG over that file.
- **Numbers:** UG Numerals (`tools/gen_numeral_font.py`, `web/fonts/ug-numerals-*.woff2`) is a tiny pixel font on Pixelify Sans' grid that covers only digits and number punctuation (`% + , . / : × −`), via `unicode-range`.
  - Slashed 0, flat-topped open 3, square-cornered 5, footed 1.
  - Every digit is the same width, so counters and timers don't shift.
  - All other text is still Pixelify Sans.
- **Geodes in the forest:** each geode has a world sprite (`geode.world.*`, linked as `worldSprite`): the stone half-buried in a raised dirt mound with a dark seam at its base. The bag, guide and cracking screens keep the plain stone. Tap targets and rewards are unchanged.
- **Icons:** pixel sprites in the registry (`ui.icon.*`, `ui.burst`), drawn by `tools/gen_ui.py`. There are no emoji.
- **Geodes:** each geode type has three data sprites, linked from its item (`crackSprites`, `openSprite`):
  - `item.geode.*`: a rounded stone ball.
  - `geode.crack.<id>.a` and `.b`: five crack stages as frames.
  - `geode.open.<id>`: the opened geode.
- **Creature radius:** every radius was doubled in the spreadsheet, and the glimmer radius bonus is now +2. Save version 4 doubles the radius of creatures you already own.
