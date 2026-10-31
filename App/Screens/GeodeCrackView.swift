import SwiftUI
import UIKit
import UndergrowthCore

/// The geode-cracking reveal: tap the rock a few times, watch it crack,
/// then it bursts open to show a gem (or, rarely, a Geode Critter).
struct GeodeCrackView: View {
    @EnvironmentObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    let itemID: String

    enum Phase: Equatable { case tapping, burst, revealed }

    @State private var phase: Phase = .tapping
    @State private var hits = 0
    @State private var hitsNeeded = Int.random(in: 3...5)
    @State private var shake: CGFloat = 0
    @State private var results: [LootResult] = []
    @State private var flash = 0.0
    @State private var halvesApart = false
    @State private var revealScale: CGFloat = 0.1
    @State private var chips: [Chip] = []

    struct Chip: Identifiable {
        let id = UUID()
        var dx: CGFloat = 0
        var dy: CGFloat = 0
    }

    private var rockSprite: String { store.content.items[itemID]?.sprite ?? SpriteRegistry.missingID }

    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(red: 0.16, green: 0.13, blue: 0.2), .black], center: .center,
                           startRadius: 10, endRadius: 500)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    if phase == .tapping { rock }
                    if phase != .tapping { halves }
                    if phase == .revealed { revealContent }
                    ForEach(chips) { chip in
                        Rectangle().fill(Color.gray).frame(width: 6, height: 6)
                            .offset(x: chip.dx, y: chip.dy)
                    }
                }
                .frame(height: 300)

                Group {
                    switch phase {
                    case .tapping:
                        Text(hits == 0 ? "Tap the rock to crack it open" : "Keep tapping…")
                            .font(.headline).foregroundStyle(.white.opacity(0.8))
                    case .burst:
                        Text(" ").font(.headline)
                    case .revealed:
                        resultText
                    }
                }
                .frame(minHeight: 80)

                Spacer()
                if phase == .revealed { buttons }
            }
            .padding()

            Color.white.opacity(flash).ignoresSafeArea().allowsHitTesting(false)
        }
    }

    // MARK: Rock

    private var rock: some View {
        ZStack {
            SpriteImage(id: rockSprite, scale: 12)
            CracksShape(count: hits)
                .stroke(Color.black.opacity(0.85), style: StrokeStyle(lineWidth: 5, lineCap: .square, lineJoin: .miter))
                .frame(width: 16 * 12, height: 16 * 12)
                .allowsHitTesting(false)
        }
        .offset(x: shake)
        .contentShape(Rectangle())
        .onTapGesture(perform: hit)
    }

    private var halves: some View {
        ZStack {
            SpriteImage(id: rockSprite, scale: 12, animated: false)
                .mask(HStack(spacing: 0) { Rectangle(); Color.clear })
                .offset(x: halvesApart ? -160 : 0, y: halvesApart ? 60 : 0)
                .rotationEffect(.degrees(halvesApart ? -30 : 0))
            SpriteImage(id: rockSprite, scale: 12, animated: false)
                .mask(HStack(spacing: 0) { Color.clear; Rectangle() })
                .offset(x: halvesApart ? 160 : 0, y: halvesApart ? 60 : 0)
                .rotationEffect(.degrees(halvesApart ? 30 : 0))
        }
        .opacity(halvesApart ? 0 : 1)
    }

    private func hit() {
        guard phase == .tapping else { return }
        hits += 1
        UIImpactFeedbackGenerator(style: hits >= hitsNeeded ? .heavy : .medium).impactOccurred()
        withAnimation(.linear(duration: 0.05).repeatCount(4, autoreverses: true)) { shake = 8 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { shake = 0 }
        spawnChips()
        if hits >= hitsNeeded { burst() }
    }

    private func spawnChips() {
        let new = (0..<4).map { _ in Chip() }
        chips.append(contentsOf: new)
        let ids = Set(new.map(\.id))
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.4)) {
                for i in chips.indices where ids.contains(chips[i].id) {
                    chips[i].dx = .random(in: -140...140)
                    chips[i].dy = .random(in: -140...40)
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            chips.removeAll { ids.contains($0.id) }
        }
    }

    private func burst() {
        results = store.crack(itemID)
        phase = .burst
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation(.easeOut(duration: 0.12)) { flash = 0.9 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            withAnimation(.easeIn(duration: 0.6)) { flash = 0 }
            withAnimation(.easeOut(duration: 0.7)) { halvesApart = true }
            phase = .revealed
            withAnimation(.spring(response: 0.55, dampingFraction: 0.5).delay(0.1)) { revealScale = 1 }
        }
    }

    // MARK: Reveal

    private var revealed: (sprite: String, variant: RenderVariant, name: String, rarity: Rarity?, color: Color, isNew: Bool, creature: CreatureInstance?)? {
        guard let first = results.first else { return nil }
        switch first {
        case .item(let id, _, let isNew):
            let def = store.content.items[id]
            let rarity = def?.rarity ?? .common
            return (def?.sprite ?? SpriteRegistry.missingID, .normal, def?.name ?? id, rarity, rarity.color, isNew, nil)
        case .creature(let c, let isNew):
            let (sprite, variant) = store.art(for: c)
            return (sprite, variant, store.displayName(c), nil, c.isGlimmer ? .yellow : .orange, isNew, c)
        }
    }

    @ViewBuilder
    private var revealContent: some View {
        if let r = revealed {
            ZStack {
                RaysView(color: r.color).frame(width: 300, height: 300)
                SpriteImage(id: r.sprite, variant: r.variant, scale: 10)
            }
            .scaleEffect(revealScale)
        }
    }

    @ViewBuilder
    private var resultText: some View {
        if let r = revealed {
            VStack(spacing: 6) {
                if let c = r.creature {
                    Text(c.isGlimmer ? "✦ A glimmer \(r.name) was inside! ✦" : "A \(r.name) was curled up inside!")
                        .font(.title3.bold()).foregroundStyle(r.color).multilineTextAlignment(.center)
                    Text(TraitText.summary(c)).font(.caption).foregroundStyle(.white.opacity(0.8))
                    Text("It's waiting in your Burrow.").font(.caption).foregroundStyle(.white.opacity(0.7))
                } else {
                    Text(r.name).font(.title2.bold()).foregroundStyle(.white)
                    if let rarity = r.rarity {
                        Text(rarity.displayName.uppercased()).font(.caption.bold()).tracking(2).foregroundStyle(rarity.color)
                    }
                }
                if r.isNew {
                    Text("New Field Guide entry!").font(.caption.bold()).foregroundStyle(.green)
                }
            }
        } else {
            Text("Just dust this time.").foregroundStyle(.white)
        }
    }

    private var buttons: some View {
        HStack(spacing: 16) {
            if store.state.inventory[itemID, default: 0] > 0 {
                Button("Crack another (\(store.state.inventory[itemID, default: 0]))") { reset() }
                    .buttonStyle(.borderedProminent).tint(.orange)
            }
            Button("Done") { dismiss() }
                .buttonStyle(.bordered).tint(.white)
        }
    }

    private func reset() {
        phase = .tapping
        hits = 0
        hitsNeeded = Int.random(in: 3...5)
        results = []
        halvesApart = false
        revealScale = 0.1
        chips = []
    }
}

