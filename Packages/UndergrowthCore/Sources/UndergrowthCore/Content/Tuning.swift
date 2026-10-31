import Foundation

/// Every tuning number in the game. Loaded from `Resources/tuning.json`.
public struct Tuning: Codable {
    public var grid: GridSize
    public var placementSlots: Int
    public var starterCreatures: [String]
    public var statCap: Double
    /// Seconds for a newly placed creature to ramp from 0 to its full contribution.
    public var rampSecondsToFull: Double
    /// Seconds for a removed creature's contribution to decay from full to 0.
    public var decaySecondsToZero: Double
    public var falloff: Falloff
    public var glimmerChance: Double
    /// Trait ranges per creature type id.
    public var creatureTraits: [String: CreatureTraitProfile]
    public var spawns: SpawnTuning
    public var seeds: SeedTuning
    public var rarityWeights: [String: Double]
    /// Pity thresholds: after this many misses in a row the next roll is guaranteed.
    public var pity: [String: Int]
    public var visuals: VisualTuning
    public var naming: NamingTuning
    public var debugTools: Bool

    public func rarityWeight(_ r: Rarity) -> Double { rarityWeights[r.rawValue] ?? 1 }

    public struct Falloff: Codable {
        /// "linear" or "smoothstep"
        public var curve: String
        /// Fraction of the radius that receives full strength before falloff starts.
        public var innerRadiusFraction: Double

        /// Strength multiplier at `distance` from a source with `radius`.
        public func factor(distance: Double, radius: Double) -> Double {
            guard radius > 0, distance <= radius else { return 0 }
            let inner = radius * max(0, min(1, innerRadiusFraction))
            if distance <= inner { return 1 }
            let t = 1 - (distance - inner) / max(0.0001, radius - inner) // 1 at inner edge → 0 at radius
            switch curve {
            case "linear": return t
            default: return t * t * (3 - 2 * t)
            }
        }
    }

    public struct CreatureTraitProfile: Codable {
        public var contribution: [StatKey: NumRange]
        public var radius: NumRange
        public var glimmer: GlimmerProfile
    }

    public struct GlimmerProfile: Codable {
        public var contributionMult: Double
        public var radiusBonus: Double
    }

    public struct SpawnTuning: Codable {
        public var tickSeconds: Double
        public var attemptsPerTick: Int
        public var spawnChance: Double
        public var maxTotal: Int
        public var lifetimeSeconds: Double
        public var maxCatchUpTicks: Int
    }

    public struct SeedTuning: Codable {
        public var growSeconds: NumRange
    }

    public struct VisualTuning: Codable {
        public var maxDecorationsPerTile: Int
        public var refreshSeconds: Double
        /// Decorative forest drawn beyond the map edge so the view never shows a void.
        public var edge: EdgeTuning?
        /// How far (in tiles) inside the map the camera centre must stay.
        public var cameraMarginTiles: Double?
        /// Time multipliers offered by the debug speed control.
        public var debugSpeeds: [Double]?
    }

    public struct EdgeTuning: Codable {
        public var ground: [String]
        public var decorations: [String]
        public var baseDensity: Double
        public var densityPerTile: Double
        public var maxDensity: Double
    }

    public struct NamingTuning: Codable {
        /// If the strongest stat's forest-wide average is below this, the forest is "quiet".
        public var quietThreshold: Double
        /// A stat must be at least this fraction of the top stat to feature in the name.
        public var featureFraction: Double
    }
}
