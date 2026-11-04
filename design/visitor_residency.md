# Visitors who stay: mementos, the Stump and residency

Design notes for reworking the visitor system (`Content/visitors.json`, `tuning.visitors`). **Not in the game yet.**

## The change in one line

Today a visitor's interest grows, it leaves **tracks** with clues, turns up in its time window, and is befriended with a tap for gift seeds, then it's gone. In this design, a visitor leaves a series of **mementos** instead of tracks. Once it has left all of them, it **moves in** the first time its conditions are met, and **stays for as long as they hold**. It leaves at the first check where they don't. The conditions are never listed. Players work them out from the mementos.

Residents replace the role landmarks used to play: a well-developed, well-kept garden fills up with animals, and each brings something.

## Decisions so far

| Question | Decision |
|---|---|
| What does the first Room to grow reveal? | Its wild soil patch **and** the Stump. The Stump takes the place of that purchase's wild feature. |
| What can a flowerbed condition ask for? | Any plant the player has harvested at least once (it's in their Field Guide). |
| When does a resident leave? | Strictly: at the first visitor check (`checkMinutes`, 30) where any condition is broken. No grace period. |

## 1. Mementos

- **Mementos replace tracks and take no tile.** A memento arrives on the return card ("Something was here while you were away…") and is kept on the visitor's Field Guide page, which stays a silhouette until the visitor moves in. Once the Stump exists, the newest memento can also sit on it as a small, non-blocking glint until the player looks.
- **The number of mementos is set by tier:** 1 for an early visitor, 2–3 for a settled one, 4 for a mystical one.
- **Each memento hints at one condition.** Hints use the game's own world (a school's mood, soil depth, shape, a plant's scent, how cared-for the garden feels, who else lives there) and never name a number or a mechanic.
- **Order:** the first memento always hints at the visitor's school. Later ones cover the rest of its conditions.
- **Restating mementos:** if the series is complete and the visitor comes again with a condition unmet, it leaves a restating memento. That memento hints at one unmet condition, more plainly than before. This keeps stuck players moving without showing a checklist.
- **Parting memento:** a resident that leaves drops one more memento that names the broken condition plainly ("The patch it slept in was washed away").

### How visits happen (reusing the interest model)

- Interest still rises while the visitor's liked plants are blooming (or ready), and falls otherwise. The thresholds stay the same.
- At the `signs` threshold the first memento is left. After that, each **visit** (the existing `presence` roll in its time window) leaves the next memento.
- Visits mostly happen unseen, while the player is away. The memento is the evidence.
- On the visit after the last memento, if every condition holds, the visitor **moves in**. If not, it leaves a restating memento.
- A visitor that has left keeps its mementos and its interest. It moves back in at its next visit with the conditions met, with no new series.

## 2. The Stump

- **Revealed by the first Room to grow**, beside that purchase's wild soil patch, in place of the wild feature. The school whose feature is skipped gets it later in the cycle.
- It's 2×2, since you can't see behind a stump that size. It can't be cleared, moved or dug through, and the river routes around it like any fixed feature.
- **Tribute:** one harvested item at a time, placed on the stump. It's taken the following night.
- **What a tribute does (for the next 24 hours):**
  - **School:** interest gain is multiplied for every visitor of the item's school: ×2 for a common item, ×3 uncommon, ×4 rare.
  - **Reach:** the item's tier sets which visitors it touches. A common item reaches early visitors, uncommon reaches settled ones too, and rare reaches all, mystical included.
  - **Courting without blooms:** visitors of that school gain a little interest (about half the normal gain) even when their liked plants aren't blooming. This lets a tribute start a courtship for a school the garden barely grows.
  - **A liked plant:** if the item is a plant a visitor likes, that visitor's next visit roll is doubled. This is the confirmation moment: "The memento smelled of Lantern Flower, so I offered one, and it came back."
- **It never gives a memento itself.** The next morning it gives one line of feedback instead:
  - A visitor it reached left a memento: *"Something lingered here a long while."*
  - It reached someone but no visit followed: *"The offering has been moved, just a little."*
  - It reached no one: *"The offering was barely touched."*

## 3. What can be a condition

Conditions have to be things that **last**, because breaking one means the resident leaves straight away.

| Condition | Built on | Notes |
|---|---|---|
| **Soil patch** | `state.soil` + soil maturity | N connected tiles of a school's soil at a minimum level (Settled, Rich, Deep). The largest is a 3×3 of **Deep**. The tides threaten young patches, and maturity and plants resist them, so stable patches are developed ones. |
| **Flowerbed** | Raised beds (decor with `holdsPlant`) | A raised bed with a named plant on it, at any stage, **ready included**. Nothing wilts, so a ready plant left unharvested holds the condition forever. Harvesting it ends the condition: the trade-off is the harvest or the resident. The plant must be one the player has harvested before. |
| **Garden care** | Beauty tiers | Current beauty, not `beautyBest`, at Tended, Pleasant, Lovely or more. Decor and wild features give a stable floor, while blooms move it up and down. |
| **Company** | Other residents | "Settles only where a Firefly already lives." This builds the ladder. |
| **Time** | `likes.time` | Not a stay condition. It's only when a resident is seen around the garden. |

**Liked plants blooming** stays a *courtship* condition (it drives interest) but is **never** a stay condition. Otherwise every harvest would evict someone.

## 4. The ladder

### Tier 1: Early (1 memento, stays easily)

The stay condition is soil only. Everyone grows something, so every school gets an early resident. The first expansion's 4-tile wild patch is enough on its own once it reaches Settled.

| Visitor | School | Courted by (blooming) | Stays while | Memento |
|---|---|---|---|---|
| Woodlouse | Spore | Ink Cap | 4 connected Spore tiles, Settled+ | *"A tiny curled grey shell, damp from the shade under the caps."* |
| Firefly | Glow | Foxfire Button | 4 connected Glow tiles, Settled+ | *"A spent little lantern-shell, still warm at one end."* |
| Bumblebee | Bloom | Marigold, Cornflower | 4 connected Bloom tiles, Settled+ | *"A smudge of golden pollen, as if something rested here heavy with it."* |
| Mossback Hare | Verdure | Wood Sorrel | 4 connected Verdure tiles, Settled+ | *"A tuft of soft green-grey fur caught on a leaf."* |
| Glasswing Butterfly | Shimmer | Jewelweed | 4 connected Shimmer tiles, Settled+ | *"A wing-scale like a sliver of glass. The light bends through it."* |
| Will-o'-Wisp Fox | Spirit | Wisp Cap | 4 connected Spirit tiles, Settled+ | *"A pawprint that glows faintly, then fades as you watch."* |

### Tier 2: Settled (3 mementos)

These need a real patch, a kept bed, a little care, and their school's early resident.

| Visitor | School | Courted by | Stays while | Mementos (in order) |
|---|---|---|---|---|
| Cave Salamander | Spore | Velvet Shank, Ink Cap | 3×3 Spore, Rich+ · bed with Velvet Shank · Woodlouse resident | *"A pale, damp skin, shed whole."* · *"It came from somewhere wide and dark, where the soil is old."* · *"It curled up beside the Velvet Shank in its bed, as if it were home."* |
| Glowmoth | Glow | Lantern Flower, Honey Mushroom | 3×3 Glow, Rich+ · bed with Lantern Flower · Firefly resident | *"Glowing dust, soft as flour."* · *"It circled the middle of a broad, bright patch, never the edge."* · *"It followed the little lights here. It doesn't like to be the only one glowing."* |
| Hummingbird | Bloom | Lavender | 3×3 Bloom, Rich+ · bed with Lavender · beauty Tended+ | *"A tiny ruby feather."* · *"A bed of Lavender, kept and waiting, is what it was looking for."* · *"It seemed to judge the whole garden before it left."* |
| Red Squirrel | Verdure | Hosta, Wood Sorrel | 3×3 Verdure, Rich+ · bed with Hosta · Mossback Hare resident | *"A neatly split husk."* · *"It wants cover on every side: a wide, deep green."* · *"It sat a long while near where the hare sleeps."* |
| Prism Moth | Shimmer | Glassbell, Jewelweed | 3×3 Shimmer, Rich+ · bed with Glassbell · Glasswing resident | *"Rainbow flecks on the crystals at dusk."* · *"It danced over the Glassbell bed until dark."* · *"It came looking for the glass-winged one."* |
| Barn Owl | Spirit | Mistbell, Wisp Cap | 3×3 Spirit, Rich+ · bed with Mistbell · beauty Tended+ | *"A soft pale feather, resting in the mist."* · *"It watched from the middle of the old, misty ground."* · *"It only settles where the garden is cared for."* |

### Tier 3: Mystical (4 mementos, new animals)

Two schools, Deep soil, rare plants in beds, a lovely garden and a community. The names below are placeholders.

| Visitor | Schools | Stays while |
|---|---|---|
| Lanternback Stag | Glow + Verdure | 3×3 Deep Glow · 3×3 Deep Verdure · beds with Glowcap and Hellebore · beauty Lovely+ · Glowmoth and Red Squirrel residents |
| Mirrorshell Tortoise | Shimmer + Spore | 3×3 Deep Shimmer · 3×3 Deep Spore · beds with Prism Rose and Morel · beauty Lovely+ · Prism Moth and Cave Salamander residents |
| Mist Crane | Bloom + Spirit | 3×3 Deep Bloom · 3×3 Deep Spirit · beds with Anemone and Ancestor's Lace · beauty Lovely+ · Hummingbird and Barn Owl residents |

Mystical mementos follow the same order: both schools in one line, then depth and shape, then the beds, then care and company. They're courted by blooming rare plants of both schools, and only a rare tribute reaches them.

## 5. What residents bring

- **All residents:** the existing morning gift seeds (their `gift` packet), now on a regular basis while they live there, plus their gift packets once when they move in.
- **Visible life:** each resident roams its own patch in its time window and never blocks a tile. A grown garden looks inhabited.
- **Perks** (ideas, to tune):
  - **Early:** plants of its school on its patch grow a little faster.
  - **Settled:** its patch resists the tides; cross-pollination odds rise near its bed; or an extra Store amendment slot for its school.
  - **Mystical:** one bigger effect each, for example a weekly rare packet, rare colour varieties more likely across the garden, or Deep soil spreading at the tides from its patch.

## 6. Leaving, strictly

- A resident leaves at the first visitor check where any condition is broken.
- In practice, soil only changes at the tides (every 6 hours) and beds and beauty only change when the player acts. So leaving happens either after a tide or right after something the player did.
- The parting memento names the broken condition plainly, so rebuilding is clear.
- Coming back needs one visit with the conditions met. No new series.
- **Optional, to stay fair without spelling anything out:** when the player is about to harvest a plant whose bed a resident depends on, the confirmation card adds a soft line such as *"The Glowmoth is watching you closely."* It's a hint, not a rule.

## 7. Data sketch (`visitors.json`)

```json
{
  "id": "visitor.moth",
  "tier": "settled",
  "school": "glow",
  "likes": { "plants": ["lantern-flower", "honey-mushroom"], "time": "night" },
  "stays": [
    { "kind": "soil", "school": "glow", "shape": "3x3", "minLevel": 3 },
    { "kind": "bed", "plant": "lantern-flower" },
    { "kind": "resident", "visitor": "visitor.firefly" }
  ],
  "mementos": [
    { "hint": "school", "text": "Glowing dust, soft as flour." },
    { "hint": "stays.0", "text": "It circled the middle of a broad, bright patch, never the edge." },
    { "hint": "stays.2", "text": "It followed the little lights here. It doesn't like to be the only one glowing." }
  ],
  "restate": { "stays.0": "…", "stays.1": "…", "stays.2": "…" },
  "parting": { "stays.0": "…", "stays.1": "…", "stays.2": "…" },
  "perk": { "type": "tideResist", "radius": 1 }
}
```

Save state: per visitor `mementos` (count left), `resident` (bool), `movedInAt`, `leftAt`. Tracks (`tracks`, `clues` stage) go away.

## 8. Still open

- Should a bed plant that's a colour variety count for its base plant?
- Can one tile's soil count toward two residents' patches? (Sharing makes mystical easier. Separate patches make the garden bigger.)
- Does the Stump hold one tribute at a time, or a few?
- Art: a 2×2 stump, memento icons (a set per kind: shell, feather, fur, dust, scale, pawprint), and sprites for the three mystical animals.
