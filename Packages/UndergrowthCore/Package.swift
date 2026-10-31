// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "UndergrowthCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "UndergrowthCore", targets: ["UndergrowthCore"]),
    ],
    targets: [
        .target(name: "UndergrowthCore"),
        // Renders a forest to a PPM image using the real simulation and rules.
        // `swift run forest-preview <ResourcesDir> <out.ppm>` — handy for checking
        // content changes without a device.
        .executableTarget(name: "forest-preview", dependencies: ["UndergrowthCore"]),
        .testTarget(name: "UndergrowthCoreTests", dependencies: ["UndergrowthCore"]),
    ]
)
