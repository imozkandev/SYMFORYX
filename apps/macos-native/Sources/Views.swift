import AppKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: SymforyxStore

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 240, ideal: 268, max: 340)
        } detail: {
            Group {
                if !store.serverReady {
                    VStack(spacing: 12) {
                        if let err = store.serverError {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.title)
                                .foregroundStyle(.orange)
                            Text(err).font(.callout).multilineTextAlignment(.center).padding(.horizontal)
                        } else {
                            ProgressView()
                            Text("SYMFORYX...").font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    switch store.navSection {
                    case .chat:
                        HSplitView {
                            ChatWorkbenchView()
                                .frame(minWidth: 500)
                            if store.showInspector {
                                WorkspaceInspectorView()
                                    .frame(minWidth: 360, idealWidth: 440, maxWidth: 680)
                            }
                        }
                    case .quotas:
                        QuotasDashboardView()
                    case .flows:
                        FlowsWorkbenchView()
                    case .tools:
                        ToolsWorkbenchView()
                    case .providers:
                        ProvidersWorkbenchView()
                    case .settings:
                        SettingsWorkbenchView()
                    }
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .automatic) {
                    // Open Local Mac Project Folder (always opens new chat)
                    Button {
                        store.openFolderFromMac(inCurrentChat: false)
                    } label: {
                        Image(systemName: "folder.badge.plus")
                    }
                    .help(store.l10n.t("Mac'ten proje klasörü aç (yeni sohbet)", "Open local project folder (new chat)"))

                    // Toggle Built-in Terminal Drawer
                    if store.navSection == .chat {
                        Button {
                            store.showTerminalDrawer.toggle()
                        } label: {
                            Image(systemName: "terminal")
                                .foregroundStyle(store.showTerminalDrawer ? Color.accentColor : .primary)
                        }
                        .help(store.l10n.t("Proje Terminali (⌘J)", "Toggle Project Terminal (⌘J)"))
                    }

                    // Navbar Outgoing Tokens + Remaining Tokens + Optimizer Toggle
                    Button {
                        Task { await store.toggleTokenOptimization() }
                    } label: {
                        HStack(spacing: 5) {
                            Text("\(store.l10n.t("Giden", "Out")): \(store.fmtTok(store.threadOutgoingTokens))")
                            Text("·").foregroundStyle(.tertiary)
                            Text("\(store.l10n.t("Kalan", "Left")): \(store.fmtTok(store.remainingContextTokens))")
                                .foregroundStyle(Color.accentColor)
                            Text("OPT \(store.tokenOptimizationEnabled ? "ON" : "OFF")")
                                .foregroundStyle(store.tokenOptimizationEnabled ? .green : .secondary)
                        }
                        .font(.system(size: 11, design: .monospaced))
                    }
                    .help(store.l10n.t("Giden/Kalan token · Token optimizasyonunu aç/kapat", "Outgoing/Remaining tokens · Toggle optimizer"))

                    // Native AI Slop Blocker Toggle
                    Button {
                        Task { await store.toggleSlopBlocker() }
                    } label: {
                        Text("ANTI-SLOP \(store.aiSlopBlockerEnabled ? "ON" : "OFF")")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(store.aiSlopBlockerEnabled ? Color.accentColor : .secondary)
                    }
                    .help(store.l10n.t("AI Slop Blocker'ı aç/kapat", "Toggle AI Slop Blocker"))

                    // Instant Thread + Monthly Cost readout
                    Button {
                        store.navSection = .quotas
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "gauge.with.dots.needle.33percent")
                            Text(String(format: "$%.4f", store.threadTotalCostUsd))
                                .font(.system(size: 11, design: .monospaced))
                        }
                    }
                    .help(store.l10n.t("Bu sohbet / Aylık toplam maliyet", "Thread / Monthly total cost"))

                    // Clean 1-Click Language Toggle (zero macOS 26 overlap)
                    Button {
                        store.setLanguage(store.language == .en ? .tr : .en)
                    } label: {
                        Text(store.language.label)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    .help(store.l10n.t("Dili değiştir (EN / TR)", "Switch language (EN / TR)"))

                    // Clean Theme Menu (Light / Dark / System — zero macOS 26 overlap)
                    Menu {
                        Button {
                            store.setAppearance(.light)
                        } label: {
                            Label(store.l10n.t("Açık Tema", "Light"), systemImage: "sun.max")
                        }
                        Button {
                            store.setAppearance(.dark)
                        } label: {
                            Label(store.l10n.t("Koyu Tema", "Dark"), systemImage: "moon")
                        }
                        Button {
                            store.setAppearance(.system)
                        } label: {
                            Label(store.l10n.t("Sistem", "System"), systemImage: "laptopcomputer")
                        }
                    } label: {
                        Image(systemName: store.appearance == .light ? "sun.max" : store.appearance == .dark ? "moon" : "laptopcomputer")
                    }
                    .help(store.l10n.t("Tema (Açık / Koyu / Sistem)", "Theme (Light / Dark / System)"))

                    // Command Palette (⌘K)
                    Button {
                        store.showCommandPalette = true
                    } label: {
                        Image(systemName: "command")
                    }
                    .help("Command Palette (⌘K)")

                    // Open Local Web UI in Browser
                    Button {
                        store.openLocalWebUI()
                    } label: {
                        Image(systemName: "globe")
                    }
                    .help(store.l10n.t("Yerel Web Arayüzünü Tarayıcıda Aç (⌘⇧W)", "Open Local Web UI in Browser (⌘⇧W)"))

                    if store.navSection == .chat {
                        Button {
                            store.showInspector.toggle()
                        } label: {
                            Image(systemName: "sidebar.right")
                                .foregroundStyle(store.showInspector ? Color.accentColor : .primary)
                        }
                        .help(store.l10n.t("Kod Editörü / Git Diff / Artefakt Paneli", "Editor / Git Diff / Artifacts Inspector"))
                    }
                }
            }
        }
        .sheet(isPresented: $store.showCommandPalette) {
            CommandPaletteSheet(isPresented: $store.showCommandPalette)
        }
        .overlay(alignment: .bottomTrailing) {
            if let toast = store.statusToast {
                Text(toast)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.12)))
                    .padding(16)
            }
        }
        .preferredColorScheme(
            store.appearance == .light ? .light : store.appearance == .dark ? .dark : nil
        )
        .onChange(of: store.artifacts.count) { _, newCount in
            if newCount > 0 && store.openFilePath == nil {
                store.inspectorTab = .artifacts
                store.showInspector = true
            }
        }
        .onChange(of: store.activeProjectId) { _, newProjId in
            Task {
                store.openFilePath = nil
                store.openFileContent = ""
                store.openFileDirty = false
                await store.refreshLocalProject()
                let currentBelongs = store.threads.contains(where: { $0.id == store.activeThreadId && $0.projectId == newProjId })
                if !currentBelongs, let next = store.threads.first(where: { $0.projectId == newProjId }) {
                    await store.selectThread(next.id)
                }
            }
        }
    }
}

