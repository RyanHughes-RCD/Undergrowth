import Foundation

/// One thing the player received.
public enum LootResult: Hashable {
    case item(id: String, count: Int, isNew: Bool)
    case creature(CreatureInstance, isNew: Bool)

    public var isNew: Bool {
        switch self {
        case .item(_, _, let n): return n
        case .creature(_, let n): return n
        }
    }
}

public enum PendingLoot: Hashable {
    case item(String, Int)
    case creature(CreatureInstance)
}

/// Modifiers that creature effects apply to a single loot roll.
public struct LootModifiers {
    public var seedDropMult: Double = 1
    public var gemUpgradeChance: Double = 0
    public init() {}
}

/// Rolls creatures and loot tables, tracking pity counters in the forest state.
public struct LootRoller {
    public let content: ContentDatabase
    public init(content: ContentDatabase) { self.content = content }

    var tuning: Tuning { content.tuning }

    // MARK: Creatures

    /// A new individual of a species: rolls 60–100% of the species' maximum bonuses
    /// (range from tuning); glimmers get +50% bonuses and +1 radius.
    public func rollCreature(typeID: String, origin: String?, now: Date,
                             forceGlimmer: Bool? = nil, rng: inout SeededRNG) -> CreatureInstance {
        let def = content.creatures[typeID]
        let roll = tuning.roll
        let glimmer = forceGlimmer ?? rng.chance(tuning.glimmerChance)
        var contributions: StatValues = [:]
        if let bonuses = def?.bonuses {
            for (stat, maxBonus) in bonuses {
                var v = maxBonus * roll.bonusRange.random(using: &rng)
                if glimmer { v *= roll.glimmerBonusMult }
                contributions[stat] = (v * 10).rounded() / 10
            }
        } else if let profile = tuning.creatureTraits?[typeID] {
            // Legacy content: per-type ranges in tuning.
            for (stat, range) in profile.contribution {
                var v = range.random(using: &rng)
                if glimmer { v = max(v, range.random(using: &rng)) * profile.glimmer.contributionMult }
                contributions[stat] = (v * 10).rounded() / 10
            }
        }
        for (stat, v) in def?.extraContributions ?? [:] {
            contributions[stat, default: 0] += glimmer ? v * roll.glimmerBonusMult : v
        }
        var radius = def?.radius ?? tuning.creatureTraits?[typeID]?.radius.random(using: &rng) ?? 2
        if glimmer { radius += roll.glimmerRadiusBonus }
        return CreatureInstance(id: UUID(rng: &rng), typeID: typeID, contributions: contributions,
                                radius: (radius * 10).rounded() / 10, isGlimmer: glimmer, obtainedAt: now,
                                nickname: nil, origin: origin, rampHours: def?.rampHours)
    }

    // MARK: Pity

    /// Rolls `chance` with a pity counter: after `threshold - 1` misses the next roll always hits.
    public func pityRoll(chance: Double, key: String?, pity: inout [String: Int], rng: inout SeededRNG) -> Bool {
        guard let key, let threshold = tuning.pity[key], threshold > 0 else { return rng.chance(chance) }
        let misses = pity[key, default: 0]
        let hit = misses + 1 >= threshold || rng.chance(chance)
        pity[key] = hit ? 0 : misses + 1
        return hit
    }

    // MARK: Tables

