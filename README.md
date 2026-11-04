# Undergrowth (working title)

A cozy top-down pixel-art garden in a forest clearing, framed by a shrub treeline, with a little pool and its streams at the centre. The design for the garden (plant, grow overnight, harvest) is in `design/garden_rework.md`.

The rework was built in phases:

1. Removed the old systems: creatures, geodes, relic fields, wild spawning and the Spirit Well.
2. Added the core loop: soil, seed packets, growth, harvest, coins and the morning check.
3. Added companions, decor that does something, relic ornaments and garden beauty.
4. Added long-term goals: collections, cross-pollinated colours, commissions and daily orders, visitors drawn by plants, and Room to grow for coins.
5. Replaced the Old Log with water (first a spring, now a 2×2 pool) and its streams, plus weather, the moon, soil spread by the tides, soil maturity and digging channels.
6. Visitors who stay: mementos instead of tracks, residents who live in the garden while their conditions hold, and the Stump, which takes offerings.
7. Epic and Legendary seeds, and the wishing well.

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

- A version 7 garden is upgraded in place to version 9: the Old Log becomes the pool (the emptiest 2×2 block around it), streams are laid around it (only over open ground), and existing soil starts at level 2 (Settled).
- A version 8 garden had a spring landmark at the head of its streams. It becomes the pool: the emptiest 2×2 block around the spring's tile turns to water, whatever was on it (decor goes back to the Bag).
- When the game loads a save older than version 7, it copies it, untouched, to `undergrowth.forest.v1.archive.v<old version>` (for example `…archive.v6`) and starts a fresh garden.
- The fresh garden keeps the old save's **Field Guide discoveries**. A card says so once ("A fresh garden").
- Developer test saves do the same under their own key.
- A save from a newer version is kept aside as `….newer`; one that can't be read is kept as `….corrupt`.

## The garden (web)

- **The clearing:** a small 5×8 clearing in the middle of the 40×56 forest (`tuning.json` → `grid`, `clearing`). After the pool, its streams and the edge debris that leaves about 30 open tiles, so the starter kit and the first few days of buying fill it and Room to grow matters.
  - At full zoom-out the whole clearing and a thin treeline border fit the play area both ways (`visuals.viewBorderTiles`), at a crisp whole-pixel scale. Spare room shows more treeline.
  - Drag to look around; pinch to zoom in.
