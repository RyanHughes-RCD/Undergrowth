import XCTest
@testable import UndergrowthCore

func resourcesURL() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources")
}

/// Loads the real bundled content from the repo's Resources folder.
func loadContent() throws -> ContentDatabase {
    try ContentDatabase.load(roots: [resourcesURL()])
}

/// A noon timestamp in the local time zone (so day/night conditions are predictable).
func localNoon() -> Date {
    var c = DateComponents()
    c.year = 2026; c.month = 6; c.day = 1; c.hour = 12
    return Calendar.current.date(from: c)!
}

final class ContentTests: XCTestCase {
    func testBundledContentIsValid() throws {
        let db = try loadContent()
        XCTAssertEqual(db.validate(), [])
        XCTAssertEqual(db.orderedCreatures.count, 43)
        XCTAssertEqual(Set(db.orderedCreatures.map(\.family)), ["fungling", "sproutling", "geodeCritter", "wanderer"])
        XCTAssertEqual(db.items["mushroom.ancient-sporecrown"]?.rarity, .legendary)
        XCTAssertEqual(db.items["plant.ghost-orchid"]?.rarity, .veryRare)
        for c in db.orderedCreatures {
            XCTAssertTrue(db.sprites.contains(c.sprite), c.sprite)
            XCTAssertTrue(db.sprites.contains(c.glimmerSprite!), c.id)
        }
    }

    func testSpreadsheetValuesImported() throws {
        let db = try loadContent()
        let lantern = try XCTUnwrap(db.creatures["lantern-fungling"])
        XCTAssertEqual(lantern.bonuses?[.glow], 14)
        XCTAssertEqual(lantern.radius, 2)
        XCTAssertEqual(lantern.rampHours, 18)
        XCTAssertEqual(lantern.source?.items, ["mushroom.glowcap"])
        let morel = try XCTUnwrap(db.items["mushroom.moonlight-morel"]?.spawn)
        XCTAssertEqual(morel.time, "night")
        XCTAssertEqual(morel.requires?[.damp]?.min, 70)
        let quartz = try XCTUnwrap(db.items["gem.quartz"]?.use)
        XCTAssertEqual(quartz.stats?[.stone], 5)
        XCTAssertEqual(quartz.hours, 24)
        let pebble = try XCTUnwrap(db.loot["loot.crack.pebble-geode"]?.rolls.first?.pick)
        XCTAssertEqual(pebble.reduce(0) { $0 + $1.weight }, 1, accuracy: 0.0001)
    }

    func testSpriteDecodingAndPaletteRef() throws {
        let db = try loadContent()
        XCTAssertEqual(db.sprites.sprite("tile.grass.a").paletteRef, "pal.ground")
        let buf = db.sprites.pixels("tile.grass.a")
        XCTAssertEqual(buf.width, 32)
        XCTAssertEqual(buf.bytes[(8 * 32 + 16) * 4 + 3], 255)
        XCTAssertEqual(buf.bytes[3], 0)
    }

    func testMissingSpriteFallsBack() throws {
        XCTAssertEqual(try loadContent().sprites.sprite("does.not.exist").id, SpriteRegistry.missingID)
    }

    func testUserContentRootOverrides() throws {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp.appendingPathComponent("Sprites"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: tmp.appendingPathComponent("Content"), withIntermediateDirectories: true)
        let sprite = SpriteData(id: "user.blob", size: [2, 2], palette: ["transparent", "#00ff00"],
                                frames: [SpriteFrame(rows: ["11", "1."])])
        try JSONEncoder().encode(sprite).write(to: tmp.appendingPathComponent("Sprites/user.blob.json"))
        try """
        [{ "id": "mushroom.user", "category": "mushroom", "name": "User Cap", "rarity": "rare",
           "sprite": "user.blob", "spawn": { "baseWeight": 1 } }]
        """.data(using: .utf8)!.write(to: tmp.appendingPathComponent("Content/items.json"))
        let db = try ContentDatabase.load(roots: [resourcesURL(), tmp])
        XCTAssertTrue(db.spawnableItems.contains { $0.id == "mushroom.user" })
        XCTAssertEqual(db.validate(), [])
    }
}

