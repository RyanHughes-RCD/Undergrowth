import SpriteKit
import SwiftUI
import UndergrowthCore

/// The main screen: the isometric forest with a cozy HUD on top.
struct ForestScreen: View {
    @EnvironmentObject var store: GameStore
    @State private var scene: ForestScene = {
        let s = ForestScene()
        s.scaleMode = .resizeFill
        return s
    }()
    @State private var sheet: SheetKind?
    @State private var showRename = false

    enum SheetKind: String, Identifiable {
        case burrow, bag, guide
        var id: String { rawValue }
    }

    var body: some View {
        ZStack {
            SpriteView(scene: scene, preferredFramesPerSecond: 30, options: [.ignoresSiblingOrder])
                .ignoresSafeArea()

            VStack(spacing: 8) {
                topBar
                Spacer()
                if let banner = modeBanner { banner }
                if let tile = store.selectedTile { TileInfoCard(tile: tile) }
                bottomBar
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            if let toast = store.toast {
                VStack {
                    ToastView(toast: toast)
                        .transition(.move(edge: .top).combined(with: .opacity))
                    Spacer()
                }
                .padding(.top, 64)
                .animation(.spring(duration: 0.3), value: store.toast)
            }

            if let reveal = store.reveal {
                CreatureRevealView(reveal: reveal) { store.reveal = nil }
                    .transition(.opacity)
            }
        }
        .onAppear {
            scene.store = store
            scene.sync()
        }
        .onChange(of: store.revision) { _, _ in scene.sync() }
        .onChange(of: store.mode) { _, _ in scene.sync() }
        .onChange(of: store.selectedTile) { _, _ in scene.sync() }
        .onChange(of: store.selectedCreatureID) { _, _ in scene.sync() }
        .onChange(of: store.showStatOverlay) { _, _ in scene.sync() }
        .sheet(item: $sheet) { kind in
            Group {
                switch kind {
                case .burrow: BurrowView(onLocate: locate)
                case .bag: InventoryView()
                case .guide: FieldGuideView()
                }
            }
            .environmentObject(store)
        }
        .sheet(item: selectedCreatureBinding) { c in
            NavigationStack { CreatureDetailView(creatureID: c.id, onLocate: locate) }
                .presentationDetents([.medium, .large])
                .environmentObject(store)
        }
        .sheet(isPresented: $showRename) { RenameForestSheet().environmentObject(store) }
        .fullScreenCover(item: crackingBinding) { item in
            GeodeCrackView(itemID: item.id).environmentObject(store)
        }
    }

    // MARK: Pieces

    private var topBar: some View {
        HStack(alignment: .top) {
            Button { showRename = true } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.forestName)
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("\(store.clockText) · tap to rename")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            Spacer()
            if store.tuning.debugTools {
                Button { store.cycleSpeed() } label: {
                    VStack(spacing: 0) {
                        Text("⏩ \(Int(store.speed))×").font(.caption.bold())
                        if store.state.debugTimeOffset > 0 {
                            Text("+" + GameStore.duration(store.state.debugTimeOffset)).font(.system(size: 9))
                        }
                    }
                    .padding(.horizontal, 10).frame(height: 40)
                    .background(store.speed > 1 ? Color.orange.opacity(0.85) : Color.black.opacity(0.45), in: Capsule())
                    .foregroundStyle(.white)
                }
                DebugMenu()
            }
        }
    }

    private var modeBanner: AnyView? {
        switch store.mode {
        case .browse:
            return nil
        case .placeCreature(let id):
            let name = store.state.creature(id).map(store.displayName) ?? "creature"
            return AnyView(ModeBanner(text: "Tap an empty tile to place \(name)") { store.mode = .browse })
        case .plantSeed(let itemID):
            let left = store.state.inventory[itemID, default: 0]
            return AnyView(ModeBanner(text: "Tap an empty tile to plant (\(left) left)") { store.mode = .browse })
        case .useItem(let itemID):
            let def = store.content.items[itemID]
            let left = store.state.inventory[itemID, default: 0]
            return AnyView(ModeBanner(text: "Tap a tile: \(def?.use?.verb ?? "Use") \(def?.name ?? "") (\(left) left)") { store.mode = .browse })
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 8) {
            SlotsBar(onSelect: { id in
                store.selectedTile = nil
                store.selectedCreatureID = id
            })
            HStack(spacing: 10) {
                HUDButton(title: "Burrow", systemImage: "house.fill", badge: store.game.burrow.count) { sheet = .burrow }
                HUDButton(title: "Bag", systemImage: "bag.fill", badge: store.state.inventory.values.reduce(0, +)) { sheet = .bag }
                HUDButton(title: "Guide", systemImage: "book.closed.fill", badge: nil) { sheet = .guide }
            }
        }
    }

    private func locate(_ creatureID: UUID) {
        sheet = nil
        if let p = store.game.activePlacement(for: creatureID) { scene.center(on: p.tile) }
    }

    private var selectedCreatureBinding: Binding<CreatureInstance?> {
        Binding(
            get: { store.selectedCreatureID.flatMap { store.state.creature($0) } },
            set: { store.selectedCreatureID = $0?.id }
        )
    }

    private var crackingBinding: Binding<CrackItem?> {
        Binding(
            get: { store.crackingItemID.map(CrackItem.init) },
            set: { store.crackingItemID = $0?.id }
        )
    }
}

struct CrackItem: Identifiable { let id: String }

// MARK: - HUD components

