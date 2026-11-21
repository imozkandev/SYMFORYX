import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createId,
  estimateTokens,
  extractCodeBlocks,
  parseUserInput,
  SLASH_COMMANDS_CATALOG,
  SymError,
  type Artifact,
  type ChatRequest,
  type FlowRun,
  type MessagePart,
  type ModelInfo,
  type ProviderConfig,
  type ReferenceItem,
  type SymMessage,
  type ToolManifest,
  type WorkMode,
} from "@symforyx/core";
import { SymforyxDB } from "@symforyx/db";
import {
  DEFAULT_PROVIDER_CONFIGS,
  ProviderRegistry,
} from "@symforyx/providers";
import { resolveProviderModel, routeMessage } from "@symforyx/router";
import {
  auditAndCleanSlop,
  buildContext,
  buildTransferPrompt,
  enhanceImagePromptAntiSlop,
} from "@symforyx/context";
import { ToolRuntime, type PermissionResolver } from "@symforyx/tools-runtime";
import { BUILTIN_TOOLS } from "@symforyx/tools";
import { FlowEngine, READY_FLOW_TEMPLATES } from "@symforyx/flows";
import { runAgentLoop } from "@symforyx/agent";
import {
  applyMarkdownEditsToProject,
  buildLocalProjectContextPrompt,
  getProjectGitDiff,
  getProjectGitStatus,
  listProjectTree,
  readProjectFile,
  runProjectShell,
  searchProjectText,
} from "./local-project.ts";

export type StreamEvent =
  | { type: "user_message"; message: SymMessage }
  | { type: "routing"; decision: unknown; threadId: string }
  | { type: "context_stats"; stats: unknown; threadId: string }
  | { type: "budget_warning"; warnings: unknown[] }
  | { type: "message_start"; message: SymMessage }
  | { type: "delta"; messageId: string; text: string }
  | { type: "tool_event"; messageId?: string; toolId: string; status: string; detail?: string }
  | { type: "agent_event"; event: unknown }
  | { type: "artifact_created"; artifact: Artifact }
  | { type: "reference_added"; reference: ReferenceItem; references: ReferenceItem[] }
  | { type: "references_cleared"; threadId: string }
  | { type: "message_done"; message: SymMessage }
  | { type: "flow_run"; run: FlowRun }
  | { type: "error"; code: string; message: string; canFallback?: boolean };

export class SymforyxOrchestrator {
  readonly db: SymforyxDB;
  readonly providers = new ProviderRegistry();
  readonly toolRuntime = new ToolRuntime();
  readonly flowEngine = new FlowEngine();
  private activeControllers = new Map<string, AbortController>();
  private threadReferences = new Map<string, ReferenceItem[]>();
  private responseCache = new Map<string, { text: string; inputTokens: number; outputTokens: number; savedAt: number }>();
  optimizationStats = { savedTokens: 0, savedCostUsd: 0, cacheHits: 0, slopItemsBlocked: 0 };

  constructor(db?: SymforyxDB) {
    this.db = db ?? new SymforyxDB();
    this.bootstrap();
  }

