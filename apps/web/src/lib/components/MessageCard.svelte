<script lang="ts">
  import type {
    Artifact,
    ExperienceMode,
    LanguageCode,
    ProviderConfig,
    SymMessage,
  } from "@symforyx/core";
  import { renderMarkdown, safeHtml } from "$lib/dom";
  import { tr } from "$lib/i18n";
  import {
    Bookmark,
    Check,
    Copy,
    GitBranch,
    Pin,
    RefreshCw,
    Send,
    Wrench,
    ChevronDown,
    ChevronRight,
    FileCode2,
    ImagePlus,
  } from "lucide-svelte";

  let {
    message,
    lang = "tr",
    artifacts = [],
    providers = [],
    experienceMode = "expert",
    isCompareCandidate = false,
    promptCostSummary = null,
    onHandoff,
    onRegenerate,
    onPin,
    onSaveMemory,
    onSelectCompare,
    onOpenArtifact,
    onUseArtifactAsRef,
    onBranch,
  }: {
    message: SymMessage;
    lang?: LanguageCode;
    artifacts?: Artifact[];
    providers?: ProviderConfig[];
    experienceMode?: ExperienceMode;
    isCompareCandidate?: boolean;
    promptCostSummary?: { costUsd: number; tokens: number; calls: number } | null;
    onHandoff: (msg: SymMessage, providerId: string, modelId: string, instruction: string) => void;
    onRegenerate: (msg: SymMessage) => void;
    onPin: (msg: SymMessage) => void;
    onSaveMemory: (msg: SymMessage) => void;
    onSelectCompare?: (msg: SymMessage) => void;
    onOpenArtifact: (artifactId: string) => void;
    onUseArtifactAsRef?: (artifactId: string) => void;
    onBranch: (msg: SymMessage) => void;
  } = $props();

  let copied = $state(false);
  let showHandoffMenu = $state(false);
  let handoffInstruction = $state("Bu tasarımı temiz HTML ve CSS/Tailwind ile kodla");
  let expandedToolCall = $state(false);

  const isUser = $derived(message.role === "user");
  const routingNote = $derived(message.parts.find((p) => p.type === "routing_note"));
  const slopAudit = $derived(message.parts.find((p) => p.type === "slop_audit"));
  const transferNote = $derived(message.parts.find((p) => p.type === "transfer_note"));
  const toolCalls = $derived(message.parts.filter((p) => p.type === "tool_call"));
  const images = $derived(message.parts.filter((p) => p.type === "image"));
  const textContent = $derived(
    message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
  );
  const renderedHtml = $derived(renderMarkdown(textContent));

  const linkedArtifacts = $derived(
    (message.artifacts ?? [])
      .map((id) => artifacts.find((a) => a.id === id))
      .filter((a): a is Artifact => Boolean(a))
  );

  // Unrestricted handoff list: EVERY enabled provider & model!
  const handoffTargets = $derived(
    providers
      .filter((p) => p.enabled && p.models.length > 0)
      .flatMap((p) =>
        p.models.slice(0, 2).map((m) => ({
          label: `${p.displayName} — ${m.displayName}`,
          providerId: p.id,
          modelId: m.id,
          isImage: m.capabilities.includes("image.generate"),
        }))
      )
  );

  function copyText() {
    navigator.clipboard.writeText(textContent);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
</script>

<article
  class="rounded-lg border p-4 transition-colors {isUser
    ? 'ml-auto max-w-[84%] border-[var(--sym-border-strong)] bg-[var(--sym-surface)]'
    : 'w-full border-[var(--sym-border)] bg-[var(--sym-card)]'} {message.selectedCompare
    ? 'ring-1 ring-[var(--sym-success)] border-[var(--sym-success)]'
    : ''}"
