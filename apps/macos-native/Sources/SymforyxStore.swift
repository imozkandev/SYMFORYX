import AppKit
import Foundation
import SwiftUI

@MainActor
final class SymforyxStore: ObservableObject {
    @Published var language: AppLanguage = .en
    @Published var appearance: AppAppearance = .system
    @Published var navSection: NavSection = .chat

    @Published var serverReady = false
    @Published var serverError: String?
    @Published var baseURL: URL = URL(string: "http://127.0.0.1:3456")!

    @Published var projects: [ProjectDTO] = []
    @Published var threads: [ThreadDTO] = []
    @Published var providers: [ProviderDTO] = []
    @Published var flows: [FlowDTO] = []
    @Published var tools: [ToolManifestDTO] = []
    @Published var memories: [MemoryItemDTO] = []
    @Published var commands: [SlashCommandDTO] = []
    @Published var quotas: [QuotaStatusDTO] = []
    @Published var usage = UsageSummaryDTO(totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, requestCount: 0)
    @Published var optimization = OptimizationStatsDTO(savedTokens: 0, savedCostUsd: 0, cacheHits: 0, slopItemsBlocked: 0)
    @Published var tokenOptimizationEnabled = true
    @Published var aiSlopBlockerEnabled = true
    @Published var economyMode = false
    @Published var showCommandPalette = false
    @Published var lastBootstrapError: String?

    @Published var activeProjectId: String = "proj_default"
    @Published var activeThreadId: String?
    @Published var messages: [MessageDTO] = []
    @Published var artifacts: [ArtifactDTO] = []
    @Published var selectedArtifactId: String?

    @Published var draftText: String = ""
    @Published var workMode: String = "smart"
    @Published var selectedModelKey: String = "auto" // "auto" or "providerId::modelId"
    @Published var references: [ReferenceDraft] = []
    @Published var isStreaming = false
    @Published var statusToast: String?
    @Published var activeFlowRun: FlowRunDTO?

    // MARK: - Local macOS Project Engine State (Claude Code Desktop Mode)
    @Published var projectFiles: [LocalFileEntryDTO] = []
    @Published var gitStatus: LocalGitStatusDTO?
    @Published var gitDiffText: String = ""
    @Published var openFilePath: String?
    @Published var openFileContent: String = ""
    @Published var openFileDirty = false
    @Published var inspectorTab: InspectorTab = .editor
    @Published var showInspector = false
    @Published var autoApplyEdits = true
    @Published var showTerminalDrawer = false
    @Published var terminalCommand = ""
    @Published var terminalHistory: [TerminalEntry] = []
    @Published var isRunningTerminal = false
    @Published var fileFilterQuery = ""
    @Published var fileSearchMatches: [LocalSearchMatchDTO] = []

    var activeProject: ProjectDTO? {
        projects.first(where: { $0.id == activeProjectId })
    }

    var activeRootPath: String? {
        guard let p = activeProject?.rootPath, !p.isEmpty else { return nil }
        return p
    }

    private var serverProcess: Process?
    private var streamTask: Task<Void, Never>?

    var l10n: L10n { L10n(lang: language) }

    var allModels: [(key: String, provider: ProviderDTO, model: ModelInfoDTO)] {
        providers.filter { $0.enabled }.flatMap { p in
            p.models.map { m in (key: "\(p.id)::\(m.id)", provider: p, model: m) }
        }
    }

    var activeArtifact: ArtifactDTO? {
        artifacts.first(where: { $0.id == selectedArtifactId }) ?? artifacts.first
    }

    var threadTotalCostUsd: Double {
        messages.reduce(0.0) { $0 + ($1.usage?.costUsd ?? 0.0) }
    }

    var threadOutgoingTokens: Int {
        messages.reduce(0) { $0 + ($1.usage?.inputTokens ?? 0) + ($1.usage?.outputTokens ?? 0) }
    }

    var remainingContextTokens: Int {
        let win = 128_000
        return max(0, win - threadOutgoingTokens)
    }

    func fmtTok(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.2fM", Double(n) / 1_000_000.0) }
        if n >= 1000 { return String(format: "%.1fk", Double(n) / 1000.0) }
        return "\(n)"
    }

    func promptTurnCost(for userMsgId: String) -> (cost: Double, tokens: Int)? {
        let children = messages.filter { $0.role != "user" && $0.parentId == userMsgId }
        guard !children.isEmpty else { return nil }
        let cost = children.reduce(0.0) { $0 + ($1.usage?.costUsd ?? 0.0) }
        let toks = children.reduce(0) { $0 + ($1.usage?.inputTokens ?? 0) + ($1.usage?.outputTokens ?? 0) }
        return (cost, toks)
    }

