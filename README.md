# Undergrowth (working title)

A cozy top-down pixel-art garden in a forest clearing, framed by a shrub treeline around an old log. The design for the garden (plant, grow overnight, harvest) is in `design/garden_rework.md`.

> **Work in progress:** the rework is being built in phases. This commit is phase 1: the old systems are gone (creatures, geodes, relic fields, wild spawning, the Spirit Well) and the clearing, the Old Log, decor, the opening and the foraging patch remain. Planting arrives in phase 2.

## Running it

### Web game (play in a phone browser)

`web/` is a dependency-free JavaScript game. It reads all its data from `Resources/` (`tuning.json`, `Content/*.json`, `Sprites/`).

```bash
python3 tools/build_web.py
```
```bash
python3 -m http.server -d dist 8000
```

Then open <http://localhost:8000>.

- **Live:** the workflow `.github/workflows/pages.yml` builds and deploys it to GitHub Pages on every push that touches `web/`, `Resources/` or the build script. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
- **On iPhone:** open the Pages URL in Safari, tap Share, then *Add to Home Screen*. It launches full-screen like an app.
- **Saves:** stored in the browser's `localStorage` (`undergrowth.forest.v1`). Safari may clear them after a long period without visiting.

### iOS app

Requirements: Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
xcodegen generate
open Undergrowth.xcodeproj
```

The iOS app and its Swift package (`Packages/UndergrowthCore`) are an older port of the creature-era game. They are not part of the garden rework. They still load the shared `Resources/` folder (catalogue items, sprites) and read their own frozen tuning, `Resources/ios/tuning.json`. With no creatures or wild spawns left in the data they show an empty forest. Tests:

```bash
cd Packages/UndergrowthCore && swift test
```

## Saves from before the garden

The garden is a new game, so older forests aren't carried over:

- When the game loads a save older than version 7, it copies it, untouched, to `undergrowth.forest.v1.archive.v<old version>` (for example `…archive.v6`) and starts a fresh garden.
- The fresh garden keeps the old save's **Field Guide discoveries**. A card says so once ("A fresh garden").
- Developer test saves do the same under their own key.
- A save from a newer version is kept aside as `….newer`; one that can't be read is kept as `….corrupt`.

## The garden (web)

- **The clearing:** a 7×14 clearing in the middle of the 40×56 forest (`tuning.json` → `grid`, `clearing`). At full zoom-out the clearing plus a thin treeline border (`visuals.viewBorderTiles`) fills the screen width at a crisp whole-pixel scale. Drag to look around; pinch to zoom in.
- **The Old Log**, a mossy two-tile stump, sits at the centre (`Content/landmarks.json`). Tap it for the Old Log board and the Store.
- **The opening** (no guided tutorial, no instructions):
  - The clearing is a little grotto: mossy rocks, ferns and roots along its edge (`start.scenery`, visual only).
  - An old seed tin waits by the log (`start.tin`). Tapping it shows the words on its lid, then five quiet questions with four answers each (`Content/opening.json`). No answer names a school or a mechanic. Each answer adds weight to one or two schools, and the highest total chooses the garden's starting school.
  - `python3 tools/check_opening.py` checks the weights: every school can be chosen, and over every possible set of answers the shares are 13–19%.
- **The foraging patch** (`tuning.json` → `forage`, on by default): plain finds turn up by chance on the clearing's outer ring, by the treeline. They are Brown Button Cap, Clover, Sorrel and Meadow Daisy.
  - Every hour of game time has a 30% chance of one, up to 3 waiting at once.
  - Away time counts (up to 48 hours).
  - Which hour gets a find, its tile and the item are hashed from the garden seed and the hour, so it's deterministic.
  - Tap one to pick it. `forage.enabled: false` turns the patch off.
- **Decor:** props from the Store go in the Bag under Decor. Place one on an open tile, then tap it to move it, recolour it or put it away.
- **Room to grow:** a line of Store upgrades. Each pushes the treeline back `expansion.ringTiles` (2) on each side.
- **Field Guide:** tabs for Mushrooms, Plants (the Plant & Fungi Catalogue) and Visitors. Unfound entries are silhouettes.
- **Visitors** (`Content/visitors.json`) are kept as data and Field Guide entries. Their old preferences were school ground, which no longer exists, so they don't visit until phase 4 reworks them around plants.
- **Time:** the real local clock (`tuning.json` → `clock`). Everything runs on timestamps, so the garden catches up when the game reopens.

## The Plant & Fungi Catalogue

`design/Undergrowth_Catalogue.xlsx` lists every plant and fungus: name, category (Mushroom or Plant), rarity, school (blank = plain ground) and a Field Guide description. It replaces the old spawn table, whose creatures, geodes, gems and spawn rules were removed.

```bash
pip install openpyxl
```
```bash
python3 tools/import_catalogue.py
```

This writes `Resources/Content/items.json` (127 entries; ids `<category>.<slug>`, sprites `item.<id>`). Re-running it with an unedited spreadsheet changes nothing. Then regenerate any new art with `python3 tools/gen_placeholders.py`.

## Offerings: the Store and the Old Log (`design/Undergrowth_Offerings.xlsx`)

- **Requests:** one row per Store listing or Old Log request. It holds up to four items with counts, a reward (`cosmetic`, `unlock` = `expansion`, or `item`), gating (Field Guide entries, another request done first, a garden day) and text.
- **Cosmetics:** decor props: id, name, sprite, size, colours (`Name #hex`, the first is the art's own), text.
- **How to use** and **Lists** (valid ids for the Check formulas).
- `python3 tools/import_offerings_table.py` writes `requests.json` and `cosmetics.json`.
  - `--check` previews; `--stubs` writes placeholder sprites for new decor.
  - Only "In game" rows are exported.
  - Re-running it changes nothing: JSON is only rewritten when it changes, and the workbook only when its Lists sheet or Check formulas are out of date.
