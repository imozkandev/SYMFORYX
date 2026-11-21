import AppKit
import SwiftUI

// MARK: - Rich Native Markdown + Code Cards Renderer

struct RichMarkdownMessageView: View {
    @EnvironmentObject var store: SymforyxStore
    let text: String
    let messageId: String

    var segments: [MarkdownSegment] {
        parseMarkdownSegments(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(segments) { seg in
                if seg.isCode {
                    VStack(spacing: 0) {
                        HStack(spacing: 8) {
                            Text(seg.filename ?? seg.language)
                                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.secondary)
                            if seg.filename != nil {
                                Text(seg.language)
                                    .font(.system(size: 9.5, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                            }
                            Spacer()
                            if let fname = seg.filename, store.activeRootPath != nil {
                                Button {
                                    Task { await store.createLocalFile(path: fname, content: seg.content) }
                                } label: {
                                    Label(store.l10n.t("Diske Yaz", "Write File"), systemImage: "square.and.arrow.down")
                                        .font(.system(size: 10))
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.mini)
                            }
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(seg.content, forType: .string)
                                store.showToast(store.l10n.t("Kod kopyalandı", "Code copied"))
                            } label: {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 10))
                            }
                            .buttonStyle(.borderless)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.primary.opacity(0.05))

                        Divider()

                        ScrollView(.horizontal, showsIndicators: true) {
                            Text(seg.content)
                                .font(.system(size: 11.5, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                        }
                    }
                    .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
                } else {
                    if let attr = try? AttributedString(
                        markdown: seg.content,
                        options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                    ) {
                        Text(attr)
                            .textSelection(.enabled)
                            .font(.body)
                            .lineSpacing(3)
                    } else {
                        Text(seg.content)
                            .textSelection(.enabled)
                            .font(.body)
                            .lineSpacing(3)
                    }
                }
            }
        }
    }
}

// MARK: - Tools & MCP Workbench View

