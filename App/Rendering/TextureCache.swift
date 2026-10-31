import CoreGraphics
import SpriteKit
import SwiftUI
import UndergrowthCore

/// Turns sprite data from the registry into CGImages / SKTextures, cached per
/// sprite id + variant. All textures use nearest-neighbor filtering so pixels stay crisp.
final class TextureCache {
    let registry: SpriteRegistry

    private struct Key: Hashable {
        let id: String
        let variant: RenderVariant
    }
    private var images: [Key: [CGImage]] = [:]
    private var textures: [Key: [SKTexture]] = [:]

    init(registry: SpriteRegistry) {
        self.registry = registry
    }

    /// Call after registering new sprites (e.g. from the future sprite editor).
    func invalidate() {
        images.removeAll()
        textures.removeAll()
    }

    func images(_ id: String, variant: RenderVariant = .normal) -> [CGImage] {
        let key = Key(id: id, variant: variant)
        if let cached = images[key] { return cached }
        let sprite = registry.sprite(id)
        let frames = (0..<max(1, sprite.frames.count)).compactMap { frame in
            TextureCache.makeImage(registry.pixels(id, frame: frame, variant: variant))
        }
        images[key] = frames
        return frames
    }

    func image(_ id: String, variant: RenderVariant = .normal, frame: Int = 0) -> CGImage? {
        let all = images(id, variant: variant)
        guard !all.isEmpty else { return nil }
        return all[frame % all.count]
    }

    func textures(_ id: String, variant: RenderVariant = .normal) -> [SKTexture] {
        let key = Key(id: id, variant: variant)
        if let cached = textures[key] { return cached }
        let made = images(id, variant: variant).map { img -> SKTexture in
            let t = SKTexture(cgImage: img)
            t.filteringMode = .nearest
            return t
        }
        textures[key] = made
        return made
    }

    func durations(_ id: String) -> [Double] {
        registry.sprite(id).frames.map { $0.duration ?? 0.25 }
    }

    /// SpriteKit anchor point (0...1, origin bottom-left) from the sprite's pixel anchor.
    func anchorPoint(_ id: String) -> CGPoint {
        let s = registry.sprite(id)
        let a = s.anchorPoint
        let w = Double(max(1, s.width)), h = Double(max(1, s.height))
        return CGPoint(x: a.x / w, y: 1 - a.y / h)
    }

    func size(_ id: String) -> CGSize {
        let s = registry.sprite(id)
        return CGSize(width: s.width, height: s.height)
    }

    static func makeImage(_ buf: PixelBuffer) -> CGImage? {
        guard buf.width > 0, buf.height > 0 else { return nil }
        // CoreGraphics wants premultiplied alpha.
        var bytes = buf.bytes
        for i in stride(from: 0, to: bytes.count, by: 4) {
            let a = UInt16(bytes[i + 3])
            if a < 255 {
                bytes[i] = UInt8(UInt16(bytes[i]) * a / 255)
                bytes[i + 1] = UInt8(UInt16(bytes[i + 1]) * a / 255)
                bytes[i + 2] = UInt8(UInt16(bytes[i + 2]) * a / 255)
            }
        }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        return CGImage(width: buf.width, height: buf.height, bitsPerComponent: 8, bitsPerPixel: 32,
                       bytesPerRow: buf.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}

// MARK: - SwiftUI

/// Draws a data sprite in SwiftUI at an integer pixel scale, animating if it has frames.
struct SpriteImage: View {
    @EnvironmentObject var store: GameStore
    let id: String
    var variant: RenderVariant = .normal
    /// Points per art pixel.
    var scale: CGFloat = 3
    var animated: Bool = true

    var body: some View {
        let frames = store.textures.images(id, variant: variant)
        let size = store.textures.size(id)
        Group {
            if animated && frames.count > 1 {
                let durations = store.textures.durations(id)
                let total = max(0.05, durations.reduce(0, +))
                TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                    let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: total)
                    pixelImage(frames[SpriteImage.frameIndex(at: t, durations: durations)])
                }
            } else if let first = frames.first {
                pixelImage(first)
            } else {
                Color.clear
            }
        }
        .frame(width: size.width * scale, height: size.height * scale)
    }

    private func pixelImage(_ img: CGImage) -> some View {
        Image(decorative: img, scale: 1)
            .interpolation(.none)
            .resizable()
    }

    static func frameIndex(at t: Double, durations: [Double]) -> Int {
        var acc = 0.0
        for (i, d) in durations.enumerated() {
            acc += d
            if t < acc { return i }
        }
        return max(0, durations.count - 1)
    }
}
