export type Role = "user" | "assistant" | "system" | "tool";

export type WorkMode =
  | "manual"
  | "smart"
  | "chain"
  | "compare"
  | "council"
  | "agent";

export type ExperienceMode = "simple" | "expert";

export type SharedContextMode = "full" | "own_plus_user" | "transferred_only";

export type ThemeMode = "system" | "light" | "dark" | "high-contrast";

export type LanguageCode = "tr" | "en";

export type Capability =
  | "chat"
  | "vision"
  | "tools"
  | "json_mode"
  | "reasoning"
  | "image.generate"
  | "image.edit"
  | "audio.stt"
  | "audio.tts"
  | "music.generate"
  | "video.generate"
  | "model3d.generate"
  | "embeddings";

export type SymErrorCode =
  | "auth"
  | "rate_limit"
  | "context_overflow"
  | "content_filter"
  | "unavailable"
  | "invalid_request"
  | "budget_exceeded"
  | "permission_denied"
  | "timeout";

export class SymError extends Error {
  code: SymErrorCode;
  providerId?: string;
  retryable: boolean;
  details?: unknown;

  constructor(
    code: SymErrorCode,
    message: string,
    opts?: { providerId?: string; retryable?: boolean; details?: unknown }
  ) {
    super(message);
    this.name = "SymError";
    this.code = code;
    this.providerId = opts?.providerId;
    this.retryable =
      opts?.retryable ?? (code === "rate_limit" || code === "unavailable");
    this.details = opts?.details;
  }
}

export interface MessageAuthor {
  kind: "user" | "model" | "tool" | "system";
  providerId?: string;
  modelId?: string;
  modelName?: string;
  toolId?: string;
  roleId?: string;
  badgeColor?: string;
  badgeLetter?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image"; artifactId: string; mime: string; url?: string; alt?: string }
  | { type: "file"; artifactId: string; name: string; mime: string; size?: number }
  | {
      type: "tool_call";
      callId: string;
      toolId: string;
      toolName?: string;
      args: unknown;
      status?: "running" | "done" | "error" | "awaiting_approval";
      durationMs?: number;
    }
  | {
      type: "tool_result";
      callId: string;
      toolId?: string;
      content: MessagePart[];
      isError?: boolean;
      untrusted?: boolean;
    }
  | { type: "summary"; coversUntil: string; text: string; messageCount?: number }
  | {
      type: "routing_note";
      roleId: string;
      roleName: string;
      providerId: string;
      modelId: string;
      reason: string;
      layer: 1 | 2 | 3;
      confidence: number;
      fallbackUsed?: boolean;
      alternatives?: Array<{ roleId: string; providerId: string; modelId: string; label: string }>;
    }
  | {
      type: "transfer_note";
      fromMessageId: string;
      fromAuthor: string;
      originalPrompt?: string;
      visionConverted?: boolean;
    }
  | {
      type: "slop_audit";
      craftScore: number;
      cleanedCount: number;
      flags: string[];
      active: boolean;
    };

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  cachedTokens?: number;
}

export interface SymMessage {
  id: string;
  threadId: string;
  parentId: string | null;
  branchId?: string;
  versionIndex?: number;
  role: Role;
  author: MessageAuthor;
  parts: MessagePart[];
  artifacts?: string[];
  usage?: MessageUsage;
  pinned?: boolean;
  compareGroupId?: string;
  selectedCompare?: boolean;
  createdAt: string;
}

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  perImage?: number;
}

export interface ModelInfo {
  id: string;
  providerId: string;
  displayName: string;
  capabilities: Capability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing?: ModelPricing;
  local?: boolean;
  visible?: boolean;
}

export interface ProviderConfig {
  id: string;
  type:
    | "openai"
    | "anthropic"
    | "google"
    | "openai_compatible"
    | "ollama"
    | "fal"
    | "stability"
    | "replicate"
    | "ideogram"
    | "comfyui"
    | "video"
    | "audio"
    | "model3d"
    | "demo";
  displayName: string;
  auth: "api_key" | "oauth" | "none";
  baseUrl?: string;
  alias?: string;
  badgeColor: string;
  badgeLetter: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey?: string;
  models: ModelInfo[];
}

export type ReferenceRole =
  | "style"
  | "layout"
  | "palette"
  | "subject"
  | "edit_source"
  | "inspiration"
  | "constraint";

export interface ReferenceItem {
  id: string;
  kind: "image" | "idea" | "url";
  role: ReferenceRole;
  title: string;
  note?: string;
  artifactId?: string;
  mime?: string;
  url?: string;
  extractedText?: string;
  weight?: number;
}

