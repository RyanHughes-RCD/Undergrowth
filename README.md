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
- **Start (no guided tutorial):** you arrive in the clearing with a few finds already waiting around the old log: 2 Brown Button Caps, a Red Toadstool, 2 Clovers and a Pebble Geode (`start.spawns` in `tuning.json`). They stay until picked.
  - One random mushroom or geode among them is guaranteed to hold a creature (`start.guaranteedCreatureRarity`, Common).
  - Forests saved mid-tutorial just carry on with the tutorial marked done. The old guided tutorial is still in the code, off (`tutorial.enabled: false`).
- **Creatures:** there's no cap on how many are out in the forest, and no slot bar. The **Creatures** tab lists who's out and who's resting.
- **Blend celebration:** fires once, the first time two creatures each give a tile `blend.minEach` or more.
- **Forest expansion:** the clearing grows by `ringTiles` (2) tiles on each side when the `expansion` conditions are met, at most every `minHoursBetween` hours. Newly revealed tiles fade influence in over `revealRampSeconds`, and nothing reaches past the treeline.
- **Starter tasks:** a few goals at a time appear under Tasks. Examples are picking 5 mushrooms, harvesting a seed, cracking 3 geodes, and having two creatures out at once. Each gives a reward to claim. They're defined in `Content/tasks.json` (text, counter, target, reward).
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
  - **Where spawns land (effect-driven):** each spawn attempt picks a free tile by weight (`spawns.locationWeighting`):
    - `weight = base × general`, capped at `maxWeight` (24).
    - `general = generalByEffectCount[effects] × (1 + min(maxIntensityBonus, perStatPoint × tile stat total))`.
    - `effects` counts: creatures whose influence reaches the tile, active soil boosts, special-effect areas, and combo tiles.
    - Defaults: by effect count 0 / 1 / 2 / 3+ = ×1 / ×3 / ×5 / ×7; `perStatPoint` 0.05; `maxIntensityBonus` 3.
    - The general bonus applies to every category. Which category spawns there still comes from the tile's own stats (`spawns.categoryScaling`, combos), so specialised tiles keep their identity.
    - Blank tiles weigh 1, and a spawn that lands on one only goes ahead `spawns.blankTileSpawnChance` of the time (0.35). Spawns never add effects, so there's no runaway.
    - It's rebuilt from saved state (creatures, boosts, stats), so it's identical after a reload, and it follows effects as they ramp, fade, move or expire.
    - Occupied tiles, landmarks and the treeline are never candidates, and the overall spawn rate is unchanged. Arriving wanderers use the same weights.
  - **Terrain affinity (what spawns on developed ground)** (`spawns.terrainAffinity`) makes a forest you've shaped look shaped:
    - An item whose stat needs are met on the tile gets × `byRarity` (common 6, uncommon 12, rare 30, very rare 80, legendary 250). So rare items show up on their own terrain far more often than their small base weights suggest.
    - It gets +`perExtraLevel` (0.25) for each intensity level the tile is above its need, up to `extraLevelCap` (2) levels.
    - Beyond `overshootGrace` (2) levels above its need, it fades by `overshootFadePerLevel` (0.25) per level. Rich ground therefore favours the items made for it over low-need commons.
    - Items with no needs (Brown Button Cap, Clover, Pebble Geode) fade by `genericFadePerLevel` (0.4) per intensity level, down to `genericMinFactor` (0.08), on ground that favours a different category. For example, Clover fades on Damp/Glow ground, but Brown Button Cap doesn't.
    - The spawn inspector's Mult column shows it as `t×…`.
    - In a one-day simulation of a starting clearing, these terrain items made up the following share of what spawned on developed tiles:
      - Damp + Depth commons: 62%
      - Bloom + Verdure: 51%
      - A lone Stone common: about 75%, counting Pebble Geodes
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

Every tile stat looks and plays differently, even within a creature pair. Each one is an **addition to the base grass**, never a whole-tile replacement, and grows through **9 intensity stages** at the thresholds in `visuals.intensityStages` (2, 4, 6, 9, 12, 16, 21, 27, 35). Low stages are a hint; high stages are dramatic. All behaviour numbers are in `tuning.json` under `terrain` and `combos`.

