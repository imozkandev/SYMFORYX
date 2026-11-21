import Foundation

enum AppLanguage: String, CaseIterable, Identifiable {
    case en, tr
    var id: String { rawValue }
    var label: String { self == .tr ? "TR" : "EN" }
}

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
}

enum NavSection: String, CaseIterable, Identifiable {
    case chat, quotas, flows, tools, providers, settings
    var id: String { rawValue }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case editor, diff, artifacts
    var id: String { rawValue }
}

struct L10n {
    let lang: AppLanguage
    func t(_ tr: String, _ en: String) -> String { lang == .tr ? tr : en }
}

struct ProjectDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let instructions: String?
    let rootPath: String?
}

struct LocalFileEntryDTO: Codable, Identifiable, Hashable {
    var id: String { path }
    let path: String
    let name: String
    let kind: String // "file" | "dir"
    let size: Int
    let depth: Int
}

struct LocalGitChangedFileDTO: Codable, Identifiable, Hashable {
    var id: String { "\(status)-\(path)" }
    let status: String
    let path: String
}

struct LocalGitStatusDTO: Codable {
    let isGitRepo: Bool
    let branch: String
    let changedFiles: [LocalGitChangedFileDTO]
    let diffStat: String
}

struct LocalSearchMatchDTO: Codable, Identifiable {
    var id: String { "\(path):\(line):\(text)" }
    let path: String
    let line: Int
    let text: String
}

struct ShellRunResultDTO: Codable {
    let command: String
    let cwd: String
    let exitCode: Int
    let stdout: String
    let stderr: String
    let durationMs: Int
}

struct AppliedFileResultDTO: Codable {
    let path: String
    let bytes: Int
    let created: Bool
}

struct TerminalEntry: Identifiable {
    let id = UUID()
    let command: String
    let cwd: String
    let exitCode: Int
    let stdout: String
    let stderr: String
    let durationMs: Int
    let timestamp = Date()
}

struct ThreadDTO: Codable, Identifiable, Hashable {
    let id: String
    let projectId: String
    let title: String
    let mode: String
    let updatedAt: String
}

struct MessageAuthorDTO: Codable {
    let kind: String
    let providerId: String?
    let modelId: String?
    let modelName: String?
    let badgeColor: String?
    let badgeLetter: String?
}

struct MessageUsageDTO: Codable {
    let inputTokens: Int
    let outputTokens: Int
    let costUsd: Double
    let latencyMs: Double
}

struct MessagePartDTO: Codable {
    let type: String
    let text: String?
    let artifactId: String?
    let mime: String?
    let alt: String?
    let roleName: String?
    let reason: String?
    let toolId: String?
    let toolName: String?
    let craftScore: Int?
    let cleanedCount: Int?
}

struct MessageDTO: Codable, Identifiable {
    let id: String
    let threadId: String
    let parentId: String?
    let role: String
    let author: MessageAuthorDTO
    var parts: [MessagePartDTO]
    var artifacts: [String]?
    var usage: MessageUsageDTO?
    var pinned: Bool?
    let createdAt: String

    var plainText: String {
        parts.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
    }
    var imageArtifactIds: [String] {
        parts.compactMap { $0.type == "image" ? $0.artifactId : nil }
    }
    var routingSummary: String? {
        guard let rn = parts.first(where: { $0.type == "routing_note" }) else { return nil }
        return "\(rn.roleName ?? "") · \(rn.reason ?? "")"
    }
    var craftScore: Int? {
        parts.first(where: { $0.type == "slop_audit" })?.craftScore
    }
    var slopCleanedCount: Int {
        parts.first(where: { $0.type == "slop_audit" })?.cleanedCount ?? 0
    }
}

struct ArtifactVersionDTO: Codable {
    let version: Int
    let content: String
    let mime: String
    let note: String?
}