func freeTile(_ g: Game, near p: GridPoint) -> GridPoint {
    for r in 0..<14 {
        for dy in -r...r { for dx in -r...r {
            let t = GridPoint(p.x + dx, p.y + dy)
            if g.isFree(t) { return t }
        } }
    }
    fatalError("no free tile")
}

final class StatTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = localNoon()
    override func setUpWithError() throws { content = try loadContent() }

    func testNewForestStartsWithNoCreatures() {
        let g = Game.newForest(content: content, now: t0, seed: 42)
        XCTAssertTrue(g.state.creatures.isEmpty)
        XCTAssertEqual(g.state.slots.count, 3)
        XCTAssertGreaterThan(g.state.spawns.count, 0, "a few things to find right away")
    }

    func testCreatureRollsWithinSpeciesRange() {
        let roller = LootRoller(content: content)
        var rng = SeededRNG(seed: 1)
        for _ in 0..<50 {
            let c = roller.rollCreature(typeID: "spore-sage", origin: nil, now: t0, forceGlimmer: false, rng: &rng)
            XCTAssertTrue((10.75...18.05).contains(c.contributions[.damp]!), "\(c.contributions)")
            XCTAssertEqual(c.radius, 3)
            XCTAssertEqual(c.rampHours, 24)
        }
        let g = roller.rollCreature(typeID: "spore-sage", origin: nil, now: t0, forceGlimmer: true, rng: &rng)
        XCTAssertEqual(g.radius, 4, "glimmer +1 radius")
        XCTAssertGreaterThanOrEqual(g.contributions[.damp]!, 18 * 0.6 * 1.5 - 0.05)
    }

    func testRampsOverSpeciesTimeAndFallsOff() throws {
        let g = Game.newForest(content: content, now: t0, seed: 1)
        g.debugGrantCreature(typeID: "lantern-fungling", glimmer: false, now: t0)
        let c = g.state.creatures[0]
        let tile = GridPoint(14, 14)
        g.removeSpawnsForTest()
        try g.place(creatureID: c.id, at: tile, now: t0)
        XCTAssertEqual(g.tileStats(tile, at: t0)[.glow], 0)
        let half = t0.addingTimeInterval(9 * 3600)
        XCTAssertEqual(g.tileStats(tile, at: half)[.glow]!, c.contributions[.glow]! / 2, accuracy: 0.01)
        let full = t0.addingTimeInterval(18 * 3600)
        XCTAssertEqual(g.tileStats(tile, at: full)[.glow]!, c.contributions[.glow]!, accuracy: 0.01)
        // Radius 2 + 1 padding: two tiles out gets some, three tiles out gets none.
        XCTAssertGreaterThan(g.tileStats(GridPoint(tile.x + 2, tile.y), at: full)[.glow]!, 0)
        XCTAssertEqual(g.tileStats(GridPoint(tile.x + 3, tile.y), at: full)[.glow]!, 0)
        try g.recall(creatureID: c.id, now: full)
        XCTAssertEqual(g.tileStats(tile, at: full.addingTimeInterval(9 * 3600))[.glow]!, c.contributions[.glow]! / 2, accuracy: 0.01)
    }

    func testRotHermitLowersStone() throws {
        let g = Game.newForest(content: content, now: t0, seed: 2)
        g.removeSpawnsForTest()
        g.debugGrantCreature(typeID: "rot-hermit", glimmer: false, now: t0)
        g.debugGrant(itemID: "gem.jasper")
        let tile = GridPoint(10, 10)
        try g.use(itemID: "gem.jasper", on: tile, now: t0)
        XCTAssertEqual(g.tileStats(tile, at: t0)[.stone], 8)
        try g.place(creatureID: g.state.creatures[0].id, at: tile, now: t0)
        XCTAssertLessThan(g.tileStats(tile, at: t0.addingTimeInterval(23 * 3600))[.stone]!, 8)
    }

    func testSoilBoostsExpireAndHeartstoneIsPermanent() throws {
        let g = Game.newForest(content: content, now: t0, seed: 3)
        g.debugGrant(itemID: "gem.quartz")
        g.debugGrant(itemID: "material.heartstone-core")
        try g.use(itemID: "gem.quartz", on: GridPoint(3, 3), now: t0)
        try g.use(itemID: "material.heartstone-core", on: GridPoint(4, 4), now: t0)
        let later = t0.addingTimeInterval(30 * 3600)
        g.advance(to: later)
        XCTAssertEqual(g.tileStats(GridPoint(3, 3), at: later)[.stone], 0)
        XCTAssertEqual(g.tileStats(GridPoint(4, 4), at: later)[.depth], 10)
        XCTAssertEqual(g.state.soilBoosts.count, 1)
    }

    func testSlotLimit() throws {
        let g = Game.newForest(content: content, now: t0, seed: 5)
        g.removeSpawnsForTest()
        for _ in 0..<4 { g.debugGrantCreature(typeID: "pebble-mite", glimmer: false, now: t0) }
        for (i, c) in g.state.creatures.prefix(3).enumerated() {
            try g.place(creatureID: c.id, at: GridPoint(i * 6 + 2, 3), now: t0)
        }
        XCTAssertThrowsError(try g.place(creatureID: g.state.creatures[3].id, at: GridPoint(20, 20), now: t0)) {
            XCTAssertEqual($0 as? GameError, .noFreeSlot)
        }
    }

    func testGroveHeartSpeedsUpNeighbours() throws {
        let g = Game.newForest(content: content, now: t0, seed: 6)
        g.removeSpawnsForTest()
        g.debugGrantCreature(typeID: "grove-heart", glimmer: false, now: t0)
        g.debugGrantCreature(typeID: "pebble-mite", glimmer: false, now: t0)
        let heart = g.state.creatures[0], mite = g.state.creatures[1]
        try g.place(creatureID: heart.id, at: GridPoint(12, 12), now: t0)
        try g.place(creatureID: mite.id, at: GridPoint(14, 12), now: t0)
        // Pebble Mite normally takes 12h; under the Grove Heart it takes 6h.
        let p = try XCTUnwrap(g.activePlacement(for: mite.id))
        XCTAssertEqual(g.level(of: p, at: t0.addingTimeInterval(6 * 3600)), 1, accuracy: 0.001)
    }
}

