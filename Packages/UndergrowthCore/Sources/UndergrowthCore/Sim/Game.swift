import Foundation

public enum GameError: Error, Equatable, CustomStringConvertible {
    case outOfBounds
    case tileOccupied
    case noFreeSlot
    case alreadyPlaced
    case notPlaced
    case unknownCreature
    case unknownItem
    case notInInventory
    case notPlantable
    case notCrackable
    case notReady

    public var description: String {
        switch self {
        case .outOfBounds: return "That's outside the forest."
        case .tileOccupied: return "Something is already there."
        case .noFreeSlot: return "All placement slots are full. Return a creature to the Burrow first."
        case .alreadyPlaced: return "That creature is already out in the forest."
        case .notPlaced: return "That creature is in the Burrow."
        case .unknownCreature: return "Unknown creature."
        case .unknownItem: return "Unknown item."
        case .notInInventory: return "You don't have that."
        case .notPlantable: return "That can't be planted."
        case .notCrackable: return "That can't be cracked."
        case .notReady: return "It isn't ready yet."
        }
    }
}

/// What an `advance` produced, for UI feedback.
public struct AdvanceReport: Equatable {
    public var spawned = 0
    public var despawned = 0
    public var ticks = 0
}

/// The forest simulation. Owns a `ForestState` and mutates it in response to
/// time passing and player actions. Pure Swift (no UI), fully testable.
public final class Game {
    public let content: ContentDatabase
    public private(set) var state: ForestState
    public let stats: StatEngine
    public let loot: LootRoller

    public var tuning: Tuning { content.tuning }

    public init(content: ContentDatabase, state: ForestState) {
        self.content = content
        self.state = state
        self.stats = StatEngine(tuning: content.tuning)
        self.loot = LootRoller(content: content)
        normalizeSlots()
    }

    /// A brand-new forest with the starter creatures in the Burrow.
    public static func newForest(content: ContentDatabase, now: Date, seed: UInt64? = nil) -> Game {
        let s = seed ?? UInt64.random(in: 1...UInt64.max)
        var rng = SeededRNG(seed: s)
        let t = content.tuning
        let state = ForestState(
            version: ForestState.currentVersion, forestID: UUID(rng: &rng), seed: s, rng: rng,
            size: t.grid, createdAt: now, customName: nil,
            creatures: [], placements: [], slots: [], spawns: [], plantedSeeds: [],
            inventory: [:], discovered: [], pity: [:],
            // Back-date the spawn clock so a new forest starts with a few things to find.
            lastSpawnTick: now.addingTimeInterval(-t.spawns.tickSeconds * 6), lastUpdated: now,
            statCache: nil, debugTimeOffset: 0)
        let game = Game(content: content, state: state)
        for typeID in t.starterCreatures {
            let c = game.loot.rollCreature(typeID: typeID, origin: "starter", now: now,
                                           forceGlimmer: false, rng: &game.state.rng)
            game.addCreature(c)
        }
        game.advance(to: now)
        return game
    }

    /// Keeps the slot list in sync with the configured slot count (never drops occupied slots).
    func normalizeSlots() {
        let normalCount = state.slots.filter { $0.kind == "normal" }.count
        if normalCount < tuning.placementSlots {
            state.slots += Array(repeating: Slot(), count: tuning.placementSlots - normalCount)
        } else if normalCount > tuning.placementSlots {
            var excess = normalCount - tuning.placementSlots
            state.slots.removeAll { slot in
                guard excess > 0, slot.kind == "normal", slot.placementID == nil else { return false }
                excess -= 1
                return true
            }
        }
    }

    // MARK: - Time

    /// Real time plus the debug offset.
    public func now(_ real: Date = Date()) -> Date { real.addingTimeInterval(state.debugTimeOffset) }

    public func debugSkip(seconds: TimeInterval) { state.debugTimeOffset += seconds }