- **The pool:** the river rises from a 2×2 block of water at the centre of a new garden (`state.pool`). The only landmark is the Stump, found later (see Room to grow). The neighbours' board and the Store are under **Notes** in the bottom bar.
- **Streams** (`tuning.json` → `water`): the pool sends out 6–7 water tiles in at least two distinct streams, either leaving in different directions or forking. They meander at random (deterministic from the garden seed) and never touch except where they fork. Water can't be planted, amended or decorated. Tap any water for its card and the forecast.
- **Weather and the moon** (`weather`, `moon`): each local day is Clear, Cloudy, Rain or Storm, drawn from the garden seed (it tends to repeat yesterday's). The moon is the real moon's phase that day, one of eight. The **weather button** in the HUD (and a water tile's card) shows the forecast: today and tomorrow, with the **water level** for each and what it means for the soil at each tide that day.
- **Water level** (`water.levels`): the day's power (weather + moon, below) sets the water Low, Normal, High or Flood. Low water sits well inside its channel and shows a strip of bank (the grass or soil beside it) with a dark wet edge; Normal shows a thin strip; High fills the channel; a Flood spills a little over the banks. The water tile card names today's level, and developer mode can pin the level shown.
- **Tides** (`tides`): every six hours (local 00:00, 06:00, 12:00 and 18:00) the tide turns and soil spreads from the banks (tiles touching water), so there's something new at every visit. The day's power is its weather power plus the moon's (a storm on a full moon is 3.7; a clear new-moon day is 0); the spread uses power + 0.6 (`basePower`), so even a still day moves a little. Time away catches up, up to 28 tides (a week).
  - Along the bank: soil on a bank tile may spread to a neighbouring bank tile, so it grows up or down the stream (55% × (power + 0.6), at most 80%).
  - Inland: it may also creep to any open neighbour (20% × (power + 0.6)).
  - Never through the water: a step to a corner tile is only allowed when neither tile beside it is water, so soil can't slip across a bend. Soils on opposite banks stay apart, **unless the water is High or in Flood**: then each bank tile with soil has a 10% (High) or 25% (Flood) chance to carry it straight across to the far bank.
  - A tile resists by its maturity, and more with a plant on it. The return card reports the tides since your last visit: how many tiles changed, any crossings and how much soil matured.
  - A plant whose tile changed school keeps growing, slowly (`garden.soil.wrong`, 35%).
- **Soil maturity** (`garden.soil.levels`): soil is Fresh, Settled, Rich or Deep (levels 1–4). Each tide a tile keeps its soil, it has a 50% chance to go up a level (`tides.matureChance`), so about a level every 12 hours: Deep in under two days. On a plant's own soil each level above 1 adds 6% growth speed, and from Rich it gives +1 produce. Each level looks more strongly of its school, with deeper colour and darker shadows, and grows more little details (`visuals.soilDetails`: a tile has one with an 8%, 20%, 40% or 65% chance by level): tufts and clover on Verdure, wildflowers on Bloom, tiny caps and puffballs on Spore, glowing moss and foxfire on Glow, crystal shards and glinting pebbles on Shimmer, ghost-flowers and little cairns on Spirit. Details stay put on their tile and hide under anything standing there. A tile card shows the level.
- **Digging channels** (`water.dig`): tap an empty tile beside the water and choose *Dig a channel*. It becomes water and its soil is lost. It costs 15 coins, then 5 more for each channel dug before. New banks let the tides reach new ground.
- **The opening** (no guided tutorial, no instructions):
  - The clearing is a little grotto: mossy rocks, ferns and roots along its edge (`start.scenery`). This debris blocks its tile; tap it and choose **Clear it away** (free) to open the ground. Wild features from Room to grow can't be cleared.
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
  - **The second purchase also finds the wishing well:** a 2×2 well on the new ground, beside that tier's feature (see The wishing well). Gardens that had already bought it twice get the well on four free tiles with no soil.
  - **The first purchase finds the Stump instead of a feature:** a 2×2 stump on the new ground, beside the soil patch (see Visitors who stay). That school's feature turns up later in the cycle. Gardens that had already bought Room to grow get the Stump on four free tiles with no soil, near the clearing's edge.
  - Features can't be moved or bought, and add 3–4 beauty each. Tap one to see what it is. A card names what was found, and the new soil is highlighted.
  - **The river follows.** A point on the newly revealed outer edge is picked at random; from the water tile nearest it, a stream winds out to that edge, through a random bend midway. It takes the cheapest route: around plants, decor, features and the tin where it can, through them where it must (their soil is lost, plants and debris are gone, decor goes back to the Bag). The new water is highlighted and the card says so.
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
  - On plain soil it grows at 0.6× (`soil.plain`): a 3-hour Marigold takes 5 hours, still inside a six-hour visit.
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
  - Every plant leaves its tile when it's picked; nothing regrows in place. Plant again from the seeds it gives back.
  - The first harvest of each plant adds it to the Field Guide's **Garden** tab.
- **Coins:** the one currency.
  - The Store's **Sell** tab buys produce (each plant's `sell` price) and anything foraged (`garden.sellByRarity`), one at a time or everything at once.
  - Coins buy seed packets (**Seeds**), the day's soil (**Soil**), decor (**Decor**) and **Room to grow**.
- **The morning check:** on opening after 4 hours or more of real time away (`garden.morning.minAwayHours`), a short card names everything ready to harvest and when the next plant will be. Ready plants are highlighted.
  - At most one small surprise per local day (`surpriseChance` 0.7), chosen from the garden seed and the day, among what's possible right now.
  - **A self-seeded seedling:** a blooming plant seeds a neighbouring open tile it can grow in, and a sprout appears there.
  - **A visitor's gift:** a resident leaves its gift seeds in the Bag.
  - **A rare colour:** a ready plant turns out to be one of its colour varieties, just this once.
  - The weights are 3, 4 and 2 (`morning.weights`).
  - Developer time skips don't trigger the card; **Come back after…** does.

### Seeds are blind pulls

Seed packets are named only by school and tier: "Common Bloom seeds", "Uncommon Shimmer seeds", "Rare Spirit seeds", "Epic Glow seeds", "Legendary Verdure seeds" (`seeds.<school>.<tier>`, `garden.packets`). Each is its own item in the Store: one row per packet, with its own art (plain paper, green trim, gold foil, violet with a seal, an iridescent border), grouped by tier, with a filter by school.

- **Planting rolls the plant.**
  - First a tier is drawn by the packet's odds, then a plant evenly among that school's seed plants of that tier. A tier with none steps down.
  - Better packets have better odds, never a sure thing: every packet keeps a chance of a common plant, and none is certain of any tier.
  - The seedling stays a mystery ("Bloom seedling, what will it be?") until its bud shows. Its card gives only when it buds, since the ready time would give it away.

  | Packet | Price | On the shelf | Common | Uncommon | Rare | Epic | Legendary |
  |---|---|---|---|---|---|---|---|
  | Common | 5 | from the start | 80% | 17% | 3% | | |
  | Uncommon | 12 | Tended | 40% | 48% | 12% | | |
  | Rare | 28 | Pleasant | 15% | 45% | 40% | | |
  | Epic | 60 | Lovely | 8% | 27% | 40% | 23% | 2% |
  | Legendary | 120 | Charming | 4% | 14% | 32% | 38% | 12% |

  - Only Spore and Verdure have a Legendary plant, so elsewhere a Legendary pull steps down to Epic.

- **Harvests return seeds of the plant's own school and tier.** A rare plant gives Rare seeds, so lucky pulls compound slowly.
- **Not in any packet:** gift plants (from visitors) and colour varieties keep their own named packets, which only friends and cross-pollination give.
- **The plants**, by school and tier (`plants.json` `tier`):

  | School | Common | Uncommon | Rare |
  |---|---|---|---|
  | Spore | Ink Cap (2h) | Velvet Shank (4h) | Morel (9h) |
  | Glow | Foxfire Button (4h), Honey Mushroom (4h) | Lantern Flower (8h) | Glowcap (9h) |
  | Bloom | Marigold (3h), Cornflower (6h) | Lavender (6h) | Anemone (8h) |
  | Verdure | Wood Sorrel (3h) | Hosta (6h) | Hellebore (10h) |
  | Shimmer | Jewelweed (5h) | Glassbell (5h) | Prism Rose (9h) |
  | Spirit | Wisp Cap (5h) | Mistbell (6h) | Ancestor's Lace (9h) |

  - Grow times are on the plant's own soil. Commons and uncommons are ready within 6 hours, so a visit every six hours always finds something; rares take 8–10.
  - Commons sell for 3–7 coins, uncommons for 6–11 and rares for 13–16.
  - Commons and uncommons return 1 seed plus a 50% chance of another; rares return a 50% chance of one; gift plants 1 plus a 25% chance.
  - **Epic and Legendary plants** are the catalogue's Very rare and Legendary finds, with their own art and buds:

    | School | Epic | Legendary |
    |---|---|---|
    | Spore | Ring Morel, Crown Puffball | Ancient Sporecrown |
    | Glow | Moonlight Morel, Starlight Bonnet, Starspore | |
    | Bloom | Dawn Peony, Petalwhirl | |
    | Verdure | Greenheart Vine, Heartleaf Canopy | Heartwood Sapling |
    | Shimmer | Rainbow Eucalyptus, Opaline Shelf | |
    | Spirit | Cave Lily, Ghost Orchid, Deeproot Lantern, Corpse Flower, Amethyst Deceiver | |

    Epics grow in 12h, yield 3, sell for 22 and return a 35% chance of Epic seeds. Legendaries grow in 16h, yield 4, sell for 40 and return a 20% chance of Legendary seeds. They aren't part of the Field Guide collections, so the sets (and the relics) are as before.
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
- **The Notes board** (the old Old Log board) has two kinds of request (Offerings sheet). Its button sparkles when something there can be delivered.
  - **Commissions** (`commission`) are ten one-off requests for things you grow, paying 40–300 coins. Some open Store items: "A basket for the log" opens the Raised bed, "Something blue" the Birdbath, "Lantern-light" the Glow lantern. Later ones need a beauty tier, colour varieties or gift plants.
  - **Daily orders** (`order`) are two small orders each local day, at about 1.5× the sell price. They're chosen from the garden seed and the day among orders for produce you've already harvested (`garden.orders.perDay`).
- **Visitors who stay** (`Content/visitors.json`, `tuning.visitors`, design notes in `design/visitor_residency.md`): fifteen animals in three tiers. They leave **mementos** while they court the garden, then **move in** and live there for as long as their conditions hold.
  - **Interest:** every 30 minutes of game time (time away counts), a visitor's interest rises by 1.5 while every plant it likes is blooming (or ready), and falls by 0.5 otherwise.
  - **Mementos:** in its time window, at 10 interest it makes its first visit, and later visits need 20 (early), 40 (settled) or 60 (mystical). A visit has a 35% chance per check, at most once a day. Visits are never seen: each leaves the next of its mementos (1 for early visitors, 3 settled, 4 mystical). Each memento hints at one of the conditions it needs to stay, in its own words, and never names a number.
  - **Moving in:** on the visit after its last memento, it moves in if every condition holds. If not, it leaves a plainer hint about one condition that isn't met.
  - **Staying:** a resident stays while every condition holds and leaves at the first check where one doesn't (strictly, no grace period). It leaves a parting memento that names what broke. Coming back takes one visit with the conditions met again.
  - **Conditions** (`stays`):
    - **soil:** a patch of a school's soil at a maturity level: 4 tiles joined side by side (`tiles`) or a full 3×3 (`shape`). **One soil tile counts for one resident only:** moving in claims the patch, and other residents can't count those tiles. If a patch breaks but another unclaimed one fits, the resident moves to it.
    - **bed:** a raised bed with a named plant in it, at any stage. Plants never wilt, so a ready plant left unharvested holds the condition. Harvesting it ends it.
    - **beauty:** the garden's beauty tier now (not the best ever reached).
    - **resident:** another visitor living there.
  - **What residents bring:** their gift seeds (2 packets) the first time they move in, the morning card's gift surprise, and a perk on their own patch. Plants of their school there grow faster (×1.15 early, ×1.2 settled, ×1.3 mystical). Settled and mystical residents' patches never lose soil to the tides.
  - Residents are seen on their patch, never blocking a tile: about in their own time of day, resting otherwise. Tap one for its Field Guide page.
  - **News:** mementos, arrivals and departures appear on the morning card, or on their own card when there's no morning card.
  - **The Field Guide's Visitors tab** shows a silhouette until a visitor has lived in the garden. Its page lists every memento it has left, then the plainer hints and partings since. A sparkle marks a silhouette that has left mementos.
  - Old saves: tracks are gone. A befriended visitor has already left all its mementos (and its gift), so it moves in at its next visit if it can stay.
  - Everything is seeded from the garden, the visitor and the time, so it's deterministic.

  | Visitor | Tier | School | Courted by (blooming) | Time | Stays while |
  |---|---|---|---|---|---|
  | Woodlouse | early | Spore | Ink Cap | day | 4 joined Spore tiles, Settled+ |
  | Firefly | early | Glow | Foxfire Button | dusk | 4 joined Glow tiles, Settled+ |
  | Bumblebee | early | Bloom | Marigold, Cornflower | day | 4 joined Bloom tiles, Settled+ |
  | Mossback Hare | early | Verdure | Wood Sorrel | dawn | 4 joined Verdure tiles, Settled+ |
  | Glasswing Butterfly | early | Shimmer | Jewelweed | day | 4 joined Shimmer tiles, Settled+ |
  | Will-o'-Wisp Fox | early | Spirit | Wisp Cap | dawn | 4 joined Spirit tiles, Settled+ |
  | Cave Salamander | settled | Spore | Velvet Shank, Ink Cap | night | 3×3 Spore, Rich+ · bed with Velvet Shank · Woodlouse lives here |
  | Glowmoth | settled | Glow | Lantern Flower, Honey Mushroom | night | 3×3 Glow, Rich+ · bed with Lantern Flower · Firefly lives here |
  | Ruby-throated Hummingbird | settled | Bloom | Lavender | dawn | 3×3 Bloom, Rich+ · bed with Lavender · Tended+ |
  | Red Squirrel | settled | Verdure | Hosta, Wood Sorrel | day | 3×3 Verdure, Rich+ · bed with Hosta · Mossback Hare lives here |
  | Prism Moth | settled | Shimmer | Glassbell, Jewelweed | dusk | 3×3 Shimmer, Rich+ · bed with Glassbell · Glasswing lives here |
  | Barn Owl | settled | Spirit | Mistbell, Wisp Cap | night | 3×3 Spirit, Rich+ · bed with Mistbell · Tended+ |
  | Lanternback Stag | mystical | Glow + Verdure | Glowcap, Hellebore | dusk | 3×3 Deep Glow · 3×3 Deep Verdure · beds with Glowcap and Hellebore · Lovely+ · Glowmoth and Red Squirrel live here |
  | Mirrorshell Tortoise | mystical | Shimmer + Spore | Prism Rose, Morel | day | 3×3 Deep Shimmer · 3×3 Deep Spore · beds with Prism Rose and Morel · Lovely+ · Prism Moth and Cave Salamander live here |
  | Mist Crane | mystical | Bloom + Spirit | Anemone, Ancestor's Lace | dawn | 3×3 Deep Bloom · 3×3 Deep Spirit · beds with Anemone and Ancestor's Lace · Lovely+ · Hummingbird and Barn Owl live here |

  - Gifts are as before: one of each school's early/settled pair brings a gift-only plant (Spore Lantern, Moonpetal, Foxglove, Canopy Bells, Prismbell, Wispwillow), the other a colour variety's seeds. Mystical visitors bring Rare seeds of their first school.
  - Sprites are placeholders from `tools/gen_visitor_sprites.py`.
- **The Stump** (`landmarks.json` `landmark.stump`, `tuning.visitors.tribute`): found by the first Room to grow. It takes up 2×2 tiles, can't be cleared or moved, and the river goes around it.
  - Tap it to leave one gathered item (garden produce or a forage find). It sits on the stump until the next nightfall; until then you can take it back.
  - From nightfall it works for 24 hours, for visitors of the item's school and of a tier its own tier reaches: common items reach early visitors, uncommon ones settled visitors too, rare ones all. For them, interest rises 2×, 3× or 4× as fast (by the item's tier), and rises at half the normal rate even when their plants aren't blooming. A plant a visitor likes doubles its chance of visiting.
  - It never leaves a memento itself. When its day is over, the Stump answers on the next card: something lingered (a visitor it reached came), the offering was moved (it reached someone) or it was barely touched. The Stump's page shows the last answer.
  - One offering at a time.
