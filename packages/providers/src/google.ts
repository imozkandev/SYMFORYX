import {
  estimateTokens,
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { flattenMessageText, mapHttpError, parseSSEStream } from "./helpers.ts";

export const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.5-flash",
    providerId: "google",
    displayName: "Gemini 2.5 Flash",
    capabilities: ["chat", "vision", "tools", "json_mode", "reasoning"],
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    visible: true,
  },
  {
    id: "gemini-2.5-pro",
    providerId: "google",
    displayName: "Gemini 2.5 Pro",
    capabilities: ["chat", "vision", "tools", "json_mode", "reasoning"],
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 1.25, outputPerMTok: 5.0 },
    visible: true,
  },
];

export class GoogleAdapter implements ProviderAdapter {
  id = "google";
  displayName = "Google Gemini";
  auth: "api_key" = "api_key";
  badgeColor = "#4285F4";
  badgeLetter = "✦";

  async validateCredentials(
    secret: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message?: string; models?: ModelInfo[] }> {
    const base = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/models?key=${encodeURIComponent(secret)}`);
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
      }
      return {
        ok: true,
        message: `Bağlantı başarılı. ${GOOGLE_MODELS.length} model hazır.`,
        models: GOOGLE_MODELS,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return GOOGLE_MODELS;
  }

  toProviderFormat(
    messages: SymMessage[],
    resolvedArtifacts?: ChatRequest["resolvedArtifacts"]
  ) {
    return messages
      .map((msg) => {
        const parts: Array<Record<string, unknown>> = [];
        const text = flattenMessageText(msg);
        if (text) parts.push({ text });
        if (resolvedArtifacts) {
          for (const p of msg.parts) {
            if (p.type === "image") {
              const art = resolvedArtifacts[p.artifactId];
              if (art?.base64) {
                parts.push({ inlineData: { mimeType: art.mime, data: art.base64 } });
              }
            }
          }
        }
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      })
      .filter((m) => m.parts.length > 0);
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const base = (req.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const contents = this.toProviderFormat(req.messages, req.resolvedArtifacts);

    const body: Record<string, unknown> = { contents };
    if (req.systemPrompt) {
      body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
    }
    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      body.generationConfig = {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      };
    }

    const url = `${base}/models/${encodeURIComponent(req.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey ?? "")}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw mapHttpError(this.id, res.status, await res.text());
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let accText = "";

    for await (const evt of parseSSEStream(res.body, signal)) {
      try {
        const parsed = JSON.parse(evt.data);
        const parts = parsed.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            accText += part.text;
            yield { type: "text", text: part.text };
          }
        }
        if (parsed.usageMetadata) {
          inputTokens = parsed.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = parsed.usageMetadata.candidatesTokenCount ?? outputTokens;
        }
      } catch {
        // ignore
      }
    }

    if (inputTokens === 0) inputTokens = estimateTokens(JSON.stringify(contents));
    if (outputTokens === 0) outputTokens = estimateTokens(accText);

    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number; outputTokens?: number }): CostEstimate {
    const model = GOOGLE_MODELS.find((m) => m.id === req.modelId);
    const outTok = req.outputTokens ?? Math.min(800, req.inputTokens);
    const p = model?.pricing ?? { inputPerMTok: 0.15, outputPerMTok: 0.6 };
    const cost =
      (req.inputTokens / 1_000_000) * p.inputPerMTok +
      (outTok / 1_000_000) * p.outputPerMTok;
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: outTok,
      estimatedCostUsd: Number(cost.toFixed(6)),
    };
  }
}