    /// Brings the forest up to `now`: prunes decayed placements, removes expired
    /// spawns, and replays missed spawn ticks (capped).
    @discardableResult
    public func advance(to now: Date) -> AdvanceReport {
        var report = AdvanceReport()
        // Prune fully decayed placement records.
        state.placements.removeAll { p in
            guard let end = stats.fullyDecayedAt(p) else { return false }
            return end <= now
        }

        // Spawn ticks.
        let tick = max(1, tuning.spawns.tickSeconds)
        var elapsedTicks = Int(now.timeIntervalSince(state.lastSpawnTick) / tick)
        if elapsedTicks > tuning.spawns.maxCatchUpTicks {
            state.lastSpawnTick = state.lastSpawnTick.addingTimeInterval(Double(elapsedTicks - tuning.spawns.maxCatchUpTicks) * tick)
            elapsedTicks = tuning.spawns.maxCatchUpTicks
        }
        for _ in 0..<max(0, elapsedTicks) {
            let t = state.lastSpawnTick.addingTimeInterval(tick)
            report.despawned += expireSpawns(at: t)
            report.spawned += spawnTick(at: t)
            state.lastSpawnTick = t
            report.ticks += 1
        }
        report.despawned += expireSpawns(at: now)
        state.lastUpdated = now
        state.statCache = statField(at: now)
        return report
    }

    func expireSpawns(at t: Date) -> Int {
        let life = tuning.spawns.lifetimeSeconds
        guard life > 0 else { return 0 }
        let before = state.spawns.count
        state.spawns.removeAll { t.timeIntervalSince($0.spawnedAt) >= life }
        return before - state.spawns.count
    }

    func spawnTick(at t: Date) -> Int {
        var made = 0
        let st = tuning.spawns
        for _ in 0..<st.attemptsPerTick {
            guard state.spawns.count < st.maxTotal else { break }
            guard state.rng.chance(st.spawnChance) else { continue }
            let tile = GridPoint(Int.random(in: 0..<state.size.width, using: &state.rng),
                                 Int.random(in: 0..<state.size.height, using: &state.rng))
            guard isFree(tile) else { continue }
            if let item = pickSpawn(for: tile, at: t) {
                state.spawns.append(WildSpawn(id: UUID(rng: &state.rng), itemID: item, tile: tile, spawnedAt: t))
                made += 1
            }
        }
        return made
    }

    /// Weighted choice of what spawns on a tile given its stats at time `t`.
    public func spawnWeights(for tile: GridPoint, at t: Date) -> [(ItemDef, Double)] {
        let s = stats.stats(at: tile, placements: state.placements, now: t)
        return content.spawnableItems.compactMap { item in
            guard let rule = item.spawn else { return nil }
            let w = rule.weight(stats: s, rarityWeight: tuning.rarityWeight(item.rarity))
            return w > 0 ? (item, w) : nil
        }
    }

    func pickSpawn(for tile: GridPoint, at t: Date) -> String? {
        weightedPick(spawnWeights(for: tile, at: t), using: &state.rng)?.id
    }

    // MARK: - Queries

    public func statField(at now: Date) -> StatField {
        stats.field(size: state.size, placements: state.placements, now: now)
    }

    public func tileStats(_ tile: GridPoint, at now: Date) -> StatValues {
        stats.stats(at: tile, placements: state.placements, now: now)
    }

    public func activePlacement(for creatureID: UUID) -> Placement? {
        state.placements.first { $0.creatureID == creatureID && $0.isActive }
    }

    public var placedCreatures: [CreatureInstance] {
        state.placements.filter(\.isActive).compactMap { state.creature($0.creatureID) }
    }

    /// Creatures not currently placed.
    public var burrow: [CreatureInstance] {
        let placed = Set(state.placements.filter(\.isActive).map(\.creatureID))
        return state.creatures.filter { !placed.contains($0.id) }
    }

    public var freeSlotCount: Int { state.slots.filter { $0.kind == "normal" && $0.placementID == nil }.count }