export type QuotaMetric = "requests" | "tokens" | "images" | "usd";
export type QuotaResetInterval = "hourly" | "5h" | "daily" | "weekly" | "monthly" | "never";

export interface QuotaConfig {
  id: string;
  targetType: "provider" | "tool";
  targetId: string;
  displayName: string;
  planName: string;
  metric: QuotaMetric;
  limitAmount: number | null; // null = unlimited
  resetInterval: QuotaResetInterval;
  resetAnchorIso?: string;
  liveRemaining?: number | null;
  liveLimit?: number | null;
  liveResetAt?: string | null;
  updatedAt: string;
}

export interface QuotaStatus extends QuotaConfig {
  usedAmount: number;
  remainingAmount: number | null;
  percentUsed: number;
  windowStartIso: string;
  nextResetAt: string | null;
  windowCostUsd: number;
  totalCostUsd: number;
  windowRequests: number;
  windowTokens: number;
}

export interface ChatRequest {
  modelId: string;
  messages: SymMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchemaForLLM[];
  apiKey?: string;
  baseUrl?: string;
  /** Attachments resolved to base64 or text for vision/file support */
  resolvedArtifacts?: Record<
    string,
    { mime: string; contentText?: string; base64?: string; name?: string }
  >;
}

export interface ToolSchemaForLLM {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; callId: string; toolId: string; args: unknown }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
    }
  | { type: "done" };

export interface ImageRequest {
  modelId?: string;
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "512x512";
  style?: string;
  references?: ReferenceItem[];
  referenceImages?: Array<{ mime: string; base64: string; role: ReferenceRole; note?: string }>;
  apiKey?: string;
  baseUrl?: string;
}

export interface ImageEditRequest extends ImageRequest {
  sourceImageBase64: string;
  sourceMime: string;
}

export interface ImageResult {
  mime: string;
  base64: string;
  revisedPrompt?: string;
  costUsd: number;
  latencyMs: number;
}

export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  auth: "api_key" | "oauth" | "none";
  badgeColor: string;
  badgeLetter: string;

  validateCredentials(
    secret: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message?: string; models?: ModelInfo[] }>;
  listModels(secret?: string, baseUrl?: string): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  generateImage?(req: ImageRequest, signal: AbortSignal): Promise<ImageResult>;
  editImage?(req: ImageEditRequest, signal: AbortSignal): Promise<ImageResult>;
  estimateCost(req: {
    modelId: string;
    inputTokens: number;
    outputTokens?: number;
    images?: number;
  }): CostEstimate;
  toProviderFormat(messages: SymMessage[]): unknown;
}

export interface TaskRole {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  mention: string;
  primaryProviderId: string;
  primaryModelId: string;
  fallbackProviderId?: string;
  fallbackModelId?: string;
  defaultTools?: string[];
  systemPrompt?: string;
  custom?: boolean;
  projectId?: string | null;
}

export type ArtifactKind =
  | "image"
  | "code"
  | "preview"
  | "document"
  | "table"
  | "chart"
  | "audio"
  | "video"
  | "diagram"
  | "file";

export interface ArtifactVersion {
  version: number;
  content: string;
  files?: Array<{ path: string; language: string; content: string }>;
  mime: string;
  note?: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  threadId: string;
  projectId: string;
  messageId?: string;
  kind: ArtifactKind;
  title: string;
  mime: string;
  language?: string;
  currentVersion: number;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  instructions?: string;
  rootPath?: string | null;
  isPrivate?: boolean;
  allowedProviders?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  mode: WorkMode;
  pinnedModelId?: string | null;
  pinnedProviderId?: string | null;
  activeBranchHeadId?: string | null;
  draftText?: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  scope: "project" | "personal";
  projectId?: string | null;
  content: string;
  sourceMessageId?: string | null;
  approved: boolean;
  createdAt: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  size: number;
  contentText: string;
  artifactId?: string;
  createdAt: string;
}

