import SpriteKit
import UIKit
import UndergrowthCore

/// Renders the isometric forest. All art comes from the sprite registry via
/// `TextureCache`; what each tile shows comes from `TileRuleEngine` (data rules).
/// The scene is a view of `GameStore` state: call `sync()` after changes.
final class ForestScene: SKScene, UIGestureRecognizerDelegate {
    weak var store: GameStore?

    private let world = SKNode()
    private let cam = SKCameraNode()

    private var groundNodes: [GridPoint: SKSpriteNode] = [:]
    private var decoNodes: [GridPoint: [SKSpriteNode]] = [:]
    private var visuals: [GridPoint: TileVisual] = [:]
    private var spawnNodes: [UUID: SKSpriteNode] = [:]
    private var seedNodes: [UUID: (node: SKSpriteNode, sprite: String)] = [:]
    private var creatureNodes: [UUID: SKSpriteNode] = [:]   // keyed by placement id
    private var ruleEngine: TileRuleEngine?
    private var builtSize: GridSize?
    private var builtForest: UUID?
    private var overlayWasOn = false

    private let selectionNode = SKShapeNode()
    private var ringNodes: [UUID: SKShapeNode] = [:]

    private var zoom: CGFloat = 3
    private var pinchStartZoom: CGFloat = 3
    private var didInitialCenter = false

