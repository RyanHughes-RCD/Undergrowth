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

    public func creature(_ id: UUID) -> CreatureInstance? { creatures.first { $0.id == id } }
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