- **The wishing well** (`landmarks.json` `landmark.well`, `tuning.well`): found by the second Room to grow. It takes up 2×2 tiles, can't be cleared or moved, and the river goes around it.
  - **Its focus:** each six-hour block (00:00, 06:00, 12:00, 18:00, like the tides) it's drawn to one of eight things: one of the six schools, all flora (plants) or all fungi (mushrooms). They come round in a shuffled order, each once per eight blocks, never the same twice in a row. Its page says what it wants and when that changes.
  - **A wish:** tap it, choose any handful of grown or foraged things (each with − / + / All), and drop them in. The handful's worth is each item's sell price, ×2.5 for what the well wants. The page shows how lucky it feels in words (a pebble's worth, a ripple, a stir, a swell, a surge, a wave), never as a number.
  - **The reward** is one of three. Luck (from the worth) makes the last two likelier, and nothing is ever certain:
    - **Coins:** 60–90% of the handful's worth, so a wish the well wants pays better than selling.
    - **A blessing** for 6 hours: one school (sometimes two, likelier with more luck) grows 1.5× as fast, and can be planted on any soil at full speed. Afterwards a plant left on the wrong soil crawls (as when a tide changes its tile). Blessings don't stack: blessing a school again only makes it last longer. The HUD shows a pill while one is on.
    - **A seed packet** of the focus school (or of what the handful was mostly), from Common to Legendary. More luck makes the rarer tiers likelier, but a Common packet is always possible.
  - In a simulation: one Marigold gives coins about 74% of the time. A handful of 40 rare mushrooms gives coins a third of the time, and about half its packets are Legendary.
- **Gift plants** (only from visitors, never in the Store): they grow 9–11h and sell for 13–16.
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
  - **Visitors:** set a visitor's interest (ready for a memento, ready to visit, reset), make it visit now (its next memento, or moving in if it can stay), move it in regardless, or see which of its conditions hold. Also give 2 of every colour variety packet.
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
                                gen_ui and gen_terrain); gen_offerings_sprites.py
                                for decor and relics; gen_canopy.py, gen_app_icon.py,
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
  - The Stump and the wishing well (`landmark.stump` 58×53, `landmark.well` 44×63) are drawn art, imported at their own size (one art pixel per game pixel) from `design/art/` by `python3 tools/import_sprite_image.py` (needs Pillow). They stand on their 2×2 tiles and overhang a little, like a tree.
  - Blind seed packets (`packet.<school>.<tier>`: a question mark, plain, green-trimmed, gold, violet with a seal or iridescent) and named packets (`packet.<plant>`: banded in its soil's colour with a little flower or cap in the plant's own colour), amendment sacks (`amend.<school>`), the seed tin (`garden.tin`) and the coin come from `gen_garden_sprites.py`.
  - Catalogue items and their bud stages (`plant.bud.<key>`; fungi get a small closed button) come from `gen_content_sprites.py`.
  - School soil tiles (`tile.<school>.<1–4>a/b`), and water come from `gen_terrain.py`.
  - Grass, the treeline floor and shrubs come from `gen_topdown.py`.
  - UI icons come from `gen_ui.py`.

