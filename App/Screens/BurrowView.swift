import SwiftUI
import UndergrowthCore

/// Every creature the player owns. Nothing is ever lost: placed creatures are
/// listed too, and returning one puts it right back here.
struct BurrowView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    let onLocate: (UUID) -> Void

    var body: some View {
        NavigationStack {
            List {
                let placed = store.game.placedCreatures
                if !placed.isEmpty {
                    Section("Out in the forest (\(placed.count)/\(store.state.slots.count))") {
                        ForEach(placed) { c in
                            NavigationLink { CreatureDetailView(creatureID: c.id, onLocate: onLocate) } label: { CreatureRow(creature: c) }
                        }
                    }
                }
                Section("In the Burrow") {
                    let burrow = store.game.burrow
                    if burrow.isEmpty {
                        Text(store.state.creatures.isEmpty
                             ? "No creatures yet. Pick mushrooms (Funglings hide inside), plant seeds (Sproutlings grow from them) and crack geodes (Geode Critters sleep inside)."
                             : "Everyone is out in the forest.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(burrow) { c in
                        NavigationLink { CreatureDetailView(creatureID: c.id, onLocate: onLocate) } label: { CreatureRow(creature: c) }
                    }
                }
            }
            .navigationTitle("Burrow")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

struct CreatureRow: View {
    @EnvironmentObject var store: GameStore
    let creature: CreatureInstance

    var body: some View {
        let art = store.art(for: creature)
        let sprite = art.0
        let variant = art.1
        HStack(spacing: 12) {
            SpriteImage(id: sprite, variant: variant, scale: 3)
                .frame(width: 52, height: 52)
                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(store.displayName(creature)).font(.headline)
                    if creature.isGlimmer {
                        Text("✦ Glimmer").font(.caption2.bold()).foregroundStyle(.yellow)
                    }
                }
                if let def = store.creatureDef(creature) {
                    Text("\(def.displayFamily) · \(def.rarity?.displayName ?? "")").font(.caption2).foregroundStyle(.secondary)
                }
                Text(TraitText.summary(creature)).font(.caption).foregroundStyle(.secondary)
                if let level = store.rampLevel(for: creature) {
                    ProgressView(value: level) {
                        Text("Influence \(Int(level * 100))%").font(.caption2)
                    }
                    .tint(.green)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

enum TraitText {
    static func summary(_ c: CreatureInstance) -> String {
        let stats = c.contributions.sorted { $0.value > $1.value }
            .map { "\($0.key.displayName) +\(Int($0.value.rounded()))" }
        return (stats + [String(format: "Radius %.1f", c.radius)]).joined(separator: " · ")
    }
}

struct CreatureDetailView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    let creatureID: UUID
    let onLocate: (UUID) -> Void
    @State private var nickname = ""

    var body: some View {
        if let c = store.state.creature(creatureID) {
            let art = store.art(for: c)
            let sprite = art.0
            let variant = art.1
            let def = store.creatureDef(c)
            let placement = store.game.activePlacement(for: c.id)
            Form {
                Section {
                    HStack {
                        Spacer()
                        SpriteImage(id: sprite, variant: variant, scale: 7)
                            .padding()
                        Spacer()
                    }
                    if c.isGlimmer {
                        Label("A glimmer! Stronger and wider-reaching than most.", systemImage: "sparkles")
                            .foregroundStyle(.yellow)
                    }
                    if let def {
                        Text("\(def.displayFamily) · \(def.rarity?.displayName ?? "")").font(.callout).foregroundStyle(.secondary)
                    }
                    if let special = def?.special {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(special, systemImage: "sparkles").font(.callout)
                            if let notYet = def?.notYet {
                                Text("Not in the game yet: \(notYet)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Name") {
                    TextField(def?.name ?? "Name", text: $nickname)
                        .onSubmit { store.rename(c.id, to: nickname) }
                }
                Section("Traits") {
                    ForEach(c.contributions.sorted { $0.value > $1.value }, id: \.key) { pair in
                        StatBar(stat: pair.key, value: pair.value)
                    }
                    LabeledContent("Influence radius", value: String(format: "%.1f tiles", c.radius))
                    if let h = def?.rampHours { LabeledContent("Ramps up over", value: "\(Int(h)) hours") }
                    if let origin = c.origin {
                        LabeledContent("Found", value: originText(origin))
                    }
                }
                Section("Status") {
                    if let placement {
                        let level = store.game.level(of: placement, at: store.now)
                        LabeledContent("In the forest at", value: "\(placement.tile.x), \(placement.tile.y)")
                        ProgressView(value: level) { Text("Influence \(Int(level * 100))%") }.tint(.green)
                        if level < 1 {
                            let remaining = (1 - level) * (placement.rampSeconds ?? store.tuning.rampSecondsToFull)
                            Text("Full strength in about \(GameStore.duration(remaining)).")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Button("Show in forest") { onLocate(c.id); dismiss() }
                        Button("Return to Burrow", role: .destructive) {
                            store.rename(c.id, to: nickname)
                            store.recall(c.id)
                            dismiss()
                        }
                    } else {
                        Text("Resting in the Burrow.").foregroundStyle(.secondary)
                        Button {
                            store.rename(c.id, to: nickname)
                            store.beginPlacing(c.id)
                            dismiss()
                        } label: {
                            Label(store.game.freeSlotCount > 0 ? "Place in forest" : "All slots are full",
                                  systemImage: "leaf.fill")
                        }
                        .disabled(store.game.freeSlotCount == 0)
                    }
                }
            }
            .navigationTitle(store.displayName(c))
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { nickname = c.nickname ?? "" }
            .onDisappear { store.rename(c.id, to: nickname) }
        } else {
            Text("This creature has wandered off.")
        }
    }

    private func originText(_ origin: String) -> String {
        if origin == "starter" { return "Was here from the start" }
        if origin == "wanderer" { return "Wandered in on its own" }
        if let item = store.content.items[origin] { return "From a \(item.name)" }
        return origin.capitalized
    }
}

/// Celebration card when a creature is found.
struct CreatureRevealView: View {
    @EnvironmentObject var store: GameStore
    let reveal: CreatureReveal
    let dismiss: () -> Void
    @State private var appeared = false

    var body: some View {
        let c = reveal.creature
        let art = store.art(for: c)
        let sprite = art.0
        let variant = art.1
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea().onTapGesture(perform: dismiss)
            VStack(spacing: 14) {
                Text(c.isGlimmer ? "✦ A glimmer \(store.displayName(c))! ✦" : "You found a \(store.displayName(c))!")
                    .font(.system(.title3, design: .rounded).bold())
                    .foregroundStyle(c.isGlimmer ? .yellow : .white)
                    .multilineTextAlignment(.center)
                Text("It came from \(reveal.source).")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.8))
                ZStack {
                    RaysView(color: c.isGlimmer ? .yellow : .white)
                        .frame(width: 180, height: 180)
                        .opacity(appeared ? 0.5 : 0)
                    SpriteImage(id: sprite, variant: variant, scale: 8)
                        .scaleEffect(appeared ? 1 : 0.2)
                }
                Text(TraitText.summary(c)).font(.caption).foregroundStyle(.white.opacity(0.8))
                if reveal.isNew {
                    Text("New Field Guide entry!").font(.caption.bold()).foregroundStyle(.green)
                }
                Button("Welcome to the Burrow", action: dismiss)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
            }
            .padding(24)
            .background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 22))
            .padding(32)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.55)) { appeared = true }
        }
    }
}

/// Slowly rotating light rays behind a reveal.
struct RaysView: View {
    let color: Color
    var body: some View {
        TimelineView(.animation) { ctx in
            let angle = ctx.date.timeIntervalSinceReferenceDate * 20
            Canvas { gc, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let r = min(size.width, size.height) / 2
                for i in 0..<12 {
                    let a0 = (Double(i) * 30 + angle) * .pi / 180
                    let a1 = a0 + 12 * .pi / 180
                    var p = Path()
                    p.move(to: center)
                    p.addLine(to: CGPoint(x: center.x + r * cos(a0), y: center.y + r * sin(a0)))
                    p.addLine(to: CGPoint(x: center.x + r * cos(a1), y: center.y + r * sin(a1)))
                    p.closeSubpath()
                    gc.fill(p, with: .color(color.opacity(0.35)))
                }
            }
        }
    }
}
