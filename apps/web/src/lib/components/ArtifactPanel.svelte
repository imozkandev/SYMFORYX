<script lang="ts">
  import type { Artifact, LanguageCode } from "@symforyx/core";
  import { tr } from "$lib/i18n";
  import {
    Code2,
    Copy,
    Check,
    Download,
    Eye,
    Monitor,
    Tablet,
    Smartphone,
    Play,
    X,
    ZoomIn,
    ZoomOut,
    ImagePlus,
    Layers,
  } from "lucide-svelte";

  let {
    artifacts = [],
    lang = "tr",
    selectedId = null,
    onSelect,
    onClose,
    onChangeVersion,
    onSendToCode,
    onUseAsRef,
    onRunInSandbox,
    onAskEdit,
  }: {
    artifacts: Artifact[];
    lang?: LanguageCode;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onClose: () => void;
    onChangeVersion: (id: string, version: number) => void;
    onSendToCode: (artifact: Artifact) => void;
    onUseAsRef: (artifact: Artifact) => void;
    onRunInSandbox: (artifact: Artifact) => void;
    onAskEdit: (artifact: Artifact, instruction: string) => void;
  } = $props();

  let tab = $state<"preview" | "code">("preview");
  let viewport = $state<"desktop" | "tablet" | "mobile">("desktop");
  let zoom = $state(100);
  let copied = $state(false);
  let editPrompt = $state("");

  const active = $derived(artifacts.find((a) => a.id === selectedId) ?? artifacts[0] ?? null);
  const currentVersion = $derived(
    active ? active.versions[active.currentVersion - 1] ?? active.versions.at(-1) ?? null : null
  );

  $effect(() => {
    if (active) {
      tab = active.kind === "preview" || active.kind === "image" || active.kind === "table" ? "preview" : "code";
      zoom = 100;
    }
  });

  function copyContent() {
    if (!currentVersion) return;
    navigator.clipboard.writeText(currentVersion.content);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function downloadArtifact() {
    if (!active || !currentVersion) return;
    const url = `/api/v1/artifacts/${active.id}?raw=1`;
    const a = document.createElement("a");
    a.href = url;
    const ext =
      active.mime === "image/svg+xml"
        ? "svg"
        : active.mime === "image/png"
        ? "png"
        : active.kind === "preview"
        ? "html"
        : active.language || "txt";
    a.download = `${active.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || active.id}.${ext}`;
    a.click();
  }

  const parsedTable = $derived.by(() => {
    if (!active || active.kind !== "table" || !currentVersion) return null;
    try {
      return JSON.parse(currentVersion.content) as { headers: string[]; rows: string[][] };
    } catch {
      return null;
    }
  });
</script>

<aside
  aria-label={tr(lang, "artifacts")}
  class="flex h-full flex-col border-l border-[var(--sym-border)] bg-[var(--sym-surface)]"
>
  <div class="flex items-center justify-between gap-2 border-b border-[var(--sym-border)] px-3.5 py-2.5">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sym-text-muted)]">
          {tr(lang, "artifacts")}
        </span>
        {#if artifacts.length > 0}
          <span class="font-mono text-[10px] text-[var(--sym-text-muted)]">{artifacts.length}</span>
        {/if}
      </div>
      {#if active}
        <p class="truncate text-xs font-semibold mt-0.5">{active.title}</p>
      {/if}
    </div>
    <button
      type="button"
      onclick={onClose}
      aria-label={tr(lang, "close")}
      class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface-2)] hover:text-[var(--sym-text)]"
    >
      <X class="h-4 w-4" />
    </button>
  </div>

  {#if artifacts.length > 1}
    <div class="flex gap-1 overflow-x-auto border-b border-[var(--sym-border)] px-3 py-1.5">
      {#each artifacts as art (art.id)}
        <button
          type="button"
          onclick={() => onSelect(art.id)}
          class="shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors {art.id === active?.id
            ? 'bg-[var(--sym-text)] text-[var(--sym-bg)]'
            : 'border border-[var(--sym-border)] bg-[var(--sym-card)] text-[var(--sym-text-muted)] hover:text-[var(--sym-text)]'}"
        >
          {art.title.slice(0, 22)}
        </button>
      {/each}
    </div>
  {/if}

  {#if !active || !currentVersion}
    <div class="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-[var(--sym-text-muted)]">
      <Layers class="h-6 w-6 mb-2 opacity-40" />
      <p>{lang === "en" ? "No artifacts yet." : "Henüz artefakt yok."}</p>
    </div>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sym-border)] bg-[var(--sym-card)] px-3 py-1.5">
      <div class="flex items-center gap-1">
        {#if active.kind === "preview"}
          <button
            type="button"
            onclick={() => (tab = "preview")}
            class="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium {tab === 'preview'
              ? 'bg-[var(--sym-text)] text-[var(--sym-bg)]'
              : 'text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)]'}"
          >
            <Eye class="h-3 w-3" /> {tr(lang, "preview")}
          </button>
          <button
            type="button"
            onclick={() => (tab = "code")}
            class="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium {tab === 'code'
              ? 'bg-[var(--sym-text)] text-[var(--sym-bg)]'
              : 'text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)]'}"
          >
            <Code2 class="h-3 w-3" /> {tr(lang, "code")}
          </button>
        {:else if active.kind === "image"}
          <button type="button" onclick={() => (zoom = Math.max(50, zoom - 25))} aria-label="Zoom out" class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)]">
            <ZoomOut class="h-3.5 w-3.5" />
          </button>
          <span class="font-mono text-[11px] text-[var(--sym-text-muted)] tabular-nums">{zoom}%</span>
          <button type="button" onclick={() => (zoom = Math.min(200, zoom + 25))} aria-label="Zoom in" class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)]">
            <ZoomIn class="h-3.5 w-3.5" />
          </button>
        {/if}

        {#if active.versions.length > 1}
          <select
            aria-label="Version"
            value={active.currentVersion}
            onchange={(e) => onChangeVersion(active.id, Number((e.target as HTMLSelectElement).value))}
            class="ml-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-1.5 py-0.5 font-mono text-[11px]"
          >
            {#each active.versions as v (v.version)}
              <option value={v.version}>v{v.version}</option>
            {/each}
          </select>
        {/if}
      </div>

      <div class="flex items-center gap-1">
        {#if active.kind === "preview" && tab === "preview"}
          <button type="button" onclick={() => (viewport = "desktop")} title="Desktop" class="rounded p-1 {viewport === 'desktop' ? 'bg-[var(--sym-surface-2)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}">
            <Monitor class="h-3.5 w-3.5" />
          </button>
          <button type="button" onclick={() => (viewport = "tablet")} title="Tablet" class="rounded p-1 {viewport === 'tablet' ? 'bg-[var(--sym-surface-2)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}">
            <Tablet class="h-3.5 w-3.5" />
          </button>
          <button type="button" onclick={() => (viewport = "mobile")} title="Mobile" class="rounded p-1 {viewport === 'mobile' ? 'bg-[var(--sym-surface-2)] text-[var(--sym-text)]' : 'text-[var(--sym-text-muted)]'}">
            <Smartphone class="h-3.5 w-3.5" />
          </button>
        {/if}

        {#if active.kind === "code" && ["javascript", "js", "typescript", "ts", "python", "py"].includes(active.language || "")}
          <button
            type="button"
            onclick={() => onRunInSandbox(active)}
            class="inline-flex items-center gap-1 rounded bg-[var(--sym-accent)] px-2 py-1 text-[11px] font-medium text-white"
          >
            <Play class="h-3 w-3" /> {tr(lang, "run")}
          </button>
        {/if}

        {#if active.kind === "image"}
          <button
            type="button"
            onclick={() => onUseAsRef(active)}
            class="inline-flex items-center gap-1 rounded border border-[var(--sym-border-strong)] bg-[var(--sym-surface)] px-2 py-1 text-[11px] font-medium hover:border-[var(--sym-primary)]"
          >
            <ImagePlus class="h-3 w-3" /> {tr(lang, "useAsRef")}
          </button>
          <button
            type="button"
            onclick={() => onSendToCode(active)}
            class="inline-flex items-center gap-1 rounded bg-[var(--sym-primary)] px-2 py-1 text-[11px] font-medium text-white"
          >
            {tr(lang, "codeWith")}
          </button>
        {/if}

        <button type="button" onclick={copyContent} title={tr(lang, "copy")} class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
          {#if copied}<Check class="h-3.5 w-3.5 text-[var(--sym-success)]" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
        </button>
        <button type="button" onclick={downloadArtifact} title="Download" class="rounded p-1 text-[var(--sym-text-muted)] hover:bg-[var(--sym-surface)] hover:text-[var(--sym-text)]">
          <Download class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto p-3">
      {#if active.kind === "image"}
        <div class="flex min-h-full items-center justify-center rounded-md border border-[var(--sym-border)] bg-[var(--sym-card)] p-3 overflow-auto">
          <img
            src={`data:${currentVersion.mime};base64,${currentVersion.content}`}
            alt={active.title}
            style={`width: ${zoom}%; max-width: none;`}
            class="rounded"
          />
        </div>
      {:else if active.kind === "preview" && tab === "preview"}
        <div class="flex h-full justify-center rounded-md bg-[var(--sym-surface-2)] p-2">
          <iframe
            title={active.title}
            sandbox="allow-scripts"
            srcdoc={currentVersion.content}
            style={`width: ${viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '100%'};`}
            class="h-full min-h-[420px] rounded border border-[var(--sym-border)] bg-white transition-all"
          ></iframe>
        </div>
      {:else if active.kind === "table" && parsedTable}
        <div class="overflow-auto rounded-md border border-[var(--sym-border)] bg-[var(--sym-card)]">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="border-b border-[var(--sym-border)] bg-[var(--sym-surface)]">
                {#each parsedTable.headers as h}
                  <th class="px-3 py-2 text-left font-semibold">{h}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each parsedTable.rows as row}
                <tr class="border-b border-[var(--sym-border)] last:border-0">
                  {#each row as cell}
                    <td class="px-3 py-1.5">{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <pre class="h-full overflow-auto rounded-md border border-[var(--sym-border)] bg-[var(--sym-code-bg)] p-3 text-xs font-mono leading-relaxed">{currentVersion.content}</pre>
      {/if}
    </div>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        if (!editPrompt.trim() || !active) return;
        onAskEdit(active, editPrompt.trim());
        editPrompt = "";
      }}
      class="flex items-center gap-2 border-t border-[var(--sym-border)] bg-[var(--sym-card)] p-2.5"
    >
      <input
        type="text"
        bind:value={editPrompt}
        placeholder={tr(lang, "editArtifactPlaceholder")}
        class="flex-1 rounded border border-[var(--sym-border)] bg-[var(--sym-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--sym-primary)]"
      />
      <button type="submit" class="rounded bg-[var(--sym-text)] px-3 py-1.5 text-xs font-medium text-[var(--sym-bg)]">
        {tr(lang, "update")}
      </button>
    </form>
  {/if}
</aside>
