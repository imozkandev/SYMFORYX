import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TASK_ROLES,
  DEFAULT_USER_SETTINGS,
  extractCodeBlocks,
  parseUserInput,
} from "@symforyx/core";
import { KeyVault, SymforyxDB } from "@symforyx/db";
import { DEFAULT_PROVIDER_CONFIGS } from "@symforyx/providers";
import { routeMessage } from "@symforyx/router";
import { auditAndCleanSlop, buildContext, optimizeContextMessages } from "@symforyx/context";
import { createApp } from "../src/index.ts";
import { SymforyxOrchestrator } from "../src/orchestrator.ts";

const mockProviders = DEFAULT_PROVIDER_CONFIGS.map((p) => ({
  ...p,
  hasKey: p.auth === "none",
}));

describe("1. Core Parser (Turkish & English mentions, slash commands, chains)", () => {
  test("parses Turkish and ASCII slash commands identically", () => {
    const a = parseUserInput("/görsel gün batımında İstanbul");
    const b = parseUserInput("/gorsel gün batımında İstanbul");
    expect(a.slashCommand?.command).toBe("gorsel");
    expect(b.slashCommand?.command).toBe("gorsel");
    expect(a.cleanText).toBe("gün batımında İstanbul");
  });

  test("parses @mentions, #files, and multi-step chains", () => {
    const chain = parseUserInput("/zincir @gorsel kahve ekranı > @claude HTML kodla > @gpt incele");
    expect(chain.isChain).toBe(true);
    expect(chain.chainSteps?.length).toBe(3);

    const refs = parseUserInput("@claude #app.log #art_123 bu hatayı incele");
    expect(refs.mentions).toContain("claude");
    expect(refs.fileRefs).toEqual(["app.log", "art_123"]);
  });

  test("extracts fenced code blocks with optional filename", () => {
    const md = "Açıklama\n```html index.html\n<h1>Merhaba</h1>\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks.length).toBe(1);
    expect(blocks[0].language).toBe("html");
    expect(blocks[0].filename).toBe("index.html");
  });
});

describe("2. Key Vault (AES-256-GCM)", () => {
  test("encrypts, decrypts, and masks API keys safely", () => {
    const vault = new KeyVault({ secret: "test-master-secret-key-32-chars-minimum!!" });
    const secret = "sk-ant-api03-1234567890abcdef4f2a";
    const enc = vault.encrypt(secret);
    expect(enc).not.toContain("1234567890");
    expect(vault.decrypt(enc)).toBe(secret);
    const masked = vault.mask(secret);
    expect(masked.endsWith("4f2a")).toBe(true);
    expect(masked).not.toBe(secret);
  });
});

describe("3. Three-Layer Smart Router (<30ms)", () => {
  test("Layer 1: explicit @gorsel and @herkes", () => {
    const d1 = routeMessage({
      parsed: parseUserInput("@gorsel minimalist logo tasarla"),
      attachments: [],
      roles: DEFAULT_TASK_ROLES,
      providers: mockProviders,
      settings: DEFAULT_USER_SETTINGS,
      mode: "smart",
    });
    expect(d1.layer).toBe(1);
    expect(d1.roleId).toBe("gorsel-uretim");

    const d2 = routeMessage({
      parsed: parseUserInput("@herkes hangi mimari daha iyi?"),
      attachments: [],
      roles: DEFAULT_TASK_ROLES,
      providers: mockProviders,
      settings: DEFAULT_USER_SETTINGS,
      mode: "smart",
    });
    expect(d2.isCompareAll).toBe(true);
    expect(d2.explicitTargets?.length).toBe(3);
  });

  test("Layer 2: rules match image + kodla and CSV attachment", () => {
    const d1 = routeMessage({
      parsed: parseUserInput("bunu React ve Tailwind ile kodla"),
      attachments: [{ kind: "image", mime: "image/png", name: "screen.png" }],
      roles: DEFAULT_TASK_ROLES,
      providers: mockProviders,
      settings: DEFAULT_USER_SETTINGS,
      mode: "smart",
    });
    expect(d1.layer).toBe(2);
    expect(d1.roleId).toBe("kodlama");

    const d2 = routeMessage({
      parsed: parseUserInput("ciroyu hesapla"),
      attachments: [{ kind: "file", mime: "text/csv", name: "satislar.csv" }],
      roles: DEFAULT_TASK_ROLES,
      providers: mockProviders,
      settings: DEFAULT_USER_SETTINGS,
      mode: "smart",
    });
    expect(d2.layer).toBe(2);
    expect(d2.roleId).toBe("veri-analizi");
  });

  test("Layer 2: economy mode routes short greetings to ozetleme", () => {
    const d = routeMessage({
      parsed: parseUserInput("Merhaba"),
      attachments: [],
      roles: DEFAULT_TASK_ROLES,
      providers: mockProviders,
      settings: { ...DEFAULT_USER_SETTINGS, economyMode: true },
      mode: "smart",
    });
    expect(d.roleId).toBe("ozetleme");
  });
});

