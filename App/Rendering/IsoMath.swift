import CoreGraphics
import UndergrowthCore

/// Isometric projection. Tiles are 2:1 diamonds, 32×16 art pixels.
/// Scene space is SpriteKit's (y up); one scene unit = one art pixel.
enum Iso {
    static let tileW: CGFloat = 32
    static let tileH: CGFloat = 16
    static var halfW: CGFloat { tileW / 2 }
    static var halfH: CGFloat { tileH / 2 }

    /// Center of a tile's top diamond.
    static func point(_ p: GridPoint) -> CGPoint {
        CGPoint(x: CGFloat(p.x - p.y) * halfW, y: -CGFloat(p.x + p.y) * halfH)
    }

    /// The tile whose diamond contains a scene point.
    static func tile(at pt: CGPoint) -> GridPoint {
        let fx = pt.x / halfW, fy = -pt.y / halfH
        let gx = (fx + fy) / 2, gy = (fy - fx) / 2
        return GridPoint(Int(gx.rounded()), Int(gy.rounded()))
    }

    /// Draw-order depth: tiles further "back" (smaller x+y) draw first.
    static func depth(_ p: GridPoint) -> CGFloat { CGFloat(p.x + p.y) }

    /// A grid-space circle of `radius` tiles projects to this ellipse (axis aligned).
    static func ellipseRadii(forGridRadius r: Double) -> CGSize {
        CGSize(width: CGFloat(r) * halfW * 2.0.squareRoot(), height: CGFloat(r) * halfH * 2.0.squareRoot())
    }

    /// Scene-space bounds of the whole grid.
    static func worldBounds(_ size: GridSize) -> CGRect {
        let left = point(GridPoint(0, size.height - 1)).x - halfW
        let right = point(GridPoint(size.width - 1, 0)).x + halfW
        let top = point(GridPoint(0, 0)).y + halfH
        let bottom = point(GridPoint(size.width - 1, size.height - 1)).y - halfH - 8
        return CGRect(x: left, y: bottom, width: right - left, height: top - bottom)
    }

    static func diamondPath(at p: GridPoint) -> CGPath {
        let c = point(p)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: c.x, y: c.y + halfH))
        path.addLine(to: CGPoint(x: c.x + halfW, y: c.y))
        path.addLine(to: CGPoint(x: c.x, y: c.y - halfH))
        path.addLine(to: CGPoint(x: c.x - halfW, y: c.y))
        path.closeSubpath()
        return path
    }
}
