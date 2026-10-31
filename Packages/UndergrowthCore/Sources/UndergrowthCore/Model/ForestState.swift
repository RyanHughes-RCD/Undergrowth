import Foundation

/// An individual creature with its own rolled traits. Has a UUID so it can
/// later be traded or shown in a friend's forest.
public struct CreatureInstance: Codable, Identifiable, Hashable {
    public var id: UUID
    public var typeID: String
    /// Full-strength contribution at the creature's own tile, per stat.
    public var contributions: StatValues
    /// Influence radius in tiles.
    public var radius: Double
    public var isGlimmer: Bool
    public var obtainedAt: Date
    public var nickname: String?
    /// How it was found ("starter", "mushroom.glowcap"...), for flavor.
    public var origin: String?
    /// Hours to ramp to full strength (from the species).
    public var rampHours: Double?
}

/// A creature's influence on the land. Records outlive the creature being on
/// the map: after `removedAt` the contribution decays, then the record is pruned.
public struct Placement: Codable, Identifiable, Hashable {
    public var id: UUID
    public var creatureID: UUID
    public var tile: GridPoint
    /// Snapshot of the creature's traits when placed.
    public var contributions: StatValues
    public var radius: Double
    public var placedAt: Date
    /// Level (0...1) the ramp started from (non-zero when re-placing a creature
    /// on a tile it is still decaying on).
    public var startLevel: Double
    public var removedAt: Date?
    /// Ramp/decay time for this creature (nil = tuning default).
    public var rampSeconds: Double?

    public var isActive: Bool { removedAt == nil }
}

/// A placement slot. `kind` is "normal" for now; a future "keystone" slot is just another kind.
public struct Slot: Codable, Hashable {
    public var kind: String
    public var placementID: UUID?
    public init(kind: String = "normal", placementID: UUID? = nil) {
        self.kind = kind; self.placementID = placementID
    }
}

/// An item sitting on the forest floor waiting to be collected.
public struct WildSpawn: Codable, Identifiable, Hashable {
    public var id: UUID
    public var itemID: String
    public var tile: GridPoint
    public var spawnedAt: Date
}

/// A dug-up geode waiting to be cracked. Remembers the stats of the tile it was
/// found on, which decide which Geode Critters can be inside.
public struct GeodeInstance: Codable, Identifiable, Hashable {
    public var id: UUID
    public var itemID: String
    public var foundTile: GridPoint?
    public var foundStats: StatValues
    public var foundAt: Date
}

/// A wanderer creature that has arrived on its own and is waiting to be befriended.
public struct Visitor: Codable, Identifiable, Hashable {
    public var id: UUID
    public var speciesID: String
    public var tile: GridPoint
    public var arrivedAt: Date
}

/// A flat stat bonus on one tile (crushed gems, Heartstone Core).
public struct SoilBoost: Codable, Identifiable, Hashable {
    public var id: UUID
    public var tile: GridPoint
    public var stats: StatValues
    public var appliedAt: Date
    /// nil = permanent.
    public var expiresAt: Date?

    public func isActive(at now: Date) -> Bool {
        now >= appliedAt && (expiresAt.map { now < $0 } ?? true)
    }
}

public struct PlantedSeed: Codable, Identifiable, Hashable {
    public var id: UUID
    public var seedItemID: String
    public var tile: GridPoint
    public var plantedAt: Date
    public var growSeconds: Double

    public func progress(at now: Date) -> Double {
        min(1, max(0, now.timeIntervalSince(plantedAt) / max(1, growSeconds)))
    }
    public func isReady(at now: Date) -> Bool { progress(at: now) >= 1 }
}

/// Everything saved about one forest. Self-contained so it can later be
/// shared as a snapshot (friend visits).
public struct ForestState: Codable {
    public static let currentVersion = 1

    public var version: Int
    public var forestID: UUID
    public var seed: UInt64
    public var rng: SeededRNG
    public var size: GridSize
    public var createdAt: Date
    public var customName: String?

    public var creatures: [CreatureInstance]
    public var placements: [Placement]
    public var slots: [Slot]
    public var spawns: [WildSpawn]
    public var plantedSeeds: [PlantedSeed]
    public var inventory: [String: Int]
    /// Field Guide entry keys (see `GuideKey`).
    public var discovered: Set<String>
    public var pity: [String: Int]
    public var lastSpawnTick: Date
    public var lastUpdated: Date
    /// Cached tile stats from the last update (the source of truth is `placements`).
    public var statCache: StatField?
    /// Debug: seconds added to the real clock (time-skip button).
    public var debugTimeOffset: TimeInterval
    public var geodes: [GeodeInstance] = []
    public var visitors: [Visitor] = []
    public var soilBoosts: [SoilBoost] = []
    /// Set by a Moonfall Shard: the next creature found is a glimmer.
    public var nextGlimmer = false
    /// Day number (since 1970, forest time) of the last wanderer check.
    public var lastWandererDay: Int?

    public func creature(_ id: UUID) -> CreatureInstance? { creatures.first { $0.id == id } }

