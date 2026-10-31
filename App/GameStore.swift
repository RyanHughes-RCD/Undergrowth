import Foundation
import SwiftUI
import UndergrowthCore

enum InteractionMode: Equatable {
    case browse
    case placeCreature(UUID)
    case plantSeed(String)
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let text: String
    var spriteID: String?
}

/// A creature found by the player, shown as a celebratory card.
struct CreatureReveal: Identifiable, Equatable {
    let id = UUID()
    let creature: CreatureInstance
    let isNew: Bool
    let source: String
}

/// App-side owner of the game: wraps the core `Game`, drives the clock,
/// saves, and publishes changes to SwiftUI and the SpriteKit scene.
@MainActor
final class GameStore: ObservableObject {
    let content: ContentDatabase
    private(set) var game: Game
    let textures: TextureCache
    private let saveStore: SaveStore

    /// Bumped whenever game state changes; views and the scene observe it.
    @Published private(set) var revision = 0
    @Published var mode: InteractionMode = .browse
    @Published var toast: Toast?
    @Published var reveal: CreatureReveal?
    @Published var selectedTile: GridPoint?
    @Published var selectedCreatureID: UUID?
    @Published var showStatOverlay = false
    @Published var crackingItemID: String?

    private var timer: Timer?
    private var saveTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init(content: ContentDatabase, saveStore: SaveStore) {
        self.content = content
        self.saveStore = saveStore
        self.textures = TextureCache(registry: content.sprites)
        let real = Date()
        if let saved = saveStore.load() {
            game = Game(content: content, state: saved)
        } else {
            game = Game.newForest(content: content, now: real)
        }
        let report = game.advance(to: game.now(real))
        if report.spawned > 0, report.ticks > 2 {
            showToast("While you were away, \(report.spawned) new thing\(report.spawned == 1 ? "" : "s") appeared.")
        }
        startClock()
    }

    /// Loads bundled content plus any user content folder (future sprite editor output).
    static func loadContent() throws -> ContentDatabase {
        guard let bundled = Bundle.main.url(forResource: "Resources", withExtension: nil) else {
            throw NSError(domain: "Undergrowth", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Resources folder missing from app bundle"])
        }
        var roots = [bundled]
        let fm = FileManager.default
        if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
            let user = docs.appendingPathComponent("UserContent", isDirectory: true)
            if fm.fileExists(atPath: user.path) { roots.append(user) }
        }
        let db = try ContentDatabase.load(roots: roots)
        #if DEBUG
        let issues = db.validate()
        if !issues.isEmpty { print("⚠️ Content issues:\n" + issues.joined(separator: "\n")) }
        #endif
        return db
    }

    // MARK: Clock

    var now: Date { game.now() }
    var tuning: Tuning { content.tuning }
    var state: ForestState { game.state }

