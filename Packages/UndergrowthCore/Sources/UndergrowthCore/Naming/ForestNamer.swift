import Foundation

/// Builds a forest name from its dominant stats, e.g. "Misty Hollow of Glowing Caps".
public struct ForestNamer {
    public let parts: NameParts
    public let tuning: Tuning.NamingTuning
    public init(parts: NameParts, tuning: Tuning.NamingTuning) { self.parts = parts; self.tuning = tuning }

    func pick(_ list: [String], _ seed: UInt64, _ salt: String) -> String? {
        guard !list.isEmpty else { return nil }
        let h = StableHash.mix(seed, StableHash.string(salt))
        return list[Int(h % UInt64(list.count))]
    }

    /// - Parameter means: forest-wide average of each stat.
    public func name(means: StatValues, seed: UInt64) -> String {
        let ranked = means.filter { parts.stats[$0.key] != nil }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        guard let top = ranked.first, top.value >= tuning.quietThreshold else {
            return pick(parts.quietNames, seed, "quiet") ?? "Quiet Clearing"
        }
        let featured = ranked.filter { $0.value >= max(tuning.quietThreshold, top.value * tuning.featureFraction) }
        let first = featured[0].key
        let adjective = pick(parts.stats[first]?.adjectives ?? [], seed, "adj-\(first)") ?? ""

        // The place noun comes from the second stat if it's strong enough, else the first.
        let placeStat = featured.count > 1 ? featured[1].key : first
        let place = pick(parts.stats[placeStat]?.places ?? [], seed, "place-\(placeStat)")
            ?? pick(parts.defaultPlaces, seed, "place") ?? "Wood"

        var name = "\(adjective) \(place)".trimmingCharacters(in: .whitespaces)
        if featured.count > 2, let phrase = pick(parts.stats[featured[2].key]?.phrases ?? [], seed, "phrase-\(featured[2].key)") {
            name += " of \(phrase)"
        }
        return name
    }
}