- `tools/gen_offerings_sprites.py` draws the placeholder decor, the relic ornaments and the board icon.

## Developer mode (web)

A separate test garden for trying anything without touching your real save.

- **Turn it on:** tap 🐞 (top right), then **Enter developer mode** (or **…with a copy of my garden**). Opening the game with `?dev=1` in the URL also turns it on, and `?dev=0` turns it off. It stays on across reloads until you turn it off. While it's on, the 🐞 button is orange with a **DEV** tag.
- **Save isolation:**
  - The real garden lives in `undergrowth.forest.v1` and the test garden in `undergrowth.forest.dev`.
  - Entering developer mode saves the real garden and keeps a backup copy (`undergrowth.forest.v1.backup`).
  - Test gardens are marked (`state.dev`), and saving one over the real garden is refused.
- **Tools:**
  - Fill the Field Guide; open the whole forest; give any item or decor.
  - Complete or reset Store listings; open the seed tin as any school.
  - Grow forage finds now; save and load named setups.
- **Time** (both modes): time speed (1×, 60×, 600×, 3600×), skip ahead, and **Come back after…** 2, 10 or 24 hours. The last one counts as real time away.

## Project layout

```
web/                            the web game
  js/core.js                    game rules and state (no DOM)
  js/render.js                  canvas renderer, camera, touch input, lighting and canopy
  js/ui.js                      HUD, sheets (Bag, Store, Old Log, Field Guide, developer tools), cards
  js/main.js                    boot, clock, saving (and the old-save archive), taps and actions
  js/sprites.js                 sprite data → canvases
Resources/                      all data, shared with the iOS app
  tuning.json                   every number the web game uses
  ios/tuning.json               frozen tuning for the Swift package
  Content/*.json                catalogue items, Old Log, opening, visitors, relics, Store, decor, story text
  Sprites/**/*.json             one sprite per file; Sprites/Palettes/ for shared palettes
design/                         spreadsheets, design notes, source pictures
tools/
  build_web.py                  bundles Resources/ into dist/content.json
  import_catalogue.py           Plant & Fungi Catalogue → items.json
  import_offerings_table.py     Offerings → requests.json, cosmetics.json
  check_opening.py              checks the opening questions' weights
  gen_placeholders.py           regenerates the placeholder art (calls gen_topdown, gen_content_sprites,
                                gen_ui and gen_terrain); gen_offerings_sprites.py and gen_landmark_art.py
                                for decor, relics and the Old Log; gen_canopy.py, gen_app_icon.py,
                                gen_numeral_font.py for the canopy, icons and number font
App/, Packages/UndergrowthCore/ the older iOS port (see above)
```

