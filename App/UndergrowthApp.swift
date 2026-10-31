import SwiftUI
import UndergrowthCore

@main
struct UndergrowthApp: App {
    @StateObject private var boot = Bootstrapper()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if let store = boot.store {
                    ForestScreen()
                        .environmentObject(store)
                } else if let error = boot.error {
                    VStack(spacing: 12) {
                        Text("Couldn't load the forest").font(.headline)
                        Text(error).font(.footnote).multilineTextAlignment(.center)
                    }
                    .padding()
                } else {
                    ProgressView()
                }
            }
            .preferredColorScheme(.dark)
            .onChange(of: scenePhase) { _, phase in
                boot.store?.handleScenePhase(phase)
            }
        }
    }
}

@MainActor
final class Bootstrapper: ObservableObject {
    @Published var store: GameStore?
    @Published var error: String?

    init() {
        do {
            let content = try GameStore.loadContent()
            store = GameStore(content: content, saveStore: SaveStore(url: SaveStore.defaultURL()))
        } catch {
            self.error = "\(error)"
        }
    }
}
