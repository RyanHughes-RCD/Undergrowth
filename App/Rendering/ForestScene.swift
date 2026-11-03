import SpriteKit
import UIKit
import UndergrowthCore

/// Renders the forest top-down. All art comes from the sprite registry via
/// `TextureCache`; what each tile shows comes from `TileRuleEngine` (data rules).
/// The whole map is fitted between the HUD bars at a whole-pixel scale, and a
/// shrub treeline fills everything beyond it. Call `sync()` after state changes.
final class ForestScene: SKScene, UIGestureRecognizerDelegate {
    weak var store: GameStore?

    private let world = SKNode()
    private let cam = SKCameraNode()

    private var groundNodes: [GridPoint: SKSpriteNode] = [:]
    private var decoNodes: [GridPoint: [SKSpriteNode]] = [:]
    private var overlayNodes: [GridPoint: [SKSpriteNode]] = [:]
    /// How many tiles of shrub treeline to build around the map.
    private let apron = 12
    private var visuals: [GridPoint: TileVisual] = [:]
    private var spawnNodes: [UUID: SKSpriteNode] = [:]
    private var seedNodes: [UUID: (node: SKSpriteNode, sprite: String)] = [:]
    private var creatureNodes: [UUID: SKSpriteNode] = [:]   // keyed by placement id
    private var visitorNodes: [UUID: SKSpriteNode] = [:]
    private var ruleEngine: TileRuleEngine?
    private var builtSize: GridSize?
    private var builtForest: UUID?
    private var overlayWasOn = false

    private let selectionNode = SKShapeNode()
    private var ringNodes: [UUID: SKShapeNode] = [:]

    /// Device pixels per art pixel (always a whole number, so pixels stay crisp).
    private var k: CGFloat = 0
    private var pinchStartK: CGFloat = 0
    /// The world point shown at the centre of the play area.
    private var focus = CGPoint.zero

    /// Space taken by the HUD (points): forest name bar on top, slots + nav at the bottom.
    var hudTop: CGFloat = 64
    var hudBottom: CGFloat = 150

    private var screenScale: CGFloat { view?.contentScaleFactor ?? UIScreen.main.scale }
    private var zoom: CGFloat { k / screenScale }   // points per art pixel

