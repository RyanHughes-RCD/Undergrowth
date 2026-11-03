# Animal Visitors: notes for later

Source: the "Animal Visitors" sheet of `terrain_school_ecosystem_catalogue_expanded.xlsx` (12 animals, two per school). **Not in the game yet.** These notes compare the list with the visitors the game has now (`Resources/Content/visitors.json`, see README → Visitors) and sketch how each could be set up with the existing visitor system, so the work can start from here.

## The catalogue's animals

| School | Animal | Origin | Why it comes (from the catalogue) |
|---|---|---|---|
| Shimmer | Glasswing Butterfly | Real | A clear-winged butterfly whose transparent wings suit bright, shimmering clearings. |
| Shimmer | Prism Moth | Fantasy | A moth with reflective scales that flash different colours as it turns. |
| Bloom | Bumblebee | Real | A fuzzy pollinator drawn to abundant nectar-rich flowers. |
| Bloom | Ruby-throated Hummingbird | Real | A hovering nectar-feeder attracted to tubular, brightly coloured blooms. |
| Glow | Firefly | Real | A glowing insect that gathers in warm, sheltered vegetation. |
| Glow | Glowmoth | Fantasy | A soft-winged moth with luminous markings that pulse in the dark. |
| Spirit | Barn Owl | Real | A quiet, pale nocturnal hunter suited to silent, misty clearings. |
| Spirit | Will-o'-Wisp Fox | Fantasy | A fox-like spirit with faintly glowing paws that appears near old trees. |
| Spore | Woodlouse | Real | A moisture-loving detritivore commonly found beneath logs and leaf litter. |
| Spore | Cave Salamander | Fantasy | A pale, damp-skinned salamander shelters among fungal roots and soft soil. |
| Verdure | Red Squirrel | Real | A nimble tree-dweller attracted to seed-rich, connected woodland. |
| Verdure | Mossback Hare | Fantasy | A small hare with mossy fur and leaf-like tufts that blends into dense greenery. |

## How they line up with today's visitors

Today there is one common visitor per school (the two rare ones that need mixed terrain are off).

| School | In the game now | Closest catalogue animal | Note |
|---|---|---|---|
| Spore | Mossback Hedgehog | Woodlouse, Cave Salamander | No direct match. The hedgehog could stay, or give way to the two catalogue animals. |
| Glow | Lantern Moth | Glowmoth | Almost the same idea: rename or merge. Firefly would be new. |
| Bloom | Honey Bumble | Bumblebee | Same animal: rename to Bumblebee. Hummingbird would be new. |
| Verdure | Fern Rabbit | Mossback Hare | Very close (a mossy hare vs a fern-eared rabbit): merge. Red Squirrel would be new. |
| Shimmer | Prism Beetle | Prism Moth, Glasswing Butterfly | Different animals, same mood. Decide whether the beetle stays. |
| Spirit | Mist Fox | Will-o'-Wisp Fox | Same idea: rename to Will-o'-Wisp Fox. Barn Owl would be new. |

The name "Mossback" is used twice: today's Mossback Hedgehog (Spore) and the catalogue's Mossback Hare (Verdure). Rename one if both end up in the game.

## Suggested preferences (using the current visitor system)

Each visitor can like a school at a minimum intensity, optionally a find growing unpicked there, a time window (dawn, day, dusk, night) and optionally rain (`likes` in `visitors.json`), with a clue line per preference. Ideas that fit the new Plant & Fungi Catalogue:

| Animal | School, intensity | Liked find | Time | Rain | Clue ideas |
|---|---|---|---|---|---|
| Glasswing Butterfly | Shimmer, Low–Moderate | Prismbell or Jewelweed | day | no | "A wing-scale like a sliver of glass lies on a Prismbell." |
| Prism Moth | Shimmer, Moderate+ | Glassreed | dusk | no | "Tiny rainbow flecks dust the crystals at dusk." |
| Bumblebee | Bloom, Low–Moderate | Cornflower or Clover | day | no | "Pollen-dusted footprints wander between the Cornflowers." |
| Ruby-throated Hummingbird | Bloom, Moderate+ | Foxglove (tubular blooms) | dawn or day | no | "The Foxglove bells are sipped dry." |
| Firefly | Glow, Low | Stargrass | dusk | no | "Stargrass tips flicker as if something just rose from them." |
| Glowmoth | Glow, Moderate+ | Moonpetal | night | no | "Glowing dust lies on the Moonpetals after dark." |
| Barn Owl | Spirit, Moderate+ | none | night | no | "A soft pale feather rests in the mist." |
| Will-o'-Wisp Fox | Spirit, Low–Moderate | Wispwillow (old trees) | dawn | no | "Faintly glowing pawprints circle the Wispwillow." |
| Woodlouse | Spore, Low | Turkey Tail or Dead Man's Fingers (dead wood) | day | yes | "Tiny tracks cross the damp wood after rain." |
| Cave Salamander | Spore, Moderate+ | Spore Lantern | night | yes | "A pale, damp trail winds between the fungal roots." |
| Red Squirrel | Verdure, Moderate+ | Hellebore or Canopy Bells | day | no | "Nibbled husks lie under the Canopy Bells." |
| Mossback Hare | Verdure, Low–Moderate | Wood Sorrel | dawn | no | "Little paths are pressed through the Wood Sorrel." |

With two animals per school, one could be the common first visitor (the one whose tracks circle the first relic) and the other a rarer one that needs higher intensity, a specific find or rain.

## Art needed

A sprite for each of the 12 animals (today's visitors borrow creature sprites as placeholders), plus track decals per kind: pawprints, wing dust, feathers, slime trails, nibbled husks.
