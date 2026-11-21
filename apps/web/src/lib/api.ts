import type {
  Artifact,
  Budget,
  FlowDefinition,
  FlowRun,
  MemoryItem,
  Project,
  ProjectFile,
  ProviderConfig,
  QuotaStatus,
  SymMessage,
  TaskRole,
  Thread,
  ToolManifest,
  UserSettings,
  WorkMode,
} from "@symforyx/core";

export interface BootstrapPayload {
  workspaces: Array<{ id: string; name: string }>;
  projects: Project[];
  threads: Thread[];
  providers: ProviderConfig[];
  roles: TaskRole[];
  tools: ToolManifest[];
  flows: FlowDefinition[];
  settings: UserSettings;
  usage: {
    period: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
    byProvider: Array<{ providerId: string; costUsd: number; tokens: number; count: number }>;
    byModel: Array<{ providerId: string; modelId: string; costUsd: number; tokens: number; count: number }>;
    byProject: Array<{ projectId: string; projectName: string; costUsd: number; count: number }>;
    topThreads: Array<{ threadId: string; title: string; costUsd: number; count: number }>;
  };
  budgets: Budget[];
  quotas: QuotaStatus[];
  optimization?: { savedTokens: number; savedCostUsd: number; cacheHits: number; slopItemsBlocked?: number };
  commands: Array<{ command: string; aliases: string[]; category?: string; descTr: string; descEn: string; example: string }>;
  shortcuts: Array<{ keys: string; descTr: string; descEn: string }>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  bootstrap: () => req<BootstrapPayload>("/api/v1/bootstrap"),

