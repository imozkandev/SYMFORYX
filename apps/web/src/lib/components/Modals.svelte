<script lang="ts">
  import type {
    Budget,
    FlowDefinition,
    FlowRun,
    LanguageCode,
    MemoryItem,
    Project,
    ProjectFile,
    ProviderConfig,
    QuotaMetric,
    QuotaResetInterval,
    QuotaStatus,
    TaskRole,
    Thread,
    ToolManifest,
    UserSettings,
  } from "@symforyx/core";
  import type { BootstrapPayload } from "$lib/api";
  import { api } from "$lib/api";
  import { applyTheme, lightDismissDialog } from "$lib/dom";
  import { formatCountdown, resetIntervalLabel, tr } from "$lib/i18n";
  import {
    Check,
    Clock,
    Download,
    Gauge,
    KeyRound,
    Play,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    Workflow,
    Wrench,
    X,
  } from "lucide-svelte";

  let {
    activeModal = $bindable<"none" | "command" | "settings" | "flows" | "tools" | "quotas">("none"),
    settingsTab = $bindable<
      "general" | "appearance" | "providers" | "roles" | "memory" | "usage" | "shortcuts" | "about"
    >("providers"),
    lang = "tr",
    settings,
    providers,
    roles,
    tools,
    flows,
    threads,
    activeProject,
    activeThreadId,
    usage,
    budgets,
    quotas,
    commands,
    shortcuts,
    onRefresh,
    onSelectThread,
    onRunPrompt,
    onNewChat,
    onNewProject,
    onUpdateSettings,
    onFlowArtifactCreated,
  }: {
    activeModal: "none" | "command" | "settings" | "flows" | "tools" | "quotas";
    settingsTab: "general" | "appearance" | "providers" | "roles" | "memory" | "usage" | "shortcuts" | "about";
    lang: LanguageCode;
    settings: UserSettings;
    providers: ProviderConfig[];
    roles: TaskRole[];
    tools: ToolManifest[];
    flows: FlowDefinition[];
    threads: Thread[];
    activeProject: Project | null;
    activeThreadId: string | null;
    usage: BootstrapPayload["usage"];
    budgets: Budget[];
    quotas: QuotaStatus[];
    commands: BootstrapPayload["commands"];
    shortcuts: BootstrapPayload["shortcuts"];
    onRefresh: () => Promise<void>;
    onSelectThread: (id: string) => void;
    onRunPrompt: (prompt: string) => void;
    onNewChat: () => void;
    onNewProject: () => void;
    onUpdateSettings: (patch: Partial<UserSettings>) => Promise<void>;
    onFlowArtifactCreated: (artifactId: string) => void;
  } = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialogEl) return;
    if (activeModal !== "none") {
      if (!dialogEl.open) dialogEl.showModal();
      if (activeModal === "settings" && settingsTab === "memory") void loadMemoryAndFiles();
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  });

  // Command palette
  let cmdQuery = $state("");

  // Providers & unrestricted custom model addition
  let keyInputs = $state<Record<string, string>>({});
  let baseUrlInputs = $state<Record<string, string>>({});
  let customModelInputs = $state<Record<string, string>>({});
  let customModelKind = $state<Record<string, "chat" | "image">>({});
  let testStatus = $state<Record<string, { ok: boolean; message: string }>>({});
  let ollamaStatus = $state("");
  let customProvName = $state("");
  let customProvUrl = $state("");
  let customProvKey = $state("");
  let customProvAlias = $state("");

  // Quotas editor
  let editingQuotaId = $state<string | null>(null);
  let qPlan = $state("");
  let qMetric = $state<QuotaMetric>("requests");
  let qLimit = $state<string>("");
  let qInterval = $state<QuotaResetInterval>("monthly");

  // Flows (Studio Schemas)
  let selectedFlowId = $state("magaza-gorselleri");
  let flowCategory = $state<string>("all");
  let flowInputs = $state<Record<string, string>>({});
  let stepModelOverrides = $state<Record<string, string>>({}); // stepId -> "providerId::modelId"
  let activeRun = $state<FlowRun | null>(null);
  let flowRunning = $state(false);
  let rejectFeedback = $state("");

  // Tools
  let toolFilter = $state<"all" | "installed" | "free" | "local">("all");
  let mcpUrl = $state("");
  let mcpStatus = $state("");

  // Memory & Files
  let memories = $state<MemoryItem[]>([]);
  let projectFiles = $state<ProjectFile[]>([]);
  let newMemoryText = $state("");
  let newMemoryScope = $state<"project" | "personal">("project");
  let projectInstructions = $state("");

  // Budgets
  let newBudgetName = $state("Aylık Limit");
  let newBudgetLimit = $state(25);
  let newBudgetType = $state<"soft" | "hard">("soft");

  const flowCategories = $derived([
    "all",
    ...Array.from(new Set(flows.map((f) => f.category || "Genel"))),
  ]);
  const visibleFlows = $derived(
    flowCategory === "all" ? flows : flows.filter((f) => (f.category || "Genel") === flowCategory)
  );
  const selectedFlow = $derived(
    visibleFlows.find((f) => f.id === selectedFlowId) ?? visibleFlows[0] ?? flows[0] ?? null
  );

  async function loadMemoryAndFiles() {
    if (!activeProject) return;
    projectInstructions = activeProject.instructions ?? "";
    const [mRes, fRes] = await Promise.all([api.listMemories(), api.listFiles(activeProject.id)]);
    memories = mRes.memories;
    projectFiles = fRes.files;
  }

  async function saveAndTestProvider(prov: ProviderConfig) {
    const apiKey = keyInputs[prov.id];
    const baseUrl = baseUrlInputs[prov.id] || prov.baseUrl;
    if (apiKey || baseUrl) {
      await api.saveProvider({ id: prov.id, apiKey: apiKey || undefined, baseUrl });
    }
    const res = await api.testProvider(prov.id, { apiKey: apiKey || undefined, baseUrl });
    testStatus[prov.id] = { ok: res.ok, message: res.message || (res.ok ? "OK" : "Error") };
    if (res.ok) {
      keyInputs[prov.id] = "";
      await onRefresh();
    }
  }

  async function addCustomModelToProvider(provId: string) {
    const modelId = (customModelInputs[provId] || "").trim();
    if (!modelId) return;
    const isImg = customModelKind[provId] === "image";
    await api.addProviderModel(provId, {
      id: modelId,
      displayName: modelId,
      capabilities: isImg ? ["image.generate", "image.edit"] : ["chat", "vision", "tools"],
    });
    customModelInputs[provId] = "";
    await onRefresh();
  }

  async function detectOllama() {
    ollamaStatus = lang === "en" ? "Scanning..." : "Aranıyor...";
    const res = await api.detectOllama();
    ollamaStatus = res.message || (res.ok ? "OK" : "Not found");
    if (res.ok) await onRefresh();
  }

  async function addCustomProvider() {
    if (!customProvName.trim() || !customProvUrl.trim()) return;
    await api.saveProvider({
      id: `custom_${customProvName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      type: "openai_compatible",
      displayName: customProvName.trim(),
      baseUrl: customProvUrl.trim(),
      apiKey: customProvKey.trim() || undefined,
      alias: customProvAlias.trim() || undefined,
      auth: customProvKey.trim() ? "api_key" : "none",
      badgeColor: "#3F3F46",
      badgeLetter: customProvName.trim()[0].toUpperCase(),
      enabled: true,
    });
    customProvName = "";
    customProvUrl = "";
    customProvKey = "";
    customProvAlias = "";
    await onRefresh();
  }

  function startEditQuota(q: QuotaStatus) {
    editingQuotaId = q.id;
    qPlan = q.planName;
    qMetric = q.metric;
    qLimit = q.limitAmount === null ? "" : String(q.limitAmount);
    qInterval = q.resetInterval;
  }

  async function commitQuotaEdit(q: QuotaStatus) {
    await api.saveQuota({
      targetType: q.targetType,
      targetId: q.targetId,
      displayName: q.displayName,
      planName: qPlan.trim() || q.planName,
      metric: qMetric,
      limitAmount: qLimit.trim() === "" ? null : Number(qLimit),
      resetInterval: qInterval,
    });
    editingQuotaId = null;
    await onRefresh();
  }

  function formatMetricValue(val: number | null, metric: QuotaMetric): string {
    if (val === null) return tr(lang, "unlimited");
    if (metric === "usd") return `$${val.toFixed(4)}`;
    if (metric === "tokens") return val >= 1000 ? `${(val / 1000).toFixed(1)}k tok` : `${val} tok`;
    if (metric === "images") return `${val} img`;
    return `${val} req`;
  }

  async function startSelectedFlow() {
    if (!selectedFlow || !activeProject) return;
    flowRunning = true;
    try {
      const overrides: Record<string, { providerId: string; modelId: string }> = {};
      for (const [stepId, val] of Object.entries(stepModelOverrides)) {
        if (val && val.includes("::")) {
          const [providerId, modelId] = val.split("::");
          overrides[stepId] = { providerId, modelId };
        }
      }
      const res = await api.runFlow(
        selectedFlow.id,
        { ...flowInputs },
        activeProject.id,
        activeThreadId ?? undefined,
        Object.keys(overrides).length ? overrides : undefined
      );
      activeRun = res.run;
      const firstArt = res.run.stepStates.flatMap((s) => s.artifactIds ?? []).at(-1);
      if (firstArt) onFlowArtifactCreated(firstArt);
      await onRefresh();
    } finally {
      flowRunning = false;
    }
  }

  async function decideApproval(approved: boolean) {
    if (!activeRun) return;
    flowRunning = true;
    try {
      const res = await api.approveFlowRun(activeRun.id, approved, rejectFeedback);
      activeRun = res.run;
      rejectFeedback = "";
      const firstArt = res.run.stepStates.flatMap((s) => s.artifactIds ?? []).at(-1);
      if (firstArt) onFlowArtifactCreated(firstArt);
    } finally {
      flowRunning = false;
    }
  }

  async function connectMcp() {
    if (!mcpUrl.trim()) return;
    mcpStatus = lang === "en" ? "Connecting..." : "Bağlanılıyor...";
    const res = await api.discoverMcp(mcpUrl.trim());
    if (res.ok) {
      mcpStatus = `OK (${res.tools?.length ?? 0})`;
      mcpUrl = "";
      await onRefresh();
    } else {
      mcpStatus = `Error: ${res.error}`;
    }
  }

  async function handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !activeProject) return;
    const text = await file.text();
    await api.uploadFile(activeProject.id, {
      name: file.name,
      mime: file.type || "text/plain",
      size: file.size,
      contentText: text.slice(0, 120000),
    });
    await loadMemoryAndFiles();
  }

  const filteredTools = $derived(
    tools.filter((t) => {
      if (toolFilter === "installed") return t.installed;
      if (toolFilter === "free") return t.cost.model === "free";
      if (toolFilter === "local") return t.cost.model === "local";
      return true;
    })
  );

  const cmdItems = $derived.by(() => {
    const q = cmdQuery.trim().toLowerCase();
    const list: Array<{ label: string; sub: string; action: () => void }> = [
      { label: tr(lang, "newChat"), sub: "⌘N", action: () => { activeModal = "none"; onNewChat(); } },
      { label: tr(lang, "newProject"), sub: "⌘⇧N", action: () => { activeModal = "none"; onNewProject(); } },
      { label: tr(lang, "quotas"), sub: lang === "en" ? "Usage, remaining, reset countdown & cost" : "Kullanım, kalan, sıfırlanma & maliyet", action: () => { activeModal = "quotas"; } },
      { label: tr(lang, "flows"), sub: `${flows.length}`, action: () => { activeModal = "flows"; } },
      { label: tr(lang, "tools"), sub: "MCP / HTTP / Builtin", action: () => { activeModal = "tools"; } },
      { label: tr(lang, "providersTab"), sub: "OpenAI, Claude, Gemini, Flux, Ollama...", action: () => { settingsTab = "providers"; activeModal = "settings"; } },
      { label: tr(lang, "rolesTab"), sub: "Role routing", action: () => { settingsTab = "roles"; activeModal = "settings"; } },
      ...commands.map((c) => ({
        label: c.command,
        sub: lang === "en" ? c.descEn : c.descTr,
        action: () => { activeModal = "none"; onRunPrompt(c.example); },
      })),
      ...threads.slice(0, 8).map((th) => ({
        label: th.title,
        sub: th.mode,
        action: () => { activeModal = "none"; onSelectThread(th.id); },
      })),
    ];
    if (!q) return list.slice(0, 12);
    return list.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)).slice(0, 12);
  });

  const allSelectableModels = $derived(
    providers.flatMap((p) =>
      p.models.map((m) => ({
        value: `${p.id}::${m.id}`,
        label: `${p.displayName} — ${m.displayName}`,
      }))
    )
  );
</script>

<dialog
  bind:this={dialogEl}
  use:lightDismissDialog
  {...({ closedby: "any" } as any)}
  aria-labelledby="sym-modal-title"
  onclose={() => (activeModal = "none")}
>
  {#if activeModal === "command"}
    <div class="flex flex-col">
      <div class="flex items-center gap-2.5 border-b border-[var(--sym-border)] px-4 py-3">
        <Search class="h-4 w-4 text-[var(--sym-text-muted)]" />
        <h2 id="sym-modal-title" class="sr-only">{tr(lang, "commandPalette")}</h2>
        <input
          type="text"
          bind:value={cmdQuery}
          placeholder={lang === "en" ? "Search threads, commands, tools, quotas..." : "Sohbet, komut, araç, kota veya ayar ara..."}
          class="flex-1 bg-transparent text-sm outline-none"
        />
        <button type="button" onclick={() => (activeModal = "none")} aria-label={tr(lang, "close")} class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)]">
          <X class="h-4 w-4" />
        </button>
      </div>
      <div class="max-h-96 overflow-y-auto p-1.5">
        {#each cmdItems as item}
          <button
            type="button"
            onclick={item.action}
            class="flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs hover:bg-[var(--sym-surface)]"
          >
            <span class="font-medium">{item.label}</span>
            <span class="font-mono text-[11px] text-[var(--sym-text-muted)]">{item.sub}</span>
          </button>
        {/each}
      </div>
    </div>

  {:else if activeModal === "quotas"}
    <!-- DEDICATED QUOTAS, REMAINING, RESET COUNTDOWN & COST TELEMETRY PANEL -->
    <div class="flex h-[82vh] flex-col">
      <div class="flex items-center justify-between border-b border-[var(--sym-border)] px-5 py-3.5">
        <div class="flex items-center gap-2">
          <Gauge class="h-4 w-4 text-[var(--sym-primary)]" />
          <h2 id="sym-modal-title" class="text-sm font-bold">{tr(lang, "quotas")}</h2>
        </div>
        <div class="flex items-center gap-2">
          <a
            href="/api/v1/usage?period=monthly&format=csv"
            class="inline-flex items-center gap-1 rounded border border-[var(--sym-border)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--sym-surface)]"
          >
            <Download class="h-3 w-3" /> CSV
          </a>
          <button type="button" onclick={() => (activeModal = "none")} aria-label={tr(lang, "close")} class="rounded p-1 hover:bg-[var(--sym-surface)]">
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Summary Metrics Strip -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
            <div class="text-[11px] text-[var(--sym-text-muted)]">{tr(lang, "totalMonthSpend")}</div>
            <div class="mt-1 font-mono text-lg font-bold tabular-nums">${usage.totalCostUsd.toFixed(4)}</div>
          </div>
          <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
            <div class="text-[11px] text-[var(--sym-text-muted)]">{lang === "en" ? "Requests" : "Toplam İstek"}</div>
            <div class="mt-1 font-mono text-lg font-bold tabular-nums">{usage.requestCount}</div>
          </div>
          <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
            <div class="text-[11px] text-[var(--sym-text-muted)]">{lang === "en" ? "Input Tokens" : "Giriş Token"}</div>
            <div class="mt-1 font-mono text-lg font-bold tabular-nums">{usage.totalInputTokens.toLocaleString()}</div>
          </div>
          <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
            <div class="text-[11px] text-[var(--sym-text-muted)]">{lang === "en" ? "Output Tokens" : "Çıkış Token"}</div>
            <div class="mt-1 font-mono text-lg font-bold tabular-nums">{usage.totalOutputTokens.toLocaleString()}</div>
          </div>
        </div>

        <!-- Per-Provider & Per-Tool Live Quota Table -->
        <div class="overflow-x-auto rounded-lg border border-[var(--sym-border)]">
          <table class="w-full text-left text-xs border-collapse tabular-nums">
            <thead>
              <tr class="border-b border-[var(--sym-border)] bg-[var(--sym-surface)] text-[11px] text-[var(--sym-text-muted)]">
                <th class="px-3 py-2 font-semibold">{lang === "en" ? "Provider / Tool" : "Sağlayıcı / Araç"}</th>
                <th class="px-3 py-2 font-semibold">{tr(lang, "quotaUsed")}</th>
                <th class="px-3 py-2 font-semibold">{tr(lang, "quotaRemaining")}</th>
                <th class="px-3 py-2 font-semibold">{tr(lang, "quotaResets")}</th>
                <th class="px-3 py-2 font-semibold text-right">{tr(lang, "quotaCost")}</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {#each quotas as q (q.id)}
                <tr class="border-b border-[var(--sym-border)] last:border-0 hover:bg-[var(--sym-surface)]/60">
                  <td class="px-3 py-2.5">
                    <div class="font-semibold">{q.displayName}</div>
                    <div class="text-[10px] text-[var(--sym-text-muted)]">
                      {q.planName} · {resetIntervalLabel(lang, q.resetInterval)}
                    </div>
                  </td>
                  <td class="px-3 py-2.5 font-mono">
                    <div>{formatMetricValue(q.usedAmount, q.metric)}</div>
                    {#if q.limitAmount !== null}
                      <div class="mt-1 h-1 w-24 overflow-hidden rounded-sm bg-[var(--sym-surface-2)]">
                        <div
                          class="h-full"
                          style={`width: ${q.percentUsed}%; background: ${
                            q.percentUsed >= 90 ? 'var(--sym-error)' : q.percentUsed >= 75 ? 'var(--sym-warning)' : 'var(--sym-primary)'
                          }`}
                        ></div>
                      </div>
                    {/if}
                  </td>
                  <td class="px-3 py-2.5 font-mono">
                    <span class={q.remainingAmount !== null && q.percentUsed >= 85 ? "text-[var(--sym-error)] font-semibold" : ""}>
                      {formatMetricValue(q.remainingAmount, q.metric)}
                    </span>
                    {#if q.limitAmount !== null}
                      <span class="block text-[10px] text-[var(--sym-text-muted)]">/ {formatMetricValue(q.limitAmount, q.metric)}</span>
                    {/if}
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="inline-flex items-center gap-1 font-mono text-[11px]">
                      <Clock class="h-3 w-3 text-[var(--sym-text-muted)]" />
                      <span>{formatCountdown(q.nextResetAt, lang)}</span>
                    </div>
                    {#if q.nextResetAt}
                      <div class="text-[10px] text-[var(--sym-text-muted)]">
                        {new Date(q.nextResetAt).toLocaleString(lang === "en" ? "en-US" : "tr-TR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    {/if}
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono">
                    <div class="font-semibold">${q.windowCostUsd.toFixed(4)}</div>
                    <div class="text-[10px] text-[var(--sym-text-muted)]">Σ ${q.totalCostUsd.toFixed(4)}</div>
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onclick={() => startEditQuota(q)}
                      class="rounded border border-[var(--sym-border)] px-2 py-1 text-[11px] hover:border-[var(--sym-primary)]"
                    >
                      {tr(lang, "editQuota")}
                    </button>
                  </td>
                </tr>

                {#if editingQuotaId === q.id}
                  <tr class="border-b border-[var(--sym-border)] bg-[var(--sym-surface)]">
                    <td colspan="6" class="p-3">
                      <div class="flex flex-wrap items-center gap-2">
                        <input
                          bind:value={qPlan}
                          placeholder="Plan adı"
                          class="w-40 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs"
                        />
                        <select bind:value={qMetric} class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs">
                          <option value="requests">{lang === "en" ? "Requests" : "İstek"}</option>
                          <option value="tokens">Token</option>
                          <option value="images">{lang === "en" ? "Images" : "Görsel"}</option>
                          <option value="usd">USD ($)</option>
                        </select>
                        <input
                          type="number"
                          step="any"
                          bind:value={qLimit}
                          placeholder={lang === "en" ? "Empty = unlimited" : "Boş = sınırsız"}
                          class="w-32 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs font-mono"
                        />
                        <select bind:value={qInterval} class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs">
                          <option value="hourly">{resetIntervalLabel(lang, "hourly")}</option>
                          <option value="5h">{resetIntervalLabel(lang, "5h")}</option>
                          <option value="daily">{resetIntervalLabel(lang, "daily")}</option>
                          <option value="weekly">{resetIntervalLabel(lang, "weekly")}</option>
                          <option value="monthly">{resetIntervalLabel(lang, "monthly")}</option>
                          <option value="never">{resetIntervalLabel(lang, "never")}</option>
                        </select>
                        <button
                          type="button"
                          onclick={() => commitQuotaEdit(q)}
                          class="rounded bg-[var(--sym-primary)] px-3 py-1 text-xs font-medium text-white"
                        >
                          {tr(lang, "save")}
                        </button>
                        <button
                          type="button"
                          onclick={() => (editingQuotaId = null)}
                          class="rounded border border-[var(--sym-border)] px-2.5 py-1 text-xs"
                        >
                          {tr(lang, "cancel")}
                        </button>
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Budgets -->
        <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-4">
          <div class="mb-2 text-xs font-bold">{lang === "en" ? "Spending Limits (Soft / Hard)" : "Harcama Bütçeleri (Yumuşak / Sert Limit)"}</div>
          <div class="flex flex-wrap gap-2 mb-3">
            <input bind:value={newBudgetName} class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs" />
            <input type="number" step="1" bind:value={newBudgetLimit} class="w-24 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs font-mono" />
            <select bind:value={newBudgetType} class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs">
              <option value="soft">{lang === "en" ? "Soft (Warn)" : "Yumuşak (Uyar)"}</option>
              <option value="hard">{lang === "en" ? "Hard (Block Paid)" : "Sert (Ücretliyi Durdur)"}</option>
            </select>
            <button
              type="button"
              onclick={async () => {
                await api.createBudget({
                  name: newBudgetName,
                  scope: "workspace",
                  type: newBudgetType,
                  limitUsd: Number(newBudgetLimit),
                  period: "monthly",
                  warnAtPercent: 80,
                  enabled: true,
                });
                await onRefresh();
              }}
              class="rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]"
            >
              {tr(lang, "add")}
            </button>
          </div>
          {#each budgets as b}
            <div class="mb-1.5 flex items-center justify-between rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-3 py-1.5 text-xs">
              <span><strong>{b.name}</strong> · <span class="font-mono">${b.limitUsd.toFixed(2)}</span> · {b.type}</span>
              <button type="button" onclick={async () => { await api.deleteBudget(b.id); await onRefresh(); }} class="text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]">
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          {/each}
        </div>
      </div>
    </div>

  {:else if activeModal === "flows"}
    <div class="flex h-[84vh] flex-col">
      <div class="flex items-center justify-between border-b border-[var(--sym-border)] px-5 py-3">
        <div class="flex items-center gap-2">
          <Workflow class="h-4 w-4 text-[var(--sym-accent)]" />
          <h2 id="sym-modal-title" class="text-sm font-bold">
            {lang === "en" ? "Studio Schemas & Production Pipelines" : "Hazır Stüdyo Şemaları & Üretim Akışları"}
          </h2>
          <span class="font-mono text-[11px] text-[var(--sym-text-muted)]">({flows.length})</span>
        </div>
        <button type="button" onclick={() => (activeModal = "none")} aria-label={tr(lang, "close")} class="rounded p-1 hover:bg-[var(--sym-surface)]">
          <X class="h-4 w-4" />
        </button>
      </div>

      <!-- Category Strip -->
      <div class="flex gap-1.5 overflow-x-auto border-b border-[var(--sym-border)] bg-[var(--sym-surface)] px-4 py-2">
        {#each flowCategories as cat}
          <button
            type="button"
            onclick={() => (flowCategory = cat)}
            class="shrink-0 rounded px-2.5 py-1 text-[11px] font-medium {flowCategory === cat
              ? 'bg-[var(--sym-text)] text-[var(--sym-bg)]'
              : 'border border-[var(--sym-border)] bg-[var(--sym-card)] text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]'}"
          >
            {cat === "all" ? (lang === "en" ? "All Schemas" : "Tüm Şemalar") : cat}
          </button>
        {/each}
      </div>

      <div class="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-12">
        <div class="border-r border-[var(--sym-border)] overflow-y-auto p-3 md:col-span-5 space-y-1.5">
          {#each visibleFlows as f}
            <button
              type="button"
              onclick={() => { selectedFlowId = f.id; activeRun = null; flowInputs = {}; stepModelOverrides = {}; }}
              class="w-full rounded-lg border p-3 text-left transition-colors {selectedFlow?.id === f.id
                ? 'border-[var(--sym-primary)] bg-[var(--sym-surface)]'
                : 'border-[var(--sym-border)] hover:bg-[var(--sym-surface)]'}"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold">{lang === "en" && f.nameEn ? f.nameEn : f.name}</span>
                <span class="shrink-0 font-mono text-[10px] text-[var(--sym-text-muted)]">
                  ~${(f.estimatedCostUsd ?? 0.04).toFixed(2)}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-[var(--sym-text-muted)] line-clamp-2">
                {lang === "en" && f.descriptionEn ? f.descriptionEn : f.description}
              </p>
              <div class="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-[var(--sym-text-muted)]">
                <span>{f.category || "Genel"}</span>
                <span>· {f.steps.length} {lang === "en" ? "steps" : "adım"}</span>
              </div>
            </button>
          {/each}
        </div>

        <div class="overflow-y-auto p-5 md:col-span-7">
          {#if selectedFlow}
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-bold">{lang === "en" && selectedFlow.nameEn ? selectedFlow.nameEn : selectedFlow.name}</h3>
                <p class="mt-1 text-xs text-[var(--sym-text-muted)]">{lang === "en" && selectedFlow.descriptionEn ? selectedFlow.descriptionEn : selectedFlow.description}</p>
              </div>
              <div class="shrink-0 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-right font-mono text-[11px]">
                <div class="text-[9px] uppercase text-[var(--sym-text-muted)]">{lang === "en" ? "Est. Cost" : "Tahmini"}</div>
                <div class="font-bold">~${(selectedFlow.estimatedCostUsd ?? 0.04).toFixed(3)}</div>
              </div>
            </div>

            <!-- Per-Step Pipeline + Unrestricted Model Override per Step -->
            <div class="my-4 space-y-1.5">
              <div class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
                {lang === "en" ? "Pipeline Steps (Override Any Step's Model Freely)" : "Adımlar (Her Adımın Modelini Özgürce Seçebilirsin)"}
              </div>
              {#each selectedFlow.steps as st, idx}
                {@const flatSteps = st.type === "parallel" && st.steps ? st.steps : [st]}
                {#each flatSteps as sub}
                  <div class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 text-xs">
                    <div class="flex items-center gap-1.5">
                      <span class="font-mono text-[10px] text-[var(--sym-text-muted)]">{idx + 1}.</span>
                      <span class="font-medium">{sub.name || sub.id}</span>
                      {#if sub.type === "approval"}
                        <span class="rounded bg-[var(--sym-accent)]/15 px-1.5 py-0.5 font-mono text-[10px] text-[var(--sym-accent)]">ONAY</span>
                      {/if}
                    </div>
                    {#if sub.type !== "approval" && !sub.use?.startsWith("tool:")}
                      <select
                        aria-label={`${sub.name || sub.id} modeli`}
                        value={stepModelOverrides[sub.id] || ""}
                        onchange={(e) => (stepModelOverrides[sub.id] = (e.target as HTMLSelectElement).value)}
                        class="max-w-[210px] rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-0.5 text-[11px]"
                      >
                        <option value="">{lang === "en" ? "Role Default" : "Rol Varsayılanı"} ({sub.use || "genel"})</option>
                        {#each allSelectableModels as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    {/if}
                  </div>
                {/each}
              {/each}
            </div>

            <div class="space-y-3">
              {#each Object.entries(selectedFlow.inputs ?? {}) as [key, field]}
                <div>
                  <label class="mb-1 block text-xs font-semibold" for={`fl-${key}`}>{field.label}</label>
                  {#if field.type === "select" && field.options}
                    <select id={`fl-${key}`} bind:value={flowInputs[key]} class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 text-xs">
                      {#each field.options as opt}<option value={opt}>{opt}</option>{/each}
                    </select>
                  {:else}
                    <input id={`fl-${key}`} type="text" bind:value={flowInputs[key]} placeholder={field.placeholder || ""} class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--sym-primary)]" />
                  {/if}
                </div>
              {/each}
            </div>

            <button
              type="button"
              disabled={flowRunning}
              onclick={startSelectedFlow}
              class="mt-4 inline-flex items-center gap-1.5 rounded bg-[var(--sym-text)] px-4 py-1.5 text-xs font-semibold text-[var(--sym-bg)] disabled:opacity-50"
            >
              <Play class="h-3.5 w-3.5" /> {flowRunning ? (lang === "en" ? "Running..." : "Üretiliyor...") : (lang === "en" ? "Run Schema" : "Şemayı Çalıştır")}
            </button>

            {#if activeRun}
              <div class="mt-4 rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3.5 space-y-2">
                <div class="flex items-center justify-between text-xs font-mono">
                  <span>{activeRun.status}</span>
                  <span>{lang === "en" ? "Actual Cost" : "Gerçekleşen"}: ${activeRun.totalCostUsd.toFixed(5)}</span>
                </div>
                {#each activeRun.stepStates as st}
                  <div class="flex items-center justify-between rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1.5 text-xs">
                    <span>{st.stepId}</span>
                    <div class="flex items-center gap-2">
                      {#if st.artifactIds?.length}
                        <button
                          type="button"
                          onclick={() => { onFlowArtifactCreated(st.artifactIds![0]); activeModal = "none"; }}
                          class="font-mono text-[10px] text-[var(--sym-primary)] hover:underline"
                        >
                          {lang === "en" ? "Open Artifact ▸" : "Artefaktı Aç ▸"}
                        </button>
                      {/if}
                      <span class="font-mono text-[10px]">{st.status}</span>
                    </div>
                  </div>
                {/each}

                {#if activeRun.status === "awaiting_approval"}
                  <div class="rounded border border-[var(--sym-accent)] bg-[var(--sym-card)] p-3">
                    <p class="text-xs font-semibold">{activeRun.stepStates[activeRun.currentStepIndex]?.approvalMessage}</p>
                    <input type="text" bind:value={rejectFeedback} placeholder="Not..." class="mt-2 w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-1 text-xs" />
                    <div class="mt-2 flex gap-2">
                      <button type="button" onclick={() => decideApproval(true)} class="rounded bg-[var(--sym-success)] px-3 py-1 text-xs font-semibold text-white">Onayla</button>
                      <button type="button" onclick={() => decideApproval(false)} class="rounded border border-[var(--sym-error)] px-3 py-1 text-xs font-semibold text-[var(--sym-error)]">Tekrar</button>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>

  {:else if activeModal === "tools"}
    <div class="flex h-[78vh] flex-col">
      <div class="flex items-center justify-between border-b border-[var(--sym-border)] px-5 py-3">
        <div class="flex items-center gap-2">
          <Wrench class="h-4 w-4 text-[var(--sym-primary)]" />
          <h2 id="sym-modal-title" class="text-sm font-bold">{tr(lang, "tools")}</h2>
        </div>
        <button type="button" onclick={() => (activeModal = "none")} aria-label={tr(lang, "close")} class="rounded p-1 hover:bg-[var(--sym-surface)]">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex gap-1">
            {#each [{ id: "all", l: lang === "en" ? "All" : "Tümü" }, { id: "installed", l: lang === "en" ? "Installed" : "Kurulu" }, { id: "free", l: lang === "en" ? "Free" : "Ücretsiz" }, { id: "local", l: lang === "en" ? "Local" : "Yerel" }] as f}
              <button type="button" onclick={() => (toolFilter = f.id as any)} class="rounded px-2.5 py-1 text-xs {toolFilter === f.id ? 'bg-[var(--sym-text)] text-[var(--sym-bg)] font-medium' : 'border border-[var(--sym-border)]'}">
                {f.l}
              </button>
            {/each}
          </div>
          <div class="flex items-center gap-1.5">
            <input type="url" bind:value={mcpUrl} placeholder="MCP HTTP URL..." class="w-64 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs outline-none" />
            <button type="button" onclick={connectMcp} class="rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">MCP</button>
          </div>
        </div>
        {#if mcpStatus}<p class="font-mono text-xs text-[var(--sym-text-muted)]">{mcpStatus}</p>{/if}

        <div class="grid gap-3 sm:grid-cols-2">
          {#each filteredTools as tool}
            <div class="flex flex-col justify-between rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3.5">
              <div>
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-xs font-bold">{tool.name}</div>
                    <div class="font-mono text-[10px] text-[var(--sym-text-muted)]">{tool.publisher} · {tool.ui?.slash || tool.category}</div>
                  </div>
                  <span class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-1.5 py-0.5 font-mono text-[10px]">{tool.cost.model}</span>
                </div>
                <p class="mt-1.5 text-xs text-[var(--sym-text-muted)]">{tool.description}</p>
              </div>
              <div class="mt-3 flex items-center justify-between border-t border-[var(--sym-border)] pt-2.5">
                {#if tool.installed}
                  <select
                    aria-label={tool.name}
                    value={tool.policy || "allow_project"}
                    onchange={async (e) => { await api.setToolPermission(tool.id, (e.target as HTMLSelectElement).value); await onRefresh(); }}
                    class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-[11px]"
                  >
                    <option value="ask_every_time">Her seferinde sor</option>
                    <option value="allow_thread">Bu sohbette</option>
                    <option value="allow_project">Bu projede</option>
                    <option value="allow_always">Her zaman</option>
                    <option value="block">Engelle</option>
                  </select>
                  <span class="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--sym-success)]"><Check class="h-3 w-3" /> OK</span>
                {:else}
                  <span class="font-mono text-[11px] text-[var(--sym-text-muted)]">v{tool.version}</span>
                  <button type="button" onclick={async () => { await api.installTool(tool.id); await onRefresh(); }} class="rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">
                    {lang === "en" ? "Install" : "Kur"}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

  {:else if activeModal === "settings"}
    <div class="flex h-[82vh] flex-col">
      <div class="flex items-center justify-between border-b border-[var(--sym-border)] px-5 py-3">
        <h2 id="sym-modal-title" class="text-sm font-bold">{tr(lang, "settings")}</h2>
        <button type="button" onclick={() => (activeModal = "none")} aria-label={tr(lang, "close")} class="rounded p-1 hover:bg-[var(--sym-surface)]">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-12">
        <nav class="border-r border-[var(--sym-border)] bg-[var(--sym-surface)] p-2 md:col-span-3 space-y-0.5">
          {#each [
            { id: "providers", label: tr(lang, "providersTab") },
            { id: "roles", label: tr(lang, "rolesTab") },
            { id: "appearance", label: tr(lang, "appearanceTab") },
            { id: "general", label: tr(lang, "chatTab") },
            { id: "memory", label: tr(lang, "memoryTab") },
            { id: "shortcuts", label: tr(lang, "shortcutsTab") },
            { id: "about", label: tr(lang, "aboutTab") },
          ] as t}
            <button
              type="button"
              onclick={() => {
                settingsTab = t.id as any;
                if (t.id === "memory") void loadMemoryAndFiles();
              }}
              class="w-full rounded px-2.5 py-2 text-left text-xs font-medium {settingsTab === t.id
                ? 'bg-[var(--sym-text)] text-[var(--sym-bg)]'
                : 'text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface-2)] hover:text-[var(--sym-text)]'}"
            >
              {t.label}
            </button>
          {/each}
        </nav>

        <div class="overflow-y-auto p-5 md:col-span-9 space-y-4">
          {#if settingsTab === "providers"}
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-[var(--sym-text-muted)] flex items-center gap-1.5">
                <KeyRound class="h-3.5 w-3.5" /> {tr(lang, "providersTab")}
              </h3>
              <p class="mt-1 text-xs text-[var(--sym-text-muted)]">
                {lang === "en"
                  ? "Connect any LLM, image engine, local model, or custom endpoint. Add any custom model ID freely."
                  : "İstediğin LLM, görsel motoru (Flux, Stability, Ideogram, OpenAI, ComfyUI), yerel Ollama veya özel uç noktayı bağla. Her sağlayıcıya dilediğin model ID'sini serbestçe ekle."}
              </p>
            </div>

            <div class="space-y-2.5">
              {#each providers as prov}
                <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold text-white" style={`background: ${prov.badgeColor}`}>
                        {prov.badgeLetter}
                      </span>
                      <div>
                        <div class="text-xs font-bold">{prov.displayName}</div>
                        <div class="font-mono text-[10px] text-[var(--sym-text-muted)]">
                          @{prov.alias || prov.id} · {prov.models.length} model {prov.maskedKey ? `· ${prov.maskedKey}` : ""}
                        </div>
                      </div>
                    </div>
                    <span class="font-mono text-[10px] {prov.hasKey || prov.auth === 'none' ? 'text-[var(--sym-success)]' : 'text-[var(--sym-text-muted)]'}">
                      {prov.hasKey ? "CONNECTED" : prov.auth === "none" ? "LOCAL / FREE" : "API KEY"}
                    </span>
                  </div>

                  {#if prov.auth === "api_key"}
                    <div class="flex gap-1.5">
                      <input
                        type="password"
                        bind:value={keyInputs[prov.id]}
                        placeholder={prov.maskedKey || `${prov.displayName} API Key...`}
                        class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs outline-none"
                      />
                      <button type="button" onclick={() => saveAndTestProvider(prov)} class="rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">
                        {lang === "en" ? "Save & Test" : "Kaydet & Test"}
                      </button>
                    </div>
                  {:else if prov.id === "ollama"}
                    <div class="flex gap-1.5">
                      <input type="text" bind:value={baseUrlInputs[prov.id]} placeholder={prov.baseUrl || "http://localhost:11434"} class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs" />
                      <button type="button" onclick={detectOllama} class="inline-flex items-center gap-1 rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">
                        <RefreshCw class="h-3 w-3" /> {ollamaStatus || (lang === "en" ? "Detect" : "Algıla")}
                      </button>
                    </div>
                  {/if}

                  <!-- Unrestricted: Add ANY custom model ID to this provider -->
                  <div class="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      bind:value={customModelInputs[prov.id]}
                      placeholder={tr(lang, "customModelPlaceholder")}
                      class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 font-mono text-[11px] outline-none"
                    />
                    <select
                      value={customModelKind[prov.id] || "chat"}
                      onchange={(e) => (customModelKind[prov.id] = (e.target as HTMLSelectElement).value as any)}
                      class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-[11px]"
                    >
                      <option value="chat">LLM / Kod</option>
                      <option value="image">Görsel</option>
                    </select>
                    <button
                      type="button"
                      onclick={() => addCustomModelToProvider(prov.id)}
                      class="rounded border border-[var(--sym-border-strong)] bg-[var(--sym-card)] px-2.5 py-1 text-[11px] font-medium hover:border-[var(--sym-primary)]"
                    >
                      + {tr(lang, "addModel")}
                    </button>
                  </div>

                  {#if testStatus[prov.id]}
                    <p class="font-mono text-[11px] {testStatus[prov.id].ok ? 'text-[var(--sym-success)]' : 'text-[var(--sym-error)]'}">
                      {testStatus[prov.id].message}
                    </p>
                  {/if}
                </div>
              {/each}
            </div>

            <!-- Add Any Custom OpenAI-Compatible Endpoint -->
            <div class="rounded-lg border border-dashed border-[var(--sym-border-strong)] p-3.5">
              <div class="mb-2 text-xs font-bold">{lang === "en" ? "Add Any Custom Endpoint (LM Studio, vLLM, Groq, Together, Mistral...)" : "İstediğin Özel Uç Noktayı Ekle (LM Studio, vLLM, Groq, Mistral...)"}</div>
              <div class="grid gap-2 sm:grid-cols-2">
                <input bind:value={customProvName} placeholder="Ad (ör. LM Studio)" class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs" />
                <input bind:value={customProvAlias} placeholder="@etiket (ör. lm)" class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs" />
                <input bind:value={customProvUrl} placeholder="Base URL (http://localhost:1234/v1)" class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs" />
                <input type="password" bind:value={customProvKey} placeholder="API Key (opsiyonel)" class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs" />
              </div>
              <button type="button" onclick={addCustomProvider} class="mt-2 inline-flex items-center gap-1 rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">
                <Plus class="h-3.5 w-3.5" /> {tr(lang, "add")}
              </button>
            </div>

          {:else if settingsTab === "roles"}
            <div class="space-y-2">
              {#each roles as role}
                <div class="grid gap-2 rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3 sm:grid-cols-12 items-center">
                  <div class="sm:col-span-4">
                    <div class="text-xs font-bold">{lang === "en" ? role.nameEn : role.name}</div>
                    <div class="font-mono text-[10px] text-[var(--sym-text-muted)]">@{role.mention}</div>
                  </div>
                  <div class="sm:col-span-4">
                    <label for={`role-p-${role.id}`} class="block text-[10px] text-[var(--sym-text-muted)]">Primary</label>
                    <select
                      id={`role-p-${role.id}`}
                      value={`${role.primaryProviderId}::${role.primaryModelId}`}
                      onchange={async (e) => {
                        const [pid, mid] = (e.target as HTMLSelectElement).value.split("::");
                        await api.saveRole({ ...role, primaryProviderId: pid, primaryModelId: mid });
                        await onRefresh();
                      }}
                      class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs"
                    >
                      {#each allSelectableModels as opt}<option value={opt.value}>{opt.label}</option>{/each}
                    </select>
                  </div>
                  <div class="sm:col-span-4">
                    <label for={`role-f-${role.id}`} class="block text-[10px] text-[var(--sym-text-muted)]">Fallback</label>
                    <select
                      id={`role-f-${role.id}`}
                      value={`${role.fallbackProviderId || "demo"}::${role.fallbackModelId || "demo-gpt"}`}
                      onchange={async (e) => {
                        const [pid, mid] = (e.target as HTMLSelectElement).value.split("::");
                        await api.saveRole({ ...role, fallbackProviderId: pid, fallbackModelId: mid });
                        await onRefresh();
                      }}
                      class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs"
                    >
                      {#each allSelectableModels as opt}<option value={opt.value}>{opt.label}</option>{/each}
                    </select>
                  </div>
                </div>
              {/each}
            </div>

          {:else if settingsTab === "appearance"}
            <div class="space-y-4">
              <div>
                <h3 class="mb-2 text-xs font-bold">{lang === "en" ? "Language" : "Dil"}</h3>
                <div class="flex gap-2">
                  {#each [{ id: "tr", l: "Türkçe" }, { id: "en", l: "English" }] as l}
                    <button
                      type="button"
                      onclick={() => onUpdateSettings({ language: l.id as LanguageCode })}
                      class="rounded border px-4 py-2 text-xs font-medium {settings.language === l.id ? 'border-[var(--sym-primary)] bg-[var(--sym-surface)] font-semibold' : 'border-[var(--sym-border)]'}"
                    >
                      {l.l}
                    </button>
                  {/each}
                </div>
              </div>
              <div>
                <h3 class="mb-2 text-xs font-bold">{lang === "en" ? "Theme" : "Tema"}</h3>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {#each [{ id: "system", l: tr(lang, "themeSystem") }, { id: "light", l: tr(lang, "themeLight") }, { id: "dark", l: tr(lang, "themeDark") }, { id: "high-contrast", l: "High Contrast" }] as th}
                    <button
                      type="button"
                      onclick={() => { applyTheme(th.id as any); onUpdateSettings({ theme: th.id as any }); }}
                      class="rounded border p-2 text-xs font-medium {settings.theme === th.id ? 'border-[var(--sym-primary)] bg-[var(--sym-surface)] font-semibold' : 'border-[var(--sym-border)]'}"
                    >
                      {th.l}
                    </button>
                  {/each}
                </div>
              </div>
            </div>

          {:else if settingsTab === "general"}
            <div class="space-y-3 text-xs">
              <div>
                <label for="sym-sctx" class="mb-1 block font-bold">{lang === "en" ? "Shared Context" : "Ortak Bağlam"}</label>
                <select
                  id="sym-sctx"
                  value={settings.sharedContext}
                  onchange={(e) => onUpdateSettings({ sharedContext: (e.target as HTMLSelectElement).value as any })}
                  class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5"
                >
                  <option value="full">Tam paylaşım / Full shared history</option>
                  <option value="own_plus_user">Kendi + kullanıcı / Own + user only</option>
                  <option value="transferred_only">Sadece aktarılan / Transferred only</option>
                </select>
              </div>
              <label class="flex items-center justify-between rounded border border-[var(--sym-border)] p-3">
                <span class="font-medium">Ekonomi Modu / Economy Mode</span>
                <input type="checkbox" checked={settings.economyMode} onchange={(e) => onUpdateSettings({ economyMode: (e.target as HTMLInputElement).checked })} class="h-4 w-4 accent-[var(--sym-primary)]" />
              </label>
              <label class="flex items-center justify-between rounded border border-[var(--sym-border)] p-3">
                <div>
                  <div class="font-medium">{lang === "en" ? "Token & Cost Optimizer (History Compression)" : "Token & Maliyet Optimizasyonu (Bağlam Sıkıştırma)"}</div>
                  <div class="text-[11px] text-[var(--sym-text-muted)]">
                    {lang === "en" ? "Compresses verbose older code/tool turns while preserving pinned messages & latest turns." : "Sabit mesajları ve son 2 turu koruyarak eski uzun kod/araç çıktılarını sıkıştırır (%30-65 tasarruf)."}
                  </div>
                </div>
                <input type="checkbox" checked={settings.tokenOptimizationEnabled !== false} onchange={(e) => onUpdateSettings({ tokenOptimizationEnabled: (e.target as HTMLInputElement).checked })} class="h-4 w-4 accent-[var(--sym-primary)]" />
              </label>
              <label class="flex items-center justify-between rounded border border-[var(--sym-border)] p-3">
                <div>
                  <div class="font-medium">{lang === "en" ? "AI Slop Blocker (Strict Craft Mode)" : "AI Slop Blocker (Sıkı Kalite & Anti-Slop Modu)"}</div>
                  <div class="text-[11px] text-[var(--sym-text-muted)]">
                    {lang === "en" ? "Injects anti-cliché prose & editorial UI directives, blocks generic purple-gradient UI slop, and scores every output." : "Klişe metinleri, yağcılığı, emoji spam'ini ve jenerik mor-gradyan AI-slop arayüzlerini engeller; her çıktıya Craft skoru verir."}
                  </div>
                </div>
                <input type="checkbox" checked={settings.aiSlopBlockerEnabled !== false} onchange={(e) => onUpdateSettings({ aiSlopBlockerEnabled: (e.target as HTMLInputElement).checked })} class="h-4 w-4 accent-[var(--sym-primary)]" />
              </label>
              <div>
                <label for="sym-sthr" class="mb-1 block font-bold">Auto-Summarize: %{settings.autoSummarizeThreshold}</label>
                <input id="sym-sthr" type="range" min="50" max="95" value={settings.autoSummarizeThreshold} onchange={(e) => onUpdateSettings({ autoSummarizeThreshold: Number((e.target as HTMLInputElement).value) })} class="w-full accent-[var(--sym-primary)]" />
              </div>
            </div>

          {:else if settingsTab === "memory"}
            <div class="space-y-4">
              {#if activeProject}
                <div>
                  <label for="sym-pinst" class="mb-1 block text-xs font-bold">{activeProject.name} — Instructions</label>
                  <textarea id="sym-pinst" bind:value={projectInstructions} rows="3" class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] p-2.5 text-xs outline-none"></textarea>
                  <button type="button" onclick={async () => { await api.updateProject(activeProject.id, { instructions: projectInstructions }); await onRefresh(); }} class="mt-1.5 rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]">
                    {tr(lang, "save")}
                  </button>
                </div>
              {/if}

              <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
                <div class="mb-2 flex gap-1.5">
                  <select bind:value={newMemoryScope} class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-xs">
                    <option value="project">Project</option>
                    <option value="personal">Personal</option>
                  </select>
                  <input bind:value={newMemoryText} placeholder="..." class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs" />
                  <button
                    type="button"
                    onclick={async () => {
                      if (!newMemoryText.trim()) return;
                      await api.addMemory({ scope: newMemoryScope, projectId: newMemoryScope === "project" ? activeProject?.id : undefined, content: newMemoryText.trim() });
                      newMemoryText = "";
                      await loadMemoryAndFiles();
                    }}
                    class="rounded bg-[var(--sym-text)] px-3 py-1 text-xs font-medium text-[var(--sym-bg)]"
                  >
                    {tr(lang, "add")}
                  </button>
                </div>
                <div class="space-y-1">
                  {#each memories as mem}
                    <div class="flex items-center justify-between rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs">
                      <span><code class="text-[10px]">[{mem.scope}]</code> {mem.content}</span>
                      <button type="button" onclick={async () => { await api.deleteMemory(mem.id); await loadMemoryAndFiles(); }} class="text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]"><Trash2 class="h-3.5 w-3.5" /></button>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-bold">Indexed Project Files</span>
                  <label class="inline-flex cursor-pointer items-center gap-1 rounded bg-[var(--sym-text)] px-2.5 py-1 text-xs font-medium text-[var(--sym-bg)]">
                    <Upload class="h-3 w-3" /> Upload
                    <input type="file" onchange={handleFileUpload} class="hidden" />
                  </label>
                </div>
                {#each projectFiles as f}
                  <div class="mb-1 flex items-center justify-between rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2.5 py-1 text-xs">
                    <span class="font-mono">{f.name}</span>
                    <button type="button" onclick={async () => { await api.deleteFile(f.id); await loadMemoryAndFiles(); }} class="text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]"><Trash2 class="h-3.5 w-3.5" /></button>
                  </div>
                {/each}
              </div>
            </div>

          {:else if settingsTab === "shortcuts"}
            <div class="space-y-1">
              {#each shortcuts as sc}
                <div class="flex items-center justify-between rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-3 py-1.5 text-xs">
                  <span>{lang === "en" ? sc.descEn : sc.descTr}</span>
                  <kbd class="rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-0.5 font-mono text-[11px]">{sc.keys}</kbd>
                </div>
              {/each}
            </div>

          {:else if settingsTab === "about"}
            <div class="space-y-3 text-xs">
              <div class="rounded-lg border border-[var(--sym-border)] bg-[var(--sym-surface)] p-4">
                <div class="font-mono text-sm font-bold">SYMFORYX · by ozkandev</div>
                <p class="mt-1 text-[var(--sym-text-muted)]">v1.0.0 · Local-first AI Orchestra · Native macOS SwiftUI + Web</p>
              </div>
              <a href="/api/v1/data/export" class="inline-flex items-center gap-1.5 rounded bg-[var(--sym-text)] px-3.5 py-2 font-medium text-[var(--sym-bg)]">
                <Download class="h-3.5 w-3.5" /> Export All Data (JSON)
              </a>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</dialog>