| Stat | Stage 1 | … | Stage 9 |
|---|---|---|---|
| Stone | a few gravel pebbles | small stone spikes | a tall spire cluster |
| Depth | dirt specks | dirt patches with roots | a big dirt patch with a burrow hole |
| Damp | dew glints | dark soaked grass | puddles |
| Glow | one or two faint motes | glowing moss dots | glowing caps and many motes |
| Bloom | one tiny flower | small flowers | dense blossoms |
| Verdure | a few extra blades | taller grass | a leafy thicket |

- **Stone lasts:** after its creature leaves, Stone fades at 0.25× the normal rate (`terrain.statDecayRate.stone`). Geodes on Stone-dominant tiles sit exposed: tap to collect.
- **Depth hides things:** items whose highest requirement is Depth (Cave Truffle, Deep Geode, Cave Lily…) are buried, and so are geodes on Depth-dominant tiles. They show as loose soil; tap to dig.
- **Elevation** (Stone up, Depth down) still steers Damp downhill. The old cliff-face drawing is off (`visuals.elevation.enabled`).
- **Damp spreads and pools:**
  - An ambient Damp layer (`terrain.ambientDamp`, saved in `state.ambientDamp`) sits on top of creature Damp, so creature ramp-up and fading are unchanged.
  - Each spawn tick it seeps into wetter-to-drier neighbours, flows more easily downhill, and evaporates more slowly on low ground, so hollows turn boggy. High Stone blocks it.
  - Damp tiles grow mushrooms faster: each wet tile gets an extra mushroom-only chance of (normal per-tile rate × min(1, Damp × 0.08)), so at most ×2 its usual mushroom rate per tick (`terrain.damp.mushroomGrowth`). It's proportional per tile, so a few wet tiles never hog the forest.
- **Glow follows the clock:**
  - Its effect on spawn weights, and on the forest's category and location weighting, is ×0.4 by day and ×1.6 at night (`terrain.glowCycle`, device local time).
  - Deep tiles glow at full strength even by day.
  - Its stage is drawn from Glow × the time factor, so it's faint by day and strong at night, with a pixel halo.
- **Bloom has a daily rhythm:**
  - It opens from 6:00, peaks at 12:00 and closes by 19:00, from ×0.15 to ×1.3 (`terrain.bloomCycle`). Its effect on spawn weights follows this cycle.
  - Its stage follows the cycle; petals drift while it's open, and buds close at night.
  - High Bloom flattens plant weights for more variety (`terrain.bloom.varietyPerPoint`).
  - It attracts wanderers: they favour blooming tiles and arrive more often there (`wandererBonusPerPoint`).
- **Verdure is mass, speed and hiding:**
  - Seeds grow faster on lush tiles (`seedGrowthPerPoint`), and plants there drop extra seeds (`extraSeedPerPoint`).
  - At Verdure ≥ 30 (`hideThreshold`), surface spawns are hidden in tall grass with an occasional rustle. The first tap reveals them; the next collects.
