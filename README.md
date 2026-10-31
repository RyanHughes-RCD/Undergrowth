# Undergrowth (working title)

A cozy isometric pixel-art forest floor. Place creatures and they slowly reshape the land around them. The forest's look comes from whatever mix of stats each tile ends up with. Plants, mushrooms and geodes sprout across the forest for you to collect.

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

## How to play (v0.1)

- **Burrow** lists your creatures. Pick one, choose *Place in forest*, then tap an empty tile. You have 3 slots.
- A placed creature's influence **ramps up over about 6 hours** of real time, out to its radius. The progress bar under each slot shows how far along it is.
- *Return to Burrow* brings the creature back right away. Its effect on the land **fades over about 12 hours**.
- Tap a bare tile to see its six stats. Tap a placed creature to see its influence ring.
- **Mushrooms**, **plants** and **geodes** spawn over time, more often where the land suits them. Tap one to pick it or dig it up.
  - Rare mushrooms sometimes hold a Fungling.
  - Plants can drop seeds. Plant a seed from the Bag, and it grows over a few hours. Sometimes a Sproutling comes up instead of a plant.
  - Geodes give a rough rock. Open the Bag and choose *Crack*, then tap the rock until it bursts open. Inside is a gem, or now and then a Geode Critter.
  - Pity counters guarantee the rare result after enough misses.
- **Guide** is the Field Guide. Undiscovered entries are silhouettes, and glimmer creatures have their own slots.
- Tap the forest name to rename it. If you leave it unnamed, it names itself from its strongest stats.
- Pan with one finger and pinch to zoom. Zoom snaps to whole-pixel scales so the art stays crisp.
- The 🐞 menu holds debug tools: skip time, a stat-overlay heatmap, free items, glimmer creatures, and reset. Turn it off with `"debugTools": false` in `tuning.json`.

Progress continues while the app is closed. Everything is computed from real timestamps, so when the app reopens it catches up on the missed time.

## Project layout

```
project.yml                     XcodeGen spec
App/                            iOS app (SwiftUI + SpriteKit)
  GameStore.swift               owns the Game, clock, saving, UI state
  Rendering/ForestScene.swift   isometric renderer, camera, taps
  Rendering/IsoMath.swift       grid ⇄ screen projection
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
tools/gen_placeholders.py       regenerates the placeholder art
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
  - Ground tiles are 32×24 (a 32×16 diamond plus an 8px side), anchored at the diamond centre `[16, 8]`.
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