/// Jagged cracks that grow with each tap. Drawn in a unit square scaled to the rock.
struct CracksShape: Shape {
    var count: Int

    static let cracks: [[CGPoint]] = [
        [CGPoint(x: 0.50, y: 0.30), CGPoint(x: 0.45, y: 0.45), CGPoint(x: 0.52, y: 0.55), CGPoint(x: 0.47, y: 0.70)],
        [CGPoint(x: 0.45, y: 0.45), CGPoint(x: 0.32, y: 0.50), CGPoint(x: 0.25, y: 0.62)],
        [CGPoint(x: 0.52, y: 0.55), CGPoint(x: 0.65, y: 0.52), CGPoint(x: 0.72, y: 0.62)],
        [CGPoint(x: 0.50, y: 0.30), CGPoint(x: 0.60, y: 0.40), CGPoint(x: 0.70, y: 0.38)],
        [CGPoint(x: 0.47, y: 0.70), CGPoint(x: 0.38, y: 0.80)],
    ]

    func path(in rect: CGRect) -> Path {
        var p = Path()
        for crack in Self.cracks.prefix(count) {
            guard let first = crack.first else { continue }
            p.move(to: CGPoint(x: rect.minX + first.x * rect.width, y: rect.minY + first.y * rect.height))
            for pt in crack.dropFirst() {
                p.addLine(to: CGPoint(x: rect.minX + pt.x * rect.width, y: rect.minY + pt.y * rect.height))
            }
        }
        return p
    }
}