export type PermissionPolicy =
  | "ask_every_time"
  | "allow_thread"
  | "allow_project"
  | "allow_always"
  | "block";

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  verified?: boolean;
  type: "builtin" | "mcp" | "openapi" | "http" | "script";
  category:
    | "web"
    | "code"
    | "preview"
    | "design"
    | "data"
    | "developer"
    | "productivity"
    | "automation"
    | "media"
    | "mcp";
  description: string;
  inputs: Record<
    string,
    {
      type: string;
      description?: string;
      required?: boolean;
      default?: unknown;
      min?: number;
      max?: number;
      enum?: string[];
    }
  >;
  outputs?: Array<{ type: string; description?: string }>;
  permissions: {
    network: string[];
    filesystem: "none" | "project_read" | "project_write";
    secrets: string[];
    writes_external: boolean;
  };
  cost: {
    model: "free" | "paid_api" | "local";
    estimatedPerCallUsd?: number;
  };
  ui?: {
    slash?: string;
    mention?: string;
    confirm?: "never" | "first_time" | "always";
  };
  runtime?: {
    entry?: string;
    timeout_ms?: number;
    memory_mb?: number;
    mcpUrl?: string;
    mcpCommand?: string;
    httpUrl?: string;
    httpMethod?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
  };
  rating?: number;
  installed?: boolean;
  enabled?: boolean;
  policy?: PermissionPolicy;
}

export interface FlowInputField {
  type: "text" | "select" | "file" | "number" | "boolean";
  label: string;
  placeholder?: string;
  options?: string[];
  default?: unknown;
  required?: boolean;
}

export interface FlowStep {
  id: string;
  type?: "model" | "tool" | "approval" | "condition" | "parallel" | "loop" | "input" | "output";
  name?: string;
  use?: string; // e.g., role:gorsel-uretim, role:kodlama, tool:canli-onizleme
  prompt?: string;
  attach?: string[];
  input?: unknown;
  message?: string;
  on_reject?: { goto: string; feedback?: boolean };
  condition?: string;
  then_goto?: string;
  else_goto?: string;
  steps?: FlowStep[];
  items?: string;
}

export interface FlowDefinition {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  descriptionEn?: string;
  category?: string;
  tags?: string[];
  estimatedCostUsd?: number;
  inputs: Record<string, FlowInputField>;
  steps: FlowStep[];
  outputs?: string[];
  budget?: { max_cost_usd?: number };
  schedule?: string;
  isTemplate?: boolean;
  yamlSource?: string;
}

export interface FlowStepRunState {
  stepId: string;
  status: "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  output?: unknown;
  artifactIds?: string[];
  costUsd?: number;
  error?: string;
  approvalMessage?: string;
}

export interface FlowRun {
  id: string;
  flowId: string;
  flowName: string;
  threadId?: string;
  projectId: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  inputs: Record<string, unknown>;
  stepStates: FlowStepRunState[];
  currentStepIndex: number;
  totalCostUsd: number;
  outputs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  name: string;
  scope: "workspace" | "project" | "provider";
  scopeId?: string | null;
  type: "soft" | "hard";
  limitUsd: number;
  period: "daily" | "monthly";
  warnAtPercent: number;
  enabled: boolean;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  threadId?: string;
  messageId?: string;
  providerId: string;
  modelId: string;
  toolId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface UserSettings {
  language: LanguageCode;
  theme: ThemeMode;
  accentColor: string;
  experienceMode: ExperienceMode;
  fontSize: "small" | "medium" | "large";
  messageDensity: "comfortable" | "compact";
  defaultMode: WorkMode;
  sharedContext: SharedContextMode;
  sendKey: "enter" | "ctrl_enter";
  autoTitle: boolean;
  autoSummarizeThreshold: number; // 50-95
  personalMemoryEnabled: boolean;
  autoMemorySuggest: boolean;
  agentMaxSteps: number;
  agentMaxCostUsd: number;
  costDisplay: "hidden" | "total" | "per_message";
  economyMode: boolean;
  tokenOptimizationEnabled?: boolean;
  responseCacheEnabled?: boolean;
  aiSlopBlockerEnabled?: boolean;
  telemetry: boolean;
  onboardingCompleted: boolean;
  routingRules: RoutingRule[];
  routingConfidenceThreshold: number;
  routingExplain: boolean;
}

export interface RoutingRule {
  id: string;
  when: {
    attachment?: string | string[];
    text_matches?: string;
  };
  use: string; // role:<id> or provider:<id>
  tools?: string[];
  description?: string;
}

export interface RoutingDecision {
  layer: 1 | 2 | 3;
  roleId: string;
  roleName: string;
  providerId: string;
  modelId: string;
  reason: string;
  confidence: number;
  suggestedTools: string[];
  isCompareAll?: boolean;
  explicitTargets?: Array<{ providerId: string; modelId: string; roleId?: string }>;
  uncertainAlternatives?: Array<{
    roleId: string;
    roleName: string;
    providerId: string;
    modelId: string;
  }>;
}

export interface ApprovalRequest {
  id: string;
  kind: "tool" | "flow" | "agent";
  title: string;
  description: string;
  toolId?: string;
  args?: unknown;
  estimatedCostUsd?: number;
  threadId?: string;
  flowRunId?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}