    private func startClock() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: max(1, tuning.visuals.refreshSeconds), repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    func tick() {
        game.advance(to: now)
        changed(save: false)
    }

    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            let before = state.lastUpdated
            let report = game.advance(to: now)
            if report.spawned > 0, now.timeIntervalSince(before) > 600 {
                showToast("While you were away, \(report.spawned) new thing\(report.spawned == 1 ? "" : "s") appeared.")
            }
            startClock()
            changed()
        case .background, .inactive:
            timer?.invalidate()
            saveNow()
        @unknown default:
            break
        }
    }

    // MARK: Changes & saving

    func changed(save: Bool = true) {
        revision &+= 1
        if save { scheduleSave() }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    func saveNow() {
        do { try saveStore.save(game.state) }
        catch { print("Save failed: \(error)") }
    }

    // MARK: Feedback

    func showToast(_ text: String, sprite: String? = nil) {
        toast = Toast(text: text, spriteID: sprite)
        toastTask?.cancel()
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { self?.toast = nil }
        }
    }

    func present(_ results: [LootResult], source: String) {
        var lines: [String] = []
        var sprite: String?
        for r in results {
            switch r {
            case .item(let id, let count, let isNew):
                let def = content.items[id]
                sprite = sprite ?? def?.sprite
                lines.append("+\(count) \(def?.name ?? id)\(isNew ? " · New!" : "")")
            case .creature(let c, let isNew):
                reveal = CreatureReveal(creature: c, isNew: isNew, source: source)
            }
        }
        if !lines.isEmpty { showToast(lines.joined(separator: "   "), sprite: sprite) }
    }

    // MARK: Lookups

    func creatureDef(_ c: CreatureInstance) -> CreatureDef? { content.creatures[c.typeID] }

    func displayName(_ c: CreatureInstance) -> String {
        c.nickname ?? (creatureDef(c)?.name ?? c.typeID)
    }

    /// Sprite id + variant for a creature (glimmers use their own sprite or a palette swap).
    func art(for c: CreatureInstance) -> (String, RenderVariant) {
        guard let def = creatureDef(c) else { return (SpriteRegistry.missingID, .normal) }
        if c.isGlimmer {
            if let g = def.glimmerSprite { return (g, .normal) }
            return (def.sprite, .swap(def.glimmerPaletteSwap))
        }
        return (def.sprite, .normal)
    }

    func art(forCreatureType def: CreatureDef, glimmer: Bool) -> (String, RenderVariant) {
        if glimmer {
            if let g = def.glimmerSprite { return (g, .normal) }
            return (def.sprite, .swap(def.glimmerPaletteSwap))
        }
        return (def.sprite, .normal)
    }

    func rampLevel(for c: CreatureInstance) -> Double? {
        game.activePlacement(for: c.id).map { game.level(of: $0, at: now) }
    }

    var forestName: String { game.forestName }

    // MARK: Actions

    func handleTap(tile: GridPoint) {
        guard state.size.contains(tile) else { return }
        switch mode {
        case .placeCreature(let id):
            do {
                try game.place(creatureID: id, at: tile, now: now)
                mode = .browse
                if let c = state.creature(id) {
                    showToast("\(displayName(c)) settles in. Its influence will grow over the next few hours.",
                              sprite: art(for: c).0)
                }
                selectedCreatureID = nil
                changed()
            } catch {
                showToast("\(error)")
            }
        case .plantSeed(let itemID):
            do {
                try game.plantSeed(itemID: itemID, at: tile, now: now)
                if state.inventory[itemID, default: 0] == 0 { mode = .browse }
                showToast("Planted. Check back in a little while.", sprite: content.items[itemID]?.growthSprites?.first)
                changed()
            } catch {
                showToast("\(error)")
            }
        case .browse:
            if let p = game.creatureAt(tile) {
                selectedTile = nil
                selectedCreatureID = p.creatureID
            } else if let spawn = game.spawnAt(tile) {
                collect(spawn)
            } else if let seed = game.seedAt(tile) {
                harvest(seed)
            } else {
                selectedCreatureID = nil
                selectedTile = (selectedTile == tile) ? nil : tile
            }
        }
    }

    private func collect(_ spawn: WildSpawn) {
        do {
            let results = try game.collect(spawnID: spawn.id, now: now)
            present(results, source: "a \(content.items[spawn.itemID]?.name ?? "mushroom")")
            changed()
        } catch {
            showToast("\(error)")
        }
    }

    private func harvest(_ seed: PlantedSeed) {
        guard seed.isReady(at: now) else {
            let pct = Int(seed.progress(at: now) * 100)
            let remaining = seed.plantedAt.addingTimeInterval(seed.growSeconds).timeIntervalSince(now)
            showToast("Growing… \(pct)% (about \(Self.duration(remaining)) left)")
            return
        }
        do {
            let results = try game.harvestSeed(id: seed.id, now: now)
            present(results, source: "a sprouting seed")
            changed()
        } catch {
            showToast("\(error)")
        }
    }

    func beginPlacing(_ creatureID: UUID) {
        guard game.freeSlotCount > 0 else {
            showToast(GameError.noFreeSlot.description)
            return
        }
        selectedTile = nil
        selectedCreatureID = nil
        mode = .placeCreature(creatureID)
    }

    func beginPlanting(_ itemID: String) {
        selectedTile = nil
        selectedCreatureID = nil
        mode = .plantSeed(itemID)
    }

    func recall(_ creatureID: UUID) {
        do {
            try game.recall(creatureID: creatureID, now: now)
            if let c = state.creature(creatureID) {
                showToast("\(displayName(c)) heads back to the Burrow. The land will slowly settle.")
            }
            selectedCreatureID = nil
            changed()
        } catch {
            showToast("\(error)")
        }
    }

    func rename(_ creatureID: UUID, to name: String) {
        game.rename(creatureID: creatureID, to: name)
        changed()
    }

    func renameForest(_ name: String?) {
        game.renameForest(name)
        changed()
    }

    /// Cracks a rough rock. Returns results for the reveal animation.
    func crack(_ itemID: String) -> [LootResult] {
        do {
            let results = try game.crack(itemID: itemID, now: now)
            changed()
            return results
        } catch {
            showToast("\(error)")
            return []
        }
    }

    // MARK: Debug

    func debugSkip(hours: Double) {
        game.debugSkip(seconds: hours * 3600)
        let report = game.advance(to: now)
        showToast("Skipped \(Self.duration(hours * 3600)). \(report.spawned) new spawn\(report.spawned == 1 ? "" : "s").")
        changed()
    }

    func debugResetForest() {
        game = Game.newForest(content: content, now: Date())
        mode = .browse
        selectedTile = nil
        selectedCreatureID = nil
        showToast("A fresh forest.")
        changed()
        saveNow()
    }

    func debugGive(_ itemID: String, count: Int = 3) {
        game.debugGrant(itemID: itemID, count: count)
        showToast("+\(count) \(content.items[itemID]?.name ?? itemID)")
        changed()
    }

    func debugGiveCreature(_ typeID: String, glimmer: Bool) {
        let r = game.debugGrantCreature(typeID: typeID, glimmer: glimmer, now: now)
        present(r, source: "the debug menu")
        changed()
    }

    // MARK: Formatting

    static func duration(_ seconds: Double) -> String {
        let s = max(0, Int(seconds))
        if s < 60 { return "\(s)s" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86400 { return "\(s / 3600)h \(s % 3600 / 60)m" }
        return "\(s / 86400)d \(s % 86400 / 3600)h"
    }
}
