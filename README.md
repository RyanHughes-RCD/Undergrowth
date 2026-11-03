# Undergrowth (working title)

A cozy top-down pixel-art garden in a forest clearing, framed by a shrub treeline around an old log. The design for the garden (plant, grow overnight, harvest) is in `design/garden_rework.md`.

The rework was built in phases:

1. Removed the old systems: creatures, geodes, relic fields, wild spawning and the Spirit Well.
2. Added the core loop: soil, seed packets, growth, harvest, coins and the morning check.
3. Added companions, decor that does something, relic ornaments and garden beauty.
4. Added long-term goals: collections, cross-pollinated colours, commissions and daily orders, visitors drawn by plants, and Room to grow for coins.

## Running it

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
- **iOS:** the native iOS app and its Swift package were retired with the garden rework; the web game is the only version. (They're in git history before this change if a native port is wanted later.)
- **Saves:** stored in the browser's `localStorage` (`undergrowth.forest.v1`). Safari may clear them after a long period without visiting.

## Saves from before the garden

The garden is a new game, so older forests aren't carried over:

- When the game loads a save older than version 7, it copies it, untouched, to `undergrowth.forest.v1.archive.v<old version>` (for example `…archive.v6`) and starts a fresh garden.
- The fresh garden keeps the old save's **Field Guide discoveries**. A card says so once ("A fresh garden").
- Developer test saves do the same under their own key.
- A save from a newer version is kept aside as `….newer`; one that can't be read is kept as `….corrupt`.

## The garden (web)

- **The clearing:** a small 5×8 clearing in the middle of the 40×56 forest (`tuning.json` → `grid`, `clearing`). After the Old Log and the edge scenery that leaves about 30 open tiles, so the starter kit and the first few days of buying fill it and Room to grow matters.
  - At full zoom-out the whole clearing and a thin treeline border fit the play area both ways (`visuals.viewBorderTiles`), at a crisp whole-pixel scale. Spare room shows more treeline.
  - Drag to look around; pinch to zoom in.
- **The Old Log**, a mossy two-tile stump, sits at the centre (`Content/landmarks.json`). Tap it for the Old Log board and the Store.
- **The opening** (no guided tutorial, no instructions):
  - The clearing is a little grotto: mossy rocks, ferns and roots along its edge (`start.scenery`, visual only).
  - An old seed tin waits by the log (`start.tin`). Tapping it shows the words on its lid, then five quiet questions with four answers each (`Content/opening.json`). No answer names a school or a mechanic. Each answer adds weight to one or two schools.
  - The highest total chooses the garden's starting school, and the runner-up adds a little. The tin holds a starter set (`garden.starterSet`):
    - 4 Common seeds of that school and 2 Common seeds of the runner-up;
    - 2 amendments of the school and 1 of the runner-up.
  - A new garden also starts with 20 coins (`garden.startCoins`).
  - `python3 tools/check_opening.py` checks the weights: every school can be chosen, and over every possible set of answers the shares are 13–19%.
- **The foraging patch** (`tuning.json` → `forage`, on by default): plain finds turn up by chance on the clearing's outer ring, by the treeline. They are Brown Button Cap, Clover, Sorrel and Meadow Daisy.
  - Every hour of game time has a 30% chance of one, up to 3 waiting at once.
  - Away time counts (up to 48 hours).
  - Which hour gets a find, its tile and the item are hashed from the garden seed and the hour, so it's deterministic.
  - Tap one to pick it. `forage.enabled: false` turns the patch off.
- **Decor:** props bought in the Store go in the Bag under Decor. Place one on an open tile, then tap it to move it, recolour it or put it away.
- **Room to grow:** a line of Store upgrades (`expansion`). Each purchase clears **one side the player chooses**: top, bottom, left or right.
  - That side's trees step back 3 rows (`sideTiles`). A side already at the forest's edge can't be chosen.
  - On the 5×8 start, the top or bottom gives 15 tiles and a side gives 24.
  - **The new ground isn't empty.** Along the old edge it uncovers a 4-tile patch of one school's soil (`wildSoilTiles`), a different school each time in an order shuffled by the garden seed. Beside it is that school's **wild feature**: Mossy stone, Glowing flowers, Wild flowers, Old oak, Crystal outcrop or Misty pine.
  - Features can't be moved or bought, and add 3–4 beauty each. Tap one to see what it is. A card names what was found, and the new soil is highlighted.
  - The foraging patch moves out with the treeline on its own.
  - It's deterministic from the garden seed and the purchase.
- **Field Guide:** tabs for Mushrooms, Plants (the Plant & Fungi Catalogue) and Visitors. Unfound entries are silhouettes.
- **Time:** the real local clock (`tuning.json` → `clock`). Everything runs on timestamps, so the garden catches up when the game reopens.

## Growing things (web)

The core loop: choose a seed packet, plant it on a tile you choose, watch it grow through its stages, harvest it (produce, and usually seeds back), sell the produce, and decide what to plant next. Plants are defined in `Resources/Content/plants.json` (kept by hand) and every number is in `tuning.json` → `garden`.

- **Why a hand-kept JSON file:** a plant has a nested shape (companions, varieties) and there are only about twenty, so one readable file is easier to edit and review than spreadsheet columns.
  - The art, names and Field Guide text come from the Plant & Fungi Catalogue: each plant names the catalogue item it yields (`item`).
  - Numbers live only in tuning, keyed by plant id.
- **Soil:** every clearing tile has one soil: plain, or one of the six schools (saved as `state.soil`; plain isn't stored).
  - You change a tile's soil on purpose with an amendment from the Bag: Spore compost, Glow dust, Bloom mulch, Verdure leaf mould, Shimmer crystal dust or Spirit mist. Garden loam turns it back to plain (`Content/amendments.json`).
  - One bag does one tile, and the soil stays until you change it. A tile with a plant on it can't be changed.
  - **Soil is scarce** (`garden.amendments`). Each morning the Store stocks two school amendments, chosen from the garden seed and the day: one bag each, at 20 coins. Garden loam is always there at 2.
  - The other sources are the opening's tin and the soil patches Room to grow uncovers.
  - The tile shows its soil: plain is grass, and a school's soil is its ground tile (`tile.<school>.3a/b`).
- **Growing well:**
  - On its own school's soil a plant grows at normal speed (`soil.preferred` 1).
  - On plain soil it grows at 0.6× (`soil.plain`): an 8-hour Marigold takes about 13 hours, so it still lands on the next morning.
  - **On another school's soil it can't be planted.** A plant that crawls along at a third of its speed looks broken, and refusing teaches the rule at once. In planting mode its own soil glows brightly, plain ground faintly and other soil not at all. Tapping a wrong tile says which soil the plant likes.
- **Stages:** seed, sprout, bud, bloom, then ready (at 15%, 45% and 75% of its growth, `garden.stages`).
  - Seed and sprout share the generic art, the bud is the plant's own (`plant.bud.<key>`; fungi got buds too), and bloom is the plant itself.
  - A ready plant sparkles and bobs. It waits there for as long as it takes: nothing wilts or dies.
- **Timing is deterministic:**
  - Each plant stores `grown` (ms of normal-speed growth), `since` and `rate`. Its progress at time t is `(grown + (t − since) × rate) / need`.
  - Rates only change through player actions (planting, harvesting, soil, decor). Before any of them every plant banks its growth (`Game.rebase`), so time away is a straight line.
  - Reloading gives the same times.
- **Harvest:** tap a ready plant.
  - You get `yield` produce (the catalogue item) and seed packets: `seeds: [always, chance of one more]`.
  - An annual leaves its tile empty. A perennial drops back to its bud stage and is ready again after `regrowHours`.
  - The first harvest of each plant adds it to the Field Guide's **Garden** tab.
- **Coins:** the one currency.
  - The Store's **Sell** tab buys produce (each plant's `sell` price) and anything foraged (`garden.sellByRarity`), one at a time or everything at once.
  - Coins buy seed packets (**Seeds**), the day's soil (**Soil**), decor (**Decor**) and **Room to grow**.
- **The morning check:** on opening after 4 hours or more of real time away (`garden.morning.minAwayHours`), a short card names everything ready to harvest and when the next plant will be. Ready plants are highlighted.
  - At most one small surprise per local day (`surpriseChance` 0.7), chosen from the garden seed and the day, among what's possible right now.
  - **A self-seeded seedling:** a blooming plant seeds a neighbouring open tile it can grow in, and a sprout appears there.
  - **A visitor's gift:** a befriended visitor leaves its gift seeds in the Bag.
  - **A rare colour:** a ready plant turns out to be one of its colour varieties, just this once.
  - The weights are 3, 4 and 2 (`morning.weights`).
  - Developer time skips don't trigger the card; **Come back after…** does.

### Seeds are blind pulls

Seed packets are named only by school and tier: "Common Bloom seeds", "Uncommon Shimmer seeds", "Rare Spirit seeds" (`seeds.<school>.<tier>`, `garden.packets`).

- **Planting rolls the plant.**
  - First a tier is drawn by the packet's odds, then a plant evenly among that school's seed plants of that tier. A tier with none steps down.
  - Better packets have better odds, never a sure thing.
  - The seedling stays a mystery ("Bloom seedling, what will it be?") until its bud shows. Its card gives only when it buds, since the ready time would give it away.

  | Packet | Price | On the shelf | Common | Uncommon | Rare |
  |---|---|---|---|---|---|
  | Common | 5 | from the start | 80% | 17% | 3% |
  | Uncommon | 12 | Tended | 40% | 48% | 12% |
  | Rare | 28 | Pleasant | 15% | 45% | 40% |

- **Harvests return seeds of the plant's own school and tier.** A rare plant gives Rare seeds, so lucky pulls compound slowly.
- **Not in any packet:** gift plants (from visitors) and colour varieties keep their own named packets, which only friends and cross-pollination give.
- **The plants**, by school and tier (`plants.json` `tier`):

  | School | Common | Uncommon | Rare |
  |---|---|---|---|
  | Spore | Ink Cap (6h) | Velvet Shank (10h) | Morel (20h) |
  | Glow | Foxfire Button (12h), Honey Mushroom (12h) | Lantern Flower (24h, perennial) | Glowcap (20h) |
  | Bloom | Marigold (8h), Cornflower (20h) | Lavender (16h, perennial) | Anemone (18h) |
  | Verdure | Wood Sorrel (10h, perennial) | Hosta (18h, perennial) | Hellebore (22h, perennial) |
  | Shimmer | Jewelweed (14h) | Glassbell (14h) | Prism Rose (20h) |
  | Spirit | Wisp Cap (16h) | Mistbell (18h) | Ancestor's Lace (20h) |

  - Grow times are on the plant's own soil.
  - Commons sell for 3–7 coins, uncommons for 6–11 and rares for 13–16.
  - Annual commons return 1 seed plus a 50% chance of another; rares return a 50% chance of one; perennials 25%.
  - Every plant's numbers are in `tuning.json` → `garden.plants`.
- **The first morning:** the tin's 6 packets fill 6 tiles. The first harvests sell for about 30–60 coins, enough for the next round of Common seeds or a bag of the day's soil.

## Companions, decor and beauty (web)

- **Companion planting:** each plant has two neighbour rules (`companions` in `plants.json`). When the named plant grows in one of its 8 neighbouring tiles, at any stage:
  - a **speed** rule makes it grow ×1.25 (`garden.companions.speed`; several stack, up to ×1.5);
  - a **yield** rule adds 1 produce at harvest.
  - Rules pair plants across schools on purpose (Marigold and Cornflower, Ink Cap and Wisp Cap, Lantern Flower and Foxfire Button…), so planning a mixed bed pays.
  - **Discovery:** a rule is found the first time it's active at a harvest. A toast says so, and the plant's Field Guide page then lists it under "Good neighbours"; unfound rules stay hidden there.
  - Before that, a plant's card only says "It seems happy here."
- **Decor does something** (by kind, `garden.decor.kinds`; the kind is a column in the Offerings sheet):

  | Kind | Pieces | Beauty | What else |
  |---|---|---|---|
  | path | Stepping stones, Gravel path | 1 | lies flat; things are drawn over it |
  | fence | Twig fence | 1 | |
  | bed | Raised bed | 2 | holds a plant (plant in it like a tile; its soil is the tile's) and gives +1 produce |
  | planter | Flower planter | 3 | |
  | lantern | Glow lantern, Crystal lamp, Mushroom lamp | 2 | glows at dusk and through the night |
  | bench | Mossy bench, Log stool | 2 | |
  | feature | Birdbath, Fairy ring, Wind chime, Root arch, Pebble cairn | 3 | |
  | ornament | the six relics | 4 | plants of its school in the 3×3 around it grow ×1.2 |

  - Decor is placed, moved and put away by hand. A raised bed with a plant in it stays put until it's harvested or dug up.
  - Tapping a placed piece says what it does.
- **Relics are ornaments now:** the six relics (`Content/relics.json`, one per school) are decor of kind `ornament`. They're earned by completing a school's collection (phase 4); developer mode can give them.
- **Garden beauty** (`garden.beauty`): 3 × each distinct plant growing + 1 × each plant in bloom or ready + every placed decor's beauty.
  - It's never shown as a number: the HUD shows a named tier with a leaf meter. The tiers are Bare, Tended (8), Pleasant (20), Lovely (36), Charming (56) and Enchanting (80).
  - The best tier ever reached is kept (`state.beautyBest`) and never relocks.
  - Reaching a tier shows a gentle card naming what it put in the Store. Tiers open better seed packets (Uncommon at Tended, Rare at Pleasant) and some decor ('Needs beauty tier' in the Offerings sheet): Flower planter and Wind chime at Tended, Birdbath and Mushroom lamp at Pleasant, Fairy ring and Crystal lamp at Lovely, Root arch at Charming.
  - Locked items show in the Store as silhouettes ("Opens with a lovely garden").
  - A first bed of two or three kinds with a bench reaches Tended on day one. Pleasant takes about five kinds or a few pieces of decor, Lovely most of the clearing, and Charming or Enchanting need Room to grow.

## Long-term goals (web)

- **Field Guide collections:** each school's set is its seed plants and its gift plant (Spore 4, Glow 5, Bloom 5, Verdure 4, Shimmer 4, Spirit 4).
  - Harvest every plant in a set once to complete it. The reward is that school's relic ornament (the only way to earn one) and 150 coins (`garden.collections`).
  - The Garden tab of the Field Guide opens with each set's progress and the relic as a silhouette until earned.
- **Cross-pollination and colour varieties** (`plants.json` varieties, `garden.varieties`):
  - Harvest a plant while a blooming plant of the same family is in one of its 8 neighbours. The same kind counts, and the families are caps, daisies, bells, clovers, spikes and willows.
  - With a hidden chance (12%) you get a seed packet of one of its colour varieties, one not yet found first.
  - There are 14 varieties, one per common and uncommon plant: Lemon Marigold, Pink Cornflower, Lavender Ink Cap, Golden Hosta and so on.
  - A variety grows like its plant and breeds true. Its produce sells for twice as much and has its own entry in the Field Guide's **Colours** tab (a hint shows until found).
  - Variety colours are palette swaps computed at load: every vivid, non-green colour of the plant's sprite takes the variety's hue, and the greens too for leafy varieties (`varietySwap` in `core.js`), so no extra art is needed.
  - In a simulation, a bed of seven Marigolds harvested daily gave a Lemon Marigold packet on about 1 in 9 harvests.
- **The Old Log** has two kinds of request (Offerings sheet). It sparkles when something there can be delivered.
  - **Commissions** (`commission`) are ten one-off requests for things you grow, paying 40–300 coins. Some open Store items: "A basket for the log" opens the Raised bed, "Something blue" the Birdbath, "Lantern-light" the Glow lantern. Later ones need a beauty tier, colour varieties or gift plants.
  - **Daily orders** (`order`) are two small orders each local day, at about 1.5× the sell price. They're chosen from the garden seed and the day among orders for produce you've already harvested (`garden.orders.perDay`).
- **Visitors drawn by plants** (`Content/visitors.json`, `tuning.visitors`): twelve animals from `design/animal_visitors_notes.md`, two per school.
  - Each likes particular plants blooming in the garden, in a time window.
  - While every plant it likes is in bloom (or ready), its interest rises by 1.5 every 30 minutes of game time (time away counts). Otherwise it falls by 0.5.
  - At 10 interest, little tracks appear beside those plants during its window. From 20, tapping tracks reads a clue that names one of its preferences, kept on its Field Guide page.
  - From 60 it visits in its window (35% per half hour, staying 1–2.5 hours, once a day). It drifts shyly near the plants it likes. Tap it to befriend it.
  - Everything is seeded from the garden, the visitor and the time, so it's deterministic.
  - **Befriended visitors bring seeds you can't buy.** At once they leave 2 packets of their gift, and later the occasional morning gift. One of each school's pair brings a gift-only plant (Spore Lantern, Moonpetal, Foxglove, Canopy Bells, Prismbell, Wispwillow); the other brings a colour variety's seeds.
  - In a simulation, a Marigold and a Cornflower left blooming brought the Bumblebee about 39 hours later.

  | Visitor | School | Likes blooming | Time | Gift |
  |---|---|---|---|---|
  | Woodlouse | Spore | Ink Cap | day | Lavender Ink Cap seeds |
  | Cave Salamander | Spore | Velvet Shank, Ink Cap | night | Spore Lantern seeds |
  | Firefly | Glow | Foxfire Button | dusk | Azure Foxfire seeds |
  | Glowmoth | Glow | Lantern Flower, Honey Mushroom | night | Moonpetal seeds |
  | Bumblebee | Bloom | Marigold, Cornflower | day | Lemon Marigold seeds |
  | Ruby-throated Hummingbird | Bloom | Lavender | dawn | Foxglove seeds |
  | Mossback Hare | Verdure | Wood Sorrel | dawn | Purple Wood Sorrel seeds |
  | Red Squirrel | Verdure | Hosta, Wood Sorrel | day | Canopy Bells seeds |
  | Glasswing Butterfly | Shimmer | Jewelweed | day | Sapphire Jewelweed seeds |
  | Prism Moth | Shimmer | Glassbell, Jewelweed | dusk | Prismbell seeds |
  | Will-o'-Wisp Fox | Spirit | Wisp Cap | dawn | Rose Wisp Cap seeds |
  | Barn Owl | Spirit | Mistbell, Wisp Cap | night | Wispwillow seeds |

  - The notes' clue ideas became the clue lines.
  - The old Lantern Moth, Honey Bumble, Fern Rabbit and Mist Fox became the Glowmoth, Bumblebee, Mossback Hare and Will-o'-Wisp Fox, keeping their ids.
  - The Mossback Hedgehog, Prism Beetle, Foxfire Newt and Petal Stag are gone.
  - Their sprites are placeholders from `tools/gen_visitor_sprites.py`.
- **Gift plants** (only from visitors, never in the Store): they grow 20–24h and sell for 13–16. Canopy Bells and Wispwillow are perennials.
- **Room to grow** is bought with coins in the Store: 100, 150, 200 … 850 coins for ten purchases, each clearing 3 rows on the side you choose.

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

- **Requests:** one row per Store listing or Old Log request.
  - **Kind:** `shop` (bought with coins, again and again), `upgrade` (bought once, chained: Room to grow), `commission` (a one-off request at the Old Log) or `order` (the pool of daily orders).
  - **Coins:** the price.
  - Up to four items with counts (seed packets and amendments included).
  - **Reward:** `cosmetic`, `item`, `unlock` = `expansion`, or `coins`.
  - **Gating:** Field Guide entries, another request done first, a beauty tier, a garden day.
  - Decor costs 15–80 coins. Room to grow costs 100, 150, 200, 260, 330, 410, 500, 600, 720 and 850.
- **Cosmetics:** decor props: id, name, sprite, size, **kind** (path, fence, bed, planter, lantern, bench, ornament or feature), colours (`Name #hex`, the first is the art's own), text.
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
  - **Garden:** grow all plants now; +100 or +1000 coins; give any blind or named seed packet or amendment, or 5 of each.
  - **Plant timers:** tap a plant to see its exact progress, rate, time to ready and stage times.
  - The six relic ornaments; see the beauty score and set the best beauty tier reached.
  - **Visitors:** set a visitor's interest stage, lay its tracks now, or bring it into the garden now. Also give 2 of every colour variety packet.
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
Resources/                      all game data
  tuning.json                   every number the web game uses
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
  - Visitor animals (`visitor.<id>`, two frames each) come from `gen_visitor_sprites.py`.
  - Blind seed packets (`packet.<school>.<tier>`: a question mark, plain, green-trimmed or gold) and named packets (`packet.<plant>`: banded in its soil's colour with a little flower or cap in the plant's own colour), amendment sacks (`amend.<school>`), the seed tin (`garden.tin`) and the coin come from `gen_garden_sprites.py`.
  - Catalogue items and their bud stages (`plant.bud.<key>`; fungi get a small closed button) come from `gen_content_sprites.py`.
  - School soil tiles (`tile.<school>.3a/b`) come from `gen_terrain.py`.
  - Grass, the treeline floor and shrubs come from `gen_topdown.py`.
  - UI icons come from `gen_ui.py`.

### Content (`Resources/Content/`)

| File | What it holds |
|---|---|
| `items.json` | The Plant & Fungi Catalogue (from the spreadsheet): id, category, name, rarity, sprite, school, description. |
| `plants.json` | Garden plants (kept by hand): id, the catalogue item it yields, school, kind, family, source (`seeds`: comes from blind packets; `gift`: only from visitors), tier (common, uncommon, rare), perennial, companions, varieties. Numbers: `tuning.json` → `garden.plants`. Blind packets (`seeds.<school>.<tier>`) are built from the schools; each plant also has a named packet (`packet.<id>`), used for gifts. |
| `amendments.json` | Soil amendments (kept by hand): id, school (null = plain loam), name, text. |
| `landmarks.json` | The Old Log. |
| `opening.json` | The seed tin's card, the questions and their school weights, and what each school's tin holds. |
| `visitors.json` | Twelve forest animals: name, sprite, school, likes (`plants` that must be blooming, `time` window), a clue per preference (`plant:<id>`, `time`), Field Guide text and gift (a seed packet id). |
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
  - **Clipped corners:** a soil tile's corner is clipped a little unless the tile above or below or the tile beside that corner has the same soil. Edges between matching tiles stay solid, so patches join up with slightly rounded outer corners.
  - A clipped corner shows the ground most common around the tile, whether grass or another soil.
  - The rounding has a 4-pixel radius and softens over its last 2 pixels in two alpha steps (`visuals.softCorners`; `ForestView.softTile` in `render.js`, cached per tile and corner mask).
- **Tree shadows (canopy):**
  - `design/shadow_overlay_v2.webp` is turned by `tools/gen_canopy.py` into `web/img/canopy.png`, a seamless light mask.
  - It's drawn world-anchored with a slow sway, plus soft light shafts (`visuals.canopy`).
- **Day and night:** the real local clock (`clock` in `tuning.json`): dawn 5:00–7:00, day 7:00–17:00, dusk 17:00–19:00, night 19:00–5:00, blended across 50 minutes.
  - Each state sets the canopy's shade and light, an ambient tint and fireflies (`visuals.lighting.states`).
  - Fireflies are a pure function of tile and time, so nothing runs while the app is hidden.