final class SpawnAndLootTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = localNoon()
    override func setUpWithError() throws { content = try loadContent() }

    func testBareTilesOnlySpawnUnconditionalThings() {
        let g = Game.newForest(content: content, now: t0, seed: 11)
        let ids = Set(g.spawnWeights(for: GridPoint(5, 5), at: t0).map(\.0.id))
        XCTAssertEqual(ids, ["mushroom.brown-button-cap", "plant.clover", "geode.pebble-geode"])
    }

    func testTimeOfDayAndRainConditions() throws {
        let g = Game.newForest(content: content, now: t0, seed: 12)
        let tile = GridPoint(6, 6)
        for _ in 0..<9 {
            g.debugGrant(itemID: "material.heartstone-core")
            try g.use(itemID: "material.heartstone-core", on: tile, now: t0)
        }
        let noon = Set(g.spawnWeights(for: tile, at: t0).map(\.0.id))
        XCTAssertTrue(noon.contains("plant.sunpetal"))
        XCTAssertFalse(noon.contains("mushroom.moonlight-morel"), "night only")
        let midnight = t0.addingTimeInterval(12 * 3600)
        let night = Set(g.spawnWeights(for: tile, at: midnight).map(\.0.id))
        XCTAssertTrue(night.contains("mushroom.moonlight-morel"))
        XCTAssertFalse(night.contains("plant.sunpetal"), "daytime only")
        let rainyNight = (0..<400).map { midnight.addingTimeInterval(Double($0) * 86400) }.first { g.isRaining(at: $0) }!
        XCTAssertTrue(g.spawnWeights(for: tile, at: rainyNight).contains { $0.0.id == "mushroom.ancient-sporecrown" })
    }

    func testOfflineCatchUpSpawnsAndIsCapped() {
        let g = Game.newForest(content: content, now: t0, seed: 13)
        let report = g.advance(to: t0.addingTimeInterval(86400 * 30))
        XCTAssertEqual(report.ticks, content.tuning.spawns.maxCatchUpTicks)
        XCTAssertLessThanOrEqual(g.state.spawns.count, content.tuning.spawns.maxTotal)
    }

    func testMushroomPityGuaranteesFirstFungling() throws {
        let g = Game.newForest(content: content, now: t0, seed: 14)
        g.removeSpawnsForTest()
        let threshold = content.tuning.pity["fungling"]!
        var found: CreatureInstance?
        for i in 0..<threshold where found == nil {
            let tile = GridPoint(i % 20, i / 20 + 20)
            g.debugAddSpawn(itemID: "mushroom.brown-button-cap", at: tile, now: t0)
            for r in try g.collect(spawnID: g.spawnAt(tile)!.id, now: t0) {
                if case .creature(let c, _) = r { found = c }
            }
        }
        XCTAssertEqual(found?.typeID, "button-fungling", "the only species a bare tile's Brown Button Cap can hold")
        XCTAssertGreaterThan(g.state.inventory["mushroom.brown-button-cap"] ?? 0, 0)
    }

    func testGeodesRememberWhereTheyWereFound() throws {
        let g = Game.newForest(content: content, now: t0, seed: 15)
        g.removeSpawnsForTest()
        g.debugAddSpawn(itemID: "geode.pebble-geode", at: GridPoint(2, 2), now: t0)
        let dug = try g.collect(spawnID: g.spawnAt(GridPoint(2, 2))!.id, now: t0)
        XCTAssertEqual(dug, [.item(id: "geode.pebble-geode", count: 1, isNew: false)])
        XCTAssertEqual(g.state.geodes.first?.foundTile, GridPoint(2, 2))
        let cracked = try g.crack(itemID: "geode.pebble-geode", now: t0)
        XCTAssertEqual(cracked.count, 1)
        XCTAssertTrue(g.state.geodes.isEmpty)
        if case .item(let id, _, _) = cracked[0] {
            let allowed = Set(content.loot["loot.crack.pebble-geode"]!.rolls[0].pick!.map(\.item))
            XCTAssertTrue(allowed.contains(id))
        }
    }

    func testGeodeCrackPityYieldsCritter() throws {
        let g = Game.newForest(content: content, now: t0, seed: 16)
        var critter = false
        for _ in 0..<content.tuning.pity["geodeCritter"]! where !critter {
            g.debugGrant(itemID: "geode.pebble-geode")
            for r in try g.crack(itemID: "geode.pebble-geode", now: t0) {
                if case .creature(let c, _) = r { critter = content.creatures[c.typeID]?.family == "geodeCritter" }
            }
        }
        XCTAssertTrue(critter)
    }

    func testRareGemPity() throws {
        let g = Game.newForest(content: content, now: t0, seed: 17)
        let threshold = content.tuning.pity["rareGem"]!
        var streak = 0, maxStreak = 0
        for _ in 0..<200 {
            g.debugGrant(itemID: "geode.deep-geode")
            for r in try g.crack(itemID: "geode.deep-geode", now: t0) {
                guard case .item(let id, _, _) = r else { continue }
                if content.items[id]!.rarity >= .rare { streak = 0 } else { streak += 1; maxStreak = max(maxStreak, streak) }
            }
        }
        XCTAssertLessThan(maxStreak, threshold)
    }

    func testSeedsGrowIntoPlantsOrSproutlings() throws {
        let g = Game.newForest(content: content, now: t0, seed: 18)
        g.removeSpawnsForTest()
        g.debugGrant(itemID: "seed.mystery-seed", count: 30)
        var plants = 0, sprouts = 0
        for i in 0..<30 {
            let tile = GridPoint(i % 28, 27 - i / 28)
            try g.plantSeed(itemID: "seed.mystery-seed", at: tile, now: t0)
            let seed = g.seedAt(tile)!
            XCTAssertThrowsError(try g.harvestSeed(id: seed.id, now: t0))
            for r in try g.harvestSeed(id: seed.id, now: t0.addingTimeInterval(seed.growSeconds + 1)) {
                switch r {
                case .creature(let c, _): XCTAssertEqual(content.creatures[c.typeID]?.family, "sproutling"); sprouts += 1
                case .item(let id, _, _): XCTAssertEqual(content.items[id]?.category, "plant"); plants += 1
                }
            }
        }
        XCTAssertEqual(plants + sprouts, 30)
        XCTAssertGreaterThanOrEqual(sprouts, 1, "pity guarantees a Sproutling within the threshold")
    }

    func testMoonfallShardMakesNextFindAGlimmer() throws {
        let g = Game.newForest(content: content, now: t0, seed: 19)
        g.debugGrant(itemID: "material.moonfall-shard")
        try g.use(itemID: "material.moonfall-shard", on: nil, now: t0)
        XCTAssertTrue(g.state.nextGlimmer)
        g.debugGrant(itemID: "geode.pebble-geode", count: 40)
        var glimmer = false
        for _ in 0..<40 where !glimmer {
            for r in try g.crack(itemID: "geode.pebble-geode", now: t0) {
                if case .creature(let c, _) = r { glimmer = c.isGlimmer }
            }
        }
        XCTAssertTrue(glimmer)
        XCTAssertFalse(g.state.nextGlimmer)
    }

    func testWanderersArriveWhenConditionsAreMet() throws {
        let g = Game.newForest(content: content, now: t0, seed: 20)
        for _ in 0..<6 {
            g.debugGrant(itemID: "material.heartstone-core")
            try g.use(itemID: "material.heartstone-core", on: GridPoint(8, 8), now: t0)
        }
        g.removeSpawnsForTest()
        var t = t0
        for _ in 0..<400 where g.state.visitors.isEmpty {
            t = t.addingTimeInterval(86400)
            g.advance(to: t)
            g.removeSpawnsForTest()
        }
        XCTAssertFalse(g.state.visitors.isEmpty)
        let v = g.state.visitors[0]
        let r = try g.befriend(visitorID: v.id, now: t)
        if case .creature(let c, _) = r[0] { XCTAssertEqual(c.typeID, v.speciesID) } else { XCTFail() }
    }

    func testSpawnWeightAndGroundEffects() throws {
        let g = Game.newForest(content: content, now: t0, seed: 21)
        g.removeSpawnsForTest()
        g.debugGrantCreature(typeID: "hollow-digger", glimmer: false, now: t0)
        let tile = GridPoint(12, 12), near = GridPoint(12, 13)
        let before = g.spawnWeights(for: near, at: t0).first { $0.0.id == "geode.pebble-geode" }!.1
        try g.place(creatureID: g.state.creatures[0].id, at: tile, now: t0)
        let after = g.spawnWeights(for: near, at: t0).first { $0.0.id == "geode.pebble-geode" }!.1
        XCTAssertEqual(after, before * 1.5, accuracy: 0.001)
        XCTAssertEqual(g.groundOverrides(at: t0, field: g.statField(at: t0))[tile], "tile.cave.a")
    }
}

