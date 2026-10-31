import Foundation

/// Saves the forest as versioned JSON. Writes are atomic; a save that fails to
/// decode is kept as a `.corrupt` backup instead of being overwritten silently.
public struct SaveStore {
    public let url: URL
    public init(url: URL) { self.url = url }

    public static func defaultURL() -> URL {
        let fm = FileManager.default
        let dir = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        return dir.appendingPathComponent("Undergrowth", isDirectory: true).appendingPathComponent("forest.json")
    }

    static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        e.outputFormatting = [.sortedKeys]
        return e
    }
    static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }

    public func save(_ state: ForestState) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try SaveStore.encoder.encode(state)
        try data.write(to: url, options: .atomic)
    }

    public func load() -> ForestState? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return SaveStore.migrate(try SaveStore.decoder.decode(ForestState.self, from: data))
        } catch {
            let backup = url.appendingPathExtension("corrupt")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: url, to: backup)
            return nil
        }
    }

    /// Upgrade older save versions here as the format evolves.
    static func migrate(_ state: ForestState) -> ForestState {
        var s = state
        if s.version < ForestState.currentVersion { s.version = ForestState.currentVersion }
        return s
    }
}
