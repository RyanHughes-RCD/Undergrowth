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
    case notUsable
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
        case .notUsable: return "That can't be used."
        case .notReady: return "It isn't ready yet."
        }
    }
}

/// What an `advance` produced, for UI feedback.
public struct AdvanceReport: Equatable {
    public var spawned = 0
    public var despawned = 0
    public var ticks = 0
    public var visitors = 0
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
        fitToGrid()
    }

    /// A brand-new forest. Players start with no creatures (unless tuning lists starters):
    /// creatures are found inside mushrooms, seeds and geodes.
    public static func newForest(content: ContentDatabase, now: Date, seed: UInt64? = nil) -> Game {
        let s = seed ?? UInt64.random(in: 1...UInt64.max)
        var rng = SeededRNG(seed: s)
        let t = content.tuning
        var state = ForestState(
            version: ForestState.currentVersion, forestID: UUID(rng: &rng), seed: s, rng: rng,
            size: t.grid, createdAt: now, customName: nil,
            creatures: [], placements: [], slots: [], spawns: [], plantedSeeds: [],
            inventory: [:], discovered: [], pity: [:],
            // Back-date the spawn clock so a new forest starts with a few things to find.
            lastSpawnTick: now.addingTimeInterval(-t.spawns.tickSeconds * 6), lastUpdated: now,
            statCache: nil, debugTimeOffset: 0)
        state.lastWandererDay = Game.dayNumber(now)
        let game = Game(content: content, state: state)
        for typeID in t.starterCreatures {
            let c = game.loot.rollCreature(typeID: typeID, origin: "starter", now: now,
                                           forceGlimmer: false, rng: &game.state.rng)
            game.addCreature(c)
        }
        game.advance(to: now)
        return game
    }

    /// If the configured map size changed since this forest was saved, resize it,
    /// keeping everything inside the new bounds.
    func fitToGrid() {
        let size = tuning.grid
        guard state.size != size else { return }
        state.size = size
        func clamp(_ p: GridPoint) -> GridPoint {
            GridPoint(min(max(0, p.x), size.width - 1), min(max(0, p.y), size.height - 1))
        }
        state.spawns.removeAll { !size.contains($0.tile) }
        state.plantedSeeds.removeAll { !size.contains($0.tile) }
        state.visitors.removeAll { !size.contains($0.tile) }
        for i in state.placements.indices { state.placements[i].tile = clamp(state.placements[i].tile) }
        state.statCache = nil
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

    // MARK: - Clock (time of day, weather)

    /// Real time plus the debug offset.
    public func now(_ real: Date = Date()) -> Date { real.addingTimeInterval(state.debugTimeOffset) }

    public func debugSkip(seconds: TimeInterval) { state.debugTimeOffset += seconds }

    static func localHour(_ t: Date) -> Int { Calendar.current.component(.hour, from: t) }

    static func dayNumber(_ t: Date) -> Int {
        let offset = Double(TimeZone.current.secondsFromGMT(for: t))
        return Int(((t.timeIntervalSince1970 + offset) / 86400).rounded(.down))
    }

    /// Night by the forest's clock (local time), or anywhere a creature makes it night.
    public func isNight(at t: Date, tile: GridPoint? = nil) -> Bool {
        let c = tuning.clockSettings
        let h = Game.localHour(t)
        let night = c.nightStartHour > c.nightEndHour
            ? (h >= c.nightStartHour || h < c.nightEndHour)
            : (h >= c.nightStartHour && h < c.nightEndHour)
        if night { return true }
        if let tile { return !effects("night", covering: tile, at: t).isEmpty }
        return false
    }

    /// Deterministic weather: each block of hours is rainy or dry.
    public func isRaining(at t: Date) -> Bool {
        let c = tuning.clockSettings
        let block = UInt64(max(0, t.timeIntervalSince1970 / (max(0.25, c.weatherBlockHours) * 3600)))
        return StableHash.unit(StableHash.mix(state.seed, block, 0xAA17)) < c.rainChance
    }

    // MARK: - Creature effects

    func species(_ p: Placement) -> CreatureDef? {
        state.creature(p.creatureID).flatMap { content.creatures[$0.typeID] }
    }

    /// Effects of one type from creatures currently out in the forest.
    func activeEffects(_ type: String) -> [(CreatureEffect, Placement)] {
        var out: [(CreatureEffect, Placement)] = []
        for p in state.placements where p.isActive {
            for e in species(p)?.effects ?? [] where e.type == type { out.append((e, p)) }
        }
        return out
    }

    /// Effects of one type that apply to a tile (by radius, forest-wide, or own tile).
    public func effects(_ type: String, covering tile: GridPoint, at t: Date) -> [CreatureEffect] {
        activeEffects(type).compactMap { e, p in
            if e.isForestWide { return e }
            if e.scope == "tile" { return p.tile == tile ? e : nil }
            return tile.distance(to: p.tile) < tuning.falloff.reach(p.radius) ? e : nil
        }
    }

    func multiplier(_ effects: [CreatureEffect]) -> Double {
        effects.reduce(1) { $0 * ($1.mult ?? 1) }
    }

    /// Placements with Mycelium-Weaver radius links and Grove-Heart ramp speed applied.
    func effectivePlacements() -> [Placement] {
        let links = activeEffects("radiusLink")
        let speeds = activeEffects("rampSpeed")
        guard !links.isEmpty || !speeds.isEmpty else { return state.placements }
        return state.placements.map { p in
            var q = p
            let bonus = links.filter { e, src in src.id != p.id && src.tile.distance(to: p.tile) <= (e.range ?? 0) }
                .map { $0.0.bonus ?? 0 }.max() ?? 0
            q.radius += bonus
            let mult = speeds.filter { _, src in p.tile.distance(to: src.tile) < tuning.falloff.reach(src.radius) }
                .map { $0.0.mult ?? 1 }.max() ?? 1
            if mult != 1 { q.rampSeconds = (p.rampSeconds ?? tuning.rampSecondsToFull) / mult }
            return q
        }
    }

    // MARK: - Stats

    public func statField(at now: Date) -> StatField {
        // Sum creatures and soil boosts first, then clamp to 0...cap.
        var field = stats.field(size: state.size, placements: effectivePlacements(), now: now, clamp: false)
        for b in state.soilBoosts where b.isActive(at: now) && state.size.contains(b.tile) {
            var s = field.stats(at: b.tile)
            for (k, v) in b.stats { s[k, default: 0] += v }
            field.set(s, at: b.tile)
        }
        for i in field.values.indices { field.values[i] = min(tuning.statCap, max(0, field.values[i])) }
        return field
    }

    public func tileStats(_ tile: GridPoint, at now: Date) -> StatValues {
        var s = stats.stats(at: tile, placements: effectivePlacements(), now: now, clamp: false)
        for b in state.soilBoosts where b.isActive(at: now) && b.tile == tile {
            for (k, v) in b.stats { s[k, default: 0] += v }
        }
        for (k, v) in s { s[k] = min(tuning.statCap, max(0, v)) }
        return s
    }

    /// Ground sprites forced by creature effects (Hollow Digger's cavern, Bog Wisp's ponds).
    public func groundOverrides(at now: Date, field: StatField) -> [GridPoint: String] {
        var out: [GridPoint: String] = [:]
        for (e, p) in activeEffects("groundOverride") {
            guard let sprite = e.sprite else { continue }
            if e.scope == "tile" { out[p.tile] = sprite; continue }
            let r = Int(tuning.falloff.reach(p.radius).rounded(.up))
            for y in (p.tile.y - r)...(p.tile.y + r) {
                for x in (p.tile.x - r)...(p.tile.x + r) {
                    let t = GridPoint(x, y)
                    guard state.size.contains(t), t.distance(to: p.tile) < tuning.falloff.reach(p.radius) else { continue }
                    if let w = e.when, !StatCondition.check(w, field.stats(at: t)) { continue }
                    out[t] = sprite
                }
            }
        }
        return out
    }

    // MARK: - Time passing

    /// Brings the forest up to `now`: prunes decayed placements and expired soil boosts,
    /// replays missed spawn ticks (capped) and daily wanderer checks.
    @discardableResult
    public func advance(to now: Date) -> AdvanceReport {
        var report = AdvanceReport()
        state.placements.removeAll { p in
            guard let end = stats.fullyDecayedAt(p) else { return false }
            return end <= now
        }
        state.soilBoosts.removeAll { b in b.expiresAt.map { $0 <= now } ?? false }

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

        // Wanderers: one check per forest day.
        let today = Game.dayNumber(now)
        let last = state.lastWandererDay ?? today
        let firstDay = max(last + 1, today - (tuning.wanderers?.maxCatchUpDays ?? 7) + 1)
        if firstDay <= today {
            for _ in firstDay...today { report.visitors += checkWanderers(at: now) }
        }
        state.lastWandererDay = today

        state.lastUpdated = now
        state.statCache = statField(at: now)
        return report
    }

    func lifetime(of itemID: String) -> Double {
        if let h = content.items[itemID]?.spawn?.lifetimeHours { return h * 3600 }
        return tuning.spawns.lifetimeSeconds
    }

    func expireSpawns(at t: Date) -> Int {
        let before = state.spawns.count
        state.spawns.removeAll { s in
            let life = lifetime(of: s.itemID)
            return life > 0 && t.timeIntervalSince(s.spawnedAt) >= life
        }
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
            if let item = weightedPick(spawnWeights(for: tile, at: t), using: &state.rng) {
                state.spawns.append(WildSpawn(id: UUID(rng: &state.rng), itemID: item.id, tile: tile, spawnedAt: t))
                made += 1
            }
        }
        return made
    }

    static func effect(_ e: CreatureEffect, matches item: ItemDef) -> Bool {
        if let c = e.category, c != item.category { return false }
        if let r = e.rarities, !r.contains(item.rarity) { return false }
        if let i = e.items, !i.contains(item.id) { return false }
        return true
    }

    /// Everything that could spawn on a tile at time `t`, with relative weights.
    /// Applies minimum stats, day/night/rain, one-at-a-time and creature effects.
    public func spawnWeights(for tile: GridPoint, at t: Date) -> [(ItemDef, Double)] {
        let s = tileStats(tile, at: t)
        let night = isNight(at: t, tile: tile)
        let raining = isRaining(at: t)
        let weightFx = effects("spawnWeight", covering: tile, at: t)
        let offsetFx = effects("requirementOffset", covering: tile, at: t)
        let substituteFx = effects("statSubstitute", covering: tile, at: t)
        let onMap = Set(state.spawns.map(\.itemID))
        var out: [(ItemDef, Double)] = []
        for item in content.spawnableItems {
            guard let rule = item.spawn else { continue }
            if rule.time == "night" && !night { continue }
            if rule.time == "day" && night { continue }
            if rule.rain == true && !raining { continue }
            if rule.oneAtATime == true && onMap.contains(item.id) { continue }
            var ok = true
            for (stat, bound) in rule.requires ?? [:] {
                var b = bound
                for e in offsetFx where e.stat == stat && Game.effect(e, matches: item) {
                    b.min = b.min.map { max(0, $0 + (e.offset ?? 0)) }
                }
                var v = s[stat] ?? 0
                for e in substituteFx where e.from == stat && Game.effect(e, matches: item) {
                    if let to = e.to { v = max(v, s[to] ?? 0) }
                }
                if !b.matches(v) { ok = false; break }
            }
            guard ok else { continue }
            var w = rule.baseWeight
            for (k, sw) in rule.statWeights ?? [:] { w *= 1 + sw * (s[k] ?? 0) / 100 }
            for e in weightFx where Game.effect(e, matches: item) { w *= e.mult ?? 1 }
            if w > 0 { out.append((item, w)) }
        }
        return out
    }

    // MARK: - Wanderers

    func ownsSpecies(_ id: String) -> Bool { state.creatures.contains { $0.typeID == id } }

    /// Daily check: each wanderer whose conditions a free tile meets may arrive there.
    func checkWanderers(at t: Date) -> Int {
        let field = statField(at: t)
        var arrived = 0
        for def in content.orderedCreatures where def.source?.kind == "wanderer" {
            if def.unique == true && ownsSpecies(def.id) { continue }
            if state.visitors.contains(where: { $0.speciesID == def.id }) { continue }
            var tiles: [GridPoint] = []
            for y in 0..<state.size.height {
                for x in 0..<state.size.width {
                    let p = GridPoint(x, y)
                    if isFree(p), StatCondition.check(def.requires ?? [:], field.stats(at: p)) { tiles.append(p) }
                }
            }
            guard !tiles.isEmpty else { continue }
            let tile = tiles[Int.random(in: 0..<tiles.count, using: &state.rng)]
            let chance = (def.chance ?? 0) * multiplier(effects("creatureChance", covering: tile, at: t)
                .filter { $0.family == nil || $0.family == def.family })
            if state.rng.chance(chance) {
                state.visitors.append(Visitor(id: UUID(rng: &state.rng), speciesID: def.id, tile: tile, arrivedAt: t))
                arrived += 1
            }
        }
        return arrived
    }

    public func visitorAt(_ tile: GridPoint) -> Visitor? { state.visitors.first { $0.tile == tile } }

    /// Welcome a visiting wanderer into the Burrow.
    public func befriend(visitorID: UUID, now: Date) throws -> [LootResult] {
        guard let i = state.visitors.firstIndex(where: { $0.id == visitorID }) else { throw GameError.unknownCreature }
        let v = state.visitors.remove(at: i)
        return grant([.creature(makeCreature(v.speciesID, origin: "wanderer", now: now))])
    }

    // MARK: - Finding creatures

    func makeCreature(_ typeID: String, origin: String?, now: Date) -> CreatureInstance {
        let force: Bool? = state.nextGlimmer ? true : nil
        state.nextGlimmer = false
        return loot.rollCreature(typeID: typeID, origin: origin, now: now, forceGlimmer: force, rng: &state.rng)
    }

    /// Rolls for a creature hiding in a source (mushroom, seed, geode). Candidates are the
    /// species with that source whose tile conditions are met; rarest are rolled first and
    /// the first hit wins. A per-family pity counter guarantees a find after enough misses.
    func findCreature(kind: String, sourceItem: String?, tile: GridPoint?, stats: StatValues,
                      plantedAt: Date? = nil, origin: String?, now: Date) -> CreatureInstance? {
        let candidates = content.orderedCreatures.filter { def in
            guard let src = def.source, src.kind == kind else { return false }
            if let items = src.items, let item = sourceItem, !items.contains(item) { return false }
            if !StatCondition.check(def.requires ?? [:], stats) { return false }
            if let when = def.plantedTime {
                let night = isNight(at: plantedAt ?? now, tile: tile)
                if (when == "night") != night { return false }
            }
            if def.unique == true && ownsSpecies(def.id) { return false }
            return true
        }
        guard !candidates.isEmpty else { return nil }
        let chanceFx = tile.map { effects("creatureChance", covering: $0, at: now) }
            ?? activeEffects("creatureChance").filter { $0.0.isForestWide }.map(\.0)
        var hit: CreatureDef?
        for def in candidates.sorted(by: { ($0.chance ?? 0) < ($1.chance ?? 0) }) {
            let mult = multiplier(chanceFx.filter { $0.family == nil || $0.family == def.family })
            if state.rng.chance((def.chance ?? 0) * mult) { hit = def; break }
        }
        let key = candidates[0].family
        if let threshold = tuning.pity[key], threshold > 0 {
            if hit == nil {
                let misses = state.pity[key, default: 0] + 1
                if misses >= threshold {
                    hit = candidates.max { ($0.chance ?? 0) < ($1.chance ?? 0) }
                } else {
                    state.pity[key] = misses
                }
            }
            if hit != nil { state.pity[key] = 0 }
        }
        return hit.map { makeCreature($0.id, origin: origin, now: now) }
    }

    // MARK: - Queries

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
            && visitorAt(tile) == nil
    }

    public func level(of p: Placement, at now: Date) -> Double {
        let eff = effectivePlacements().first { $0.id == p.id } ?? p
        return stats.level(of: eff, at: now)
    }

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
        let rampHours = c.rampHours ?? content.creatures[c.typeID]?.rampHours
        let p = Placement(id: UUID(rng: &state.rng), creatureID: c.id, tile: tile,
                          contributions: c.contributions, radius: c.radius,
                          placedAt: now, startLevel: startLevel, removedAt: nil,
                          rampSeconds: rampHours.map { $0 * 3600 })
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
    func rollTable(_ table: String, origin: String?, now: Date, modifiers: LootModifiers = LootModifiers()) -> [PendingLoot] {
        var pity = state.pity
        var rng = state.rng
        let out = loot.roll(table: table, origin: origin, now: now, modifiers: modifiers, pity: &pity, rng: &rng)
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

    /// Tap a wild spawn: pick a mushroom or plant, or dig up a geode.
    public func collect(spawnID: UUID, now: Date) throws -> [LootResult] {
        guard let i = state.spawns.firstIndex(where: { $0.id == spawnID }) else { throw GameError.unknownItem }
        let spawn = state.spawns.remove(at: i)
        guard let def = content.items[spawn.itemID] else { return [] }
        let tileStats = self.tileStats(spawn.tile, at: now)
        var pending: [PendingLoot] = []

        if def.category == "geode" {
            // Dug geodes remember where they came from (decides which critters can be inside).
            state.geodes.append(GeodeInstance(id: UUID(rng: &state.rng), itemID: def.id, foundTile: spawn.tile,
                                              foundStats: tileStats, foundAt: now))
            pending = [.item(def.id, 1)]
        } else {
            if let table = def.onCollect {
                var mods = LootModifiers()
                mods.seedDropMult = multiplier(effects("seedDrops", covering: spawn.tile, at: now))
                pending = rollTable(table, origin: def.id, now: now, modifiers: mods)
            } else {
                pending = [.item(def.id, 1)]
            }
            if def.category == "mushroom",
               let c = findCreature(kind: "mushroom", sourceItem: def.id, tile: spawn.tile, stats: tileStats,
                                    origin: def.id, now: now) {
                pending.append(.creature(c))
            }
        }
        for e in effects("bonusDrop", covering: spawn.tile, at: now) where (e.items ?? []).contains(def.id) {
            if state.rng.chance(e.chance ?? 0), let table = e.table {
                pending += rollTable(table, origin: def.id, now: now)
            }
        }
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
        let speed = multiplier(effects("seedGrowth", covering: tile, at: now))
        let grow = tuning.seeds.growSeconds.random(using: &state.rng) / max(0.01, speed)
        state.plantedSeeds.append(PlantedSeed(id: UUID(rng: &state.rng), seedItemID: itemID, tile: tile,
                                              plantedAt: now, growSeconds: grow))
    }

    /// Harvest a grown seed: a Sproutling if one grew (depends on the tile), else a plant.
    public func harvestSeed(id: UUID, now: Date) throws -> [LootResult] {
        guard let i = state.plantedSeeds.firstIndex(where: { $0.id == id }) else { throw GameError.unknownItem }
        let seed = state.plantedSeeds[i]
        guard seed.isReady(at: now) else { throw GameError.notReady }
        state.plantedSeeds.remove(at: i)
        let tileStats = self.tileStats(seed.tile, at: now)
        if let c = findCreature(kind: "seed", sourceItem: seed.seedItemID, tile: seed.tile, stats: tileStats,
                                plantedAt: seed.plantedAt, origin: seed.seedItemID, now: now) {
            return grant([.creature(c)])
        }
        guard let table = content.items[seed.seedItemID]?.onGrow else { return [] }
        return grant(rollTable(table, origin: seed.seedItemID, now: now))
    }

    /// Crack a geode from the bag: first a roll for a Geode Critter (based on where the
    /// geode was found), otherwise the geode's loot table.
    public func crack(itemID: String, now: Date) throws -> [LootResult] {
        guard let def = content.items[itemID] else { throw GameError.unknownItem }
        guard let table = def.onCrack else { throw GameError.notCrackable }
        guard state.inventory[itemID, default: 0] > 0 else { throw GameError.notInInventory }
        consume(itemID)
        var found: GeodeInstance?
        if let gi = state.geodes.firstIndex(where: { $0.itemID == itemID }) { found = state.geodes.remove(at: gi) }
        let stats = found?.foundStats ?? [:]
        let tile = found?.foundTile
        if let c = findCreature(kind: "geode", sourceItem: itemID, tile: tile, stats: stats, origin: itemID, now: now) {
            return grant([.creature(c)])
        }
        var mods = LootModifiers()
        if let tile {
            mods.gemUpgradeChance = effects("gemUpgrade", covering: tile, at: now).map { $0.chance ?? 0 }.max() ?? 0
        }
        return grant(rollTable(table, origin: itemID, now: now, modifiers: mods))
    }

    /// Use an item from the bag. Soil boosts need a tile; a Moonfall Shard doesn't.
    @discardableResult
    public func use(itemID: String, on tile: GridPoint?, now: Date) throws -> String {
        guard let def = content.items[itemID] else { throw GameError.unknownItem }
        guard let use = def.use else { throw GameError.notUsable }
        guard state.inventory[itemID, default: 0] > 0 else { throw GameError.notInInventory }
        switch use.type {
        case "soilBoost":
            guard let tile else { throw GameError.notUsable }
            guard state.size.contains(tile) else { throw GameError.outOfBounds }
            consume(itemID)
            let expires = use.permanent == true ? nil : now.addingTimeInterval((use.hours ?? 24) * 3600)
            state.soilBoosts.append(SoilBoost(id: UUID(rng: &state.rng), tile: tile, stats: use.stats ?? [:],
                                              appliedAt: now, expiresAt: expires))
            state.statCache = statField(at: now)
            return use.text ?? def.name
        case "nextGlimmer":
            consume(itemID)
            state.nextGlimmer = true
            return "The next creature you find will be a Glimmer."
        default:
            throw GameError.notUsable
        }
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

    public func debugClearSpawns() { state.spawns.removeAll() }

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