- **Combo tiles** (`combos` in `tuning.json`) are the core of the game:
  - **Shallow pool (Damp + Depth):** the ground pools with water, a small ecosystem of its own.
    - **Shape:** pool tiles are autotiled. A lone tile is a rounded puddle, and neighbouring tiles join seamlessly with rounded inside corners.
    - **Shoreline:** thin and broken, made of soil, mud and dark wet grass. It's stable because it comes from a world-pixel hash.
    - **Sparkles:** brief, unsynchronised glints coloured for the time of day: warm by day, soft at dawn and dusk, rare silver-blue at night.
    - **Lily pads:** connected pools of 6 or more tiles (`combos.pool.lilyPads`) may get pads, with a 75% chance per pool. A pool gets 1 pad, plus one more for every 6 extra tiles, up to 5, sometimes with a flower. Pools are found as connected regions, recomputed only when the set of pool tiles changes. The pads are deterministic: the same after a reload, never duplicated.
    - **Water Reed:** a new plant in the spreadsheet with the "Shallow water only" condition (`spawn.terrain: "pool"`). It spawns only on pool tiles, is likelier next to another reed ("Grows in clusters", ×2.5), and is flipped for variety.
    - **Splashes:** a creature wading through a pool splashes when it enters a pool tile, then every 0.65 s while moving. They're pooled and short-lived.
    - Only Damp-loving items spawn on water.
  - **Mossy bank (Stone + Damp + Verdure):** moss grows over the ground and the stone spikes, and bugs gather (beetles by day, fireflies at night).
  - **Wild meadow (Bloom + Verdure):** a tangle of flowers in long grass. Plants are favoured ×3 in spawn rolls. Each meadow tile gets an extra plant-only chance per tick (normal rate × min(2.5, (Bloom + Verdure) × 0.06), `combos.meadow.plantGrowth`). Mystery Seeds grow ×2.5 faster there.
- **Tile art:** `Resources/Content/tileRules.json`. A rule with `"staged": true` and `"stat"` expands into the 9 stages (`ov.<stat>.s1a`… / `deco.spikes.<n><v>`). Combo layers use `combo_<id>`. The art is made by `tools/gen_terrain.py`; the water is drawn by the renderer.
- **Plants:** every plant has its own grown sprite and its own bud stage (`plant.bud.<id>`). A Mystery Seed shows planted, then sprout, then that plant's bud, then the plant itself.
- **Spawn placement:** item data `spawn.placement` is `surface`, `buried` or `auto` (the default). In the spreadsheet, an optional "Placement" column overrides it per item.
- **Debug:** the spawn inspector shows elevation, dominant stat, any combo, each stat's intensity stage, ambient Damp, the Glow and Bloom factors, and how spawns sit on that tile. It also tags each item that would be buried, hidden or exposed.

## Tile intensity and the Terrain guide (web)

- **Intensity, not numbers:** players never see a tile's raw stat value. One shared mapping (`intensityOf` in `web/js/core.js`, bands in `tuning.json` → `intensity`) turns a value into a label:

  | Raw value | Intensity |
  |---|---|
  | 0–5 | No Intensity |
  | 6–15 | Low |
  | 16–25 | Moderate |
  | 26–35 | Moderate+ |
  | 36–45 | Medium |
  | 46–55 | Medium+ |
  | 56–65 | High |
  | 66–75 | High+ |
  | 76–85 | Very High |
  | 86–100 | Maximum |

  The stat cap is 100, so 96–100 also show Maximum.
- **Below 6 is inactive everywhere (`intensity.minInfluence`):** the game's tile stats (`statField`, `tileStats`) zero anything under 6, so it counts for nothing in visuals, item requirements, category and location spawn weighting, effect counts, combos, terrain and placement. Raw values stay in saves and in the ambient-Damp simulation.
  - Two thresholds that sat below 6 moved to 6: the Mossy bank combo (was 5 of each stat) and blend detection (was 3).
- **Where it shows:**
  - The tile card names the tile's terrain and shows each active stat as a nine-pip meter (filled vs hollow, not colour alone), with no words or numbers.
  - Creature traits show what the creature gives at full strength on its own tile.
  - Everywhere else intensity is a small inline meter too: Field Guide requirements, terrain pages ("needs" and "has" for your selected tile), spawn bonuses, creature traits, and gem uses. A half-filled pip means a requirement sits partway through that level (20 = two full pips and a half), so the true threshold is never overstated. Amounts below the floor read "a touch of Stone".