### Content (`Resources/Content/`)

| File | What it holds |
|---|---|
| `items.json` | The Plant & Fungi Catalogue (from the spreadsheet): id, category, name, rarity, sprite, school, description. |
| `plants.json` | Garden plants (kept by hand): id, the catalogue item it yields, school, kind, family, source (`seeds`: comes from blind packets; `gift`: only from visitors), tier (common, uncommon, rare), companions, varieties. Numbers: `tuning.json` → `garden.plants`. Blind packets (`seeds.<school>.<tier>`) are built from the schools; each plant also has a named packet (`packet.<id>`), used for gifts. |
| `amendments.json` | Soil amendments (kept by hand): id, school (null = plain loam), name, text. |
| `landmarks.json` | Landmarks: the Stump and the wishing well (`footprint` 2×2; `discovery` firstExpansion / secondExpansion: placed by Room to grow, not at the start). |
| `opening.json` | The seed tin's card, the questions and their school weights, and what each school's tin holds. |
| `visitors.json` | Fifteen forest animals: name, sprite, tier (early, settled, mystical), school (and `schools` for two), likes (`plants` that must be blooming, `time` window), `stays` (conditions: soil, bed, beauty, resident), `mementos` (text, and which conditions each `hint`s at), `restate` and `parting` (a line per condition), `perk` (growth, tideHold), Field Guide text and gift (a seed packet id). |
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
- **Water:** water tiles (`tile.water.a/b`) come from `tools/gen_terrain.py`; the renderer cuts each water tile to today's level (a strip of bank, a dark wet edge, rounded outer corners and points of land in bends) and draws gentle waves over it: little crests that rise, rock a pixel side to side and fade, more and livelier the higher the water, plus the odd glint. A flood spills a translucent sheet over the banks. The waves hold still with reduced motion. Weather and moon icons (`ui.icon.sun/cloud/rain/storm`, `ui.icon.moon.0–7`) come from `gen_ui.py`, and rain or a storm draws falling rain over the garden.
- **Soil:** each school's soil is the grass tile with its greens moved toward the school's colour plus a few motif specks at four strengths, one per maturity level (`tile.<school>.<level>a/b`), with darker shadows at each level. Soil details (`detail.<school>.a/b`) are drawn by `tools/gen_terrain.py` from small pixel maps. A soil change fades in over `visuals.overlayFadeSeconds`.
  - **Clipped corners:** a soil tile's corner is clipped a little unless the tile above or below or the tile beside that corner has the same soil. Edges between matching tiles stay solid, so patches join up with slightly rounded outer corners.
  - A clipped corner shows the ground most common around the tile, whether grass or another soil.
  - The rounding has a 4-pixel radius and softens over its last 2 pixels in two alpha steps (`visuals.softCorners`; `ForestView.softTile` in `render.js`, cached per tile and corner mask).
- **Tree shadows (canopy):**
  - `design/shadow_overlay_v2.webp` is turned by `tools/gen_canopy.py` into `web/img/canopy.png`, a seamless light mask.
  - It's drawn world-anchored with a slow sway, plus soft light shafts (`visuals.canopy`).
- **Day and night:** the real local clock (`clock` in `tuning.json`): dawn 5:00–7:00, day 7:00–17:00, dusk 17:00–19:00, night 19:00–5:00, blended across 50 minutes.
  - Each state sets the canopy's shade and light, an ambient tint and fireflies (`visuals.lighting.states`).
  - Fireflies are a pure function of tile and time, so nothing runs while the app is hidden.