struct HUDButton: View {
    let title: String
    let systemImage: String
    let badge: Int?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: systemImage).font(.title3)
                Text(title).font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
            .overlay(alignment: .topTrailing) {
                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.orange, in: Capsule())
                        .offset(x: -6, y: 4)
                }
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
    }
}

/// Shows each placement slot: the creature in it and how far its influence has grown.
struct SlotsBar: View {
    @EnvironmentObject var store: GameStore
    let onSelect: (UUID) -> Void

    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(store.state.slots.enumerated()), id: \.offset) { _, slot in
                let placement = slot.placementID.flatMap { pid in store.state.placements.first { $0.id == pid } }
                let creature = placement.flatMap { store.state.creature($0.creatureID) }
                Button {
                    if let creature { onSelect(creature.id) }
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(.black.opacity(0.5))
                        if let creature, let placement {
                            let art = store.art(for: creature)
                            let sprite = art.0
                            let variant = art.1
                            let level = store.game.level(of: placement, at: store.now)
                            VStack(spacing: 2) {
                                SpriteImage(id: sprite, variant: variant, scale: 2.5)
                                ProgressView(value: level).tint(.green).frame(width: 44)
                            }
                        } else {
                            Image(systemName: "plus.circle.dashed")
                                .font(.title2)
                                .foregroundStyle(.white.opacity(0.4))
                        }
                    }
                    .frame(width: 64, height: 64)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct ModeBanner: View {
    let text: String
    let cancel: () -> Void
    var body: some View {
        HStack {
            Text(text).font(.subheadline.weight(.semibold))
            Spacer()
            Button("Cancel", action: cancel).buttonStyle(.borderedProminent).tint(.gray)
        }
        .padding(12)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(.white)
    }
}

struct ToastView: View {
    let toast: Toast
    var body: some View {
        HStack(spacing: 10) {
            if let s = toast.spriteID { SpriteImage(id: s, scale: 2) }
            Text(toast.text).font(.subheadline).foregroundStyle(.white)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.black.opacity(0.75), in: Capsule())
        .padding(.horizontal, 16)
    }
}

/// Stat readout for a tapped tile.
struct TileInfoCard: View {
    @EnvironmentObject var store: GameStore
    let tile: GridPoint

    var body: some View {
        let stats = store.game.tileStats(tile, at: store.now)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Tile \(tile.x), \(tile.y)").font(.caption.bold())
                Spacer()
                Button { store.selectedTile = nil } label: { Image(systemName: "xmark.circle.fill") }
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 4) {
                ForEach(StatKey.core, id: \.self) { k in
                    StatBar(stat: k, value: stats[k] ?? 0)
                }
            }
        }
        .padding(12)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .foregroundStyle(.white)
    }
}

struct StatBar: View {
    let stat: StatKey
    let value: Double

    static func color(_ k: StatKey) -> Color {
        switch k {
        case .spore: return .blue
        case .glow: return .cyan
        case .bloom: return .pink
        case .verdure: return .green
        case .shimmer: return .gray
        case .spirit: return .purple
        default: return .white
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Text(stat.displayName).font(.caption2).frame(width: 52, alignment: .leading)
            ProgressView(value: min(1, value / 100)).tint(StatBar.color(stat))
            Text("\(Int(value.rounded()))").font(.caption2.monospacedDigit()).frame(width: 24, alignment: .trailing)
        }
    }
}

struct DebugMenu: View {
    @EnvironmentObject var store: GameStore
    var body: some View {
        Menu {
            Section("Time") {
                Button("Skip 1 hour") { store.debugSkip(hours: 1) }
                Button("Skip 6 hours") { store.debugSkip(hours: 6) }
                Button("Skip 1 day") { store.debugSkip(hours: 24) }
            }
            Section("View") {
                Toggle("Stat overlay", isOn: $store.showStatOverlay)
            }
            Section("Give") {
                Button("3 Mystery Seeds") { store.debugGive("seed.mystery-seed") }
                Button("3 Pebble Geodes") { store.debugGive("geode.pebble-geode") }
                Button("1 Deep Geode") { store.debugGive("geode.deep-geode", count: 1) }
                Button("Heartstone Core") { store.debugGive("material.heartstone-core", count: 1) }
                Button("Moonfall Shard") { store.debugGive("material.moonfall-shard", count: 1) }
            }
            Section("Give a creature") {
                ForEach(FieldGuideView.families) { family in
                    Menu(family.name) {
                        ForEach(store.content.orderedCreatures.filter { $0.family == family.id }) { def in
                            Button(def.name) { store.debugGiveCreature(def.id, glimmer: false) }
                            Button("✦ Glimmer \(def.name)") { store.debugGiveCreature(def.id, glimmer: true) }
                        }
                    }
                }
            }
            Section {
                Button("Reset forest", role: .destructive) { store.debugResetForest() }
            }
        } label: {
            Image(systemName: "ladybug.fill")
                .padding(10)
                .background(.black.opacity(0.45), in: Circle())
                .foregroundStyle(.white)
        }
    }
}

struct RenameForestSheet: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Forest name") {
                    TextField(store.game.generatedName, text: $name)
                }
                Section {
                    Button("Use the forest's own name: \(store.game.generatedName)") {
                        store.renameForest(nil)
                        dismiss()
                    }
                } footer: {
                    Text("Left unnamed, the forest names itself after its strongest qualities, and the name changes as the land does.")
                }
            }
            .navigationTitle("Rename")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        store.renameForest(name)
                        dismiss()
                    }
                }
            }
            .onAppear { name = store.state.customName ?? "" }
        }
        .presentationDetents([.medium])
    }
}