final class VisualsNamingSaveTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = localNoon()
    override func setUpWithError() throws { content = try loadContent() }

    func engine() -> TileRuleEngine {
        TileRuleEngine(rules: content.tileRules, maxDecorations: content.tuning.visuals.maxDecorationsPerTile, seed: 1)
    }

    func testRulesPickGroundFromStats() {
        let e = engine()
        let p = GridPoint(1, 1)
        XCTAssertTrue(e.visual(for: [:], at: p).ground.hasPrefix("tile.grass"))
        XCTAssertTrue(e.visual(for: [:], at: p).overlays.isEmpty)
        XCTAssertEqual(e.visual(for: [.stone: 40, .depth: 30], at: p).ground, "tile.cave.a")
        XCTAssertEqual(e.visual(for: [.damp: 20, .stone: 20], at: p).ground, "tile.mossrock.a")
        XCTAssertTrue(e.visual(for: [.damp: 20, .glow: 12], at: p).ground.hasPrefix("tile.grass"))
    }

    func testOverlaysStackOnePerFamilyAtStrongestLevel() {
        let e = engine()
        let mixed = e.visual(for: [.bloom: 12, .damp: 25, .depth: 4], at: GridPoint(3, 4)).overlays.map(\.sprite)
        XCTAssertEqual(mixed.count, 3, "\(mixed)")
        XCTAssertTrue(mixed[0].hasPrefix("ov.dirt.1"))
        XCTAssertTrue(mixed[1].hasPrefix("ov.mycelium.3"))
        XCTAssertTrue(mixed[2].hasPrefix("ov.flowers.2"))
        XCTAssertTrue(e.visual(for: [.stone: 80, .depth: 80], at: GridPoint(3, 4)).overlays.isEmpty)
    }

    func testEdgeIsForestAndDenserFurtherOut() {
        let e = engine()
        let edge = content.tuning.visuals.edge!
        func density(_ dist: Int) -> Double {
            Double((0..<400).filter { !e.edgeVisual(at: GridPoint(-dist, $0), size: content.tuning.grid, edge: edge).decorations.isEmpty }.count) / 400
        }
        XCTAssertLessThan(density(1), density(4))
    }

    func testForestNames() {
        let namer = ForestNamer(parts: content.nameParts, tuning: content.tuning.naming)
        XCTAssertTrue(content.nameParts.quietNames.contains(namer.name(means: [:], seed: 1)))
        let name = namer.name(means: [.damp: 3, .depth: 2, .glow: 1.5], seed: 7)
        XCTAssertTrue(name.contains(" of "), name)
    }

    func testSaveRoundTripAndOldSavesLoad() throws {
        let g = Game.newForest(content: content, now: t0, seed: 31)
        g.removeSpawnsForTest()
        g.debugGrantCreature(typeID: "pebble-mite", glimmer: false, now: t0)
        try g.place(creatureID: g.state.creatures[0].id, at: GridPoint(4, 4), now: t0)
        g.debugGrant(itemID: "gem.quartz")
        try g.use(itemID: "gem.quartz", on: GridPoint(5, 5), now: t0)
        g.renameForest("My Wood")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        let store = SaveStore(url: url)
        try store.save(g.state)
        let loaded = try XCTUnwrap(store.load())
        XCTAssertEqual(loaded.creatures, g.state.creatures)
        XCTAssertEqual(loaded.placements, g.state.placements)
        XCTAssertEqual(loaded.soilBoosts, g.state.soilBoosts)
        XCTAssertEqual(loaded.customName, "My Wood")

        // A save written before geodes/visitors/soil boosts existed still loads.
        var json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        for k in ["geodes", "visitors", "soilBoosts", "nextGlimmer", "lastWandererDay"] { json[k] = nil }
        try JSONSerialization.data(withJSONObject: json).write(to: url)
        XCTAssertNotNil(store.load())
    }

    func testCorruptSaveIsBackedUp() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        try "not json".data(using: .utf8)!.write(to: url)
        XCTAssertNil(SaveStore(url: url).load())
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path + ".corrupt"))
    }
}

extension Game {
    /// Clears wild spawns so tests can use fixed tiles.
    func removeSpawnsForTest() { debugClearSpawns() }
}
