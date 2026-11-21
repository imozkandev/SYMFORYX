<script lang="ts">
  import type {
    Artifact,
    ExperienceMode,
    LanguageCode,
    ProviderConfig,
    ReferenceItem,
    ReferenceRole,
    TaskRole,
    ToolManifest,
    WorkMode,
  } from "@symforyx/core";
  import { refRoleLabel, tr } from "$lib/i18n";
  import {
    ArrowUp,
    Square,
    Paperclip,
    Wrench,
    Pin,
    SlidersHorizontal,
    X,
    Cpu,
    ImagePlus,
    Lightbulb,
    Globe,
  } from "lucide-svelte";

  let {
    draft = $bindable(""),
    lang = "tr",
    mode,
    experienceMode,
    providers,
    roles,
    tools,
    artifacts,
    commands,
    selectedModel,
    pinnedModel,
    enabledToolIds,
    isStreaming,
    contextStats,
    attachments = $bindable([]),
    references = $bindable([]),
    onSend,
    onStop,
    onChangeMode,
    onSelectModel,
    onPinModel,
    onToggleTool,
    onAttachFile,
    onAddReferenceImage,
    onAddReferenceUrl,
    onEditLastMessage,
    onOpenContextManager,
  }: {
    draft: string;
    lang: LanguageCode;
    mode: WorkMode;
    experienceMode: ExperienceMode;
    providers: ProviderConfig[];
    roles: TaskRole[];
    tools: ToolManifest[];
    artifacts: Artifact[];
    commands: Array<{ command: string; aliases?: string[]; category?: string; descTr: string; descEn: string; example: string }>;
    selectedModel: { providerId: string; modelId: string; label: string } | null;
    pinnedModel: { providerId: string; modelId: string } | null;
    enabledToolIds: string[];
    isStreaming: boolean;
    contextStats: { fillPercent: number; pinnedCount: number; summaryCount: number; usedTokens: number; remainingTokens?: number; contextWindow: number; savedTokens?: number };
    attachments: Array<{ artifactId: string; kind: "image" | "file"; mime: string; name: string }>;
    references: ReferenceItem[];
    onSend: (text: string) => void;
    onStop: () => void;
    onChangeMode: (m: WorkMode) => void;
    onSelectModel: (m: { providerId: string; modelId: string; label: string } | null) => void;
    onPinModel: () => void;
    onToggleTool: (id: string) => void;
    onAttachFile: (file: File) => void;
    onAddReferenceImage: (file: File, role: ReferenceRole) => void;
    onAddReferenceUrl: (url: string, note: string) => void;
    onEditLastMessage: () => void;
    onOpenContextManager: () => void;
  } = $props();

  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let refImgInputEl: HTMLInputElement | undefined = $state();
  let openPopover = $state<"none" | "mode" | "model" | "tools" | "idea" | "url">("none");
  let modelFilter = $state<"all" | "chat" | "image">("all");
  let modelSearch = $state("");

  // Reference Idea & URL draft
  let ideaTitle = $state("");
  let ideaNote = $state("");
  let ideaRole = $state<ReferenceRole>("inspiration");
  let refUrlInput = $state("");
  let refUrlNote = $state("");

  const MODES: Array<{ id: WorkMode; tr: string; en: string; descTr: string; descEn: string; expertOnly?: boolean }> = [
    { id: "smart", tr: "Akıllı", en: "Smart", descTr: "İsteği anlar, en uygun modeli seçer", descEn: "Routes automatically to best role" },
    { id: "manual", tr: "Serbest / Manuel", en: "Direct / Manual", descTr: "Tam kontrol: seçtiğin modele gider", descEn: "Full control: exact model chosen" },
    { id: "chain", tr: "Zincir", en: "Chain", descTr: "Çıktıyı sırayla başka modele aktar", descEn: "Pipe output across models", expertOnly: true },
    { id: "compare", tr: "Karşılaştır", en: "Compare", descTr: "Birden çok modeli yan yana çalıştır", descEn: "Side-by-side parallel outputs", expertOnly: true },
    { id: "council", tr: "Konsey", en: "Council", descTr: "Üretici → Eleştirmenler → Hakem", descEn: "Producer → Critics → Judge", expertOnly: true },
    { id: "agent", tr: "Ajan", en: "Agent", descTr: "Planla, araç kullan, adım adım çöz", descEn: "Plan, invoke tools, synthesize", expertOnly: true },
  ];

  const visibleModes = $derived(
    experienceMode === "simple" ? MODES.filter((m) => !m.expertOnly) : MODES
  );

  // Live @, /, # Autocomplete including ALL providers
  const autocomplete = $derived.by(() => {
    const val = draft;
    if (!val) return null;

    if (val.startsWith("/") && !val.includes(" ")) {
      const q = val.slice(1).toLowerCase();
      const items = commands
        .filter(
          (c) =>
            c.command.slice(1).toLowerCase().includes(q) ||
            (c.aliases ?? []).some((a) => a.slice(1).toLowerCase().includes(q)) ||
            c.descEn.toLowerCase().includes(q) ||
            c.descTr.toLowerCase().includes(q) ||
            (c.category ?? "").toLowerCase().includes(q)
        )
        .map((c) => ({
          insert: c.command + " ",
          title: c.command,
          badge: c.category ?? "",
          subtitle: lang === "en" ? c.descEn : c.descTr,
        }));
      return items.length ? { kind: "slash", items } : null;
    }

    const mentionMatch = val.match(/(?:^|\s)@([a-zA-Z0-9_\-ğüşıöç]*)$/);
    if (mentionMatch) {
      const q = mentionMatch[1].toLowerCase();
      const provMentions = providers
        .filter((p) => p.enabled)
        .map((p) => ({
          token: `@${p.alias || p.id}`,
          title: `@${p.alias || p.id}`,
          subtitle: p.displayName,
        }));
      const roleMentions = roles.map((r) => ({
        token: `@${r.mention}`,
        title: `@${r.mention}`,
        subtitle: lang === "en" ? r.nameEn : r.name,
      }));
      const unique = Array.from(
        new Map(
          [
            ...provMentions,
            ...roleMentions,
            { token: "@herkes", title: "@herkes", subtitle: lang === "en" ? "Parallel compare" : "Tüm modellere paralel" },
          ].map((x) => [x.token, x])
        ).values()
      );
      const items = unique
        .filter((m) => m.token.slice(1).includes(q))
        .slice(0, 8)
        .map((m) => ({
          insert: val.slice(0, val.length - mentionMatch[1].length - 1) + m.token + " ",
          title: m.title,
          badge: "",
          subtitle: m.subtitle,
        }));
      return items.length ? { kind: "mention", items } : null;
    }

    const hashMatch = val.match(/(?:^|\s)#([a-zA-Z0-9_\-\.]*)$/);
    if (hashMatch && artifacts.length > 0) {
      const q = hashMatch[1].toLowerCase();
      const items = artifacts
        .filter((a) => a.title.toLowerCase().includes(q) || a.id.includes(q))
        .slice(0, 6)
        .map((a) => ({
          insert: val.slice(0, val.length - hashMatch[1].length - 1) + `#${a.id} `,
          title: `#${a.title}`,
          badge: a.kind,
          subtitle: `${a.kind} · ${a.id}`,
        }));
      return items.length ? { kind: "hash", items } : null;
    }
    return null;
  });

  function addIdeaReference() {
    if (!ideaTitle.trim() && !ideaNote.trim()) return;
    references = [
      ...references,
      {
        id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "idea",
        role: ideaRole,
        title: ideaTitle.trim() || refRoleLabel(lang, ideaRole),
        note: ideaNote.trim() || undefined,
      },
    ];
    ideaTitle = "";
    ideaNote = "";
    openPopover = "none";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        onChangeMode("compare");
        submit();
        return;
      }
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && draft.trim() === "") {
      e.preventDefault();
      onEditLastMessage();
    } else if (e.key === "Escape") {
      openPopover = "none";
      if (isStreaming) onStop();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          if (file.type.startsWith("image/")) onAddReferenceImage(file, "style");
          else onAttachFile(file);
        }
      }
    }
  }

  function submit() {
    if (!draft.trim() && attachments.length === 0 && references.length === 0) return;
    openPopover = "none";
    const text = draft;
    draft = "";
    onSend(text);
  }

  const installedTools = $derived(tools.filter((t) => t.installed));
  const currentModeObj = $derived(MODES.find((m) => m.id === mode) ?? MODES[0]);

  // Live Pre-Send Per-Prompt Cost Estimate (updates instantaneously as you type or add references)
  const livePromptEstimate = $derived.by(() => {
    const refText = references.map((r) => `${r.title} ${r.note || ""}`).join(" ");
    const refImgCount = references.filter((r) => r.kind === "image").length + attachments.filter((a) => a.kind === "image").length;
    const inTokens = Math.max(0, Math.ceil((draft.length + refText.length) / 3.8)) + refImgCount * 320;
    const outTokens = inTokens > 0 ? Math.min(2000, Math.max(350, inTokens * 2)) : 0;

    const targetProv = selectedModel
      ? providers.find((p) => p.id === selectedModel.providerId)
      : providers.find((p) => p.id === "anthropic" && p.hasKey) ?? providers.find((p) => p.id === "demo");
    const targetMod = selectedModel
      ? targetProv?.models.find((m) => m.id === selectedModel.modelId)
      : targetProv?.models[0];

    const isLocal = Boolean(targetMod?.local || targetProv?.id === "ollama" || targetProv?.id === "comfyui" || targetProv?.id === "demo");
    const isImg = Boolean(targetMod?.capabilities.includes("image.generate") && !targetMod?.capabilities.includes("chat"));
    const pricing = targetMod?.pricing ?? { inputPerMTok: 0, outputPerMTok: 0 };

    const perCall =
      inTokens === 0 && !isImg
        ? 0
        : isImg
        ? pricing.perImage ?? 0.04
        : (inTokens / 1_000_000) * pricing.inputPerMTok + (outTokens / 1_000_000) * pricing.outputPerMTok;

    const mult = mode === "compare" ? 3 : mode === "council" ? 4 : mode === "agent" ? 3 : 1;
    return {
      inTokens,
      costUsd: Number((perCall * mult).toFixed(5)),
      mult,
      isLocal,
    };
  });

  const filteredProviders = $derived(
    providers
      .filter((p) => p.enabled && p.models.length > 0)
      .map((p) => ({
        ...p,
        models: p.models.filter((m) => {
          const isImg = m.capabilities.includes("image.generate");
          if (modelFilter === "image" && !isImg) return false;
          if (modelFilter === "chat" && isImg && !m.capabilities.includes("chat")) return false;
          if (modelSearch.trim()) {
            const q = modelSearch.toLowerCase();
            return (
              m.displayName.toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              p.displayName.toLowerCase().includes(q)
            );
          }
          return true;
        }),
      }))
      .filter((p) => p.models.length > 0)
  );
