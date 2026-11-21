import {
  estimateTokens,
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { flattenMessageText, mapHttpError } from "./helpers.ts";

export class OllamaAdapter implements ProviderAdapter {
  id = "ollama";
  displayName = "Ollama (Yerel)";
  auth: "none" = "none";
  badgeColor = "#22A06B";
  badgeLetter = "L";
  defaultBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  async validateCredentials(
    _secret: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message?: string; models?: ModelInfo[] }> {
    const base = (baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        return { ok: false, message: `Ollama yanıt vermedi (HTTP ${res.status})` };
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models: ModelInfo[] = (data.models ?? []).map((m) => ({
        id: m.name,
        providerId: "ollama",
        displayName: m.name,
        capabilities: ["chat", "tools"],
        contextWindow: 32768,
        maxOutputTokens: 4096,
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        local: true,
        visible: true,
      }));
      return {
        ok: true,
        message: `Ollama algılandı (${models.length} yerel model).`,
        models,
      };
    } catch {
      return {
        ok: false,
        message: `Ollama çalışmıyor veya ${base} adresinde erişilemiyor.`,
      };
    }
  }

  async listModels(_secret?: string, baseUrl?: string): Promise<ModelInfo[]> {
    const check = await this.validateCredentials("", baseUrl);
    return check.models ?? [];
  }

  toProviderFormat(messages: SymMessage[], systemPrompt?: string) {
    const out: Array<{ role: string; content: string }> = [];
    if (systemPrompt) out.push({ role: "system", content: systemPrompt });
    for (const msg of messages) {
      const text = flattenMessageText(msg);
      if (!text) continue;
      out.push({ role: msg.role === "assistant" ? "assistant" : "user", content: text });
    }
    return out;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const base = (req.baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
    const messages = this.toProviderFormat(req.messages, req.systemPrompt);

    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.modelId,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw mapHttpError(this.id, res.status, await res.text());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        if (signal.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              acc += parsed.message.content;
              yield { type: "text", text: parsed.message.content };
            }
            if (parsed.done) {
              inputTokens = parsed.prompt_eval_count ?? estimateTokens(JSON.stringify(messages));
              outputTokens = parsed.eval_count ?? estimateTokens(acc);
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "usage",
      inputTokens: inputTokens || estimateTokens(JSON.stringify(messages)),
      outputTokens: outputTokens || estimateTokens(acc),
    };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number; outputTokens?: number }): CostEstimate {
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: req.outputTokens ?? 400,
      estimatedCostUsd: 0,
    };
  }
}