    public func creatureAt(_ tile: GridPoint) -> Placement? {
        state.placements.first { $0.isActive && $0.tile == tile }
    }
    public func spawnAt(_ tile: GridPoint) -> WildSpawn? { state.spawns.first { $0.tile == tile } }
    public func seedAt(_ tile: GridPoint) -> PlantedSeed? { state.plantedSeeds.first { $0.tile == tile } }

    public func isFree(_ tile: GridPoint) -> Bool {
        state.size.contains(tile) && creatureAt(tile) == nil && spawnAt(tile) == nil && seedAt(tile) == nil
    }

    public func level(of p: Placement, at now: Date) -> Double { stats.level(of: p, at: now) }

    // MARK: - Creatures

    func addCreature(_ c: CreatureInstance) {
        state.creatures.append(c)
    }

    @discardableResult
    func discover(_ key: String) -> Bool { state.discovered.insert(key).inserted }

    public func place(creatureID: UUID, at tile: GridPoint, now: Date) throws {
        guard let c = state.creature(creatureID) else { throw GameError.unknownCreature }
        guard state.size.contains(tile) else { throw GameError.outOfBounds }
        guard activePlacement(for: creatureID) == nil else { throw GameError.alreadyPlaced }
        guard isFree(tile) else { throw GameError.tileOccupied }
        guard let slotIndex = state.slots.firstIndex(where: { $0.kind == "normal" && $0.placementID == nil }) else {
            throw GameError.noFreeSlot
        }
        // Returning to a tile it is still fading from? Resume from the current level.
        var startLevel = 0.0
        if let old = state.placements.firstIndex(where: { $0.creatureID == creatureID && !$0.isActive && $0.tile == tile }) {
            startLevel = stats.level(of: state.placements[old], at: now)
            state.placements.remove(at: old)
        }
        let p = Placement(id: UUID(rng: &state.rng), creatureID: c.id, tile: tile,
                          contributions: c.contributions, radius: c.radius,
                          placedAt: now, startLevel: startLevel, removedAt: nil)
        state.placements.append(p)
        state.slots[slotIndex].placementID = p.id
        state.statCache = statField(at: now)
    }

    /// Sends a placed creature back to the Burrow. Its influence decays over time.
    public func recall(creatureID: UUID, now: Date) throws {
        guard let i = state.placements.firstIndex(where: { $0.creatureID == creatureID && $0.isActive }) else {
            throw GameError.notPlaced
        }
        state.placements[i].removedAt = now
        let pid = state.placements[i].id
        for s in state.slots.indices where state.slots[s].placementID == pid { state.slots[s].placementID = nil }
        state.statCache = statField(at: now)
    }

    public func rename(creatureID: UUID, to name: String?) {
        guard let i = state.creatures.firstIndex(where: { $0.id == creatureID }) else { return }
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        state.creatures[i].nickname = (trimmed?.isEmpty ?? true) ? nil : trimmed
    }

    // MARK: - Collecting

    /// Rolls a loot table using (and updating) the forest's pity counters and RNG.
    func rollTable(_ table: String, origin: String?, now: Date) -> [PendingLoot] {
        var pity = state.pity
        var rng = state.rng
        let out = loot.roll(table: table, origin: origin, now: now, pity: &pity, rng: &rng)
        state.pity = pity
        state.rng = rng
        return out
    }

    /// Applies pending loot to the forest: items to inventory, creatures to the Burrow.
    func grant(_ pending: [PendingLoot]) -> [LootResult] {
        pending.map { p in
            switch p {
            case .item(let id, let n):
                state.inventory[id, default: 0] += n
                let isNew = (content.items[id]?.showsInGuide ?? false) && discover(GuideKey.item(id))
                return .item(id: id, count: n, isNew: isNew)
            case .creature(let c):
                addCreature(c)
                let isNew = discover(GuideKey.creature(c.typeID, glimmer: c.isGlimmer))
                return .creature(c, isNew: isNew)
            }
        }
    }

