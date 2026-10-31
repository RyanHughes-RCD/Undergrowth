import Foundation

/// A creature species (imported from the spawn table).
public struct CreatureDef: Codable, Identifiable, Hashable {
    public var id: String
    public var name: String
    /// "fungling", "sproutling", "geodeCritter", "wanderer".
    public var family: String
    public var familyName: String?
    public var rarity: Rarity?
    public var stats: [StatKey]
    /// Maximum points added at the creature's own tile once fully ramped.
    public var bonuses: StatValues?
    /// Fixed extra contributions (can be negative, e.g. Rot Hermit lowering Stone).
    public var extraContributions: StatValues?
    /// Influence radius in tiles.
    public var radius: Double?
    public var rampHours: Double?
    /// Find / arrival chance when its source event happens.
    public var chance: Double?
    /// Minimum stats of the tile where the source was found / planted / arrived.
    public var requires: [StatKey: StatBound]?
    public var source: CreatureSource?
    /// "day" or "night": when the seed must have been planted.
    public var plantedTime: String?
    /// Only one per forest.
    public var unique: Bool?
    public var howFound: String?
    /// Special effect description (from the spreadsheet).
    public var special: String?
    public var effects: [CreatureEffect]?
    /// Parts of the special effect not implemented yet.
    public var notYet: String?
    public var sprite: String
    public var glimmerSprite: String?
    /// Optional palette recolor for glimmer variants: palette index (as string) → color.
    public var glimmerPaletteSwap: [String: String]?
    public var guideText: String?

    public var displayFamily: String { familyName ?? family.capitalized }
}

public struct CreatureSource: Codable, Hashable {
    /// "mushroom", "seed", "geode" or "wanderer".
    public var kind: String
    /// Source item ids (mushroom or geode the creature hides in).
    public var items: [String]?
}

/// A creature's special ability, as data. See design/creature_effects.json.
public struct CreatureEffect: Codable, Hashable {
    public var type: String
    /// "radius" (default), "forest" or "tile".
    public var scope: String?
    public var mult: Double?
    public var chance: Double?
    public var category: String?
    public var rarities: [Rarity]?
    public var items: [String]?
    public var family: String?
    public var range: Double?
    public var bonus: Double?
    public var stat: StatKey?
    public var offset: Double?
    public var from: StatKey?
    public var to: StatKey?
    public var table: String?
    public var sprite: String?
    public var when: [StatKey: StatBound]?

    public var isForestWide: Bool { scope == "forest" }
}

/// Something an item does when used from the bag.
public struct ItemUse: Codable, Hashable {
    /// "soilBoost" or "nextGlimmer".
    public var type: String
    public var verb: String?
    public var stats: StatValues?
    public var hours: Double?
    public var permanent: Bool?
    public var text: String?
}

/// Any collectible or spawnable thing: plants, mushrooms, geodes, gems, materials, seeds.
/// `category` is a free string so new categories can be added from data.
public struct ItemDef: Codable, Identifiable, Hashable {
    public var id: String
    public var category: String
    public var name: String
    public var rarity: Rarity
    public var sprite: String
    /// If present, this item can spawn wild on the forest floor.
    public var spawn: SpawnRule?
    /// Loot table run when the wild spawn is tapped (default: you get the item itself).
    public var onCollect: String?
    /// Loot table run when the player cracks this item from their bag (geodes).
    public var onCrack: String?
    /// Loot table run when a planted seed of this item finishes growing.
    public var onGrow: String?
    /// Sprites for growth stages when planted (seeds): first → last (ready).
    public var growthSprites: [String]?
    /// Loot groups this item belongs to (e.g. "plants").
    public var groups: [String]?
    /// Extra weight within loot groups (default 1).
    public var lootWeight: Double?
    /// What happens when used from the bag (gems, materials).
    public var use: ItemUse?
    /// Whether this item appears in the Field Guide (default: true).
    public var inGuide: Bool?
    public var guideText: String?
    public var howFound: String?
    /// Verb for tapping the wild spawn ("Pick", "Dig"...).
    public var collectVerb: String?

    public var showsInGuide: Bool { inGuide ?? true }
    public var isPlantable: Bool { onGrow != nil }
    public var isCrackable: Bool { onCrack != nil }
}

public struct SpawnRule: Codable, Hashable {
    /// Relative weight among the wild spawns a tile qualifies for.
    public var baseWeight: Double
    /// Optional weight multiplier: `1 + Σ weight · stat / 100`.
    public var statWeights: [StatKey: Double]?
    /// Minimum (and/or maximum) stats the tile must have.
    public var requires: [StatKey: StatBound]?
    /// "night" or "day" only.
    public var time: String?
    /// Only while it's raining.
    public var rain: Bool?
    /// Only one may be on the map at a time.
    public var oneAtATime: Bool?
    /// Overrides the default wild-spawn lifetime.
    public var lifetimeHours: Double?

    public func weight(stats: StatValues, rarityWeight: Double) -> Double {
        if let req = requires, !StatCondition.check(req, stats) { return 0 }
        var mult = 1.0
        for (k, w) in statWeights ?? [:] { mult += w * (stats[k] ?? 0) / 100 }
        return max(0, baseWeight * rarityWeight * mult)
    }
}

// MARK: - Loot

public struct LootTable: Codable, Hashable {
    public var rolls: [LootRoll]
}

/// One roll in a loot table. Exactly one of `creature`, `item`, `group` should be set.
public struct LootRoll: Codable, Hashable {
    public var chance: Double?
    public var creature: String?
    public var item: String?
    /// Pick a random item from a group, weighted by rarity.
    public var group: String?
    public var count: NumRange?
    /// Restrict group picks to at least this rarity.
    public var minRarity: Rarity?
    /// Pity counter for this roll's `chance`: misses build up until a guaranteed hit.
    public var pity: String?
    /// Pity counter for group picks: guarantees a pick of `rarityPityMin` or better.
    public var rarityPity: String?
    public var rarityPityMin: Rarity?
    /// If this roll hits, skip the remaining rolls.
    public var exclusive: Bool?
    /// Pick exactly one item from this weighted list (geode loot tables).
    public var pick: [WeightedItem]?
    /// Marks seed drops (affected by seed-drop bonuses).
    public var seedDrop: Bool?
}

public struct WeightedItem: Codable, Hashable {
    public var item: String
    public var weight: Double
}

// MARK: - Tile rules

public enum TileLayer: String, Codable {
    case ground, overlay, decoration, tint
}

/// A data-driven visual rule.
/// - ground: highest matching priority wins (`suppressOverlays` hides overlays on it).
/// - overlay: transparent full-tile layers that stack. Within one `group` only the
///   highest-priority match draws; groups draw in the order they first appear.
/// - decoration: every match may add one small sprite (by `density`).
/// - tint: color wash whose strength scales with `stat`.
public struct TileRule: Codable, Hashable, Identifiable {
    public var id: String
    public var layer: TileLayer
    public var priority: Int?
    public var when: [StatKey: StatBound]?
    public var any: [[StatKey: StatBound]]?
    public var sprites: [String]?
    public var density: Double?
    public var color: String?
    public var stat: StatKey?
    public var strength: Double?
    public var group: String?
    public var suppressOverlays: Bool?

    public var condition: StatCondition { StatCondition(all: when ?? [:], any: any) }
}

// MARK: - Naming

public struct NameParts: Codable {
    public struct StatWords: Codable {
        public var adjectives: [String]
        public var places: [String]
        public var phrases: [String]
    }
    public var stats: [StatKey: StatWords]
    public var quietNames: [String]
    public var defaultPlaces: [String]
}
