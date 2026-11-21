import {
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ImageRequest,
  type ImageResult,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { mapHttpError } from "./helpers.ts";

export const FAL_MODELS: ModelInfo[] = [
  {
    id: "fal-ai/flux-pro/v1.1",
    providerId: "fal",
    displayName: "Flux 1.1 Pro",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.04 },
    visible: true,
  },
  {
    id: "fal-ai/flux/dev",
    providerId: "fal",
    displayName: "Flux Dev",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.025 },
    visible: true,
  },
  {
    id: "fal-ai/recraft-v3",
    providerId: "fal",
    displayName: "Recraft V3 (Design & Vector)",
    capabilities: ["image.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.04 },
    visible: true,
  },
];

export const STABILITY_MODELS: ModelInfo[] = [
  {
    id: "sd3.5-large",
    providerId: "stability",
    displayName: "Stable Diffusion 3.5 Large",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.065 },
    visible: true,
  },
  {
    id: "stable-image-ultra",
    providerId: "stability",
    displayName: "Stable Image Ultra",
    capabilities: ["image.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.08 },
    visible: true,
  },
];

export const IDEOGRAM_MODELS: ModelInfo[] = [
  {
    id: "V_3",
    providerId: "ideogram",
    displayName: "Ideogram 3.0 (Tipografi & UI)",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.05 },
    visible: true,
  },
];

export const COMFYUI_MODELS: ModelInfo[] = [
  {
    id: "comfyui-default",
    providerId: "comfyui",
    displayName: "ComfyUI Yerel İş Akışı",
    capabilities: ["image.generate", "image.edit"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0 },
    local: true,
    visible: true,
  },
];

function enrichPromptWithRefs(req: ImageRequest): string {
  const ideaRefs = (req.references ?? []).filter((r) => r.kind === "idea");
  const imgRefs = (req.references ?? []).filter((r) => r.kind === "image");
  const parts = [req.prompt];
  if (ideaRefs.length > 0) {
    parts.push(
      "Referans Fikirler: " +
        ideaRefs.map((r) => `[${r.role}] ${r.title}${r.note ? `: ${r.note}` : ""}`).join(" | ")
    );
  }
  if (imgRefs.length > 0) {
    parts.push(
      "Referans Görsel Yönergeleri: " +
        imgRefs.map((r) => `[${r.role}] ${r.title}${r.note ? `: ${r.note}` : ""}`).join(" | ")
    );
  }
  return parts.join("\n");
}

export class FalImageAdapter implements ProviderAdapter {
  id = "fal";
  displayName = "Flux / Fal.ai";
  auth: "api_key" = "api_key";
  badgeColor = "#18181B";
  badgeLetter = "F";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) {
      return { ok: false, message: "Geçerli bir Fal.ai API anahtarı girin." };
    }
    return { ok: true, message: "Fal.ai anahtarı kaydedildi. Flux & Recraft modelleri hazır.", models: FAL_MODELS };
  }

  async listModels() {
    return FAL_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(_req: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: "text", text: "Bu sağlayıcı görsel üretim odaklıdır; görsel üretimi için `@fal` veya Görsel seçicisini kullan." };
    yield { type: "done" };
  }

  async generateImage(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    const start = Date.now();
    const model = req.modelId || "fal-ai/flux-pro/v1.1";
    const baseUrl = (req.baseUrl || "https://fal.run").replace(/\/$/, "");
    const payload: Record<string, unknown> = {
      prompt: enrichPromptWithRefs(req),
      image_size: "landscape_16_9",
    };
    if (req.referenceImages?.[0]) {
      payload.image_url = `data:${req.referenceImages[0].mime};base64,${req.referenceImages[0].base64}`;
    }

    const res = await fetch(`${baseUrl}/${model}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${req.apiKey ?? ""}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) throw mapHttpError(this.id, res.status, await res.text());
    const data = (await res.json()) as { images?: Array<{ url: string; content_type?: string }> };
    const img = data.images?.[0];
    if (!img?.url) throw mapHttpError(this.id, 502, "Görsel URL alınamadı");
    const imgRes = await fetch(img.url, { signal });
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    return {
      mime: img.content_type || "image/png",
      base64,
      costUsd: 0.04,
      latencyMs: Date.now() - start,
    };
  }

  estimateCost(req: { modelId: string; inputTokens: number; images?: number }): CostEstimate {
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: 0,
      estimatedCostUsd: Number(((req.images ?? 1) * 0.04).toFixed(4)),
    };
  }
}

export class StabilityImageAdapter implements ProviderAdapter {
  id = "stability";
  displayName = "Stability AI";
  auth: "api_key" = "api_key";
  badgeColor = "#3B82F6";
  badgeLetter = "S";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) return { ok: false, message: "Geçerli bir Stability API anahtarı girin." };
    return { ok: true, message: "Stability AI anahtarı kaydedildi.", models: STABILITY_MODELS };
  }

  async listModels() {
    return STABILITY_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(): AsyncIterable<ChatChunk> {
    yield { type: "text", text: "Stability AI görsel üretim sağlayıcısıdır." };
    yield { type: "done" };
  }

  async generateImage(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    const start = Date.now();
    const form = new FormData();
    form.append("prompt", enrichPromptWithRefs(req));
    form.append("output_format", "png");
    if (req.referenceImages?.[0]) {
      const bytes = Buffer.from(req.referenceImages[0].base64, "base64");
      form.append("image", new Blob([bytes], { type: req.referenceImages[0].mime }), "ref.png");
      form.append("mode", "image-to-image");
      form.append("strength", "0.65");
    }
    const endpoint =
      req.modelId === "stable-image-ultra"
        ? "https://api.stability.ai/v2beta/stable-image/generate/ultra"
        : "https://api.stability.ai/v2beta/stable-image/generate/sd3";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey ?? ""}`,
        Accept: "image/*",
      },
      body: form,
      signal,
    });
    if (!res.ok) throw mapHttpError(this.id, res.status, await res.text());
    const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { mime: "image/png", base64, costUsd: 0.065, latencyMs: Date.now() - start };
  }

  estimateCost(req: { modelId: string; inputTokens: number; images?: number }): CostEstimate {
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: 0,
      estimatedCostUsd: Number(((req.images ?? 1) * 0.065).toFixed(4)),
    };
  }
}

