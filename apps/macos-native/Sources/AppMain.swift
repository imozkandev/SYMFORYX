import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    var onQuit: (() -> Void)?
    func applicationWillTerminate(_ notification: Notification) {
        onQuit?()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
struct SymforyxNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = SymforyxStore()

    var body: some Scene {
        WindowGroup("SYMFORYX") {
            RootView()
                .environmentObject(store)
                .frame(minWidth: 1040, minHeight: 680)
                .task {
                    appDelegate.onQuit = { [weak store] in
                        Task { @MainActor in store?.shutdownBackend() }
                    }
                    await store.bootBackend()
                }
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(store.l10n.t("Yeni Sohbet", "New Thread")) {
                    Task {
                        store.navSection = .chat
                        await store.createNewThread()
                    }
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}