struct ArtifactDTO: Codable, Identifiable {
    let id: String
    let threadId: String
    let projectId: String
    let kind: String
    let title: String
    let mime: String
    let language: String?
    let currentVersion: Int
    let versions: [ArtifactVersionDTO]

    var activeVersion: ArtifactVersionDTO? {
        if currentVersion >= 1 && currentVersion <= versions.count {
            return versions[currentVersion - 1]
        }
        return versions.last
    }
}

struct ModelPricingDTO: Codable, Hashable {
    let inputPerMTok: Double
    let outputPerMTok: Double
    let perImage: Double?
}

struct ModelInfoDTO: Codable, Identifiable, Hashable {
    let id: String
    let providerId: String
    let displayName: String
    let capabilities: [String]
    let pricing: ModelPricingDTO?
    let local: Bool?
}

struct ProviderDTO: Codable, Identifiable {
    let id: String
    let type: String
    let displayName: String
    let auth: String
    let baseUrl: String?
    let alias: String?
    let badgeColor: String?
    let badgeLetter: String?
    let enabled: Bool
    let hasKey: Bool?
    let maskedKey: String?
    let models: [ModelInfoDTO]
}

struct QuotaStatusDTO: Codable, Identifiable {
    let id: String
    let targetType: String
    let targetId: String
    let displayName: String
    let planName: String
    let metric: String
    let limitAmount: Double?
    let resetInterval: String
    let usedAmount: Double
    let remainingAmount: Double?
    let percentUsed: Int
    let nextResetAt: String?
    let windowCostUsd: Double
    let totalCostUsd: Double
    let windowRequests: Int
    let windowTokens: Int
}

struct FlowInputFieldDTO: Codable {
    let type: String?
    let label: String?
    let placeholder: String?
    let options: [String]?
}

struct FlowStepDTO: Codable, Identifiable {
    let id: String
    let name: String?
    let type: String?
    let use: String?
}

struct FlowDTO: Codable, Identifiable {
    let id: String
    let name: String
    let nameEn: String?
    let description: String
    let descriptionEn: String?
    let category: String?
    let estimatedCostUsd: Double?
    let inputs: [String: FlowInputFieldDTO]?
    let steps: [FlowStepDTO]?
}

struct FlowRunStepStateDTO: Codable {
    let stepId: String
    let status: String
    let approvalMessage: String?
    let artifactIds: [String]?
}

struct FlowRunDTO: Codable, Identifiable {
    let id: String
    let flowId: String
    let flowName: String
    let status: String
    let stepStates: [FlowRunStepStateDTO]
    let currentStepIndex: Int
    let totalCostUsd: Double
}

struct ToolManifestDTO: Codable, Identifiable {
    let id: String
    let name: String
    let version: String?
    let publisher: String?
    let type: String?
    let category: String?
    let description: String?
    let installed: Bool?
    let enabled: Bool?
    let policy: String?
}

struct MemoryItemDTO: Codable, Identifiable {
    let id: String
    let scope: String
    let projectId: String?
    let content: String
    let createdAt: String?
}

struct SlashCommandDTO: Codable, Identifiable {
    var id: String { command }
    let command: String
    let aliases: [String]?
    let category: String?
    let descTr: String?
    let descEn: String?
    let example: String?
}

struct UserSettingsDTO: Codable {
    let language: String?
    let theme: String?
    let economyMode: Bool?
    let tokenOptimizationEnabled: Bool?
    let aiSlopBlockerEnabled: Bool?
}

struct UsageSummaryDTO: Codable {
    let totalCostUsd: Double
    let totalInputTokens: Int
    let totalOutputTokens: Int
    let requestCount: Int
}

struct OptimizationStatsDTO: Codable {
    let savedTokens: Int
    let savedCostUsd: Double
    let cacheHits: Int
    let slopItemsBlocked: Int?
}

