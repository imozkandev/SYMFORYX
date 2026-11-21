import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createId, KEYBOARD_SHORTCUTS, SLASH_COMMANDS_CATALOG, type TaskRole, type ToolManifest } from "@symforyx/core";
import { discoverMcpTools } from "@symforyx/tools-runtime";
import { SymforyxOrchestrator } from "./orchestrator.ts";

export function createApp(orchestrator = new SymforyxOrchestrator()) {
  const app = new Hono();
  const db = orchestrator.db;

  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Health & Metadata
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      name: "SYMFORYX",
      version: "1.0.0",
      signature: "SYMFORYX · by ozkandev",
      uptimeSec: Math.round(process.uptime()),
    })
  );

  app.get("/api/v1/bootstrap", (c) => {
    const workspaces = db.listWorkspaces();
    const projects = db.listProjects();
    const threads = db.listThreads();
    const providers = db.listProviders();
    const roles = db.listRoles();
    const tools = db.listTools();
    const flows = db.listFlows();
    const settings = db.getSettings();
    const usage = db.getUsageSummary("monthly");
    const budgets = db.listBudgets();
    const quotas = db.listQuotaStatuses();
    return c.json({
      workspaces,
      projects,
      threads,
      providers,
      roles,
      tools,
      flows,
      settings,
      usage,
      budgets,
      quotas,
      optimization: orchestrator.optimizationStats,
      commands: SLASH_COMMANDS_CATALOG,
      shortcuts: KEYBOARD_SHORTCUTS,
    });
  });

  // ==================== WORKSPACES & PROJECTS ====================

  function ensureProjectId(requestedId?: string): string {
    if (requestedId && db.getProject(requestedId)) return requestedId;
    const first = db.listProjects()[0];
    if (first) return first.id;
    return db.createProject({ name: "Yeni Çalışma Alanı" }).id;
  }

  app.get("/api/v1/workspaces", (c) => c.json({ workspaces: db.listWorkspaces() }));

  app.post("/api/v1/workspaces", async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: "Çalışma alanı adı gerekli" }, 400);
    const workspace = db.createWorkspace(String(body.name));
    return c.json({ workspace }, 201);
  });

  app.delete("/api/v1/workspaces/:id", (c) => {
    const ok = db.deleteWorkspace(c.req.param("id"));
    return c.json({ ok, workspaces: db.listWorkspaces(), projects: db.listProjects(), threads: db.listThreads() });
  });

  app.get("/api/v1/projects", (c) => c.json({ projects: db.listProjects() }));

  app.post("/api/v1/projects", async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: "Çalışma alanı adı gerekli" }, 400);
    const project = db.createProject(body);
    const thread = db.createThread({ projectId: project.id, title: "Yeni Sohbet" });
    return c.json({ project, thread }, 201);
  });

  app.patch("/api/v1/projects/:id", async (c) => {
    const updated = db.updateProject(c.req.param("id"), await c.req.json());
    if (!updated) return c.json({ error: "Çalışma alanı bulunamadı" }, 404);
    return c.json({ project: updated });
  });

  app.delete("/api/v1/projects/:id", (c) => {
    const ok = db.deleteProject(c.req.param("id"));
    return c.json({ ok, projects: db.listProjects(), threads: db.listThreads() });
  });

  // ==================== THREADS & MESSAGES ====================

  app.get("/api/v1/threads", (c) => {
    const projectId = c.req.query("projectId");
    const includeDeleted = c.req.query("trash") === "true";
    return c.json({ threads: db.listThreads(projectId || undefined, includeDeleted) });
  });

  app.post("/api/v1/threads", async (c) => {
    const body = await c.req.json();
    const projectId = ensureProjectId(body.projectId);
    const thread = db.createThread({
      projectId,
      title: body.title || "Yeni Sohbet",
      mode: body.mode || db.getSettings().defaultMode,
    });
    return c.json({ thread, projectId }, 201);
  });

  app.get("/api/v1/threads/:id", (c) => {
    const id = c.req.param("id");
    const thread = db.getThread(id);
    if (!thread) return c.json({ error: "Sohbet bulunamadı" }, 404);
    const messages = db.listMessages(id);
    const artifacts = db.listArtifacts({ threadId: id });
    const references = orchestrator.getThreadReferences(id);
    return c.json({ thread, messages, artifacts, references });
  });

  app.post("/api/v1/threads/:id/references", async (c) => {
    const id = c.req.param("id");
    const thread = db.getThread(id);
    if (!thread) return c.json({ error: "Sohbet bulunamadı" }, 404);
    const body = await c.req.json();
    const res = await orchestrator.addReferenceToThread(id, thread.projectId, String(body.input || body.url || ""));
    return c.json({ reference: res.reference, references: res.all });
  });

  app.patch("/api/v1/threads/:id", async (c) => {
    const updated = db.updateThread(c.req.param("id"), await c.req.json());
    if (!updated) return c.json({ error: "Sohbet bulunamadı" }, 404);
    return c.json({ thread: updated });
  });

  app.delete("/api/v1/threads/:id", (c) => {
    return c.json({ ok: db.softDeleteThread(c.req.param("id")) });
  });

  app.post("/api/v1/threads/:id/restore", (c) => {
    return c.json({ ok: db.restoreThread(c.req.param("id")) });
  });

  app.post("/api/v1/threads/:id/stop", (c) => {
    orchestrator.abortThread(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/v1/threads/:id/export", (c) => {
    const id = c.req.param("id");
    const format = c.req.query("format") || "md";
    const thread = db.getThread(id);
    if (!thread) return c.json({ error: "Sohbet bulunamadı" }, 404);
    const messages = db.listMessages(id);

    if (format === "json") {
      return c.json({ thread, messages, artifacts: db.listArtifacts({ threadId: id }) });
    }

    const md = [
      `# ${thread.title}`,
      `_Dışa aktarma: ${new Date().toISOString()} · SYMFORYX_`,
      "",
      ...messages.map((m) => {
        const who = m.role === "user" ? "**Sen**" : `**${m.author.modelName ?? "Model"}**`;
        const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n");
        return `### ${who}\n\n${text}\n`;
      }),
    ].join("\n");

    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${thread.id}.md"`,
      },
    });
  });

  app.patch("/api/v1/messages/:id", async (c) => {
    const body = await c.req.json();
    const updated = db.updateMessage(c.req.param("id"), body);
    if (!updated) return c.json({ error: "Mesaj bulunamadı" }, 404);
    return c.json({ message: updated });
  });

  app.post("/api/v1/messages/compare-select", async (c) => {
    const { threadId, compareGroupId, messageId } = await c.req.json();
    db.selectCompareWinner(threadId, compareGroupId, messageId);
    return c.json({ ok: true });
  });

  app.get("/api/v1/search", (c) => {
    const q = c.req.query("q") || "";
    return c.json({ results: db.searchMessages(q) });
  });

  // ==================== STREAMING CHAT & HANDOFF ====================

  app.post("/api/v1/chat", async (c) => {
    const body = await c.req.json();
    let threadId: string = body.threadId;
    if (!threadId) {
      const projectId = ensureProjectId(body.projectId);
      const t = db.createThread({ projectId, title: String(body.message || "Yeni Sohbet").slice(0, 44) });
      threadId = t.id;
    }

    const wantStream = body.stream !== false;
    if (!wantStream) {
      const events = [];
      for await (const ev of orchestrator.handleChat({
        threadId,
        message: String(body.message ?? ""),
        mode: body.mode,
        modelOverride: body.modelOverride,
        attachments: body.attachments,
        references: body.references,
        enabledTools: body.enabledTools,
        parentId: body.parentId,
      })) {
        events.push(ev);
      }
      return c.json({ threadId, events });
    }

    return streamSSE(c, async (stream) => {
      for await (const ev of orchestrator.handleChat({
        threadId,
        message: String(body.message ?? ""),
        mode: body.mode,
        modelOverride: body.modelOverride,
        attachments: body.attachments,
        references: body.references,
        enabledTools: body.enabledTools,
        parentId: body.parentId,
      })) {
        await stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev),
        });
      }
      await stream.writeSSE({ event: "stream_end", data: JSON.stringify({ threadId }) });
    });
  });

  app.post("/api/v1/handoff", async (c) => {
    const body = await c.req.json();
    return streamSSE(c, async (stream) => {
      for await (const ev of orchestrator.handleHandoff({
        threadId: body.threadId,
        sourceMessageId: body.sourceMessageId,
        targetProviderId: body.targetProviderId,
        targetModelId: body.targetModelId,
        instruction: body.instruction,
      })) {
        await stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev),
        });
      }
      await stream.writeSSE({ event: "stream_end", data: JSON.stringify({ ok: true }) });
    });
  });

  // ==================== ARTIFACTS ====================

  app.get("/api/v1/artifacts", (c) => {
    return c.json({
      artifacts: db.listArtifacts({
        threadId: c.req.query("threadId") || undefined,
        projectId: c.req.query("projectId") || undefined,
      }),
    });
  });

  app.get("/api/v1/artifacts/:id", (c) => {
    const art = db.getArtifact(c.req.param("id"));
    if (!art) return c.json({ error: "Artefakt bulunamadı" }, 404);
    if (c.req.query("raw") === "1") {
      const ver = art.versions[art.currentVersion - 1] ?? art.versions.at(-1);
      if (!ver) return c.text("", 404);
      if (art.kind === "image") {
        const bytes = Buffer.from(ver.content, "base64");
        return new Response(bytes, { headers: { "Content-Type": ver.mime } });
      }
      return new Response(ver.content, { headers: { "Content-Type": `${ver.mime}; charset=utf-8` } });
    }
    return c.json({ artifact: art });
  });

  app.post("/api/v1/artifacts", async (c) => {
    const body = await c.req.json();
    const art = db.createArtifact(body);
    return c.json({ artifact: art }, 201);
  });

  app.post("/api/v1/artifacts/:id/versions", async (c) => {
    const art = db.addArtifactVersion(c.req.param("id"), await c.req.json());
    if (!art) return c.json({ error: "Artefakt bulunamadı" }, 404);
    return c.json({ artifact: art });
  });

  app.patch("/api/v1/artifacts/:id/version", async (c) => {
    const { version } = await c.req.json();
    const art = db.setArtifactCurrentVersion(c.req.param("id"), Number(version));
    if (!art) return c.json({ error: "Geçersiz sürüm" }, 400);
    return c.json({ artifact: art });
  });

  // ==================== PROVIDERS & MODELS ====================

  app.get("/api/v1/providers", (c) => c.json({ providers: db.listProviders() }));

  app.get("/api/v1/models", (c) => {
    const models = db
      .listProviders()
      .filter((p) => p.enabled)
      .flatMap((p) => p.models.map((m) => ({ ...m, providerName: p.displayName, badgeColor: p.badgeColor, badgeLetter: p.badgeLetter, hasKey: p.hasKey || p.auth === "none" })));
    return c.json({ models });
  });

  app.post("/api/v1/providers", async (c) => {
    const body = await c.req.json();
    const id = body.id || createId("prov");
    const existing = db.getProvider(id);
    const saved = db.upsertProvider({
      id,
      type: body.type ?? existing?.type ?? "openai_compatible",
      displayName: body.displayName ?? existing?.displayName ?? id,
      auth: body.auth ?? existing?.auth ?? "api_key",
      baseUrl: body.baseUrl ?? existing?.baseUrl,
      alias: body.alias ?? existing?.alias,
      badgeColor: body.badgeColor ?? existing?.badgeColor ?? "#6D5EF6",
      badgeLetter: body.badgeLetter ?? existing?.badgeLetter ?? "P",
      enabled: body.enabled ?? existing?.enabled ?? true,
      models: body.models ?? existing?.models ?? [],
      apiKey: body.apiKey,
    });
    return c.json({ provider: saved });
  });

  app.post("/api/v1/providers/:id/test", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const cfg = db.getProvider(id);
    const adapter = orchestrator.providers.get(id, cfg ?? undefined);
    const key = body.apiKey ?? db.getDecryptedProviderKey(id) ?? "";
    const baseUrl = body.baseUrl ?? cfg?.baseUrl;
    const res = await adapter.validateCredentials(key, baseUrl);
    if (res.ok && res.models && cfg) {
      db.upsertProvider({ ...cfg, baseUrl, models: res.models, apiKey: body.apiKey });
    }
    return c.json(res);
  });

  app.get("/api/v1/providers/ollama/detect", async (c) => {
    const baseUrl = c.req.query("baseUrl") || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const adapter = orchestrator.providers.get("ollama");
    const res = await adapter.validateCredentials("", baseUrl);
    if (res.ok && res.models) {
      const cfg = db.getProvider("ollama");
      if (cfg) db.upsertProvider({ ...cfg, baseUrl, models: res.models });
    }
    return c.json(res);
  });

  app.post("/api/v1/providers/:id/models", async (c) => {
    const id = c.req.param("id");
    const cfg = db.getProvider(id);
    if (!cfg) return c.json({ error: "Sağlayıcı bulunamadı" }, 404);
    const body = await c.req.json();
    if (!body.id) return c.json({ error: "Model kimliği gerekli" }, 400);
    const nextModel = {
      id: String(body.id).trim(),
      providerId: id,
      displayName: String(body.displayName || body.id).trim(),
      capabilities: Array.isArray(body.capabilities) && body.capabilities.length
        ? body.capabilities
        : ["chat", "vision", "tools"],
      contextWindow: Number(body.contextWindow || 128000),
      maxOutputTokens: Number(body.maxOutputTokens || 8192),
      pricing: body.pricing,
      local: Boolean(body.local),
      visible: true,
    };
    const filtered = cfg.models.filter((m) => m.id !== nextModel.id);
    const saved = db.upsertProvider({ ...cfg, models: [...filtered, nextModel] });
    return c.json({ provider: saved });
  });

  // ==================== QUOTAS (Per-Provider & Per-Tool Usage / Remaining / Reset / Cost) ====================

  app.get("/api/v1/quotas", (c) => c.json({ quotas: db.listQuotaStatuses() }));

  app.put("/api/v1/quotas", async (c) => {
    const body = await c.req.json();
    const saved = db.upsertQuota({
      targetType: body.targetType || "provider",
      targetId: String(body.targetId),
      displayName: String(body.displayName || body.targetId),
      planName: String(body.planName || "Özel Kota"),
      metric: body.metric || "requests",
      limitAmount: body.limitAmount === "" || body.limitAmount === null ? null : Number(body.limitAmount),
      resetInterval: body.resetInterval || "monthly",
      liveRemaining: body.liveRemaining ?? null,
      liveLimit: body.liveLimit ?? null,
      liveResetAt: body.liveResetAt ?? null,
    });
    return c.json({ quota: saved, quotas: db.listQuotaStatuses() });
  });

  // ==================== ROLES ====================

  app.get("/api/v1/roles", (c) => {
    return c.json({ roles: db.listRoles(c.req.query("projectId") || undefined) });
  });

  app.put("/api/v1/roles/:id", async (c) => {
    const body = (await c.req.json()) as TaskRole;
    const role = db.upsertRole({ ...body, id: c.req.param("id") });
    return c.json({ role });
  });

  app.delete("/api/v1/roles/:id", (c) => {
    return c.json({ ok: db.deleteRole(c.req.param("id"), c.req.query("projectId") || "") });
  });

  // ==================== TOOLS & STORE & MCP ====================

  app.get("/api/v1/tools", (c) => c.json({ tools: db.listTools() }));

  app.post("/api/v1/tools", async (c) => {
    const body = (await c.req.json()) as ToolManifest & { secrets?: Record<string, string> };
    const { secrets, ...manifest } = body;
    const saved = db.upsertTool(manifest, secrets);
    return c.json({ tool: saved });
  });

  app.post("/api/v1/tools/:id/install", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const existing = db.getTool(id);
    if (!existing) return c.json({ error: "Araç bulunamadı" }, 404);
    const saved = db.upsertTool(
      { ...existing, installed: true, enabled: true, policy: body.policy ?? existing.policy },
      body.secrets
    );
    db.logAudit("user", "tool.install", id);
    return c.json({ tool: saved });
  });

  app.post("/api/v1/tools/:id/permission", async (c) => {
    const id = c.req.param("id");
    const { scope = "global", scopeId = "global", policy } = await c.req.json();
    db.setToolPermission(id, scope, scopeId, policy);
    return c.json({ ok: true, tool: db.getTool(id) });
  });

  app.post("/api/v1/tools/:id/invoke", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const projectId = body.projectId || "proj_default";
    const threadId = body.threadId;
    const resolver = orchestrator.makePermissionResolver(threadId, projectId);
    try {
      const result = await orchestrator.toolRuntime.invoke({
        toolId: id,
        manifest: db.getTool(id) ?? undefined,
        args: body.args ?? body,
        projectId,
        threadId,
        resolver,
        skipApprovalCheck: true,
      });
      return c.json({ ok: !result.isError, result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/v1/tools/mcp/discover", async (c) => {
    const { url } = await c.req.json();
    try {
      const tools = await discoverMcpTools(url);
      for (const t of tools) db.upsertTool(t);
      return c.json({ ok: true, tools });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // ==================== FLOWS & RUNS ====================

  app.get("/api/v1/flows", (c) => c.json({ flows: db.listFlows() }));

  app.post("/api/v1/flows", async (c) => {
    const body = await c.req.json();
    const id = body.id || createId("flow");
    const flow = db.upsertFlow({ ...body, id });
    return c.json({ flow }, 201);
  });

  app.delete("/api/v1/flows/:id", (c) => c.json({ ok: db.deleteFlow(c.req.param("id")) }));

  app.post("/api/v1/flows/:id/run", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const run = await orchestrator.startFlowRun(
        c.req.param("id"),
        body.inputs ?? {},
        body.projectId || "proj_default",
        body.threadId,
        body.stepModelOverrides
      );
      return c.json({ run });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // Live pre-send per-prompt cost estimator
  app.post("/api/v1/estimate-cost", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = String(body.message || "");
    const mode = String(body.mode || "smart");
    const refImages = Number(body.referenceImageCount || 0);
    const providerId = String(body.providerId || "demo");
    const modelId = String(body.modelId || "demo-gpt");

    const baseTokens = Math.max(1, Math.ceil(text.length / 3.8)) + refImages * 320;
    const expectedOutputTokens = Math.min(2400, Math.max(350, baseTokens * 2));
    const prov = db.getProvider(providerId);
    const model = prov?.models.find((m) => m.id === modelId);
    const pricing = model?.pricing ?? { inputPerMTok: 0, outputPerMTok: 0 };
    const isImg = Boolean(model?.capabilities.includes("image.generate") && !model?.capabilities.includes("chat"));

    let perCallUsd = isImg
      ? pricing.perImage ?? 0.04
      : (baseTokens / 1_000_000) * pricing.inputPerMTok +
        (expectedOutputTokens / 1_000_000) * pricing.outputPerMTok;

    const multiplier = mode === "compare" ? 3 : mode === "council" ? 4 : mode === "agent" ? 3 : 1;
    const estimatedCostUsd = Number((perCallUsd * multiplier).toFixed(6));

    return c.json({
      estimatedInputTokens: baseTokens,
      estimatedOutputTokens: expectedOutputTokens * multiplier,
      estimatedCostUsd,
      multiplier,
      isLocal: Boolean(model?.local || providerId === "ollama" || providerId === "comfyui" || providerId === "demo"),
    });
  });

  // Save current thread turns as a reusable Studio Schema (Flow)
  app.post("/api/v1/threads/:id/save-as-flow", async (c) => {
    const threadId = c.req.param("id");
    const thread = db.getThread(threadId);
    if (!thread) return c.json({ error: "Sohbet bulunamadı" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const msgs = db.listMessages(threadId).filter((m) => m.role === "user");
    const steps = msgs.slice(0, 6).map((m, idx) => ({
      id: `adim_${idx + 1}`,
      name: `Adım ${idx + 1}`,
      type: "model" as const,
      use: "role:genel",
      prompt: idx === 0
        ? `{{girdi}} — ${m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").slice(0, 240)}`
        : m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").slice(0, 240),
    }));
    const flow = db.upsertFlow({
      id: createId("flow"),
      name: body.name || `${thread.title} Şeması`,
      description: body.description || "Sohbetten otomatik oluşturulan tekrar kullanılabilir şema.",
      category: "Özel Şemalar",
      isTemplate: false,
      estimatedCostUsd: Number((steps.length * 0.015).toFixed(4)),
      inputs: {
        girdi: { type: "text", label: "Konu / Brief", placeholder: "Yeni proje fikrini yaz...", required: true },
      },
      steps: steps.length > 0 ? steps : [{ id: "adim_1", name: "Üretim", type: "model", use: "role:genel", prompt: "{{girdi}}" }],
    });
    return c.json({ flow }, 201);
  });

  app.get("/api/v1/runs", (c) => c.json({ runs: db.listFlowRuns(c.req.query("projectId") || undefined) }));

  app.get("/api/v1/runs/:id", (c) => {
    const run = db.getFlowRun(c.req.param("id"));
    if (!run) return c.json({ error: "Çalıştırma bulunamadı" }, 404);
    return c.json({ run });
  });

  app.post("/api/v1/runs/:id/approve", async (c) => {
    const body = await c.req.json();
    try {
      const run = await orchestrator.resumeFlowRun(c.req.param("id"), {
        approved: Boolean(body.approved),
        feedback: body.feedback,
      });
      return c.json({ run });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // ==================== MEMORY & PROJECT FILES ====================

  app.get("/api/v1/memories", (c) => {
    return c.json({
      memories: db.listMemories({
        scope: (c.req.query("scope") as "project" | "personal" | undefined) || undefined,
        projectId: c.req.query("projectId") || undefined,
      }),
    });
  });

  app.post("/api/v1/memories", async (c) => {
    const body = await c.req.json();
    return c.json({ memory: db.addMemory(body) }, 201);
  });

  app.patch("/api/v1/memories/:id", async (c) => {
    return c.json({ ok: db.updateMemory(c.req.param("id"), await c.req.json()) });
  });

  app.delete("/api/v1/memories/:id", (c) => c.json({ ok: db.deleteMemory(c.req.param("id")) }));

  app.get("/api/v1/projects/:id/files", (c) => {
    return c.json({ files: db.listProjectFiles(c.req.param("id")) });
  });

  app.post("/api/v1/projects/:id/files", async (c) => {
    const projectId = c.req.param("id");
    const body = await c.req.json();
    const file = db.addProjectFile({
      projectId,
      name: body.name || "belge.txt",
      mime: body.mime || "text/plain",
      size: body.size ?? (body.contentText?.length ?? 0),
      contentText: body.contentText ?? "",
      artifactId: body.artifactId,
    });
    return c.json({ file }, 201);
  });

  app.delete("/api/v1/files/:id", (c) => c.json({ ok: db.deleteProjectFile(c.req.param("id")) }));

  // ==================== BUDGETS, USAGE, SETTINGS, TOKENS, WEBHOOKS ====================

  app.get("/api/v1/usage", (c) => {
    const period = (c.req.query("period") as "daily" | "weekly" | "monthly") || "monthly";
    if (c.req.query("format") === "csv") {
      return new Response(db.exportUsageCsv(period), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="symforyx-usage-${period}.csv"`,
        },
      });
    }
    return c.json({ usage: db.getUsageSummary(period), budgets: db.listBudgets() });
  });

  app.get("/api/v1/budgets", (c) => c.json({ budgets: db.listBudgets() }));

  app.post("/api/v1/budgets", async (c) => {
    const budget = db.createBudget(await c.req.json());
    return c.json({ budget }, 201);
  });

  app.delete("/api/v1/budgets/:id", (c) => c.json({ ok: db.deleteBudget(c.req.param("id")) }));

  app.get("/api/v1/settings", (c) => c.json({ settings: db.getSettings() }));

  app.patch("/api/v1/settings", async (c) => {
    return c.json({ settings: db.updateSettings(await c.req.json()) });
  });

  app.get("/api/v1/tokens", (c) => c.json({ tokens: db.listApiTokens() }));

  app.post("/api/v1/tokens", async (c) => {
    const { name = "CLI Token", scopes = ["*"] } = await c.req.json().catch(() => ({}));
    return c.json(db.createApiToken(name, scopes), 201);
  });

  app.get("/api/v1/webhooks", (c) => c.json({ webhooks: db.listWebhooks() }));

  app.post("/api/v1/webhooks", async (c) => {
    const body = await c.req.json();
    return c.json({ webhook: db.addWebhook(body) }, 201);
  });

  app.get("/api/v1/audit", (c) => c.json({ logs: db.listAuditLogs() }));

  app.get("/api/v1/data/export", (c) => {
    return new Response(JSON.stringify(db.exportAllData(), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="symforyx-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  });

  // ==================== STATIC WEB SPA SERVING (PRODUCTION) ====================

  const staticDir =
    process.env.SYMFORYX_STATIC_DIR || join(import.meta.dir, "..", "..", "web", "build");
  if (existsSync(staticDir)) {
    const mimeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };

    app.get("*", (c) => {
      const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const fullPath = join(staticDir, reqPath);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = extname(fullPath);
        return new Response(readFileSync(fullPath), {
          headers: { "Content-Type": mimeMap[ext] || "application/octet-stream" },
        });
      }
      const fallback = join(staticDir, "index.html");
      if (existsSync(fallback)) {
        return new Response(readFileSync(fallback), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return c.text("Not Found", 404);
    });
  }

  return app;
}

if (import.meta.main) {
  const basePort = Number(process.env.SYMFORYX_PORT || process.env.PORT || 3000);
  const strictPort = Boolean(process.env.SYMFORYX_PORT);
  const host = process.env.SYMFORYX_HOST || "127.0.0.1";
  const app = createApp();

  let server: ReturnType<typeof Bun.serve> | null = null;
  let lastError: unknown;

  for (let offset = 0; offset <= (strictPort ? 0 : 20); offset++) {
    const candidate = basePort + offset;
    try {
      server = Bun.serve({
        port: candidate,
        hostname: host,
        fetch: app.fetch,
        idleTimeout: 120,
      });
      if (offset > 0) {
        console.log(`  ℹ Port ${basePort} kullanımda olduğu için ${candidate} portuna geçildi.`);
      }
      break;
    } catch (err: any) {
      lastError = err;
      if (err?.code !== "EADDRINUSE") throw err;
    }
  }

  if (!server) {
    console.error(`✗ Sunucu başlatılamadı (port ${basePort} kullanımda). Farklı port için: SYMFORYX_PORT=3005 bun run start`);
    throw lastError;
  }

  console.log(`\n  ✦ SYMFORYX hazır → http://${host}:${server.port}`);
  console.log(`  ✦ SYMFORYX · by ozkandev\n`);
}