export class IdeogramImageAdapter implements ProviderAdapter {
  id = "ideogram";
  displayName = "Ideogram";
  auth: "api_key" = "api_key";
  badgeColor = "#0EA5E9";
  badgeLetter = "I";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) return { ok: false, message: "Geçerli bir Ideogram API anahtarı girin." };
    return { ok: true, message: "Ideogram anahtarı kaydedildi.", models: IDEOGRAM_MODELS };
  }

  async listModels() {
    return IDEOGRAM_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(): AsyncIterable<ChatChunk> {
    yield { type: "text", text: "Ideogram tipografi ve görsel tasarım sağlayıcısıdır." };
    yield { type: "done" };
  }

  async generateImage(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
    const start = Date.now();
    const res = await fetch("https://api.ideogram.ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": req.apiKey ?? "",
      },
      body: JSON.stringify({
        image_request: {
          prompt: enrichPromptWithRefs(req),
          model: req.modelId || "V_3",
          magic_prompt_option: "AUTO",
        },
      }),
      signal,
    });
    if (!res.ok) throw mapHttpError(this.id, res.status, await res.text());
    const data = (await res.json()) as { data?: Array<{ url: string }> };
    const url = data.data?.[0]?.url;
    if (!url) throw mapHttpError(this.id, 502, "Ideogram görsel URL döndürmedi");
    const imgRes = await fetch(url, { signal });
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    return { mime: "image/png", base64, costUsd: 0.05, latencyMs: Date.now() - start };
  }

  estimateCost(req: { modelId: string; inputTokens: number; images?: number }): CostEstimate {
    return {
      estimatedInputTokens: req.inputTokens,
      estimatedOutputTokens: 0,
      estimatedCostUsd: Number(((req.images ?? 1) * 0.05).toFixed(4)),
    };
  }
}

export class ComfyUIAdapter implements ProviderAdapter {
  id = "comfyui";
  displayName = "ComfyUI (Yerel)";
  auth: "none" = "none";
  badgeColor = "#059669";
  badgeLetter = "U";

  async validateCredentials(_secret: string, baseUrl?: string) {
    const url = (baseUrl || "http://127.0.0.1:8188").replace(/\/$/, "");
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 2000);
      const res = await fetch(`${url}/system_stats`, { signal: ac.signal });
      if (!res.ok) return { ok: false, message: `ComfyUI yanıt vermedi (HTTP ${res.status})` };
      return { ok: true, message: "Yerel ComfyUI sunucusu algılandı.", models: COMFYUI_MODELS };
    } catch {
      return { ok: false, message: `ComfyUI ${url} adresinde erişilemiyor.` };
    }
  }

  async listModels() {
    return COMFYUI_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(): AsyncIterable<ChatChunk> {
    yield { type: "text", text: "ComfyUI yerel görsel üretim motorudur." };
    yield { type: "done" };
  }

  estimateCost(): CostEstimate {
    return { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0 };
  }
}
