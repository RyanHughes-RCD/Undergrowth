import Foundation

// MARK: - StatKey

/// A tile stat. Stats are string-keyed so data files (and future custom
/// creatures) can name new stats without code changes. The six core stats
/// are provided as constants.
public struct StatKey: RawRepresentable, Hashable, Codable, Comparable, CustomStringConvertible, CodingKeyRepresentable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(_ raw: String) { self.rawValue = raw }

    public static let damp = StatKey("damp")
    public static let glow = StatKey("glow")
    public static let bloom = StatKey("bloom")
    public static let verdure = StatKey("verdure")
    public static let stone = StatKey("stone")
    public static let depth = StatKey("depth")

    /// Display order for the six core stats.
    public static let core: [StatKey] = [.damp, .glow, .bloom, .verdure, .stone, .depth]

    public var description: String { rawValue }
    public var displayName: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }

    public static func < (a: StatKey, b: StatKey) -> Bool { a.rawValue < b.rawValue }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }

    // Lets `[StatKey: X]` encode as a JSON object rather than an array.
    public var codingKey: CodingKey { AnyCodingKey(rawValue) }
    public init?<T: CodingKey>(codingKey: T) { self.rawValue = codingKey.stringValue }
}

public struct AnyCodingKey: CodingKey {
    public var stringValue: String
    public var intValue: Int? { nil }
    public init(_ s: String) { stringValue = s }
    public init?(stringValue: String) { self.stringValue = stringValue }
    public init?(intValue: Int) { return nil }
}

public typealias StatValues = [StatKey: Double]

// MARK: - Grid

public struct GridPoint: Hashable, Codable, CustomStringConvertible {
    public var x: Int
    public var y: Int
    public init(_ x: Int, _ y: Int) { self.x = x; self.y = y }
    public init(x: Int, y: Int) { self.x = x; self.y = y }

    public func distance(to o: GridPoint) -> Double {
        let dx = Double(x - o.x), dy = Double(y - o.y)
        return (dx * dx + dy * dy).squareRoot()
    }
    public var description: String { "(\(x),\(y))" }
}

public struct GridSize: Codable, Hashable {
    public var width: Int
    public var height: Int
    public init(width: Int, height: Int) { self.width = width; self.height = height }
    public func contains(_ p: GridPoint) -> Bool { p.x >= 0 && p.y >= 0 && p.x < width && p.y < height }
    public var count: Int { width * height }
}

// MARK: - Ranges & bounds

/// A numeric range written in JSON as `[lo, hi]`.
public struct NumRange: Codable, Hashable {
    public var lo: Double
    public var hi: Double
    public init(_ lo: Double, _ hi: Double) { self.lo = lo; self.hi = hi }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let single = try? c.decode(Double.self) {
            lo = single; hi = single
            return
        }
        let arr = try c.decode([Double].self)
        guard arr.count == 2 else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Range must be [lo, hi]")
        }
        lo = min(arr[0], arr[1]); hi = max(arr[0], arr[1])
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode([lo, hi])
    }

    public func random<G: RandomNumberGenerator>(using rng: inout G) -> Double {
        hi <= lo ? lo : Double.random(in: lo...hi, using: &rng)
    }
    public func randomInt<G: RandomNumberGenerator>(using rng: inout G) -> Int {
        let a = Int(lo.rounded()), b = Int(hi.rounded())
        return b <= a ? a : Int.random(in: a...b, using: &rng)
    }
}

/// `{ "min": 30, "max": 80 }` — either side optional.
public struct StatBound: Codable, Hashable {
    public var min: Double?
    public var max: Double?
    public init(min: Double? = nil, max: Double? = nil) { self.min = min; self.max = max }
    public func matches(_ v: Double) -> Bool {
        if let mn = min, v < mn { return false }
        if let mx = max, v > mx { return false }
        return true
    }
}

/// A set of stat requirements. `all` must all hold; if `any` is present,
/// at least one of its groups must also fully hold.
public struct StatCondition: Codable, Hashable {
    public var all: [StatKey: StatBound]
    public var any: [[StatKey: StatBound]]?
    public init(all: [StatKey: StatBound] = [:], any: [[StatKey: StatBound]]? = nil) {
        self.all = all; self.any = any
    }
    public static func check(_ group: [StatKey: StatBound], _ stats: StatValues) -> Bool {
        group.allSatisfy { key, bound in bound.matches(stats[key] ?? 0) }
    }
    public func matches(_ stats: StatValues) -> Bool {
        guard StatCondition.check(all, stats) else { return false }
        if let any, !any.isEmpty {
            return any.contains { StatCondition.check($0, stats) }
        }
        return true
    }
}

// MARK: - Rarity

public enum Rarity: String, Codable, CaseIterable, Comparable {
    case common, uncommon, rare, veryRare, legendary
    var order: Int { Rarity.allCases.firstIndex(of: self)! }
    public static func < (a: Rarity, b: Rarity) -> Bool { a.order < b.order }
    public var displayName: String {
        switch self {
        case .veryRare: return "Very rare"
        default: return rawValue.capitalized
        }
    }
    /// The next tier up (for gem upgrades).
    public var next: Rarity? {
        let all = Rarity.allCases
        let i = all.firstIndex(of: self)!
        return i + 1 < all.count ? all[i + 1] : nil
    }
}

// MARK: - RNG

/// Small, fast, seedable, Codable RNG so randomness is reproducible and
/// can be saved alongside the forest.
public struct SeededRNG: RandomNumberGenerator, Codable, Hashable {
    public var state: UInt64
    public init(seed: UInt64) { state = seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    public mutating func chance(_ p: Double) -> Bool {
        p >= 1 ? true : (p <= 0 ? false : Double.random(in: 0..<1, using: &self) < p)
    }
}

/// Deterministic hash (Swift's `Hasher` is randomly seeded per launch,
/// which would make tile decorations shuffle every run).
public enum StableHash {
    public static func mix(_ values: UInt64...) -> UInt64 {
        var h: UInt64 = 0xCBF2_9CE4_8422_2325
        for v in values {
            h ^= v
            h = h &* 0x100_0000_01B3
            h ^= h >> 29
        }
        h = (h ^ (h >> 33)) &* 0xFF51_AFD7_ED55_8CCD
        h = (h ^ (h >> 33)) &* 0xC4CE_B9FE_1A85_EC53
        return h ^ (h >> 33)
    }
    public static func string(_ s: String) -> UInt64 {
        var h: UInt64 = 0xCBF2_9CE4_8422_2325
        for b in s.utf8 { h ^= UInt64(b); h = h &* 0x100_0000_01B3 }
        return h
    }
    /// Uniform double in [0, 1).
    public static func unit(_ h: UInt64) -> Double {
        Double(h >> 11) / Double(1 << 53)
    }
}

public func weightedPick<T, G: RandomNumberGenerator>(_ items: [(T, Double)], using rng: inout G) -> T? {
    let total = items.reduce(0) { $0 + max(0, $1.1) }
    guard total > 0 else { return nil }
    var r = Double.random(in: 0..<total, using: &rng)
    for (item, w) in items where w > 0 {
        if r < w { return item }
        r -= w
    }
    return items.last(where: { $0.1 > 0 })?.0
}