// MARK: - Minimal SYMFORYX Geometric Brand Mark (Native SwiftUI Vector)

struct SymforyxLogoMark: View {
    var size: CGFloat = 22

    var body: some View {
        Canvas { ctx, sz in
            let s = min(sz.width, sz.height) / 64.0
            let bgRect = Path(roundedRect: CGRect(x: 2 * s, y: 2 * s, width: 60 * s, height: 60 * s), cornerRadius: 15 * s)
            ctx.fill(bgRect, with: .color(Color(red: 0.067, green: 0.067, blue: 0.075)))

            var leftRail = Path()
            leftRail.move(to: CGPoint(x: 12 * s, y: 27 * s))
            leftRail.addLine(to: CGPoint(x: 12 * s, y: 37 * s))
            ctx.stroke(leftRail, with: .color(Color.white.opacity(0.32)), style: StrokeStyle(lineWidth: 2.3 * s, lineCap: .round))

            var rightRail = Path()
            rightRail.move(to: CGPoint(x: 52 * s, y: 27 * s))
            rightRail.addLine(to: CGPoint(x: 52 * s, y: 37 * s))
            ctx.stroke(rightRail, with: .color(Color.white.opacity(0.32)), style: StrokeStyle(lineWidth: 2.3 * s, lineCap: .round))

            var upper = Path()
            upper.move(to: CGPoint(x: 44.5 * s, y: 21 * s))
            upper.addCurve(to: CGPoint(x: 32 * s, y: 14 * s), control1: CGPoint(x: 43.6 * s, y: 16.2 * s), control2: CGPoint(x: 38.6 * s, y: 14 * s))
            upper.addCurve(to: CGPoint(x: 19.5 * s, y: 22 * s), control1: CGPoint(x: 24.2 * s, y: 14 * s), control2: CGPoint(x: 19.5 * s, y: 17.2 * s))
            upper.addCurve(to: CGPoint(x: 27.6 * s, y: 30 * s), control1: CGPoint(x: 19.5 * s, y: 26.2 * s), control2: CGPoint(x: 23.1 * s, y: 28.4 * s))
            ctx.stroke(upper, with: .color(Color(red: 0.96, green: 0.96, blue: 0.95)), style: StrokeStyle(lineWidth: 4.5 * s, lineCap: .round))

            var lower = Path()
            lower.move(to: CGPoint(x: 19.5 * s, y: 43 * s))
            lower.addCurve(to: CGPoint(x: 32 * s, y: 50 * s), control1: CGPoint(x: 20.4 * s, y: 47.8 * s), control2: CGPoint(x: 25.4 * s, y: 50 * s))
            lower.addCurve(to: CGPoint(x: 44.5 * s, y: 42 * s), control1: CGPoint(x: 39.8 * s, y: 50 * s), control2: CGPoint(x: 44.5 * s, y: 46.8 * s))
            lower.addCurve(to: CGPoint(x: 36.4 * s, y: 34 * s), control1: CGPoint(x: 44.5 * s, y: 37.8 * s), control2: CGPoint(x: 40.9 * s, y: 35.6 * s))
            ctx.stroke(lower, with: .color(Color(red: 0.96, green: 0.96, blue: 0.95)), style: StrokeStyle(lineWidth: 4.5 * s, lineCap: .round))

            let node = Path(ellipseIn: CGRect(x: 28.2 * s, y: 28.2 * s, width: 7.6 * s, height: 7.6 * s))
            ctx.fill(node, with: .color(Color(red: 0.231, green: 0.51, blue: 0.965)))
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Native macOS Sidebar

struct SidebarView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var showNewWorkspaceSheet = false
    @State private var showScratchProjectSheet = false
    @State private var showNewFileSheet = false
    @State private var newWorkspaceName = ""
    @State private var newFileName = ""
    @State private var showDeleteConfirm = false

    var projectThreads: [ThreadDTO] {
        store.threads.filter { $0.projectId == store.activeProjectId }
    }

    var activeProject: ProjectDTO? {
        store.projects.first(where: { $0.id == store.activeProjectId })
    }

    var filteredFiles: [LocalFileEntryDTO] {
        let q = store.fileFilterQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return store.projectFiles }
        return store.projectFiles.filter { $0.path.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Brand Header + New Chat
            HStack(spacing: 8) {
                SymforyxLogoMark(size: 22)
                Text("SYMFORYX")
                    .font(.system(size: 12, weight: .bold))
                    .tracking(1.6)
                Spacer()
                Button {
                    Task {
                        store.navSection = .chat
                        await store.createNewThread()
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help(store.l10n.t("Yeni Sohbet", "New Thread"))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)

            Divider()

            // Workspace Selector + Create + Delete (including General Workspace)
            HStack(spacing: 4) {
                if store.projects.isEmpty {
                    Button {
                        showNewWorkspaceSheet = true
                    } label: {
                        Text("+ \(store.l10n.t("Yeni Çalışma Alanı", "New Workspace"))")
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                } else {
                    Picker("", selection: $store.activeProjectId) {
                        ForEach(store.projects) { p in
                            Text(p.name).tag(p.id)
                        }
                    }
                    .labelsHidden()
                }

                Button {
                    showNewWorkspaceSheet = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help(store.l10n.t("Yeni Çalışma Alanı", "New Workspace"))

                if activeProject != nil {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help(store.l10n.t("Çalışma Alanını Sil", "Delete Workspace"))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .alert(store.l10n.t("Çalışma Alanını Sil", "Delete Workspace"), isPresented: $showDeleteConfirm) {
                Button(store.l10n.t("Sil", "Delete"), role: .destructive) {
                    if let id = activeProject?.id {
                        Task { await store.deleteProject(id) }
                    }
                }
                Button(store.l10n.t("İptal", "Cancel"), role: .cancel) {}
            } message: {
                Text("\"\(activeProject?.name ?? "")\" — \(store.l10n.t("bu çalışma alanı ve içindeki tüm sohbetler silinecek.", "this workspace and all its threads will be deleted."))")
            }
            .sheet(isPresented: $showNewWorkspaceSheet) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(store.l10n.t("Yeni Çalışma Alanı", "New Workspace")).font(.headline)
                    TextField(store.l10n.t("Çalışma alanı adı", "Workspace name"), text: $newWorkspaceName)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Spacer()
                        Button(store.l10n.t("İptal", "Cancel")) {
                            newWorkspaceName = ""
                            showNewWorkspaceSheet = false
                        }
                        Button(store.l10n.t("Oluştur", "Create")) {
                            let name = newWorkspaceName
                            newWorkspaceName = ""
                            showNewWorkspaceSheet = false
                            Task { await store.createProject(name: name) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(newWorkspaceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(18)
                .frame(width: 320)
            }

            Divider()

            // Quick Local Mac Project Actions (Open Existing Folder / Create From Scratch)
            HStack(spacing: 6) {
                Button {
                    store.openFolderFromMac()
                } label: {
                    Label(store.l10n.t("Klasör Aç", "Open Folder"), systemImage: "folder")
                        .font(.caption2.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Button {
                    showScratchProjectSheet = true
                } label: {
                    Label(store.l10n.t("Sıfırdan", "New Project"), systemImage: "plus.rectangle.on.folder")
                        .font(.caption2.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .sheet(isPresented: $showScratchProjectSheet) {
                NewScratchProjectSheet(isPresented: $showScratchProjectSheet)
            }
            .sheet(isPresented: $showNewFileSheet) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(store.l10n.t("Yeni Dosya Oluştur", "New File in Project")).font(.headline)
                    TextField("src/app.ts", text: $newFileName)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                    HStack {
                        Spacer()
                        Button(store.l10n.t("İptal", "Cancel")) {
                            newFileName = ""
                            showNewFileSheet = false
                        }
                        Button(store.l10n.t("Oluştur", "Create")) {
                            let target = newFileName
                            newFileName = ""
                            showNewFileSheet = false
                            Task { await store.createLocalFile(path: target, content: "") }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(newFileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(18)
                .frame(width: 340)
            }

            Divider()

            List {
                Section(store.l10n.t("Çalışma Alanı", "Workspace")) {
                    navButton(.chat, icon: "bubble.left.and.bubble.right", title: store.l10n.t("Sohbet Tezgâhı", "Studio Chat"))
                    navButton(.quotas, icon: "gauge.with.dots.needle.33percent", title: store.l10n.t("Kotalar & Maliyet", "Quotas & Cost"), badge: String(format: "$%.2f", store.usage.totalCostUsd))
                    navButton(.flows, icon: "point.3.connected.trianglepath.dotted", title: store.l10n.t("Stüdyo Şemaları", "Studio Schemas"), badge: "\(store.flows.count)")
                    navButton(.tools, icon: "wrench.and.screwdriver", title: store.l10n.t("Araçlar & MCP", "Tools & MCP"), badge: "\(store.tools.count)")
                    navButton(.providers, icon: "cpu", title: store.l10n.t("Modeller & Anahtarlar", "Models & Keys"))
                    navButton(.settings, icon: "slider.horizontal.3", title: store.l10n.t("Hafıza & Ayarlar", "Memory & Settings"))
                }

                if store.activeRootPath != nil {
                    Section {
                        HStack(spacing: 4) {
                            TextField(store.l10n.t("Dosya filtrele…", "Filter files…"), text: $store.fileFilterQuery)
                                .textFieldStyle(.roundedBorder)
                                .controlSize(.small)
                            Button {
                                showNewFileSheet = true
                            } label: {
                                Image(systemName: "doc.badge.plus").font(.caption)
                            }
                            .buttonStyle(.borderless)
                            .help(store.l10n.t("Yeni Dosya", "New File"))

                            Button {
                                Task { await store.refreshLocalProject() }
                            } label: {
                                Image(systemName: "arrow.clockwise").font(.caption)
                            }
                            .buttonStyle(.borderless)

                            Button {
                                store.revealProjectInFinder()
                            } label: {
                                Image(systemName: "arrow.up.right.square").font(.caption)
                            }
                            .buttonStyle(.borderless)
                            .help(store.l10n.t("Finder'da Göster", "Reveal in Finder"))
                        }

                        ForEach(filteredFiles.prefix(120)) { entry in
                            Button {
                                if entry.kind == "file" {
                                    store.navSection = .chat
                                    Task { await store.openLocalFile(entry.path) }
                                }
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: entry.kind == "dir" ? "folder.fill" : "doc.text")
                                        .font(.caption2)
                                        .foregroundStyle(entry.kind == "dir" ? Color.accentColor : .secondary)
                                    Text(entry.name)
                                        .font(.system(size: 11.5, design: .monospaced))
                                        .lineLimit(1)
                                    Spacer()
                                }
                                .padding(.leading, CGFloat(entry.depth * 10))
                                .padding(.vertical, 1)
                                .fontWeight(store.openFilePath == entry.path ? .semibold : .regular)
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        HStack {
                            Text(store.l10n.t("PROJE DOSYALARI", "PROJECT FILES"))
                            Spacer()
                            if let git = store.gitStatus, git.isGitRepo {
                                Text("⎇ \(git.branch)")
                                    .font(.system(size: 9, design: .monospaced))
                            }
                        }
                    }
                }

                Section(store.l10n.t("Sohbetler", "Threads")) {
                    ForEach(projectThreads) { th in
                        Button {
                            store.navSection = .chat
                            Task { await store.selectThread(th.id) }
                        } label: {
                            HStack {
                                Text(th.title).lineLimit(1)
                                Spacer()
                            }
                            .padding(.vertical, 2)
                            .fontWeight(store.activeThreadId == th.id ? .semibold : .regular)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await store.deleteThread(th.id) }
                            } label: {
                                Label(store.l10n.t("Sohbeti Sil", "Delete Thread"), systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()
            HStack {
                Text("SYMFORYX · by ozkandev")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func navButton(_ section: NavSection, icon: String, title: String, badge: String? = nil) -> some View {
        Button {
            store.navSection = section
        } label: {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                if let b = badge {
                    Text(b).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                }
            }
            .fontWeight(store.navSection == section ? .semibold : .regular)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chat Workbench View (Unrestricted Models + Reference Tray)

struct ChatWorkbenchView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var showIdeaSheet = false
    @State private var showUrlSheet = false
    @State private var showScratchSheet = false
    @State private var ideaRole = "inspiration"
    @State private var ideaTitle = ""
    @State private var ideaNote = ""
    @State private var refUrl = ""
    @State private var refUrlNote = ""

    var body: some View {
        VStack(spacing: 0) {
            // Active Local macOS Project Header Bar (Claude Code Desktop Style)
            if let root = store.activeRootPath {
                HStack(spacing: 8) {
                    Image(systemName: "folder.fill")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                    Text((root as NSString).lastPathComponent)
                        .font(.system(.caption, design: .monospaced).bold())
                    Text(root)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let git = store.gitStatus, git.isGitRepo {
                        Text("⎇ \(git.branch) · \(git.changedFiles.count) Δ")
                            .font(.system(size: 10, design: .monospaced))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
                    }
                    Spacer()

                    Button {
                        store.autoApplyEdits.toggle()
                        store.showToast(store.autoApplyEdits
                            ? store.l10n.t("Otomatik Diske Yazma AÇIK", "Auto-Apply Edits ON")
                            : store.l10n.t("Otomatik Diske Yazma KAPALI (Onaylı)", "Auto-Apply Edits OFF (Manual)"))
                    } label: {
                        Text("AUTO-APPLY \(store.autoApplyEdits ? "ON" : "OFF")")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(store.autoApplyEdits ? .green : .secondary)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)

                    Button {
                        store.inspectorTab = .diff
                        store.showInspector = true
                        Task { await store.refreshGitDiff() }
                    } label: {
                        Label("Diff", systemImage: "arrow.left.arrow.right")
                            .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)

                    Button {
                        store.showTerminalDrawer.toggle()
                    } label: {
                        Label("Terminal", systemImage: "terminal")
                            .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color(nsColor: .controlBackgroundColor))
                Divider()
            }

            // Message Feed
            ScrollViewReader { proxy in
                ScrollView {
                    if store.messages.isEmpty {
                        VStack(alignment: .leading, spacing: 18) {
                            HStack(spacing: 12) {
                                SymforyxLogoMark(size: 38)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("SYMFORYX · NATIVE MACOS DESKTOP STUDIO")
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                    Text(store.l10n.t("Yerel Proje & Çoklu Model Tezgâhı", "Local Project & Multi-Model Workbench"))
                                        .font(.title2.bold())
                                }
                            }
                            Text(store.l10n.t(
                                "Mac'inden mevcut bir proje klasörü aç ya da sıfırdan başlat. Dosya oku/yaz, terminal çalıştır, Git diff izle, görsel/kod/3D/müzik üret.",
                                "Open any local folder on your Mac or scaffold a project from scratch. Read/write files, run terminal commands, inspect Git diffs, and orchestrate any AI model."
                            ))
                            .font(.callout)
                            .foregroundStyle(.secondary)

                            // Claude-Code-Style Local Project Launch Cards
                            HStack(spacing: 10) {
                                Button {
                                    store.openFolderFromMac()
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "folder.badge.plus")
                                            .font(.title3)
                                            .foregroundStyle(Color.accentColor)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(store.l10n.t("Bilgisayardan Proje Klasörü Aç", "Open Existing Mac Folder"))
                                                .font(.callout.bold())
                                            Text(store.l10n.t("Mevcut kod tabanında dosya düzenle, terminal ve git kullan", "Edit real files, run commands & view diffs"))
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                    .padding(12)
                                    .frame(maxWidth: .infinity)
                                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.accentColor.opacity(0.35)))
                                }
                                .buttonStyle(.plain)

                                Button {
                                    showScratchSheet = true
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "hammer.fill")
                                            .font(.title3)
                                            .foregroundStyle(Color.accentColor)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(store.l10n.t("Sıfırdan Yeni Proje Başlat", "Create Project From Scratch"))
                                                .font(.callout.bold())
                                            Text(store.l10n.t("TypeScript, Web, Python, Swift veya boş klasör oluştur", "Scaffold TS, Web, Python, Swift or empty"))
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                    .padding(12)
                                    .frame(maxWidth: .infinity)
                                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.12)))
                                }
                                .buttonStyle(.plain)
                            }
                            .sheet(isPresented: $showScratchSheet) {
                                NewScratchProjectSheet(isPresented: $showScratchSheet)
                            }

                            // Live Top Quota Strip
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))], spacing: 8) {
                                ForEach(store.quotas.prefix(4)) { q in
                                    Button {
                                        store.navSection = .quotas
                                    } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(q.displayName).font(.caption.bold()).lineLimit(1)
                                            HStack {
                                                Text(formatQuotaVal(q.remainingAmount, metric: q.metric, lang: store.language))
                                                    .font(.system(.caption, design: .monospaced))
                                                Spacer()
                                                Text(String(format: "$%.3f", q.windowCostUsd))
                                                    .font(.system(size: 10, design: .monospaced))
                                                    .foregroundStyle(.secondary)
                                            }
                                            ProgressView(value: Double(q.percentUsed), total: 100)
                                                .controlSize(.small)
                                            Text("↻ \(formatResetCountdown(q.nextResetAt, lang: store.language))")
                                                .font(.system(size: 10, design: .monospaced))
                                                .foregroundStyle(.secondary)
                                        }
                                        .padding(10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }

                            // Quick Starter Prompts
                            VStack(spacing: 6) {
                                quickRecipe("@gorsel", store.l10n.t("Görsel tasarla → Koda aktar", "Design UI → Code Handoff"), "@gorsel minimalist kahve dükkânı ana ekranı tasarla")
                                quickRecipe("/karsilastir", store.l10n.t("Claude, GPT, Gemini yan yana", "Compare Claude, GPT, Gemini"), "/karsilastir @claude @gpt @gemini TypeScript rate limiter")
                                quickRecipe("/palet", store.l10n.t("Erişilebilir renk paleti üret", "Generate WCAG palette"), "/palet editorial sıcak taş ve koyu grafit arayüz")
                            }
                        }
                        .padding(24)
                        .frame(maxWidth: 760, alignment: .leading)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(store.messages) { msg in
                                NativeMessageRow(msg: msg)
                                    .id(msg.id)
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: 820)
                    }
                }
                .onChange(of: store.messages.count) { _, _ in
                    if let last = store.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            Divider()

            // Collapsible Native Project Terminal Drawer
            if store.showTerminalDrawer {
                NativeTerminalDrawerView()
                Divider()
            }

            // Native Composer + Slash Autocomplete + Reference Tray
            VStack(spacing: 8) {
                // Interactive Slash Command Autocomplete (matches Web UI!)
                if store.draftText.hasPrefix("/") && !store.draftText.contains(" ") {
                    let q = store.draftText.lowercased()
                    let matched = store.commands.filter {
                        $0.command.lowercased().hasPrefix(q)
                            || ($0.aliases?.contains(where: { $0.lowercased().hasPrefix(q) }) ?? false)
                    }
                    if !matched.isEmpty {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(matched.prefix(12)) { cmd in
                                    Button {
                                        store.draftText = "\(cmd.command) "
                                    } label: {
                                        HStack(spacing: 8) {
                                            Text(cmd.command)
                                                .font(.system(.caption, design: .monospaced).bold())
                                                .foregroundStyle(Color.accentColor)
                                                .frame(width: 96, alignment: .leading)
                                            Text(store.language == .tr ? (cmd.descTr ?? cmd.descEn ?? "") : (cmd.descEn ?? cmd.descTr ?? ""))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                            Spacer()
                                            if let cat = cmd.category {
                                                Text(cat)
                                                    .font(.system(size: 9, design: .monospaced))
                                                    .foregroundStyle(.tertiary)
                                            }
                                        }
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(4)
                        }
                        .frame(maxHeight: 190)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.14)))
                    }
                }

                if !store.references.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(store.references) { ref in
                                HStack(spacing: 6) {
                                    Image(systemName: ref.kind == "image" ? "photo" : "lightbulb")
                                        .font(.caption2)
                                    Text("[\(ref.role)] \(ref.title)")
                                        .font(.caption)
                                        .lineLimit(1)
                                    Button {
                                        store.references.removeAll { $0.id == ref.id }
                                    } label: {
                                        Image(systemName: "xmark").font(.caption2)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
                            }
                        }
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        store.l10n.t("İstediğin model/araçla yaz (@flux, @claude, @gpt, /zincir)...", "Write with any model or tool (@flux, @claude, @gpt, /zincir)..."),
                        text: $store.draftText,
                        axis: .vertical
                    )
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .padding(8)
                    .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.14)))
                    .onSubmit { store.sendPrompt() }

                    if store.isStreaming {
                        Button {
                            store.stopStreaming()
                        } label: {
                            Image(systemName: "stop.fill")
                                .fontWeight(.semibold)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .help(store.l10n.t("Durdur", "Stop"))
                    } else {
                        Button {
                            store.sendPrompt()
                        } label: {
                            Image(systemName: "arrow.up")
                                .fontWeight(.semibold)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(store.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && store.references.isEmpty)
                    }
                }

                // Controls Rail: Mode + Unrestricted Model Picker + Reference Image + Reference Idea
                HStack(spacing: 8) {
                    Picker("", selection: $store.workMode) {
                        Text(store.l10n.t("Akıllı", "Smart")).tag("smart")
                        Text(store.l10n.t("Serbest / Manuel", "Manual")).tag("manual")
                        Text(store.l10n.t("Zincir", "Chain")).tag("chain")
                        Text(store.l10n.t("Karşılaştır", "Compare")).tag("compare")
                        Text(store.l10n.t("Konsey", "Council")).tag("council")
                        Text(store.l10n.t("Ajan", "Agent")).tag("agent")
                    }
                    .labelsHidden()
                    .frame(width: 125)

                    Picker("", selection: $store.selectedModelKey) {
                        Text(store.l10n.t("Otomatik Model", "Auto Model")).tag("auto")
                        ForEach(store.allModels, id: \.key) { item in
                            Text("\(item.provider.displayName) — \(item.model.displayName)").tag(item.key)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 260)

                    Button {
                        store.openFolderFromMac(inCurrentChat: !store.messages.isEmpty)
                    } label: {
                        Label(store.l10n.t("Klasör", "Folder"), systemImage: "folder.badge.plus")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .help(store.messages.isEmpty
                        ? store.l10n.t("Klasör ekle (yeni sohbet açar)", "Add folder (opens a new chat)")
                        : store.l10n.t("Bu sohbete proje klasörü bağla", "Attach project folder to this chat"))

                    Button {
                        store.pickReferenceImage()
                    } label: {
                        Label(store.l10n.t("Referans Görsel", "Ref Image"), systemImage: "photo.badge.plus")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        showIdeaSheet = true
                    } label: {
                        Label(store.l10n.t("Referans Fikir", "Ref Idea"), systemImage: "lightbulb")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        showUrlSheet = true
                    } label: {
                        Label("URL", systemImage: "globe")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    // Live Pre-Send Prompt Cost Estimate
                    let est = store.estimatedDraftPrompt
                    Text(String(format: "~%d tok · $%.5f%@", est.tokens, est.costUsd, est.mult > 1 ? " ×\(est.mult)" : ""))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 4))
                }
            }
            .padding(12)
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .sheet(isPresented: $showUrlSheet) {
            VStack(alignment: .leading, spacing: 12) {
                Text(store.l10n.t("Web Sitesi / URL Referansı (/referans)", "Website / URL Reference (/referans)"))
                    .font(.headline)
                TextField("https://linear.app", text: $refUrl)
                    .textFieldStyle(.roundedBorder)
                TextField(store.l10n.t("Not (düzen, stil, tipografi...)", "Note (layout, style, copy...)"), text: $refUrlNote)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button(store.l10n.t("İptal", "Cancel")) { showUrlSheet = false }
                    Button(store.l10n.t("Ekle", "Add")) {
                        let u = refUrl.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !u.isEmpty else { return }
                        Task {
                            await store.addUrlReference(u, note: refUrlNote)
                            refUrl = ""
                            refUrlNote = ""
                            showUrlSheet = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
            .frame(width: 400)
        }
        .sheet(isPresented: $showIdeaSheet) {
            VStack(alignment: .leading, spacing: 12) {
                Text(store.l10n.t("Referans Fikir / Kısıt Ekle", "Add Reference Idea / Constraint"))
                    .font(.headline)
                Picker(store.l10n.t("Tür", "Type"), selection: $ideaRole) {
                    Text(store.l10n.t("Fikir / İlham", "Inspiration")).tag("inspiration")
                    Text(store.l10n.t("Stil", "Style")).tag("style")
                    Text(store.l10n.t("Düzen / Layout", "Layout")).tag("layout")
                    Text(store.l10n.t("Renk Paleti", "Palette")).tag("palette")
                    Text(store.l10n.t("Kısıt (Yapma)", "Constraint")).tag("constraint")
                }
                TextField(store.l10n.t("Başlık", "Title"), text: $ideaTitle)
                    .textFieldStyle(.roundedBorder)
                TextField(store.l10n.t("Detay notu...", "Notes..."), text: $ideaNote, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button(store.l10n.t("İptal", "Cancel")) { showIdeaSheet = false }
                    Button(store.l10n.t("Ekle", "Add")) {
                        store.references.append(
                            ReferenceDraft(
                                id: UUID().uuidString,
                                kind: "idea",
                                role: ideaRole,
                                title: ideaTitle.isEmpty ? ideaRole : ideaTitle,
                                note: ideaNote.isEmpty ? nil : ideaNote,
                                artifactId: nil,
                                mime: nil
                            )
                        )
                        ideaTitle = ""
                        ideaNote = ""
                        showIdeaSheet = false
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
            .frame(width: 400)
        }
    }

    @ViewBuilder
    private func quickRecipe(_ tag: String, _ title: String, _ prompt: String) -> some View {
        Button {
            store.sendPrompt(prompt)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.callout.weight(.medium))
                    Text(prompt).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(tag).font(.system(.caption, design: .monospaced)).foregroundStyle(Color.accentColor)
            }
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
        }
        .buttonStyle(.plain)
    }
}

struct NativeMessageRow: View {
    @EnvironmentObject var store: SymforyxStore
    let msg: MessageDTO

    var isUser: Bool { msg.role == "user" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(isUser ? store.l10n.t("SEN", "YOU") : (msg.author.modelName ?? msg.author.modelId ?? "Model"))
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(isUser ? .secondary : .primary)
                if !isUser, let score = msg.craftScore {
                    Text("CRAFT \(score)")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(score >= 90 ? .green : .orange)
                }
                Spacer()
                if isUser, let pc = store.promptTurnCost(for: msg.id) {
                    Text(String(format: "%@: $%.5f · %d tok", store.l10n.t("Prompt", "Prompt"), pc.cost, pc.tokens))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                } else if let u = msg.usage {
                    Text(String(format: "%.1fs · %d↑ %d↓ · $%.5f", u.latencyMs / 1000, u.inputTokens, u.outputTokens, u.costUsd))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }

            if let note = msg.routingSummary {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 4))
            }

            if !msg.plainText.isEmpty {
                RichMarkdownMessageView(text: msg.plainText, messageId: msg.id)
            }

            // Inline Generated Image Previews inside Chat Feed
            if !msg.imageArtifactIds.isEmpty {
                HStack(spacing: 8) {
                    ForEach(msg.imageArtifactIds, id: \.self) { aid in
                        if let art = store.artifacts.first(where: { $0.id == aid }),
                           let ver = art.activeVersion,
                           let data = Data(base64Encoded: ver.content),
                           let nsImg = NSImage(data: data) {
                            Button {
                                store.selectedArtifactId = art.id
                                store.inspectorTab = .artifacts
                                store.showInspector = true
                            } label: {
                                Image(nsImage: nsImg)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: 320, maxHeight: 220)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.12)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if let artIds = msg.artifacts, !artIds.isEmpty {
                HStack(spacing: 6) {
                    ForEach(artIds, id: \.self) { aid in
                        if let art = store.artifacts.first(where: { $0.id == aid }) {
                            Button {
                                store.selectedArtifactId = art.id
                                store.inspectorTab = .artifacts
                                store.showInspector = true
                            } label: {
                                Label(art.title, systemImage: art.kind == "image" ? "photo" : "doc.text")
                                    .font(.caption)
                            }
                            .buttonStyle(.bordered)

                            if art.kind == "image" {
                                Button {
                                    store.addArtifactAsReference(art)
                                } label: {
                                    Label(store.l10n.t("Referans Ekle", "Use as Ref"), systemImage: "photo.badge.plus")
                                        .font(.caption)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }

            if !isUser {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(store.allModels.prefix(12), id: \.key) { item in
                            Button("\(item.provider.displayName) — \(item.model.displayName)") {
                                store.handoffMessage(
                                    msg,
                                    targetProviderId: item.provider.id,
                                    targetModelId: item.model.id,
                                    instruction: msg.imageArtifactIds.isEmpty
                                        ? "Bunu iyileştir ve sadeleştir"
                                        : "Bu tasarımı HTML ve Tailwind ile birebir kodla"
                                )
                            }
                        }
                    } label: {
                        Label(store.l10n.t("Aktar", "Handoff"), systemImage: "arrowshape.turn.up.right")
                            .font(.caption)
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()

                    if store.activeRootPath != nil && msg.plainText.contains("```") {
                        Button {
                            Task { await store.applyMessageEditsToDisk(msg.id) }
                        } label: {
                            Label(store.l10n.t("Diske Uygula", "Apply to Disk"), systemImage: "square.and.arrow.down.on.square")
                                .font(.caption)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.mini)
                    }

                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(msg.plainText, forType: .string)
                        store.showToast(store.l10n.t("Kopyalandı", "Copied"))
                    } label: {
                        Label(store.l10n.t("Kopyala", "Copy"), systemImage: "doc.on.doc")
                            .font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            isUser ? Color.primary.opacity(0.04) : Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
    }
}

// MARK: - Native Artifact Inspector (Zero WebView!)

struct ArtifactInspectorView: View {
    @EnvironmentObject var store: SymforyxStore
    @Binding var showInspector: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(store.activeArtifact?.title ?? store.l10n.t("Artefaktlar", "Artifacts"))
                    .font(.caption.bold())
                    .lineLimit(1)
                Spacer()
                if let art = store.activeArtifact, let content = art.activeVersion?.content {
                    if art.kind == "image" {
                        Button(store.l10n.t("Referans", "Ref")) {
                            store.addArtifactAsReference(art)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(content, forType: .string)
                        store.showToast(store.l10n.t("Kopyalandı", "Copied"))
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                }
                Button { showInspector = false } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
            }
            .padding(10)
            Divider()

            if let art = store.activeArtifact, let ver = art.activeVersion {
                if art.kind == "image", let data = Data(base64Encoded: ver.content), let nsImg = NSImage(data: data) {
                    ScrollView([.horizontal, .vertical]) {
                        Image(nsImage: nsImg)
                            .resizable()
                            .scaledToFit()
                            .padding(12)
                    }
                } else {
                    ScrollView {
                        Text(ver.content)
                            .font(.system(size: 11.5, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                }
            } else {
                Text(store.l10n.t("Artefakt seçilmedi", "No artifact selected"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

// MARK: - Native Quotas, Remaining, Reset Countdown & Cost Dashboard

struct QuotasDashboardView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var editing: QuotaStatusDTO?
    @State private var editPlan = ""
    @State private var editMetric = "requests"
    @State private var editLimit = ""
    @State private var editInterval = "monthly"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.l10n.t("Kotalar, Kalan Hak, Sıfırlanma & Maliyet", "Quotas, Remaining, Reset Countdown & Cost"))
                            .font(.title3.bold())
                        Text(store.l10n.t("Her sağlayıcı ve araç için canlı kullanım, kalan limit, sıfırlanma süresi ve harcama.", "Live usage, remaining quota, reset timer, and spend per provider and tool."))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(store.l10n.t("Yenile", "Refresh")) {
                        Task { await store.refreshBootstrap() }
                    }
                }

                // Summary Strip
                HStack(spacing: 10) {
                    metricCard(store.l10n.t("Aylık Maliyet", "Monthly Cost"), String(format: "$%.4f", store.usage.totalCostUsd))
                    metricCard(store.l10n.t("Toplam İstek", "Total Requests"), "\(store.usage.requestCount)")
                    metricCard(store.l10n.t("Giriş Token", "Input Tokens"), "\(store.usage.totalInputTokens)")
                    metricCard(store.l10n.t("Çıkış Token", "Output Tokens"), "\(store.usage.totalOutputTokens)")
                }

                // Quota Rows
                VStack(spacing: 8) {
                    ForEach(store.quotas) { q in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(q.displayName).font(.callout.weight(.semibold))
                                Text("\(q.planName) · \(q.resetInterval)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            .frame(width: 200, alignment: .leading)

                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text("\(store.l10n.t("Kullanılan", "Used")): \(formatQuotaVal(q.usedAmount, metric: q.metric, lang: store.language))")
                                    Spacer()
                                    Text("\(store.l10n.t("Kalan", "Left")): \(formatQuotaVal(q.remainingAmount, metric: q.metric, lang: store.language))")
                                }
                                .font(.system(size: 11, design: .monospaced))
                                ProgressView(value: Double(q.percentUsed), total: 100)
                                    .tint(q.percentUsed >= 85 ? .red : q.percentUsed >= 70 ? .orange : .accentColor)
                            }

                            VStack(alignment: .trailing, spacing: 2) {
                                Text("↻ \(formatResetCountdown(q.nextResetAt, lang: store.language))")
                                    .font(.system(.caption, design: .monospaced))
                                Text(String(format: "$%.4f (Σ $%.4f)", q.windowCostUsd, q.totalCostUsd))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 145, alignment: .trailing)

                            Button(store.l10n.t("Düzenle", "Edit")) {
                                editing = q
                                editPlan = q.planName
                                editMetric = q.metric
                                editLimit = q.limitAmount == nil ? "" : String(q.limitAmount!)
                                editInterval = q.resetInterval
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                        .padding(12)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
                    }
                }
            }
            .padding(20)
        }
        .sheet(item: $editing) { q in
            VStack(alignment: .leading, spacing: 12) {
                Text("\(q.displayName) — \(store.l10n.t("Kota Ayarı", "Quota Settings"))").font(.headline)
                TextField("Plan", text: $editPlan).textFieldStyle(.roundedBorder)
                Picker(store.l10n.t("Metrik", "Metric"), selection: $editMetric) {
                    Text("Requests").tag("requests")
                    Text("Tokens").tag("tokens")
                    Text("Images").tag("images")
                    Text("USD ($)").tag("usd")
                }
                TextField(store.l10n.t("Limit (boş = sınırsız)", "Limit (empty = unlimited)"), text: $editLimit)
                    .textFieldStyle(.roundedBorder)
                Picker(store.l10n.t("Sıfırlanma", "Reset"), selection: $editInterval) {
                    Text("Hourly").tag("hourly")
                    Text("5-Hour").tag("5h")
                    Text("Daily").tag("daily")
                    Text("Weekly").tag("weekly")
                    Text("Monthly").tag("monthly")
                    Text("Never").tag("never")
                }
                HStack {
                    Spacer()
                    Button(store.l10n.t("İptal", "Cancel")) { editing = nil }
                    Button(store.l10n.t("Kaydet", "Save")) {
                        Task {
                            await store.updateQuota(
                                q: q,
                                planName: editPlan,
                                metric: editMetric,
                                limit: Double(editLimit),
                                interval: editInterval
                            )
                            editing = nil
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(20)
            .frame(width: 360)
        }
    }

    private func metricCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(.title3, design: .monospaced).bold())
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
    }
}

// MARK: - Unrestricted Providers & Custom Models Workbench

struct ProvidersWorkbenchView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var keys: [String: String] = [:]
    @State private var customModels: [String: String] = [:]
    @State private var customIsImage: [String: Bool] = [:]
    @State private var testMsgs: [String: String] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(store.l10n.t("Sağlayıcılar & Serbest Model Yönetimi", "Providers & Unrestricted Models"))
                    .font(.title3.bold())
                Text(store.l10n.t(
                    "İstediğin LLM veya görsel sağlayıcısının anahtarını gir, dilediğin özel model ID'sini ekle.",
                    "Connect any LLM or image provider and add any custom model ID freely."
                ))
                .font(.caption).foregroundStyle(.secondary)

                ForEach(store.providers) { p in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(p.displayName).font(.callout.bold())
                            Text("@\(p.alias ?? p.id)")
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text((p.hasKey == true) ? (p.maskedKey ?? "Connected") : (p.auth == "none" ? "Local / Free" : "No Key"))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle((p.hasKey == true) || p.auth == "none" ? .green : .secondary)
                        }

                        if p.auth == "api_key" {
                            HStack {
                                SecureField("API Key...", text: Binding(get: { keys[p.id] ?? "" }, set: { keys[p.id] = $0 }))
                                    .textFieldStyle(.roundedBorder)
                                Button(store.l10n.t("Kaydet & Test", "Save & Test")) {
                                    Task {
                                        testMsgs[p.id] = await store.saveProviderKey(providerId: p.id, apiKey: keys[p.id] ?? "")
                                        keys[p.id] = ""
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }

                        HStack {
                            TextField(
                                store.l10n.t("Özel model ID ekle...", "Add custom model ID..."),
                                text: Binding(get: { customModels[p.id] ?? "" }, set: { customModels[p.id] = $0 })
                            )
                            .textFieldStyle(.roundedBorder)
                            Toggle(store.l10n.t("Görsel", "Image"), isOn: Binding(get: { customIsImage[p.id] ?? false }, set: { customIsImage[p.id] = $0 }))
                                .toggleStyle(.checkbox)
                            Button("+ " + store.l10n.t("Ekle", "Add")) {
                                let mid = (customModels[p.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                                guard !mid.isEmpty else { return }
                                Task {
                                    await store.addCustomModel(providerId: p.id, modelId: mid, isImage: customIsImage[p.id] ?? false)
                                    customModels[p.id] = ""
                                }
                            }
                            .buttonStyle(.bordered)
                        }

                        if let msg = testMsgs[p.id] {
                            Text(msg).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(12)
                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.primary.opacity(0.08)))
                }
            }
            .padding(20)
        }
    }
}

// MARK: - Flows Workbench

struct FlowsWorkbenchView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var selectedFlowId: String = "magaza-gorselleri"
    @State private var selectedCategory: String = "__all__"
    @State private var inputValues: [String: String] = [:]
    @State private var stepModelPicks: [String: String] = [:]

    var categories: [String] {
        ["__all__"] + Array(Set(store.flows.compactMap { $0.category })).sorted()
    }

    var filteredFlows: [FlowDTO] {
        selectedCategory == "__all__" ? store.flows : store.flows.filter { $0.category == selectedCategory }
    }

    var selectedFlow: FlowDTO? {
        filteredFlows.first(where: { $0.id == selectedFlowId }) ?? filteredFlows.first
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(categories, id: \.self) { cat in
                            Button(cat == "__all__" ? store.l10n.t("Tümü", "All") : cat) {
                                selectedCategory = cat
                                if let first = (cat == "__all__" ? store.flows : store.flows.filter { $0.category == cat }).first {
                                    selectedFlowId = first.id
                                }
                            }
                            .buttonStyle(.bordered)
                            .tint(selectedCategory == cat ? .accentColor : .secondary)
                            .controlSize(.small)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                Button {
                    Task { await store.refreshBootstrap() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .padding(.trailing, 12)
            }
            Divider()

            if store.flows.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text(store.l10n.t("Stüdyo şemaları yüklenemedi veya boş.", "No studio schemas loaded yet."))
                        .font(.callout.bold())
                    if let err = store.lastBootstrapError {
                        Text(err).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center).padding(.horizontal)
                    }
                    Button(store.l10n.t("Şemaları Yeniden Yükle", "Reload Schemas")) {
                        Task { await store.refreshBootstrap() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HSplitView {
                    List(filteredFlows, selection: $selectedFlowId) { f in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(store.language == .en ? (f.nameEn ?? f.name) : f.name)
                                    .font(.callout.weight(.semibold))
                                Spacer()
                                Text(String(format: "~$%.2f", f.estimatedCostUsd ?? 0.04))
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Text(store.language == .en ? (f.descriptionEn ?? f.description) : f.description)
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                        .padding(.vertical, 3)
                        .tag(f.id)
                    }
                    .frame(minWidth: 260, idealWidth: 300, maxHeight: .infinity)

                    ScrollView {
                        if let flow = selectedFlow {
                            VStack(alignment: .leading, spacing: 14) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(store.language == .en ? (flow.nameEn ?? flow.name) : flow.name).font(.title3.bold())
                                        Text(store.language == .en ? (flow.descriptionEn ?? flow.description) : flow.description)
                                            .font(.callout).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(String(format: "~$%.3f", flow.estimatedCostUsd ?? 0.04))
                                        .font(.system(.caption, design: .monospaced).bold())
                                        .padding(6)
                                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                                }

                                // Per-Step Model Override
                                let steps = flow.steps ?? []
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(store.l10n.t("Adımlar (İstediğin Adıma Farklı Model Ata)", "Steps (Override Any Step's Model)"))
                                        .font(.caption.bold()).foregroundStyle(.secondary)
                                    ForEach(steps) { st in
                                        HStack {
                                            Text(st.name ?? st.id).font(.caption)
                                            Spacer()
                                            if st.type != "approval" {
                                                Picker("", selection: Binding(
                                                    get: { stepModelPicks[st.id] ?? "default" },
                                                    set: { stepModelPicks[st.id] = $0 }
                                                )) {
                                                    Text(store.l10n.t("Varsayılan", "Default")).tag("default")
                                                    ForEach(store.allModels, id: \.key) { item in
                                                        Text("\(item.provider.displayName) — \(item.model.displayName)").tag(item.key)
                                                    }
                                                }
                                                .labelsHidden()
                                                .frame(maxWidth: 230)
                                            }
                                        }
                                        .padding(8)
                                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                                    }
                                }

                                let inputsDict = flow.inputs ?? [:]
                                ForEach(Array(inputsDict.keys.sorted()), id: \.self) { key in
                                    if let field = inputsDict[key] {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(field.label ?? key).font(.caption.bold())
                                            TextField(
                                                field.placeholder ?? "",
                                                text: Binding(get: { inputValues[key] ?? "" }, set: { inputValues[key] = $0 })
                                            )
                                            .textFieldStyle(.roundedBorder)
                                        }
                                    }
                                }

                                Button(store.l10n.t("Şemayı Çalıştır", "Run Schema")) {
                                    var overrides: [String: [String: String]] = [:]
                                    for (k, v) in stepModelPicks where v != "default" {
                                        let parts = v.components(separatedBy: "::")
                                        if parts.count == 2 {
                                            overrides[k] = ["providerId": parts[0], "modelId": parts[1]]
                                        }
                                    }
                                    Task { await store.runFlow(flow, inputs: inputValues, stepOverrides: overrides) }
                                }
                                .buttonStyle(.borderedProminent)

                                if let run = store.activeFlowRun {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Status: \(run.status) · $\(String(format: "%.5f", run.totalCostUsd))")
                                            .font(.system(.caption, design: .monospaced).bold())
                                        ForEach(run.stepStates, id: \.stepId) { st in
                                            HStack {
                                                Text(st.stepId)
                                                Spacer()
                                                Text(st.status).font(.system(.caption, design: .monospaced))
                                            }
                                        }
                                        if run.status == "awaiting_approval" {
                                            HStack {
                                                Button(store.l10n.t("Onayla ve Devam Et", "Approve")) {
                                                    Task { await store.approveFlowRun(run.id, approved: true) }
                                                }
                                                .buttonStyle(.borderedProminent)
                                                Button(store.l10n.t("Tekrar Üret", "Regenerate")) {
                                                    Task { await store.approveFlowRun(run.id, approved: false) }
                                                }
                                                .buttonStyle(.bordered)
                                            }
                                        }
                                    }
                                    .padding(12)
                                    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                                }
                            }
                            .padding(20)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
