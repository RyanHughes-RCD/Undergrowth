import Foundation

/// What a tile looks like. Equatable so the renderer only updates changed tiles.
public struct TileVisual: Hashable {
    public struct Decoration: Hashable {
        public var sprite: String
        /// Offset from tile center in art pixels (x right, y down), inside the diamond.
        public var offsetX: Int
        public var offsetY: Int
        public var flipped: Bool
    }
    public var ground: String
    public var decorations: [Decoration]
    /// Blended tint color and strength (0...1).
    public var tint: RGBA?
    public var tintAmount: Double
}

/// Turns tile stats into sprite ids using the data-driven rules in `tileRules.json`.
/// Nothing here knows about specific biomes: blends emerge from overlapping stats.
public struct TileRuleEngine {
    public let ground: [TileRule]
    public let decorations: [TileRule]
    public let tints: [TileRule]
    public let maxDecorations: Int
    public let seed: UInt64

    public init(rules: [TileRule], maxDecorations: Int, seed: UInt64) {
        let sorted = rules.enumerated().sorted {
            let pa = $0.element.priority ?? 0, pb = $1.element.priority ?? 0
            return pa != pb ? pa > pb : $0.offset < $1.offset
        }.map(\.element)
        ground = sorted.filter { $0.layer == .ground }
        decorations = sorted.filter { $0.layer == .decoration }
        tints = sorted.filter { $0.layer == .tint }
        self.maxDecorations = maxDecorations
        self.seed = seed
    }

    func hash(_ tile: GridPoint, _ salt: String) -> UInt64 {
        StableHash.mix(seed, UInt64(bitPattern: Int64(tile.x)), UInt64(bitPattern: Int64(tile.y)), StableHash.string(salt))
    }

    public func visual(for stats: StatValues, at tile: GridPoint) -> TileVisual {
        // Ground: highest-priority match.
        var groundID = SpriteRegistry.missingID
        if let rule = ground.first(where: { $0.condition.matches(stats) }), let sprites = rule.sprites, !sprites.isEmpty {
            groundID = sprites[Int(hash(tile, "g-" + rule.id) % UInt64(sprites.count))]
        }

        // Decorations: every matching rule may contribute, in priority order.
        var decos: [TileVisual.Decoration] = []
        for rule in decorations where decos.count < maxDecorations {
            guard rule.condition.matches(stats), let sprites = rule.sprites, !sprites.isEmpty else { continue }
            let h = hash(tile, "d-" + rule.id)
            guard StableHash.unit(h) < (rule.density ?? 1) else { continue }
            let sprite = sprites[Int((h >> 8) % UInt64(sprites.count))]
            // Spread multiple decorations around the tile; stay inside the diamond.
            let slot = decos.count
            let baseX = [0, -6, 6, 0][slot % 4]
            let baseY = [0, -1, 1, -3][slot % 4]
            let jx = Int((h >> 20) % 5) - 2
            let jy = Int((h >> 28) % 3) - 1
            decos.append(.init(sprite: sprite, offsetX: baseX + jx, offsetY: baseY + jy, flipped: (h >> 40) & 1 == 1))
        }

        // Tints: weighted blend of colors by stat strength.
        var r = 0.0, g = 0.0, b = 0.0, total = 0.0
        for rule in tints where rule.condition.matches(stats) {
            guard let stat = rule.stat, let c = RGBA(hex: rule.color ?? "") else { continue }
            let w = (stats[stat] ?? 0) / 100 * (rule.strength ?? 0.3)
            guard w > 0 else { continue }
            r += Double(c.r) * w; g += Double(c.g) * w; b += Double(c.b) * w; total += w
        }
        var tint: RGBA? = nil
        var amount = 0.0
        if total > 0.001 {
            tint = RGBA(UInt8(r / total), UInt8(g / total), UInt8(b / total))
            // Quantize so tiny stat changes don't churn the renderer.
            amount = (min(0.6, total) * 20).rounded() / 20
        }
        return TileVisual(ground: groundID, decorations: decos, tint: amount > 0 ? tint : nil, tintAmount: amount)
    }
}
