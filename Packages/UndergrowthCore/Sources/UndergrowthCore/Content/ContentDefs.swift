import Foundation

/// A creature type. Trait ranges live in `tuning.json` under `creatureTraits[id]`.
public struct CreatureDef: Codable, Identifiable, Hashable {
    public var id: String
    public var name: String
    public var stats: [StatKey]
    public var sprite: String
    /// Optional separate sprite for glimmer variants.
    public var glimmerSprite: String?
    /// Optional palette recolor for glimmer variants: palette index (as string) → color.
    public var glimmerPaletteSwap: [String: String]?
    public var guideText: String?
}

/// Any collectible or spawnable thing: plants, mushrooms, geodes, rough rocks, gems, seeds.
/// `category` is a free string so new categories can be added from data.
public struct ItemDef: Codable, Identifiable, Hashable {
    public var id: String
    public var category: String
    public var name: String
    public var rarity: Rarity
    public var sprite: String
    /// If present, this item can spawn wild on the forest floor.
    public var spawn: SpawnRule?
    /// Loot table run when the wild spawn is tapped.
    public var onCollect: String?
    /// Loot table run when the player cracks this item from their bag (rough rocks).
    public var onCrack: String?
    /// Loot table run when a planted seed of this item finishes growing.
    public var onGrow: String?
    /// Sprites for growth stages when planted (seeds): first → last (ready).
    public var growthSprites: [String]?
    /// Loot groups this item belongs to (e.g. "gems", "plants").
    public var groups: [String]?
    /// Extra weight within loot groups (default 1).
    public var lootWeight: Double?
    /// Whether this item appears in the Field Guide (default: true).
    public var inGuide: Bool?
    public var guideText: String?
    /// Verb for tapping the wild spawn ("Pick", "Dig"...).
    public var collectVerb: String?

    public var showsInGuide: Bool { inGuide ?? true }
    public var isPlantable: Bool { onGrow != nil }
    public var isCrackable: Bool { onCrack != nil }
}

public struct SpawnRule: Codable, Hashable {
    public var baseWeight: Double
    /// Weight multiplier: `1 + Σ weight · stat / 100`.
    public var statWeights: [StatKey: Double]?
    /// Hard stat thresholds the tile must meet.
    public var requires: [StatKey: StatBound]?

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
}

// MARK: - Tile rules

public enum TileLayer: String, Codable {
    case ground, decoration, tint
}

/// A data-driven visual rule. Ground: highest matching priority wins.
/// Decoration: every match may add one decoration (by `density`).
/// Tint: color overlay whose strength scales with `stat`.
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
