import Foundation

/// Options for turning sprite data into pixels.
public struct RenderVariant: Hashable {
    /// Palette index → replacement color (glimmer recolors etc).
    public var paletteSwap: [Int: RGBA]
    /// If set, every opaque pixel is drawn in this color (Field Guide silhouettes).
    public var silhouette: RGBA?

    public init(paletteSwap: [Int: RGBA] = [:], silhouette: RGBA? = nil) {
        self.paletteSwap = paletteSwap; self.silhouette = silhouette
    }
    public static let normal = RenderVariant()

    /// Builds a swap from JSON-style `{"2": "#ff00ff"}`.
    public static func swap(_ dict: [String: String]?) -> RenderVariant {
        var m: [Int: RGBA] = [:]
        for (k, v) in dict ?? [:] {
            if let i = Int(k), let c = RGBA(hex: v) { m[i] = c }
        }
        return RenderVariant(paletteSwap: m)
    }
}

/// Central registry: every creature, item, tile and decoration references its
/// art by sprite id. Later registrations override earlier ones, so user-made
/// sprites can replace or extend the bundled set.
public final class SpriteRegistry {
    public private(set) var sprites: [String: SpriteData] = [:]
    public private(set) var palettes: [String: PaletteData] = [:]

    public static let missingID = "__missing"

    public init() {
        register(SpriteRegistry.makeMissingSprite())
    }

    public func register(_ sprite: SpriteData) { sprites[sprite.id] = sprite }
    public func register(_ palette: PaletteData) { palettes[palette.id] = palette }

    public func contains(_ id: String) -> Bool { sprites[id] != nil }

    /// Returns the sprite, or a visible magenta "missing" sprite.
    public func sprite(_ id: String) -> SpriteData {
        sprites[id] ?? sprites[SpriteRegistry.missingID]!
    }

    public func resolvedPalette(for sprite: SpriteData) -> [RGBA] {
        let strings = sprite.palette ?? (sprite.paletteRef.flatMap { palettes[$0]?.colors }) ?? ["transparent", "#ff00ff"]
        return strings.map { RGBA(hex: $0) ?? RGBA(255, 0, 255) }
    }

    /// Decodes one frame into RGBA pixels.
    public func pixels(_ id: String, frame: Int = 0, variant: RenderVariant = .normal) -> PixelBuffer {
        let s = sprite(id)
        var palette = resolvedPalette(for: s)
        for (i, c) in variant.paletteSwap where i >= 0 {
            if i < palette.count { palette[i] = c }
        }
        let w = s.width, h = s.height
        var bytes = [UInt8](repeating: 0, count: max(0, w * h * 4))
        for y in 0..<h {
            for x in 0..<w {
                let idx = s.index(frame: frame, x: x, y: y)
                guard idx > 0, idx < palette.count else { continue }
                var c = palette[idx]
                if c.a == 0 { continue }
                if let sil = variant.silhouette { c = sil }
                let o = (y * w + x) * 4
                bytes[o] = c.r; bytes[o + 1] = c.g; bytes[o + 2] = c.b; bytes[o + 3] = c.a
            }
        }
        return PixelBuffer(width: w, height: h, bytes: bytes)
    }

    static func makeMissingSprite() -> SpriteData {
        let rows = [
            "11111111",
            "12222221",
            "12211221",
            "12221221",
            "12212221",
            "12222221",
            "12212221",
            "11111111",
        ]
        return SpriteData(id: missingID, size: [8, 8], anchor: [4, 8],
                          palette: ["transparent", "#1a001a", "#ff00ff"],
                          frames: [SpriteFrame(rows: rows)])
    }
}
