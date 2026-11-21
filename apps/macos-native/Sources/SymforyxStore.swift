import AppKit
import Foundation
import SwiftUI

@MainActor
final class SymforyxStore: ObservableObject {
    @Published var language: AppLanguage = .tr
    @Published var appearance: AppAppearance = .system
    @Published var navSection: NavSection = .chat

    @Published var serverReady = false
    @Published var serverError: String?
    @Published var baseURL: URL = URL(string: "http://127.0.0.1:3456")!

    @Published var projects: [ProjectDTO] = []
    @Published var threads: [ThreadDTO] = []
    @Published var providers: [ProviderDTO] = []
    @Published var flows: [FlowDTO] = []
    @Published var quotas: [QuotaStatusDTO] = []
    @Published var usage = UsageSummaryDTO(totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, requestCount: 0)
    @Published var optimization = OptimizationStatsDTO(savedTokens: 0, savedCostUsd: 0, cacheHits: 0)
    @Published var tokenOptimizationEnabled = true
    @Published var aiSlopBlockerEnabled = true

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
        // 1. Check if user already has a SYMFORYX server running on 3000..3005 or 3456
        for port in [3456, 3000, 3001, 3002] {
            if let url = URL(string: "http://127.0.0.1:\(port)/api/health"),
               let (data, resp) = try? await URLSession.shared.data(from: url),
               (resp as? HTTPURLResponse)?.statusCode == 200,
               String(data: data, encoding: .utf8)?.contains("SYMFORYX") == true {
                self.baseURL = URL(string: "http://127.0.0.1:\(port)")!
                self.serverReady = true
                await refreshBootstrap()
                return
            }
        }

        // 2. Auto-spawn local Bun server on dedicated port 3456
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
        } catch {
            self.serverError = "Bun sunucusu başlatılamadı (\(bunPath)): \(error.localizedDescription)"
            return
        }

        let healthURL = URL(string: "http://127.0.0.1:3456/api/health")!
        for _ in 0..<40 {
            try? await Task.sleep(nanoseconds: 150_000_000)
            if let (_, resp) = try? await URLSession.shared.data(from: healthURL),
               (resp as? HTTPURLResponse)?.statusCode == 200 {
                self.baseURL = URL(string: "http://127.0.0.1:3456")!
                self.serverReady = true
                await refreshBootstrap()
                return
            }
        }
        self.serverError = "SYMFORYX çekirdek sunucusuna bağlanılamadı."
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
        guard let data = try? await getData("/api/v1/bootstrap"),
              let boot = try? JSONDecoder().decode(BootstrapDTO.self, from: data) else { return }
        self.projects = boot.projects
        self.threads = boot.threads
        self.providers = boot.providers
        self.flows = boot.flows
        self.quotas = boot.quotas
        self.usage = boot.usage
        if let opt = boot.optimization { self.optimization = opt }

        if activeProjectId.isEmpty || !boot.projects.contains(where: { $0.id == activeProjectId }) {
            activeProjectId = boot.projects.first?.id ?? ""
        }
        if activeThreadId == nil, let t = boot.threads.first(where: { $0.projectId == activeProjectId }) ?? boot.threads.first {
            await selectThread(t.id)
        }
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
                "stream": false,
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

            if let _ = try? await postJSON("/api/v1/chat", body: payload) {
                await selectThread(tid)
                await refreshBootstrap()
            }
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
        let url = baseURL.appendingPathComponent(path)
        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    }

    private func postJSON(_ path: String, body: [String: Any]) async throws -> Data {
        try await sendJSON(path, method: "POST", body: body)
    }

    private func sendJSON(_ path: String, method: String, body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }

    private func deleteRequest(_ path: String) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "DELETE"
        let (data, _) = try await URLSession.shared.data(for: req)
        return data
    }
}