  private bootstrap() {
    // 1. Seed default providers if missing
    const existingProviders = this.db.listProviders();
    for (const def of DEFAULT_PROVIDER_CONFIGS) {
      if (!existingProviders.some((p) => p.id === def.id)) {
        this.db.upsertProvider(def);
      }
    }

    // 2. Register built-in tools & seed registry catalog
    for (const tool of BUILTIN_TOOLS) {
      this.toolRuntime.register(tool);
      if (!this.db.getTool(tool.id)) {
        this.db.upsertTool(tool.manifest);
      }
    }

    const catalogPath = process.env.SYMFORYX_REGISTRY_PATH || join(process.cwd(), "registry", "catalog.json");
    if (existsSync(catalogPath)) {
      try {
        const items = JSON.parse(readFileSync(catalogPath, "utf8")) as ToolManifest[];
        for (const item of items) {
          if (!this.db.getTool(item.id)) {
            this.db.upsertTool(item);
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Seed/update ready-made studio flow templates
    const existingFlows = this.db.listFlows();
    for (const tpl of READY_FLOW_TEMPLATES) {
      const existing = existingFlows.find((f) => f.id === tpl.id);
      if (!existing || existing.isTemplate) {
        this.db.upsertFlow(tpl);
      }
    }
  }

  abortThread(threadId: string) {
    const ac = this.activeControllers.get(threadId);
    if (ac) {
      ac.abort();
      this.activeControllers.delete(threadId);
    }
  }

  getThreadReferences(threadId: string): ReferenceItem[] {
    return this.threadReferences.get(threadId) ?? [];
  }

  async addReferenceToThread(
    threadId: string,
    projectId: string,
    rawArgs: string,
    signal?: AbortSignal
  ): Promise<{ reference: ReferenceItem; all: ReferenceItem[]; summaryText: string }> {
    const trimmed = rawArgs.trim();
    const existing = this.getThreadReferences(threadId);

    // 1. URL / Website Reference detection
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      const url = urlMatch[0];
      const note = trimmed.replace(url, "").trim() || undefined;
      let extractedText = "";
      let title = url;
      try {
        const parsedUrl = new URL(url);
        title = parsedUrl.hostname.replace(/^www\./, "") + (parsedUrl.pathname !== "/" ? parsedUrl.pathname.slice(0, 28) : "");
        const resolver = this.makePermissionResolver(threadId, projectId);
        const res = await this.toolRuntime.invoke({
          toolId: "url-reader",
          manifest: this.db.getTool("url-reader") ?? undefined,
          args: { url },
          projectId,
          threadId,
          resolver,
          signal,
          skipApprovalCheck: true,
        });
        if (!res.isError && res.text) {
          extractedText = res.text.slice(0, 2200);
        }
      } catch {
        // Offline / blocked fallback: still store URL & note cleanly
      }
      const ref: ReferenceItem = {
        id: createId("ref"),
        kind: "url",
        role: "style",
        title,
        url,
        note,
        extractedText: extractedText || undefined,
      };
      const next = [...existing, ref];
      this.threadReferences.set(threadId, next);
      return {
        reference: ref,
        all: next,
        summaryText: `**Web sitesi referansı eklendi:** \`${url}\`${note ? `\n- Not: ${note}` : ""}${
          extractedText
            ? `\n- Sayfa içeriği okundu ve bağlama hazırlandı (${extractedText.length} karakter).`
            : "\n- URL referans olarak kaydedildi (sayfa içeriği çevrimdışı/engelli olduğu için adres ve not kullanılacak)."
        }\n\nSonraki tüm mesajların bu referansı otomatik görecektir.`,
      };
    }

    // 2. Artifact / Image Reference (#art_...)
    const artMatch = trimmed.match(/#(art_[a-zA-Z0-9_]+)/);
    if (artMatch) {
      const art = this.db.getArtifact(artMatch[1]);
      const note = trimmed.replace(artMatch[0], "").trim() || undefined;
      const ref: ReferenceItem = {
        id: createId("ref"),
        kind: art?.kind === "image" ? "image" : "idea",
        role: "style",
        title: art?.title ?? artMatch[1],
        artifactId: art?.id,
        mime: art?.mime,
        note,
      };
      const next = [...existing, ref];
      this.threadReferences.set(threadId, next);
      return {
        reference: ref,
        all: next,
        summaryText: `**Artefakt referansı eklendi:** \`${ref.title}\`${note ? ` — ${note}` : ""}`,
      };
    }

    // 3. Idea / Style / Constraint Reference
    const role: ReferenceItem["role"] =
      /yapma|olmasın|kısıt|yasak|avoid|no /i.test(trimmed)
        ? "constraint"
        : /renk|palet|hex|#/i.test(trimmed)
        ? "palette"
        : /düzen|layout|grid|ızgara/i.test(trimmed)
        ? "layout"
        : "inspiration";

    const ref: ReferenceItem = {
      id: createId("ref"),
      kind: "idea",
      role,
      title: trimmed.slice(0, 48),
      note: trimmed.length > 48 ? trimmed : undefined,
    };
    const next = [...existing, ref];
    this.threadReferences.set(threadId, next);
    return {
      reference: ref,
      all: next,
      summaryText: `**Referans fikir eklendi** (\`${role}\`): *${trimmed}*\n\nSonraki tüm üretimlerinde bu referans otomatik dikkate alınacak.`,
    };
  }

  makePermissionResolver(threadId?: string, projectId = "proj_default"): PermissionResolver {
    return {
      getPolicy: (toolId, tid, pid) =>
        this.db.getEffectiveToolPolicy(toolId, tid ?? threadId, pid ?? projectId),
      getSecret: (toolId, name) => this.db.getToolSecret(toolId, name),
      getArtifact: (id) => this.db.getArtifact(id),
      createArtifact: (input) => this.db.createArtifact(input),
    };
  }

  async emitWebhook(eventName: string, payload: Record<string, unknown>) {
    const hooks = this.db.getActiveWebhooksWithSecret(eventName);
    const body = JSON.stringify({ event: eventName, timestamp: new Date().toISOString(), payload });
    for (const hook of hooks) {
      const sig = createHmac("sha256", hook.secret).update(body).digest("hex");
      fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Symforyx-Signature": `sha256=${sig}`,
          "X-Symforyx-Event": eventName,
        },
        body,
      }).catch(() => {});
    }
  }

  /**
   * Main Chat Entry Point: yields real-time StreamEvents for WebSocket / SSE clients.
   */
  async *handleChat(opts: {
    threadId: string;
    message: string;
    mode?: WorkMode;
    modelOverride?: { providerId: string; modelId: string } | null;
    attachments?: Array<{ artifactId: string; kind: "image" | "file"; mime: string; name?: string }>;
    references?: ReferenceItem[];
    enabledTools?: string[];
    parentId?: string | null;
    autoApplyEdits?: boolean;
    transferNote?: { fromMessageId: string; fromAuthor: string; originalPrompt?: string; visionConverted?: boolean };
  }): AsyncGenerator<StreamEvent> {
    const thread = this.db.getThread(opts.threadId);
    if (!thread) {
      yield { type: "error", code: "invalid_request", message: "Sohbet bulunamadı." };
      return;
    }

    const project = this.db.getProject(thread.projectId);
    const settings = this.db.getSettings();
    const providers = this.db.listProviders();
    const roles = this.db.listRoles(thread.projectId);
    const effectiveMode: WorkMode = opts.mode ?? thread.mode ?? settings.defaultMode;
    const parsed = parseUserInput(opts.message);

    const ac = new AbortController();
    this.activeControllers.set(thread.id, ac);

    try {
      // Save user message immediately (including persistent thread references + per-request references)
      const userParts: MessagePart[] = [];
      if (opts.transferNote) {
        userParts.push({ type: "transfer_note", ...opts.transferNote });
      }
      const persistedRefs = this.getThreadReferences(thread.id);
      const mergedMap = new Map<string, ReferenceItem>();
      for (const r of [...persistedRefs, ...(opts.references ?? [])]) {
        mergedMap.set(r.id, r);
      }
      const references = Array.from(mergedMap.values());
      const refIdeas = references.filter((r) => r.kind === "idea");
      const refUrls = references.filter((r) => r.kind === "url");
      const refImages = references.filter((r) => r.kind === "image" && r.artifactId);
      const refTextBlocks: string[] = [];
      if (refIdeas.length > 0) {
        refTextBlocks.push(
          `[Referans Fikirler]\n${refIdeas
            .map((r) => `- (${r.role}) ${r.title}${r.note ? `: ${r.note}` : ""}`)
            .join("\n")}`
        );
      }
      if (refUrls.length > 0) {
        refTextBlocks.push(
          `[Web Sitesi / URL Referansları]\n${refUrls
            .map(
              (r) =>
                `- ${r.url}${r.note ? ` (Not: ${r.note})` : ""}${
                  r.extractedText ? `\n  <untrusted_tool_data tool="url-ref">${r.extractedText.slice(0, 900)}</untrusted_tool_data>` : ""
                }`
            )
            .join("\n")}`
        );
      }
      const refIdeaBlock = refTextBlocks.length > 0 ? `\n\n${refTextBlocks.join("\n\n")}` : "";

      userParts.push({ type: "text", text: opts.message + refIdeaBlock });
      const attachedIds: string[] = [];
      for (const att of opts.attachments ?? []) {
        attachedIds.push(att.artifactId);
        if (att.kind === "image") {
          userParts.push({ type: "image", artifactId: att.artifactId, mime: att.mime, alt: att.name });
        } else {
          userParts.push({
            type: "file",
            artifactId: att.artifactId,
            name: att.name ?? "dosya",
            mime: att.mime,
          });
        }
      }
      for (const rImg of refImages) {
        if (rImg.artifactId && !attachedIds.includes(rImg.artifactId)) {
          attachedIds.push(rImg.artifactId);
          userParts.push({
            type: "image",
            artifactId: rImg.artifactId,
            mime: rImg.mime ?? "image/png",
            alt: `[Referans:${rImg.role}] ${rImg.title}${rImg.note ? ` — ${rImg.note}` : ""}`,
          });
        }
      }

      const existingMsgs = this.db.listMessages(thread.id);
      const parentId =
        opts.parentId !== undefined
          ? opts.parentId
          : thread.activeBranchHeadId ?? existingMsgs.at(-1)?.id ?? null;

      const userMsg = this.db.addMessage({
        threadId: thread.id,
        parentId,
        role: "user",
        author: { kind: "user" },
        parts: userParts,
        artifacts: attachedIds,
      });

      // Auto-title first user message
      if (settings.autoTitle && existingMsgs.length === 0 && thread.title === "Yeni Sohbet") {
        const autoTitle = parsed.cleanText.slice(0, 48) || "Yeni Sohbet";
        this.db.updateThread(thread.id, { title: autoTitle });
      }

      yield { type: "user_message", message: userMsg };

      // ==================== SPECIAL INSTANT SLASH COMMANDS ====================

      if (parsed.slashCommand) {
        const cmd = parsed.slashCommand.command;

        if (cmd === "referans") {
          const arg = parsed.slashCommand.args.trim();
          const lowerArg = arg.toLowerCase();
          if (!arg || lowerArg === "liste" || lowerArg === "list") {
            const cur = this.getThreadReferences(thread.id);
            const listMd =
              cur.length === 0
                ? "Bu sohbette aktif referans yok.\n\n**Örnekler:**\n- `/referans https://linear.app sade koyu arayüz`\n- `/referans #art_123 renk ve düzen`\n- `/referans İsviçre ızgara, gradyan yok, yüksek kontrast`"
                : `### Aktif Referanslar (${cur.length})\n` +
                  cur
                    .map(
                      (r, i) =>
                        `${i + 1}. **[${r.kind.toUpperCase()} / ${r.role}]** ${r.title}${r.url ? ` (${r.url})` : ""}${r.note ? ` — ${r.note}` : ""}`
                    )
                    .join("\n") +
                  `\n\nTemizlemek için: \`/referans temizle\``;
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, listMd, "Referans");
            return;
          }
          if (lowerArg === "temizle" || lowerArg === "clear") {
            this.threadReferences.delete(thread.id);
            yield { type: "references_cleared", threadId: thread.id };
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, "Bu sohbetteki tüm aktif referanslar temizlendi.", "Referans");
            return;
          }
          const added = await this.addReferenceToThread(thread.id, thread.projectId, arg, ac.signal);
          yield { type: "reference_added", reference: added.reference, references: added.all };
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, added.summaryText, "Referans");
          return;
        }

        if (cmd === "quota") {
          const qs = this.db.listQuotaStatuses();
          const tbl = [
            "### Live Tool & Provider Quotas",
            "",
            "| Provider / Tool | Used | Remaining | Resets | Window Cost |",
            "| --- | --- | --- | --- | --- |",
            ...qs.map(
              (q) =>
                `| ${q.displayName} | ${q.usedAmount} ${q.metric} | ${q.remainingAmount === null ? "Unlimited" : `${q.remainingAmount} ${q.metric}`} | ${q.resetInterval} | $${q.windowCostUsd.toFixed(4)} |`
            ),
          ].join("\n");
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, tbl, "Quotas");
          return;
        }

