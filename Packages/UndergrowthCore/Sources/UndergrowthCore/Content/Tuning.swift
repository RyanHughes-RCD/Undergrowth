import Foundation

/// Every global tuning number in the game. Loaded from `Resources/tuning.json`.
/// Per-species and per-item numbers live in the content files (imported from the spawn table).
public struct Tuning: Codable {
    public var grid: GridSize
    public var placementSlots: Int
    public var starterCreatures: [String]
    public var statCap: Double
    /// Fallback ramp time for creatures without their own `rampHours`.
    public var rampSecondsToFull: Double
    /// Fallback decay time (creatures decay over their own ramp time by default).
    public var decaySecondsToZero: Double
    public var falloff: Falloff
    public var glimmerChance: Double
    public var creatureRoll: CreatureRoll?
    /// Legacy per-type trait ranges (pre-spawn-table content). Optional.
    public var creatureTraits: [String: CreatureTraitProfile]?
    public var spawns: SpawnTuning
    public var seeds: SeedTuning
    /// Used when picking from item groups (e.g. what plant a Mystery Seed becomes).
    public var rarityWeights: [String: Double]
    /// Pity thresholds: after this many misses in a row the next roll is guaranteed.
    public var pity: [String: Int]
    public var visuals: VisualTuning
    public var naming: NamingTuning
    public var clock: ClockTuning?
    public var wanderers: WandererTuning?
    public var debugTools: Bool

    public func rarityWeight(_ r: Rarity) -> Double { rarityWeights[r.rawValue] ?? 1 }
    public var roll: CreatureRoll { creatureRoll ?? CreatureRoll(bonusRange: NumRange(0.6, 1), glimmerBonusMult: 1.5, glimmerRadiusBonus: 1) }
    public var clockSettings: ClockTuning { clock ?? ClockTuning(nightStartHour: 20, nightEndHour: 6, rainChance: 0.25, weatherBlockHours: 2) }

    public struct Falloff: Codable {
        /// "linear" or "smoothstep"
        public var curve: String
        /// Fraction of the reach that receives full strength before falloff starts.
        public var innerRadiusFraction: Double
        /// Influence reaches `radius + radiusPadding` tiles, so a radius-1 creature
        /// still touches its neighbours. Default 0.
        public var radiusPadding: Double?

        /// Strength multiplier at `distance` from a source with `radius`.
        public func factor(distance: Double, radius: Double) -> Double {
            let reach = radius + (radiusPadding ?? 0)
            guard reach > 0, distance < reach else { return 0 }
            let inner = reach * max(0, min(1, innerRadiusFraction))
            if distance <= inner { return 1 }
            let t = 1 - (distance - inner) / max(0.0001, reach - inner)
            switch curve {
            case "linear": return t
            default: return t * t * (3 - 2 * t)
            }
        }
        public func reach(_ radius: Double) -> Double { radius + (radiusPadding ?? 0) }
    }

    public struct CreatureRoll: Codable {
        /// Each creature rolls this fraction of its species' maximum bonuses.
        public var bonusRange: NumRange
        public var glimmerBonusMult: Double
        public var glimmerRadiusBonus: Double
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
        /// Default lifetime of a wild spawn (items can override with `lifetimeHours`).
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

    public struct ClockTuning: Codable {
        /// Night runs from this local hour...
        public var nightStartHour: Int
        /// ...until this one.
        public var nightEndHour: Int
        /// Chance that any weather block is rainy.
        public var rainChance: Double
        public var weatherBlockHours: Double
    }

    public struct WandererTuning: Codable {
        /// How many missed daily checks are replayed when the app reopens.
        public var maxCatchUpDays: Int
    }
}
