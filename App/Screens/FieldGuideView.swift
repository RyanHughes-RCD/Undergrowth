import SwiftUI
import UndergrowthCore

/// Collection book. Undiscovered entries show as silhouettes; glimmer
/// creatures have their own slots. Entries come straight from content data,
/// so new items or creatures (e.g. player-made) appear automatically.
struct FieldGuideView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "fungling"
    @State private var selected: GuideEntry?

    struct Family: Identifiable, Hashable { let id: String; let name: String }
    static let families = [Family(id: "fungling", name: "Funglings"), Family(id: "sproutling", name: "Sproutlings"),
                           Family(id: "geodeCritter", name: "Geode Critters"), Family(id: "wanderer", name: "Wanderers")]

    static let silhouette = RenderVariant(silhouette: RGBA(78, 84, 92))

    private var itemCategories: [String] {
        let cats = Set(store.content.orderedItems.filter(\.showsInGuide).map(\.category))
        let order = ["mushroom", "plant", "geode", "gem", "material"]
        return cats.sorted {
            let a = order.firstIndex(of: $0) ?? 99, b = order.firstIndex(of: $1) ?? 99
            return a != b ? a < b : $0 < $1
        }
    }

    private var entries: [GuideEntry] {
        if Self.families.contains(where: { $0.id == tab }) {
            return store.content.orderedCreatures.filter { $0.family == tab }.flatMap { def in
                [false, true].map { glimmer in
                    let (sprite, variant) = store.art(forCreatureType: def, glimmer: glimmer)
                    return GuideEntry(key: GuideKey.creature(def.id, glimmer: glimmer),
                                      name: glimmer ? "Glimmer \(def.name)" : def.name,
                                      sprite: sprite, variant: variant, rarity: glimmer ? nil : def.rarity,
                                      text: [def.howFound, def.special.map { "✨ " + $0 }].compactMap { $0 }.joined(separator: "\n"),
                                      glimmer: glimmer)
                }
            }
        }
        return store.content.orderedItems
            .filter { $0.showsInGuide && $0.category == tab }
            .sorted { $0.rarity != $1.rarity ? $0.rarity < $1.rarity : false }
            .map { GuideEntry(key: GuideKey.item($0.id), name: $0.name, sprite: $0.sprite, variant: .normal,
                              rarity: $0.rarity,
                              text: [$0.howFound, $0.guideText, $0.use?.text].compactMap { $0 }.joined(separator: "\n"),
                              glimmer: false) }
    }

    private var allKeys: [String] {
        store.content.orderedCreatures.flatMap { [GuideKey.creature($0.id, glimmer: false), GuideKey.creature($0.id, glimmer: true)] }
            + store.content.orderedItems.filter(\.showsInGuide).map { GuideKey.item($0.id) }
    }

    var body: some View {
        NavigationStack {
            let discovered = store.state.discovered
            let found = allKeys.filter { discovered.contains($0) }.count
            VStack(spacing: 0) {
                Picker("Section", selection: $tab) {
                    ForEach(Self.families) { f in Text(f.name).tag(f.id) }
                    ForEach(itemCategories, id: \.self) { cat in
                        Text(InventoryView.title(cat)).tag(cat)
                    }
                }
                .pickerStyle(.menu)
                .padding()

                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                        ForEach(entries) { entry in
                            let known = discovered.contains(entry.key)
                            Button { if known { selected = entry } } label: {
                                GuideCell(entry: entry, known: known)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .navigationTitle("Field Guide  \(found)/\(allKeys.count)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $selected) { entry in
                GuideDetail(entry: entry).presentationDetents([.medium]).environmentObject(store)
            }
        }
    }
}

struct GuideEntry: Identifiable, Hashable {
    let key: String
    let name: String
    let sprite: String
    let variant: RenderVariant
    let rarity: Rarity?
    let text: String?
    let glimmer: Bool
    var id: String { key }
}

struct GuideCell: View {
    @EnvironmentObject var store: GameStore
    let entry: GuideEntry
    let known: Bool

    var body: some View {
        VStack(spacing: 6) {
            SpriteImage(id: entry.sprite, variant: known ? entry.variant : FieldGuideView.silhouette,
                        scale: 4, animated: known)
                .frame(width: 72, height: 72)
            Text(known ? entry.name : "???")
                .font(.caption.weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            if let r = entry.rarity {
                Circle().fill(r.color).frame(width: 6, height: 6)
            } else if entry.glimmer {
                Text("✦").font(.caption2).foregroundStyle(.yellow)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 130)
        .padding(6)
        .background(Color.white.opacity(known ? 0.08 : 0.03), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(entry.glimmer ? Color.yellow.opacity(0.4) : .clear))
    }
}

struct GuideDetail: View {
    let entry: GuideEntry
    var body: some View {
        VStack(spacing: 14) {
            SpriteImage(id: entry.sprite, variant: entry.variant, scale: 9)
            Text(entry.name).font(.title2.bold())
            if let r = entry.rarity {
                Text(r.displayName.uppercased()).font(.caption.bold()).tracking(2).foregroundStyle(r.color)
            }
            if let t = entry.text { Text(t).multilineTextAlignment(.center).foregroundStyle(.secondary) }
        }
        .padding(24)
    }
}