    /// Rolls a loot table. Results are not yet added to inventory.
    public func roll(table id: String, origin: String?, now: Date, modifiers: LootModifiers = LootModifiers(),
                     pity: inout [String: Int], rng: inout SeededRNG) -> [PendingLoot] {
        guard let table = content.loot[id] else { return [] }
        var out: [PendingLoot] = []
        for r in table.rolls {
            let hit = pityRoll(chance: r.chance ?? 1, key: r.pity, pity: &pity, rng: &rng)
            guard hit else { continue }
            var count = r.count?.randomInt(using: &rng) ?? 1
            if r.seedDrop == true { count = Int((Double(count) * modifiers.seedDropMult).rounded()) }
            if let c = r.creature {
                out.append(.creature(rollCreature(typeID: c, origin: origin, now: now, rng: &rng)))
            } else if let item = r.item {
                if count > 0 { out.append(.item(item, count)) }
            } else if let list = r.pick {
                if var picked = pickWeighted(list, rarityPity: r.rarityPity, rarityPityMin: r.rarityPityMin,
                                             pity: &pity, rng: &rng) {
                    if modifiers.gemUpgradeChance > 0, rng.chance(modifiers.gemUpgradeChance) {
                        picked = upgrade(picked, rng: &rng)
                    }
                    out.append(.item(picked, max(1, count)))
                }
            } else if let g = r.group {
                if let picked = pickFromGroup(g, minRarity: r.minRarity, rarityPity: r.rarityPity,
                                              rarityPityMin: r.rarityPityMin, pity: &pity, rng: &rng),
                   count > 0 {
                    out.append(.item(picked, count))
                }
            }
            if r.exclusive == true { break }
        }
        return out
    }

    /// Weighted pick from an explicit list, with optional rarity pity.
    func pickWeighted(_ list: [WeightedItem], rarityPity: String?, rarityPityMin: Rarity?,
                      pity: inout [String: Int], rng: inout SeededRNG) -> String? {
        var pool = list.filter { $0.weight > 0 && content.items[$0.item] != nil }
        var forced = false
        if let key = rarityPity, let target = rarityPityMin, let threshold = tuning.pity[key],
           pity[key, default: 0] + 1 >= threshold {
            let better = pool.filter { (content.items[$0.item]?.rarity ?? .common) >= target }
            if !better.isEmpty { pool = better; forced = true }
        }
        guard let picked = weightedPick(pool.map { ($0.item, $0.weight) }, using: &rng) else { return nil }
        if let key = rarityPity, let target = rarityPityMin,
           pool.contains(where: { (content.items[$0.item]?.rarity ?? .common) >= target }) || forced {
            let good = (content.items[picked]?.rarity ?? .common) >= target
            pity[key] = (good || forced) ? 0 : pity[key, default: 0] + 1
        }
        return picked
    }

    /// Upgrade an item to a random item of the next rarity tier in the same category.
    func upgrade(_ id: String, rng: inout SeededRNG) -> String {
        guard let def = content.items[id], let next = def.rarity.next else { return id }
        let options = content.orderedItems.filter { $0.category == def.category && $0.rarity == next }
        guard !options.isEmpty else { return id }
        return options[Int.random(in: 0..<options.count, using: &rng)].id
    }

    func pickFromGroup(_ group: String, minRarity: Rarity?, rarityPity: String?, rarityPityMin: Rarity?,
                       pity: inout [String: Int], rng: inout SeededRNG) -> String? {
        var pool = content.items(inGroup: group)
        if let mr = minRarity { pool = pool.filter { $0.rarity >= mr } }
        var forced = false
        if let key = rarityPity, let target = rarityPityMin, let threshold = tuning.pity[key],
           pity[key, default: 0] + 1 >= threshold {
            let better = pool.filter { $0.rarity >= target }
            if !better.isEmpty { pool = better; forced = true }
        }
        let weighted = pool.map { ($0, tuning.rarityWeight($0.rarity) * ($0.lootWeight ?? 1)) }
        guard let picked = weightedPick(weighted, using: &rng) else { return nil }
        if let key = rarityPity, let target = rarityPityMin {
            pity[key] = (picked.rarity >= target || forced) ? 0 : pity[key, default: 0] + 1
        }
        return picked.id
    }
}

extension UUID {
    /// A UUID generated from the forest RNG (keeps tests deterministic).
    init<G: RandomNumberGenerator>(rng: inout G) {
        let a = rng.next(), b = rng.next()
        var bytes = [UInt8](repeating: 0, count: 16)
        for i in 0..<8 { bytes[i] = UInt8((a >> (UInt64(i) * 8)) & 0xFF) }
        for i in 0..<8 { bytes[8 + i] = UInt8((b >> (UInt64(i) * 8)) & 0xFF) }
        bytes[6] = (bytes[6] & 0x0F) | 0x40 // version 4
        bytes[8] = (bytes[8] & 0x3F) | 0x80 // variant
        self.init(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                         bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
