import Foundation
import UndergrowthCore

// Usage: forest-preview <ResourcesDir> <out.ppm> [hoursElapsed] [seed]
let args = CommandLine.arguments
guard args.count >= 3 else {
    print("usage: forest-preview <ResourcesDir> <out.ppm> [hours] [seed]")
    exit(1)
}
let content = try ContentDatabase.load(roots: [URL(fileURLWithPath: args[1])])
let issues = content.validate()
if !issues.isEmpty { print("content issues:\n" + issues.joined(separator: "\n")) }
let hours = args.count > 3 ? Double(args[3]) ?? 24 : 24
let seed = args.count > 4 ? UInt64(args[4]) ?? 7 : 7

let t0 = Date(timeIntervalSince1970: 1_700_000_000)
let game = Game.newForest(content: content, now: t0, seed: seed)
let w = game.state.size.width, h = game.state.size.height
// Place the starters in a loose triangle so their zones overlap a little.
let spots = [GridPoint(w / 2 - 7, h / 2 - 4), GridPoint(w / 2 + 6, h / 2 - 5), GridPoint(w / 2, h / 2 + 7)]
for (c, p) in zip(game.burrow, spots) { try game.place(creatureID: c.id, at: p, now: t0) }
let now = t0.addingTimeInterval(hours * 3600)
game.advance(to: now)
print("forest: \(game.forestName) — \(game.state.spawns.count) spawns")

let field = game.statField(at: now)
let rules = TileRuleEngine(rules: content.tileRules, maxDecorations: content.tuning.visuals.maxDecorationsPerTile,
                           seed: game.state.seed)

// Canvas
let margin = 24
let imgW = (w + h) * 16 + 2 * margin
let imgH = (w + h) * 8 + 24 + 2 * margin
var img = [UInt8](repeating: 0, count: imgW * imgH * 3)
for i in 0..<(imgW * imgH) { img[i * 3] = 24; img[i * 3 + 1] = 30; img[i * 3 + 2] = 24 }

func center(_ p: GridPoint) -> (Int, Int) {
    ((p.x - p.y) * 16 + h * 16 + margin, (p.x + p.y) * 8 + margin + 8)
}

func blit(_ id: String, at c: (Int, Int), dx: Int = 0, dy: Int = 0, flip: Bool = false,
          variant: RenderVariant = .normal, tint: RGBA? = nil, amount: Double = 0) {
    let s = content.sprites.sprite(id)
    let buf = content.sprites.pixels(id, variant: variant)
    let a = s.anchorPoint
    let ox = c.0 + dx - Int(a.x), oy = c.1 + dy - Int(a.y)
    for y in 0..<buf.height {
        for x in 0..<buf.width {
            let sx = flip ? buf.width - 1 - x : x
            let o = (y * buf.width + sx) * 4
            let alpha = Double(buf.bytes[o + 3]) / 255
            guard alpha > 0 else { continue }
            let px = ox + x, py = oy + y
            guard px >= 0, py >= 0, px < imgW, py < imgH else { continue }
            var rgb = [Double(buf.bytes[o]), Double(buf.bytes[o + 1]), Double(buf.bytes[o + 2])]
            if let t = tint {
                rgb[0] = rgb[0] * (1 - amount) + Double(t.r) * amount
                rgb[1] = rgb[1] * (1 - amount) + Double(t.g) * amount
                rgb[2] = rgb[2] * (1 - amount) + Double(t.b) * amount
            }
            let d = (py * imgW + px) * 3
            for k in 0..<3 { img[d + k] = UInt8(min(255, rgb[k] * alpha + Double(img[d + k]) * (1 - alpha))) }
        }
    }
}

let tiles = (0..<h).flatMap { y in (0..<w).map { x in GridPoint(x, y) } }.sorted { ($0.x + $0.y, $0.x) < ($1.x + $1.y, $1.x) }
var visuals: [GridPoint: TileVisual] = [:]
for p in tiles {
    let v = rules.visual(for: field.stats(at: p), at: p)
    visuals[p] = v
    blit(v.ground, at: center(p), tint: v.tint, amount: v.tintAmount)
}
for p in tiles {
    for d in visuals[p]!.decorations { blit(d.sprite, at: center(p), dx: d.offsetX, dy: d.offsetY, flip: d.flipped) }
    if let s = game.spawnAt(p), let def = content.items[s.itemID] { blit(def.sprite, at: center(p)) }
    if let pl = game.creatureAt(p), let c = game.state.creature(pl.creatureID), let def = content.creatures[c.typeID] {
        let variant = c.isGlimmer ? RenderVariant.swap(def.glimmerPaletteSwap) : .normal
        blit(def.sprite, at: center(p), variant: variant)
    }
}

var out = Data("P6\n\(imgW) \(imgH)\n255\n".utf8)
out.append(contentsOf: img)
try out.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2]) (\(imgW)x\(imgH))")
