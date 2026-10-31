import Foundation

/// 8-bit RGBA color.
public struct RGBA: Hashable, Codable {
    public var r: UInt8, g: UInt8, b: UInt8, a: UInt8
    public init(_ r: UInt8, _ g: UInt8, _ b: UInt8, _ a: UInt8 = 255) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
    public static let clear = RGBA(0, 0, 0, 0)

    /// Parses "#RRGGBB", "#RRGGBBAA" or "transparent".
    public init?(hex: String) {
        let s = hex.trimmingCharacters(in: .whitespaces).lowercased()
        if s == "transparent" || s == "clear" { self = .clear; return }
        guard s.hasPrefix("#") else { return nil }
        let digits = String(s.dropFirst())
        guard digits.count == 6 || digits.count == 8, let v = UInt64(digits, radix: 16) else { return nil }
        if digits.count == 6 {
            self.init(UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF), 255)
        } else {
            self.init(UInt8((v >> 24) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF))
        }
    }

    public var hex: String {
        a == 255 ? String(format: "#%02x%02x%02x", r, g, b) : String(format: "#%02x%02x%02x%02x", r, g, b, a)
    }
}

/// Characters used to encode palette indices in sprite rows. `.` is an alias for 0 (transparent).
public enum PixelAlphabet {
    public static let chars: [Character] = Array("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    public static var maxColors: Int { chars.count }
    private static let lookup: [Character: Int] = {
        var m: [Character: Int] = ["." : 0]
        for (i, c) in chars.enumerated() { m[c] = i }
        return m
    }()
    public static func index(of c: Character) -> Int? { lookup[c] }
    public static func char(for index: Int) -> Character { index == 0 ? "." : chars[index] }
}

public struct SpriteFrame: Codable, Hashable {
    /// Seconds this frame is shown (animation). Defaults to 0.25.
    public var duration: Double?
    /// One string per row, one character per pixel, characters are palette indices.
    public var rows: [String]
    public init(duration: Double? = nil, rows: [String]) { self.duration = duration; self.rows = rows }
}

/// A sprite stored entirely as data: palette + grid of palette indices, with frames.
public struct SpriteData: Codable, Hashable, Identifiable {
    public var id: String
    /// [width, height] in art pixels.
    public var size: [Int]
    /// Anchor point in pixel-edge coordinates from the top-left. For objects this is
    /// usually the bottom-center ("feet"); for ground tiles, the diamond center.
    /// Defaults to bottom-center.
    public var anchor: [Double]?
    /// Inline palette. Index 0 should be "transparent".
    public var palette: [String]?
    /// Or a reference to a shared palette by id.
    public var paletteRef: String?
    public var frames: [SpriteFrame]
    public var tags: [String]?

    public init(id: String, size: [Int], anchor: [Double]? = nil, palette: [String]? = nil,
                paletteRef: String? = nil, frames: [SpriteFrame], tags: [String]? = nil) {
        self.id = id; self.size = size; self.anchor = anchor; self.palette = palette
        self.paletteRef = paletteRef; self.frames = frames; self.tags = tags
    }

    public var width: Int { size.count > 0 ? size[0] : 0 }
    public var height: Int { size.count > 1 ? size[1] : 0 }
    public var anchorPoint: (x: Double, y: Double) {
        if let a = anchor, a.count == 2 { return (a[0], a[1]) }
        return (Double(width) / 2, Double(height))
    }

    /// Palette index at (x, y) in a frame; 0 for out-of-range or unknown characters.
    public func index(frame: Int, x: Int, y: Int) -> Int {
        guard frames.indices.contains(frame) else { return 0 }
        let rows = frames[frame].rows
        guard y >= 0, y < rows.count else { return 0 }
        let row = rows[y]
        guard x >= 0, x < row.count else { return 0 }
        let c = row[row.index(row.startIndex, offsetBy: x)]
        return PixelAlphabet.index(of: c) ?? 0
    }

    /// Structural problems with this sprite (for validation and the future editor).
    public func problems() -> [String] {
        var out: [String] = []
        if size.count != 2 || width <= 0 || height <= 0 { out.append("\(id): bad size \(size)") }
        if frames.isEmpty { out.append("\(id): no frames") }
        if palette == nil && paletteRef == nil { out.append("\(id): no palette or paletteRef") }
        for (fi, f) in frames.enumerated() {
            if f.rows.count != height { out.append("\(id) frame \(fi): \(f.rows.count) rows, expected \(height)") }
            for (ri, r) in f.rows.enumerated() where r.count != width {
                out.append("\(id) frame \(fi) row \(ri): \(r.count) px, expected \(width)")
            }
            for r in f.rows {
                for c in r where PixelAlphabet.index(of: c) == nil {
                    out.append("\(id) frame \(fi): invalid pixel character '\(c)'")
                    break
                }
            }
        }
        return out
    }
}

public struct PaletteData: Codable, Hashable, Identifiable {
    public var id: String
    public var colors: [String]
}

/// Tightly packed RGBA8 pixels, top row first.
public struct PixelBuffer {
    public var width: Int
    public var height: Int
    public var bytes: [UInt8]
}