- **Raw values are developer-only:** the spawn inspector (raw value plus label), stat overlay and spawn heatmap live in developer mode, and switch off when you leave it.
- **Field Guide → Terrain:** Forest floor, Stony ground, Dug earth, Damp ground, Glowing ground, Flowering ground, Lush grass, Shallow pool, Mossy bank, Wild meadow, Treeline (`Resources/Content/terrain.json`).
  - **Discovery:** a terrain is discovered the first time it appears in your clearing (a stat reaching Low, or a combo forming). It's saved with the other guide discoveries (`terrain:<id>`), and older saves discover whatever is already in their clearing.
  - **Illustrations:** built from the game's own sprites: rising stages across six tiles, a joined pond for pools, bushes for the treeline.
  - **Each page:** what makes the terrain appear (as intensities), what can spawn there, the spawn bonuses (named as bonuses, at named intensities), other properties, and the selected tile's current intensity against what's needed. All of it is computed from `tuning.json`.
  - **Developer mode** can open every entry (marked as a developer view) without marking it found.

## Named terrains (web)

> Creature family balance: sproutlings (found only when a planted Mystery Seed finishes growing) have 3× the find chance of the other families (common 12%, uncommon 9%, rare 4.5%, very rare 1.5%, legendary 0.3%), since a forest yields far fewer harvests than mushroom picks or cracked geodes.

Where two stats meet on a tile, the ground becomes a named terrain with its own art, Field Guide page and spawns (`tuning.terrains`, `Resources/Content/terrain.json`).

- **How one forms:**
  - Pairs need both stats at 10 or more (Low intensity). Two neighbouring common creatures of different stats make a small patch of 3–6 tiles.
  - The four legendary triples need all three stats at 30 or more.
- **Which one shows:** a tile shows one terrain. A triple beats a pair; between pairs, the one whose stats add up highest wins.
- **Existing combos still apply:** Damp + Depth stays a Shallow pool and Bloom + Verdure a Wild meadow; they work alongside these.
- **Overlap with pools:** only Glowworm Grotto draws its art over pool water. The others don't draw over pools.

| Stats | Terrain | Rule | Home finds |
|---|---|---|---|
| Damp + Glow | Foxfire Fen | home ×2 at night | Foxfire Button, Blue Stain Cap, Glowcap, Moonlight Morel |
| Damp + Bloom | Rain Garden | home ×3 in rain | Violet, Bloom Bonnet, Trillium, Bluebell, Coral Fungus, Ghost Orchid |
| Damp + Stone | Dripstone Ledge | mushrooms ×2 | Pebble Cap, Shelf Fungus, Mossy Geode |
| Damp + Verdure | Fernbrake | spawns land ×1.6 | Fern, Moss Tuft, Chanterelle, Puffball, Lion's Mane, Pitcher Plant |
| Glow + Stone | Crystal Outcrop | geodes ×2 | Crystal Cap, Glimmering Geode, Amethyst Deceiver |
| Glow + Depth | Lantern Hollow | home ×2 at night | Foxfire Button, Hollow Root, Ghost Fungus, Deeproot Lantern |
| Glow + Bloom | Moonlit Garden | home ×3 at night | Moonflower, Glowbloom, Starlight Bonnet |
| Glow + Verdure | Wisp Thicket | home ×2 at night | Foxfire Button, Sorrel, Deeproot Lantern |
| Bloom + Stone | Rock Garden | home ×2 by day | Moss Rose, Stonecrop, Crystal Thistle |
| Bloom + Depth | Sunken Garden | plants ×2 | Hollow Root, Cave Lily |
| Stone + Depth | Geode Bed | geodes ×3 | Earthstar, Deep Geode, Pebble Geode |
| Stone + Verdure | Overgrown Rocks | spawns land ×1.5 | Pebblewort, Rootbound Geode |
| Depth + Verdure | Root Tangle | plants ×2 | Hollow Root, Turkey Tail, Deeproot Lantern |
| Damp + Glow + Depth | Glowworm Grotto | home ×2 at night | Ancient Sporecrown, Cave Truffle, Ghost Fungus, Glowcap |
| Bloom + Verdure + Depth | Heartwood Grove | home ×2 by day | Heartwood Sapling, Cave Lily, Sunpetal, Foxglove |
| Glow + Stone + Depth | Heartstone Vein | geodes ×3 | Ancient Heartstone, Deep Geode, Glimmering Geode, Crystal Cap |
| Damp + Glow + Stone | Amethyst Seep | home ×2 at night | Amethyst Deceiver, Crystal Cap, Mossy Geode, Glowcap |

