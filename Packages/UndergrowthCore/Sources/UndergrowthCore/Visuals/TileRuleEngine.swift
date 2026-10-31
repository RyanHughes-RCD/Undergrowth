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
    public struct Overlay: Hashable {
        public var sprite: String
        public var flipped: Bool
    }
    public var ground: String
    /// Stacked full-tile layers, bottom first.
    public var overlays: [Overlay]
    public var decorations: [Decoration]
    /// Blended tint color and strength (0...1).
    public var tint: RGBA?
    public var tintAmount: Double
}

/// Turns tile stats into sprite ids using the data-driven rules in `tileRules.json`.
/// Nothing here knows about specific biomes: blends emerge from overlapping stats.
public struct TileRuleEngine {
    public let ground: [TileRule]
    /// Overlay rules grouped by family, families in draw order, rules by priority.
    public let overlayGroups: [[TileRule]]
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
        var groupOrder: [String] = []
        for r in rules where r.layer == .overlay {
            let g = r.group ?? r.id
            if !groupOrder.contains(g) { groupOrder.append(g) }
        }
        overlayGroups = groupOrder.map { g in sorted.filter { $0.layer == .overlay && ($0.group ?? $0.id) == g } }
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
        let groundRule = ground.first(where: { $0.condition.matches(stats) })
        if let rule = groundRule, let sprites = rule.sprites, !sprites.isEmpty {
            groundID = sprites[Int(hash(tile, "g-" + rule.id) % UInt64(sprites.count))]
        }

        // Overlays: one per family (its strongest matching level), stacked.
        var overlays: [TileVisual.Overlay] = []
        if groundRule?.suppressOverlays != true {
            for family in overlayGroups {
                guard let rule = family.first(where: { $0.condition.matches(stats) }),
                      let sprites = rule.sprites, !sprites.isEmpty else { continue }
                let h = hash(tile, "o-" + (rule.group ?? rule.id))
                overlays.append(.init(sprite: sprites[Int(h % UInt64(sprites.count))], flipped: (h >> 32) & 1 == 1))
            }
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
        return TileVisual(ground: groundID, overlays: overlays, decorations: decos, tint: amount > 0 ? tint : nil, tintAmount: amount)
    }

    /// Look of a decorative tile outside the map (a forest edge that gets denser further out).
    public func edgeVisual(at p: GridPoint, size: GridSize, edge: Tuning.EdgeTuning) -> TileVisual {
        let dx = max(0, -p.x, p.x - (size.width - 1))
        let dy = max(0, -p.y, p.y - (size.height - 1))
        let d = Double(max(dx, dy))
        let h = hash(p, "edge")
        let ground = edge.ground.isEmpty ? SpriteRegistry.missingID : edge.ground[Int(h % UInt64(edge.ground.count))]
        var decos: [TileVisual.Decoration] = []
        let density = min(edge.maxDensity, edge.baseDensity + edge.densityPerTile * (d - 1))
        if !edge.decorations.isEmpty, StableHash.unit(StableHash.mix(h, 1)) < density {
            let h2 = StableHash.mix(h, 2)
            decos.append(.init(sprite: edge.decorations[Int(h2 % UInt64(edge.decorations.count))],
                               offsetX: Int((h2 >> 16) % 5) - 2, offsetY: Int((h2 >> 24) % 3) - 1,
                               flipped: (h2 >> 40) & 1 == 1))
        }
        return TileVisual(ground: ground, overlays: [], decorations: decos, tint: nil, tintAmount: 0)
    }
}