    enum CodingKeys: String, CodingKey {
        case version, forestID, seed, rng, size, createdAt, customName, creatures, placements, slots, spawns,
             plantedSeeds, inventory, discovered, pity, lastSpawnTick, lastUpdated, statCache, debugTimeOffset,
             geodes, visitors, soilBoosts, nextGlimmer, lastWandererDay
    }

    public init(version: Int, forestID: UUID, seed: UInt64, rng: SeededRNG, size: GridSize, createdAt: Date,
                customName: String?, creatures: [CreatureInstance], placements: [Placement], slots: [Slot],
                spawns: [WildSpawn], plantedSeeds: [PlantedSeed], inventory: [String: Int], discovered: Set<String>,
                pity: [String: Int], lastSpawnTick: Date, lastUpdated: Date, statCache: StatField?,
                debugTimeOffset: TimeInterval) {
        self.version = version; self.forestID = forestID; self.seed = seed; self.rng = rng; self.size = size
        self.createdAt = createdAt; self.customName = customName; self.creatures = creatures
        self.placements = placements; self.slots = slots; self.spawns = spawns; self.plantedSeeds = plantedSeeds
        self.inventory = inventory; self.discovered = discovered; self.pity = pity; self.lastSpawnTick = lastSpawnTick
        self.lastUpdated = lastUpdated; self.statCache = statCache; self.debugTimeOffset = debugTimeOffset
    }

    // Older saves don't have the newer fields; default them.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        forestID = try c.decode(UUID.self, forKey: .forestID)
        seed = try c.decode(UInt64.self, forKey: .seed)
        rng = try c.decode(SeededRNG.self, forKey: .rng)
        size = try c.decode(GridSize.self, forKey: .size)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        customName = try c.decodeIfPresent(String.self, forKey: .customName)
        creatures = try c.decode([CreatureInstance].self, forKey: .creatures)
        placements = try c.decode([Placement].self, forKey: .placements)
        slots = try c.decode([Slot].self, forKey: .slots)
        spawns = try c.decode([WildSpawn].self, forKey: .spawns)
        plantedSeeds = try c.decode([PlantedSeed].self, forKey: .plantedSeeds)
        inventory = try c.decode([String: Int].self, forKey: .inventory)
        discovered = try c.decode(Set<String>.self, forKey: .discovered)
        pity = try c.decode([String: Int].self, forKey: .pity)
        lastSpawnTick = try c.decode(Date.self, forKey: .lastSpawnTick)
        lastUpdated = try c.decode(Date.self, forKey: .lastUpdated)
        statCache = try c.decodeIfPresent(StatField.self, forKey: .statCache)
        debugTimeOffset = try c.decodeIfPresent(TimeInterval.self, forKey: .debugTimeOffset) ?? 0
        geodes = try c.decodeIfPresent([GeodeInstance].self, forKey: .geodes) ?? []
        visitors = try c.decodeIfPresent([Visitor].self, forKey: .visitors) ?? []
        soilBoosts = try c.decodeIfPresent([SoilBoost].self, forKey: .soilBoosts) ?? []
        nextGlimmer = try c.decodeIfPresent(Bool.self, forKey: .nextGlimmer) ?? false
        lastWandererDay = try c.decodeIfPresent(Int.self, forKey: .lastWandererDay)
    }
}

public enum GuideKey {
    public static func creature(_ typeID: String, glimmer: Bool) -> String {
        glimmer ? "creature:\(typeID):glimmer" : "creature:\(typeID)"
    }
    public static func item(_ id: String) -> String { "item:\(id)" }
}

/// Stats for every tile at a moment in time. Flat storage for speed.
public struct StatField: Codable, Hashable {
    public var size: GridSize
    public var keys: [StatKey]
    public var values: [Double]

    public init(size: GridSize, keys: [StatKey]) {
        self.size = size; self.keys = keys
        values = Array(repeating: 0, count: size.count * keys.count)
    }

    @inline(__always) func offset(_ p: GridPoint) -> Int { (p.y * size.width + p.x) * keys.count }

    public func stats(at p: GridPoint) -> StatValues {
        guard size.contains(p) else { return [:] }
        var out: StatValues = [:]
        let o = offset(p)
        for (i, k) in keys.enumerated() { out[k] = values[o + i] }
        return out
    }

    public func value(_ key: StatKey, at p: GridPoint) -> Double {
        guard size.contains(p), let i = keys.firstIndex(of: key) else { return 0 }
        return values[offset(p) + i]
    }

    public mutating func set(_ stats: StatValues, at p: GridPoint) {
        let o = offset(p)
        for (i, k) in keys.enumerated() { values[o + i] = stats[k] ?? 0 }
    }

    /// Forest-wide average per stat.
    public func means() -> StatValues {
        var out: StatValues = [:]
        let n = Double(max(1, size.count))
        for (i, k) in keys.enumerated() {
            var sum = 0.0
            var j = i
            while j < values.count { sum += values[j]; j += keys.count }
            out[k] = sum / n
        }
        return out
    }
}