    // MARK: Setup

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.12, green: 0.23, blue: 0.11, alpha: 1)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        if world.parent == nil { addChild(world) }
        if cam.parent == nil { addChild(cam) }
        camera = cam
        view.ignoresSiblingOrder = true

        selectionNode.strokeColor = UIColor(white: 1, alpha: 0.9)
        selectionNode.lineWidth = 1
        selectionNode.fillColor = UIColor(white: 1, alpha: 0.15)
        selectionNode.zPosition = -400
        selectionNode.isHidden = true
        selectionNode.isAntialiased = false
        if selectionNode.parent == nil { world.addChild(selectionNode) }

        if !gesturesInstalled { installGestures(on: view) }
        sync()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        fit(reset: false)
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

    private var mapSize: CGSize {
        guard let s = builtSize else { return .zero }
        return CGSize(width: CGFloat(s.width) * TileMath.size, height: CGFloat(s.height) * TileMath.size)
    }

    /// The play area between the HUD bars, in points.
    private var playArea: CGRect {
        let top = (view?.safeAreaInsets.top ?? 0) + hudTop
        let bottom = (view?.safeAreaInsets.bottom ?? 0) + hudBottom
        return CGRect(x: 0, y: top, width: size.width, height: max(100, size.height - top - bottom))
    }

    /// Largest whole-pixel scale at which the whole map fits the play area.
    private func fitK() -> CGFloat {
        let a = playArea, m = mapSize
        guard m.width > 0, a.width > 0 else { return max(1, (2 * screenScale).rounded()) }
        return max(1, (screenScale * min((a.width - 8) / (m.width + 4), a.height / (m.height + 4))).rounded(.down))
    }

    private func fit(reset: Bool) {
        guard builtSize != nil else { return }
        let fk = fitK()
        if reset || k < fk { k = fk }
        if reset { focus = CGPoint(x: mapSize.width / 2, y: -mapSize.height / 2) }
        applyCamera()
    }

    /// Keep the map centred when it fits; when zoomed in, keep the view over the map.
    private func applyCamera() {
        guard k > 0 else { return }
        let a = playArea, m = mapSize
        let hw = a.width / 2 / zoom, hh = a.height / 2 / zoom
        func clamp(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat, _ half: CGFloat) -> CGFloat {
            hi - lo <= half * 2 ? (lo + hi) / 2 : min(max(v, lo + half), hi - half)
        }
        focus.x = clamp(focus.x, 0, m.width, hw)
        focus.y = clamp(focus.y, -m.height, 0, hh)
        // The play area's centre sits below/above the screen centre by the HUD difference.
        let offsetPoints = a.midY - size.height / 2
        var p = CGPoint(x: focus.x, y: focus.y + offsetPoints / zoom)
        let step = 1 / k   // snap so art pixels land on whole device pixels
        p.x = (p.x / step).rounded() * step
        p.y = (p.y / step).rounded() * step
        cam.position = p
        cam.setScale(1 / zoom)
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        guard let view else { return }
        let t = g.translation(in: view)
        focus = CGPoint(x: focus.x - t.x / zoom, y: focus.y + t.y / zoom)
        g.setTranslation(.zero, in: view)
        applyCamera()
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began:
            pinchStartK = k
        case .changed:
            let fk = fitK()
            k = min(fk * 4, max(fk, (pinchStartK * g.scale).rounded()))
            applyCamera()
        default:
            break
        }
    }

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        guard let view, let store else { return }
        let pt = convertPoint(fromView: g.location(in: view))
        let worldPt = convert(pt, to: world)
        // Prefer objects under the finger, frontmost first.
        let hits = nodes(at: pt).compactMap { node -> (GridPoint, CGFloat)? in
            guard let tile = node.userData?["tile"] as? [Int], tile.count == 2 else { return nil }
            return (GridPoint(tile[0], tile[1]), node.zPosition)
        }
        if case .browse = store.mode, let best = hits.max(by: { $0.1 < $1.1 }) {
            store.handleTap(tile: best.0)
        } else {
            store.handleTap(tile: TileMath.tile(at: worldPt))
        }
    }

    func center(on tile: GridPoint, animated: Bool = true) {
        focus = TileMath.centre(tile)
        applyCamera()
    }

    // MARK: Sync

    func sync() {
        guard let store, view != nil else { return }
        let state = store.state
        if builtSize != state.size || builtForest != state.forestID || ruleEngine == nil {
            builtForest = state.forestID
            rebuild(size: state.size, seed: state.seed, store: store)
            fit(reset: true)
        }
        let field = state.statCache ?? store.game.statField(at: store.now)
        syncTiles(field: field, store: store)
        syncSpawns(store)
        syncSeeds(store)
        syncCreatures(store)
        syncVisitors(store)
        syncSelection(store)
    }

    private func rebuild(size: GridSize, seed: UInt64, store: GameStore) {
        world.children.filter { $0 !== selectionNode }.forEach { $0.removeFromParent() }
        groundNodes.removeAll(); decoNodes.removeAll(); overlayNodes.removeAll(); visuals.removeAll()
        spawnNodes.removeAll(); seedNodes.removeAll(); creatureNodes.removeAll(); ringNodes.removeAll()
        visitorNodes.removeAll()
        builtSize = size
        ruleEngine = TileRuleEngine(rules: store.content.tileRules,
                                    maxDecorations: store.tuning.visuals.maxDecorationsPerTile, seed: seed)
        buildTreeline(size: size, store: store)
    }

    /// Static shrub treeline around the map so the screen edges are always hedge.
    private func buildTreeline(size: GridSize, store: GameStore) {
        guard let engine = ruleEngine, let edge = store.tuning.visuals.edge else { return }
        for y in -apron..<(size.height + apron) {
            for x in -apron..<(size.width + apron) {
                let p = GridPoint(x, y)
                if size.contains(p) { continue }
                let v = engine.edgeVisual(at: p, size: size, edge: edge)
                let c = TileMath.centre(p)
                let g = makeSprite(v.ground, store: store)
                g.position = c
                g.zPosition = -1000
                world.addChild(g)
                for d in v.decorations {
                    let n = makeSprite(d.sprite, store: store)
                    n.position = CGPoint(x: c.x + CGFloat(d.offsetX), y: c.y - TileMath.size / 2 - CGFloat(d.offsetY))
                    n.xScale = d.flipped ? -1 : 1
                    n.zPosition = TileMath.z(forSceneY: n.position.y)
                    world.addChild(n)
                }
            }
        }
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
        let overrides = store.game.groundOverrides(at: store.now, field: field)
        for y in 0..<field.size.height {
            for x in 0..<field.size.width {
                let p = GridPoint(x, y)
                let stats = field.stats(at: p)
                var v = engine.visual(for: stats, at: p)
                if let forced = overrides[p] {
                    v.ground = forced
                    v.overlays = []
                }
                let old = visuals[p]
                if old == v && !overlayChanged && !overlay { continue }
                visuals[p] = v
                let c = TileMath.centre(p)

                // Ground
                let ground: SKSpriteNode
                if let g = groundNodes[p] {
                    ground = g
                    if old?.ground != v.ground { configure(g, sprite: v.ground, variant: .normal, store: store) }
                } else {
                    ground = makeSprite(v.ground, store: store)
                    ground.position = c
                    ground.zPosition = -1000
                    world.addChild(ground)
                    groundNodes[p] = ground
                }

                // Overlays (stacked influence layers)
                if old?.overlays != v.overlays {
                    overlayNodes[p]?.forEach { $0.removeFromParent() }
                    var made: [SKSpriteNode] = []
                    for (i, o) in v.overlays.enumerated() {
                        let n = makeSprite(o.sprite, store: store)
                        n.position = c
                        n.xScale = o.flipped ? -1 : 1
                        n.zPosition = -999 + 0.01 * CGFloat(i)
                        world.addChild(n)
                        made.append(n)
                    }
                    overlayNodes[p] = made
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
                    for d in v.decorations {
                        let n = makeSprite(d.sprite, store: store)
                        n.position = CGPoint(x: c.x + (CGFloat(d.offsetX) * 0.8).rounded(), y: c.y - CGFloat(d.offsetY + 3))
                        n.xScale = d.flipped ? -1 : 1
                        n.zPosition = TileMath.z(forSceneY: n.position.y)
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
            .spore: (0.2, 0.4, 1.0), .glow: (0.4, 1.0, 1.0), .bloom: (1.0, 0.45, 0.75),
            .verdure: (0.3, 0.9, 0.3), .shimmer: (0.65, 0.65, 0.7), .spirit: (0.45, 0.2, 0.6),
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

    /// Places an object node standing on a tile, depth-sorted by where it stands.
    private func stand(_ n: SKSpriteNode, on tile: GridPoint, layer: CGFloat) {
        n.position = TileMath.feet(tile)
        n.zPosition = TileMath.z(forSceneY: n.position.y, layer: layer)
        tag(n, tile)
    }

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
            stand(n, on: s.tile, layer: 0.002)
            n.setScale(0.2)
            n.run(SKAction.scale(to: 1, duration: 0.3))
            // Gentle idle hop so collectibles read as interactive.
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
                stand(n, on: seed.tile, layer: 0.001)
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
            let art = store.art(for: c)
            let n = makeSprite(art.0, variant: art.1, store: store)
            stand(n, on: p.tile, layer: 0.003)
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

    /// Wanderers waiting to be befriended: bob gently.
    private func syncVisitors(_ store: GameStore) {
        let current = Dictionary(uniqueKeysWithValues: store.state.visitors.map { ($0.id, $0) })
        for (id, node) in visitorNodes where current[id] == nil {
            node.run(SKAction.sequence([SKAction.fadeOut(withDuration: 0.3), SKAction.removeFromParent()]))
            visitorNodes[id] = nil
        }
        for (id, v) in current where visitorNodes[id] == nil {
            guard let def = store.content.creatures[v.speciesID] else { continue }
            let n = makeSprite(def.sprite, store: store)
            stand(n, on: v.tile, layer: 0.003)
            n.run(SKAction.repeatForever(SKAction.sequence([
                SKAction.moveBy(x: 0, y: 2, duration: 0.8), SKAction.moveBy(x: 0, y: -2, duration: 0.8),
            ])))
            world.addChild(n)
            visitorNodes[id] = n
        }
    }

    private func syncSelection(_ store: GameStore) {
        if let tile = store.selectedTile {
            let c = TileMath.centre(tile)
            let s = TileMath.size
            selectionNode.path = CGPath(rect: CGRect(x: c.x - s / 2, y: c.y - s / 2, width: s, height: s), transform: nil)
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
            let reach = store.tuning.falloff.reach(p.radius)
            let r = max(0.5, reach - 0.5) * TileMath.size
            let ring = SKShapeNode(circleOfRadius: r)
            ring.position = TileMath.centre(p.tile)
            ring.strokeColor = UIColor(white: 1, alpha: 0.75)
            ring.lineWidth = 1
            ring.fillColor = UIColor(white: 1, alpha: 0.07)
            ring.zPosition = -450
            ring.isAntialiased = false
            world.addChild(ring)
            ringNodes[p.id] = ring
        }
    }
}
