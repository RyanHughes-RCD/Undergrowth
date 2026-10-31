import Foundation

/// Computes tile stats directly from placement records and real timestamps.
/// Because everything is a closed-form function of time, "catching up" after
/// the app was closed is just evaluating at the current time.
public struct StatEngine {
    public let tuning: Tuning
    public init(tuning: Tuning) { self.tuning = tuning }

    /// Ramp level 0...1 while placed, decaying after removal.
    public func level(of p: Placement, at now: Date) -> Double {
        // Each creature ramps over its own time and fades over the same time.
        let ramp = max(1, p.rampSeconds ?? tuning.rampSecondsToFull)
        let decay = max(1, p.rampSeconds ?? tuning.decaySecondsToZero)
        func rampLevel(_ t: Date) -> Double {
            let dt = max(0, t.timeIntervalSince(p.placedAt))
            return min(1, p.startLevel + dt / ramp)
        }
        guard let removed = p.removedAt else { return rampLevel(now) }
        if now <= removed { return rampLevel(now) }
        let atRemoval = rampLevel(removed)
        return max(0, atRemoval - now.timeIntervalSince(removed) / decay)
    }

    /// When a removed placement will have fully decayed.
    public func fullyDecayedAt(_ p: Placement) -> Date? {
        guard let removed = p.removedAt else { return nil }
        let atRemoval = level(of: p, at: removed)
        return removed.addingTimeInterval(atRemoval * max(1, p.rampSeconds ?? tuning.decaySecondsToZero))
    }

    /// - Parameter clamp: false returns raw sums (may be negative) so callers can add more before clamping.
    public func stats(at tile: GridPoint, placements: [Placement], now: Date, clamp: Bool = true) -> StatValues {
        var out: StatValues = [:]
        for k in StatKey.core { out[k] = 0 }
        for p in placements {
            let lv = level(of: p, at: now)
            guard lv > 0 else { continue }
            let f = tuning.falloff.factor(distance: tile.distance(to: p.tile), radius: p.radius)
            guard f > 0 else { continue }
            for (k, v) in p.contributions { out[k, default: 0] += v * lv * f }
        }
        if clamp { for (k, v) in out { out[k] = min(tuning.statCap, max(0, v)) } }
        return out
    }

    public func field(size: GridSize, placements: [Placement], now: Date, clamp: Bool = true) -> StatField {
        var keys = StatKey.core
        for p in placements { for k in p.contributions.keys where !keys.contains(k) { keys.append(k) } }
        var field = StatField(size: size, keys: keys)
        let levels = placements.map { level(of: $0, at: now) }
        let cap = tuning.statCap
        for (pi, p) in placements.enumerated() where levels[pi] > 0 {
            let r = Int(tuning.falloff.reach(p.radius).rounded(.up))
            let minX = max(0, p.tile.x - r), maxX = min(size.width - 1, p.tile.x + r)
            let minY = max(0, p.tile.y - r), maxY = min(size.height - 1, p.tile.y + r)
            guard minX <= maxX, minY <= maxY else { continue }
            let contribs = p.contributions.map { (keys.firstIndex(of: $0.key)!, $0.value) }
            for y in minY...maxY {
                for x in minX...maxX {
                    let t = GridPoint(x, y)
                    let f = tuning.falloff.factor(distance: t.distance(to: p.tile), radius: p.radius)
                    guard f > 0 else { continue }
                    let o = field.offset(t)
                    for (ki, v) in contribs { field.values[o + ki] += v * levels[pi] * f }
                }
            }
        }
        if clamp { for i in field.values.indices { field.values[i] = min(cap, max(0, field.values[i])) } }
        return field
    }
}