  createProject: (data: { name: string; description?: string; instructions?: string; isPrivate?: boolean }) =>
    req<{ project: Project; thread: Thread }>("/api/v1/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: Partial<Project>) =>
    req<{ project: Project }>(`/api/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    req<{ ok: boolean; projects: Project[]; threads: Thread[] }>(`/api/v1/projects/${id}`, { method: "DELETE" }),
  deleteWorkspace: (id: string) =>
    req<{ ok: boolean; workspaces: Array<{ id: string; name: string }>; projects: Project[]; threads: Thread[] }>(
      `/api/v1/workspaces/${id}`,
      { method: "DELETE" }
    ),

  createThread: (data: { projectId: string; title?: string; mode?: WorkMode }) =>
    req<{ thread: Thread }>("/api/v1/threads", { method: "POST", body: JSON.stringify(data) }),
  getThread: (id: string) =>
    req<{ thread: Thread; messages: SymMessage[]; artifacts: Artifact[]; references?: import("@symforyx/core").ReferenceItem[] }>(`/api/v1/threads/${id}`),
  addThreadReference: (threadId: string, input: string) =>
    req<{ reference: import("@symforyx/core").ReferenceItem; references: import("@symforyx/core").ReferenceItem[] }>(
      `/api/v1/threads/${threadId}/references`,
      { method: "POST", body: JSON.stringify({ input }) }
    ),
  updateThread: (id: string, data: Partial<Thread>) =>
    req<{ thread: Thread }>(`/api/v1/threads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteThread: (id: string) => req<{ ok: boolean }>(`/api/v1/threads/${id}`, { method: "DELETE" }),
  stopThread: (id: string) => req<{ ok: boolean }>(`/api/v1/threads/${id}/stop`, { method: "POST" }),

  updateMessage: (id: string, data: Partial<SymMessage>) =>
    req<{ message: SymMessage }>(`/api/v1/messages/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  selectCompare: (threadId: string, compareGroupId: string, messageId: string) =>
    req<{ ok: boolean }>("/api/v1/messages/compare-select", {
      method: "POST",
      body: JSON.stringify({ threadId, compareGroupId, messageId }),
    }),
  searchMessages: (q: string) =>
    req<{ results: Array<{ messageId: string; threadId: string; snippet: string }> }>(
      `/api/v1/search?q=${encodeURIComponent(q)}`
    ),

  createArtifact: (data: {
    threadId: string;
    projectId: string;
    kind: Artifact["kind"];
    title: string;
    mime: string;
    content: string;
    language?: string;
  }) => req<{ artifact: Artifact }>("/api/v1/artifacts", { method: "POST", body: JSON.stringify(data) }),
  setArtifactVersion: (id: string, version: number) =>
    req<{ artifact: Artifact }>(`/api/v1/artifacts/${id}/version`, {
      method: "PATCH",
      body: JSON.stringify({ version }),
    }),

  saveProvider: (data: Record<string, unknown>) =>
    req<{ provider: ProviderConfig }>("/api/v1/providers", { method: "POST", body: JSON.stringify(data) }),
  testProvider: (id: string, data: { apiKey?: string; baseUrl?: string }) =>
    req<{ ok: boolean; message?: string; models?: unknown[] }>(`/api/v1/providers/${id}/test`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  detectOllama: (baseUrl?: string) =>
    req<{ ok: boolean; message?: string; models?: unknown[] }>(
      `/api/v1/providers/ollama/detect${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ""}`
    ),
  addProviderModel: (providerId: string, model: { id: string; displayName?: string; capabilities?: string[] }) =>
    req<{ provider: ProviderConfig }>(`/api/v1/providers/${providerId}/models`, {
      method: "POST",
      body: JSON.stringify(model),
    }),

  listQuotas: () => req<{ quotas: QuotaStatus[] }>("/api/v1/quotas"),
  saveQuota: (quota: Record<string, unknown>) =>
    req<{ quota: QuotaStatus; quotas: QuotaStatus[] }>("/api/v1/quotas", {
      method: "PUT",
      body: JSON.stringify(quota),
    }),

  saveRole: (role: TaskRole) =>
    req<{ role: TaskRole }>(`/api/v1/roles/${role.id}`, { method: "PUT", body: JSON.stringify(role) }),

  installTool: (id: string, data?: { policy?: string; secrets?: Record<string, string> }) =>
    req<{ tool: ToolManifest }>(`/api/v1/tools/${id}/install`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  setToolPermission: (id: string, policy: string) =>
    req<{ ok: boolean; tool: ToolManifest }>(`/api/v1/tools/${id}/permission`, {
      method: "POST",
      body: JSON.stringify({ scope: "global", scopeId: "global", policy }),
    }),
  invokeTool: (id: string, args: unknown, projectId: string, threadId?: string) =>
    req<{ ok: boolean; result?: { text?: string; artifactIds?: string[]; isError?: boolean }; error?: string }>(
      `/api/v1/tools/${id}/invoke`,
      { method: "POST", body: JSON.stringify({ args, projectId, threadId }) }
    ),
  discoverMcp: (url: string) =>
    req<{ ok: boolean; tools?: ToolManifest[]; error?: string }>("/api/v1/tools/mcp/discover", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  runFlow: (
    id: string,
    inputs: Record<string, unknown>,
    projectId: string,
    threadId?: string,
    stepModelOverrides?: Record<string, { providerId: string; modelId: string }>
  ) =>
    req<{ run: FlowRun }>(`/api/v1/flows/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ inputs, projectId, threadId, stepModelOverrides }),
    }),
  saveThreadAsFlow: (threadId: string, name?: string) =>
    req<{ flow: FlowDefinition }>(`/api/v1/threads/${threadId}/save-as-flow`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  listFlowRuns: (projectId?: string) =>
    req<{ runs: FlowRun[] }>(`/api/v1/runs${projectId ? `?projectId=${projectId}` : ""}`),
  approveFlowRun: (runId: string, approved: boolean, feedback?: string) =>
    req<{ run: FlowRun }>(`/api/v1/runs/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved, feedback }),
    }),

  listMemories: (projectId?: string) =>
    req<{ memories: MemoryItem[] }>(`/api/v1/memories${projectId ? `?projectId=${projectId}` : ""}`),
  addMemory: (data: { scope: "project" | "personal"; projectId?: string; content: string; sourceMessageId?: string }) =>
    req<{ memory: MemoryItem }>("/api/v1/memories", { method: "POST", body: JSON.stringify(data) }),
  deleteMemory: (id: string) => req<{ ok: boolean }>(`/api/v1/memories/${id}`, { method: "DELETE" }),

  listFiles: (projectId: string) => req<{ files: ProjectFile[] }>(`/api/v1/projects/${projectId}/files`),
  uploadFile: (projectId: string, data: { name: string; mime: string; contentText: string; size?: number }) =>
    req<{ file: ProjectFile }>(`/api/v1/projects/${projectId}/files`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteFile: (id: string) => req<{ ok: boolean }>(`/api/v1/files/${id}`, { method: "DELETE" }),

  getUsage: (period: "daily" | "weekly" | "monthly" = "monthly") =>
    req<{ usage: BootstrapPayload["usage"]; budgets: Budget[] }>(`/api/v1/usage?period=${period}`),
  createBudget: (data: Omit<Budget, "id" | "createdAt">) =>
    req<{ budget: Budget }>("/api/v1/budgets", { method: "POST", body: JSON.stringify(data) }),
  deleteBudget: (id: string) => req<{ ok: boolean }>(`/api/v1/budgets/${id}`, { method: "DELETE" }),

  updateSettings: (patch: Partial<UserSettings>) =>
    req<{ settings: UserSettings }>("/api/v1/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  streamEndpoint: async (
    url: string,
    payload: Record<string, unknown>,
    onEvent: (ev: { type: string; [k: string]: any }) => void
  ) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let dataStr = "";
        for (const l of lines) {
          if (l.startsWith("data:")) dataStr += l.slice(5).trim();
        }
        if (dataStr) {
          try {
            onEvent(JSON.parse(dataStr));
          } catch {
            // skip
          }
        }
      }
    }
  },
};