struct ToolsWorkbenchView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var mcpUrl = ""
    @State private var mcpStatus: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.l10n.t("Araçlar & MCP Sunucuları", "Tools & MCP Servers"))
                            .font(.title3.bold())
                        Text(store.l10n.t(
                            "Yerleşik araç izinlerini yönet veya herhangi bir MCP sunucusunu URL ile bağla.",
                            "Manage built-in tool permissions or connect any external MCP server by URL."
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(store.l10n.t("Yenile", "Refresh")) {
                        Task { await store.refreshBootstrap() }
                    }
                }

                // MCP Discovery Bar
                HStack(spacing: 8) {
                    TextField("https://mcp.example.com/sse", text: $mcpUrl)
                        .textFieldStyle(.roundedBorder)
                    Button(store.l10n.t("MCP Keşfet", "Discover MCP")) {
                        let u = mcpUrl.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !u.isEmpty else { return }
                        Task {
                            mcpStatus = await store.discoverMcp(url: u)
                            mcpUrl = ""
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(mcpUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let st = mcpStatus {
                    Text(st).font(.caption).foregroundStyle(.secondary)
                }

                // Tools Grid
                VStack(spacing: 8) {
                    ForEach(store.tools) { tool in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(tool.name).font(.callout.weight(.semibold))
                                    Text(tool.category ?? tool.type ?? "tool")
                                        .font(.system(size: 10, design: .monospaced))
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
                                }
                                Text(tool.description ?? "")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                            Picker("", selection: Binding(
                                get: { tool.policy ?? "allow_always" },
                                set: { newPolicy in
                                    Task { await store.setToolPolicy(toolId: tool.id, policy: newPolicy) }
                                }
                            )) {
                                Text(store.l10n.t("Her Zaman İzin Ver", "Allow Always")).tag("allow_always")
                                Text(store.l10n.t("Her Seferinde Sor", "Ask Every Time")).tag("ask_every_time")
                                Text(store.l10n.t("Engelle", "Block")).tag("block")
                            }
                            .labelsHidden()
                            .frame(width: 150)
                        }
                        .padding(12)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
                    }
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Memory & Settings Workbench View

struct SettingsWorkbenchView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var newMemoryText = ""
    @State private var newMemoryScope = "project"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(store.l10n.t("Hafıza & Stüdyo Ayarları", "Memory & Studio Settings"))
                    .font(.title3.bold())

                // Craft, Optimizer & Runtime Controls
                VStack(alignment: .leading, spacing: 10) {
                    Text(store.l10n.t("Zanaat & Optimizasyon", "Craft & Optimization"))
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)

                    Toggle(isOn: Binding(
                        get: { store.aiSlopBlockerEnabled },
                        set: { _ in Task { await store.toggleSlopBlocker() } }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("AI Slop Blocker (Strict Craft Mode)").font(.callout.weight(.medium))
                            Text(store.l10n.t(
                                "Klişe metinleri, yağcı açılışları ve mor-neon AI-slop arayüzleri otomatik engeller.",
                                "Blocks cliché prose, sycophancy, and purple-neon UI slop with live Craft Score."
                            ))
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }

                    Toggle(isOn: Binding(
                        get: { store.tokenOptimizationEnabled },
                        set: { _ in Task { await store.toggleTokenOptimization() } }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.l10n.t("Token & Maliyet Optimizasyonu", "Token & Cost Optimizer")).font(.callout.weight(.medium))
                            Text(store.l10n.t(
                                "Sabitlenen mesajları koruyarak eski uzun bağlamı sıkıştırır ve token tasarrufu sağlar.",
                                "Compresses older verbose turns while protecting pinned messages to save tokens."
                            ))
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }

                    Toggle(isOn: Binding(
                        get: { store.economyMode },
                        set: { _ in Task { await store.toggleEconomyMode() } }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.l10n.t("Ekonomi Modu", "Economy Mode")).font(.callout.weight(.medium))
                            Text(store.l10n.t(
                                "Kısa ve basit istekleri düşük maliyetli hızlı modellere yönlendirir.",
                                "Routes short/simple requests to low-cost fast models automatically."
                            ))
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }

                    Toggle(isOn: $store.autoApplyEdits) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.l10n.t("Kod Değişikliklerini Diske Otomatik Uygula", "Auto-Apply Code Edits to Disk")).font(.callout.weight(.medium))
                            Text(store.l10n.t(
                                "Bağlı proje klasöründe modelin ürettiği dosya bloklarını otomatik yazar.",
                                "Automatically writes file-annotated code fences straight into the open project folder."
                            ))
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(14)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))

                // Local Web UI Access Card
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(store.l10n.t("Yerel Web Arayüzü (Tarayıcı / WebView)", "Local Web UI (Browser Access)"))
                            .font(.callout.weight(.semibold))
                        Text("\(store.baseURL.absoluteString) — \(store.l10n.t("Aynı yerel veritabanı ve projelerle tarayıcıda da açabilirsin.", "Open the companion web UI in your browser backed by the exact same local DB."))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(store.l10n.t("Web Arayüzünü Aç", "Open Web UI")) {
                        store.openLocalWebUI()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(14)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))

                // Project & Personal Memory CRUD
                VStack(alignment: .leading, spacing: 10) {
                    Text(store.l10n.t("Proje & Kişisel Hafıza", "Project & Personal Memory"))
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        Picker("", selection: $newMemoryScope) {
                            Text(store.l10n.t("Proje", "Project")).tag("project")
                            Text(store.l10n.t("Kişisel", "Personal")).tag("personal")
                        }
                        .labelsHidden()
                        .frame(width: 100)

                        TextField(
                            store.l10n.t("Hafıza kuralı ekle (ör. TypeScript strict kullan, mor gradyan kullanma)...", "Add memory note (e.g. Use strict TypeScript, no purple gradients)..."),
                            text: $newMemoryText
                        )
                        .textFieldStyle(.roundedBorder)

                        Button(store.l10n.t("Ekle", "Add")) {
                            let txt = newMemoryText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !txt.isEmpty else { return }
                            newMemoryText = ""
                            Task { await store.addMemory(scope: newMemoryScope, content: txt) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(newMemoryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    if store.memories.isEmpty {
                        Text(store.l10n.t("Henüz kayıtlı hafıza yok.", "No saved memories yet."))
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        ForEach(store.memories) { mem in
                            HStack {
                                Text(mem.scope.uppercased())
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
                                Text(mem.content).font(.caption)
                                Spacer()
                                Button(role: .destructive) {
                                    Task { await store.deleteMemory(mem.id) }
                                } label: {
                                    Image(systemName: "trash").font(.caption2)
                                }
                                .buttonStyle(.borderless)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
                .padding(14)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await store.refreshMemories() }
    }
}

// MARK: - Native Command Palette Sheet (⌘K)

struct CommandPaletteSheet: View {
    @EnvironmentObject var store: SymforyxStore
    @Binding var isPresented: Bool
    @State private var query = ""

    var matchingCommands: [SlashCommandDTO] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return Array(store.commands.prefix(12)) }
        return store.commands.filter {
            $0.command.lowercased().contains(q)
                || ($0.descEn?.lowercased().contains(q) ?? false)
                || ($0.descTr?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(store.l10n.t("Komut, şema veya eylem ara...", "Search commands, actions, or threads..."), text: $query)
                    .textFieldStyle(.plain)
                    .font(.body)
                Button(store.l10n.t("Kapat", "Close")) { isPresented = false }
                    .buttonStyle(.borderless)
                    .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(12)

            Divider()

            List {
                Section(store.l10n.t("Hızlı Eylemler", "Quick Actions")) {
                    Button(store.l10n.t("Mac'ten Proje Klasörü Aç (Yeni Sohbet)", "Open Local Folder on Mac (New Chat)")) {
                        isPresented = false
                        store.openFolderFromMac(inCurrentChat: false)
                    }
                    Button(store.l10n.t("Yeni Sohbet Başlat", "Start New Chat")) {
                        isPresented = false
                        store.navSection = .chat
                        Task { await store.createNewThread() }
                    }
                    Button(store.l10n.t("Yerel Web Arayüzünü Tarayıcıda Aç", "Open Local Web UI in Browser")) {
                        isPresented = false
                        store.openLocalWebUI()
                    }
                    Button(store.l10n.t("14 Hazır Stüdyo Şemasını Aç", "Open 14 Ready Studio Schemas")) {
                        isPresented = false
                        store.navSection = .flows
                    }
                }

                Section(store.l10n.t("Slash Komutları", "Slash Commands")) {
                    ForEach(matchingCommands) { cmd in
                        Button {
                            store.navSection = .chat
                            store.draftText = "\(cmd.command) "
                            isPresented = false
                        } label: {
                            HStack {
                                Text(cmd.command)
                                    .font(.system(.caption, design: .monospaced).bold())
                                    .foregroundStyle(Color.accentColor)
                                Text(store.language == .tr ? (cmd.descTr ?? cmd.descEn ?? "") : (cmd.descEn ?? cmd.descTr ?? ""))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 360)
        }
        .frame(width: 520)
    }
}
