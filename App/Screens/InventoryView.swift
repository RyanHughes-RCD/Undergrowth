import SwiftUI
import UndergrowthCore

extension Rarity {
    var color: Color {
        switch self {
        case .common: return .gray
        case .uncommon: return .green
        case .rare: return .blue
        case .veryRare: return .purple
        case .legendary: return .yellow
        }
    }
}

struct OwnedItem: Identifiable {
    let def: ItemDef
    let count: Int
    var id: String { def.id }
}

/// The player's bag: everything collected, with Plant / Crack actions.
struct InventoryView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss

    /// Category display order; unknown categories (added via data) go last.
    static let categoryOrder = ["seed", "geode", "material", "gem", "plant", "mushroom"]
    static func title(_ category: String) -> String {
        switch category {
        case "seed": return "Seeds"
        case "geode": return "Geodes to crack"
        case "material": return "Materials"
        case "gem": return "Gems"
        case "plant": return "Plants"
        case "mushroom": return "Mushrooms"
        default: return category.capitalized
        }
    }

    var body: some View {
        NavigationStack {
            let owned = store.state.inventory.compactMap { entry -> OwnedItem? in
                guard entry.value > 0, let def = store.content.items[entry.key] else { return nil }
                return OwnedItem(def: def, count: entry.value)
            }
            let categories = Set(owned.map { $0.def.category }).sorted {
                let a = Self.categoryOrder.firstIndex(of: $0) ?? 99, b = Self.categoryOrder.firstIndex(of: $1) ?? 99
                return a != b ? a < b : $0 < $1
            }
            List {
                if owned.isEmpty {
                    Text("Your bag is empty. Tap mushrooms, plants and geodes in the forest to collect them.")
                        .foregroundStyle(.secondary)
                }
                ForEach(categories, id: \.self) { cat in
                    Section(Self.title(cat)) {
                        let rows = owned.filter { $0.def.category == cat }.sorted {
                            $0.def.rarity != $1.def.rarity ? $0.def.rarity > $1.def.rarity : $0.def.name < $1.def.name
                        }
                        ForEach(rows) { entry in
                            row(entry.def, entry.count)
                        }
                    }
                }
            }
            .navigationTitle("Bag")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    @ViewBuilder
    private func row(_ def: ItemDef, _ count: Int) -> some View {
        HStack(spacing: 12) {
            SpriteImage(id: def.sprite, scale: 3)
                .frame(width: 52, height: 52)
                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 2) {
                Text(def.name).font(.headline)
                Text(def.rarity.displayName).font(.caption).foregroundStyle(def.rarity.color)
                if let text = def.use?.text { Text(text).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer()
            Text("×\(count)").font(.headline.monospacedDigit())
            if def.isPlantable {
                Button("Plant") {
                    store.beginPlanting(def.id)
                    dismiss()
                }
                .buttonStyle(.borderedProminent).tint(.green)
            } else if def.isCrackable {
                Button("Crack") {
                    dismiss()
                    // Let the sheet finish dismissing before presenting the cover.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { store.crackingItemID = def.id }
                }
                .buttonStyle(.borderedProminent).tint(.orange)
            } else if let use = def.use {
                Button(use.type == "soilBoost" ? (use.verb == "Set into a tile" ? "Set" : "Crush") : "Use") {
                    if use.type == "soilBoost" { dismiss() }
                    store.beginUsing(def.id)
                }
                .buttonStyle(.borderedProminent).tint(.blue)
            }
        }
    }
}
