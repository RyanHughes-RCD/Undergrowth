import Foundation

/// All game content, loaded from one or more content roots.
///
/// Root layout:
/// ```
/// <root>/tuning.json                 (only needed in the first root)
/// <root>/Content/creatures.json      [CreatureDef]
/// <root>/Content/items.json          [ItemDef]
/// <root>/Content/loot.json           { tableId: LootTable }
/// <root>/Content/tileRules.json      [TileRule]
/// <root>/Content/nameParts.json      NameParts
/// <root>/Sprites/**/*.json           SpriteData (one per file)
/// <root>/Sprites/Palettes/*.json     PaletteData
/// ```
/// Later roots override earlier ones by id, so a user content folder (the
/// future sprite editor's output) can add or replace sprites, items and creatures.
public final class ContentDatabase {
    public var tuning: Tuning
    public private(set) var creatures: [String: CreatureDef] = [:]
    public private(set) var creatureOrder: [String] = []
    public private(set) var items: [String: ItemDef] = [:]
    public private(set) var itemOrder: [String] = []
    public private(set) var loot: [String: LootTable] = [:]
    public private(set) var tileRules: [TileRule] = []
    public var nameParts: NameParts
    public let sprites: SpriteRegistry

    public init(tuning: Tuning, nameParts: NameParts, sprites: SpriteRegistry = SpriteRegistry()) {
        self.tuning = tuning
        self.nameParts = nameParts
        self.sprites = sprites
    }

    // MARK: Registration (used by loaders and, later, the sprite editor)

    public func register(_ c: CreatureDef) {
        if creatures[c.id] == nil { creatureOrder.append(c.id) }
        creatures[c.id] = c
    }
    public func register(_ i: ItemDef) {
        if items[i.id] == nil { itemOrder.append(i.id) }
        items[i.id] = i
    }
    public func register(lootTable: LootTable, id: String) { loot[id] = lootTable }
    public func register(_ rule: TileRule) {
        tileRules.removeAll { $0.id == rule.id }
        tileRules.append(rule)
    }

    public var orderedCreatures: [CreatureDef] { creatureOrder.compactMap { creatures[$0] } }
    public var orderedItems: [ItemDef] { itemOrder.compactMap { items[$0] } }
    public var spawnableItems: [ItemDef] { orderedItems.filter { $0.spawn != nil } }

    public func items(inGroup g: String) -> [ItemDef] {
        orderedItems.filter { $0.groups?.contains(g) == true }
    }

    // MARK: Loading

    public enum LoadError: Error, CustomStringConvertible {
        case missingTuning(URL)
        case file(URL, Error)
        public var description: String {
            switch self {
            case .missingTuning(let u): return "No tuning.json in \(u.path)"
            case .file(let u, let e): return "\(u.lastPathComponent): \(e)"
            }
        }
    }

