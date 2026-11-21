import {
  estimateTokens,
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ImageRequest,
  type ImageResult,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { flattenMessageText, mapHttpError, parseSSEStream } from "./helpers.ts";

export const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    providerId: "openai",
    displayName: "GPT-4o",
    capabilities: ["chat", "vision", "tools", "json_mode"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 2.5, outputPerMTok: 10.0 },
    visible: true,
  },
  {
    id: "gpt-4o-mini",
    providerId: "openai",
    displayName: "GPT-4o Mini",
    capabilities: ["chat", "vision", "tools", "json_mode"],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    visible: true,
  },
  {
    id: "o3-mini",
    providerId: "openai",
    displayName: "o3-mini",
    capabilities: ["chat", "reasoning", "tools"],
    contextWindow: 200000,
    maxOutputTokens: 100000,
    pricing: { inputPerMTok: 1.1, outputPerMTok: 4.4 },
    visible: true,
  },
  {
    id: "gpt-image-1",
    providerId: "openai",
    displayName: "GPT Image 1",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 32000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.04 },
    visible: true,
  },
];

export class OpenAIAdapter implements ProviderAdapter {
  id: string;
  displayName: string;
  auth: "api_key" | "oauth" | "none" = "api_key";
  badgeColor: string;
  badgeLetter: string;
  defaultBaseUrl: string;
  defaultModels: ModelInfo[];

  constructor(opts?: {
    id?: string;
    displayName?: string;
    baseUrl?: string;
    badgeColor?: string;
    badgeLetter?: string;
    models?: ModelInfo[];
    auth?: "api_key" | "oauth" | "none";
  }) {
    this.id = opts?.id ?? "openai";
    this.displayName = opts?.displayName ?? "OpenAI";
    this.defaultBaseUrl = opts?.baseUrl ?? "https://api.openai.com/v1";
    this.badgeColor = opts?.badgeColor ?? "#10A37F";
    this.badgeLetter = opts?.badgeLetter ?? "G";
    this.defaultModels = opts?.models ?? OPENAI_MODELS;
    if (opts?.auth) this.auth = opts.auth;
  }

  async validateCredentials(
    secret: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message?: string; models?: ModelInfo[] }> {
    const url = `${(baseUrl || this.defaultBaseUrl).replace(/\/$/, "")}/models`;
    try {
      const res = await fetch(url, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 140)}` };
      }
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const discovered = (data.data ?? []).slice(0, 20).map((m) => {
        const known = this.defaultModels.find((k) => k.id === m.id);
        return (
          known ?? {
            id: m.id,
            providerId: this.id,
            displayName: m.id,
            capabilities: ["chat", "tools"] as ModelInfo["capabilities"],
            contextWindow: 128000,
            maxOutputTokens: 8192,
            visible: true,
          }
        );
      });
      return {
        ok: true,
        message: `Bağlantı başarılı. ${discovered.length} model bulundu.`,
        models: discovered.length > 0 ? discovered : this.defaultModels,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.defaultModels;
  }

  toProviderFormat(
    messages: SymMessage[],
    systemPrompt?: string,
    resolvedArtifacts?: ChatRequest["resolvedArtifacts"]
  ) {
    const out: Array<Record<string, unknown>> = [];
    if (systemPrompt) {
      out.push({ role: "system", content: systemPrompt });
    }
    for (const msg of messages) {
      const role = msg.role === "tool" ? "user" : msg.role;
      const imageParts = msg.parts.filter((p) => p.type === "image");
      const text = flattenMessageText(msg);

      if (imageParts.length > 0 && resolvedArtifacts && role === "user") {
        const content: Array<Record<string, unknown>> = [];
        if (text) content.push({ type: "text", text });
        for (const img of imageParts) {
          if (img.type === "image") {
            const art = resolvedArtifacts[img.artifactId];
            if (art?.base64) {
              content.push({
                type: "image_url",
                image_url: { url: `data:${art.mime};base64,${art.base64}` },
              });
            }
          }
        }
        out.push({ role, content });
      } else if (text) {
        out.push({ role, content: text });
      }
    }
    return out;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const baseUrl = (req.baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
    const messages = this.toProviderFormat(req.messages, req.systemPrompt, req.resolvedArtifacts);

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.id, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
      },
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
      if (evt.data === "[DONE]") break;
      try {
        const parsed = JSON.parse(evt.data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          accText += delta.content;
          yield { type: "text", text: delta.content };
        }
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
          outputTokens = parsed.usage.completion_tokens ?? outputTokens;
        }
      } catch {
        // Ignore malformed SSE fragments
      }
    }

    if (inputTokens === 0) {
      inputTokens = estimateTokens(JSON.stringify(messages));
    }
    if (outputTokens === 0) {
      outputTokens = estimateTokens(accText);
    }

    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done" };
  }

  async generateImage(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    const start = Date.now();
    const baseUrl = (req.baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
    const model = req.modelId || "gpt-image-1";

    const res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        n: 1,
        size: req.size ?? "1024x1024",
        response_format: model === "dall-e-3" ? "b64_json" : undefined,
      }),
      signal,
    });

    if (!res.ok) {
      throw mapHttpError(this.id, res.status, await res.text());
    }
    const json = (await res.json()) as {
      data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const item = json.data?.[0];
    let base64 = item?.b64_json ?? "";
    if (!base64 && item?.url) {
      const imgRes = await fetch(item.url, { signal });
      base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    }

    return {
      mime: "image/png",
      base64,
      revisedPrompt: item?.revised_prompt,
      costUsd: 0.04,
      latencyMs: Date.now() - start,
    };
  }

  estimateCost(req: {
    modelId: string;
    inputTokens: number;
    outputTokens?: number;
    images?: number;
  }): CostEstimate {
    const model = this.defaultModels.find((m) => m.id === req.modelId);
    const outTok = req.outputTokens ?? Math.min(800, req.inputTokens);
    const pricing = model?.pricing ?? { inputPerMTok: 1.0, outputPerMTok: 3.0 };
    const tokenCost =
      (req.inputTokens / 1_000_000) * pricing.inputPerMTok +
      (outTok / 1_000_000) * pricing.outputPerMTok;
    const imgCost = (req.images ?? 0) * (pricing.perImage ?? 0.04);
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: outTok,
      estimatedCostUsd: Number((tokenCost + imgCost).toFixed(6)),
    };
  }
}