</script>

<div class="relative mx-auto w-full max-w-4xl px-4 pb-4 pt-2">
  <!-- Context Telemetry Strip -->
  <div class="mb-1.5 flex items-center justify-between px-0.5 text-[11px] text-[var(--sym-text-muted)] tabular-nums">
    <div class="flex items-center gap-2.5">
      <span class="font-medium">{tr(lang, "context")}</span>
      <div class="h-1 w-24 overflow-hidden rounded-sm bg-[var(--sym-surface-2)]">
        <div
          class="h-full transition-all"
          style={`width: ${Math.max(4, contextStats.fillPercent)}%; background: ${
            contextStats.fillPercent >= 80 ? 'var(--sym-warning)' : 'var(--sym-primary)'
          };`}
        ></div>
      </div>
      <span class="font-mono">%{contextStats.fillPercent}</span>
      <span>· {contextStats.pinnedCount} {tr(lang, "pinned")}</span>
      <span>· {contextStats.summaryCount} {tr(lang, "summaries")}</span>
    </div>
    <button type="button" onclick={onOpenContextManager} class="hover:text-[var(--sym-text)]">
      {tr(lang, "manage")}
    </button>
  </div>

  <!-- Autocomplete (Full Scrollable Command / Mention / Artifact List) -->
  {#if autocomplete}
    <div class="absolute bottom-full left-4 right-4 mb-1.5 z-30 max-h-72 overflow-y-auto rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-1 shadow-lg">
      <div class="flex items-center justify-between px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--sym-text-muted)] border-b border-[var(--sym-border)] mb-0.5">
        <span>{autocomplete.kind === "slash" ? (lang === "en" ? "Commands" : "Komutlar") : autocomplete.kind === "mention" ? "Models & Roles" : "Artifacts"}</span>
        <span>{autocomplete.items.length}</span>
      </div>
      {#each autocomplete.items as item}
        <button
          type="button"
          onclick={() => {
            draft = item.insert;
            textareaEl?.focus();
          }}
          class="flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-xs hover:bg-[var(--sym-surface)]"
        >
          <span class="flex items-center gap-2 shrink-0">
            <span class="font-mono font-semibold text-[var(--sym-primary)]">{item.title}</span>
            {#if item.badge}
              <span lang="en" class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[var(--sym-text-muted)]">
                {item.badge}
              </span>
            {/if}
          </span>
          <span class="truncate text-[var(--sym-text-muted)]">{item.subtitle}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Popovers -->
  {#if openPopover === "mode"}
    <div class="absolute bottom-full left-4 mb-1.5 z-30 w-72 rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-1.5 shadow-lg">
      {#each visibleModes as m}
        <button
          type="button"
          onclick={() => {
            onChangeMode(m.id);
            openPopover = "none";
          }}
          class="flex w-full flex-col rounded px-2.5 py-2 text-left hover:bg-[var(--sym-surface)] {mode === m.id ? 'bg-[var(--sym-surface)] border-l-2 border-[var(--sym-primary)]' : ''}"
        >
          <span class="text-xs font-semibold">{lang === "en" ? m.en : m.tr}</span>
          <span class="text-[11px] text-[var(--sym-text-muted)]">{lang === "en" ? m.descEn : m.descTr}</span>
        </button>
      {/each}
    </div>

  {:else if openPopover === "model"}
    <div class="absolute bottom-full left-24 mb-1.5 z-30 w-96 max-w-[90vw] rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-2 shadow-xl">
      <div class="mb-2 flex items-center gap-1.5">
        <input
          type="text"
          bind:value={modelSearch}
          placeholder={lang === "en" ? "Filter any model or image engine..." : "Herhangi bir model veya görsel motoru ara..."}
          class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs outline-none focus:border-[var(--sym-primary)]"
        />
        <div class="flex rounded border border-[var(--sym-border)] text-[11px]">
          {#each [{ id: "all", l: lang === "en" ? "All" : "Tümü" }, { id: "chat", l: "LLM" }, { id: "image", l: lang === "en" ? "Image" : "Görsel" }] as f}
            <button
              type="button"
              onclick={() => (modelFilter = f.id as any)}
              class="px-2 py-1 {modelFilter === f.id ? 'bg-[var(--sym-text)] text-[var(--sym-bg)] font-medium' : 'text-[var(--sym-text-muted)]'}"
            >
              {f.l}
            </button>
          {/each}
        </div>
      </div>

      <div class="max-h-72 overflow-y-auto">
        <button
          type="button"
          onclick={() => {
            onSelectModel(null);
            openPopover = "none";
          }}
          class="mb-1 flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs hover:bg-[var(--sym-surface)] {!selectedModel ? 'bg-[var(--sym-surface)] font-semibold text-[var(--sym-primary)]' : ''}"
        >
          <span>{tr(lang, "autoModel")} ({lang === "en" ? "Smart Router" : "Akıllı Yönlendirici"})</span>
        </button>
        {#each filteredProviders as prov}
          <div class="mt-2 flex items-center justify-between px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
            <span>{prov.displayName}</span>
            {#if prov.auth === "api_key" && !prov.hasKey}
              <span class="text-[var(--sym-warning)]">{lang === "en" ? "No key" : "Anahtar yok"}</span>
            {/if}
          </div>
          {#each prov.models as m}
            <button
              type="button"
              onclick={() => {
                onSelectModel({ providerId: prov.id, modelId: m.id, label: m.displayName });
                openPopover = "none";
              }}
              class="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs hover:bg-[var(--sym-surface)] {selectedModel?.modelId === m.id ? 'bg-[var(--sym-surface)] font-semibold text-[var(--sym-primary)]' : ''}"
            >
              <span class="flex items-center gap-2 truncate">
                <span
                  class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                  style={`background: ${prov.badgeColor}`}
                >
                  {prov.badgeLetter}
                </span>
                <span class="truncate">{m.displayName}</span>
              </span>
              <span class="ml-2 shrink-0 font-mono text-[10px] text-[var(--sym-text-muted)]">
                {m.capabilities.includes("image.generate") ? "IMG" : m.local ? "LOCAL" : "LLM"}
              </span>
            </button>
          {/each}
        {/each}
      </div>
    </div>

  {:else if openPopover === "tools"}
    <div class="absolute bottom-full left-48 mb-1.5 z-30 w-72 rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-1.5 shadow-lg">
      {#each installedTools as tool}
        {@const active = enabledToolIds.includes(tool.id)}
        <label class="flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-xs hover:bg-[var(--sym-surface)]">
          <div>
            <div class="font-medium">{tool.name}</div>
            <div class="font-mono text-[10px] text-[var(--sym-text-muted)]">{tool.ui?.slash || tool.category}</div>
          </div>
          <input type="checkbox" checked={active} onchange={() => onToggleTool(tool.id)} class="h-3.5 w-3.5 accent-[var(--sym-primary)]" />
        </label>
      {/each}
    </div>

  {:else if openPopover === "idea"}
    <div class="absolute bottom-full left-4 mb-1.5 z-30 w-96 max-w-[92vw] rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-3 shadow-xl space-y-2">
      <div class="flex items-center justify-between text-xs font-semibold">
        <span>{tr(lang, "refIdeaAdd")}</span>
        <button type="button" onclick={() => (openPopover = "none")} class="text-[var(--sym-text-muted)]"><X class="h-3.5 w-3.5" /></button>
      </div>
      <div class="flex gap-1.5">
        <select bind:value={ideaRole} class="rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-1 text-xs">
          <option value="inspiration">{refRoleLabel(lang, "inspiration")}</option>
          <option value="style">{refRoleLabel(lang, "style")}</option>
          <option value="layout">{refRoleLabel(lang, "layout")}</option>
          <option value="palette">{refRoleLabel(lang, "palette")}</option>
          <option value="constraint">{refRoleLabel(lang, "constraint")}</option>
        </select>
        <input
          type="text"
          bind:value={ideaTitle}
          placeholder={tr(lang, "refTitlePlaceholder")}
          class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs outline-none focus:border-[var(--sym-primary)]"
        />
      </div>
      <textarea
        rows="2"
        bind:value={ideaNote}
        placeholder={tr(lang, "refIdeaPlaceholder")}
        class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] p-2 text-xs outline-none focus:border-[var(--sym-primary)]"
      ></textarea>
      <div class="flex justify-end gap-1.5">
        <button type="button" onclick={() => (openPopover = "none")} class="rounded border border-[var(--sym-border)] px-2.5 py-1 text-xs">{tr(lang, "cancel")}</button>
        <button type="button" onclick={addIdeaReference} class="rounded bg-[var(--sym-primary)] px-3 py-1 text-xs font-medium text-white">{tr(lang, "add")}</button>
      </div>
    </div>

  {:else if openPopover === "url"}
    <div class="absolute bottom-full left-4 mb-1.5 z-30 w-96 max-w-[92vw] rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-3 shadow-xl space-y-2">
      <div class="flex items-center justify-between text-xs font-semibold">
        <span>{lang === "en" ? "Add Website / URL Reference (/referans)" : "Web Sitesi / URL Referansı Ekle (/referans)"}</span>
        <button type="button" onclick={() => (openPopover = "none")} class="text-[var(--sym-text-muted)]"><X class="h-3.5 w-3.5" /></button>
      </div>
      <input
        type="url"
        bind:value={refUrlInput}
        placeholder="https://linear.app"
        class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[var(--sym-primary)]"
      />
      <input
        type="text"
        bind:value={refUrlNote}
        placeholder={lang === "en" ? "What to take from this site? (layout, copy, tone...)" : "Bu siteden ne alalım? (düzen, tipografi, yapı...)"}
        class="w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--sym-primary)]"
      />
      <div class="flex justify-end gap-1.5">
        <button type="button" onclick={() => (openPopover = "none")} class="rounded border border-[var(--sym-border)] px-2.5 py-1 text-xs">{tr(lang, "cancel")}</button>
        <button
          type="button"
          onclick={() => {
            if (!refUrlInput.trim()) return;
            onAddReferenceUrl(refUrlInput.trim(), refUrlNote.trim());
            refUrlInput = "";
            refUrlNote = "";
            openPopover = "none";
          }}
          class="rounded bg-[var(--sym-primary)] px-3 py-1 text-xs font-medium text-white"
        >
          {tr(lang, "add")}
        </button>
      </div>
    </div>
  {/if}

  <!-- Main Architectural Composer Frame -->
  <div class="rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] transition-colors focus-within:border-[var(--sym-primary)]">
    <!-- First-Class Reference Tray (Reference Images + Reference Ideas + Files) -->
    {#if references.length > 0 || attachments.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 border-b border-[var(--sym-border)] bg-[var(--sym-surface)] px-3 py-2">
        {#each references as ref, idx (ref.id)}
          <div class="inline-flex items-center gap-1.5 rounded border border-[var(--sym-border-strong)] bg-[var(--sym-card)] px-2 py-1 text-[11px]">
            {#if ref.kind === "image" && ref.artifactId}
              <img src={`/api/v1/artifacts/${ref.artifactId}?raw=1`} alt={ref.title} class="h-5 w-5 rounded object-cover" />
              <select
                aria-label="Referans rolü"
                value={ref.role}
                onchange={(e) => {
                  const nextRole = (e.target as HTMLSelectElement).value as ReferenceRole;
                  references = references.map((r, i) => (i === idx ? { ...r, role: nextRole } : r));
                }}
                class="bg-transparent font-mono text-[10px] font-semibold text-[var(--sym-primary)] outline-none"
              >
                <option value="style">{refRoleLabel(lang, "style")}</option>
                <option value="layout">{refRoleLabel(lang, "layout")}</option>
                <option value="palette">{refRoleLabel(lang, "palette")}</option>
                <option value="subject">{refRoleLabel(lang, "subject")}</option>
                <option value="edit_source">{refRoleLabel(lang, "edit_source")}</option>
              </select>
            {:else if ref.kind === "url"}
              <Globe class="h-3 w-3 text-[var(--sym-primary)]" />
              <span class="font-mono text-[10px] font-semibold uppercase text-[var(--sym-primary)]">URL</span>
            {:else}
              <span class="font-mono text-[10px] font-semibold uppercase text-[var(--sym-accent)]">
                {refRoleLabel(lang, ref.role)}
              </span>
            {/if}
            <span class="max-w-[160px] truncate font-medium">{ref.title}</span>
            {#if ref.note}
              <span class="max-w-[120px] truncate text-[var(--sym-text-muted)]">— {ref.note}</span>
            {/if}
            <button
              type="button"
              onclick={() => (references = references.filter((_, i) => i !== idx))}
              aria-label="Referansı kaldır"
              class="text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        {/each}

        {#each attachments as att, idx}
          <div class="inline-flex items-center gap-1.5 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-1 text-[11px]">
            <span class="max-w-[140px] truncate font-mono">{att.name}</span>
            <button
              type="button"
              onclick={() => (attachments = attachments.filter((_, i) => i !== idx))}
              aria-label="Eki kaldır"
              class="text-[var(--sym-text-muted)] hover:text-[var(--sym-error)]"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <textarea
      bind:this={textareaEl}
      bind:value={draft}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      rows="2"
      placeholder={tr(lang, "placeholder")}
      class="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm outline-none placeholder:text-[var(--sym-text-muted)]"
    ></textarea>

    <!-- Bottom Controls Rail -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sym-border)] px-2.5 py-2">
      <div class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onclick={() => (openPopover = openPopover === "mode" ? "none" : "mode")}
          class="inline-flex items-center gap-1.5 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs font-medium hover:border-[var(--sym-border-strong)]"
        >
          <SlidersHorizontal class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" />
          <span>{lang === "en" ? currentModeObj.en : currentModeObj.tr}</span>
        </button>

        <div class="inline-flex items-center rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] text-xs">
          <button
            type="button"
            onclick={() => (openPopover = openPopover === "model" ? "none" : "model")}
            class="inline-flex items-center gap-1.5 px-2.5 py-1 font-medium hover:text-[var(--sym-primary)]"
          >
            <Cpu class="h-3.5 w-3.5 text-[var(--sym-primary)]" />
            <span class="max-w-[160px] truncate">{selectedModel ? selectedModel.label : tr(lang, "autoModel")}</span>
          </button>
          {#if selectedModel}
            <button
              type="button"
              onclick={onPinModel}
              title={tr(lang, "pin")}
              class="border-l border-[var(--sym-border)] px-1.5 py-1 {pinnedModel?.modelId === selectedModel.modelId ? 'text-[var(--sym-primary)]' : 'text-[var(--sym-text-muted)]'}"
            >
              <Pin class="h-3 w-3" />
            </button>
          {/if}
        </div>

        <button
          type="button"
          onclick={() => (openPopover = openPopover === "tools" ? "none" : "tools")}
          class="inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs font-medium hover:border-[var(--sym-border-strong)]"
        >
          <Wrench class="h-3.5 w-3.5 text-[var(--sym-text-muted)]" />
          <span class="font-mono text-[11px]">{enabledToolIds.length}</span>
        </button>

        <span class="mx-0.5 h-4 w-px bg-[var(--sym-border)]"></span>

        <!-- Reference Image Button -->
        <input
          bind:this={refImgInputEl}
          type="file"
          accept="image/*"
          class="hidden"
          onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) onAddReferenceImage(file, "style");
            (e.target as HTMLInputElement).value = "";
          }}
        />
        <button
          type="button"
          onclick={() => refImgInputEl?.click()}
          class="inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-bg)] px-2 py-1 text-xs font-medium text-[var(--sym-text-muted)] hover:border-[var(--sym-primary)] hover:text-[var(--sym-text)]"
        >
          <ImagePlus class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{tr(lang, "refImageAdd")}</span>
        </button>

        <!-- Reference Idea Button -->
        <button
          type="button"
          onclick={() => (openPopover = openPopover === "idea" ? "none" : "idea")}
          class="inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-bg)] px-2 py-1 text-xs font-medium text-[var(--sym-text-muted)] hover:border-[var(--sym-accent)] hover:text-[var(--sym-text)]"
        >
          <Lightbulb class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{tr(lang, "refIdeaAdd")}</span>
        </button>

        <!-- Reference Website / URL Button (/referans) -->
        <button
          type="button"
          onclick={() => (openPopover = openPopover === "url" ? "none" : "url")}
          class="inline-flex items-center gap-1 rounded border border-[var(--sym-border)] bg-[var(--sym-bg)] px-2 py-1 text-xs font-medium text-[var(--sym-text-muted)] hover:border-[var(--sym-primary)] hover:text-[var(--sym-text)]"
        >
          <Globe class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">URL</span>
        </button>

        <!-- Generic File Attachment -->
        <input
          bind:this={fileInputEl}
          type="file"
          class="hidden"
          onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) onAttachFile(file);
            (e.target as HTMLInputElement).value = "";
          }}
        />
        <button
          type="button"
          onclick={() => fileInputEl?.click()}
          title="Dosya ekle"
          class="rounded border border-[var(--sym-border)] bg-[var(--sym-bg)] p-1 text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]"
        >
          <Paperclip class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2.5">
        <!-- Live Pre-Send Prompt Cost Estimator -->
        <div
          title={lang === "en" ? "Estimated cost for this prompt before sending" : "Bu prompt gönderilmeden önceki tahmini maliyet"}
          class="hidden sm:inline-flex items-center gap-1.5 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--sym-text-muted)] tabular-nums"
        >
          <span>~{livePromptEstimate.inTokens} tok</span>
          <span>·</span>
          <span class="font-semibold text-[var(--sym-text)]">
            ${livePromptEstimate.costUsd.toFixed(5)}
          </span>
          {#if livePromptEstimate.mult > 1}
            <span class="text-[var(--sym-accent)]">×{livePromptEstimate.mult}</span>
          {:else if livePromptEstimate.isLocal}
            <span>{lang === "en" ? "local" : "yerel"}</span>
          {/if}
        </div>

        {#if isStreaming}
          <button
            type="button"
            onclick={onStop}
            class="inline-flex items-center gap-1.5 rounded bg-[var(--sym-error)] px-3 py-1 text-xs font-semibold text-white"
          >
            <Square class="h-3 w-3 fill-current" /> {tr(lang, "stop")}
          </button>
        {:else}
          <button
            type="button"
            onclick={submit}
            disabled={!draft.trim() && attachments.length === 0 && references.length === 0}
            class="inline-flex items-center gap-1.5 rounded bg-[var(--sym-text)] px-3.5 py-1 text-xs font-semibold text-[var(--sym-bg)] transition-opacity hover:opacity-90 disabled:opacity-35"
          >
            <span>{tr(lang, "send")}</span>
            <ArrowUp class="h-3.5 w-3.5" />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