>
  <!-- Header -->
  <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      {#if isUser}
        <span class="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
          {lang === "en" ? "YOU" : "SEN"}
        </span>
      {:else}
        <span
          class="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
          style={`background: ${message.author.badgeColor || '#27272A'}`}
        >
          {message.author.badgeLetter || "M"}
        </span>
        <span class="text-xs font-semibold">
          {message.author.modelName || message.author.modelId || "Model"}
        </span>
      {/if}

      {#if message.pinned}
        <span class="inline-flex items-center gap-1 rounded bg-[var(--sym-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sym-text-muted)]">
          <Pin class="h-2.5 w-2.5" /> {tr(lang, "pin")}
        </span>
      {/if}

      {#if !isUser && slopAudit && slopAudit.type === "slop_audit"}
        <span
          title={slopAudit.flags.length ? slopAudit.flags.join(", ") : "Clean editorial craft"}
          class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums {slopAudit.craftScore >= 90
            ? 'border-[var(--sym-success)]/40 text-[var(--sym-success)]'
            : 'border-[var(--sym-warning)]/40 text-[var(--sym-warning)]'}"
        >
          CRAFT {slopAudit.craftScore}
          {#if slopAudit.cleanedCount > 0}
            <span>· -{slopAudit.cleanedCount} slop</span>
          {/if}
        </span>
      {/if}
    </div>

    {#if isUser && promptCostSummary}
      <div class="flex items-center gap-1.5 rounded border border-[var(--sym-border)] bg-[var(--sym-card)] px-2 py-0.5 font-mono text-[10px] text-[var(--sym-text-muted)] tabular-nums">
        <span>{lang === "en" ? "Prompt cost" : "Prompt maliyeti"}:</span>
        <strong class="text-[var(--sym-text)]">${promptCostSummary.costUsd.toFixed(5)}</strong>
        {#if promptCostSummary.tokens > 0}
          <span>· {promptCostSummary.tokens} tok</span>
        {/if}
      </div>
    {:else if !isUser && message.usage}
      <div class="flex items-center gap-2 font-mono text-[11px] text-[var(--sym-text-muted)] tabular-nums">
        <span>{(message.usage.latencyMs / 1000).toFixed(1)}s</span>
        {#if message.usage.inputTokens || message.usage.outputTokens}
          <span>· {message.usage.inputTokens}↑ {message.usage.outputTokens}↓</span>
        {/if}
        <span class="font-semibold text-[var(--sym-text)]">· ${message.usage.costUsd.toFixed(5)}</span>
      </div>
    {/if}
  </div>

  {#if transferNote && transferNote.type === "transfer_note"}
    <div class="mb-2 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-[11px] text-[var(--sym-text-muted)]">
      ↳ <strong>{transferNote.fromAuthor}</strong>
      {lang === "en" ? "output transferred" : "çıktısı aktarıldı"}
    </div>
  {/if}

  {#if routingNote && routingNote.type === "routing_note"}
    <div class="mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1 text-[11px] text-[var(--sym-text-muted)]">
      <span class="font-mono font-semibold text-[var(--sym-text)]">{routingNote.roleName}</span>
      <span>· {routingNote.reason}</span>
      {#if routingNote.fallbackUsed}
        <span class="font-mono text-[var(--sym-warning)]">[fallback]</span>
      {/if}
    </div>
  {/if}

  {#each toolCalls as tc}
    {#if tc.type === "tool_call"}
      <div class="mb-2 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] text-xs">
        <button
          type="button"
          onclick={() => (expandedToolCall = !expandedToolCall)}
          class="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
        >
          <span class="flex items-center gap-2">
            {#if expandedToolCall}<ChevronDown class="h-3.5 w-3.5" />{:else}<ChevronRight class="h-3.5 w-3.5" />{/if}
            <Wrench class="h-3 w-3 text-[var(--sym-accent)]" />
            <span class="font-medium">{tc.toolName || tc.toolId}</span>
            {#if tc.durationMs}<span class="font-mono text-[11px] text-[var(--sym-text-muted)]">{(tc.durationMs / 1000).toFixed(2)}s</span>{/if}
          </span>
          <span class="font-mono text-[10px] text-[var(--sym-text-muted)]">JSON</span>
        </button>
        {#if expandedToolCall}
          <pre class="border-t border-[var(--sym-border)] p-2 text-[11px] font-mono overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
        {/if}
      </div>
    {/if}
  {/each}

  {#if images.length > 0}
    <div class="mb-3 flex flex-wrap gap-2">
      {#each images as img}
        {#if img.type === "image"}
          <div class="overflow-hidden rounded-md border border-[var(--sym-border)] bg-[var(--sym-bg)]">
            <button type="button" onclick={() => onOpenArtifact(img.artifactId)} class="block">
              <img
                src={`/api/v1/artifacts/${img.artifactId}?raw=1`}
                alt={img.alt || "Görsel"}
                class="max-h-64 w-auto object-contain"
                loading="lazy"
              />
            </button>
            <div class="flex items-center justify-between border-t border-[var(--sym-border)] px-2 py-1 text-[11px]">
              <button type="button" onclick={() => onOpenArtifact(img.artifactId)} class="text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]">
                {lang === "en" ? "Inspect ▸" : "İncele ▸"}
              </button>
              {#if onUseArtifactAsRef}
                <button
                  type="button"
                  onclick={() => onUseArtifactAsRef(img.artifactId)}
                  class="inline-flex items-center gap-1 font-medium text-[var(--sym-primary)] hover:underline"
                >
                  <ImagePlus class="h-3 w-3" /> {tr(lang, "useAsRef")}
                </button>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if textContent}
    <div class="sym-md" use:safeHtml={renderedHtml}></div>
  {/if}

  {#if linkedArtifacts.length > 0}
    <div class="mt-3 flex flex-wrap gap-1.5">
      {#each linkedArtifacts as art}
        <button
          type="button"
          onclick={() => onOpenArtifact(art.id)}
          class="inline-flex items-center gap-1.5 rounded border border-[var(--sym-border-strong)] bg-[var(--sym-surface)] px-2.5 py-1 text-xs font-medium hover:border-[var(--sym-primary)]"
        >
          <FileCode2 class="h-3.5 w-3.5 text-[var(--sym-primary)]" />
          <span>{art.title}</span>
          <span lang="en" class="font-mono text-[10px] uppercase text-[var(--sym-text-muted)]">{art.kind}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if isCompareCandidate && onSelectCompare}
    <div class="mt-3 border-t border-[var(--sym-border)] pt-2">
      <button
        type="button"
        onclick={() => onSelectCompare(message)}
        class="w-full rounded py-1.5 text-xs font-semibold transition-colors {message.selectedCompare
          ? 'bg-[var(--sym-success)] text-white'
          : 'border border-[var(--sym-border-strong)] bg-[var(--sym-surface)] hover:border-[var(--sym-primary)]'}"
      >
        {message.selectedCompare ? `✓ ${tr(lang, "selectedWinner")}` : tr(lang, "selectWinner")}
      </button>
    </div>
  {/if}

  {#if !isUser}
    <div class="relative mt-3 flex flex-wrap items-center gap-1 border-t border-[var(--sym-border)] pt-2 text-[11px] text-[var(--sym-text-muted)]">
      <button
        type="button"
        onclick={() => {
          handoffInstruction =
            images.length > 0
              ? lang === "en"
                ? "Build this design in clean HTML & Tailwind"
                : "Bu tasarımı temiz HTML ve Tailwind ile birebir kodla"
              : lang === "en"
              ? "Refine and improve this output"
              : "Bu çıktıyı geliştir ve eksiklerini tamamla";
          showHandoffMenu = !showHandoffMenu;
        }}
        class="inline-flex items-center gap-1 rounded border border-[var(--sym-border-strong)] bg-[var(--sym-surface)] px-2 py-0.5 font-medium text-[var(--sym-text)] hover:border-[var(--sym-primary)]"
      >
        <Send class="h-3 w-3" /> {tr(lang, "sendTo")} ▸
      </button>

      <button type="button" onclick={() => onRegenerate(message)} class="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
        <RefreshCw class="h-3 w-3" /> {tr(lang, "regenerate")}
      </button>
      <button type="button" onclick={() => onBranch(message)} class="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
        <GitBranch class="h-3 w-3" /> {tr(lang, "branch")}
      </button>
      <button type="button" onclick={() => onPin(message)} class="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
        <Pin class="h-3 w-3" /> {message.pinned ? tr(lang, "unpin") : tr(lang, "pin")}
      </button>
      <button type="button" onclick={copyText} class="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
        {#if copied}<Check class="h-3 w-3 text-[var(--sym-success)]" /> {tr(lang, "copied")}{:else}<Copy class="h-3 w-3" /> {tr(lang, "copy")}{/if}
      </button>
      <button type="button" onclick={() => onSaveMemory(message)} class="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
        <Bookmark class="h-3 w-3" /> {tr(lang, "saveMemory")}
      </button>

      {#if showHandoffMenu}
        <div class="absolute bottom-full left-0 mb-1.5 z-20 w-80 rounded-lg border border-[var(--sym-border-strong)] bg-[var(--sym-card)] p-2.5 shadow-xl">
          <div class="mb-1.5 text-xs font-semibold text-[var(--sym-text)]">
            {lang === "en" ? "Send to Any Model / Engine" : "İstediğin Modele / Araca Aktar"}
          </div>
          <input
            type="text"
            bind:value={handoffInstruction}
            class="mb-2 w-full rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2 py-1 text-xs text-[var(--sym-text)] outline-none focus:border-[var(--sym-primary)]"
          />
          <div class="max-h-52 space-y-0.5 overflow-y-auto">
            {#each handoffTargets as t}
              <button
                type="button"
                onclick={() => {
                  showHandoffMenu = false;
                  onHandoff(message, t.providerId, t.modelId, handoffInstruction);
                }}
                class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-[var(--sym-text)] hover:bg-[var(--sym-surface)]"
              >
                <span class="truncate">{t.label}</span>
                <span class="ml-2 font-mono text-[10px] text-[var(--sym-primary)]">{t.isImage ? "IMG" : "→"}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</article>
