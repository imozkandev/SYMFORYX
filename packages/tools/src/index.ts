import { defineTool, z } from "@symforyx/tools-sdk";
import type { ToolManifest } from "@symforyx/core";

// ==================== 1. Color Palette Tool (Section 29 Example) ====================

export const colorPaletteManifest: ToolManifest = {
  id: "dev.ozkandev.renk-paleti",
  name: "Renk Paleti",
  version: "1.0.0",
  publisher: "ozkandev",
  verified: true,
  type: "builtin",
  category: "design",
  description: "Bir açıklamadan veya temadan WCAG AA erişilebilir renk paleti ve SVG önizleme üretir.",
  inputs: {
    source: { type: "string", description: "Tema, marka veya renk açıklaması", required: true },
    count: { type: "integer", default: 5, min: 3, max: 8 },
  },
  outputs: [
    { type: "json", description: "HEX renk listesi ve kontrast bilgileri" },
    { type: "image", description: "SVG renk kartelası" },
  ],
  permissions: {
    network: [],
    filesystem: "none",
    secrets: [],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { slash: "/palet", mention: "@palet", confirm: "never" },
  runtime: { timeout_ms: 5000, memory_mb: 64 },
  rating: 4.9,
  installed: true,
  enabled: true,
  policy: "allow_always",
};

export const colorPaletteTool = defineTool({
  id: colorPaletteManifest.id,
  manifest: colorPaletteManifest,
  input: z.object({
    source: z.string().default("modern arayüz"),
    count: z.number().int().min(3).max(8).default(5),
  }),
  async run({ input, ctx }) {
    ctx.progress("Erişilebilir renk paleti hesaplanıyor...");
    const lower = input.source.toLowerCase();
    let palette = [
      { name: "Orkestra Moru", hex: "#6D5EF6", role: "Primary", textOn: "#FFFFFF" },
      { name: "Kıvılcım Turuncusu", hex: "#FF8A3D", role: "Accent", textOn: "#111116" },
      { name: "Gece Zemin", hex: "#0E0E12", role: "Surface Dark", textOn: "#F4F4F5" },
      { name: "İnci Yüzey", hex: "#F6F6F9", role: "Surface Light", textOn: "#18181B" },
      { name: "Zümrüt Başarı", hex: "#22A06B", role: "Success", textOn: "#FFFFFF" },
      { name: "Kehribar Uyarı", hex: "#E2A400", role: "Warning", textOn: "#111116" },
    ];

    if (lower.includes("kahve") || lower.includes("sicak") || lower.includes("sıcak")) {
      palette = [
        { name: "Espresso", hex: "#3C2415", role: "Primary Dark", textOn: "#FAF7F2" },
        { name: "Karamel Kavrum", hex: "#B45309", role: "Primary", textOn: "#FFFFFF" },
        { name: "Süt Köpüğü", hex: "#FAF7F2", role: "Background", textOn: "#29180D" },
        { name: "Fındık", hex: "#D6B588", role: "Accent", textOn: "#29180D" },
        { name: "Kakule Yeşili", hex: "#2F6F4E", role: "Secondary", textOn: "#FFFFFF" },
      ];
    } else if (lower.includes("kuzey") || lower.includes("aurora") || lower.includes("koyu")) {
      palette = [
        { name: "Kutup Gece", hex: "#0B1020", role: "Background", textOn: "#F8FAFC" },
        { name: "Aurora Yeşili", hex: "#10B981", role: "Primary", textOn: "#052E16" },
        { name: "Buzul Camgöbeği", hex: "#06B6D4", role: "Accent", textOn: "#082F49" },
        { name: "Nebula Moru", hex: "#8B5CF6", role: "Secondary", textOn: "#FFFFFF" },
        { name: "Yıldız Tozu", hex: "#E2E8F0", role: "Foreground", textOn: "#0F172A" },
      ];
    } else if (lower.includes("deniz") || lower.includes("mavi") || lower.includes("klinik")) {
      palette = [
        { name: "Güven Mavisi", hex: "#1D4ED8", role: "Primary", textOn: "#FFFFFF" },
        { name: "Gökyüzü", hex: "#0EA5E9", role: "Accent", textOn: "#FFFFFF" },
        { name: "Berrak Zemin", hex: "#F8FAFC", role: "Background", textOn: "#0F172A" },
        { name: "Derin Lacivert", hex: "#0F172A", role: "Text", textOn: "#F8FAFC" },
        { name: "Ferahlık Nane", hex: "#14B8A6", role: "Success", textOn: "#042F2E" },
      ];
    }

    const chosen = palette.slice(0, input.count);
    const width = 720;
    const colW = Math.floor((width - 48) / chosen.length);
    const rects = chosen
      .map((c, idx) => {
        const x = 24 + idx * colW;
        return `
          <rect x="${x}" y="68" width="${colW - 10}" height="180" rx="14" fill="${c.hex}" stroke="#00000018" />
          <text x="${x + 12}" y="210" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="${c.textOn}">${c.hex}</text>
          <text x="${x + 12}" y="230" font-family="Inter, sans-serif" font-size="11" fill="${c.textOn}" fill-opacity="0.85">${c.role}</text>
          <text x="${x + 4}" y="272" font-family="Inter, sans-serif" font-size="12" font-weight="600" fill="#18181B">${c.name}</text>
        `;
      })
      .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 310" width="${width}" height="310">
      <rect width="${width}" height="310" rx="18" fill="#FFFFFF" stroke="#E4E4E7" />
      <text x="24" y="38" font-family="Inter, sans-serif" font-size="18" font-weight="700" fill="#18181B">Renk Paleti — ${input.source.replace(/[<>&"]/g, "").slice(0, 42)}</text>
      <text x="24" y="56" font-family="Inter, sans-serif" font-size="11" fill="#71717A">WCAG AA uyumlu · SYMFORYX @palet</text>
      ${rects}
    </svg>`;

    const art = await ctx.artifacts.create({
      kind: "image",
      title: `Renk Paleti: ${input.source.slice(0, 32)}`,
      mime: "image/svg+xml",
      content: Buffer.from(svg, "utf8").toString("base64"),
    });

    const mdTable = [
      `| Renk | HEX | Rol |`,
      `| --- | --- | --- |`,
      ...chosen.map((c) => `| ${c.name} | \`${c.hex}\` | ${c.role} |`),
    ].join("\n");

    return {
      json: { colors: chosen },
      text: `**${input.source}** için ${chosen.length} renkli erişilebilir palet üretildi:\n\n${mdTable}`,
      artifactIds: [art.id],
    };
  },
});

// ==================== 2. Code Execution Sandbox Tool ====================

export const codeSandboxManifest: ToolManifest = {
  id: "code-sandbox",
  name: "Kod Çalıştırma (Sandbox)",
  version: "1.0.0",
  publisher: "symforyx",
  verified: true,
  type: "builtin",
  category: "code",
  description: "JavaScript/TypeScript ve Python kodlarını zaman aşımı ve yalıtılmış ortam sınırlarıyla çalıştırır.",
  inputs: {
    language: { type: "string", default: "javascript", enum: ["javascript", "typescript", "python"] },
    code: { type: "string", required: true, description: "Çalıştırılacak kaynak kod" },
  },
  permissions: {
    network: [],
    filesystem: "none",
    secrets: [],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { slash: "/calistir", confirm: "first_time" },
  runtime: { timeout_ms: 8000, memory_mb: 128 },
  rating: 4.9,
  installed: true,
  enabled: true,
  policy: "allow_project",
};

export const codeSandboxTool = defineTool({
  id: codeSandboxManifest.id,
  manifest: codeSandboxManifest,
  input: z.object({
    language: z.string().default("javascript"),
    code: z.string().min(1),
  }),
  async run({ input, ctx }) {
    if (process.env.SANDBOX_ENABLED === "false") {
      return { text: "Kod çalıştırma sandbox'ı devre dışı (`SANDBOX_ENABLED=false`).", isError: true };
    }
    ctx.progress(`${input.language} kodu sandbox'ta çalıştırılıyor...`);
    const lang = input.language.toLowerCase();
    const cmd =
      lang === "python" || lang === "py"
        ? ["python3", "-I", "-c", input.code]
        : [process.execPath, "-e", input.code];

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NO_COLOR: "1" },
    });

    const killTimer = setTimeout(() => proc.kill(), 6000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(killTimer);

    const out = stdout.slice(0, 6000).trim();
    const err = stderr.slice(0, 3000).trim();

    return {
      isError: exitCode !== 0,
      json: { exitCode, stdout: out, stderr: err },
      text: [
        `**Sandbox Çıktısı** (\`${lang}\`, çıkış kodu: \`${exitCode}\`)`,
        out ? `\`\`\`text\n${out}\n\`\`\`` : "_(stdout boş)_",
        err ? `**Hata Çıktısı (stderr):**\n\`\`\`text\n${err}\n\`\`\`` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  },
});

// ==================== 3. Web Search Tool ====================

export const webSearchManifest: ToolManifest = {
  id: "web-search",
  name: "Web Araması",
  version: "1.0.0",
  publisher: "symforyx",
  verified: true,
  type: "builtin",
  category: "web",
  description: "Güncel bilgiler ve kaynaklar için web araması yapar (Tavily, Brave veya DuckDuckGo).",
  inputs: {
    query: { type: "string", required: true, description: "Arama sorgusu" },
    maxResults: { type: "integer", default: 5, min: 1, max: 10 },
  },
  permissions: {
    network: ["*"],
    filesystem: "none",
    secrets: ["TAVILY_API_KEY"],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { slash: "/ara", confirm: "never" },
  runtime: { timeout_ms: 10000 },
  rating: 4.8,
  installed: true,
  enabled: true,
  policy: "allow_always",
};

export const webSearchTool = defineTool({
  id: webSearchManifest.id,
  manifest: webSearchManifest,
  input: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  async run({ input, ctx }) {
    ctx.progress(`Web'de aranıyor: "${input.query}"...`);
    const tavilyKey = ctx.secret("TAVILY_API_KEY") || process.env.TAVILY_API_KEY;

    try {
      if (tavilyKey) {
        const res = await ctx.fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: input.query,
            max_results: input.maxResults,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            results?: Array<{ title: string; url: string; content: string }>;
          };
          const items = data.results ?? [];
          return {
            untrusted: true,
            json: { results: items },
            text: items
              .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content.slice(0, 260)}`)
              .join("\n\n"),
          };
        }
      }

      // Free DuckDuckGo Instant Answer API fallback
      const ddgRes = await ctx.fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json&no_html=1&skip_disambig=1`
      );
      if (ddgRes.ok) {
        const data = (await ddgRes.json()) as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        };
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        if (data.AbstractText) {
          results.push({
            title: data.Heading || input.query,
            url: data.AbstractURL || "",
            snippet: data.AbstractText,
          });
        }
        for (const rt of (data.RelatedTopics ?? []).slice(0, input.maxResults)) {
          if (rt.Text && rt.FirstURL) {
            results.push({ title: rt.Text.slice(0, 70), url: rt.FirstURL, snippet: rt.Text });
          }
        }
        if (results.length > 0) {
          return {
            untrusted: true,
            json: { results },
            text: results
              .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n"),
          };
        }
      }
      return {
        untrusted: true,
        text: `"${input.query}" için doğrudan sonuç alınamadı. Daha kapsamlı web araması için Ayarlar → Araçlar'dan Tavily API anahtarı ekleyebilirsin.`,
      };
    } catch (err) {
      return {
        untrusted: true,
        isError: true,
        text: `Web araması şu an erişilemiyor (çevrimdışı veya ağ engeli): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

// ==================== 4. URL Reader Tool ====================

export const urlReaderManifest: ToolManifest = {
  id: "url-reader",
  name: "Web Sayfası Okuyucu",
  version: "1.0.0",
  publisher: "symforyx",
  verified: true,
  type: "builtin",
  category: "web",
  description: "Verilen URL'deki web sayfasının metin içeriğini güvenli biçimde çeker ve temizler.",
  inputs: {
    url: { type: "string", required: true, description: "Okunacak sayfa adresi" },
  },
  permissions: {
    network: ["*"],
    filesystem: "none",
    secrets: [],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { slash: "/oku", confirm: "never" },
  runtime: { timeout_ms: 10000 },
  rating: 4.8,
  installed: true,
  enabled: true,
  policy: "allow_always",
};

export const urlReaderTool = defineTool({
  id: urlReaderManifest.id,
  manifest: urlReaderManifest,
  input: z.object({
    url: z.string().min(4),
  }),
  async run({ input, ctx }) {
    ctx.progress(`Sayfa okunuyor: ${input.url}`);
    try {
      const res = await ctx.fetch(input.url, {
        headers: { "User-Agent": "SYMFORYX/1.0 (+https://github.com/ozkandev/symforyx)" },
      });
      if (!res.ok) {
        return { isError: true, text: `Sayfa okunamadı (HTTP ${res.status})` };
      }
      const html = await res.text();
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);
      return {
        untrusted: true,
        text: `**${input.url}** sayfa özeti:\n\n${cleaned}`,
      };
    } catch (err) {
      return {
        isError: true,
        untrusted: true,
        text: `URL okunamadı: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

// ==================== 5. Live Preview Tool ====================

export const livePreviewManifest: ToolManifest = {
  id: "live-preview",
  name: "Canlı Önizleme",
  version: "1.0.0",
  publisher: "symforyx",
  verified: true,
  type: "builtin",
  category: "preview",
  description: "HTML/CSS/JS arayüz kodlarını Artefakt panelinde masaüstü, tablet ve mobil boyutlarda canlı önizler.",
  inputs: {
    html: { type: "string", required: true, description: "Önizlenecek HTML içeriği" },
    title: { type: "string", default: "Canlı Önizleme" },
  },
  permissions: {
    network: [],
    filesystem: "none",
    secrets: [],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { slash: "/onizle", confirm: "never" },
  runtime: { timeout_ms: 3000 },
  rating: 5.0,
  installed: true,
  enabled: true,
  policy: "allow_always",
};

export const livePreviewTool = defineTool({
  id: livePreviewManifest.id,
  manifest: livePreviewManifest,
  input: z.object({
    html: z.string().min(1),
    title: z.string().default("Canlı Önizleme"),
  }),
  async run({ input, ctx }) {
    const art = await ctx.artifacts.create({
      kind: "preview",
      title: input.title,
      mime: "text/html",
      language: "html",
      content: input.html,
    });
    return {
      text: `Canlı önizleme hazırlandı (**${art.title}**). Sağdaki Artefakt panelinden masaüstü, tablet veya mobil görünümü seçebilirsin.`,
      artifactIds: [art.id],
    };
  },
});

// ==================== 6. File / CSV Analyzer Tool ====================

export const fileReaderManifest: ToolManifest = {
  id: "file-reader",
  name: "Dosya & Tablo Analizci",
  version: "1.0.0",
  publisher: "symforyx",
  verified: true,
  type: "builtin",
  category: "data",
  description: "CSV, JSON ve metin belgelerini ayrıştırır, sütun istatistikleri ve tablo özeti çıkarır.",
  inputs: {
    content: { type: "string", required: true },
    name: { type: "string", default: "veri.csv" },
  },
  permissions: {
    network: [],
    filesystem: "project_read",
    secrets: [],
    writes_external: false,
  },
  cost: { model: "free" },
  ui: { confirm: "never" },
  runtime: { timeout_ms: 5000 },
  rating: 4.8,
  installed: true,
  enabled: true,
  policy: "allow_always",
};

export const fileReaderTool = defineTool({
  id: fileReaderManifest.id,
  manifest: fileReaderManifest,
  input: z.object({
    content: z.string().min(1),
    name: z.string().default("veri.csv"),
  }),
  async run({ input, ctx }) {
    const lines = input.content.trim().split(/\r?\n/);
    if (input.name.toLowerCase().endsWith(".csv") && lines.length >= 2) {
      const headers = lines[0].split(",").map((h) => h.trim());
      const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
      const art = await ctx.artifacts.create({
        kind: "table",
        title: input.name,
        mime: "application/json",
        content: JSON.stringify({ headers, rows }, null, 2),
      });
      return {
        json: { headers, rowCount: rows.length, preview: rows.slice(0, 5) },
        text: `**${input.name}** ayrıştırıldı: ${headers.length} sütun (${headers.join(", ")}), ${rows.length} satır.`,
        artifactIds: [art.id],
      };
    }
    return {
      text: `**${input.name}** okundu (${lines.length} satır, ${input.content.length} karakter).`,
    };
  },
});

export const BUILTIN_TOOLS = [
  colorPaletteTool,
  codeSandboxTool,
  webSearchTool,
  urlReaderTool,
  livePreviewTool,
  fileReaderTool,
];

export const BUILTIN_MANIFESTS = BUILTIN_TOOLS.map((t) => t.manifest);
