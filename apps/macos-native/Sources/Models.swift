import Foundation

enum AppLanguage: String, CaseIterable, Identifiable {
    case tr, en
    var id: String { rawValue }
    var label: String { self == .tr ? "TR" : "EN" }
}

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
}

enum NavSection: String, CaseIterable, Identifiable {
    case chat, quotas, flows, providers
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
    let artifacts: [String]?
    let usage: MessageUsageDTO?
    let pinned: Bool?
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
    let badgeColor: String
    let badgeLetter: String
    let enabled: Bool
    let hasKey: Bool
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
    let type: String
    let label: String
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
    let inputs: [String: FlowInputFieldDTO]
    let steps: [FlowStepDTO]
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
}

struct BootstrapDTO: Codable {
    let projects: [ProjectDTO]
    let threads: [ThreadDTO]
    let providers: [ProviderDTO]
    let flows: [FlowDTO]
    let quotas: [QuotaStatusDTO]
    let usage: UsageSummaryDTO
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
