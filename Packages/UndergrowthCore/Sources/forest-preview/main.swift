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
// Players start with no creatures; give the preview a few species to place.
for id in ["spore-sage", "pollen-puff", "hollow-digger"] { game.debugGrantCreature(typeID: id, glimmer: false, now: t0) }
game.debugClearSpawns()
// Place them in a loose triangle so their zones overlap a little.
let spots = [GridPoint(w / 4, h / 4), GridPoint(w * 3 / 4, h / 2), GridPoint(w / 3, h * 3 / 4)]
for (c, p) in zip(game.burrow, spots) { try game.place(creatureID: c.id, at: p, now: t0) }
let now = t0.addingTimeInterval(hours * 3600)
game.advance(to: now)
print("forest: \(game.forestName) — \(game.state.spawns.count) spawns")

let field = game.statField(at: now)
let rules = TileRuleEngine(rules: content.tileRules, maxDecorations: content.tuning.visuals.maxDecorationsPerTile,
                           seed: game.state.seed)

// Canvas: top-down 16px tiles with a 3-tile shrub treeline around the map.
let border = 3
let imgW = (w + 2 * border) * 16
let imgH = (h + 2 * border) * 16
var img = [UInt8](repeating: 0, count: imgW * imgH * 3)

func center(_ p: GridPoint) -> (Int, Int) {
    ((p.x + border) * 16 + 8, (p.y + border) * 16 + 8)
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

let size = game.state.size
let allTiles = (-border..<(h + border)).flatMap { y in (-border..<(w + border)).map { x in GridPoint(x, y) } }
var objects: [(y: Int, draw: () -> Void)] = []
let overrides = game.groundOverrides(at: now, field: field)
for p in allTiles {
    let c = center(p)
    if size.contains(p) {
        var v = rules.visual(for: field.stats(at: p), at: p)
        if let forced = overrides[p] { v.ground = forced; v.overlays = [] }
        blit(v.ground, at: c, tint: v.tint, amount: v.tintAmount)
        for o in v.overlays { blit(o.sprite, at: c, flip: o.flipped) }
        for d in v.decorations {
            objects.append((c.1 + d.offsetY + 3, { blit(d.sprite, at: c, dx: d.offsetX * 4 / 5, dy: d.offsetY + 3, flip: d.flipped) }))
        }
    } else if let edge = content.tuning.visuals.edge {
        let v = rules.edgeVisual(at: p, size: size, edge: edge)
        blit(v.ground, at: c)
        for d in v.decorations {
            objects.append((c.1 + 8 + d.offsetY, { blit(d.sprite, at: c, dx: d.offsetX, dy: 8 + d.offsetY, flip: d.flipped) }))
        }
    }
    if let s = game.spawnAt(p), let def = content.items[s.itemID] { objects.append((c.1 + 5, { blit(def.sprite, at: c, dy: 5) })) }
    if let pl = game.creatureAt(p), let cr = game.state.creature(pl.creatureID), let def = content.creatures[cr.typeID] {
        let variant = cr.isGlimmer ? RenderVariant.swap(def.glimmerPaletteSwap) : .normal
        objects.append((c.1 + 5, { blit(def.sprite, at: c, dy: 5, variant: variant) }))
    }
}
for o in objects.sorted(by: { $0.y < $1.y }) { o.draw() }

var out = Data("P6\n\(imgW) \(imgH)\n255\n".utf8)
out.append(contentsOf: img)
try out.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2]) (\(imgW)x\(imgH))")
