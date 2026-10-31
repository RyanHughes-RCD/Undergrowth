import XCTest
@testable import UndergrowthCore

/// Loads the real bundled content from the repo's Resources folder.
func loadContent() throws -> ContentDatabase {
    let here = URL(fileURLWithPath: #filePath)
    let resources = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
    return try ContentDatabase.load(roots: [resources])
}

final class ContentTests: XCTestCase {
    func testBundledContentIsValid() throws {
        let db = try loadContent()
        XCTAssertEqual(db.validate(), [])
        XCTAssertEqual(db.orderedCreatures.map(\.id), ["fungling", "sproutling", "geodeCritter"])
        XCTAssertGreaterThan(db.sprites.sprites.count, 50)
    }

    func testSpriteDecodingAndPaletteRef() throws {
        let db = try loadContent()
        let tile = db.sprites.sprite("tile.soil.a")
        XCTAssertEqual(tile.paletteRef, "pal.ground")
        let buf = db.sprites.pixels("tile.soil.a")
        XCTAssertEqual(buf.width, 32)
        XCTAssertEqual(buf.bytes.count, 32 * 24 * 4)
        // Diamond center is opaque, the top-left corner is transparent.
        XCTAssertEqual(buf.bytes[(8 * 32 + 16) * 4 + 3], 255)
        XCTAssertEqual(buf.bytes[3], 0)
    }

    func testPaletteSwapAndSilhouette() throws {
        let db = try loadContent()
        let swap = RenderVariant.swap(["2": "#ff0000"])
        let normal = db.sprites.pixels("creature.fungling")
        let glimmer = db.sprites.pixels("creature.fungling", variant: swap)
        XCTAssertNotEqual(normal.bytes, glimmer.bytes)
        let sil = db.sprites.pixels("creature.fungling", variant: RenderVariant(silhouette: RGBA(1, 2, 3)))
        for i in stride(from: 0, to: sil.bytes.count, by: 4) where sil.bytes[i + 3] > 0 {
            XCTAssertEqual(sil.bytes[i], 1)
        }
    }

    func testMissingSpriteFallsBack() throws {
        let db = try loadContent()
        XCTAssertEqual(db.sprites.sprite("does.not.exist").id, SpriteRegistry.missingID)
    }

    func testUserContentRootOverrides() throws {
        let db0 = try loadContent()
        _ = db0
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tmp.appendingPathComponent("Sprites"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: tmp.appendingPathComponent("Content"), withIntermediateDirectories: true)
        let sprite = SpriteData(id: "user.blob", size: [2, 2], palette: ["transparent", "#00ff00"],
                                frames: [SpriteFrame(rows: ["11", "1."])])
        try JSONEncoder().encode(sprite).write(to: tmp.appendingPathComponent("Sprites/user.blob.json"))
        let itemJSON = """
        [{ "id": "mushroom.user", "category": "mushroom", "name": "User Cap", "rarity": "rare",
           "sprite": "user.blob", "spawn": { "baseWeight": 1 } }]
        """
        try itemJSON.data(using: .utf8)!.write(to: tmp.appendingPathComponent("Content/items.json"))

        let here = URL(fileURLWithPath: #filePath)
        let resources = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
        let db = try ContentDatabase.load(roots: [resources, tmp])
        XCTAssertNotNil(db.items["mushroom.user"])
        XCTAssertTrue(db.spawnableItems.contains { $0.id == "mushroom.user" })
        XCTAssertEqual(db.validate(), [])
    }
}

final class StatTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    override func setUpWithError() throws { content = try loadContent() }

    func testNewForestHasStartersInBurrowAndZeroStats() {
        let g = Game.newForest(content: content, now: t0, seed: 42)
        XCTAssertEqual(g.burrow.count, 3)
        XCTAssertEqual(g.state.slots.count, content.tuning.placementSlots)
        XCTAssertEqual(g.state.size, content.tuning.grid)
        XCTAssertEqual(g.statField(at: t0).values.max(), 0)
    }

    func testPlacementRampsOverTimeNotImmediately() throws {
        let g = Game.newForest(content: content, now: t0, seed: 1)
        let fungling = g.burrow.first { $0.typeID == "fungling" }!
        let tile = GridPoint(20, 20)
        try g.place(creatureID: fungling.id, at: tile, now: t0)
        XCTAssertEqual(g.tileStats(tile, at: t0)[.damp], 0)

        let ramp = content.tuning.rampSecondsToFull
        let half = g.tileStats(tile, at: t0.addingTimeInterval(ramp / 2))[.damp]!
        let full = g.tileStats(tile, at: t0.addingTimeInterval(ramp))[.damp]!
        let later = g.tileStats(tile, at: t0.addingTimeInterval(ramp * 10))[.damp]!
        XCTAssertEqual(half, fungling.contributions[.damp]! / 2, accuracy: 0.01)
        XCTAssertEqual(full, fungling.contributions[.damp]!, accuracy: 0.01)
        XCTAssertEqual(later, full, accuracy: 0.0001, "capped at the creature's contribution")
        XCTAssertEqual(g.tileStats(tile, at: t0.addingTimeInterval(ramp))[.stone], 0)
    }

    func testFalloffWithDistanceAndRadius() throws {
        let g = Game.newForest(content: content, now: t0, seed: 2)
        let c = g.burrow.first { $0.typeID == "geodeCritter" }!
        let center = GridPoint(20, 20)
        try g.place(creatureID: c.id, at: center, now: t0)
        let t = t0.addingTimeInterval(content.tuning.rampSecondsToFull)
        let r = Int(c.radius)
        let atCenter = g.tileStats(center, at: t)[.stone]!
        let mid = g.tileStats(GridPoint(20 + r - 1, 20), at: t)[.stone]!
        let outside = g.tileStats(GridPoint(20 + r + 1, 20), at: t)[.stone]!
        XCTAssertGreaterThan(atCenter, mid)
        XCTAssertGreaterThan(mid, 0)
        XCTAssertEqual(outside, 0)
        // Circular: same distance on a diagonal-ish point gives the same value.
        let a = g.tileStats(GridPoint(23, 24), at: t)[.stone]!
        let b = g.tileStats(GridPoint(24, 23), at: t)[.stone]!
        XCTAssertEqual(a, b, accuracy: 0.0001)
    }

    func testRemovalDecaysGraduallyAndPrunes() throws {
        let g = Game.newForest(content: content, now: t0, seed: 3)
        let c = g.burrow.first { $0.typeID == "sproutling" }!
        let tile = GridPoint(10, 10)
        try g.place(creatureID: c.id, at: tile, now: t0)
        let ramp = content.tuning.rampSecondsToFull, decay = content.tuning.decaySecondsToZero
        let tRemove = t0.addingTimeInterval(ramp)
        try g.recall(creatureID: c.id, now: tRemove)
        XCTAssertEqual(g.burrow.count, 3, "creature is back in the burrow right away")
        let full = c.contributions[.verdure]!
        XCTAssertEqual(g.tileStats(tile, at: tRemove)[.verdure]!, full, accuracy: 0.01)
        XCTAssertEqual(g.tileStats(tile, at: tRemove.addingTimeInterval(decay / 2))[.verdure]!, full / 2, accuracy: 0.01)
        XCTAssertEqual(g.tileStats(tile, at: tRemove.addingTimeInterval(decay))[.verdure]!, 0, accuracy: 0.0001)
        g.advance(to: tRemove.addingTimeInterval(decay + 1))
        XCTAssertTrue(g.state.placements.isEmpty)
    }

    func testReplacingResumesFromDecayingLevel() throws {
        let g = Game.newForest(content: content, now: t0, seed: 4)
        let c = g.burrow.first { $0.typeID == "fungling" }!
        let tile = GridPoint(5, 5)
        let ramp = content.tuning.rampSecondsToFull, decay = content.tuning.decaySecondsToZero
        try g.place(creatureID: c.id, at: tile, now: t0)
        let t1 = t0.addingTimeInterval(ramp)
        try g.recall(creatureID: c.id, now: t1)
        let t2 = t1.addingTimeInterval(decay / 4)
        let before = g.tileStats(tile, at: t2)[.damp]!
        try g.place(creatureID: c.id, at: tile, now: t2)
        XCTAssertEqual(g.tileStats(tile, at: t2)[.damp]!, before, accuracy: 0.01)
        XCTAssertEqual(g.state.placements.count, 1)
    }

    func testSlotLimit() throws {
        let g = Game.newForest(content: content, now: t0, seed: 5)
        for (i, c) in g.burrow.enumerated() { try g.place(creatureID: c.id, at: GridPoint(i * 3, 0), now: t0) }
        var rng = SeededRNG(seed: 9)
        let extra = g.loot.rollCreature(typeID: "fungling", origin: nil, now: t0, rng: &rng)
        g.addCreature(extra)
        XCTAssertThrowsError(try g.place(creatureID: extra.id, at: GridPoint(30, 30), now: t0)) {
            XCTAssertEqual($0 as? GameError, .noFreeSlot)
        }
    }

    func testStatsCappedAt100() throws {
        let g = Game.newForest(content: content, now: t0, seed: 6)
        var rng = SeededRNG(seed: 1)
        for i in 0..<3 {
            var c = g.loot.rollCreature(typeID: "fungling", origin: nil, now: t0, rng: &rng)
            c.contributions[.damp] = 90
            g.addCreature(c)
            _ = i
        }
        let ids = g.burrow.filter { $0.contributions[.damp] == 90 }.map(\.id)
        try g.place(creatureID: ids[0], at: GridPoint(10, 10), now: t0)
        try g.place(creatureID: ids[1], at: GridPoint(11, 10), now: t0)
        try g.place(creatureID: ids[2], at: GridPoint(10, 11), now: t0)
        let v = g.tileStats(GridPoint(10, 10), at: t0.addingTimeInterval(1e6))[.damp]!
        XCTAssertEqual(v, 100)
    }

    func testFieldMatchesPerTileStats() throws {
        let g = Game.newForest(content: content, now: t0, seed: 7)
        for (i, c) in g.burrow.enumerated() { try g.place(creatureID: c.id, at: GridPoint(10 + i * 5, 12), now: t0) }
        let t = t0.addingTimeInterval(5000)
        let field = g.statField(at: t)
        for p in [GridPoint(10, 12), GridPoint(13, 13), GridPoint(25, 30), GridPoint(0, 0)] {
            let s = g.tileStats(p, at: t)
            for k in StatKey.core { XCTAssertEqual(field.value(k, at: p), s[k]!, accuracy: 1e-9) }
        }
    }
}

final class SpawnAndLootTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    override func setUpWithError() throws { content = try loadContent() }

    func testOfflineCatchUpSpawnsAndIsCapped() {
        let g = Game.newForest(content: content, now: t0, seed: 11)
        let report = g.advance(to: t0.addingTimeInterval(86400 * 30))
        XCTAssertEqual(report.ticks, content.tuning.spawns.maxCatchUpTicks)
        XCTAssertGreaterThan(g.state.spawns.count, 0)
        XCTAssertLessThanOrEqual(g.state.spawns.count, content.tuning.spawns.maxTotal)
        let tiles = g.state.spawns.map(\.tile)
        XCTAssertEqual(Set(tiles).count, tiles.count, "one spawn per tile")
    }

    func testStatsShiftSpawnWeights() throws {
        let g = Game.newForest(content: content, now: t0, seed: 12)
        let critter = g.burrow.first { $0.typeID == "geodeCritter" }!
        try g.place(creatureID: critter.id, at: GridPoint(20, 20), now: t0)
        let later = t0.addingTimeInterval(content.tuning.rampSecondsToFull)
        func share(_ category: String, _ tile: GridPoint) -> Double {
            let w = g.spawnWeights(for: tile, at: later)
            let total = w.reduce(0) { $0 + $1.1 }
            return w.filter { $0.0.category == category }.reduce(0) { $0 + $1.1 } / total
        }
        XCTAssertGreaterThan(share("geode", GridPoint(20, 20)), share("geode", GridPoint(0, 0)) * 3)
        // Threshold-gated rare items don't appear on bare ground.
        XCTAssertFalse(g.spawnWeights(for: GridPoint(0, 0), at: later).contains { $0.0.id == "mushroom.glowcap" })
    }

    func testPityGuaranteesHit() {
        let roller = LootRoller(content: content)
        var pity: [String: Int] = [:]
        var rng = SeededRNG(seed: 3)
        let threshold = content.tuning.pity["fungling"]!
        var hits = 0
        for _ in 0..<threshold {
            if roller.pityRoll(chance: 0, key: "fungling", pity: &pity, rng: &rng) { hits += 1 }
        }
        XCTAssertEqual(hits, 1)
        XCTAssertEqual(pity["fungling"], 0)
    }

    func testRareGemPity() {
        let roller = LootRoller(content: content)
        var pity: [String: Int] = [:]
        var rng = SeededRNG(seed: 5)
        let threshold = content.tuning.pity["rareGem"]!
        var streak = 0, maxStreak = 0
        for _ in 0..<500 {
            let id = roller.pickFromGroup("gems", minRarity: nil, rarityPity: "rareGem", rarityPityMin: .rare,
                                          pity: &pity, rng: &rng)!
            if content.items[id]!.rarity >= .rare { streak = 0 } else { streak += 1; maxStreak = max(maxStreak, streak) }
        }
        XCTAssertLessThan(maxStreak, threshold)
    }

    func testDigCrackAndDiscovery() throws {
        let g = Game.newForest(content: content, now: t0, seed: 21)
        g.debugAddSpawn(itemID: "geode.plain", at: GridPoint(3, 3), now: t0)
        let spawn = g.state.spawns[0]
        let dug = try g.collect(spawnID: spawn.id, now: t0)
        XCTAssertEqual(dug, [.item(id: "rock.rough", count: 1, isNew: false)])
        XCTAssertTrue(g.state.discovered.contains("item:geode.plain"))
        XCTAssertEqual(g.state.inventory["rock.rough"], 1)
        let cracked = try g.crack(itemID: "rock.rough", now: t0)
        XCTAssertEqual(cracked.count, 1)
        XCTAssertNil(g.state.inventory["rock.rough"])
        XCTAssertTrue(cracked[0].isNew)
        XCTAssertThrowsError(try g.crack(itemID: "rock.rough", now: t0))
    }

    func testCrackingEventuallyYieldsCritterViaPity() throws {
        let g = Game.newForest(content: content, now: t0, seed: 22)
        let threshold = content.tuning.pity["geodeCritter"]!
        var gotCritter = false
        for _ in 0..<threshold {
            g.debugGrant(itemID: "rock.rough")
            for r in try g.crack(itemID: "rock.rough", now: t0) {
                if case .creature(let c, _) = r, c.typeID == "geodeCritter" { gotCritter = true }
            }
        }
        XCTAssertTrue(gotCritter)
        XCTAssertEqual(g.state.creatures.count, 4)
    }

    func testSeedsGrowOverRealTime() throws {
        let g = Game.newForest(content: content, now: t0, seed: 23)
        g.debugGrant(itemID: "seed.wild")
        try g.plantSeed(itemID: "seed.wild", at: GridPoint(7, 7), now: t0)
        let seed = g.state.plantedSeeds[0]
        XCTAssertThrowsError(try g.harvestSeed(id: seed.id, now: t0))
        let result = try g.harvestSeed(id: seed.id, now: t0.addingTimeInterval(seed.growSeconds + 1))
        XCTAssertEqual(result.count, 1)
        XCTAssertTrue(g.state.plantedSeeds.isEmpty)
    }

    func testGlimmerRollsAreStronger() {
        let roller = LootRoller(content: content)
        var rng = SeededRNG(seed: 8)
        let profile = content.tuning.creatureTraits["fungling"]!
        let g = roller.rollCreature(typeID: "fungling", origin: nil, now: t0, forceGlimmer: true, rng: &rng)
        XCTAssertTrue(g.isGlimmer)
        XCTAssertGreaterThanOrEqual(g.radius, profile.radius.lo + profile.glimmer.radiusBonus - 0.05)
        XCTAssertGreaterThanOrEqual(g.contributions[.damp]!, profile.contribution[.damp]!.lo * profile.glimmer.contributionMult - 0.05)
    }
}

