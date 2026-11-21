#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.SYMFORYX_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.SYMFORYX_TOKEN || "";

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
SYMFORYX CLI · by ozkandev

Kullanım:
  symforyx chat "<mesaj>" [--mode smart|compare|council|agent] [--out dosya.png]
  symforyx models                       Kullanılabilir modelleri listele
  symforyx roles                        Görev rollerini listele
  symforyx flow list                    Akışları listele
  symforyx flow run <id> [--input k=v]  Akış çalıştır
  symforyx tool list                    Araçları listele
  symforyx tool init <ad>               Yeni araç iskeleti oluştur
  symforyx tool install <id>            Mağazadan araç kur
  symforyx keys set <provider> <key>    API anahtarını şifreli kasaya kaydet
  symforyx usage [--month|--daily]      Maliyet ve kullanım özeti
`);
    return;
  }

  if (cmd === "models") {
    const res = await fetch(`${BASE_URL}/api/v1/models`, { headers: headers() });
    const data = (await res.json()) as { models: Array<{ providerId: string; id: string; displayName: string; hasKey: boolean }> };
    for (const m of data.models) {
      console.log(`  [${m.hasKey ? "✓" : "○"}] ${m.providerId}/${m.id} — ${m.displayName}`);
    }
    return;
  }

  if (cmd === "roles") {
    const res = await fetch(`${BASE_URL}/api/v1/roles`, { headers: headers() });
    const data = (await res.json()) as { roles: Array<{ id: string; name: string; primaryProviderId: string; primaryModelId: string }> };
    for (const r of data.roles) {
      console.log(`  @${r.id.padEnd(16)} ${r.name.padEnd(20)} → ${r.primaryProviderId}/${r.primaryModelId}`);
    }
    return;
  }

  if (cmd === "usage") {
    const period = args.includes("--daily") ? "daily" : "monthly";
    const res = await fetch(`${BASE_URL}/api/v1/usage?period=${period}`, { headers: headers() });
    const data = (await res.json()) as { usage: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number; requestCount: number } };
    const u = data.usage;
    console.log(`SYMFORYX Kullanım (${period}):`);
    console.log(`  İstek: ${u.requestCount} | Giriş: ${u.totalInputTokens} tok | Çıkış: ${u.totalOutputTokens} tok | Toplam: $${u.totalCostUsd.toFixed(5)}`);
    return;
  }

  if (cmd === "keys" && args[1] === "set") {
    const providerId = args[2];
    const apiKey = args[3];
    if (!providerId || !apiKey) {
      console.error("Kullanım: symforyx keys set <openai|anthropic|google> <API_KEY>");
      process.exit(1);
    }
    const res = await fetch(`${BASE_URL}/api/v1/providers`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id: providerId, apiKey }),
    });
    const data = await res.json();
    console.log(`✓ ${providerId} anahtarı şifreli kasaya kaydedildi:`, data.provider?.maskedKey);
    return;
  }

  if (cmd === "flow") {
    const sub = args[1];
    if (sub === "list") {
      const res = await fetch(`${BASE_URL}/api/v1/flows`, { headers: headers() });
      const data = (await res.json()) as { flows: Array<{ id: string; name: string; description: string }> };
      for (const f of data.flows) {
        console.log(`  ${f.id.padEnd(22)} ${f.name} — ${f.description}`);
      }
      return;
    }
    if (sub === "run") {
      const flowId = args[2];
      const inputs: Record<string, string> = {};
      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--input" && args[i + 1]) {
          const [k, ...v] = args[i + 1].split("=");
          inputs[k] = v.join("=");
          i++;
        }
      }
      const res = await fetch(`${BASE_URL}/api/v1/flows/${flowId}/run`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ inputs }),
      });
      const data = await res.json();
      console.log(JSON.stringify(data.run, null, 2));
      return;
    }
  }

  if (cmd === "tool") {
    const sub = args[1];
    if (sub === "list") {
      const res = await fetch(`${BASE_URL}/api/v1/tools`, { headers: headers() });
      const data = (await res.json()) as { tools: Array<{ id: string; name: string; installed: boolean; description: string }> };
      for (const t of data.tools) {
        console.log(`  [${t.installed ? "Kurulu" : "Mağaza"}] ${t.id.padEnd(28)} ${t.name}`);
      }
      return;
    }
    if (sub === "install" && args[2]) {
      const res = await fetch(`${BASE_URL}/api/v1/tools/${args[2]}/install`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({}),
      });
      console.log(await res.json());
      return;
    }
    if (sub === "init" && args[2]) {
      const dir = join(process.cwd(), args[2]);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "symforyx.tool.yaml"),
        `id: dev.local.${args[2]}\nname: ${args[2]}\nversion: 1.0.0\npublisher: local\ntype: script\ncategory: developer\ndescription: Özel SYMFORYX aracı\npermissions:\n  network: []\n  filesystem: none\n  secrets: []\n  writes_external: false\ncost:\n  model: free\nruntime:\n  entry: ./index.ts\n  timeout_ms: 10000\n`
      );
      writeFileSync(
        join(dir, "index.ts"),
        `import { defineTool, z } from "@symforyx/tools-sdk";\n\nexport default defineTool({\n  id: "dev.local.${args[2]}",\n  manifest: {} as any,\n  input: z.object({ text: z.string().default("Merhaba") }),\n  async run({ input, ctx }) {\n    ctx.progress("Çalışıyor...");\n    return { text: \`Sonuç: \${input.text}\` };\n  },\n});\n`
      );
      console.log(`✓ Araç iskeleti oluşturuldu: ${dir}`);
      return;
    }
  }

  if (cmd === "chat") {
    let message = args[1] || "";
    let mode = "smart";
    let outPath = "";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--mode" && args[i + 1]) mode = args[++i];
      else if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
      else if (args[i] === "--file" && args[i + 1]) {
        const content = readFileSync(args[++i], "utf8").slice(0, 8000);
        message += `\n\nDosya içeriği:\n\`\`\`\n${content}\n\`\`\``;
      }
    }
    const res = await fetch(`${BASE_URL}/api/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message, mode, stream: false }),
    });
    const data = (await res.json()) as { events: Array<{ type: string; message?: any; artifact?: any }> };
    for (const ev of data.events) {
      if (ev.type === "message_done" && ev.message) {
        const txt = ev.message.parts.map((p: any) => (p.type === "text" ? p.text : "")).join("\n");
        console.log(`\n[${ev.message.author?.modelName ?? "Model"}]\n${txt}\n`);
      }
      if (outPath && ev.type === "artifact_created" && ev.artifact) {
        const latest = ev.artifact.versions.at(-1);
        if (latest) {
          const buf =
            ev.artifact.kind === "image"
              ? Buffer.from(latest.content, "base64")
              : Buffer.from(latest.content, "utf8");
          writeFileSync(outPath, buf);
          console.log(`✓ Artefakt kaydedildi: ${outPath}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error("Hata:", err.message);
  process.exit(1);
});