describe("4. Context Manager (Auto-summarization & Pinned Protection)", () => {
  test("auto-summarizes older messages above threshold while keeping pinned messages", () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      id: `m_${i}`,
      threadId: "t1",
      parentId: i === 0 ? null : `m_${i - 1}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      author: { kind: i % 2 === 0 ? ("user" as const) : ("model" as const), modelName: "Claude" },
      parts: [{ type: "text" as const, text: `Mesaj ${i}: ` + "A".repeat(400) }],
      pinned: i === 1,
      createdAt: new Date(Date.now() + i * 1000).toISOString(),
    }));

    const res = buildContext({
      allMessages: msgs,
      activeHeadId: "m_11",
      targetProviderId: "anthropic",
      targetModel: {
        id: "small",
        providerId: "anthropic",
        displayName: "Small",
        capabilities: ["chat"],
        contextWindow: 1200,
        maxOutputTokens: 256,
      },
      sharedContext: "full",
      summarizeThresholdPercent: 75,
    });

    expect(res.stats.autoSummarized).toBe(true);
    expect(res.stats.pinnedCount).toBe(1);
    expect(res.messages.some((m) => m.id === "m_1")).toBe(true);
    expect(res.messages.some((m) => m.parts.some((p) => p.type === "summary"))).toBe(true);
  });
});

describe("5. End-to-End Orchestrator, API, Tools, Flows & 5-Minute MVP Workflow", () => {
  const db = new SymforyxDB({ dbPath: ":memory:", secret: "symforyx-test-secret-key-32-chars!" });
  const orchestrator = new SymforyxOrchestrator(db);
  const app = createApp(orchestrator);

  test("MVP Acceptance: @gorsel -> image artifact -> Handoff to Claude -> Live HTML Preview", async () => {
    const tRes = await app.request("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "5 Dakika Denemesi" }),
    });
    expect(tRes.status).toBe(201);
    const { thread } = await tRes.json();

    const imgRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        message: "@gorsel kahve dükkânı için minimalist ana ekran tasarla",
        stream: false,
      }),
    });
    expect(imgRes.status).toBe(200);
    const imgData = await imgRes.json();
    const imgArtifactEv = imgData.events.find((e: any) => e.type === "artifact_created");
    const imgMsgEv = imgData.events.find((e: any) => e.type === "message_done");
    expect(imgArtifactEv.artifact.kind).toBe("image");

    const handoffRes = await app.request("/api/v1/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        sourceMessageId: imgMsgEv.message.id,
        targetProviderId: "demo",
        targetModelId: "demo-claude",
        instruction: "Bu tasarımı HTML ve Tailwind ile kodla",
      }),
    });
    expect(handoffRes.status).toBe(200);
    const sseText = await handoffRes.text();
    expect(sseText).toContain("artifact_created");
    expect(sseText).toContain("preview");
  });

  test("Built-in tools: Color Palette (/palet) & Code Sandbox execution", async () => {
    const palRes = await app.request("/api/v1/tools/dev.ozkandev.renk-paleti/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: { source: "kahve dükkanı", count: 5 } }),
    });
    const palData = await palRes.json();
    expect(palData.ok).toBe(true);
    expect(palData.result.artifactIds.length).toBe(1);

    const sandRes = await app.request("/api/v1/tools/code-sandbox/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: { language: "javascript", code: "console.log(21 * 2)" } }),
    });
    const sandData = await sandRes.json();
    expect(sandData.ok).toBe(true);
    expect(sandData.result.json.stdout).toBe("42");
  });

  test("Flow Engine: tasarimdan-koda pauses at approval gate and completes after approval", async () => {
    const runRes = await app.request("/api/v1/flows/tasarimdan-koda/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: { brief: "Hava durumu uygulaması", framework: "HTML + Tailwind" } }),
    });
    const { run } = await runRes.json();
    expect(run.status).toBe("awaiting_approval");

    const approveRes = await app.request(`/api/v1/runs/${run.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    const { run: completed } = await approveRes.json();
    expect(completed.status).toBe("completed");
    expect(completed.stepStates.every((s: any) => s.status === "completed")).toBe(true);
  });

  test("Compare, Council, and Agent modes run end-to-end", async () => {
    const cmpRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "/karsilastir @claude @gpt @gemini TypeScript rate limiter",
        mode: "compare",
        stream: false,
      }),
    });
    const cmpData = await cmpRes.json();
    const doneMsgs = cmpData.events.filter((e: any) => e.type === "message_done");
    expect(doneMsgs.length).toBe(3);

    const agRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Kahve teması için renk paleti çıkar ve hesapla",
        mode: "agent",
        stream: false,
      }),
    });
    const agData = await agRes.json();
    expect(agData.events.some((e: any) => e.type === "agent_event")).toBe(true);
    expect(agData.events.some((e: any) => e.type === "message_done")).toBe(true);
  });

  test("Unrestricted custom models, reference images/ideas, and per-tool/provider quotas", async () => {
    // 1. Add custom model freely to any provider
    const mRes = await app.request("/api/v1/providers/fal/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "fal-ai/flux-schnell-custom", capabilities: ["image.generate"] }),
    });
    expect(mRes.status).toBe(200);
    const { provider } = await mRes.json();
    expect(provider.models.some((m: any) => m.id === "fal-ai/flux-schnell-custom")).toBe(true);

    // 2. Chat with reference ideas + reference image artifact
    const refRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "@gorsel editorial dergi kapağı",
        references: [
          { id: "r1", kind: "idea", role: "style", title: "Swiss Grid", note: "Gradyan yok, yüksek kontrast" },
        ],
        stream: false,
      }),
    });
    expect(refRes.status).toBe(200);
    const refData = await refRes.json();
    const userMsgEv = refData.events.find((e: any) => e.type === "user_message");
    expect(JSON.stringify(userMsgEv.message.parts)).toContain("Swiss Grid");

    // 3. Quotas: list + edit limit & reset interval + verify countdown/remaining
    const qUpd = await app.request("/api/v1/quotas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "provider",
        targetId: "anthropic",
        displayName: "Anthropic (Claude)",
        planName: "Pro 5h Window",
        metric: "tokens",
        limitAmount: 500000,
        resetInterval: "5h",
      }),
    });
    expect(qUpd.status).toBe(200);
    const { quota } = await qUpd.json();
    expect(quota.limitAmount).toBe(500000);
    expect(quota.remainingAmount).toBeLessThanOrEqual(500000);
    expect(quota.nextResetAt).toBeTruthy();
  });

  test("14 Studio Schemas (Store Visuals, ASO, Video/Promo, Code+Visual+3D+Music) + Per-Prompt Cost Estimate", async () => {
    const flRes = await app.request("/api/v1/flows");
    const { flows } = await flRes.json();
    expect(flows.length).toBeGreaterThanOrEqual(14);
    expect(flows.some((f: any) => f.id === "magaza-gorselleri")).toBe(true);
    expect(flows.some((f: any) => f.id === "aso-paketi")).toBe(true);
    expect(flows.some((f: any) => f.id === "video-promo")).toBe(true);
    expect(flows.some((f: any) => f.id === "kod-gorsel-3d-muzik")).toBe(true);

    // Run full Code + Visual + 3D Model + Music studio schema
    const fullRunRes = await app.request("/api/v1/flows/kod-gorsel-3d-muzik/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: { fikir: "Minimalist uzay bulmaca oyunu", tarz: "Swiss low-poly" } }),
    });
    const { run } = await fullRunRes.json();
    expect(run.status).toBe("completed");
    expect(run.stepStates.flatMap((s: any) => s.artifactIds ?? []).length).toBeGreaterThanOrEqual(3);

    // Per-prompt cost estimator
    const estRes = await app.request("/api/v1/estimate-cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "App Store 5 ekran görseli ve ASO metinleri üret",
        mode: "compare",
        providerId: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      }),
    });
    expect(estRes.status).toBe(200);
    const est = await estRes.json();
    expect(est.multiplier).toBe(3);
    expect(est.estimatedCostUsd).toBeGreaterThan(0);
  });

  test("Token Optimizer compresses older verbose turns & /referans command attaches URL/idea/clear", async () => {
    const verboseMsgs = Array.from({ length: 5 }, (_, i) => ({
      id: `opt_${i}`,
      threadId: "t_opt",
      parentId: i === 0 ? null : `opt_${i - 1}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      author: { kind: i % 2 === 0 ? ("user" as const) : ("model" as const) },
      parts: [{ type: "text" as const, text: "```html\n" + "<div>test</div>\n".repeat(80) + "```" }],
      artifacts: ["art_demo"],
      createdAt: new Date().toISOString(),
    }));
    const opt = optimizeContextMessages(verboseMsgs, true);
    expect(opt.savedTokens).toBeGreaterThan(200);
    expect(opt.compressionPercent).toBeGreaterThan(20);

    // /referans command with URL + note, then liste, then temizle
    const tRes = await app.request("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Referans Testi" }),
    });
    const { thread } = await tRes.json();

    const refUrlRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        message: "/referans https://linear.app sade koyu arayüz düzeni",
        stream: false,
      }),
    });
    const refUrlData = await refUrlRes.json();
    expect(refUrlData.events.some((e: any) => e.type === "reference_added")).toBe(true);

    const listRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: thread.id, message: "/referans liste", stream: false }),
    });
    const listData = await listRes.json();
    const listMsg = listData.events.find((e: any) => e.type === "message_done");
    expect(listMsg.message.parts[0].text).toContain("linear.app");

    const clrRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: thread.id, message: "/referans temizle", stream: false }),
    });
    const clrData = await clrRes.json();
    expect(clrData.events.some((e: any) => e.type === "references_cleared")).toBe(true);
  });

  test("AI Slop Blocker scrubs sycophancy/clichés/emoji spam, flags UI slop, and attaches Craft Score", async () => {
    const dirty =
      "Great question! 🚀✨ In today's fast-paced digital world, let's delve into a game-changer UI:\n```css\n.hero { background: linear-gradient(135deg, #6366f1, #ec4899); }\n```";
    const audit = auditAndCleanSlop(dirty, true);
    expect(audit.cleanedText.startsWith("Great question!")).toBe(false);
    expect(audit.cleanedText).not.toContain("🚀");
    expect(audit.cleanedCount).toBeGreaterThanOrEqual(3);
    expect(audit.flags).toContain("ui-slop:purple-neon-gradient");
    expect(audit.craftScore).toBeLessThan(95);

    const slopCmdRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "/anti-slop", stream: false }),
    });
    const slopCmdData = await slopCmdRes.json();
    const reply = slopCmdData.events.find((e: any) => e.type === "message_done");
    expect(reply.message.parts[0].text).toContain("AI Slop Blocker");
  });

  test("General Workspace (proj_default) and any workspace/project can be deleted cleanly", async () => {
    // Delete the default "Genel Çalışma Alanı" (proj_default)
    const delRes = await app.request("/api/v1/projects/proj_default", { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.ok).toBe(true);
    expect(delData.projects.some((p: any) => p.id === "proj_default")).toBe(false);

    // Delete any remaining projects so 0 projects exist, then verify creating a thread auto-provisions safely
    for (const p of delData.projects) {
      await app.request(`/api/v1/projects/${p.id}`, { method: "DELETE" });
    }
    const listAfter = await (await app.request("/api/v1/projects")).json();
    expect(listAfter.projects.length).toBe(0);

    const newThreadRes = await app.request("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Fresh Start Thread" }),
    });
    expect(newThreadRes.status).toBe(201);
    const { thread, projectId } = await newThreadRes.json();
    expect(thread.id).toBeTruthy();
    expect(projectId).toBeTruthy();
  });

  test("Local macOS Project Engine (Claude Code Mode): init folder, tree, read/write/patch, search, shell exec, apply blocks", async () => {
    const tmpProjectDir = `/tmp/symforyx-test-proj-${Date.now()}`;
    const openRes = await app.request("/api/v1/projects/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tmpProjectDir, createIfMissing: true, template: "typescript" }),
    });
    expect(openRes.status).toBe(201);
    const opened = await openRes.json();
    expect(opened.project.rootPath).toBe(tmpProjectDir);
    expect(opened.createdFiles).toContain("src/index.ts");

    const pid = opened.project.id;
    const readRes = await app.request(`/api/v1/projects/${pid}/fs/read?path=src/index.ts`);
    expect(readRes.status).toBe(200);
    const readData = await readRes.json();
    expect(readData.content).toContain("SYMFORYX Desktop");

    // Apply fenced code block directly to disk
    const applyRes = await app.request(`/api/v1/projects/${pid}/fs/apply-blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "Here is the utility:\n```ts:src/math.ts\nexport const add = (a: number, b: number) => a + b;\n```\n",
      }),
    });
    expect(applyRes.status).toBe(200);
    const applyData = await applyRes.json();
    expect(applyData.applied.length).toBe(1);
    expect(applyData.applied[0].path).toBe("src/math.ts");

    // Search text across real local project
    const searchRes = await app.request(`/api/v1/projects/${pid}/fs/search?q=export%20const%20add`);
    const searchData = await searchRes.json();
    expect(searchData.matches.length).toBeGreaterThanOrEqual(1);

    // Execute real shell command in local project folder
    const execRes = await app.request(`/api/v1/projects/${pid}/fs/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls -1 src" }),
    });
    expect(execRes.status).toBe(200);
    const execData = await execRes.json();
    expect(execData.ok).toBe(true);
    expect(execData.result.stdout).toContain("math.ts");

    // Slash command /tree inside thread bound to local project
    const treeCmdRes = await app.request("/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: opened.thread.id, message: "/tree", stream: false }),
    });
    const treeCmdData = await treeCmdRes.json();
    const reply = treeCmdData.events.find((e: any) => e.type === "message_done");
    expect(reply.message.parts[0].text).toContain("src/math.ts");

    // Opening a folder again OUTSIDE a chat creates a brand-new chat thread
    const reopenOutside = await app.request("/api/v1/projects/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tmpProjectDir }),
    });
    expect(reopenOutside.status).toBe(201);
    const reopened = await reopenOutside.json();
    expect(reopened.attachedToExistingChat).toBe(false);
    expect(reopened.thread.id).not.toBe(opened.thread.id);

    // Adding a folder INSIDE an existing chat keeps the exact same thread
    const attachInside = await app.request("/api/v1/projects/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tmpProjectDir, attachToThreadId: opened.thread.id }),
    });
    expect(attachInside.status).toBe(200);
    const attached = await attachInside.json();
    expect(attached.attachedToExistingChat).toBe(true);
    expect(attached.thread.id).toBe(opened.thread.id);
  });
});
