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

export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-20250514",
    providerId: "anthropic",
    displayName: "Claude Sonnet 4",
    capabilities: ["chat", "vision", "tools", "reasoning"],
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    visible: true,
  },
  {
    id: "claude-3-5-haiku-latest",
    providerId: "anthropic",
    displayName: "Claude 3.5 Haiku",
    capabilities: ["chat", "vision", "tools"],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: { inputPerMTok: 0.8, outputPerMTok: 4.0 },
    visible: true,
  },
];

export class AnthropicAdapter implements ProviderAdapter {
  id = "anthropic";
  displayName = "Anthropic";
  auth: "api_key" = "api_key";
  badgeColor = "#D97757";
  badgeLetter = "C";

  async validateCredentials(
    secret: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message?: string; models?: ModelInfo[] }> {
    const url = `${(baseUrl || "https://api.anthropic.com").replace(/\/$/, "")}/v1/models`;
    try {
      const res = await fetch(url, {
        headers: {
          "x-api-key": secret,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
      }
      const data = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
      const models = (data.data ?? []).slice(0, 12).map((m) => {
        const known = ANTHROPIC_MODELS.find((k) => k.id === m.id);
        return (
          known ?? {
            id: m.id,
            providerId: "anthropic",
            displayName: m.display_name ?? m.id,
            capabilities: ["chat", "vision", "tools"] as ModelInfo["capabilities"],
            contextWindow: 200000,
            maxOutputTokens: 8192,
            pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
            visible: true,
          }
        );
      });
      return {
        ok: true,
        message: `Bağlantı başarılı. ${models.length || ANTHROPIC_MODELS.length} model bulundu.`,
        models: models.length > 0 ? models : ANTHROPIC_MODELS,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  toProviderFormat(
    messages: SymMessage[],
    resolvedArtifacts?: ChatRequest["resolvedArtifacts"]
  ) {
    const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    for (const msg of messages) {
      const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
      const text = flattenMessageText(msg);
      const images = msg.parts.filter((p) => p.type === "image");

      let content: unknown = text;
      if (images.length > 0 && resolvedArtifacts && role === "user") {
        const blocks: Array<Record<string, unknown>> = [];
        for (const img of images) {
          if (img.type === "image") {
            const art = resolvedArtifacts[img.artifactId];
            if (art?.base64 && (art.mime === "image/png" || art.mime === "image/jpeg" || art.mime === "image/webp" || art.mime === "image/gif")) {
              blocks.push({
                type: "image",
                source: { type: "base64", media_type: art.mime, data: art.base64 },
              });
            }
          }
        }
        if (text) blocks.push({ type: "text", text });
        content = blocks;
      }

      if (!text && (!Array.isArray(content) || content.length === 0)) continue;

      // Anthropic requires alternating user/assistant turns
      if (out.length > 0 && out[out.length - 1].role === role) {
        const prev = out[out.length - 1];
        if (typeof prev.content === "string" && typeof content === "string") {
          prev.content = `${prev.content}\n\n${content}`;
        } else {
          out.push({ role: role === "user" ? "assistant" : "user", content: "…" });
          out.push({ role, content });
        }
      } else {
        out.push({ role, content });
      }
    }
    return out;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const baseUrl = (req.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const messages = this.toProviderFormat(req.messages, req.resolvedArtifacts);

    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      messages,
    };
    if (req.systemPrompt) {
      // Enable Anthropic prompt caching for long system/project prompts
      body.system = [
        {
          type: "text",
          text: req.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ];
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      throw mapHttpError(this.id, res.status, await res.text());
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let accText = "";

    for await (const evt of parseSSEStream(res.body, signal)) {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed.type === "message_start" && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens ?? 0;
          cachedTokens = parsed.message.usage.cache_read_input_tokens ?? 0;
        } else if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
          accText += parsed.delta.text;
          yield { type: "text", text: parsed.delta.text };
        } else if (parsed.type === "message_delta" && parsed.usage) {
          outputTokens = parsed.usage.output_tokens ?? outputTokens;
        }
      } catch {
        // skip
      }
    }

    if (inputTokens === 0) inputTokens = estimateTokens(JSON.stringify(messages));
    if (outputTokens === 0) outputTokens = estimateTokens(accText);

    yield { type: "usage", inputTokens, outputTokens, cachedTokens };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number; outputTokens?: number }): CostEstimate {
    const model = ANTHROPIC_MODELS.find((m) => m.id === req.modelId);
    const outTok = req.outputTokens ?? Math.min(1000, req.inputTokens);
    const p = model?.pricing ?? { inputPerMTok: 3.0, outputPerMTok: 15.0 };
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