    var estimatedDraftPrompt: (tokens: Int, costUsd: Double, mult: Int) {
        let refChars = references.reduce(0) { $0 + $1.title.count + ($1.note?.count ?? 0) }
        let refImgs = references.filter { $0.kind == "image" }.count
        let inTok = max(0, Int(ceil(Double(draftText.count + refChars) / 3.8))) + refImgs * 320
        let outTok = inTok > 0 ? min(2000, max(350, inTok * 2)) : 0
        let mult = workMode == "compare" ? 3 : workMode == "council" ? 4 : workMode == "agent" ? 3 : 1

        var perCall = 0.0
        if let item = allModels.first(where: { $0.key == selectedModelKey }) {
            let isImg = item.model.capabilities.contains("image.generate") && !item.model.capabilities.contains("chat")
            if isImg {
                perCall = item.model.pricing?.perImage ?? 0.04
            } else if let p = item.model.pricing, inTok > 0 {
                perCall = (Double(inTok) / 1_000_000.0) * p.inputPerMTok + (Double(outTok) / 1_000_000.0) * p.outputPerMTok
            }
        }
        return (inTok, perCall * Double(mult), mult)
    }

    func showToast(_ text: String) {
        statusToast = text
        Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if statusToast == text { statusToast = nil }
        }
    }

    // MARK: - Local Bun Engine Lifecycle

    func bootBackend() async {
        // 1. Check if a fresh compatible SYMFORYX backend is already running on our dedicated port 3456
        if await verifyHealthyBackend(port: 3456) {
            self.baseURL = URL(string: "http://127.0.0.1:3456")!
            self.serverReady = true
            await refreshBootstrap()
            return
        }

        // 2. Spawn our own fresh local Bun server on dedicated port 3456 (avoids stale servers on :3000)
        let projectRoot = resolveProjectRoot()
        let bunPath = resolveBunPath()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bunPath)
        proc.arguments = ["run", "apps/server/src/index.ts"]
        proc.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        var env = ProcessInfo.processInfo.environment
        env["SYMFORYX_PORT"] = "3456"
        env["SYMFORYX_HOST"] = "127.0.0.1"
        proc.environment = env

        do {
            try proc.run()
            self.serverProcess = proc
            for _ in 0..<45 {
                try? await Task.sleep(nanoseconds: 140_000_000)
                if await verifyHealthyBackend(port: 3456) {
                    self.baseURL = URL(string: "http://127.0.0.1:3456")!
                    self.serverReady = true
                    await refreshBootstrap()
                    return
                }
            }
        } catch {
            // Fall through to probe other local ports
        }

        // 3. Fallback: probe existing local ports 3000..3005
        for port in [3000, 3001, 3002, 3003] {
            if await verifyHealthyBackend(port: port) {
                self.baseURL = URL(string: "http://127.0.0.1:\(port)")!
                self.serverReady = true
                await refreshBootstrap()
                return
            }
        }

        self.serverError = l10n.t(
            "SYMFORYX yerel motoru başlatılamadı (\(bunPath)). Terminalde 'bun run dev:server' ile kontrol edebilirsin.",
            "Could not start local SYMFORYX engine (\(bunPath))."
        )
    }

    private func verifyHealthyBackend(port: Int) async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/v1/bootstrap"),
              let (data, resp) = try? await URLSession.shared.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let boot = try? JSONDecoder().decode(BootstrapDTO.self, from: data) else {
            return false
        }
        return (boot.flows?.count ?? 0) > 0 || (boot.providers?.count ?? 0) > 0
    }

    func shutdownBackend() {
        serverProcess?.terminate()
        serverProcess = nil
    }

    private func resolveProjectRoot() -> String {
        if let envRoot = ProcessInfo.processInfo.environment["SYMFORYX_ROOT"],
           FileManager.default.fileExists(atPath: envRoot + "/apps/server/src/index.ts") {
            return envRoot
        }
        // Traverse up from .app bundle to workspace root
        var url = Bundle.main.bundleURL
        for _ in 0..<6 {
            url.deleteLastPathComponent()
            if FileManager.default.fileExists(atPath: url.path + "/apps/server/src/index.ts") {
                return url.path
            }
        }
        return "/Users/ozkandev/Desktop/SYMFORYX"
    }

    private func resolveBunPath() -> String {
        let candidates = [
            NSHomeDirectory() + "/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/env"
    }

    // MARK: - API Calls

    func refreshBootstrap() async {
        do {
            let data = try await getData("/api/v1/bootstrap")
            let boot = try JSONDecoder().decode(BootstrapDTO.self, from: data)
            self.lastBootstrapError = nil
            self.projects = boot.projects ?? []
            self.threads = boot.threads ?? []
            self.providers = boot.providers ?? []
            self.flows = boot.flows ?? []
            self.tools = boot.tools ?? []
            self.quotas = boot.quotas ?? []
            self.commands = boot.commands ?? []
            if let u = boot.usage { self.usage = u }
            if let opt = boot.optimization { self.optimization = opt }
            if let st = boot.settings {
                if let tokOpt = st.tokenOptimizationEnabled { self.tokenOptimizationEnabled = tokOpt }
                if let slop = st.aiSlopBlockerEnabled { self.aiSlopBlockerEnabled = slop }
                if let econ = st.economyMode { self.economyMode = econ }
            }

            if activeProjectId.isEmpty || !self.projects.contains(where: { $0.id == activeProjectId }) {
                activeProjectId = self.projects.first?.id ?? ""
            }
            if activeThreadId == nil, let t = self.threads.first(where: { $0.projectId == activeProjectId }) ?? self.threads.first {
                await selectThread(t.id)
            }
            await refreshLocalProject()
        } catch {
            self.lastBootstrapError = error.localizedDescription
            showToast("Sync error: \(error.localizedDescription)")
        }
    }

    func setLanguage(_ lang: AppLanguage) {
        self.language = lang
        Task {
            _ = try? await sendJSON("/api/v1/settings", method: "PATCH", body: ["language": lang.rawValue])
        }
    }

    func setAppearance(_ app: AppAppearance) {
        self.appearance = app
        Task {
            _ = try? await sendJSON("/api/v1/settings", method: "PATCH", body: ["theme": app.rawValue])
        }
    }

    func toggleEconomyMode() async {
        economyMode.toggle()
        _ = try? await sendJSON("/api/v1/settings", method: "PATCH", body: ["economyMode": economyMode])
        showToast(economyMode ? l10n.t("Ekonomi modu açık", "Economy mode ON") : l10n.t("Ekonomi modu kapalı", "Economy mode OFF"))
    }

    func setToolPolicy(toolId: String, policy: String) async {
        _ = try? await postJSON("/api/v1/tools/\(toolId)/permission", body: [
            "scope": "global",
            "scopeId": "global",
            "policy": policy,
        ])
        await refreshBootstrap()
        showToast(l10n.t("Araç izni güncellendi", "Tool permission updated"))
    }

    func discoverMcp(url: String) async -> String {
        guard let data = try? await postJSON("/api/v1/tools/mcp/discover", body: ["url": url]),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return l10n.t("MCP sunucusuna bağlanılamadı", "Failed to reach MCP server")
        }
        await refreshBootstrap()
        if let ok = json["ok"] as? Bool, ok {
            let count = (json["tools"] as? [Any])?.count ?? 0
            return l10n.t("\(count) MCP aracı eklendi", "Connected \(count) MCP tool(s)")
        }
        return (json["error"] as? String) ?? "Error"
    }

    func refreshMemories() async {
        let q = activeProjectId.isEmpty ? "" : "?projectId=\(activeProjectId)"
        if let data = try? await getData("/api/v1/memories\(q)") {
            struct Resp: Codable { let memories: [MemoryItemDTO] }
            if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
                self.memories = parsed.memories
            }
        }
    }

    func addMemory(scope: String, content: String) async {
        var payload: [String: Any] = ["scope": scope, "content": content]
        if scope == "project", !activeProjectId.isEmpty { payload["projectId"] = activeProjectId }
        _ = try? await postJSON("/api/v1/memories", body: payload)
        await refreshMemories()
        showToast(l10n.t("Hafızaya eklendi", "Saved to memory"))
    }

    func deleteMemory(_ id: String) async {
        _ = try? await deleteRequest("/api/v1/memories/\(id)")
        memories.removeAll { $0.id == id }
    }

    func saveActiveThreadAsSchema() async {
        guard let tid = activeThreadId else { return }
        if let _ = try? await postJSON("/api/v1/threads/\(tid)/save-as-flow", body: [:]) {
            await refreshBootstrap()
            showToast(l10n.t("Sohbet şema olarak kaydedildi", "Thread saved as studio schema"))
        }
    }

    func openLocalWebUI() {
        NSWorkspace.shared.open(baseURL)
    }

    func stopStreaming() {
        streamTask?.cancel()
        isStreaming = false
        if let tid = activeThreadId {
            Task { _ = try? await postJSON("/api/v1/threads/\(tid)/stop", body: [:]) }
        }
    }

    // MARK: - Local macOS Folder & File Operations (Claude Code Mode)

    func openFolderFromMac(inCurrentChat: Bool = false) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = l10n.t("Projeyi Aç", "Open Project")
        panel.message = inCurrentChat
            ? l10n.t("Bu sohbete bağlamak istediğin klasörü seç.", "Choose a folder to attach to this chat.")
            : l10n.t("Yeni sohbetle açmak istediğin proje klasörünü seç.", "Choose a project folder to open in a new chat.")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let attachThreadId = (inCurrentChat && !messages.isEmpty) ? activeThreadId : nil
        Task {
            await attachFolder(path: url.path, createIfMissing: false, template: "empty", attachToThreadId: attachThreadId)
        }
    }

    func pickParentDirectoryForNewProject() -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = l10n.t("Konumu Seç", "Choose Location")
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path
    }

    func attachFolder(path: String, name: String? = nil, createIfMissing: Bool, template: String, attachToThreadId: String? = nil) async {
        var payload: [String: Any] = [
            "path": path,
            "createIfMissing": createIfMissing,
            "template": template,
        ]
        if let n = name, !n.isEmpty { payload["name"] = n }
        if let tid = attachToThreadId, !tid.isEmpty { payload["attachToThreadId"] = tid }
        guard let data = try? await postJSON("/api/v1/projects/open-folder", body: payload) else {
            showToast(l10n.t("Klasör açılamadı", "Failed to open folder"))
            return
        }
        struct OpenResp: Codable {
            let project: ProjectDTO
            let thread: ThreadDTO
            let attachedToExistingChat: Bool?
            let tree: [LocalFileEntryDTO]
            let git: LocalGitStatusDTO?
            let projects: [ProjectDTO]
            let threads: [ThreadDTO]
        }
        if let parsed = try? JSONDecoder().decode(OpenResp.self, from: data) {
            self.projects = parsed.projects
            self.threads = parsed.threads
            self.activeProjectId = parsed.project.id
            self.activeThreadId = parsed.thread.id
            self.projectFiles = parsed.tree
            self.gitStatus = parsed.git
            self.navSection = .chat
            await selectThread(parsed.thread.id)
            await refreshGitDiff()
            if let firstFile = parsed.tree.first(where: { $0.kind == "file" }) {
                await openLocalFile(firstFile.path)
            }
            if parsed.attachedToExistingChat == true {
                showToast(l10n.t("Klasör bu sohbete eklendi: \(parsed.project.name)", "Folder attached to chat: \(parsed.project.name)"))
            } else {
                showToast(l10n.t("Yeni sohbet açıldı: \(parsed.project.name)", "Opened new chat: \(parsed.project.name)"))
            }
        }
    }

    func refreshLocalProject() async {
        guard !activeProjectId.isEmpty, activeRootPath != nil else {
            projectFiles = []
            gitStatus = nil
            gitDiffText = ""
            return
        }
        if let data = try? await getData("/api/v1/projects/\(activeProjectId)/fs/tree") {
            struct TreeResp: Codable {
                let rootPath: String?
                let entries: [LocalFileEntryDTO]
                let git: LocalGitStatusDTO?
            }
            if let parsed = try? JSONDecoder().decode(TreeResp.self, from: data) {
                self.projectFiles = parsed.entries
                self.gitStatus = parsed.git
            }
        }
        await refreshGitDiff()
    }

    func refreshGitDiff() async {
        guard !activeProjectId.isEmpty, activeRootPath != nil else { return }
        if let data = try? await getData("/api/v1/projects/\(activeProjectId)/fs/git") {
            struct GitResp: Codable {
                let status: LocalGitStatusDTO?
                let diff: String
            }
            if let parsed = try? JSONDecoder().decode(GitResp.self, from: data) {
                self.gitStatus = parsed.status
                self.gitDiffText = parsed.diff
            }
        }
    }

    func openLocalFile(_ relPath: String) async {
        guard !activeProjectId.isEmpty else { return }
        let encoded = relPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? relPath
        guard let data = try? await getData("/api/v1/projects/\(activeProjectId)/fs/read?path=\(encoded)") else { return }
        struct ReadResp: Codable { let path: String; let content: String }
        if let parsed = try? JSONDecoder().decode(ReadResp.self, from: data) {
            self.openFilePath = parsed.path
            self.openFileContent = parsed.content
            self.openFileDirty = false
            self.inspectorTab = .editor
            self.showInspector = true
        }
    }

    func saveOpenFile() async {
        guard !activeProjectId.isEmpty, let path = openFilePath else { return }
        if let _ = try? await postJSON("/api/v1/projects/\(activeProjectId)/fs/write", body: ["path": path, "content": openFileContent]) {
            self.openFileDirty = false
            await refreshLocalProject()
            showToast(l10n.t("Kaydedildi: \(path)", "Saved: \(path)"))
        }
    }

    func createLocalFile(path: String, content: String = "") async {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activeProjectId.isEmpty, !trimmed.isEmpty else { return }
        if let _ = try? await postJSON("/api/v1/projects/\(activeProjectId)/fs/write", body: ["path": trimmed, "content": content]) {
            await refreshLocalProject()
            await openLocalFile(trimmed)
            showToast(l10n.t("Dosya oluşturuldu: \(trimmed)", "Created file: \(trimmed)"))
        }
    }

    func deleteLocalFile(_ relPath: String) async {
        guard !activeProjectId.isEmpty else { return }
        let encoded = relPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? relPath
        _ = try? await deleteRequest("/api/v1/projects/\(activeProjectId)/fs/delete?path=\(encoded)")
        if openFilePath == relPath {
            openFilePath = nil
            openFileContent = ""
            openFileDirty = false
        }
        await refreshLocalProject()
        showToast(l10n.t("Dosya silindi: \(relPath)", "Deleted: \(relPath)"))
    }

    func searchLocalProject(_ query: String) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activeProjectId.isEmpty, !q.isEmpty else {
            fileSearchMatches = []
            return
        }
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        if let data = try? await getData("/api/v1/projects/\(activeProjectId)/fs/search?q=\(encoded)") {
            struct Resp: Codable { let matches: [LocalSearchMatchDTO] }
            if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
                self.fileSearchMatches = parsed.matches
            }
        }
    }

    func runTerminalCommand(_ customCmd: String? = nil) async {
        let cmd = (customCmd ?? terminalCommand).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !activeProjectId.isEmpty, activeRootPath != nil, !cmd.isEmpty else { return }
        if customCmd == nil { terminalCommand = "" }
        showTerminalDrawer = true
        isRunningTerminal = true
        defer { isRunningTerminal = false }

        if let data = try? await postJSON("/api/v1/projects/\(activeProjectId)/fs/exec", body: ["command": cmd]) {
            struct Resp: Codable { let ok: Bool; let result: ShellRunResultDTO }
            if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
                terminalHistory.append(
                    TerminalEntry(
                        command: parsed.result.command,
                        cwd: parsed.result.cwd,
                        exitCode: parsed.result.exitCode,
                        stdout: parsed.result.stdout,
                        stderr: parsed.result.stderr,
                        durationMs: parsed.result.durationMs
                    )
                )
                await refreshLocalProject()
            }
        }
    }

    func applyMessageEditsToDisk(_ messageId: String) async {
        guard !activeProjectId.isEmpty, activeRootPath != nil else {
            showToast(l10n.t("Önce bir proje klasörü aç", "Open a project folder first"))
            return
        }
        if let data = try? await postJSON("/api/v1/projects/\(activeProjectId)/fs/apply-blocks", body: ["messageId": messageId]) {
            struct Resp: Codable { let ok: Bool; let applied: [AppliedFileResultDTO] }
            if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
                if parsed.applied.isEmpty {
                    showToast(l10n.t("Dosya yolu içeren kod bloğu bulunamadı", "No file-annotated code blocks found"))
                } else {
                    await refreshLocalProject()
                    if let first = parsed.applied.first {
                        await openLocalFile(first.path)
                    }
                    showToast(l10n.t("\(parsed.applied.count) dosya diske yazıldı", "Applied \(parsed.applied.count) file(s) to disk"))
                }
            }
        }
    }

    func saveArtifactToProject(_ art: ArtifactDTO) async {
        guard !activeProjectId.isEmpty, activeRootPath != nil, let content = art.activeVersion?.content else {
            showToast(l10n.t("Önce bir proje klasörü aç", "Open a project folder first"))
            return
        }
        let safeName = art.title.replacingOccurrences(of: " ", with: "-").replacingOccurrences(of: "/", with: "_")
        let rel = art.kind == "preview" ? "\(safeName).html" : safeName.contains(".") ? safeName : "\(safeName).txt"
        await createLocalFile(path: rel, content: content)
    }

    func revealProjectInFinder() {
        guard let root = activeRootPath else { return }
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: root)
    }

    func createProject(name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let data = try? await postJSON("/api/v1/projects", body: ["name": trimmed]) else { return }
        struct Resp: Codable { let project: ProjectDTO; let thread: ThreadDTO }
        if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
            projects.insert(parsed.project, at: 0)
            threads.insert(parsed.thread, at: 0)
            activeProjectId = parsed.project.id
            await selectThread(parsed.thread.id)
            showToast(l10n.t("Çalışma alanı oluşturuldu: \(trimmed)", "Workspace created: \(trimmed)"))
        }
    }

    func deleteProject(_ id: String) async {
        guard let data = try? await deleteRequest("/api/v1/projects/\(id)") else { return }
        struct Resp: Codable { let ok: Bool; let projects: [ProjectDTO]; let threads: [ThreadDTO] }
        if let parsed = try? JSONDecoder().decode(Resp.self, from: data), parsed.ok {
            self.projects = parsed.projects
            self.threads = parsed.threads
            if let nextProj = parsed.projects.first {
                self.activeProjectId = nextProj.id
                if let nextThread = parsed.threads.first(where: { $0.projectId == nextProj.id }) {
                    await selectThread(nextThread.id)
                } else {
                    self.activeThreadId = nil
                    self.messages = []
                    self.artifacts = []
                    self.references = []
                }
            } else {
                self.activeProjectId = ""
                self.activeThreadId = nil
                self.messages = []
                self.artifacts = []
                self.references = []
            }
            showToast(l10n.t("Çalışma alanı silindi", "Workspace deleted"))
        }
    }

    func deleteThread(_ id: String) async {
        _ = try? await deleteRequest("/api/v1/threads/\(id)")
        threads.removeAll { $0.id == id }
        if activeThreadId == id {
            if let next = threads.first(where: { $0.projectId == activeProjectId }) ?? threads.first {
                await selectThread(next.id)
            } else {
                activeThreadId = nil
                messages = []
                artifacts = []
                references = []
            }
        }
    }

    func selectThread(_ id: String) async {
        activeThreadId = id
        guard let data = try? await getData("/api/v1/threads/\(id)") else { return }
        struct ThreadResp: Codable {
            let thread: ThreadDTO
            let messages: [MessageDTO]
            let artifacts: [ArtifactDTO]
            let references: [ReferenceDraft]?
        }
        if let parsed = try? JSONDecoder().decode(ThreadResp.self, from: data) {
            self.messages = parsed.messages
            self.artifacts = parsed.artifacts
            self.references = parsed.references ?? []
            self.workMode = parsed.thread.mode
            self.selectedArtifactId = parsed.artifacts.first?.id
        }
    }

    func addUrlReference(_ url: String, note: String) async {
        if activeThreadId == nil { await createNewThread() }
        guard let tid = activeThreadId else { return }
        let input = note.isEmpty ? url : "\(url) \(note)"
        if let data = try? await postJSON("/api/v1/threads/\(tid)/references", body: ["input": input]) {
            struct Resp: Codable { let references: [ReferenceDraft] }
            if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
                self.references = parsed.references
                showToast(l10n.t("Web sitesi referansı eklendi", "Website reference added"))
            }
        }
    }

    func toggleTokenOptimization() async {
        tokenOptimizationEnabled.toggle()
        _ = try? await sendJSON("/api/v1/settings", method: "PATCH", body: ["tokenOptimizationEnabled": tokenOptimizationEnabled])
        showToast(tokenOptimizationEnabled ? l10n.t("Token optimizasyonu açık", "Token optimizer ON") : l10n.t("Token optimizasyonu kapalı", "Token optimizer OFF"))
    }

    func toggleSlopBlocker() async {
        aiSlopBlockerEnabled.toggle()
        _ = try? await sendJSON("/api/v1/settings", method: "PATCH", body: ["aiSlopBlockerEnabled": aiSlopBlockerEnabled])
        showToast(aiSlopBlockerEnabled ? l10n.t("AI Slop Blocker AÇIK", "AI Slop Blocker ON") : l10n.t("AI Slop Blocker KAPALI", "AI Slop Blocker OFF"))
    }

    func createNewThread() async {
        let body: [String: Any] = [
            "projectId": activeProjectId,
            "title": l10n.t("Yeni Sohbet", "New Thread"),
            "mode": workMode,
        ]
        guard let data = try? await postJSON("/api/v1/threads", body: body) else { return }
        struct Resp: Codable { let thread: ThreadDTO }
        if let parsed = try? JSONDecoder().decode(Resp.self, from: data) {
            threads.insert(parsed.thread, at: 0)
            await selectThread(parsed.thread.id)
        }
    }

    func pickReferenceImage(role: String = "style") {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let fileURL = panel.url else { return }
        guard let fileData = try? Data(contentsOf: fileURL) else { return }

        let ext = fileURL.pathExtension.lowercased()
        let mime = ext == "jpg" || ext == "jpeg" ? "image/jpeg" : ext == "webp" ? "image/webp" : "image/png"
        let b64 = fileData.base64EncodedString()
        let fileName = fileURL.lastPathComponent

        Task {
            if activeThreadId == nil { await createNewThread() }
            guard let tid = activeThreadId else { return }
            let payload: [String: Any] = [
                "threadId": tid,
                "projectId": activeProjectId,
                "kind": "image",
                "title": fileName,
                "mime": mime,
                "content": b64,
            ]
            if let data = try? await postJSON("/api/v1/artifacts", body: payload) {
                struct ArtResp: Codable { let artifact: ArtifactDTO }
                if let res = try? JSONDecoder().decode(ArtResp.self, from: data) {
                    artifacts.insert(res.artifact, at: 0)
                    references.append(
                        ReferenceDraft(
                            id: UUID().uuidString,
                            kind: "image",
                            role: role,
                            title: fileName,
                            note: nil,
                            artifactId: res.artifact.id,
                            mime: mime
                        )
                    )
                    showToast(l10n.t("Referans görsel eklendi", "Reference image added"))
                }
            }
        }
    }

    func addArtifactAsReference(_ art: ArtifactDTO) {
        if references.contains(where: { $0.artifactId == art.id }) { return }
        references.append(
            ReferenceDraft(
                id: UUID().uuidString,
                kind: "image",
                role: "style",
                title: art.title,
                note: nil,
                artifactId: art.id,
                mime: art.mime
            )
        )
        showToast(l10n.t("Referans olarak eklendi", "Added as reference"))
    }

    func sendPrompt(_ customText: String? = nil) {
        let text = (customText ?? draftText).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !references.isEmpty else { return }
        if customText == nil { draftText = "" }

        streamTask?.cancel()
        streamTask = Task {
            if activeThreadId == nil { await createNewThread() }
            guard let tid = activeThreadId else { return }
            isStreaming = true
            defer { isStreaming = false }

            var payload: [String: Any] = [
                "threadId": tid,
                "message": text,
                "mode": workMode,
                "autoApplyEdits": autoApplyEdits,
                "stream": true,
            ]
            if selectedModelKey != "auto" {
                let comps = selectedModelKey.components(separatedBy: "::")
                if comps.count == 2 {
                    payload["modelOverride"] = ["providerId": comps[0], "modelId": comps[1]]
                    payload["mode"] = "manual"
                }
            }
            if !references.isEmpty,
               let refData = try? JSONEncoder().encode(references),
               let refObj = try? JSONSerialization.jsonObject(with: refData) {
                payload["references"] = refObj
            }

            // Live SSE streaming via URLSession.bytes
            do {
                guard let url = URL(string: "/api/v1/chat", relativeTo: baseURL) else { return }
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONSerialization.data(withJSONObject: payload)

                let (bytes, _) = try await URLSession.shared.bytes(for: req)
                for try await line in bytes.lines {
                    if Task.isCancelled { break }
                    if line.hasPrefix("data:") {
                        let jsonStr = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        if let rawData = jsonStr.data(using: .utf8) {
                            handleStreamJSON(rawData)
                        }
                    }
                }
            } catch {
                if !Task.isCancelled {
                    showToast(error.localizedDescription)
                }
            }

            await selectThread(tid)
            await refreshBootstrap()
            if let currentFile = openFilePath {
                await openLocalFile(currentFile)
            }
        }
    }

    private func handleStreamJSON(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        if (type == "user_message" || type == "message_start"),
           let msgObj = obj["message"],
           let msgData = try? JSONSerialization.data(withJSONObject: msgObj),
           let decoded = try? JSONDecoder().decode(MessageDTO.self, from: msgData) {
            if !messages.contains(where: { $0.id == decoded.id }) {
                messages.append(decoded)
            }
        } else if type == "delta",
                  let mid = obj["messageId"] as? String,
                  let delta = obj["text"] as? String,
                  let idx = messages.firstIndex(where: { $0.id == mid }) {
            var m = messages[idx]
            if let lastIdx = m.parts.lastIndex(where: { $0.type == "text" }) {
                let prev = m.parts[lastIdx].text ?? ""
                m.parts[lastIdx] = MessagePartDTO(
                    type: "text", text: prev + delta, artifactId: nil, mime: nil, alt: nil,
                    roleName: nil, reason: nil, toolId: nil, toolName: nil, craftScore: nil, cleanedCount: nil
                )
            } else {
                m.parts.append(MessagePartDTO(
                    type: "text", text: delta, artifactId: nil, mime: nil, alt: nil,
                    roleName: nil, reason: nil, toolId: nil, toolName: nil, craftScore: nil, cleanedCount: nil
                ))
            }
            messages[idx] = m
        } else if type == "message_done",
                  let msgObj = obj["message"],
                  let msgData = try? JSONSerialization.data(withJSONObject: msgObj),
                  let decoded = try? JSONDecoder().decode(MessageDTO.self, from: msgData) {
            if let idx = messages.firstIndex(where: { $0.id == decoded.id }) {
                messages[idx] = decoded
            } else {
                messages.append(decoded)
            }
        } else if type == "artifact_created",
                  let artObj = obj["artifact"],
                  let artData = try? JSONSerialization.data(withJSONObject: artObj),
                  let decoded = try? JSONDecoder().decode(ArtifactDTO.self, from: artData) {
            artifacts.removeAll { $0.id == decoded.id }
            artifacts.insert(decoded, at: 0)
            selectedArtifactId = decoded.id
            inspectorTab = .artifacts
            showInspector = true
        } else if type == "error", let msg = obj["message"] as? String {
            showToast(msg)
        }
    }

    func handoffMessage(_ msg: MessageDTO, targetProviderId: String, targetModelId: String, instruction: String) {
        guard let tid = activeThreadId else { return }
        Task {
            isStreaming = true
            defer { isStreaming = false }
            let payload: [String: Any] = [
                "threadId": tid,
                "sourceMessageId": msg.id,
                "targetProviderId": targetProviderId,
                "targetModelId": targetModelId,
                "instruction": instruction,
            ]
            _ = try? await postJSON("/api/v1/handoff", body: payload)
            await selectThread(tid)
            await refreshBootstrap()
        }
    }

    func saveProviderKey(providerId: String, apiKey: String) async -> String {
        let payload: [String: Any] = ["id": providerId, "apiKey": apiKey]
        _ = try? await postJSON("/api/v1/providers", body: payload)
        if let data = try? await postJSON("/api/v1/providers/\(providerId)/test", body: ["apiKey": apiKey]),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            await refreshBootstrap()
            return (json["message"] as? String) ?? "OK"
        }
        return "Hata"
    }

    func addCustomModel(providerId: String, modelId: String, isImage: Bool) async {
        let payload: [String: Any] = [
            "id": modelId,
            "displayName": modelId,
            "capabilities": isImage ? ["image.generate", "image.edit"] : ["chat", "vision", "tools"],
        ]
        _ = try? await postJSON("/api/v1/providers/\(providerId)/models", body: payload)
        await refreshBootstrap()
        showToast(l10n.t("Model eklendi: \(modelId)", "Model added: \(modelId)"))
    }

    func updateQuota(q: QuotaStatusDTO, planName: String, metric: String, limit: Double?, interval: String) async {
        var payload: [String: Any] = [
            "targetType": q.targetType,
            "targetId": q.targetId,
            "displayName": q.displayName,
            "planName": planName,
            "metric": metric,
            "resetInterval": interval,
        ]
        if let lim = limit { payload["limitAmount"] = lim } else { payload["limitAmount"] = NSNull() }
        _ = try? await sendJSON("/api/v1/quotas", method: "PUT", body: payload)
        await refreshBootstrap()
        showToast(l10n.t("Kota güncellendi", "Quota updated"))
    }

    func runFlow(_ flow: FlowDTO, inputs: [String: String], stepOverrides: [String: [String: String]] = [:]) async {
        var payload: [String: Any] = [
            "inputs": inputs,
            "projectId": activeProjectId,
            "threadId": activeThreadId as Any,
        ]
        if !stepOverrides.isEmpty {
            payload["stepModelOverrides"] = stepOverrides
        }
        if let data = try? await postJSON("/api/v1/flows/\(flow.id)/run", body: payload) {
            struct Resp: Codable { let run: FlowRunDTO }
            if let res = try? JSONDecoder().decode(Resp.self, from: data) {
                activeFlowRun = res.run
                await refreshBootstrap()
            }
        }
    }

    func approveFlowRun(_ runId: String, approved: Bool, feedback: String = "") async {
        let payload: [String: Any] = ["approved": approved, "feedback": feedback]
        if let data = try? await postJSON("/api/v1/runs/\(runId)/approve", body: payload) {
            struct Resp: Codable { let run: FlowRunDTO }
            if let res = try? JSONDecoder().decode(Resp.self, from: data) {
                activeFlowRun = res.run
                await refreshBootstrap()
            }
        }
    }

    // MARK: - HTTP Helpers

    private func getData(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw URLError(.badURL)
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    }

    private func postJSON(_ path: String, body: [String: Any]) async throws -> Data {
        try await sendJSON(path, method: "POST", body: body)
    }

    private func sendJSON(_ path: String, method: String, body: [String: Any]) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }

    private func deleteRequest(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }
}