- **Spawns:**
  - Home finds get ×`homeMult` (3) on top of the rarity weighting (`spawns.terrainAffinity`), and only once their own stat needs are met.
  - Category rules apply after the category clamp, so they still count on strong ground.
  - A terrain tile counts one more effect when choosing where spawns land.
  - The spawn inspector shows the home factor as `h×…`.
- **New low-level commons:**
  - Foxfire Button: a mushroom that needs Glow 10.
  - Hollow Root: a plant that needs Depth 10.
  - Together with Pebble Cap (Stone 10) and Sorrel (Verdure 10), every stat now has a find that shows up around a single common creature.
- **Loosened uncommons:** Blue Stain Cap now needs Damp 20 (was 30) and Wild Strawberry needs Verdure 20 (was 30), so a single rare creature unlocks an uncommon.
- **Art:** `tools/gen_terrain.py` (`named_terrain_art`) draws `ov.terrain.<id>.a/b`. Glowing terrains twinkle. The tile rules put them in one overlay group, above Glow.
- **Note on regenerating sprites:** creature sprites are kept as they are. Their colours come from their stats, and the rebalance changed those stats, so restore `Resources/Sprites/creature` after running `tools/gen_placeholders.py` unless you want them recoloured.

## Creature balance and interactions (web)

- **Balance** lives in `design/creature_balance.json`: per-rarity rules plus each creature's stats and variant. `tools/balance_creatures.py` writes it into the spreadsheet (Stat 1/2, a new optional Stat 3, bonuses, radius, ramp), which stays the source of truth; `tools/import_spawn_table.py` builds the content.

  | Rarity | Primary (at its tile) | Secondary | Third | Radius | Ramp |
  |---|---|---|---|---|---|
  | Common | 24 (Moderate) | none: single-stat specialists | | 2 | 12h |
  | Uncommon | 34 (Moderate+) | 12 for some (pure or dual) | | 3.5 (was 4) | 18h |
  | Rare | 46 (Medium) | 24, often cross-family | | 5 (was 6) | 24h |
  | Very rare | 60 (Medium+) | 36 | | 6.5 (was 8) | 36h |
  | Legendary | 80 (High+) | 50 | 24 | 8 (was 10) | 48h |

  - **Variants** keep creatures of the same rarity distinct: focused (×1.2, radius −0.5), broad (×0.85, radius +1), pure (no secondary, ×1.1), dual (×0.9, secondary ×1.4).
  - **Rolls** are now 80–100% (`creatureRoll.bonusRange`), so each creature's identity is consistent.
  - **Combinations:** commons combine, for example Damp + Depth commons make a pool and Bloom + Verdure commons make a meadow; no single common makes a combo.
  - **Footprint:** a legendary is 2.5× stronger than before but covers about the same number of tiles.
- **Owned creatures:** when `creatureRoll.balanceVersion` changes, creatures in a save take their species' new values once on load. Each keeps its name, glimmer status, origin and place in the forest, with a stable roll quality from its id.
- **Batch geode cracking:** bag rows with 2 or more geodes get a "×N" button, up to `geodes.batchMax` (5).
  - Each geode is cracked on its own (its own roll and find record), and rewards are granted and saved before anything is shown.
  - The screen is built for five: a 3 + 2 grid of result cards that crack open one after another. Tap to show everything; rare and better rewards and creatures are highlighted; Continue is always visible.
  - Single cracking is unchanged.
- **Creature interactions** (`interactions` in `tuning.json`) happen between creatures whose influence reaches overlap.
  - **Cosmetic moments** (renderer only, never stats or positions): a heart as two creatures meet, hopping together, a chase, a visit, or facing each other. One plays every 5–12 s somewhere on screen, with a 35–80 s cooldown per pair. Each ends on a timer and the creatures go back to wandering.
  - **Reward moments** (game logic, saved): on each spawn tick an eligible pair has a 2% chance to interact (then a 3-hour cooldown). 4% of those, up to ×1.6 for rarer creatures, leave a bonus Mystery Seed planted (60%) or a geode dug up (40%) on a free clearing tile nearby, through the normal seed and spawn systems.
  - **Cap:** at most 3 rewards per day. In simulation: one pair gives about one every 4–5 days, 8 creatures about 2.3 a day, 20 creatures hit the cap.