    public static func load(roots: [URL]) throws -> ContentDatabase {
        let fm = FileManager.default
        let dec = JSONDecoder()

        func read<T: Decodable>(_ type: T.Type, _ url: URL) throws -> T {
            do { return try dec.decode(T.self, from: Data(contentsOf: url)) }
            catch { throw LoadError.file(url, error) }
        }

        guard let first = roots.first else { throw LoadError.missingTuning(URL(fileURLWithPath: "/")) }
        let tuningURL = first.appendingPathComponent("tuning.json")
        guard fm.fileExists(atPath: tuningURL.path) else { throw LoadError.missingTuning(first) }
        let tuning = try read(Tuning.self, tuningURL)
        let namesURL = first.appendingPathComponent("Content/nameParts.json")
        let names = try read(NameParts.self, namesURL)

        let db = ContentDatabase(tuning: tuning, nameParts: names)

        for root in roots {
            let content = root.appendingPathComponent("Content")
            func ifExists(_ name: String, _ body: (URL) throws -> Void) throws {
                let u = content.appendingPathComponent(name)
                if fm.fileExists(atPath: u.path) { try body(u) }
            }
            try ifExists("creatures.json") { u in try read([CreatureDef].self, u).forEach(db.register) }
            try ifExists("items.json") { u in try read([ItemDef].self, u).forEach(db.register) }
            try ifExists("loot.json") { u in
                for (k, v) in try read([String: LootTable].self, u) { db.register(lootTable: v, id: k) }
            }
            try ifExists("tileRules.json") { u in try read([TileRule].self, u).forEach(db.register) }
            if root != first {
                try ifExists("nameParts.json") { u in db.nameParts = try read(NameParts.self, u) }
            }

            let spritesDir = root.appendingPathComponent("Sprites")
            if let en = fm.enumerator(at: spritesDir, includingPropertiesForKeys: nil) {
                let files = en.compactMap { $0 as? URL }
                    .filter { $0.pathExtension == "json" }
                    .sorted { $0.path < $1.path }
                for f in files {
                    if f.deletingLastPathComponent().lastPathComponent == "Palettes" {
                        db.sprites.register(try read(PaletteData.self, f))
                    } else {
                        db.sprites.register(try read(SpriteData.self, f))
                    }
                }
            }
        }
        return db
    }

    // MARK: Validation

    /// Human-readable list of content problems (missing sprite ids, unknown tables...).
    public func validate() -> [String] {
        var issues: [String] = []
        func sprite(_ id: String?, _ owner: String) {
            guard let id else { return }
            if !sprites.contains(id) { issues.append("\(owner): missing sprite '\(id)'") }
        }
        func table(_ id: String?, _ owner: String) {
            guard let id else { return }
            if loot[id] == nil { issues.append("\(owner): missing loot table '\(id)'") }
        }
        for c in orderedCreatures {
            sprite(c.sprite, "creature \(c.id)")
            sprite(c.glimmerSprite, "creature \(c.id)")
            if tuning.creatureTraits[c.id] == nil { issues.append("creature \(c.id): no creatureTraits in tuning") }
        }
        for i in orderedItems {
            sprite(i.sprite, "item \(i.id)")
            table(i.onCollect, "item \(i.id)")
            table(i.onCrack, "item \(i.id)")
            table(i.onGrow, "item \(i.id)")
            i.growthSprites?.forEach { sprite($0, "item \(i.id)") }
        }
        for (tid, t) in loot {
            for r in t.rolls {
                if let c = r.creature, creatures[c] == nil { issues.append("loot \(tid): unknown creature '\(c)'") }
                if let it = r.item, items[it] == nil { issues.append("loot \(tid): unknown item '\(it)'") }
                if let g = r.group, items(inGroup: g).isEmpty { issues.append("loot \(tid): empty group '\(g)'") }
                if let p = r.pity, tuning.pity[p] == nil { issues.append("loot \(tid): no pity threshold '\(p)'") }
                if let p = r.rarityPity, tuning.pity[p] == nil { issues.append("loot \(tid): no pity threshold '\(p)'") }
            }
        }
        for rule in tileRules {
            rule.sprites?.forEach { sprite($0, "tile rule \(rule.id)") }
            if rule.layer == .tint, RGBA(hex: rule.color ?? "") == nil || rule.stat == nil {
                issues.append("tile rule \(rule.id): tint needs color and stat")
            }
            if rule.layer != .tint, (rule.sprites ?? []).isEmpty {
                issues.append("tile rule \(rule.id): no sprites")
            }
        }
        if !tileRules.contains(where: { $0.layer == .ground && ($0.when ?? [:]).isEmpty && $0.any == nil }) {
            issues.append("tile rules: no unconditional ground fallback")
        }
        for s in sprites.sprites.values { issues.append(contentsOf: s.problems()) }
        for id in tuning.starterCreatures where creatures[id] == nil {
            issues.append("tuning: unknown starter creature '\(id)'")
        }
        return issues.sorted()
    }
}