    // MARK: Setup

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.09, green: 0.12, blue: 0.09, alpha: 1)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        if world.parent == nil { addChild(world) }
        if cam.parent == nil { addChild(cam) }
        camera = cam
        view.ignoresSiblingOrder = true

        selectionNode.strokeColor = UIColor(white: 1, alpha: 0.85)
        selectionNode.lineWidth = 1
        selectionNode.fillColor = UIColor(white: 1, alpha: 0.12)
        selectionNode.zPosition = -400
        selectionNode.isHidden = true
        selectionNode.isAntialiased = false
        if selectionNode.parent == nil { world.addChild(selectionNode) }

        if !gesturesInstalled { installGestures(on: view) }
        sync()
    }

    private var gesturesInstalled = false

    private func installGestures(on view: SKView) {
        gesturesInstalled = true
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.delegate = self
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        view.addGestureRecognizer(pan)
        view.addGestureRecognizer(pinch)
        view.addGestureRecognizer(tap)
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    // MARK: Camera

    private func applyZoom() {
        cam.setScale(1 / zoom)
        clampCamera()
    }

    private func clampCamera() {
        guard let size = builtSize else { return }
        let b = Iso.worldBounds(size).insetBy(dx: -40, dy: -40)
        var p = cam.position
        p.x = min(max(p.x, b.minX), b.maxX)
        p.y = min(max(p.y, b.minY), b.maxY)
        // Snap so art pixels land on whole device pixels.
        let step = 1 / zoom
        p.x = (p.x / step).rounded() * step
        p.y = (p.y / step).rounded() * step
        cam.position = p
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        guard let view else { return }
        let t = g.translation(in: view)
        cam.position = CGPoint(x: cam.position.x - t.x / zoom, y: cam.position.y + t.y / zoom)
        g.setTranslation(.zero, in: view)
        clampCamera()
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began:
            pinchStartZoom = zoom
        case .changed:
            zoom = min(8, max(1, pinchStartZoom * g.scale))
            applyZoom()
        case .ended, .cancelled:
            // Snap to an integer scale for perfectly square pixels.
            zoom = min(8, max(1, zoom.rounded()))
            cam.run(SKAction.scale(to: 1 / zoom, duration: 0.15)) { [weak self] in self?.clampCamera() }
        default:
            break
        }
    }

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        guard let view, let store else { return }
        let pt = convertPoint(fromView: g.location(in: view))
        let worldPt = convert(pt, to: world)
        // Prefer tall objects (items, creatures) under the finger, frontmost first.
        let hits = nodes(at: pt).compactMap { node -> (GridPoint, CGFloat)? in
            guard let tile = node.userData?["tile"] as? [Int], tile.count == 2 else { return nil }
            return (GridPoint(tile[0], tile[1]), node.zPosition)
        }
        if case .browse = store.mode, let best = hits.max(by: { $0.1 < $1.1 }) {
            store.handleTap(tile: best.0)
        } else {
            store.handleTap(tile: Iso.tile(at: worldPt))
        }
    }

    func center(on tile: GridPoint, animated: Bool = true) {
        let p = Iso.point(tile)
        if animated {
            cam.run(SKAction.move(to: p, duration: 0.3)) { [weak self] in self?.clampCamera() }
        } else {
            cam.position = p
            clampCamera()
        }
    }

    // MARK: Sync

    func sync() {
        guard let store, view != nil else { return }
        let state = store.state
        if builtSize != state.size || builtForest != state.forestID || ruleEngine == nil {
            builtForest = state.forestID
            rebuild(size: state.size, seed: state.seed, store: store)
        }
        if !didInitialCenter {
            didInitialCenter = true
            cam.position = Iso.point(GridPoint(state.size.width / 2, state.size.height / 2))
            zoom = size.width < 600 ? 2 : 3
            applyZoom()
        }
        let field = state.statCache ?? store.game.statField(at: store.now)
        syncTiles(field: field, store: store)
        syncSpawns(store)
        syncSeeds(store)
        syncCreatures(store)
        syncSelection(store)
    }

    private func rebuild(size: GridSize, seed: UInt64, store: GameStore) {
        world.children.filter { $0 !== selectionNode }.forEach { $0.removeFromParent() }
        groundNodes.removeAll(); decoNodes.removeAll(); visuals.removeAll()
        spawnNodes.removeAll(); seedNodes.removeAll(); creatureNodes.removeAll(); ringNodes.removeAll()
        builtSize = size
        ruleEngine = TileRuleEngine(rules: store.content.tileRules,
                                    maxDecorations: store.tuning.visuals.maxDecorationsPerTile, seed: seed)
    }

    private func makeSprite(_ id: String, variant: RenderVariant = .normal, store: GameStore) -> SKSpriteNode {
        let node = SKSpriteNode()
        configure(node, sprite: id, variant: variant, store: store)
        return node
    }

    /// Sets textures/anchor and starts frame animation if the sprite has frames.
    private func configure(_ node: SKSpriteNode, sprite id: String, variant: RenderVariant, store: GameStore) {
        let frames = store.textures.textures(id, variant: variant)
        node.removeAction(forKey: "anim")
        node.texture = frames.first
        node.size = store.textures.size(id)
        node.anchorPoint = store.textures.anchorPoint(id)
        if frames.count > 1 {
            let durations = store.textures.durations(id)
            var steps: [SKAction] = []
            for (i, t) in frames.enumerated() {
                steps.append(SKAction.setTexture(t))
                steps.append(SKAction.wait(forDuration: durations[i % durations.count]))
            }
            let loop = SKAction.repeatForever(SKAction.sequence(steps))
            // Random phase so neighbours don't animate in lockstep.
            node.run(SKAction.sequence([SKAction.wait(forDuration: Double.random(in: 0...0.8)), loop]), withKey: "anim")
        }
    }

    private func tag(_ node: SKNode, _ tile: GridPoint) {
        node.userData = ["tile": [tile.x, tile.y]]
    }

    private func syncTiles(field: StatField, store: GameStore) {
        guard let engine = ruleEngine else { return }
        let overlay = store.showStatOverlay
        let overlayChanged = overlay != overlayWasOn
        overlayWasOn = overlay
        for y in 0..<field.size.height {
            for x in 0..<field.size.width {
                let p = GridPoint(x, y)
                let stats = field.stats(at: p)
                let v = engine.visual(for: stats, at: p)
                let old = visuals[p]
                if old == v && !overlayChanged && !overlay { continue }
                visuals[p] = v
                let base = Iso.point(p)

                // Ground
                let ground: SKSpriteNode
                if let g = groundNodes[p] {
                    ground = g
                    if old?.ground != v.ground { configure(g, sprite: v.ground, variant: .normal, store: store) }
                } else {
                    ground = makeSprite(v.ground, store: store)
                    ground.position = base
                    ground.zPosition = -1000 + Iso.depth(p) * 0.1
                    world.addChild(ground)
                    groundNodes[p] = ground
                }
                if overlay {
                    let (color, amount) = ForestScene.overlayColor(stats)
                    ground.color = color
                    ground.colorBlendFactor = amount
                } else if let tint = v.tint {
                    ground.color = UIColor(red: CGFloat(tint.r) / 255, green: CGFloat(tint.g) / 255,
                                           blue: CGFloat(tint.b) / 255, alpha: 1)
                    ground.colorBlendFactor = CGFloat(v.tintAmount)
                } else {
                    ground.colorBlendFactor = 0
                }

                // Decorations
                if old?.decorations != v.decorations {
                    decoNodes[p]?.forEach { $0.removeFromParent() }
                    var nodes: [SKSpriteNode] = []
                    for (i, d) in v.decorations.enumerated() {
                        let n = makeSprite(d.sprite, store: store)
                        n.position = CGPoint(x: base.x + CGFloat(d.offsetX), y: base.y - CGFloat(d.offsetY))
                        n.xScale = d.flipped ? -1 : 1
                        n.zPosition = Iso.depth(p) + 0.1 + CGFloat(i) * 0.01 + CGFloat(d.offsetY) * 0.001
                        if old != nil {
                            n.alpha = 0
                            n.run(SKAction.fadeIn(withDuration: 1.2))
                        }
                        world.addChild(n)
                        nodes.append(n)
                    }
                    decoNodes[p] = nodes
                }
            }
        }
    }

    /// Debug overlay: color by stat mix, stronger where stats are higher.
    static func overlayColor(_ stats: StatValues) -> (UIColor, CGFloat) {
        let colors: [StatKey: (CGFloat, CGFloat, CGFloat)] = [
            .damp: (0.2, 0.4, 1.0), .glow: (0.4, 1.0, 1.0), .bloom: (1.0, 0.45, 0.75),
            .verdure: (0.3, 0.9, 0.3), .stone: (0.65, 0.65, 0.7), .depth: (0.45, 0.2, 0.6),
        ]
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, total: CGFloat = 0, maxV: CGFloat = 0
        for (k, c) in colors {
            let v = CGFloat(stats[k] ?? 0)
            r += c.0 * v; g += c.1 * v; b += c.2 * v; total += v
            maxV = max(maxV, v)
        }
        guard total > 0.5 else { return (.black, 0.55) }
        return (UIColor(red: r / total, green: g / total, blue: b / total, alpha: 1), min(0.9, 0.35 + maxV / 150))
    }

    private func objectZ(_ p: GridPoint, _ layer: CGFloat) -> CGFloat { Iso.depth(p) + layer }

    private func syncSpawns(_ store: GameStore) {
        let current = Dictionary(uniqueKeysWithValues: store.state.spawns.map { ($0.id, $0) })
        for (id, node) in spawnNodes where current[id] == nil {
            spawnNodes[id] = nil
            node.userData = nil
            // Little "picked" pop.
            node.run(SKAction.sequence([
                SKAction.group([SKAction.moveBy(x: 0, y: 10, duration: 0.25), SKAction.fadeOut(withDuration: 0.25),
                                SKAction.scale(to: 1.4, duration: 0.25)]),
                SKAction.removeFromParent(),
            ]))
        }
        for (id, s) in current where spawnNodes[id] == nil {
            guard let def = store.content.items[s.itemID] else { continue }
            let n = makeSprite(def.sprite, store: store)
            n.position = Iso.point(s.tile)
            n.zPosition = objectZ(s.tile, 0.5)
            tag(n, s.tile)
            n.setScale(0.2)
            n.run(SKAction.scale(to: 1, duration: 0.3))
            // Gentle idle sway so collectibles read as interactive.
            n.run(SKAction.repeatForever(SKAction.sequence([
                SKAction.wait(forDuration: Double.random(in: 2...6)),
                SKAction.moveBy(x: 0, y: 1, duration: 0.15), SKAction.moveBy(x: 0, y: -1, duration: 0.15),
            ])))
            world.addChild(n)
            spawnNodes[id] = n
        }
    }

    private func syncSeeds(_ store: GameStore) {
        let now = store.now
        let current = Dictionary(uniqueKeysWithValues: store.state.plantedSeeds.map { ($0.id, $0) })
        for (id, entry) in seedNodes where current[id] == nil {
            entry.node.removeFromParent()
            seedNodes[id] = nil
        }
        for (id, seed) in current {
            let stages = store.content.items[seed.seedItemID]?.growthSprites ?? [SpriteRegistry.missingID]
            let progress = seed.progress(at: now)
            let idx = seed.isReady(at: now) ? stages.count - 1 : min(stages.count - 2, Int(progress * Double(max(1, stages.count - 1))))
            let sprite = stages[max(0, idx)]
            if let entry = seedNodes[id] {
                if entry.sprite != sprite {
                    configure(entry.node, sprite: sprite, variant: .normal, store: store)
                    seedNodes[id] = (entry.node, sprite)
                }
            } else {
                let n = makeSprite(sprite, store: store)
                n.position = Iso.point(seed.tile)
                n.zPosition = objectZ(seed.tile, 0.45)
                tag(n, seed.tile)
                world.addChild(n)
                seedNodes[id] = (n, sprite)
            }
        }
    }

    private func syncCreatures(_ store: GameStore) {
        let active = store.state.placements.filter(\.isActive)
        let ids = Set(active.map(\.id))
        for (id, node) in creatureNodes where !ids.contains(id) {
            node.run(SKAction.sequence([SKAction.fadeOut(withDuration: 0.3), SKAction.removeFromParent()]))
            creatureNodes[id] = nil
        }
        for p in active where creatureNodes[p.id] == nil {
            guard let c = store.state.creature(p.creatureID) else { continue }
            let (sprite, variant) = store.art(for: c)
            let n = makeSprite(sprite, variant: variant, store: store)
            n.position = Iso.point(p.tile)
            n.zPosition = objectZ(p.tile, 0.6)
            tag(n, p.tile)
            if c.isGlimmer {
                let sparkle = SKAction.sequence([
                    SKAction.colorize(with: .white, colorBlendFactor: 0.35, duration: 0.6),
                    SKAction.colorize(withColorBlendFactor: 0, duration: 0.6),
                    SKAction.wait(forDuration: 1.5),
                ])
                n.run(SKAction.repeatForever(sparkle))
            }
            n.position.y += 12
            n.alpha = 0
            n.run(SKAction.group([SKAction.fadeIn(withDuration: 0.25),
                                  SKAction.moveBy(x: 0, y: -12, duration: 0.3)]))
            world.addChild(n)
            creatureNodes[p.id] = n
        }
    }

    private func syncSelection(_ store: GameStore) {
        if let tile = store.selectedTile {
            selectionNode.path = Iso.diamondPath(at: tile)
            selectionNode.isHidden = false
        } else {
            selectionNode.isHidden = true
        }

        // Influence rings: the selected creature, or every placed creature while placing.
        var wanted: [Placement] = []
        let active = store.state.placements.filter(\.isActive)
        if let sel = store.selectedCreatureID, let p = active.first(where: { $0.creatureID == sel }) {
            wanted = [p]
        } else if case .placeCreature = store.mode {
            wanted = active
        }
        let wantedIDs = Set(wanted.map(\.id))
        for (id, ring) in ringNodes where !wantedIDs.contains(id) {
            ring.removeFromParent()
            ringNodes[id] = nil
        }
        for p in wanted where ringNodes[p.id] == nil {
            let r = Iso.ellipseRadii(forGridRadius: p.radius)
            let c = Iso.point(p.tile)
            let ring = SKShapeNode(ellipseIn: CGRect(x: c.x - r.width, y: c.y - r.height,
                                                     width: r.width * 2, height: r.height * 2))
            ring.strokeColor = UIColor(white: 1, alpha: 0.7)
            ring.lineWidth = 1
            ring.fillColor = UIColor(white: 1, alpha: 0.06)
            ring.zPosition = -450
            ring.isAntialiased = false
            world.addChild(ring)
            ringNodes[p.id] = ring
        }
    }
}
