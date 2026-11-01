import CoreGraphics
import UndergrowthCore

/// Top-down projection. Tiles are 16×16 art pixels; scene space is SpriteKit's (y up),
/// one scene unit = one art pixel. Grid row 0 is at the top of the screen.
enum TileMath {
    static let size: CGFloat = 16
    /// Objects stand a little below the tile centre.
    static let foot: CGFloat = 5

    /// Centre of a tile.
    static func centre(_ p: GridPoint) -> CGPoint {
        CGPoint(x: CGFloat(p.x) * size + size / 2, y: -(CGFloat(p.y) * size + size / 2))
    }

    /// Where an object on this tile stands.
    static func feet(_ p: GridPoint) -> CGPoint {
        let c = centre(p)
        return CGPoint(x: c.x, y: c.y - foot)
    }

    /// The tile containing a scene point.
    static func tile(at pt: CGPoint) -> GridPoint {
        GridPoint(Int((pt.x / size).rounded(.down)), Int((-pt.y / size).rounded(.down)))
    }

    /// Draw order: things lower on screen are in front.
    static func z(forSceneY y: CGFloat, layer: CGFloat = 0) -> CGFloat { -y * 0.01 + layer }
}
