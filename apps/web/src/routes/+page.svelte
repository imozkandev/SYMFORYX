<script lang="ts">
  import { onMount } from "svelte";
  import type {
    Artifact,
    Budget,
    FlowDefinition,
    LanguageCode,
    Project,
    ProviderConfig,
    QuotaStatus,
    ReferenceItem,
    ReferenceRole,
    SymMessage,
    TaskRole,
    Thread,
    ToolManifest,
    UserSettings,
    WorkMode,
  } from "@symforyx/core";
  import { DEFAULT_USER_SETTINGS } from "@symforyx/core";
  import { api, type BootstrapPayload } from "$lib/api";
  import { applyTheme } from "$lib/dom";
  import { formatCountdown, tr } from "$lib/i18n";
  import Composer from "$lib/components/Composer.svelte";
  import MessageCard from "$lib/components/MessageCard.svelte";
  import ArtifactPanel from "$lib/components/ArtifactPanel.svelte";
  import Modals from "$lib/components/Modals.svelte";
  import {
    Brain,
    Command,
    Download,
    FolderPlus,
    Gauge,
    Menu,
    MessageSquarePlus,
    Monitor,
    Moon,
    PanelRight,
    Settings,
    Sun,
    Trash2,
    Workflow,
    Wrench,
  } from "lucide-svelte";

  let loading = $state(true);
  let projects = $state<Project[]>([]);
  let threads = $state<Thread[]>([]);
  let providers = $state<ProviderConfig[]>([]);
  let roles = $state<TaskRole[]>([]);
  let tools = $state<ToolManifest[]>([]);
  let flows = $state<FlowDefinition[]>([]);
  let settings = $state<UserSettings>({ ...DEFAULT_USER_SETTINGS });
  let usage = $state<BootstrapPayload["usage"]>({
    period: "monthly",
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    byProvider: [],
    byModel: [],
    byProject: [],
    topThreads: [],
  });
  let budgets = $state<Budget[]>([]);
  let quotas = $state<QuotaStatus[]>([]);
  let optimization = $state({ savedTokens: 0, savedCostUsd: 0, cacheHits: 0, slopItemsBlocked: 0 });
  let commands = $state<BootstrapPayload["commands"]>([]);
  let shortcuts = $state<BootstrapPayload["shortcuts"]>([]);

  let activeProjectId = $state("proj_default");
  let activeThreadId = $state<string | null>(null);
  let messages = $state<SymMessage[]>([]);
  let artifacts = $state<Artifact[]>([]);

  let sidebarOpen = $state(true);
  let artifactPanelOpen = $state(false);
  let selectedArtifactId = $state<string | null>(null);
  let activeModal = $state<"none" | "command" | "settings" | "flows" | "tools" | "quotas">("none");
  let settingsTab = $state<
    "general" | "appearance" | "providers" | "roles" | "memory" | "usage" | "shortcuts" | "about"
  >("providers");

  let draft = $state("");
  let mode = $state<WorkMode>("smart");
  let selectedModel = $state<{ providerId: string; modelId: string; label: string } | null>(null);
  let enabledToolIds = $state<string[]>(["web-search", "code-sandbox", "live-preview", "dev.ozkandev.renk-paleti"]);
  let attachments = $state<Array<{ artifactId: string; kind: "image" | "file"; mime: string; name: string }>>([]);
  let references = $state<ReferenceItem[]>([]);
  let isStreaming = $state(false);
  let streamError = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let contextStats = $state({
    fillPercent: 4,
    pinnedCount: 0,
    summaryCount: 0,
    usedTokens: 0,
    remainingTokens: 128000,
    contextWindow: 128000,
    savedTokens: 0,
  });

  // Live Outgoing & Remaining Tokens for Navbar Display
  const outgoingTokens = $derived(
    messages.reduce((s, m) => s + (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0), 0)
  );
  const activeContextWindow = $derived.by(() => {
    if (selectedModel) {
      const p = providers.find((x) => x.id === selectedModel?.providerId);
      const m = p?.models.find((x) => x.id === selectedModel?.modelId);
      if (m?.contextWindow) return m.contextWindow;
    }
    return contextStats.contextWindow || 128000;
  });
  const remainingTokens = $derived(
    Math.max(0, activeContextWindow - (contextStats.usedTokens || outgoingTokens))
  );
  function fmtTok(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  let chatScrollEl: HTMLDivElement | undefined = $state();

  const lang = $derived<LanguageCode>(settings.language || "tr");
  const activeProject = $derived(projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null);
  const projectThreads = $derived(threads.filter((t) => t.projectId === activeProjectId));
  const activeThread = $derived(threads.find((t) => t.id === activeThreadId) ?? null);

  // Highlighted top quotas for workbench telemetry strip
  const topQuotas = $derived(
    quotas.filter((q) => ["anthropic", "openai", "google", "fal", "web-search"].includes(q.targetId)).slice(0, 4)
  );

  // Per-prompt cost map + total thread cost (shows cost of EVERY prompt turn!)
  const threadCostUsd = $derived(
    messages.reduce((sum, m) => sum + (m.usage?.costUsd ?? 0), 0)
  );

  const promptCostMap = $derived.by(() => {
    const map: Record<string, { costUsd: number; tokens: number; calls: number }> = {};
    for (const m of messages) {
      if (m.role !== "user" && m.parentId) {
        const prev = map[m.parentId] ?? { costUsd: 0, tokens: 0, calls: 0 };
        prev.costUsd += m.usage?.costUsd ?? 0;
        prev.tokens += (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0);
        prev.calls += 1;
        map[m.parentId] = prev;
      }
    }
    return map;
  });

  const displayBlocks = $derived.by(() => {
    const out: Array<
      | { kind: "single"; message: SymMessage }
      | { kind: "compare"; groupId: string; items: SymMessage[] }
    > = [];
    const seen = new Set<string>();
    for (const m of messages) {
      if (m.compareGroupId) {
        if (!seen.has(m.compareGroupId)) {
          seen.add(m.compareGroupId);
          out.push({ kind: "compare", groupId: m.compareGroupId, items: messages.filter((x) => x.compareGroupId === m.compareGroupId) });
        }
      } else {
        out.push({ kind: "single", message: m });
      }
    }
    return out;
  });

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => { if (toast === msg) toast = null; }, 2800);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { if (chatScrollEl) chatScrollEl.scrollTop = chatScrollEl.scrollHeight; });
  }

  async function refreshBootstrap() {
    const data = await api.bootstrap();
    projects = data.projects;
    threads = data.threads;
    providers = data.providers;
    roles = data.roles;
    tools = data.tools;
    flows = data.flows;
    settings = data.settings;
    usage = data.usage;
    budgets = data.budgets;
    quotas = data.quotas ?? [];
    optimization = {
      savedTokens: data.optimization?.savedTokens ?? 0,
      savedCostUsd: data.optimization?.savedCostUsd ?? 0,
      cacheHits: data.optimization?.cacheHits ?? 0,
      slopItemsBlocked: data.optimization?.slopItemsBlocked ?? 0,
    };
    commands = data.commands;
    shortcuts = data.shortcuts;
    applyTheme(settings.theme);
  }

  async function updateSettings(patch: Partial<UserSettings>) {
    const res = await api.updateSettings(patch);
    settings = res.settings;
    applyTheme(settings.theme);
  }

  async function selectThread(id: string) {
    if (activeThreadId && draft !== (activeThread?.draftText ?? "")) {
      api.updateThread(activeThreadId, { draftText: draft }).catch(() => {});
    }
    activeThreadId = id;
    const res = await api.getThread(id);
    messages = res.messages;
    artifacts = res.artifacts;
    references = res.references ?? [];
    mode = res.thread.mode || settings.defaultMode;
    draft = res.thread.draftText || "";
    selectedModel =
      res.thread.pinnedProviderId && res.thread.pinnedModelId
        ? { providerId: res.thread.pinnedProviderId, modelId: res.thread.pinnedModelId, label: res.thread.pinnedModelId }
        : null;
    if (artifacts.length > 0) {
      selectedArtifactId = artifacts[0].id;
      artifactPanelOpen = true;
    } else {
      selectedArtifactId = null;
      artifactPanelOpen = false;
    }
    contextStats = { ...contextStats, pinnedCount: messages.filter((m) => m.pinned).length };
    scrollToBottom();
  }

  async function createNewChat() {
    const res = await api.createThread({
      projectId: activeProjectId,
      title: lang === "en" ? "New Thread" : "Yeni Sohbet",
      mode: settings.defaultMode,
    });
    if (!projects.some((p) => p.id === res.thread.projectId)) {
      await refreshBootstrap();
    }
    activeProjectId = res.thread.projectId;
    threads = [res.thread, ...threads.filter((t) => t.id !== res.thread.id)];
    await selectThread(res.thread.id);
  }

  async function createNewProject() {
    const name = prompt(lang === "en" ? "Workspace name:" : "Yeni çalışma alanı adı:");
    if (!name?.trim()) return;
    const res = await api.createProject({ name: name.trim() });
    projects = [res.project, ...projects];
    threads = [res.thread, ...threads];
    activeProjectId = res.project.id;
    await selectThread(res.thread.id);
  }

  async function deleteActiveProject() {
    const target = activeProject;
    if (!target) return;
    const confirmed = confirm(`"${target.name}" — ${tr(lang, "deleteProjectConfirm")}`);
    if (!confirmed) return;
    const res = await api.deleteProject(target.id);
    if (!res.ok) return;
    projects = res.projects;
    threads = res.threads;
    showToast(`${tr(lang, "projectDeleted")}: ${target.name}`);
    if (projects.length > 0) {
      activeProjectId = projects[0].id;
      const nextThread = threads.find((t) => t.projectId === activeProjectId);
      if (nextThread) {
        await selectThread(nextThread.id);
      } else {
        activeThreadId = null;
        messages = [];
        artifacts = [];
        references = [];
      }
    } else {
      activeProjectId = "";
      activeThreadId = null;
      messages = [];
      artifacts = [];
      references = [];
    }
  }

  async function sendMessage(text: string, opts?: { parentId?: string | null }) {
    if (!activeThreadId) await createNewChat();
    if (!activeThreadId) return;

    streamError = null;
    isStreaming = true;
    const sentAttachments = [...attachments];
    const sentReferences = [...references];
    attachments = [];

    try {
      await api.streamEndpoint(
        "/api/v1/chat",
        {
          threadId: activeThreadId,
          message: text,
          mode,
          modelOverride: selectedModel
            ? { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
            : null,
          attachments: sentAttachments,
          references: sentReferences,
          enabledTools: enabledToolIds,
          parentId: opts?.parentId,
        },
        handleStreamEvent
      );
      await refreshBootstrap();
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    } finally {
      isStreaming = false;
      scrollToBottom();
    }
  }

  async function handleHandoff(msg: SymMessage, targetProviderId: string, targetModelId: string, instruction: string) {
    if (!activeThreadId) return;
    streamError = null;
    isStreaming = true;
    try {
      await api.streamEndpoint(
        "/api/v1/handoff",
        { threadId: activeThreadId, sourceMessageId: msg.id, targetProviderId, targetModelId, instruction },
        handleStreamEvent
      );
      await refreshBootstrap();
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    } finally {
      isStreaming = false;
      scrollToBottom();
    }
  }

  function handleStreamEvent(ev: { type: string; [k: string]: any }) {
    if (ev.type === "user_message" && ev.message) {
      messages = [...messages, ev.message];
      scrollToBottom();
    } else if (ev.type === "context_stats" && ev.stats) {
      contextStats = ev.stats;
    } else if (ev.type === "budget_warning") {
      showToast(lang === "en" ? "Budget warning threshold reached" : "Bütçe uyarı eşiğine ulaşıldı");
    } else if (ev.type === "message_start" && ev.message) {
      messages = [...messages, ev.message];
      scrollToBottom();
    } else if (ev.type === "delta" && ev.messageId) {
      messages = messages.map((m) => {
        if (m.id !== ev.messageId) return m;
        const parts = [...m.parts];
        const lastIdx = parts.length - 1;
        if (lastIdx >= 0 && parts[lastIdx].type === "text") {
          parts[lastIdx] = { type: "text", text: parts[lastIdx].text + ev.text };
        } else {
          parts.push({ type: "text", text: ev.text });
        }
        return { ...m, parts };
      });
      scrollToBottom();
    } else if (ev.type === "artifact_created" && ev.artifact) {
      artifacts = [ev.artifact, ...artifacts.filter((a) => a.id !== ev.artifact.id)];
      selectedArtifactId = ev.artifact.id;
      artifactPanelOpen = true;
    } else if (ev.type === "reference_added" && ev.references) {
      references = ev.references;
      showToast(lang === "en" ? `Reference added: ${ev.reference?.title}` : `Referans eklendi: ${ev.reference?.title}`);
    } else if (ev.type === "references_cleared") {
      references = [];
    } else if (ev.type === "message_done" && ev.message) {
      const exists = messages.some((m) => m.id === ev.message.id);
      messages = exists ? messages.map((m) => (m.id === ev.message.id ? ev.message : m)) : [...messages, ev.message];
      scrollToBottom();
    } else if (ev.type === "error") {
      streamError = ev.message;
    }
  }

  async function handleAddReferenceImage(file: File, role: ReferenceRole) {
    if (!activeThreadId) await createNewChat();
    if (!activeThreadId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = String(reader.result || "").split(",")[1] || "";
      const res = await api.createArtifact({
        threadId: activeThreadId!,
        projectId: activeProjectId,
        kind: "image",
        title: file.name,
        mime: file.type || "image/png",
        content: b64,
      });
      artifacts = [res.artifact, ...artifacts];
      references = [
        ...references,
        {
          id: `ref_${Date.now()}`,
          kind: "image",
          role,
          title: file.name,
          artifactId: res.artifact.id,
          mime: file.type || "image/png",
        },
      ];
      showToast(lang === "en" ? `Reference image added: ${file.name}` : `Referans görsel eklendi: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  function addExistingArtifactAsRef(artId: string) {
    const art = artifacts.find((a) => a.id === artId);
    if (!art) return;
    if (references.some((r) => r.artifactId === artId)) return;
    references = [
      ...references,
      {
        id: `ref_${Date.now()}`,
        kind: "image",
        role: "style",
        title: art.title,
        artifactId: art.id,
        mime: art.mime,
      },
    ];
    showToast(lang === "en" ? "Added to reference tray" : "Referans tepsisine eklendi");
  }

  async function handleAttachFile(file: File) {
    if (!activeThreadId) await createNewChat();
    if (!activeThreadId) return;
    if (file.type.startsWith("image/")) {
      await handleAddReferenceImage(file, "style");
      return;
    }
    const text = await file.text();
    const res = await api.createArtifact({
      threadId: activeThreadId,
      projectId: activeProjectId,
      kind: "file",
      title: file.name,
      mime: file.type || "text/plain",
      content: text.slice(0, 60000),
    });
    await api.uploadFile(activeProjectId, {
      name: file.name,
      mime: file.type || "text/plain",
      size: file.size,
      contentText: text.slice(0, 60000),
    });
    artifacts = [res.artifact, ...artifacts];
    attachments = [...attachments, { artifactId: res.artifact.id, kind: "file", mime: file.type || "text/plain", name: file.name }];
  }

  function handleSendArtifactToCode(art: Artifact) {
    const sourceMsg = messages.find((m) => m.artifacts?.includes(art.id));
    const chosen = selectedModel && !selectedModel.modelId.includes("image")
      ? selectedModel
      : (() => {
          const claude = providers.find((p) => p.id === "anthropic" && p.hasKey);
          return { providerId: claude ? "anthropic" : "demo", modelId: claude?.models[0]?.id ?? "demo-claude" };
        })();
    if (sourceMsg) {
      void handleHandoff(sourceMsg, chosen.providerId, chosen.modelId, "Bu tasarımı HTML ve Tailwind ile kodla.");
    } else {
      addExistingArtifactAsRef(art.id);
      void sendMessage("Ekli referans görseli temiz HTML ve Tailwind ile kodla.");
    }
  }

  async function handleRunCodeArtifact(art: Artifact) {
    const ver = art.versions[art.currentVersion - 1] ?? art.versions.at(-1);
    if (!ver) return;
    await api.invokeTool("code-sandbox", { language: art.language || "javascript", code: ver.content }, activeProjectId, activeThreadId ?? undefined);
    await sendMessage(`/calistir`);
  }

  onMount(() => {
    const init = async () => {
      await refreshBootstrap();
      if (projects.length > 0) activeProjectId = projects[0].id;
      const first = threads.find((t) => t.projectId === activeProjectId) ?? threads[0];
      if (first) await selectThread(first.id);
      loading = false;
    };
    void init();

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); activeModal = activeModal === "command" ? "none" : "command"; }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); void createNewProject(); }
      else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void createNewChat(); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); sidebarOpen = !sidebarOpen; }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); artifactPanelOpen = !artifactPanelOpen; }
      else if (mod && e.key === "/") { e.preventDefault(); settingsTab = "shortcuts"; activeModal = "settings"; }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "color-scheme") {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        if (meta) meta.content = e.newValue ?? "light dark";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("storage", onStorage);
    };
  });
</script>

<div class="flex h-screen w-screen overflow-hidden bg-[var(--sym-bg)] text-[var(--sym-text)]">
  <!-- LEFT SIDEBAR -->
  {#if sidebarOpen}
    <aside aria-label="Sidebar" class="flex w-60 shrink-0 flex-col border-r border-[var(--sym-border)] bg-[var(--sym-surface)]">
      <div class="flex items-center justify-between border-b border-[var(--sym-border)] px-3 py-2.5">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 64 64" class="h-6 w-6 shrink-0" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="60" height="60" rx="15" fill="var(--sym-text)" />
            <line x1="12" y1="27" x2="12" y2="37" stroke="var(--sym-bg)" stroke-opacity="0.34" stroke-width="2.4" stroke-linecap="round" />
            <line x1="52" y1="27" x2="52" y2="37" stroke="var(--sym-bg)" stroke-opacity="0.34" stroke-width="2.4" stroke-linecap="round" />
            <path d="M44.5 21C43.6 16.2 38.6 14 32 14C24.2 14 19.5 17.2 19.5 22C19.5 26.2 23.1 28.4 27.6 30" stroke="var(--sym-bg)" stroke-width="4.6" stroke-linecap="round" />
            <path d="M19.5 43C20.4 47.8 25.4 50 32 50C39.8 50 44.5 46.8 44.5 42C44.5 37.8 40.9 35.6 36.4 34" stroke="var(--sym-bg)" stroke-width="4.6" stroke-linecap="round" />
            <circle cx="32" cy="32" r="4" fill="#3B82F6" />
          </svg>
          <span class="text-xs font-bold tracking-[0.14em]">SYMFORYX</span>
        </div>
        <button
          type="button"
          onclick={createNewChat}
          title={tr(lang, "newChat")}
          class="rounded border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-1 text-[var(--sym-text)] hover:border-[var(--sym-primary)]"
        >
          <MessageSquarePlus class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="border-b border-[var(--sym-border)] px-2.5 py-2">
        <div class="flex items-center gap-1">
          {#if projects.length > 0}
            <select
              aria-label="Workspace"
              value={activeProjectId}
              onchange={async (e) => {
                activeProjectId = (e.target as HTMLSelectElement).value;
                const next = threads.find((t) => t.projectId === activeProjectId);
                if (next) await selectThread(next.id);
                else await createNewChat();
              }}
              class="min-w-0 flex-1 truncate rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs font-medium outline-none"
            >
              {#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          {:else}
            <button
              type="button"
              onclick={createNewProject}
              class="flex-1 truncate rounded border border-dashed border-[var(--sym-border-strong)] bg-[var(--sym-card)] px-2 py-1 text-left text-xs text-[var(--sym-text-muted)] hover:border-[var(--sym-primary)] hover:text-[var(--sym-text)]"
            >
              + {tr(lang, "newProject")}
            </button>
          {/if}
          <button
            type="button"
            onclick={createNewProject}
            title={tr(lang, "newProject")}
            class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] p-1 text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]"
          >
            <FolderPlus class="h-3.5 w-3.5" />
          </button>
          {#if activeProject}
            <button
              type="button"
              onclick={deleteActiveProject}
              title={tr(lang, "deleteProject")}
              aria-label={tr(lang, "deleteProject")}
              class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] p-1 text-[var(--sym-text-muted)] hover:border-[var(--sym-error)] hover:text-[var(--sym-error)]"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <div class="px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
          {tr(lang, "threads")}
        </div>
        {#each projectThreads as th (th.id)}
          <div
            class="group flex items-center justify-between rounded px-2 py-1.5 text-xs {th.id === activeThreadId
              ? 'bg-[var(--sym-card)] font-semibold border border-[var(--sym-border)]'
              : 'hover:bg-[var(--sym-surface-2)] text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]'}"
          >
            <button type="button" onclick={() => selectThread(th.id)} class="min-w-0 flex-1 truncate text-left">
              {th.title}
            </button>
            <button
              type="button"
              onclick={async () => {
                await api.deleteThread(th.id);
                threads = threads.filter((x) => x.id !== th.id);
                if (activeThreadId === th.id) {
                  if (threads[0]) await selectThread(threads[0].id);
                  else await createNewChat();
                }
              }}
              aria-label="Delete"
              class="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]"
            >
              <Trash2 class="h-3 w-3" />
            </button>
          </div>
        {/each}
      </div>

      <!-- Compact Navigation & Live Cost -->
      <div class="border-t border-[var(--sym-border)] p-2 space-y-0.5 text-xs">
        <button type="button" onclick={() => (activeModal = "quotas")} class="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-[var(--sym-surface-2)]">
          <span class="flex items-center gap-2"><Gauge class="h-3.5 w-3.5 text-[var(--sym-primary)]" /> {tr(lang, "quotas")}</span>
          <span class="font-mono text-[11px] text-[var(--sym-text-muted)] tabular-nums">${usage.totalCostUsd.toFixed(3)}</span>
        </button>
        <button type="button" onclick={() => (activeModal = "flows")} class="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-[var(--sym-surface-2)]">
          <span class="flex items-center gap-2"><Workflow class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" /> {tr(lang, "flows")}</span>
          <span class="font-mono text-[10px] text-[var(--sym-text-muted)]">{flows.length}</span>
        </button>
        <button type="button" onclick={() => (activeModal = "tools")} class="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--sym-surface-2)]">
          <Wrench class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" /> {tr(lang, "tools")}
        </button>
        <button type="button" onclick={() => { settingsTab = "memory"; activeModal = "settings"; }} class="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--sym-surface-2)]">
          <Brain class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" /> {tr(lang, "memory")}
        </button>
        <button type="button" onclick={() => { settingsTab = "providers"; activeModal = "settings"; }} class="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--sym-surface-2)]">
          <Settings class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" /> {tr(lang, "settings")}
        </button>
      </div>

      <div class="border-t border-[var(--sym-border)] px-3 py-2 font-mono text-[10px] text-[var(--sym-text-muted)]">
        SYMFORYX · by ozkandev
      </div>
    </aside>
  {/if}

  <!-- CENTER WORKSPACE -->
  <main class="flex min-w-0 flex-1 flex-col">
    <!-- Precision Top Bar with 1-Click TR/EN + Light/Dark/System + Live Quotas -->
    <header class="flex items-center justify-between gap-2 border-b border-[var(--sym-border)] bg-[var(--sym-card)] px-3.5 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <button type="button" onclick={() => (sidebarOpen = !sidebarOpen)} aria-label="Sidebar" class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
          <Menu class="h-4 w-4" />
        </button>
        <h1 class="truncate text-xs font-bold">{activeThread?.title || "SYMFORYX"}</h1>
        <span class="hidden sm:inline font-mono text-[10px] text-[var(--sym-text-muted)]">/ {activeProject?.name || "Workspace"}</span>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- Navbar Live Outgoing Tokens, Remaining Tokens & Token Optimizer Pill -->
        <div
          class="hidden lg:inline-flex items-center gap-2 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 font-mono text-[11px] tabular-nums"
          title={lang === "en" ? "Outgoing tokens / Remaining context tokens / Optimizer savings" : "Giden token / Kalan bağlam tokenı / Token optimizasyonu tasarrufu"}
        >
          <span class="text-[var(--sym-text-muted)]">
            {lang === "en" ? "Out" : "Giden"}:
            <strong class="text-[var(--sym-text)]">{fmtTok(outgoingTokens)}</strong>
          </span>
          <span class="text-[var(--sym-border-strong)]">|</span>
          <span class="text-[var(--sym-text-muted)]">
            {lang === "en" ? "Left" : "Kalan"}:
            <strong class="text-[var(--sym-primary)]">{fmtTok(remainingTokens)}</strong>
          </span>
          <span class="text-[var(--sym-border-strong)]">|</span>
          <button
            type="button"
            onclick={() => updateSettings({ tokenOptimizationEnabled: !(settings.tokenOptimizationEnabled !== false) })}
            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold {settings.tokenOptimizationEnabled !== false
              ? 'bg-[var(--sym-success)]/15 text-[var(--sym-success)]'
              : 'bg-[var(--sym-surface-2)] text-[var(--sym-text-muted)]'}"
            title={lang === "en" ? "Toggle Token & Cost Optimization" : "Token & Maliyet Optimizasyonunu Aç/Kapat"}
          >
            OPT {settings.tokenOptimizationEnabled !== false ? "ON" : "OFF"}
            {#if optimization.savedTokens > 0}
              <span>(-{fmtTok(optimization.savedTokens)})</span>
            {/if}
          </button>
          <span class="text-[var(--sym-border-strong)]">|</span>
          <button
            type="button"
            onclick={async () => {
              const next = !(settings.aiSlopBlockerEnabled !== false);
              await updateSettings({ aiSlopBlockerEnabled: next });
              showToast(next ? (lang === "en" ? "AI Slop Blocker ON — strict craft mode" : "AI Slop Blocker AÇIK — rafine stüdyo modu") : (lang === "en" ? "AI Slop Blocker OFF" : "AI Slop Blocker KAPALI"));
            }}
            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold {settings.aiSlopBlockerEnabled !== false
              ? 'bg-[var(--sym-primary-soft)] text-[var(--sym-primary)]'
              : 'bg-[var(--sym-surface-2)] text-[var(--sym-text-muted)]'}"
            title={lang === "en" ? "AI Slop Blocker: blocks cliché prose, sycophancy, and AI-slop UI gradients" : "AI Slop Blocker: klişe metinleri, yağcılığı ve AI-slop arayüz kalıplarını engeller"}
          >
            ANTI-SLOP {settings.aiSlopBlockerEnabled !== false ? "ON" : "OFF"}
          </button>
        </div>

        <!-- 1-Click Live Thread Cost & Global Quotas -->
        <button
          type="button"
          onclick={() => (activeModal = "quotas")}
          class="hidden md:inline-flex items-center gap-1.5 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 font-mono text-[11px] hover:border-[var(--sym-primary)] tabular-nums"
          title={lang === "en" ? "Thread cost / Monthly total" : "Bu sohbet maliyeti / Aylık toplam"}
        >
          <Gauge class="h-3.5 w-3.5 text-[var(--sym-primary)]" />
          <span>${threadCostUsd.toFixed(4)}</span>
          <span class="text-[var(--sym-text-muted)]">/ ${usage.totalCostUsd.toFixed(3)}</span>
        </button>

        {#if activeThreadId && messages.length > 0}
          <button
            type="button"
            onclick={async () => {
              if (!activeThreadId) return;
              const res = await api.saveThreadAsFlow(activeThreadId);
              await refreshBootstrap();
              showToast(lang === "en" ? `Saved as schema: ${res.flow.name}` : `Şema olarak kaydedildi: ${res.flow.name}`);
            }}
            class="hidden lg:inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-1 text-[11px] font-medium hover:border-[var(--sym-primary)]"
          >
            <Workflow class="h-3 w-3" /> {lang === "en" ? "Save Schema" : "Şema Kaydet"}
          </button>
        {/if}

        <!-- Instant TR / EN Switcher -->
        <div class="inline-flex rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] p-0.5 font-mono text-[10px]">
          <button
            type="button"
            onclick={() => updateSettings({ language: "tr" })}
            class="rounded px-1.5 py-0.5 {lang === 'tr' ? 'bg-[var(--sym-card)] font-bold text-[var(--sym-text)] shadow-xs' : 'text-[var(--sym-text-muted)]'}"
          >
            TR
          </button>
          <button
            type="button"
            onclick={() => updateSettings({ language: "en" })}
            class="rounded px-1.5 py-0.5 {lang === 'en' ? 'bg-[var(--sym-card)] font-bold text-[var(--sym-text)] shadow-xs' : 'text-[var(--sym-text-muted)]'}"
          >
            EN
          </button>
        </div>

        <!-- Instant Light / Dark / System Switcher -->
        <div class="inline-flex rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] p-0.5">
          <button
            type="button"
            title={tr(lang, "themeLight")}
            onclick={() => updateSettings({ theme: "light" })}
            class="rounded p-1 {settings.theme === 'light' ? 'bg-[var(--sym-card)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}"
          >
            <Sun class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={tr(lang, "themeDark")}
            onclick={() => updateSettings({ theme: "dark" })}
            class="rounded p-1 {settings.theme === 'dark' ? 'bg-[var(--sym-card)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}"
          >
            <Moon class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={tr(lang, "themeSystem")}
            onclick={() => updateSettings({ theme: "system" })}
            class="rounded p-1 {settings.theme === 'system' ? 'bg-[var(--sym-card)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}"
          >
            <Monitor class="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onclick={() => (activeModal = "command")}
          title="⌘K"
          class="hidden sm:inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-1 font-mono text-[11px] text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]"
        >
          <Command class="h-3 w-3" /> K
        </button>

        {#if activeThreadId}
          <a href={`/api/v1/threads/${activeThreadId}/export?format=md`} title="Export Markdown" class="rounded border border-[var(--sym-border)] p-1 text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]">
            <Download class="h-3.5 w-3.5" />
          </a>
        {/if}

        <button
          type="button"
          onclick={() => (artifactPanelOpen = !artifactPanelOpen)}
          aria-label={tr(lang, "artifacts")}
          class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs {artifactPanelOpen
            ? 'border-[var(--sym-primary)] bg-[var(--sym-primary-soft)] text-[var(--sym-primary)]'
            : 'border-[var(--sym-border)] text-[var(--sym-text-muted)]'}"
        >
          <PanelRight class="h-3.5 w-3.5" />
          {#if artifacts.length > 0}<span class="font-mono text-[11px]">{artifacts.length}</span>{/if}
        </button>
      </div>
    </header>

    <!-- Chat Feed / Studio Workbench Empty State -->
    <div bind:this={chatScrollEl} class="flex-1 overflow-y-auto px-4 py-6">
      {#if loading}
        <div class="flex h-full items-center justify-center font-mono text-xs text-[var(--sym-text-muted)]">
          SYMFORYX...
        </div>
      {:else if messages.length === 0}
        <div class="mx-auto max-w-3xl py-6 space-y-6">
          <div class="border-b border-[var(--sym-border)] pb-5">
            <div class="font-mono text-[11px] uppercase tracking-widest text-[var(--sym-text-muted)]">
              SYMFORYX · STUDIO WORKBENCH
            </div>
            <h2 class="mt-1.5 text-2xl font-bold tracking-tight">{tr(lang, "emptyTitle")}</h2>
            <p class="mt-1.5 max-w-2xl text-sm text-[var(--sym-text-muted)]">{tr(lang, "emptySub")}</p>
          </div>

          <!-- Live Quota Snapshot Strip -->
          {#if topQuotas.length > 0}
            <div>
              <div class="mb-2 flex items-center justify-between">
                <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
                  {lang === "en" ? "Live Tool & Provider Quotas" : "Canlı Sağlayıcı & Araç Kotaları"}
                </span>
                <button type="button" onclick={() => (activeModal = "quotas")} class="text-[11px] font-medium text-[var(--sym-primary)] hover:underline">
                  {lang === "en" ? "All quotas →" : "Tüm kotalar ve maliyetler →"}
                </button>
              </div>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {#each topQuotas as q}
                  <button
                    type="button"
                    onclick={() => (activeModal = "quotas")}
                    class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-card)] p-2.5 text-left hover:border-[var(--sym-border-strong)] tabular-nums"
                  >
                    <div class="truncate text-xs font-semibold">{q.displayName}</div>
                    <div class="mt-1 flex items-baseline justify-between font-mono text-[11px]">
                      <span>{q.remainingAmount === null ? tr(lang, "unlimited") : q.remainingAmount}</span>
                      <span class="text-[10px] text-[var(--sym-text-muted)]">${q.windowCostUsd.toFixed(3)}</span>
                    </div>
                    <div class="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-[var(--sym-surface-2)]">
                      <div class="h-full bg-[var(--sym-primary)]" style={`width: ${Math.max(3, q.percentUsed)}%`}></div>
                    </div>
                    <div class="mt-1 font-mono text-[10px] text-[var(--sym-text-muted)]">
                      ↻ {formatCountdown(q.nextResetAt, lang)}
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Ready-Made Production Schemas Strip -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
                {lang === "en" ? "Ready Production Schemas" : "Hazır Üretim Şemaları (Tek Tıkla Başlat)"}
              </span>
              <button type="button" onclick={() => (activeModal = "flows")} class="text-[11px] font-medium text-[var(--sym-primary)] hover:underline">
                {lang === "en" ? `All ${flows.length} schemas →` : `Tüm ${flows.length} şemayı aç →`}
              </button>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              {#each [
                { id: "magaza-gorselleri", tag: "APP STORE · 5 EKRAN", title: lang === "en" ? "Store Screenshots Kit" : "Mağaza Görselleri (5'li Set)", sub: "App Store & Play Store ekran şablonları + vitrin", est: "$0.08" },
                { id: "aso-paketi", tag: "ASO · TR+EN", title: lang === "en" ? "ASO Optimization Package" : "ASO Optimizasyon Paketi", sub: "30/30/100 kar. metadata, anahtar kelime, A/B test", est: "$0.04" },
                { id: "video-promo", tag: "VIDEO · PROMO", title: lang === "en" ? "Video / Promo Production" : "Video & Promo Prodüksiyonu", sub: "Storyboard + Kling/Veo/Runway prompt + VO", est: "$0.12" },
                { id: "kod-gorsel-3d-muzik", tag: "KOD+GÖRSEL+3D+MÜZİK", title: lang === "en" ? "Code + Visual + 3D + Music" : "Kod + Görsel + 3D + Müzik", sub: "Paralel çoklu ortam tam stüdyo paketi", est: "$0.15" },
              ] as sc}
                <button
                  type="button"
                  onclick={() => (activeModal = "flows")}
                  class="flex items-start justify-between gap-2 rounded-lg border border-[var(--sym-border)] bg-[var(--sym-card)] p-3 text-left hover:border-[var(--sym-primary)]"
                >
                  <div>
                    <div class="font-mono text-[10px] font-semibold text-[var(--sym-accent)]">{sc.tag}</div>
                    <div class="mt-0.5 text-xs font-bold">{sc.title}</div>
                    <div class="mt-0.5 text-[11px] text-[var(--sym-text-muted)]">{sc.sub}</div>
                  </div>
                  <span class="shrink-0 font-mono text-[10px] text-[var(--sym-text-muted)]">~{sc.est}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Quick Starter Prompts -->
          <div class="grid gap-2 sm:grid-cols-2">
            {#each [
              { cmd: "@gorsel", label: lang === "en" ? "Design UI screen → Handoff to Code" : "Görsel tasarla → İstediğin modelle kodla", prompt: "@gorsel minimalist kahve dükkânı ana ekranı tasarla" },
              { cmd: "/karsilastir", label: lang === "en" ? "Run Claude, GPT & Gemini side-by-side" : "Claude, GPT ve Gemini'yi yan yana karşılaştır", prompt: "/karsilastir @claude @gpt @gemini TypeScript rate limiter tasarla" },
              { cmd: "/zincir", label: lang === "en" ? "Chain image design → HTML live preview" : "Zincir: Tasarım → Canlı HTML önizleme", prompt: "/zincir @gorsel hava durumu arayüzü > @claude bunu HTML ve Tailwind ile kodla" },
              { cmd: "/palet", label: lang === "en" ? "Accessible WCAG color palette tool" : "WCAG erişilebilir renk paleti üret", prompt: "/palet sıcak taş ve derin lacivert editorial arayüz" },
            ] as r}
              <button
                type="button"
                onclick={() => sendMessage(r.prompt)}
                class="flex items-start justify-between gap-2 rounded-lg border border-[var(--sym-border)] bg-[var(--sym-card)] p-3 text-left hover:border-[var(--sym-primary)]"
              >
                <div>
                  <div class="text-xs font-semibold">{r.label}</div>
                  <div class="mt-0.5 text-[11px] text-[var(--sym-text-muted)] line-clamp-1">{r.prompt}</div>
                </div>
                <span class="shrink-0 font-mono text-[10px] text-[var(--sym-primary)]">{r.cmd}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="mx-auto max-w-4xl space-y-3.5">
          {#each displayBlocks as block}
            {#if block.kind === "single"}
              <MessageCard
                message={block.message}
                {lang}
                {artifacts}
                {providers}
                experienceMode={settings.experienceMode}
                promptCostSummary={block.message.role === "user" ? promptCostMap[block.message.id] ?? null : null}
                onHandoff={handleHandoff}
                onRegenerate={(m) => {
                  const parentUser = messages.find((x) => x.id === m.parentId);
                  const txt = parentUser?.parts.find((p) => p.type === "text")?.text;
                  if (txt) void sendMessage(txt, { parentId: m.parentId });
                }}
                onPin={async (m) => {
                  const res = await api.updateMessage(m.id, { pinned: !m.pinned });
                  messages = messages.map((x) => (x.id === m.id ? res.message : x));
                  contextStats = { ...contextStats, pinnedCount: messages.filter((x) => x.pinned).length };
                }}
                onSaveMemory={async (m) => {
                  const txt = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").slice(0, 260);
                  await api.addMemory({ scope: "project", projectId: activeProjectId, content: txt, sourceMessageId: m.id });
                  showToast(lang === "en" ? "Saved to project memory" : "Proje hafızasına eklendi");
                }}
                onOpenArtifact={(id) => { selectedArtifactId = id; artifactPanelOpen = true; }}
                onUseArtifactAsRef={addExistingArtifactAsRef}
                onBranch={() => { draft = "@claude "; }}
              />
            {:else}
              <div class="grid gap-3 md:grid-cols-3">
                {#each block.items as cand (cand.id)}
                  <MessageCard
                    message={cand}
                    {lang}
                    {artifacts}
                    {providers}
                    experienceMode={settings.experienceMode}
                    isCompareCandidate={true}
                    onSelectCompare={async (chosen) => {
                      if (!activeThreadId) return;
                      await api.selectCompare(activeThreadId, block.groupId, chosen.id);
                      messages = messages.map((x) =>
                        x.compareGroupId === block.groupId ? { ...x, selectedCompare: x.id === chosen.id } : x
                      );
                    }}
                    onHandoff={handleHandoff}
                    onRegenerate={() => {}}
                    onPin={async (m) => {
                      const res = await api.updateMessage(m.id, { pinned: !m.pinned });
                      messages = messages.map((x) => (x.id === m.id ? res.message : x));
                    }}
                    onSaveMemory={async (m) => {
                      const txt = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").slice(0, 240);
                      await api.addMemory({ scope: "project", projectId: activeProjectId, content: txt });
                    }}
                    onOpenArtifact={(id) => { selectedArtifactId = id; artifactPanelOpen = true; }}
                    onUseArtifactAsRef={addExistingArtifactAsRef}
                    onBranch={() => {}}
                  />
                {/each}
              </div>
            {/if}
          {/each}

          {#if streamError}
            <div class="rounded-lg border border-[var(--sym-error)] bg-[var(--sym-card)] p-3 text-xs">
              <div class="font-semibold text-[var(--sym-error)]">{streamError}</div>
              <button type="button" onclick={() => (streamError = null)} class="mt-2 rounded border border-[var(--sym-border)] px-2.5 py-1 text-[11px]">{tr(lang, "close")}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <Composer
      bind:draft
      bind:attachments
      bind:references
      {lang}
      {mode}
      experienceMode={settings.experienceMode}
      {providers}
      {roles}
      {tools}
      {artifacts}
      {commands}
      {selectedModel}
      pinnedModel={activeThread?.pinnedModelId && activeThread?.pinnedProviderId
        ? { providerId: activeThread.pinnedProviderId, modelId: activeThread.pinnedModelId }
        : null}
      {enabledToolIds}
      {isStreaming}
      {contextStats}
      onSend={(txt) => void sendMessage(txt)}
      onStop={() => { if (activeThreadId) void api.stopThread(activeThreadId); isStreaming = false; }}
      onChangeMode={async (m) => { mode = m; if (activeThreadId) await api.updateThread(activeThreadId, { mode: m }); }}
      onSelectModel={(m) => { selectedModel = m; if (m) mode = "manual"; }}
      onPinModel={async () => {
        if (!activeThreadId || !selectedModel) return;
        const already = activeThread?.pinnedModelId === selectedModel.modelId;
        await api.updateThread(activeThreadId, {
          pinnedProviderId: already ? null : selectedModel.providerId,
          pinnedModelId: already ? null : selectedModel.modelId,
        });
        await refreshBootstrap();
      }}
      onToggleTool={(id) => {
        enabledToolIds = enabledToolIds.includes(id) ? enabledToolIds.filter((x) => x !== id) : [...enabledToolIds, id];
      }}
      onAttachFile={handleAttachFile}
      onAddReferenceImage={handleAddReferenceImage}
      onAddReferenceUrl={async (url, note) => {
        if (!activeThreadId) await createNewChat();
        if (!activeThreadId) return;
        const res = await api.addThreadReference(activeThreadId, `${url}${note ? ` ${note}` : ""}`);
        references = res.references;
        showToast(lang === "en" ? `Website reference added` : `Web sitesi referansı eklendi`);
      }}
      onEditLastMessage={() => {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const txt = lastUser?.parts.find((p) => p.type === "text")?.text;
        if (txt) draft = txt;
      }}
      onOpenContextManager={() => { settingsTab = "memory"; activeModal = "settings"; }}
    />
  </main>

  {#if artifactPanelOpen}
    <div class="w-[460px] max-w-[46vw] shrink-0">
      <ArtifactPanel
        {artifacts}
        {lang}
        selectedId={selectedArtifactId}
        onSelect={(id) => (selectedArtifactId = id)}
        onClose={() => (artifactPanelOpen = false)}
        onChangeVersion={async (id, version) => {
          const res = await api.setArtifactVersion(id, version);
          artifacts = artifacts.map((a) => (a.id === id ? res.artifact : a));
        }}
        onSendToCode={handleSendArtifactToCode}
        onUseAsRef={(art) => addExistingArtifactAsRef(art.id)}
        onRunInSandbox={handleRunCodeArtifact}
        onAskEdit={(art, instruction) => void sendMessage(`#${art.id} (${art.title}): ${instruction}`)}
      />
    </div>
  {/if}
</div>

<Modals
  bind:activeModal
  bind:settingsTab
  {lang}
  {settings}
  {providers}
  {roles}
  {tools}
  {flows}
  {threads}
  {activeProject}
  {activeThreadId}
  {usage}
  {budgets}
  {quotas}
  {commands}
  {shortcuts}
  onRefresh={refreshBootstrap}
  onSelectThread={selectThread}
  onRunPrompt={(p) => void sendMessage(p)}
  onNewChat={createNewChat}
  onNewProject={createNewProject}
  onUpdateSettings={updateSettings}
  onFlowArtifactCreated={async (artId) => {
    if (activeThreadId) {
      const res = await api.getThread(activeThreadId);
      artifacts = res.artifacts;
    }
    selectedArtifactId = artId;
    artifactPanelOpen = true;
  }}
/>

{#if toast}
  <div role="status" class="fixed bottom-4 right-4 z-50 rounded border border-[var(--sym-border-strong)] bg-[var(--sym-text)] px-3.5 py-2 text-xs font-medium text-[var(--sym-bg)] shadow-lg">
    {toast}
  </div>
{/if}
