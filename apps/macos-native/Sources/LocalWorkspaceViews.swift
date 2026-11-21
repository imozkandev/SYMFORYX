import AppKit
import SwiftUI

// MARK: - Right-Side Tabbed Workspace Inspector (Native Code Editor + Git Diff + Artifacts)

struct WorkspaceInspectorView: View {
    @EnvironmentObject var store: SymforyxStore
    @State private var showNewFileAlert = false
    @State private var newFilePath = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Picker("", selection: $store.inspectorTab) {
                    Text(store.l10n.t("Kod Editörü", "Editor")).tag(InspectorTab.editor)
                    Text("Git Diff").tag(InspectorTab.diff)
                    Text("\(store.l10n.t("Artefakt", "Artifacts")) (\(store.artifacts.count))").tag(InspectorTab.artifacts)
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                Spacer()

                Button {
                    store.showInspector = false
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
            }
            .padding(10)

            Divider()

            switch store.inspectorTab {
            case .editor:
                editorTab
            case .diff:
                gitDiffTab
            case .artifacts:
                artifactsTab
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private var editorTab: some View {
        if let filePath = store.openFilePath {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(filePath)
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                        .lineLimit(1)
                    if store.openFileDirty {
                        Circle().fill(Color.accentColor).frame(width: 6, height: 6)
                    }
                    Spacer()

                    Button {
                        store.draftText = "@claude `\(filePath)` dosyasını incele ve iyileştir: "
                    } label: {
                        Label(store.l10n.t("AI Düzenle", "Ask AI"), systemImage: "wand.and.stars")
                            .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Button {
                        Task { await store.saveOpenFile() }
                    } label: {
                        Text(store.l10n.t("Kaydet", "Save"))
                            .font(.caption2)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!store.openFileDirty)

                    Button(role: .destructive) {
                        Task { await store.deleteLocalFile(filePath) }
                    } label: {
                        Image(systemName: "trash").font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)

                Divider()

                TextEditor(text: Binding(
                    get: { store.openFileContent },
                    set: { newVal in
                        store.openFileContent = newVal
                        store.openFileDirty = true
                    }
                ))
                .font(.system(size: 12, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color(nsColor: .textBackgroundColor))
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: "folder.badge.gearshape")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text(store.activeRootPath == nil
                     ? store.l10n.t("Henüz yerel bir proje klasörü açık değil.", "No local project folder opened yet.")
                     : store.l10n.t("Sol dosya ağacından bir dosya seç veya yeni dosya oluştur.", "Select a file from the left tree or create a new file."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                if store.activeRootPath == nil {
                    Button(store.l10n.t("Mac'ten Proje Klasörü Aç…", "Open Project Folder on Mac…")) {
                        store.openFolderFromMac()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var gitDiffTab: some View {
        VStack(spacing: 0) {
            HStack {
                if let git = store.gitStatus, git.isGitRepo {
                    Label(git.branch, systemImage: "arrow.triangle.branch")
                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                    Text("· \(git.changedFiles.count) \(store.l10n.t("değişiklik", "changed"))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(store.l10n.t("Git deposu bağlı değil", "No Git repository"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.refreshLocalProject() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)

            Divider()

            if let git = store.gitStatus, !git.changedFiles.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(git.changedFiles.prefix(15)) { cf in
                        Button {
                            Task { await store.openLocalFile(cf.path) }
                        } label: {
                            HStack(spacing: 6) {
                                Text(cf.status)
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(cf.status.contains("?") ? .green : .orange)
                                    .frame(width: 22, alignment: .leading)
                                Text(cf.path)
                                    .font(.system(size: 11, design: .monospaced))
                                    .lineLimit(1)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(10)
                Divider()
            }

            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(store.gitDiffText.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, rawLine in
                        let line = String(rawLine)
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(
                                line.hasPrefix("+") && !line.hasPrefix("+++") ? .green :
                                line.hasPrefix("-") && !line.hasPrefix("---") ? .red :
                                line.hasPrefix("@@") ? Color.accentColor : .primary
                            )
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
            }
            .background(Color(nsColor: .textBackgroundColor))
        }
    }

    @ViewBuilder
    private var artifactsTab: some View {
        VStack(spacing: 0) {
            HStack {
                Text(store.activeArtifact?.title ?? store.l10n.t("Artefaktlar", "Artifacts"))
                    .font(.caption.bold())
                    .lineLimit(1)
                Spacer()
                if let art = store.activeArtifact, let content = art.activeVersion?.content {
                    if store.activeRootPath != nil && art.kind != "image" {
                        Button(store.l10n.t("Projeye Kaydet", "Save to Disk")) {
                            Task { await store.saveArtifactToProject(art) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
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
    }
}

// MARK: - Built-In Native Project Terminal Drawer

struct NativeTerminalDrawerView: View {
    @EnvironmentObject var store: SymforyxStore

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .font(.caption)
                    .foregroundStyle(Color.accentColor)
                Text(store.l10n.t("Proje Terminali", "Project Terminal"))
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                if let root = store.activeRootPath {
                    Text(root)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                ForEach(["git status", "ls -la", "bun test"], id: \.self) { quick in
                    Button(quick) {
                        Task { await store.runTerminalCommand(quick) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(store.isRunningTerminal || store.activeRootPath == nil)
                }
                Button {
                    store.terminalHistory.removeAll()
                } label: {
                    Image(systemName: "trash").font(.caption2)
                }
                .buttonStyle(.borderless)
                Button {
                    store.showTerminalDrawer = false
                } label: {
                    Image(systemName: "chevron.down").font(.caption)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if store.terminalHistory.isEmpty {
                            Text(store.activeRootPath == nil
                                 ? store.l10n.t("Terminal komutları çalıştırmak için önce bir proje klasörü aç.", "Open a project folder first to run terminal commands.")
                                 : store.l10n.t("Aşağıya herhangi bir macOS zsh komutu yaz (ör. bun test, npm run build, swift build, python3 main.py).", "Run any macOS zsh command inside this project (e.g. bun test, npm run build, swift build)."))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(store.terminalHistory) { entry in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text("$ \(entry.command)")
                                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        Spacer()
                                        Text("exit \(entry.exitCode) · \(entry.durationMs)ms")
                                            .font(.system(size: 10, design: .monospaced))
                                            .foregroundStyle(entry.exitCode == 0 ? .green : .red)
                                    }
                                    if !entry.stdout.isEmpty {
                                        Text(entry.stdout)
                                            .font(.system(size: 11, design: .monospaced))
                                            .textSelection(.enabled)
                                    }
                                    if !entry.stderr.isEmpty {
                                        Text(entry.stderr)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundStyle(.orange)
                                            .textSelection(.enabled)
                                    }
                                }
                                .id(entry.id)
                            }
                        }
                    }
                    .padding(10)
                }
                .frame(height: 155)
                .background(Color(nsColor: .textBackgroundColor))
                .onChange(of: store.terminalHistory.count) { _, _ in
                    if let last = store.terminalHistory.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            Divider()

            HStack(spacing: 8) {
                Text("$")
                    .font(.system(.caption, design: .monospaced).bold())
                    .foregroundStyle(Color.accentColor)
                TextField(
                    store.l10n.t("Komut çalıştır (bun test, git diff, python3 main.py)...", "Run command (bun test, git diff, python3 main.py)..."),
                    text: $store.terminalCommand
                )
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .monospaced))
                .onSubmit {
                    Task { await store.runTerminalCommand() }
                }
                if store.isRunningTerminal {
                    ProgressView().controlSize(.small)
                } else {
                    Button(store.l10n.t("Çalıştır", "Run")) {
                        Task { await store.runTerminalCommand() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(store.activeRootPath == nil || store.terminalCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(nsColor: .windowBackgroundColor))
        }
    }
}

// MARK: - Create Brand New Project From Scratch Sheet

struct NewScratchProjectSheet: View {
    @EnvironmentObject var store: SymforyxStore
    @Binding var isPresented: Bool
    @State private var parentDir: String = NSHomeDirectory() + "/Desktop"
    @State private var projectName: String = ""
    @State private var template: String = "typescript"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(store.l10n.t("Sıfırdan Yeni Proje Oluştur", "Create New Project From Scratch"))
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text(store.l10n.t("Proje Adı", "Project Name")).font(.caption.bold())
                TextField("my-awesome-app", text: $projectName)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(store.l10n.t("Konum (Mac Klasörü)", "Parent Folder on Mac")).font(.caption.bold())
                HStack {
                    Text(parentDir)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                    Button(store.l10n.t("Seç…", "Browse…")) {
                        if let chosen = store.pickParentDirectoryForNewProject() {
                            parentDir = chosen
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(store.l10n.t("Başlangıç Şablonu", "Starter Template")).font(.caption.bold())
                Picker("", selection: $template) {
                    Text(store.l10n.t("Boş Klasör", "Empty Folder")).tag("empty")
                    Text("TypeScript / Bun").tag("typescript")
                    Text("Web (HTML / CSS / JS)").tag("web")
                    Text("Python").tag("python")
                    Text("Swift").tag("swift")
                }
                .labelsHidden()
            }

            HStack {
                Spacer()
                Button(store.l10n.t("İptal", "Cancel")) { isPresented = false }
                Button(store.l10n.t("Oluştur ve Aç", "Create & Open")) {
                    let clean = projectName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !clean.isEmpty else { return }
                    let fullPath = (parentDir as NSString).appendingPathComponent(clean)
                    isPresented = false
                    Task {
                        await store.attachFolder(path: fullPath, name: clean, createIfMissing: true, template: template)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(projectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}
