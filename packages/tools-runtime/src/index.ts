import {
  SymError,
  type Artifact,
  type PermissionPolicy,
  type ToolManifest,
} from "@symforyx/core";
import type { RegisteredTool, ToolRunContext, ToolRunResult } from "@symforyx/tools-sdk";

export interface PermissionResolver {
  getPolicy(toolId: string, threadId?: string, projectId?: string): PermissionPolicy;
  getSecret(toolId: string, name: string): string | undefined;
  getArtifact(id: string): Artifact | null;
  createArtifact(input: {
    threadId: string;
    projectId: string;
    kind: Artifact["kind"];
    title: string;
    mime: string;
    content: string;
    language?: string;
  }): Artifact;
  requestApproval?: (req: {
    toolId: string;
    toolName: string;
    args: unknown;
    reason: string;
  }) => Promise<boolean>;
}

export class ToolRuntime {
  private tools = new Map<string, RegisteredTool<any>>();

  register(tool: RegisteredTool<any>) {
    this.tools.set(tool.id, tool);
  }

  get(id: string): RegisteredTool<any> | undefined {
    return this.tools.get(id);
  }

  listRegistered(): RegisteredTool<any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Executes a built-in, HTTP, or MCP tool enforcing least-privilege network allowlist,
   * timeouts, prompt-injection taint flags, and permission policies.
   */
  async invoke(opts: {
    toolId: string;
    manifest?: ToolManifest;
    args: unknown;
    projectId: string;
    threadId?: string;
    resolver: PermissionResolver;
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
    taintedByUntrustedData?: boolean;
    skipApprovalCheck?: boolean;
  }): Promise<ToolRunResult & { durationMs: number }> {
    const start = Date.now();
    const registered = this.tools.get(opts.toolId);
    const manifest = opts.manifest ?? registered?.manifest;

    if (!manifest) {
      throw new SymError("invalid_request", `Araç bulunamadı: ${opts.toolId}`);
    }

    // 1. Permission Check
    const policy = opts.resolver.getPolicy(opts.toolId, opts.threadId, opts.projectId);
    if (policy === "block") {
      throw new SymError("permission_denied", `Araç engellenmiş: ${manifest.name}`);
    }

    const mustAsk =
      !opts.skipApprovalCheck &&
      (policy === "ask_every_time" ||
        manifest.ui?.confirm === "always" ||
        (opts.taintedByUntrustedData && manifest.permissions.writes_external));

    if (mustAsk && opts.resolver.requestApproval) {
      const approved = await opts.resolver.requestApproval({
        toolId: manifest.id,
        toolName: manifest.name,
        args: opts.args,
        reason: manifest.permissions.writes_external
          ? "Dış sisteme yazma veya riskli işlem onayı gerekiyor."
          : "Araç çalıştırma izni gerekiyor.",
      });
      if (!approved) {
        throw new SymError("permission_denied", `${manifest.name} çalıştırması kullanıcı tarafından reddedildi.`);
      }
    }

    // 2. Timeout Controller
    const timeoutMs = manifest.runtime?.timeout_ms ?? 15000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("Tool timeout")), timeoutMs);
    const linkAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", linkAbort, { once: true });

    // 3. Least-privilege fetch wrapper enforcing manifest.permissions.network
    const allowedHosts = manifest.permissions.network ?? [];
    const safeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      const parsed = new URL(url);
      const allowed =
        allowedHosts.includes("*") ||
        allowedHosts.some(
          (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
        );
      if (!allowed) {
        throw new SymError(
          "permission_denied",
          `${manifest.name} aracının ${parsed.hostname} alan adına erişim izni yok.`
        );
      }
      return fetch(url, { ...init, signal: ac.signal });
    };

    try {
      const ctx: ToolRunContext = {
        threadId: opts.threadId,
        projectId: opts.projectId,
        signal: ac.signal,
        progress: (m) => opts.onProgress?.(m),
        artifacts: {
          get: async (id) => opts.resolver.getArtifact(id),
          create: async (artInput) =>
            opts.resolver.createArtifact({
              threadId: opts.threadId ?? "thr_tool",
              projectId: opts.projectId,
              ...artInput,
            }),
        },
        fetch: safeFetch,
        secret: (name) => {
          if (!manifest.permissions.secrets.includes(name)) return undefined;
          return opts.resolver.getSecret(manifest.id, name);
        },
      };

      // 4a. Built-in / SDK registered tool
      if (registered) {
        const validated = registered.input.parse(opts.args);
        const result = await registered.run({ input: validated, ctx });
        return { ...result, durationMs: Date.now() - start };
      }

      // 4b. HTTP / OpenAPI tool
      if (manifest.type === "http" || manifest.type === "openapi") {
        const url = manifest.runtime?.httpUrl;
        if (!url) throw new SymError("invalid_request", "HTTP aracı için uç nokta tanımlı değil.");
        const method = manifest.runtime?.httpMethod ?? "POST";
        const res = await safeFetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...(manifest.runtime?.headers ?? {}) },
          body: method === "GET" ? undefined : JSON.stringify(opts.args ?? {}),
        });
        const text = await res.text();
        return {
          text: text.slice(0, 8000),
          untrusted: true,
          isError: !res.ok,
          durationMs: Date.now() - start,
        };
      }

      // 4c. Remote MCP JSON-RPC tool
      if (manifest.type === "mcp" && manifest.runtime?.mcpUrl) {
        const res = await safeFetch(manifest.runtime.mcpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: manifest.id, arguments: opts.args ?? {} },
          }),
        });
        const json = await res.json();
        return {
          json,
          text: JSON.stringify(json, null, 2).slice(0, 8000),
          untrusted: true,
          durationMs: Date.now() - start,
        };
      }

      throw new SymError("invalid_request", `Bu araç türü (${manifest.type}) için yürütücü hazır değil.`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", linkAbort);
    }
  }
}

/**
 * Discovers tools from a remote HTTP MCP server using JSON-RPC `tools/list`.
 */
export async function discoverMcpTools(mcpUrl: string): Promise<ToolManifest[]> {
  const host = new URL(mcpUrl).hostname;
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (!res.ok) throw new Error(`MCP sunucusu yanıt vermedi (HTTP ${res.status})`);
  const data = (await res.json()) as {
    result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
  };
  return (data.result?.tools ?? []).map((t) => ({
    id: `mcp.${host}.${t.name}`,
    name: t.name,
    version: "1.0.0",
    publisher: host,
    type: "mcp",
    category: "mcp",
    description: t.description ?? `MCP aracı (${host})`,
    inputs: {},
    permissions: {
      network: [host],
      filesystem: "none",
      secrets: [],
      writes_external: true,
    },
    cost: { model: "free" },
    ui: { confirm: "first_time" },
    runtime: { mcpUrl, timeout_ms: 15000 },
    installed: true,
    enabled: true,
    policy: "ask_every_time",
  }));
}