final class VisualsNamingSaveTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    override func setUpWithError() throws { content = try loadContent() }

    func engine() -> TileRuleEngine {
        TileRuleEngine(rules: content.tileRules, maxDecorations: content.tuning.visuals.maxDecorationsPerTile, seed: 1)
    }

    func testRulesPickGroundFromStats() {
        let e = engine()
        let p = GridPoint(1, 1)
        XCTAssertTrue(e.visual(for: [:], at: p).ground.hasPrefix("tile.soil"))
        XCTAssertEqual(e.visual(for: [.stone: 70, .depth: 70], at: p).ground, "tile.cave.a")
        XCTAssertEqual(e.visual(for: [.damp: 40, .stone: 40], at: p).ground, "tile.mossrock.a")
        XCTAssertEqual(e.visual(for: [.damp: 50, .glow: 50], at: p).ground, "tile.glowmoss.a")
        XCTAssertTrue(e.visual(for: [.verdure: 15], at: p).ground.hasPrefix("tile.grass"))
    }

    func testVisualsAreStable() {
        let e = engine()
        let s: StatValues = [.bloom: 50, .glow: 40, .verdure: 30]
        XCTAssertEqual(e.visual(for: s, at: GridPoint(4, 9)), e.visual(for: s, at: GridPoint(4, 9)))
        XCTAssertLessThanOrEqual(e.visual(for: s, at: GridPoint(4, 9)).decorations.count, 2)
    }

    func testForestNames() {
        let namer = ForestNamer(parts: content.nameParts, tuning: content.tuning.naming)
        XCTAssertTrue(content.nameParts.quietNames.contains(namer.name(means: [:], seed: 1)))
        let name = namer.name(means: [.damp: 30, .depth: 20, .glow: 15], seed: 7)
        XCTAssertTrue(name.contains(" of "), name)
        let dampAdj = content.nameParts.stats[.damp]!.adjectives
        XCTAssertTrue(dampAdj.contains { name.hasPrefix($0) }, name)
    }

    func testSaveRoundTrip() throws {
        let g = Game.newForest(content: content, now: t0, seed: 31)
        try g.place(creatureID: g.burrow[0].id, at: GridPoint(4, 4), now: t0)
        g.debugGrant(itemID: "seed.wild")
        g.advance(to: t0.addingTimeInterval(3600))
        g.renameForest("My Wood")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        let store = SaveStore(url: url)
        try store.save(g.state)
        let loaded = try XCTUnwrap(store.load())
        XCTAssertEqual(loaded.creatures, g.state.creatures)
        XCTAssertEqual(loaded.placements, g.state.placements)
        XCTAssertEqual(loaded.spawns, g.state.spawns)
        XCTAssertEqual(loaded.inventory, g.state.inventory)
        XCTAssertEqual(loaded.customName, "My Wood")
        XCTAssertEqual(loaded.rng, g.state.rng)
        let json = String(data: try Data(contentsOf: url), encoding: .utf8)!
        XCTAssertTrue(json.contains("\"damp\":"), "stat dictionaries encode as objects")

        // Reopening after a long time catches up from timestamps.
        let g2 = Game(content: content, state: loaded)
        let later = t0.addingTimeInterval(content.tuning.rampSecondsToFull)
        g2.advance(to: later)
        XCTAssertGreaterThan(g2.tileStats(GridPoint(4, 4), at: later).values.max()!, 10)
    }

    func testCorruptSaveIsBackedUp() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        try "not json".data(using: .utf8)!.write(to: url)
        XCTAssertNil(SaveStore(url: url).load())
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path + ".corrupt"))
    }
}