## Data formats

### Sprites (`Resources/Sprites/**/<id>.json`)

```json
{
  "id": "item.plant.marigold",
  "size": [16, 16],
  "anchor": [8, 15],
  "palette": ["transparent", "#22181a", "#3b6821", "..."],
  "frames": [ { "duration": 0.6, "rows": ["......1111......", "..."] } ],
  "tags": ["item"]
}
```

- **Rows** are written one character per pixel. Each character is a palette index in base-62 (`0-9a-zA-Z`), and `.` means index 0 (transparent). A palette can hold up to 62 colours, as `#RRGGBB` or `#RRGGBBAA`.
- **`paletteRef`** can replace `palette` to point at a shared palette in `Sprites/Palettes/`. The grass tiles use `pal.ground`.
- **`anchor`** is measured in pixel-edge coordinates from the top-left. Objects anchor at their feet; ground tiles at their centre.
- **Missing sprite ids** render as a magenta "?" instead of crashing.
- **Placeholder art:** `python3 tools/gen_placeholders.py` regenerates every placeholder sprite. Re-running it reproduces the committed sprites exactly.
  - Catalogue items and their bud stages (`plant.bud.<key>`; fungi get a small closed button) come from `gen_content_sprites.py`.
  - School soil tiles (`tile.<school>.3a/b`) come from `gen_terrain.py`.
  - Grass, the treeline floor and shrubs come from `gen_topdown.py`.
  - UI icons come from `gen_ui.py`.

### Content (`Resources/Content/`)

| File | What it holds |
|---|---|
| `items.json` | The Plant & Fungi Catalogue (from the spreadsheet): id, category, name, rarity, sprite, school, description. |
| `landmarks.json` | The Old Log. |
| `opening.json` | The seed tin's card, the questions and their school weights, and what each school's tin holds. |
| `visitors.json` | Forest animals: name, sprite, preferences, clues, Field Guide text, gift. |
| `relics.json` | One relic per school (kept by hand), for the relic ornaments. |
| `requests.json`, `cosmetics.json` | Store listings, Old Log requests and decor (from the Offerings spreadsheet). |
| `story.json` | Story and hint text. |
| `nameParts.json` | Words for naming the garden after its soils. |

## Look and feel (web)

- **Font:** all text uses Pixelify Sans (SIL OFL), self-hosted in `web/fonts/` with its licence. The sizes are `--t-title` / `--t-head` / `--t-body` / `--t-small` / `--t-tiny` in `style.css`.
- **Numbers:** UG Numerals (`tools/gen_numeral_font.py`) is a tiny pixel font on Pixelify Sans' grid. It covers only digits and number punctuation, so counters and timers don't shift.
- **Pixel frames:** panels, buttons, tabs and cards use stepped, notched-corner frames built from box-shadows. There are no rounded corners or blur effects.
- **Icons:** pixel sprites in the registry (`ui.icon.*`, `ui.burst`), drawn by `tools/gen_ui.py`. There are no emoji.
- **Treeline:** the edge bushes and the ground under them use deep, shadowed greens (`tools/gen_topdown.py`), so the clearing has a clear dark border.
- **Old Log art:** `tools/gen_landmark_art.py` turns `design/landmark_old_log.jpg` (pixel art on a 20 px grid) into the sprite, with the picture's own colours and a clean dark outline.
- **Soil:** each school's soil is the grass tile with its greens moved toward the school's colour plus a few motif specks (`tile.<school>.3a/b`). A soil change fades in over `visuals.overlayFadeSeconds`.
- **Tree shadows (canopy):**
  - `design/shadow_overlay_v2.webp` is turned by `tools/gen_canopy.py` into `web/img/canopy.png`, a seamless light mask.
  - It's drawn world-anchored with a slow sway, plus soft light shafts (`visuals.canopy`).
- **Day and night:** the real local clock (`clock` in `tuning.json`): dawn 5:00–7:00, day 7:00–17:00, dusk 17:00–19:00, night 19:00–5:00, blended across 50 minutes.
  - Each state sets the canopy's shade and light, an ambient tint and fireflies (`visuals.lighting.states`).
  - Fireflies are a pure function of tile and time, so nothing runs while the app is hidden.
