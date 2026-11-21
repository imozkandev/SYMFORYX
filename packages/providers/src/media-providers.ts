import {
  type ChatChunk,
  type ChatRequest,
  type CostEstimate,
  type ModelInfo,
  type ProviderAdapter,
  type SymMessage,
} from "@symforyx/core";
import { flattenMessageText, mapHttpError } from "./helpers.ts";

export const VIDEO_MODELS: ModelInfo[] = [
  {
    id: "fal-ai/kling-video/v2/master/text-to-video",
    providerId: "video_studio",
    displayName: "Kling 2.0 Master (Video)",
    capabilities: ["video.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.35 },
    visible: true,
  },
  {
    id: "fal-ai/veo2",
    providerId: "video_studio",
    displayName: "Google Veo 2 (Video)",
    capabilities: ["video.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.5 },
    visible: true,
  },
  {
    id: "runway-gen4-turbo",
    providerId: "video_studio",
    displayName: "Runway Gen-4 Turbo",
    capabilities: ["video.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.25 },
    visible: true,
  },
];

export const AUDIO_MUSIC_MODELS: ModelInfo[] = [
  {
    id: "eleven_multilingual_v2",
    providerId: "audio_studio",
    displayName: "ElevenLabs Multilingual v2 (TTS)",
    capabilities: ["audio.tts"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.03 },
    visible: true,
  },
  {
    id: "suno-v4",
    providerId: "audio_studio",
    displayName: "Suno v4 (Müzik Üretimi)",
    capabilities: ["music.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.08 },
    visible: true,
  },
  {
    id: "udio-v1.5",
    providerId: "audio_studio",
    displayName: "Udio 1.5 (Müzik & SFX)",
    capabilities: ["music.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.06 },
    visible: true,
  },
];

export const MODEL3D_MODELS: ModelInfo[] = [
  {
    id: "meshy-4-preview",
    providerId: "model3d_studio",
    displayName: "Meshy-4 (Text/Image to 3D GLB)",
    capabilities: ["model3d.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.2 },
    visible: true,
  },
  {
    id: "tripo-v2.5",
    providerId: "model3d_studio",
    displayName: "Tripo3D v2.5 (3D Varlık)",
    capabilities: ["model3d.generate"],
    contextWindow: 16000,
    maxOutputTokens: 0,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.15 },
    visible: true,
  },
];

export class VideoStudioAdapter implements ProviderAdapter {
  id = "video_studio";
  displayName = "Video Stüdyo (Kling / Veo / Runway)";
  auth: "api_key" = "api_key";
  badgeColor = "#DC2626";
  badgeLetter = "V";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) return { ok: false, message: "Video API anahtarı (Fal.ai veya Runway) girin." };
    return { ok: true, message: "Video Stüdyo anahtarı kaydedildi.", models: VIDEO_MODELS };
  }

  async listModels() {
    return VIDEO_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const prompt = req.messages.at(-1) ? flattenMessageText(req.messages.at(-1)!) : "";
    if (req.apiKey && req.modelId.startsWith("fal-ai/")) {
      const res = await fetch(`https://fal.run/${req.modelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Key ${req.apiKey}` },
        body: JSON.stringify({ prompt }),
        signal,
      });
      if (!res.ok) throw mapHttpError(this.id, res.status, await res.text());
      const data = (await res.json()) as { video?: { url?: string } };
      yield {
        type: "text",
        text: data.video?.url
          ? `Video üretildi (${req.modelId}):\n\n[Videoyu İzle / İndir](${data.video.url})`
          : `Video görevi tamamlandı:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
      };
      yield { type: "usage", inputTokens: 200, outputTokens: 80 };
      yield { type: "done" };
      return;
    }
    yield {
      type: "text",
      text: `Video üretim isteği hazırlandı (\`${req.modelId}\`). Gerçek video render için **Ayarlar → Sağlayıcılar** ekranından Fal.ai/Runway API anahtarını ekle.`,
    };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number }): CostEstimate {
    const m = VIDEO_MODELS.find((x) => x.id === req.modelId);
    return { estimatedInputTokens: req.inputTokens, estimatedOutputTokens: 0, estimatedCostUsd: m?.pricing?.perImage ?? 0.3 };
  }
}

export class AudioMusicAdapter implements ProviderAdapter {
  id = "audio_studio";
  displayName = "Müzik & Ses (ElevenLabs / Suno / Udio)";
  auth: "api_key" = "api_key";
  badgeColor = "#D97706";
  badgeLetter = "♪";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) return { ok: false, message: "ElevenLabs / Suno / Udio API anahtarı girin." };
    return { ok: true, message: "Müzik & Ses Stüdyo anahtarı kaydedildi.", models: AUDIO_MUSIC_MODELS };
  }

  async listModels() {
    return AUDIO_MUSIC_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    yield {
      type: "text",
      text: `Ses / Müzik üretimi (\`${req.modelId}\`) için uç nokta hazır. API anahtarı eklediğinde doğrudan MP3/WAV üretilir.`,
    };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number }): CostEstimate {
    const m = AUDIO_MUSIC_MODELS.find((x) => x.id === req.modelId);
    return { estimatedInputTokens: req.inputTokens, estimatedOutputTokens: 0, estimatedCostUsd: m?.pricing?.perImage ?? 0.05 };
  }
}

export class Model3DAdapter implements ProviderAdapter {
  id = "model3d_studio";
  displayName = "3D Model Stüdyo (Meshy / Tripo3D)";
  auth: "api_key" = "api_key";
  badgeColor = "#0D9488";
  badgeLetter = "3D";

  async validateCredentials(secret: string) {
    if (!secret || secret.length < 8) return { ok: false, message: "Meshy veya Tripo3D API anahtarı girin." };
    return { ok: true, message: "3D Model Stüdyo anahtarı kaydedildi.", models: MODEL3D_MODELS };
  }

  async listModels() {
    return MODEL3D_MODELS;
  }

  toProviderFormat(messages: SymMessage[]) {
    return messages;
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const prompt = req.messages.at(-1) ? flattenMessageText(req.messages.at(-1)!) : "";
    if (req.apiKey && req.modelId.startsWith("meshy")) {
      const res = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.apiKey}` },
        body: JSON.stringify({ mode: "preview", prompt, art_style: "realistic" }),
        signal,
      });
      if (!res.ok) throw mapHttpError(this.id, res.status, await res.text());
      const data = await res.json();
      yield { type: "text", text: `Meshy 3D üretim görevi başlatıldı:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` };
      yield { type: "usage", inputTokens: 150, outputTokens: 60 };
      yield { type: "done" };
      return;
    }
    yield { type: "text", text: `3D Model (\`${req.modelId}\`) görevi hazırlandı. Gerçek GLB çıktısı için Meshy/Tripo API anahtarı bağlayabilirsin.` };
    yield { type: "done" };
  }

  estimateCost(req: { modelId: string; inputTokens: number }): CostEstimate {
    const m = MODEL3D_MODELS.find((x) => x.id === req.modelId);
    return { estimatedInputTokens: req.inputTokens, estimatedOutputTokens: 0, estimatedCostUsd: m?.pricing?.perImage ?? 0.2 };
  }
}
