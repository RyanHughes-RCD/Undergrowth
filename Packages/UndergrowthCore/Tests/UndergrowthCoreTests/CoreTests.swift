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

/// The bundled Resources now describe the web garden: no creatures, loot tables, geodes or wild spawns,
/// and a frozen Resources/ios/tuning.json for this engine. These tests check that the iOS app still loads
/// and runs on that content; the creature-era systems themselves are no longer covered by bundled data.
final class ContentTests: XCTestCase {
    func testBundledContentIsValid() throws {
        let db = try loadContent()
        XCTAssertEqual(db.validate(), [])
        XCTAssertTrue(db.orderedCreatures.isEmpty, "creatures were removed from the game")
        XCTAssertEqual(db.items["mushroom.ancient-sporecrown"]?.rarity, .legendary)
        XCTAssertEqual(db.items["plant.ghost-orchid"]?.rarity, .veryRare)
        XCTAssertTrue(db.tuning.starterCreatures.isEmpty)
    }

    func testSpriteDecodingAndPaletteRef() throws {
        let db = try loadContent()
        XCTAssertEqual(db.sprites.sprite("tile.grass.a").paletteRef, "pal.ground")
        let buf = db.sprites.pixels("tile.grass.a")
        XCTAssertEqual(buf.width, 16, "top-down square tiles")
        XCTAssertEqual(buf.bytes.count, 16 * 16 * 4)
        XCTAssertEqual(buf.bytes[3], 255, "tiles are fully opaque")
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

final class GameTests: XCTestCase {
    var content: ContentDatabase!
    let t0 = localNoon()
    override func setUpWithError() throws { content = try loadContent() }

    func testNewForestLoadsWithNoCreatures() {
        let g = Game.newForest(content: content, now: t0, seed: 42)
        XCTAssertTrue(g.state.creatures.isEmpty)
        XCTAssertEqual(g.state.slots.count, 3)
    }

    func engine() -> TileRuleEngine {
        TileRuleEngine(rules: content.tileRules, maxDecorations: content.tuning.visuals.maxDecorationsPerTile, seed: 1)
    }

    func testEdgeIsAShrubTreeline() {
        let e = engine()
        let edge = content.tuning.visuals.edge!
        // Every tile just outside the map holds a shrub, on all four sides.
        let size = content.tuning.grid
        for p in [GridPoint(-1, 3), GridPoint(size.width, 5), GridPoint(4, -1), GridPoint(2, size.height)] {
            let v = e.edgeVisual(at: p, size: size, edge: edge)
            XCTAssertTrue(v.decorations.first?.sprite.hasPrefix("deco.shrub") == true, "\(p)")
        }
    }

    func testForestNames() {
        let namer = ForestNamer(parts: content.nameParts, tuning: content.tuning.naming)
        XCTAssertTrue(content.nameParts.quietNames.contains(namer.name(means: [:], seed: 1)))
        let name = namer.name(means: [.spore: 3, .spirit: 2, .glow: 1.5], seed: 7)
        XCTAssertTrue(name.contains(" of "), name)
    }

    func testSaveRoundTrip() throws {
        let g = Game.newForest(content: content, now: t0, seed: 31)
        g.debugGrant(itemID: "mushroom.ink-cap")
        g.renameForest("My Wood")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        let store = SaveStore(url: url)
        try store.save(g.state)
        let loaded = try XCTUnwrap(store.load())
        XCTAssertEqual(loaded.customName, "My Wood")
        XCTAssertEqual(loaded.inventory["mushroom.ink-cap"], 1)
    }

    func testCorruptSaveIsBackedUp() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        try "not json".data(using: .utf8)!.write(to: url)
        XCTAssertNil(SaveStore(url: url).load())
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path + ".corrupt"))
    }
}