        if (cmd === "anti-slop") {
          const arg = parsed.slashCommand.args.trim().toLowerCase();
          if (arg === "on" || arg === "ac" || arg === "aç") {
            this.db.updateSettings({ aiSlopBlockerEnabled: true });
          } else if (arg === "off" || arg === "kapat") {
            this.db.updateSettings({ aiSlopBlockerEnabled: false });
          }
          const cur = this.db.getSettings().aiSlopBlockerEnabled !== false;
          const md = [
            `### AI Slop Blocker: **${cur ? "ACTIVE (ON)" : "OFF"}**`,
            `- **Blocked / Cleaned Slop Patterns (session):** \`${this.optimizationStats.slopItemsBlocked}\``,
            `- **Layer 1 (Pre-Generation):** Injects strict anti-cliché prose, anti-sycophancy, editorial Swiss UI, and visual craft directives into every LLM & image call.`,
            `- **Layer 2 (Post-Generation):** Scrubs sycophantic openers, filler phrases, and emoji spam, and calculates a real **Craft Score (0–100)** on every response.`,
            `- Toggle: \`/anti-slop on\` | \`/anti-slop off\``,
          ].join("\n");
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "AI Slop Blocker");
          return;
        }

        // ==================== CLAUDE-CODE LOCAL PROJECT SLASH COMMANDS ====================

        if (cmd === "tree" || cmd === "cat" || cmd === "grep" || cmd === "sh" || cmd === "diff" || cmd === "apply") {
          const root = project?.rootPath;
          if (!root) {
            yield* this.emitSystemAssistantReply(
              thread.id,
              userMsg.id,
              "Bu çalışma alanına henüz bir yerel proje klasörü bağlı değil. Sol menüden **Klasör Aç…** veya **Sıfırdan Proje…** ile Mac'inden bir klasör bağla.",
              "Local Project"
            );
            return;
          }

          if (cmd === "tree") {
            const entries = listProjectTree(root, 4, 160);
            const git = await getProjectGitStatus(root);
            const lines = entries.map((e) => `${"  ".repeat(e.depth)}${e.kind === "dir" ? "📁" : "·"} \`${e.path}\``);
            const md = [
              `### Proje Ağacı — \`${root}\``,
              git.isGitRepo ? `**Git:** \`${git.branch}\` · ${git.changedFiles.length} değişen dosya` : "_Git deposu değil_",
              "",
              lines.length > 0 ? lines.join("\n") : "_(Klasör boş)_",
            ].join("\n");
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Project Tree");
            return;
          }

          if (cmd === "cat") {
            const target = parsed.slashCommand.args.trim();
            if (!target) {
              yield* this.emitSystemAssistantReply(thread.id, userMsg.id, "Kullanım: `/cat src/index.ts`", "Read File");
              return;
            }
            try {
              const f = readProjectFile(root, target);
              const ext = f.path.split(".").pop() || "txt";
              const md = `### \`${f.path}\` (${f.lines} satır, ${f.size} byte)\n\n\`\`\`${ext}:${f.path}\n${f.content.slice(0, 14000)}\n\`\`\``;
              yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Read File");
            } catch (e) {
              yield* this.emitSystemAssistantReply(thread.id, userMsg.id, `Hata: ${e instanceof Error ? e.message : String(e)}`, "Read File");
            }
            return;
          }

          if (cmd === "grep") {
            const q = parsed.slashCommand.args.trim();
            if (!q) {
              yield* this.emitSystemAssistantReply(thread.id, userMsg.id, "Kullanım: `/grep fonksiyonAdi`", "Project Search");
              return;
            }
            const matches = searchProjectText(root, q, 40);
            const md = matches.length
              ? `### Arama Sonuçları: \`${q}\` (${matches.length} eşleşme)\n\n` +
                matches.map((m) => `- \`${m.path}:${m.line}\` — ${m.text}`).join("\n")
              : `\`${q}\` için projede eşleşme bulunamadı.`;
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Project Search");
            return;
          }

          if (cmd === "sh") {
            const shellCmd = parsed.slashCommand.args.trim();
            if (!shellCmd) {
              yield* this.emitSystemAssistantReply(thread.id, userMsg.id, "Kullanım: `/sh bun test` veya `/sh git status`", "Terminal");
              return;
            }
            const res = await runProjectShell(root, shellCmd);
            const md = [
              `### Terminal · \`${shellCmd}\` (exit \`${res.exitCode}\` · ${res.durationMs}ms)`,
              res.stdout.trim() ? `\`\`\`text\n${res.stdout.trim()}\n\`\`\`` : "",
              res.stderr.trim() ? `**stderr:**\n\`\`\`text\n${res.stderr.trim()}\n\`\`\`` : "",
            ].filter(Boolean).join("\n\n");
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Terminal");
            return;
          }

          if (cmd === "diff") {
            const diff = await getProjectGitDiff(root, parsed.slashCommand.args.trim() || undefined);
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, `### Git Diff\n\n\`\`\`diff\n${diff.slice(0, 14000)}\n\`\`\``, "Git Diff");
            return;
          }

          if (cmd === "apply") {
            const prevAssistant = [...this.db.listMessages(thread.id)].reverse().find((m) => m.role === "assistant");
            const prevText = prevAssistant?.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") ?? "";
            const applied = applyMarkdownEditsToProject(root, prevText);
            const md = applied.length
              ? `### Diske Uygulandı (${applied.length} dosya)\n` +
                applied.map((a) => `- \`${a.path}\` (${a.created ? "oluşturuldu" : "güncellendi"} · ${a.bytes} B)`).join("\n")
              : "Son asistan yanıtında dosya yolu içeren kod bloğu (` ```ts:src/dosya.ts `) bulunamadı.";
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Apply to Disk");
            return;
          }
        }

        if (cmd === "optimize") {
          const s = this.optimizationStats;
          const md = [
            "### Token & Cost Optimizer Status",
            `- **Compression:** ${settings.tokenOptimizationEnabled !== false ? "ON (active)" : "OFF"}`,
            `- **Economy Mode:** ${settings.economyMode ? "ON" : "OFF"}`,
            `- **Saved Tokens (session):** \`${s.savedTokens.toLocaleString()}\``,
            `- **Estimated Savings:** \`$${s.savedCostUsd.toFixed(5)}\``,
          ].join("\n");
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, md, "Optimizer");
          return;
        }

        if (cmd === "store" || cmd === "aso" || cmd === "launch" || cmd === "ads" || cmd === "brand") {
          const flowMap: Record<string, string> = {
            store: "magaza-gorselleri",
            aso: "aso-paketi",
            launch: "saas-lansman-kiti",
            ads: "reklam-kreatif-matrisi",
            brand: "marka-kimlik-studyo",
          };
          const fid = flowMap[cmd];
          const flow = this.db.getFlow(fid);
          if (flow) {
            const firstKey = Object.keys(flow.inputs ?? {})[0] ?? "brief";
            const run = await this.startFlowRun(
              flow.id,
              { [firstKey]: parsed.slashCommand.args || "Modern AI product" },
              thread.projectId,
              thread.id
            );
            yield { type: "flow_run", run };
            const artIds = run.stepStates.flatMap((s) => s.artifactIds ?? []);
            for (const aid of artIds) {
              const art = this.db.getArtifact(aid);
              if (art) yield { type: "artifact_created", artifact: art };
            }
            const summary = `**${flow.nameEn || flow.name}** completed (${run.stepStates.length} steps · \`$${run.totalCostUsd.toFixed(5)}\` · ${artIds.length} artifact).`;
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, summary, "Studio Schema");
            return;
          }
        }

        if (cmd === "yardim") {
          const table = [
            "### SYMFORYX Komutları",
            "",
            "| Komut | İşlev | Örnek |",
            "| --- | --- | --- |",
            ...SLASH_COMMANDS_CATALOG.map(
              (c) => `| \`${c.command}\` | ${c.descTr} | \`${c.example}\` |`
            ),
          ].join("\n");
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, table, "Yardım");
          return;
        }

        if (cmd === "maliyet") {
          const msgs = this.db.listMessages(thread.id);
          const totalUsd = msgs.reduce((s, m) => s + (m.usage?.costUsd ?? 0), 0);
          const inTok = msgs.reduce((s, m) => s + (m.usage?.inputTokens ?? 0), 0);
          const outTok = msgs.reduce((s, m) => s + (m.usage?.outputTokens ?? 0), 0);
          const summary = [
            `### Bu Sohbetin Maliyet Özeti`,
            `- **Toplam mesaj:** ${msgs.length}`,
            `- **Giriş token:** ${inTok.toLocaleString("tr-TR")}`,
            `- **Çıkış token:** ${outTok.toLocaleString("tr-TR")}`,
            `- **Tahmini toplam maliyet:** \`$${totalUsd.toFixed(5)}\``,
          ].join("\n");
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, summary, "Maliyet");
          return;
        }

        if (cmd === "hafiza") {
          const note = parsed.slashCommand.args.trim();
          if (note) {
            this.db.addMemory({
              scope: "project",
              projectId: thread.projectId,
              content: note,
              sourceMessageId: userMsg.id,
              approved: true,
            });
            yield* this.emitSystemAssistantReply(
              thread.id,
              userMsg.id,
              `Proje hafızasına kaydedildi: **"${note}"**\n\nBu projedeki tüm sohbetler artık bu bilgiyi bağlam olarak görecek.`,
              "Hafıza"
            );
          } else {
            const mems = this.db.listMemories({ scope: "project", projectId: thread.projectId });
            const list = mems.length
              ? mems.map((m) => `- ${m.content}`).join("\n")
              : "Bu projede henüz hafıza kaydı yok. Eklemek için `/hafiza <not>` yaz.";
            yield* this.emitSystemAssistantReply(thread.id, userMsg.id, `### Proje Hafızası\n${list}`, "Hafıza");
          }
          return;
        }

        if (cmd === "palet") {
          yield* this.runSingleToolInChat({
            threadId: thread.id,
            projectId: thread.projectId,
            parentId: userMsg.id,
            toolId: "dev.ozkandev.renk-paleti",
            args: { source: parsed.slashCommand.args || "modern arayüz", count: 5 },
            signal: ac.signal,
          });
          return;
        }

        if (cmd === "calistir") {
          const lastCode = this.findLastCodeBlock(thread.id);
          if (!lastCode) {
            yield* this.emitSystemAssistantReply(
              thread.id,
              userMsg.id,
              "Bu sohbette çalıştırılacak kod bloğu bulunamadı. Önce bir JavaScript veya Python kodu üret.",
              "Sandbox"
            );
            return;
          }
          yield* this.runSingleToolInChat({
            threadId: thread.id,
            projectId: thread.projectId,
            parentId: userMsg.id,
            toolId: "code-sandbox",
            args: { language: lastCode.language, code: lastCode.content },
            signal: ac.signal,
          });
          return;
        }

        if (cmd === "onizle") {
          const lastHtml = this.findLastCodeBlock(thread.id, ["html", "svg"]);
          if (!lastHtml) {
            yield* this.emitSystemAssistantReply(
              thread.id,
              userMsg.id,
              "Önizlenecek HTML kodu bulunamadı. Önce `@claude` ile bir HTML/Tailwind arayüzü üret.",
              "Önizleme"
            );
            return;
          }
          yield* this.runSingleToolInChat({
            threadId: thread.id,
            projectId: thread.projectId,
            parentId: userMsg.id,
            toolId: "live-preview",
            args: { html: lastHtml.content, title: lastHtml.filename || "Canlı Önizleme" },
            signal: ac.signal,
          });
          return;
        }

        if (cmd === "akis") {
          const [flowId, ...rest] = parsed.slashCommand.args.split(/\s+/);
          const flow = this.db.getFlow(flowId);
          if (!flow) {
            const avail = this.db.listFlows().map((f) => `- \`${f.id}\` — ${f.name}`).join("\n");
            yield* this.emitSystemAssistantReply(
              thread.id,
              userMsg.id,
              `Akış bulunamadı: \`${flowId || "(boş)"}\`\n\n### Kullanılabilir Akışlar\n${avail}`,
              "Akışlar"
            );
            return;
          }
          const firstInputKey = Object.keys(flow.inputs ?? {})[0] ?? "brief";
          const inputs = { [firstInputKey]: rest.join(" ") || "Modern arayüz" };
          const run = await this.startFlowRun(flow.id, inputs, thread.projectId, thread.id);
          yield { type: "flow_run", run };
          const statusMsg =
            run.status === "awaiting_approval"
              ? `**${flow.name}** akışı onay adımında bekliyor. Akışlar panelinden veya aşağıdaki karttan onaylayabilirsin.`
              : `**${flow.name}** akışı tamamlandı (${run.stepStates.length} adım, \`$${run.totalCostUsd.toFixed(4)}\`).`;
          yield* this.emitSystemAssistantReply(thread.id, userMsg.id, statusMsg, "Akış Motoru");
          return;
        }
      }

      // ==================== MODE: CHAIN (ZİNCİR) ====================

      if (parsed.isChain && parsed.chainSteps && parsed.chainSteps.length >= 2) {
        let lastParentId = userMsg.id;
        let lastArtifacts: string[] = [...attachedIds];
        let lastOutputText = "";

        for (let i = 0; i < parsed.chainSteps.length; i++) {
          if (ac.signal.aborted) break;
          const stepText = parsed.chainSteps[i];
          const stepParsed = parseUserInput(stepText);
          const decision = routeMessage({
            parsed: stepParsed,
            attachments: lastArtifacts.map((id) => {
              const a = this.db.getArtifact(id);
              return { kind: a?.kind === "image" ? "image" : "file", mime: a?.mime ?? "text/plain", name: a?.title };
            }),
            roles,
            providers,
            settings,
            mode: "smart",
          });
          yield { type: "routing", decision, threadId: thread.id };

          const stepPrompt =
            i === 0
              ? stepParsed.cleanText
              : `Önceki zincir adımının çıktısı:\n${lastOutputText.slice(0, 2000)}\n\nŞimdiki adım (${i + 1}/${parsed.chainSteps.length}): ${stepParsed.cleanText}`;

          for await (const evt of this.executeModelTurn({
            threadId: thread.id,
            projectId: thread.projectId,
            parentId: lastParentId,
            providerId: decision.providerId,
            modelId: decision.modelId,
            roleId: decision.roleId,
            routingNote: {
              type: "routing_note",
              roleId: decision.roleId,
              roleName: `Zincir ${i + 1}/${parsed.chainSteps.length} · ${decision.roleName}`,
              providerId: decision.providerId,
              modelId: decision.modelId,
              reason: decision.reason,
              layer: decision.layer,
              confidence: decision.confidence,
            },
            overrideUserPrompt: stepPrompt,
            extraAttachmentIds: lastArtifacts,
            signal: ac.signal,
          })) {
            if (evt.type === "message_done") {
              lastParentId = evt.message.id;
              lastOutputText = evt.message.parts
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("\n");
              if (evt.message.artifacts?.length) {
                lastArtifacts = evt.message.artifacts;
              }
            }
            yield evt;
          }
        }
        return;
      }

      // ==================== MODE: AGENT (AJAN) ====================

      if (effectiveMode === "agent" || parsed.slashCommand?.command === "ajan") {
        const enabledTools =
          opts.enabledTools && opts.enabledTools.length > 0
            ? opts.enabledTools
            : this.db
                .listTools()
                .filter((t) => t.installed && t.enabled)
                .map((t) => t.id);

        const resolver = this.makePermissionResolver(thread.id, thread.projectId);
        const decision = routeMessage({
          parsed,
          attachments: (opts.attachments ?? []).map((a) => ({ kind: a.kind, mime: a.mime, name: a.name })),
          roles,
          providers,
          settings,
          mode: "smart",
        });

        const agentEvents: unknown[] = [];
        const result = await runAgentLoop({
          goal: parsed.cleanText,
          projectId: thread.projectId,
          threadId: thread.id,
          maxSteps: settings.agentMaxSteps,
          maxCostUsd: settings.agentMaxCostUsd,
          enabledTools,
          signal: ac.signal,
          invokeTool: async (toolId, args) => {
            const out = await this.toolRuntime.invoke({
              toolId,
              manifest: this.db.getTool(toolId) ?? undefined,
              args,
              projectId: thread.projectId,
              threadId: thread.id,
              resolver,
              signal: ac.signal,
              skipApprovalCheck: true,
            });
            return out;
          },
          generateText: async (prompt) => {
            return await this.runHeadlessModelCall({
              providerId: decision.providerId,
              modelId: decision.modelId,
              prompt,
              projectId: thread.projectId,
              threadId: thread.id,
              signal: ac.signal,
            });
          },
          onTimeline: (evt) => {
            agentEvents.push(evt);
          },
        });

        for (const ev of agentEvents) {
          yield { type: "agent_event", event: ev };
        }

        const timelineMd = [
          `### Ajan Zaman Çizelgesi (${result.stepsUsed} adım · \`$${result.totalCostUsd.toFixed(4)}\`)`,
          ...result.timeline.map((e) => `- **${e.title}:** ${e.detail.split("\n")[0]}`),
          "",
          "---",
          "",
          result.finalAnswer,
        ].join("\n");

        const agentMsg = this.db.addMessage({
          threadId: thread.id,
          parentId: userMsg.id,
          role: "assistant",
          author: {
            kind: "model",
            providerId: decision.providerId,
            modelId: decision.modelId,
            modelName: "SYMFORYX Ajan",
            badgeColor: "#FF8A3D",
            badgeLetter: "A",
          },
          parts: [{ type: "text", text: timelineMd }],
          artifacts: result.artifactIds,
          usage: {
            inputTokens: estimateTokens(parsed.cleanText),
            outputTokens: estimateTokens(timelineMd),
            costUsd: result.totalCostUsd,
            latencyMs: 650,
          },
        });

        for (const aid of result.artifactIds) {
          const art = this.db.getArtifact(aid);
          if (art) yield { type: "artifact_created", artifact: art };
        }
        yield { type: "message_done", message: agentMsg };
        return;
      }

      // ==================== MODE: COUNCIL (KONSEY) ====================

      if (effectiveMode === "council" || parsed.slashCommand?.command === "council") {
        const generator = resolveProviderModel("anthropic", undefined, providers);
        const critic1 = resolveProviderModel("openai", undefined, providers);
        const critic2 = resolveProviderModel("google", undefined, providers);

        // 1. Producer
        const draft = await this.runHeadlessModelCall({
          providerId: generator.providerId,
          modelId: generator.modelId,
          prompt: parsed.cleanText,
          projectId: thread.projectId,
          threadId: thread.id,
          signal: ac.signal,
        });

        // 2. Critics in parallel
        const [rev1, rev2] = await Promise.all([
          this.runHeadlessModelCall({
            providerId: critic1.providerId,
            modelId: critic1.modelId,
            prompt: `Eleştirmen olarak aşağıdaki yanıttaki eksikleri, riskleri ve iyileştirmeleri 3 maddede belirt:\n\nSoru: ${parsed.cleanText}\n\nTaslak Yanıt:\n${draft.text}`,
            projectId: thread.projectId,
            threadId: thread.id,
            signal: ac.signal,
          }),
          this.runHeadlessModelCall({
            providerId: critic2.providerId,
            modelId: critic2.modelId,
            prompt: `Alternatif bakış açısıyla bu yanıtı değerlendir ve en güçlü ek önerini yaz:\n\nSoru: ${parsed.cleanText}\n\nTaslak Yanıt:\n${draft.text}`,
            projectId: thread.projectId,
            threadId: thread.id,
            signal: ac.signal,
          }),
        ]);

        // 3. Judge synthesizes live stream
        const judgePrompt = `Sen Konsey Hakemisin. Üreticinin taslağını ve iki eleştirmenin geri bildirimlerini sentezleyip en yüksek kaliteli nihai yanıtı yaz.\n\nOrijinal Soru: ${parsed.cleanText}\n\n--- Üretici Taslağı ---\n${draft.text}\n\n--- Eleştirmen 1 ---\n${rev1.text}\n\n--- Eleştirmen 2 ---\n${rev2.text}`;

        yield* this.executeModelTurn({
          threadId: thread.id,
          projectId: thread.projectId,
          parentId: userMsg.id,
          providerId: generator.providerId,
          modelId: generator.modelId,
          roleId: "council",
          routingNote: {
            type: "routing_note",
            roleId: "council",
            roleName: "Konsey (Üretici + 2 Eleştirmen → Hakem)",
            providerId: generator.providerId,
            modelId: generator.modelId,
            reason: `3 model inceledi · Ara çağrı maliyeti: $${(draft.costUsd + rev1.costUsd + rev2.costUsd).toFixed(4)}`,
            layer: 1,
            confidence: 1,
          },
          overrideUserPrompt: judgePrompt,
          signal: ac.signal,
        });
        return;
      }

      // ==================== ROUTING DECISION ====================

      const decision = routeMessage({
        parsed,
        attachments: (opts.attachments ?? []).map((a) => ({
          kind: a.kind,
          mime: a.mime,
          name: a.name,
        })),
        roles,
        providers,
        settings,
        manualTarget:
          opts.modelOverride ??
          (thread.pinnedProviderId && thread.pinnedModelId
            ? { providerId: thread.pinnedProviderId, modelId: thread.pinnedModelId }
            : null),
        mode: effectiveMode,
      });

      yield { type: "routing", decision, threadId: thread.id };

      // ==================== MODE: COMPARE (KARŞILAŞTIR) ====================

      if (
        effectiveMode === "compare" ||
        decision.isCompareAll ||
        parsed.slashCommand?.command === "karsilastir"
      ) {
        const targets =
          decision.explicitTargets && decision.explicitTargets.length >= 2
            ? decision.explicitTargets
            : [
                resolveProviderModel("anthropic", undefined, providers),
                resolveProviderModel("openai", undefined, providers),
                resolveProviderModel("google", undefined, providers),
              ];

        const compareGroupId = createId("cmp");
        // Run all targets concurrently and emit results as each completes
        const promises = targets.map(async (t) => {
          const events: StreamEvent[] = [];
          for await (const evt of this.executeModelTurn({
            threadId: thread.id,
            projectId: thread.projectId,
            parentId: userMsg.id,
            providerId: t.providerId,
            modelId: t.modelId,
            roleId: "compare",
            compareGroupId,
            signal: ac.signal,
          })) {
            events.push(evt);
          }
          return events;
        });

        const allEventBatches = await Promise.all(promises);
        for (const batch of allEventBatches) {
          for (const evt of batch) {
            yield evt;
          }
        }
        return;
      }

      // ==================== PRE-RUN TOOL IF SLASH /ara OR /oku ====================

      let injectedToolContext = "";
      if (parsed.slashCommand?.command === "ara" && parsed.slashCommand.args) {
        const resolver = this.makePermissionResolver(thread.id, thread.projectId);
        yield { type: "tool_event", toolId: "web-search", status: "running", detail: parsed.slashCommand.args };
        const res = await this.toolRuntime.invoke({
          toolId: "web-search",
          manifest: this.db.getTool("web-search") ?? undefined,
          args: { query: parsed.slashCommand.args, maxResults: 5 },
          projectId: thread.projectId,
          threadId: thread.id,
          resolver,
          signal: ac.signal,
          skipApprovalCheck: true,
        });
        yield { type: "tool_event", toolId: "web-search", status: "done", detail: `${res.durationMs} ms` };
        injectedToolContext = `\n\n<untrusted_tool_data tool="web-search">\n${res.text ?? ""}\n</untrusted_tool_data>`;
      } else if (parsed.slashCommand?.command === "oku" && parsed.slashCommand.args) {
        const resolver = this.makePermissionResolver(thread.id, thread.projectId);
        yield { type: "tool_event", toolId: "url-reader", status: "running", detail: parsed.slashCommand.args };
        const res = await this.toolRuntime.invoke({
          toolId: "url-reader",
          manifest: this.db.getTool("url-reader") ?? undefined,
          args: { url: parsed.slashCommand.args.trim() },
          projectId: thread.projectId,
          threadId: thread.id,
          resolver,
          signal: ac.signal,
          skipApprovalCheck: true,
        });
        yield { type: "tool_event", toolId: "url-reader", status: "done", detail: `${res.durationMs} ms` };
        injectedToolContext = `\n\n<untrusted_tool_data tool="url-reader">\n${res.text ?? ""}\n</untrusted_tool_data>`;
      }

      // ==================== IMAGE GENERATION PATH ====================
      // Allow ANY image-capable model chosen manually OR via role/mention!
      const chosenProvCfg = providers.find((p) => p.id === decision.providerId);
      const chosenModelObj = chosenProvCfg?.models.find((m) => m.id === decision.modelId);
      const isImageModel =
        Boolean(chosenModelObj?.capabilities.includes("image.generate")) &&
        !chosenModelObj?.capabilities.includes("chat");

      if (decision.roleId === "gorsel-uretim" || decision.roleId === "gorsel-duzenleme" || isImageModel) {
        const refImgPayloads = refImages
          .map((r) => {
            const art = r.artifactId ? this.db.getArtifact(r.artifactId) : null;
            const latest = art ? art.versions[art.currentVersion - 1] ?? art.versions.at(-1) : null;
            return latest
              ? { mime: latest.mime, base64: latest.content, role: r.role, note: r.note }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));

        yield* this.executeImageTurn({
          threadId: thread.id,
          projectId: thread.projectId,
          parentId: userMsg.id,
          providerId: decision.providerId,
          modelId: decision.modelId,
          prompt: parsed.cleanText + refIdeaBlock,
          references,
          referenceImages: refImgPayloads,
          routingNote: settings.routingExplain
            ? {
                type: "routing_note",
                roleId: decision.roleId,
                roleName: decision.roleName,
                providerId: decision.providerId,
                modelId: decision.modelId,
                reason: decision.reason,
                layer: decision.layer,
                confidence: decision.confidence,
              }
            : undefined,
          signal: ac.signal,
        });
        return;
      }

      // ==================== STANDARD STREAMING CHAT TURN ====================

      // Privacy check for private projects (Section 32.2)
      if (project?.isPrivate && project.allowedProviders?.length) {
        const targetProv = providers.find((p) => p.id === decision.providerId);
        const isLocal = targetProv?.id === "ollama" || targetProv?.id === "demo";
        if (!isLocal && !project.allowedProviders.includes(decision.providerId)) {
          yield {
            type: "error",
            code: "permission_denied",
            message: `Bu proje "Gizli Proje" olarak işaretli. "${decision.providerId}" sağlayıcısına izin verilmiyor.`,
          };
          return;
        }
      }

      yield* this.executeModelTurn({
        threadId: thread.id,
        projectId: thread.projectId,
        parentId: userMsg.id,
        providerId: decision.providerId,
        modelId: decision.modelId,
        roleId: decision.roleId,
        routingNote:
          settings.routingExplain && effectiveMode === "smart"
            ? {
                type: "routing_note",
                roleId: decision.roleId,
                roleName: decision.roleName,
                providerId: decision.providerId,
                modelId: decision.modelId,
                reason: decision.reason,
                layer: decision.layer,
                confidence: decision.confidence,
                alternatives: decision.uncertainAlternatives?.map((a) => ({
                  roleId: a.roleId,
                  providerId: a.providerId,
                  modelId: a.modelId,
                  label: a.roleName,
                })),
              }
            : undefined,
        overrideUserPrompt: injectedToolContext ? `${parsed.cleanText}${injectedToolContext}` : undefined,
        autoApplyEdits: opts.autoApplyEdits,
        signal: ac.signal,
      });
    } finally {
      this.activeControllers.delete(thread.id);
    }
  }

  private async *executeImageTurn(opts: {
    threadId: string;
    projectId: string;
    parentId: string;
    providerId: string;
    modelId: string;
    prompt: string;
    references?: ReferenceItem[];
    referenceImages?: Array<{ mime: string; base64: string; role: ReferenceItem["role"]; note?: string }>;
    routingNote?: Extract<MessagePart, { type: "routing_note" }>;
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    const providerCfg = this.db.getProvider(opts.providerId);
    const adapter = this.providers.get(opts.providerId, providerCfg ?? undefined);
    const apiKey = this.db.getDecryptedProviderKey(opts.providerId);

    const budgetCheck = this.db.checkBudgets({
      projectId: opts.projectId,
      providerId: opts.providerId,
      isLocal: opts.providerId === "demo" || opts.providerId === "ollama" || opts.providerId === "comfyui",
    });
    if (budgetCheck.blocked) {
      yield {
        type: "error",
        code: "budget_exceeded",
        message: `Sert bütçe limiti (${budgetCheck.exceeded?.budget.name}) doldu. Yerel modellere geçebilir veya limiti artırabilirsin.`,
      };
      return;
    }

    const start = Date.now();
    const slopEnabled = this.db.getSettings().aiSlopBlockerEnabled !== false;
    const craftedPrompt = enhanceImagePromptAntiSlop(opts.prompt, slopEnabled);
    try {
      const imgRes = adapter.generateImage
        ? await adapter.generateImage(
            {
              modelId: opts.modelId,
              prompt: craftedPrompt,
              references: opts.references,
              referenceImages: opts.referenceImages,
              apiKey,
              baseUrl: providerCfg?.baseUrl,
            },
            opts.signal
          )
        : await this.providers.get("demo").generateImage!(
            { prompt: craftedPrompt, references: opts.references, referenceImages: opts.referenceImages },
            opts.signal
          );

      const art = this.db.createArtifact({
        threadId: opts.threadId,
        projectId: opts.projectId,
        kind: "image",
        title: opts.prompt.slice(0, 44) || "Görsel Tasarım",
        mime: imgRes.mime,
        content: imgRes.base64,
        note: opts.prompt,
      });

      const parts: MessagePart[] = [];
      if (opts.routingNote) parts.push(opts.routingNote);
      parts.push({
        type: "image",
        artifactId: art.id,
        mime: imgRes.mime,
        alt: opts.prompt,
      });
      parts.push({
        type: "text",
        text: `Görsel tasarım oluşturuldu ve sağdaki **Artefakt Paneli**nde açıldı.\n\nBir sonraki adımda **"Gönder ▸ Claude"** düğmesine tıklayarak bu tasarımı doğrudan HTML/React koduna dönüştürebilirsin.`,
      });

      const msg = this.db.addMessage({
        threadId: opts.threadId,
        parentId: opts.parentId,
        role: "assistant",
        author: {
          kind: "model",
          providerId: opts.providerId,
          modelId: opts.modelId,
          modelName: providerCfg?.models.find((m) => m.id === opts.modelId)?.displayName ?? "Görsel Stüdyo",
          badgeColor: providerCfg?.badgeColor ?? "#6D5EF6",
          badgeLetter: "G",
        },
        parts,
        artifacts: [art.id],
        usage: {
          inputTokens: estimateTokens(opts.prompt),
          outputTokens: 0,
          costUsd: imgRes.costUsd,
          latencyMs: Date.now() - start,
        },
      });

      this.db.recordUsage({
        workspaceId: "ws_default",
        projectId: opts.projectId,
        threadId: opts.threadId,
        messageId: msg.id,
        providerId: opts.providerId,
        modelId: opts.modelId,
        inputTokens: estimateTokens(opts.prompt),
        outputTokens: 0,
        costUsd: imgRes.costUsd,
        latencyMs: Date.now() - start,
      });

      yield { type: "artifact_created", artifact: art };
      yield { type: "message_done", message: msg };
    } catch (err) {
      yield {
        type: "error",
        code: err instanceof SymError ? err.code : "unavailable",
        message: err instanceof Error ? err.message : String(err),
        canFallback: true,
      };
    }
  }

  private async *executeModelTurn(opts: {
    threadId: string;
    projectId: string;
    parentId: string;
    providerId: string;
    modelId: string;
    roleId: string;
    routingNote?: Extract<MessagePart, { type: "routing_note" }>;
    compareGroupId?: string;
    overrideUserPrompt?: string;
    extraAttachmentIds?: string[];
    autoApplyEdits?: boolean;
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    const settings = this.db.getSettings();
    const project = this.db.getProject(opts.projectId);
    const roles = this.db.listRoles(opts.projectId);
    const role = roles.find((r) => r.id === opts.roleId);
    const allMessages = this.db.listMessages(opts.threadId);
    const thread = this.db.getThread(opts.threadId);

    const providerCfg = this.db.getProvider(opts.providerId);
    const modelInfo: ModelInfo | undefined = providerCfg?.models.find((m) => m.id === opts.modelId);
    const isLocal = opts.providerId === "ollama" || opts.providerId === "demo";

    // Budget enforcement
    const budgetCheck = this.db.checkBudgets({
      projectId: opts.projectId,
      providerId: opts.providerId,
      isLocal,
    });
    if (budgetCheck.warnings.length > 0) {
      yield { type: "budget_warning", warnings: budgetCheck.warnings };
      this.emitWebhook("budget.threshold", { warnings: budgetCheck.warnings });
    }
    if (budgetCheck.blocked) {
      this.emitWebhook("budget.exceeded", { exceeded: budgetCheck.exceeded });
      yield {
        type: "error",
        code: "budget_exceeded",
        message: `Sert bütçe limiti (${budgetCheck.exceeded?.budget.name}) aşıldı. Ayarlar → Kullanım'dan limiti artırabilir veya yerel modele geçebilirsin.`,
      };
      return;
    }

    // Build context with shared history, memory, indexed project files & auto-summarization
    const lastUserText =
      opts.overrideUserPrompt ??
      allMessages
        .at(-1)
        ?.parts.map((p) => (p.type === "text" ? p.text : ""))
        .join(" ") ??
      "";
    const fileSnippets = this.db.searchProjectFiles(opts.projectId, lastUserText, 4);

    const ctxResult = buildContext({
      allMessages,
      activeHeadId: opts.parentId,
      targetProviderId: opts.providerId,
      targetModel: modelInfo,
      sharedContext: settings.sharedContext,
      project,
      projectMemories: this.db.listMemories({ scope: "project", projectId: opts.projectId }),
      personalMemories: settings.personalMemoryEnabled
        ? this.db.listMemories({ scope: "personal" })
        : [],
      relevantFileSnippets: fileSnippets,
      roleSystemPrompt: role?.systemPrompt,
      summarizeThresholdPercent: settings.autoSummarizeThreshold,
      tokenOptimizationEnabled: settings.tokenOptimizationEnabled !== false,
      aiSlopBlockerEnabled: settings.aiSlopBlockerEnabled !== false,
    });

    // Inject local macOS project folder tree + Git context + file-fence protocol when rootPath is attached
    if (project?.rootPath) {
      try {
        const git = await getProjectGitStatus(project.rootPath);
        const localBlock = buildLocalProjectContextPrompt(project.rootPath, git);
        ctxResult.systemPrompt = `${ctxResult.systemPrompt}\n\n${localBlock}`;
      } catch {
        // ignore if folder unreachable
      }
    }

    // Track cumulative token & cost savings from Context Optimizer
    if (ctxResult.stats.savedTokens > 0) {
      const pInput = modelInfo?.pricing?.inputPerMTok ?? 2.5;
      const estSavedUsd = (ctxResult.stats.savedTokens / 1_000_000) * pInput;
      this.optimizationStats.savedTokens += ctxResult.stats.savedTokens;
      this.optimizationStats.savedCostUsd = Number((this.optimizationStats.savedCostUsd + estSavedUsd).toFixed(6));
    }

    yield { type: "context_stats", stats: ctxResult.stats, threadId: opts.threadId };

    // Resolve artifacts attached to messages in context
    const resolvedArtifacts: ChatRequest["resolvedArtifacts"] = {};
    const collectArtIds = new Set<string>(opts.extraAttachmentIds ?? []);
    for (const m of ctxResult.messages) {
      for (const p of m.parts) {
        if (p.type === "image" || p.type === "file") collectArtIds.add(p.artifactId);
      }
    }
    for (const aid of collectArtIds) {
      const art = this.db.getArtifact(aid);
      if (art) {
        const latest = art.versions[art.currentVersion - 1] ?? art.versions.at(-1);
        if (latest) {
          resolvedArtifacts[aid] = {
            mime: latest.mime,
            base64: art.kind === "image" ? latest.content : undefined,
            contentText: art.kind !== "image" ? latest.content : undefined,
            name: art.title,
          };
        }
      }
    }

    // If override prompt provided (Chain / Council / Tool injection), replace last user message text for the LLM request
    const requestMessages = opts.overrideUserPrompt
      ? [
          ...ctxResult.messages.slice(0, -1),
          {
            ...(ctxResult.messages.at(-1) ?? {
              id: "tmp",
              threadId: opts.threadId,
              parentId: null,
              role: "user" as const,
              author: { kind: "user" as const },
              parts: [],
              createdAt: new Date().toISOString(),
            }),
            parts: [
              { type: "text" as const, text: opts.overrideUserPrompt },
              ...(opts.extraAttachmentIds ?? []).map((aid) => ({
                type: "image" as const,
                artifactId: aid,
                mime: resolvedArtifacts[aid]?.mime ?? "image/png",
              })),
            ],
          },
        ]
      : ctxResult.messages;

    const placeholderParts: MessagePart[] = [];
    if (opts.routingNote) placeholderParts.push(opts.routingNote);
    placeholderParts.push({ type: "text", text: "" });

    const assistantMsg = this.db.addMessage({
      threadId: opts.threadId,
      parentId: opts.parentId,
      role: "assistant",
      author: {
        kind: "model",
        providerId: opts.providerId,
        modelId: opts.modelId,
        modelName: modelInfo?.displayName ?? opts.modelId,
        roleId: opts.roleId,
        badgeColor: providerCfg?.badgeColor ?? "#6D5EF6",
        badgeLetter: providerCfg?.badgeLetter ?? "M",
      },
      parts: placeholderParts,
      compareGroupId: opts.compareGroupId,
    });

    yield { type: "message_start", message: assistantMsg };

    const start = Date.now();
    let accText = "";
    let inputTokens = ctxResult.stats.usedTokens;
    let outputTokens = 0;
    let cachedTokens = 0;
    let usedProviderId = opts.providerId;
    let usedModelId = opts.modelId;
    let fallbackUsed = false;

    const runAttempt = async (pid: string, mid: string) => {
      const pCfg = this.db.getProvider(pid);
      const adapter = this.providers.get(pid, pCfg ?? undefined);
      const apiKey = this.db.getDecryptedProviderKey(pid);
      const chunks: string[] = [];

      for await (const chunk of this.providers.streamWithRetry(
        adapter,
        {
          modelId: mid,
          messages: requestMessages,
          systemPrompt: ctxResult.systemPrompt,
          apiKey,
          baseUrl: pCfg?.baseUrl,
          resolvedArtifacts,
        },
        opts.signal
      )) {
        if (chunk.type === "text") {
          chunks.push(chunk.text);
        } else if (chunk.type === "usage") {
          inputTokens = chunk.inputTokens;
          outputTokens = chunk.outputTokens;
          cachedTokens = chunk.cachedTokens ?? 0;
        }
      }
      return { adapter, chunks };
    };

    try {
      const pCfg = this.db.getProvider(usedProviderId);
      let adapter = this.providers.get(usedProviderId, pCfg ?? undefined);
      const apiKey = this.db.getDecryptedProviderKey(usedProviderId);

      try {
        for await (const chunk of this.providers.streamWithRetry(
          adapter,
          {
            modelId: usedModelId,
            messages: requestMessages,
            systemPrompt: ctxResult.systemPrompt,
            apiKey,
            baseUrl: pCfg?.baseUrl,
            resolvedArtifacts,
          },
          opts.signal
        )) {
          if (chunk.type === "text") {
            accText += chunk.text;
            yield { type: "delta", messageId: assistantMsg.id, text: chunk.text };
          } else if (chunk.type === "usage") {
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
            cachedTokens = chunk.cachedTokens ?? 0;
          }
        }
      } catch (primaryErr) {
        if (opts.signal.aborted) throw primaryErr;
        // Automatic fallback to role backup model (Section 8 & 28)
        if (role?.fallbackProviderId && role?.fallbackModelId) {
          const fb = resolveProviderModel(
            role.fallbackProviderId,
            role.fallbackModelId,
            this.db.listProviders()
          );
          usedProviderId = fb.providerId;
          usedModelId = fb.modelId;
          fallbackUsed = true;
          const fbRes = await runAttempt(usedProviderId, usedModelId);
          adapter = fbRes.adapter;
          for (const t of fbRes.chunks) {
            accText += t;
            yield { type: "delta", messageId: assistantMsg.id, text: t };
          }
        } else {
          throw primaryErr;
        }
      }

      const latencyMs = Date.now() - start;
      const costEstimate = adapter.estimateCost({
        modelId: usedModelId,
        inputTokens,
        outputTokens: outputTokens || estimateTokens(accText),
      });

      // Layer 2 AI Slop Blocker Audit & Scrub
      const slopEnabled = settings.aiSlopBlockerEnabled !== false;
      const slopAudit = auditAndCleanSlop(accText, slopEnabled);
      const finalCleanText = slopAudit.cleanedText;
      if (slopAudit.cleanedCount > 0 || slopAudit.flags.length > 0) {
        this.optimizationStats.slopItemsBlocked += Math.max(slopAudit.cleanedCount, slopAudit.flags.length);
      }

      // Extract code / HTML / Mermaid blocks into versioned Artifacts automatically!
      const createdArtifactIds: string[] = [];
      const codeBlocks = extractCodeBlocks(finalCleanText);
      for (const block of codeBlocks) {
        const isHtml = block.language === "html" || block.language === "htm";
        const isDiagram = block.language === "mermaid";
        if (isHtml || isDiagram || block.content.split("\n").length >= 8) {
          const art = this.db.createArtifact({
            threadId: opts.threadId,
            projectId: opts.projectId,
            messageId: assistantMsg.id,
            kind: isHtml ? "preview" : isDiagram ? "diagram" : "code",
            title:
              block.filename ||
              (isHtml
                ? "Canlı Web Arayüzü"
                : isDiagram
                ? "Mermaid Diyagramı"
                : `Kod (${block.language})`),
            mime: isHtml ? "text/html" : "text/plain",
            language: block.language,
            content: block.content,
          });
          createdArtifactIds.push(art.id);
          yield { type: "artifact_created", artifact: art };
        }
      }

      // Auto-Apply file-annotated code edits directly to local project disk if enabled (Claude Code Auto-Accept mode)
      let autoAppliedNote = "";
      if (opts.autoApplyEdits && project?.rootPath) {
        try {
          const applied = applyMarkdownEditsToProject(project.rootPath, finalCleanText);
          if (applied.length > 0) {
            autoAppliedNote =
              "\n\n---\n**Diske Otomatik Uygulandı:** " +
              applied.map((a) => `\`${a.path}\` (${a.created ? "yeni" : "güncellendi"})`).join(", ");
          }
        } catch {
          // ignore write failure
        }
      }

      const finalParts: MessagePart[] = [];
      if (opts.routingNote) {
        finalParts.push({ ...opts.routingNote, fallbackUsed });
      }
      if (slopEnabled) {
        finalParts.push({
          type: "slop_audit",
          craftScore: slopAudit.craftScore,
          cleanedCount: slopAudit.cleanedCount,
          flags: slopAudit.flags,
          active: true,
        });
      }
      finalParts.push({ type: "text", text: finalCleanText + autoAppliedNote });

      const finalized = this.db.updateMessage(assistantMsg.id, {
        parts: finalParts,
        artifacts: createdArtifactIds,
        usage: {
          inputTokens,
          outputTokens: outputTokens || estimateTokens(accText),
          costUsd: costEstimate.estimatedCostUsd,
          latencyMs,
          cachedTokens,
        },
      })!;

      // Keep active branch head pointing to non-compare message
      if (!opts.compareGroupId && thread) {
        this.db.updateThread(opts.threadId, { activeBranchHeadId: finalized.id });
      }

      this.db.recordUsage({
        workspaceId: "ws_default",
        projectId: opts.projectId,
        threadId: opts.threadId,
        messageId: finalized.id,
        providerId: usedProviderId,
        modelId: usedModelId,
        inputTokens,
        outputTokens: outputTokens || estimateTokens(accText),
        costUsd: costEstimate.estimatedCostUsd,
        latencyMs,
      });

      yield { type: "message_done", message: finalized };
    } catch (err) {
      if (opts.signal.aborted) {
        const partial = this.db.updateMessage(assistantMsg.id, {
          parts: [...(opts.routingNote ? [opts.routingNote] : []), { type: "text", text: accText + "\n\n_(Durduruldu)_" }],
        })!;
        yield { type: "message_done", message: partial };
        return;
      }
      this.db.deleteMessage(assistantMsg.id);
      yield {
        type: "error",
        code: err instanceof SymError ? err.code : "unavailable",
        message: err instanceof Error ? err.message : String(err),
        canFallback: true,
      };
    }
  }

  private async *runSingleToolInChat(opts: {
    threadId: string;
    projectId: string;
    parentId: string;
    toolId: string;
    args: unknown;
    signal: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    const manifest = this.db.getTool(opts.toolId);
    const resolver = this.makePermissionResolver(opts.threadId, opts.projectId);
    yield { type: "tool_event", toolId: opts.toolId, status: "running" };
    try {
      const res = await this.toolRuntime.invoke({
        toolId: opts.toolId,
        manifest: manifest ?? undefined,
        args: opts.args,
        projectId: opts.projectId,
        threadId: opts.threadId,
        resolver,
        signal: opts.signal,
        skipApprovalCheck: true,
      });
      yield { type: "tool_event", toolId: opts.toolId, status: "done", detail: `${res.durationMs} ms` };

      const parts: MessagePart[] = [
        {
          type: "tool_call",
          callId: createId("call"),
          toolId: opts.toolId,
          toolName: manifest?.name ?? opts.toolId,
          args: opts.args,
          status: res.isError ? "error" : "done",
          durationMs: res.durationMs,
        },
        { type: "text", text: res.text ?? "Araç tamamlandı." },
      ];

      for (const aid of res.artifactIds ?? []) {
        const art = this.db.getArtifact(aid);
        if (art) {
          if (art.kind === "image") {
            parts.push({ type: "image", artifactId: art.id, mime: art.mime, alt: art.title });
          }
          yield { type: "artifact_created", artifact: art };
        }
      }

      const msg = this.db.addMessage({
        threadId: opts.threadId,
        parentId: opts.parentId,
        role: "assistant",
        author: {
          kind: "tool",
          toolId: opts.toolId,
          modelName: manifest?.name ?? opts.toolId,
          badgeColor: "#FF8A3D",
          badgeLetter: "T",
        },
        parts,
        artifacts: res.artifactIds ?? [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: res.durationMs },
      });

      this.db.recordUsage({
        workspaceId: "ws_default",
        projectId: opts.projectId,
        threadId: opts.threadId,
        messageId: msg.id,
        providerId: "tool",
        modelId: opts.toolId,
        toolId: opts.toolId,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: manifest?.cost.estimatedPerCallUsd ?? 0,
        latencyMs: res.durationMs,
      });

      yield { type: "message_done", message: msg };
    } catch (err) {
      yield {
        type: "error",
        code: err instanceof SymError ? err.code : "unavailable",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async *emitSystemAssistantReply(
    threadId: string,
    parentId: string,
    text: string,
    label: string
  ): AsyncGenerator<StreamEvent> {
    const msg = this.db.addMessage({
      threadId,
      parentId,
      role: "assistant",
      author: {
        kind: "system",
        modelName: `SYMFORYX · ${label}`,
        badgeColor: "#6D5EF6",
        badgeLetter: "S",
      },
      parts: [{ type: "text", text }],
    });
    yield { type: "message_done", message: msg };
  }

  private findLastCodeBlock(threadId: string, allowedLangs?: string[]) {
    const msgs = this.db.listMessages(threadId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const text = msgs[i].parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const blocks = extractCodeBlocks(text);
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (!allowedLangs || allowedLangs.includes(blocks[j].language)) {
          return blocks[j];
        }
      }
    }
    return null;
  }

  // ==================== HANDOFF ("Gönder ▸") ====================

  async *handleHandoff(opts: {
    threadId: string;
    sourceMessageId: string;
    targetProviderId: string;
    targetModelId: string;
    instruction: string;
  }): AsyncGenerator<StreamEvent> {
    const source = this.db.getMessage(opts.sourceMessageId);
    if (!source) {
      yield { type: "error", code: "invalid_request", message: "Kaynak mesaj bulunamadı." };
      return;
    }
    const allMsgs = this.db.listMessages(opts.threadId);
    const parentUser = source.parentId ? allMsgs.find((m) => m.id === source.parentId) : undefined;
    const originalPrompt = parentUser?.parts.find((p) => p.type === "text")?.text;

    const targetProv = this.db.getProvider(opts.targetProviderId);
    const targetModel = targetProv?.models.find((m) => m.id === opts.targetModelId);
    const targetSupportsVision = Boolean(targetModel?.capabilities.includes("vision"));

    const transfer = buildTransferPrompt({
      sourceMessage: source,
      originalUserPrompt: originalPrompt,
      instruction: opts.instruction,
      targetSupportsVision,
    });

    const attachments = transfer.artifactIds
      .map((id) => this.db.getArtifact(id))
      .filter((a): a is Artifact => Boolean(a))
      .map((a) => ({
        artifactId: a.id,
        kind: (a.kind === "image" ? "image" : "file") as "image" | "file",
        mime: a.mime,
        name: a.title,
      }));

    yield* this.handleChat({
      threadId: opts.threadId,
      message: opts.instruction,
      mode: "manual",
      modelOverride: { providerId: opts.targetProviderId, modelId: opts.targetModelId },
      attachments,
      parentId: source.id,
      transferNote: {
        fromMessageId: source.id,
        fromAuthor: source.author.modelName ?? source.author.providerId ?? "Model",
        originalPrompt,
        visionConverted: transfer.visionConverted,
      },
    });
  }

  // ==================== FLOWS EXECUTION ====================

  async startFlowRun(
    flowId: string,
    inputs: Record<string, unknown>,
    projectId: string,
    threadId?: string,
    stepModelOverrides?: Record<string, { providerId: string; modelId: string }>
  ): Promise<FlowRun> {
    const flow = this.db.getFlow(flowId);
    if (!flow) throw new SymError("invalid_request", `Akış bulunamadı: ${flowId}`);
    return this.flowEngine.execute(flow, {
      inputs,
      stepModelOverrides,
      projectId,
      threadId,
      executor: this.makeFlowExecutor(projectId, threadId),
    });
  }

  async resumeFlowRun(
    runId: string,
    decision: { approved: boolean; feedback?: string }
  ): Promise<FlowRun> {
    const existing = this.db.getFlowRun(runId);
    if (!existing) throw new SymError("invalid_request", `Akış çalıştırması bulunamadı: ${runId}`);
    const flow = this.db.getFlow(existing.flowId);
    if (!flow) throw new SymError("invalid_request", `Akış tanımı bulunamadı: ${existing.flowId}`);
    return this.flowEngine.execute(flow, {
      existingRun: existing,
      projectId: existing.projectId,
      threadId: existing.threadId,
      approvalDecision: decision,
      executor: this.makeFlowExecutor(existing.projectId, existing.threadId),
    });
  }

  private makeFlowExecutor(projectId: string, threadId?: string) {
    const resolver = this.makePermissionResolver(threadId, projectId);
    return {
      runModelStep: async (opts: {
        stepId: string;
        use: string;
        prompt: string;
        attachArtifactIds: string[];
        modelOverride?: { providerId: string; modelId: string };
        projectId: string;
        threadId?: string;
        signal?: AbortSignal;
      }) => {
        const roles = this.db.listRoles(opts.projectId);
        const providers = this.db.listProviders();
        const roleId = opts.use.startsWith("role:") ? opts.use.slice(5) : "genel";
        const role = roles.find((r) => r.id === roleId) ?? roles[0];
        const target = opts.modelOverride
          ? resolveProviderModel(opts.modelOverride.providerId, opts.modelOverride.modelId, providers)
          : resolveProviderModel(role?.primaryProviderId ?? "demo", role?.primaryModelId, providers);

        const chosenModelObj = providers
          .find((p) => p.id === target.providerId)
          ?.models.find((m) => m.id === target.modelId);
        const isImg =
          roleId === "gorsel-uretim" ||
          roleId === "gorsel-duzenleme" ||
          Boolean(chosenModelObj?.capabilities.includes("image.generate") && !chosenModelObj?.capabilities.includes("chat"));

        if (isImg) {
          const pCfg = this.db.getProvider(target.providerId);
          const adapter = this.providers.get(target.providerId, pCfg ?? undefined);
          const apiKey = this.db.getDecryptedProviderKey(target.providerId);
          const img = adapter.generateImage
            ? await adapter.generateImage(
                { modelId: target.modelId, prompt: opts.prompt, apiKey, baseUrl: pCfg?.baseUrl },
                opts.signal ?? new AbortController().signal
              )
            : await this.providers
                .get("demo")
                .generateImage!({ prompt: opts.prompt }, new AbortController().signal);
          const art = this.db.createArtifact({
            threadId: opts.threadId ?? "thr_flow",
            projectId: opts.projectId,
            kind: "image",
            title: `Akış Görseli: ${opts.prompt.slice(0, 32)}`,
            mime: img.mime,
            content: img.base64,
          });
          return { text: `Görsel üretildi (${art.id})`, artifactIds: [art.id], costUsd: img.costUsd };
        }

        return await this.runHeadlessModelCall({
          providerId: target.providerId,
          modelId: target.modelId,
          prompt: opts.prompt,
          projectId: opts.projectId,
          threadId: opts.threadId,
          signal: opts.signal,
        });
      },
      runToolStep: async (opts: {
        toolId: string;
        input: unknown;
        projectId: string;
        threadId?: string;
        signal?: AbortSignal;
      }) => {
        const res = await this.toolRuntime.invoke({
          toolId: opts.toolId,
          manifest: this.db.getTool(opts.toolId) ?? undefined,
          args: opts.input,
          projectId: opts.projectId,
          threadId: opts.threadId,
          resolver,
          signal: opts.signal,
          skipApprovalCheck: true,
        });
        return {
          text: res.text ?? "",
          json: res.json,
          artifactIds: res.artifactIds ?? [],
          costUsd: 0,
        };
      },
      onUpdate: (run: FlowRun) => {
        this.db.saveFlowRun(run);
      },
      onEvent: (eventName: string, payload: Record<string, unknown>) => {
        this.emitWebhook(eventName, payload);
      },
    };
  }

  async runHeadlessModelCall(opts: {
    providerId: string;
    modelId: string;
    prompt: string;
    projectId: string;
    threadId?: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; costUsd: number; artifactIds: string[] }> {
    const pCfg = this.db.getProvider(opts.providerId);
    const adapter = this.providers.get(opts.providerId, pCfg ?? undefined);
    const apiKey = this.db.getDecryptedProviderKey(opts.providerId);
    const ac = opts.signal ?? new AbortController().signal;
    const start = Date.now();
    let text = "";
    let inTok = estimateTokens(opts.prompt);
    let outTok = 0;

    for await (const chunk of this.providers.streamWithRetry(
      adapter,
      {
        modelId: opts.modelId,
        messages: [
          {
            id: "flow_msg",
            threadId: opts.threadId ?? "thr_flow",
            parentId: null,
            role: "user",
            author: { kind: "user" },
            parts: [{ type: "text", text: opts.prompt }],
            createdAt: new Date().toISOString(),
          },
        ],
        apiKey,
        baseUrl: pCfg?.baseUrl,
      },
      ac
    )) {
      if (chunk.type === "text") text += chunk.text;
      else if (chunk.type === "usage") {
        inTok = chunk.inputTokens;
        outTok = chunk.outputTokens;
      }
    }

    const cost = adapter.estimateCost({
      modelId: opts.modelId,
      inputTokens: inTok,
      outputTokens: outTok || estimateTokens(text),
    }).estimatedCostUsd;

    const artifactIds: string[] = [];
    for (const block of extractCodeBlocks(text)) {
      if (block.language === "html" || block.content.split("\n").length >= 8) {
        const art = this.db.createArtifact({
          threadId: opts.threadId ?? "thr_flow",
          projectId: opts.projectId,
          kind: block.language === "html" ? "preview" : "code",
          title: block.filename || (block.language === "html" ? "Akış Önizleme" : `Kod (${block.language})`),
          mime: block.language === "html" ? "text/html" : "text/plain",
          language: block.language,
          content: block.content,
        });
        artifactIds.push(art.id);
      }
    }

    this.db.recordUsage({
      workspaceId: "ws_default",
      projectId: opts.projectId,
      threadId: opts.threadId,
      providerId: opts.providerId,
      modelId: opts.modelId,
      inputTokens: inTok,
      outputTokens: outTok || estimateTokens(text),
      costUsd: cost,
      latencyMs: Date.now() - start,
    });

    return { text, costUsd: cost, artifactIds };
  }
}
