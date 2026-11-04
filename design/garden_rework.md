# Garden rework: plant, grow overnight, harvest

Undergrowth becomes a deliberate gardening game. You choose a seed packet, plant it on a tile, watch it grow through visible stages in real time, harvest it in the morning, and decide what to plant next. Nothing spawns on its own (apart from a small foraging patch). The land changes because you change it.

What goes: creatures, eggs, nests, wanderers, geodes and gems, combo tiles and named terrains, the Spirit Well, Mystery Seeds, school seeds as area boosts, earned landmarks, starter tasks, and the whole stat-field engine (overlapping school fields, intensity bands, falloff, ambient Spore, elevation, the Glow and Bloom cycles). Wild spawning goes too: location weighting, category tilt, terrain affinity, the spawn cap, the return harvest, wilting and relic drops.

What stays: the clearing and treeline, the Old Log, the Store, decor placement, the Field Guide shell, visitors and their clue design, the opening questions, developer mode, the art pipeline and the per-school ground colours.

## Plant data shape

Plants live in `Resources/Content/plants.json`, which is kept by hand. A plant has a nested shape (stages, companions, varieties) and there are only about twenty, so a hand-kept file is easier to read and review than spreadsheet columns. The art and names still come from the Plant & Fungi Catalogue entries in `items.json` (the plant's produce is that catalogue item). Every number lives in `tuning.json` → `garden` (with an `_about`), keyed by plant id.

```json
{"id": "marigold", "item": "plant.marigold", "school": "bloom", "kind": "flower", "family": "daisy",
 "source": "starter",
 "companions": [{"with": "cornflower", "effect": "yield"}],
 "varieties": [{"id": "marigold.lemon", "name": "Lemon Marigold", "hue": 50}]}
```

```json
"garden": {"plants": {"marigold": {"growHours": 8, "yield": 3, "seeds": [1, 0.5], "sell": 4, "packet": 6}}}
```

- `source` is `starter` (in the Store from the start), `store` (opens with a beauty tier or a commission) or `gift` (only from a befriended visitor).

## Soil

- Every clearing tile has one soil: plain, or one of the six schools. A new garden is all plain.
- Amendments are Bag items: Spore compost, Glow dust, Bloom mulch, Verdure leaf mould, Shimmer crystal dust and Spirit mist, plus Garden loam (back to plain). Use one on an empty tile and that tile's soil stays changed until you change it again.
- School soil uses that school's ground tile (`tile.<school>.2a/b`). Plain soil is grass.

## Growth timing

- The preferred soil gives normal speed (×1). Plain soil gives ×0.6.
- **Another school's soil can't be planted.** Planting on it would be slow enough to look like a broken plant, and it would hide what the soil is for. Refusing it says so at once: in planting mode the tiles you can use are highlighted, and tapping a wrong one explains why.
- Stages: seed (under 15%), sprout (under 45%), bud (under 75%), bloom, then ready (100%). Grow times are 6–24h at ×1.
- Timing is deterministic from timestamps. Each plant stores `grown` (ms of growth so far), `since` and `rate`. Progress at time t is `(grown + (t − since) × rate) / need`.
- Things that change a rate (planting, harvesting, decor, soil, relics) happen only through player actions. Before each one, every plant banks its growth at the old rate, so growth while you're away is a simple straight line.
- A ready plant waits forever. Nothing wilts or dies.

## Harvest outputs

- Tap a ready plant to harvest it. You get `yield` produce (the catalogue item).
- Seeds: `seeds: [guaranteed, chance of one more]` packets of the same plant. Commons return 1 (+50%); rares 0 (+50%).
- Every plant leaves its tile when harvested (perennials were removed: nothing regrows in place).
- Starter grow times are staggered (6, 8, 10, 12, 14, 16, 20 and 24h) so something is ready most mornings.

## Morning check

- On opening after 4h or more away, a small card names what's ready and when the next plant will be.
- At most one small surprise per local day (chance 0.7, chosen deterministically from the garden seed and the day):
  - a self-seeded seedling next to a blooming parent
  - a befriended visitor's gift (seeds you can't buy)
  - a rare colour: a ready plant turns out as one of its varieties

## Companions

- Each plant has one or two neighbour rules. A named companion in the 8 neighbouring tiles gives either ×1.25 growth speed or +1 produce.
- A rule is discovered the first time you harvest while it's active. It then shows on the plant's Field Guide page. Before that, the plant's card hints "It seems happy here."

## Currency

- One soft currency: coins. You earn them by selling produce in the Store's Sell tab, and from commissions, daily orders and collection rewards.
- Coins buy seed packets, amendments, decor and Room to grow.
- The first numbers: produce sells for 3–12 coins and a packet costs 5–15. The first morning's harvest pays for the next round of seeds plus a little spare.

## Decor and beauty

- Decor: paths, fences, raised beds, planters, lanterns and benches, placed and moved by hand. Paths sit under everything. A raised bed holds a plant and gives it +1 produce. Lanterns glow at night.
- Relics become ornaments (one per school). Each gives its school's plants in the surrounding 3×3 ×1.2 growth. You earn them by completing a school's collection.
- Beauty = 3 × distinct plants + 1 × blooming or ready plants + Σ decor beauty. It shows as a named tier with a leaf meter (Bare, Tended, Pleasant, Lovely, Charming, Enchanting), never as a number. The best tier reached opens Store items and never relocks.

## Long-term goals

- **Collections:** harvest every base plant of a school to get its relic ornament and coins.
- **Cross-pollination:** harvest a plant with a blooming plant of the same family next to it, and a hidden chance gives a seed of one of its colour varieties. Varieties have their own Field Guide entries and sell for twice as much.
- **Commissions** at the Old Log ask for produce and pay coins. Some open Store items. Two daily orders change each day.
- **Visitors:** twelve animals (two per school, from `design/animal_visitors_notes.md`) come for particular plants blooming, in a time window. Their tracks and clues work as before, and you befriend one by tapping it. One of each school's pair brings a gift-only plant; the other brings a variety seed.
- **Room to grow:** clearing expansions bought with coins.

## Save handling

- Save version 7. Loading an older save copies it to `undergrowth.forest.v1.archive.v<old version>` and starts a fresh garden.
- Field Guide discoveries carry over (keys `item:`, `visitor:` and the rest).
- Developer saves do the same under their own key.

## Open questions

- Should amendments wear off over time? Here they're permanent until changed, as asked.
- Is ×0.6 on plain soil gentle enough? It turns an 8h plant into 13h, which still lands on the next morning.
- Rain had no remaining job once wild spawns went, so it's gone. Bring it back as watering, or as a visitor condition?
- New sprites (packets, amendments, raised bed, the twelve animals) are generated placeholders. They need real art.