- **App icon:** a plain brown-capped mushroom with no face, in a dark forest with a few patches of canopy light taken from `web/img/canopy.png` (`tools/gen_app_icon.py`).

## Developer mode (web)

A separate test forest for trying any content or combination without touching your real save.

- **Turn it on:** tap 🐞 (top right), then **Enter developer mode** (or **…with a copy of my forest**). You can also open the game with `?dev=1` in the URL; `?dev=0` turns it off. It stays on across reloads until you turn it off. The 🐞 button turns orange with a **DEV** tag while it's on.
- **Save isolation:**
  - The real forest lives in `localStorage` key `undergrowth.forest.v1`; the test forest in `undergrowth.forest.dev`.
  - Entering developer mode saves the real forest and keeps a backup copy (`undergrowth.forest.v1.backup`).
  - While it's on, nothing is written to the real key. Test forests are marked (`state.dev`), and saving one over the real forest is refused.
  - **Back to my forest** reloads the real forest exactly as it was. Time speed is remembered separately for each.
- **Unlock:**
  - **Unlock everything:** every species and its glimmer, 5 of every item, the whole Field Guide, and the clearing grown to the whole map.
  - Or each part on its own.
- **Try combinations:**
  - Pick any species, choose full strength and/or glimmer, then tap tiles to place them (there's no limit).
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
- **Grass:** a deeper, verdant forest green (the ground palette in `tools/gen_placeholders.py`), so every grass tile, variant and overlay stays consistent.
- **Tree shadows (canopy):**
  - **Source:** your asset, `design/canopy_source.webp`, is a black shade layer whose see-through holes are sunlight.
  - **Processing:** `tools/gen_canopy.py` turns it into `web/img/canopy.png` (a 600×475 seamless light mask; `FLECK_W` sets the size, bigger means fewer, larger patches of light). It scales the flecks to a few art pixels, removes any fleck touching the tile edge so tiles join with no seams, and quantises the soft edges into pixel steps.
  - **One layer:** every light patch comes straight from your asset, with even shade around it. The texture is large (about 37 × 30 tiles), so repeats are rare. An optional faint second fleck layer (`visuals.canopy.second.alpha`) and a soft "clearings" layer (`region.strength`) can be turned back on to hide repetition. Both are off (0), because they made some patches fade in more softly than others.
  - **Rendering:** it's built each frame at one buffer pixel per art pixel for just the view, then scaled up without smoothing, so it's crisp at any zoom with no moiré. It's world-anchored, so it stays stable while panning, with only a slow 3 px sway.
  - **Settings:** `visuals.canopy`.
- **Day and night (real local clock):** the hours are in `clock` in `tuning.json`: dawn 5:00–7:00, day 7:00–17:00, dusk 17:00–19:00, night 19:00–5:00. Lighting blends across 50 minutes around each boundary (`clock.transitionMinutes`). The same night range drives night-only spawns and Glow.
  - Each state sets the canopy shade and light strength and colour, a scene-wide ambient tint (multiply), firefly amount and sparkle colour (`visuals.lighting.states`):
    - **Day:** full-strength canopy and warm sun flecks, no tint.
    - **Dawn:** softer shade, peach light, a pink-warm tint.
    - **Dusk:** amber light, a dusky tint, the first fireflies.
    - **Night:** silver-blue moonlight through the canopy, a cool tint, full fireflies.
  - The lighting is recomputed every 5 s and right away when the app comes back from the background, never per frame.
  - **Fireflies** are a pure function of tile and time: about 7% of tiles at full night, capped at 60. There are no particle objects, so nothing leaks, nothing runs while the app is hidden, and they're simply there on return.
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