    /// Tap a wild spawn: pick a mushroom/plant, or dig up a geode.
    public func collect(spawnID: UUID, now: Date) throws -> [LootResult] {
        guard let i = state.spawns.firstIndex(where: { $0.id == spawnID }) else { throw GameError.unknownItem }
        let spawn = state.spawns.remove(at: i)
        guard let def = content.items[spawn.itemID] else { return [] }
        var pending: [PendingLoot]
        if let table = def.onCollect {
            pending = rollTable(table, origin: def.id, now: now)
        } else {
            pending = [.item(def.id, 1)]
        }
        // Collecting a spawn always counts as discovering it.
        if def.showsInGuide { _ = discover(GuideKey.item(def.id)) }
        return grant(pending)
    }

    public func plantSeed(itemID: String, at tile: GridPoint, now: Date) throws {
        guard let def = content.items[itemID] else { throw GameError.unknownItem }
        guard def.isPlantable else { throw GameError.notPlantable }
        guard state.inventory[itemID, default: 0] > 0 else { throw GameError.notInInventory }
        guard state.size.contains(tile) else { throw GameError.outOfBounds }
        guard isFree(tile) else { throw GameError.tileOccupied }
        consume(itemID)
        let grow = tuning.seeds.growSeconds.random(using: &state.rng)
        state.plantedSeeds.append(PlantedSeed(id: UUID(rng: &state.rng), seedItemID: itemID, tile: tile,
                                              plantedAt: now, growSeconds: grow))
    }

    public func harvestSeed(id: UUID, now: Date) throws -> [LootResult] {
        guard let i = state.plantedSeeds.firstIndex(where: { $0.id == id }) else { throw GameError.unknownItem }
        let seed = state.plantedSeeds[i]
        guard seed.isReady(at: now) else { throw GameError.notReady }
        state.plantedSeeds.remove(at: i)
        guard let table = content.items[seed.seedItemID]?.onGrow else { return [] }
        let pending = rollTable(table, origin: seed.seedItemID, now: now)
        return grant(pending)
    }

    /// Crack a rough rock from the bag.
    public func crack(itemID: String, now: Date) throws -> [LootResult] {
        guard let def = content.items[itemID] else { throw GameError.unknownItem }
        guard let table = def.onCrack else { throw GameError.notCrackable }
        guard state.inventory[itemID, default: 0] > 0 else { throw GameError.notInInventory }
        consume(itemID)
        let pending = rollTable(table, origin: itemID, now: now)
        return grant(pending)
    }

    func consume(_ itemID: String) {
        let n = state.inventory[itemID, default: 0] - 1
        state.inventory[itemID] = n > 0 ? n : nil
    }

    // MARK: - Naming

    public var generatedName: String {
        let field = state.statCache ?? statField(at: state.lastUpdated)
        return ForestNamer(parts: content.nameParts, tuning: tuning.naming).name(means: field.means(), seed: state.seed)
    }

    public var forestName: String { state.customName ?? generatedName }

    public func renameForest(_ name: String?) {
        let t = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        state.customName = (t?.isEmpty ?? true) ? nil : t
    }

    // MARK: - Debug helpers (dev menu, tests)

    public func debugGrant(itemID: String, count: Int = 1) {
        state.inventory[itemID, default: 0] += count
    }

    public func debugAddSpawn(itemID: String, at tile: GridPoint, now: Date) {
        guard isFree(tile), content.items[itemID] != nil else { return }
        state.spawns.append(WildSpawn(id: UUID(rng: &state.rng), itemID: itemID, tile: tile, spawnedAt: now))
    }

    @discardableResult
    public func debugGrantCreature(typeID: String, glimmer: Bool, now: Date) -> [LootResult] {
        let c = loot.rollCreature(typeID: typeID, origin: "debug", now: now, forceGlimmer: glimmer, rng: &state.rng)
        return grant([.creature(c)])
    }
}
