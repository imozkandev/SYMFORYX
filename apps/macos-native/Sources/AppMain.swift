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
        WindowGroup("SYMFORYX — All AI Models & Tools in One Studio") {
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

                Button(store.l10n.t("Proje Klasörü Aç…", "Open Folder…")) {
                    store.openFolderFromMac(inCurrentChat: false)
                }
                .keyboardShortcut("o", modifiers: .command)

                Divider()

                Button(store.l10n.t("Komut Paleti", "Command Palette")) {
                    store.showCommandPalette.toggle()
                }
                .keyboardShortcut("k", modifiers: .command)

                Button(store.l10n.t("Proje Terminali", "Toggle Terminal")) {
                    store.showTerminalDrawer.toggle()
                }
                .keyboardShortcut("j", modifiers: .command)

                Button(store.l10n.t("Yerel Web Arayüzünü Aç", "Open Local Web UI")) {
                    store.openLocalWebUI()
                }
                .keyboardShortcut("w", modifiers: [.command, .shift])
            }
        }
    }
}
