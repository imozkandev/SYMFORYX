<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/brand/symforyx-banner-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./assets/brand/symforyx-banner-light.svg" />
  <img alt="SYMFORYX — Native macOS Desktop AI Coding & Multi-Model Studio" src="./assets/brand/symforyx-banner-dark.svg" width="100%" />
</picture>

<br />
<br />

**English** &nbsp;·&nbsp; **[Türkçe](./README.tr.md)**

<br />

![macOS](https://img.shields.io/badge/macOS-100%25%20Native%20SwiftUI%20(Zero%20WebView)-1D4ED8?style=flat-square&labelColor=1F232D)
![Workspace](https://img.shields.io/badge/Mode-Local%20Project%20IDE%20%2B%20Terminal-111113?style=flat-square&labelColor=1F232D)
![Engine](https://img.shields.io/badge/Engine-Bun%201.2%2B%20%2B%20SQLite%20WAL-111113?style=flat-square&labelColor=1F232D)
![Security](https://img.shields.io/badge/Vault-AES--256--GCM%20Local-111113?style=flat-square&labelColor=1F232D)
![License](https://img.shields.io/badge/License-MIT-111113?style=flat-square&labelColor=1F232D)

<br />

> **A native macOS desktop AI coding & creation studio — like Claude Code Desktop, without vendor lock-in.**
> Open any local project folder on your Mac (or scaffold a brand-new project from zero), edit real files on disk, inspect live Git diffs, run terminal commands, generate visuals/3D/music, enforce zero AI slop, and track live tokens, quotas, and per-prompt costs — all inside one ~2 MB native SwiftUI app.

</div>

---

## Why SYMFORYX Desktop?

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>100% Native macOS Desktop App (Zero WebView)</h3>
      <p>Built with pure <strong>SwiftUI + AppKit</strong> for Apple Silicon (macOS 14+). No Electron, no Chromium memory bloat, no browser tabs. Auto-boots its local Bun orchestration engine in the background and installs straight into <code>/Applications/SYMFORYX.app</code>.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Claude-Code-Style Local Project Engine</h3>
      <p>Click <strong>Open Folder…</strong> to attach any directory on your Mac, or <strong>New Project…</strong> to scaffold from scratch (<em>Empty, TypeScript/Bun, Web, Python, Swift</em>). Browse the live file tree, edit code in the native editor (<code>⌘S</code>), view colored <strong>Git Diffs</strong>, and run real <code>zsh</code> commands in the built-in <strong>Project Terminal</strong>.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Auto-Apply Edits & 1-Click Disk Writes</h3>
      <p>Models see your project directory tree and Git branch automatically. Toggle <strong>AUTO-APPLY ON</strong> to let generated file blocks write straight to disk like Claude Code Desktop, or keep it manual and apply any message's edits with one click (<strong>Apply to Disk</strong> / <code>/apply</code>).</p>
    </td>
    <td width="50%" valign="top">
      <h3>Unrestricted Models & Media Engines</h3>
      <p>Code with <strong>Claude</strong>, <strong>GPT</strong>, <strong>Gemini</strong>, <strong>DeepSeek</strong>, <strong>Grok</strong>, <strong>OpenRouter</strong>, or local <strong>Ollama</strong>; generate visuals with <strong>Flux / Fal</strong>, <strong>Stability</strong>, <strong>Ideogram</strong>, <strong>ComfyUI</strong>, plus Video, 3D, and Music engines — add any custom model ID freely.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>AI Slop Blocker & Live Craft Score (0–100)</h3>
      <p>Two-layer craft filter (<code>ANTI-SLOP ON</code> / <code>/anti-slop</code>): pre-generation rules eliminate cliché prose, sycophancy, and purple-neon UI slop, while the post-generation scrubber cleans filler and stamps every output with a live <code>CRAFT</code> score.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Token Optimizer, Quotas & Per-Prompt Cost</h3>
      <p>Live toolbar telemetry for <strong>Outgoing</strong> & <strong>Remaining</strong> tokens, pre-send cost estimates, per-turn prompt costs, automatic context compression, and per-provider/tool <strong>Quotas & Reset Countdowns</strong> (hourly, 5h, daily, weekly, monthly).</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Universal <code>/reference</code> & Reference Tray</h3>
      <p>Attach local reference images (with explicit roles: <em>Style, Layout, Palette, Subject, Edit Source</em>), websites/URLs, or written constraints via the native tray or <code>/ref &lt;url|idea&gt;</code>.</p>
    </td>
    <td width="50%" valign="top">
      <h3>14 Ready Studio Production Schemas</h3>
      <p>One-click multi-step pipelines for <strong>App Store / Play Store 5-Screen Kits</strong>, <strong>TR+EN ASO</strong>, <strong>Video / Promo</strong>, <strong>Code + Visual + 3D + Music</strong>, SaaS Launch, Brand Identity, and more — with per-step model overrides and approval gates.</p>
    </td>
  </tr>
</table>

---

## Launch on macOS Desktop

### Requirements
- **macOS 14+** (Apple Silicon) with Xcode Command Line Tools (`swiftc`)
- [Bun](https://bun.sh) `1.2+`

### 1. Build & Launch `SYMFORYX.app`

```bash
git clone https://github.com/ozkandev/SYMFORYX.git
cd SYMFORYX
bun install

# Compiles the native SwiftUI app + Retina AppIcon.icns and launches SYMFORYX.app
bun run app
```

### 2. Install into `/Applications` (Launch from Spotlight & Dock)

```bash
bun run app:install
```

### 3. Or Run Locally as Web UI (Browser / WebView)

Prefer running in your local browser? One command boots the local server and opens the full companion Web UI backed by the exact same SQLite database and local project engine:

```bash
bun run web
```

*(You can also click the **Globe (`⌘⇧W`)** button inside `SYMFORYX.app` at any time to open the live local Web UI.)*

> `SYMFORYX.app` automatically discovers or spawns its local Bun engine on `127.0.0.1:3456` — just double-click the icon in `/Applications` or press `⌘Space → SYMFORYX`.

### 3. Open or Create a Local Project Inside SYMFORYX
1. Click **Open Folder…** in the sidebar or empty workbench to pick any existing project directory on your Mac.
2. Or click **New Project…** to create a fresh project from scratch (`Empty`, `TypeScript/Bun`, `Web`, `Python`, `Swift`).
3. Click files in the **Project Files** tree to edit natively (`⌘S`), switch to **Git Diff** to review live changes, toggle **Terminal** to run `bun test` / `npm run build` / `swift build`, and toggle **AUTO-APPLY ON** so AI edits land directly in your repository.

---

## Architecture

<div align="center">
  <img alt="SYMFORYX Local-First Desktop Architecture" src="./assets/brand/symforyx-architecture.svg" width="100%" />
</div>

---

## 6 Orchestration Modes & Local Project Commands

| Mode | Trigger | Behavior |
| :--- | :--- | :--- |
| **Smart** | Default (`<30ms` router) | Automatically picks the best model by `@mentions`, file types, and intent. |
| **Manual** | `@claude`, `@gpt`, `@flux`, Model Picker | Pin any provider or custom model ID with zero restrictions. |
| **Chain** | `/chain a > b > c` | Sequential pipeline passing code, diffs, and visual artifacts step-to-step. |
| **Compare** | `/compare @claude @gpt @gemini ...` | Parallel side-by-side execution; select the best output with one click. |
| **Council** | `/council ...` | Producer → Critics → Arbiter multi-model deliberation. |
| **Agent** | `/agent ...` | Plan → Run sandboxed tools & local commands → Synthesize. |

### Built-In Slash Commands (`43` Commands, EN + TR Aliases)

| Category | Commands |
| :--- | :--- |
| **Local Project IDE** | `/tree`, `/cat` (`/read-file`), `/grep`, `/sh` (`/term`), `/diff`, `/apply` |
| **Code & Preview** | `/code`, `/run`, `/preview`, `/review`, `/debug`, `/refactor`, `/test`, `/sql`, `/docs` |
| **Media & Studio** | `/image`, `/edit`, `/video`, `/music`, `/3d`, `/palette`, `/store`, `/aso`, `/launch`, `/ads`, `/brand` |
| **Orchestration** | `/chain`, `/compare`, `/council`, `/agent`, `/flow`, `/handoff`, `/save-schema` |
| **References & Control** | `/reference` (`/ref`, `/referans`), `/anti-slop` (`/slop`), `/optimize`, `/cost`, `/quota`, `/memory`, `/search`, `/read`, `/export` |

---

## Brand Identity

The SYMFORYX mark pairs **two opposing harmonic arcs** (forming a precision geometric **S** for *Symphony*) converging around a **cobalt conductor nexus node**, framed by minimal cadence rails.

<div align="center">
  <table>
    <tr>
      <td align="center" width="220">
        <img src="./assets/brand/symforyx-mark.svg" alt="SYMFORYX Dark Mark" width="72" />
        <br /><sub><code>symforyx-mark.svg</code> · Obsidian</sub>
      </td>
      <td align="center" width="220">
        <img src="./assets/brand/symforyx-mark-light.svg" alt="SYMFORYX Light Mark" width="72" />
        <br /><sub><code>symforyx-mark-light.svg</code> · Alabaster</sub>
      </td>
    </tr>
  </table>
</div>

---

## Project Structure

```text
SYMFORYX/
├── apps/
│   ├── macos-native/     # PRIMARY: 100% Native SwiftUI + AppKit macOS .app (zero WebView)
│   │   ├── Sources/      # AppMain, Models, SymforyxStore, Views, LocalWorkspaceViews
│   │   ├── gen-icon.swift# Retina Apple .icns vector icon generator
│   │   └── build-app.sh  # Direct swiftc compiler -> SYMFORYX.app
│   ├── server/           # Local Bun + Hono engine, Local Project FS/Terminal/Git Engine, Orchestrator
│   ├── cli/              # Terminal CLI (`bun run cli -- ...`)
│   └── web/              # Optional Svelte 5 companion UI (`bun run dev:all`)
├── packages/
│   ├── core/             # SymMessage schema, types, 43 slash commands, TR/EN parser
│   ├── db/               # SQLite (WAL + FTS5) local store, quotas, AES-256-GCM Key Vault
│   ├── providers/        # Anthropic, OpenAI, Gemini, DeepSeek, Grok, OpenRouter, Ollama, Flux, Video/3D/Audio
│   ├── router/           # 3-Layer Smart Router (<30ms)
│   ├── context/          # Shared context, Token Optimizer, AI Slop Blocker (Craft Score)
│   ├── flows/            # Flow Engine + 14 Studio Production Schemas
│   ├── agent/            # Agent Runner
│   ├── tools-sdk/        # @symforyx/tools-sdk
│   ├── tools-runtime/    # Permission engine, sandbox runner, MCP client
│   ├── tools/            # Built-in tools (Web Search, Code Sandbox, Live Preview, WCAG Palette)
│   └── i18n/             # Turkish & English localization
├── assets/brand/         # Minimal SVG logos, adaptive banners & architecture diagram
└── flows-templates/      # YAML studio flow templates
```

---

## Verification & CLI

```bash
# Run full test suite (18 tests: Local Project Engine, Workspaces, AI Slop Blocker, Optimizer, Flows, Vault)
cd apps/server && bun test tests/symforyx.test.ts

# Rebuild native macOS app
bun run app:build

# Optional CLI usage
bun run cli -- chat "@claude design a clean TypeScript worker pool"
bun run cli -- flow run magaza-gorselleri --input appName="SYMFORYX"
bun run cli -- usage --month
```

---

<div align="center">

<img src="./assets/brand/symforyx-mark.svg" alt="SYMFORYX" width="32" />

**SYMFORYX** · *Native macOS AI Coding & Orchestration Studio.*
Designed & built by **ozkandev** · MIT License · © 2026

</div>