struct BootstrapDTO: Codable {
    let projects: [ProjectDTO]?
    let threads: [ThreadDTO]?
    let providers: [ProviderDTO]?
    let flows: [FlowDTO]?
    let tools: [ToolManifestDTO]?
    let quotas: [QuotaStatusDTO]?
    let commands: [SlashCommandDTO]?
    let settings: UserSettingsDTO?
    let usage: UsageSummaryDTO?
    let optimization: OptimizationStatsDTO?
}

struct ReferenceDraft: Identifiable, Codable {
    let id: String
    let kind: String // "image" | "idea" | "url"
    var role: String // "style" | "layout" | "palette" | "subject" | "edit_source" | "inspiration" | "constraint"
    var title: String
    var note: String?
    var artifactId: String?
    var mime: String?
    var url: String?
}

// MARK: - Markdown Block Parser (Prose + Fenced Code Cards)

struct MarkdownSegment: Identifiable {
    let id: Int
    let isCode: Bool
    let language: String
    let filename: String?
    let content: String
}

func parseMarkdownSegments(_ text: String) -> [MarkdownSegment] {
    var result: [MarkdownSegment] = []
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    var proseBuf: [String] = []
    var codeBuf: [String] = []
    var inCode = false
    var codeLang = ""
    var codeFile: String? = nil
    var idx = 0

    func flushProse() {
        let joined = proseBuf.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !joined.isEmpty {
            result.append(MarkdownSegment(id: idx, isCode: false, language: "", filename: nil, content: joined))
            idx += 1
        }
        proseBuf.removeAll()
    }

    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") {
            if !inCode {
                flushProse()
                inCode = true
                let info = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                if let colonIdx = info.firstIndex(of: ":") {
                    codeLang = String(info[..<colonIdx])
                    codeFile = String(info[info.index(after: colonIdx)...])
                } else {
                    let parts = info.split(separator: " ").map(String.init)
                    codeLang = parts.first ?? "text"
                    codeFile = parts.count > 1 ? parts[1] : nil
                }
            } else {
                result.append(
                    MarkdownSegment(
                        id: idx,
                        isCode: true,
                        language: codeLang.isEmpty ? "text" : codeLang,
                        filename: codeFile,
                        content: codeBuf.joined(separator: "\n")
                    )
                )
                idx += 1
                codeBuf.removeAll()
                inCode = false
                codeLang = ""
                codeFile = nil
            }
        } else if inCode {
            codeBuf.append(line)
        } else {
            proseBuf.append(line)
        }
    }

    if inCode && !codeBuf.isEmpty {
        result.append(
            MarkdownSegment(
                id: idx,
                isCode: true,
                language: codeLang.isEmpty ? "text" : codeLang,
                filename: codeFile,
                content: codeBuf.joined(separator: "\n")
            )
        )
    } else {
        flushProse()
    }
    return result
}

func formatResetCountdown(_ iso: String?, lang: AppLanguage) -> String {
    guard let iso = iso else { return lang == .tr ? "Sıfırlanmaz" : "No reset" }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let target = date else { return iso }
    let diff = Int(target.timeIntervalSinceNow)
    if diff <= 0 { return lang == .tr ? "Şimdi" : "Now" }
    let mins = diff / 60
    let hours = mins / 60
    let days = hours / 24
    if days > 0 {
        return lang == .tr ? "\(days)g \(hours % 24)sa" : "\(days)d \(hours % 24)h"
    }
    if hours > 0 {
        return lang == .tr ? "\(hours)sa \(mins % 60)dk" : "\(hours)h \(mins % 60)m"
    }
    return lang == .tr ? "\(mins)dk" : "\(mins)m"
}

func formatQuotaVal(_ val: Double?, metric: String, lang: AppLanguage) -> String {
    guard let v = val else { return lang == .tr ? "Sınırsız" : "Unlimited" }
    switch metric {
    case "usd": return String(format: "$%.4f", v)
    case "tokens": return v >= 1000 ? String(format: "%.1fk tok", v / 1000) : "\(Int(v)) tok"
    case "images": return "\(Int(v)) img"
    default: return "\(Int(v)) req"
    }
}
