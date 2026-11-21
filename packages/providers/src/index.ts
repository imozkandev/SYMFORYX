import {
  SymError,
  type ChatChunk,
  type ChatRequest,
  type ProviderAdapter,
  type ProviderConfig,
} from "@symforyx/core";
import { AnthropicAdapter, ANTHROPIC_MODELS } from "./anthropic.ts";
import { DEMO_MODELS, SymforyxDemoAdapter } from "./demo.ts";
import { GoogleAdapter, GOOGLE_MODELS } from "./google.ts";
import { sleep } from "./helpers.ts";
import {
  ComfyUIAdapter,
  COMFYUI_MODELS,
  FalImageAdapter,
  FAL_MODELS,
  IdeogramImageAdapter,
  IDEOGRAM_MODELS,
  StabilityImageAdapter,
  STABILITY_MODELS,
} from "./image-providers.ts";
import { OllamaAdapter } from "./ollama.ts";
import { OPENAI_MODELS, OpenAIAdapter } from "./openai.ts";
import {
  AUDIO_MUSIC_MODELS,
  AudioMusicAdapter,
  MODEL3D_MODELS,
  Model3DAdapter,
  VIDEO_MODELS,
  VideoStudioAdapter,
} from "./media-providers.ts";

export { AnthropicAdapter, ANTHROPIC_MODELS } from "./anthropic.ts";
export { DEMO_MODELS, SymforyxDemoAdapter } from "./demo.ts";
export { GoogleAdapter, GOOGLE_MODELS } from "./google.ts";
export { OllamaAdapter } from "./ollama.ts";
export { OPENAI_MODELS, OpenAIAdapter } from "./openai.ts";
export * from "./image-providers.ts";
export * from "./media-providers.ts";
export * from "./helpers.ts";

export const DEFAULT_PROVIDER_CONFIGS: Array<Omit<ProviderConfig, "hasKey" | "maskedKey">> = [
  {
    id: "demo",
    type: "demo",
    displayName: "SYMFORYX Stüdyo Demo",
    auth: "none",
    alias: "demo",
    badgeColor: "#3F3F46",
    badgeLetter: "S",
    enabled: true,
    models: DEMO_MODELS,
  },
  {
    id: "openai",
    type: "openai",
    displayName: "OpenAI",
    auth: "api_key",
    baseUrl: "https://api.openai.com/v1",
    alias: "gpt",
    badgeColor: "#10A37F",
    badgeLetter: "G",
    enabled: true,
    models: OPENAI_MODELS,
  },
  {
    id: "anthropic",
    type: "anthropic",
    displayName: "Anthropic",
    auth: "api_key",
    baseUrl: "https://api.anthropic.com",
    alias: "claude",
    badgeColor: "#C86A4B",
    badgeLetter: "C",
    enabled: true,
    models: ANTHROPIC_MODELS,
  },
  {
    id: "google",
    type: "google",
    displayName: "Google Gemini",
    auth: "api_key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    alias: "gemini",
    badgeColor: "#2563EB",
    badgeLetter: "G",
    enabled: true,
    models: GOOGLE_MODELS,
  },
  {
    id: "openrouter",
    type: "openai_compatible",
    displayName: "OpenRouter (200+ Model)",
    auth: "api_key",
    baseUrl: "https://openrouter.ai/api/v1",
    alias: "router",
    badgeColor: "#4F46E5",
    badgeLetter: "R",
    enabled: true,
    models: [
      { id: "anthropic/claude-sonnet-4", providerId: "openrouter", displayName: "Claude Sonnet 4 (OR)", capabilities: ["chat", "vision", "tools"], contextWindow: 200000, maxOutputTokens: 16384, pricing: { inputPerMTok: 3, outputPerMTok: 15 }, visible: true },
      { id: "openai/gpt-4o", providerId: "openrouter", displayName: "GPT-4o (OR)", capabilities: ["chat", "vision", "tools"], contextWindow: 128000, maxOutputTokens: 16384, pricing: { inputPerMTok: 2.5, outputPerMTok: 10 }, visible: true },
      { id: "deepseek/deepseek-r1", providerId: "openrouter", displayName: "DeepSeek R1 (OR)", capabilities: ["chat", "reasoning"], contextWindow: 128000, maxOutputTokens: 8192, pricing: { inputPerMTok: 0.55, outputPerMTok: 2.19 }, visible: true },
      { id: "qwen/qwen-2.5-coder-32b-instruct", providerId: "openrouter", displayName: "Qwen 2.5 Coder 32B", capabilities: ["chat", "tools"], contextWindow: 128000, maxOutputTokens: 8192, pricing: { inputPerMTok: 0.18, outputPerMTok: 0.18 }, visible: true },
    ],
  },
  {
    id: "deepseek",
    type: "openai_compatible",
    displayName: "DeepSeek",
    auth: "api_key",
    baseUrl: "https://api.deepseek.com/v1",
    alias: "deepseek",
    badgeColor: "#0284C7",
    badgeLetter: "D",
    enabled: true,
    models: [
      { id: "deepseek-chat", providerId: "deepseek", displayName: "DeepSeek V3", capabilities: ["chat", "tools"], contextWindow: 64000, maxOutputTokens: 8192, pricing: { inputPerMTok: 0.27, outputPerMTok: 1.1 }, visible: true },
      { id: "deepseek-reasoner", providerId: "deepseek", displayName: "DeepSeek R1", capabilities: ["chat", "reasoning"], contextWindow: 64000, maxOutputTokens: 8192, pricing: { inputPerMTok: 0.55, outputPerMTok: 2.19 }, visible: true },
    ],
  },
  {
    id: "xai",
    type: "openai_compatible",
    displayName: "xAI (Grok)",
    auth: "api_key",
    baseUrl: "https://api.x.ai/v1",
    alias: "grok",
    badgeColor: "#18181B",
    badgeLetter: "X",
    enabled: true,
    models: [
      { id: "grok-3", providerId: "xai", displayName: "Grok 3", capabilities: ["chat", "tools", "reasoning"], contextWindow: 131072, maxOutputTokens: 16384, pricing: { inputPerMTok: 3, outputPerMTok: 15 }, visible: true },
      { id: "grok-2-image", providerId: "xai", displayName: "Grok 2 Image", capabilities: ["image.generate"], contextWindow: 16000, maxOutputTokens: 0, pricing: { inputPerMTok: 0, outputPerMTok: 0, perImage: 0.07 }, visible: true },
    ],
  },
  {
    id: "fal",
    type: "fal",
    displayName: "Flux / Fal.ai (Görsel)",
    auth: "api_key",
    baseUrl: "https://fal.run",
    alias: "flux",
    badgeColor: "#18181B",
    badgeLetter: "F",
    enabled: true,
    models: FAL_MODELS,
  },
  {
    id: "stability",
    type: "stability",
    displayName: "Stability AI (Görsel)",
    auth: "api_key",
    baseUrl: "https://api.stability.ai",
    alias: "sd",
    badgeColor: "#3B82F6",
    badgeLetter: "S",
    enabled: true,
    models: STABILITY_MODELS,
  },
  {
    id: "ideogram",
    type: "ideogram",
    displayName: "Ideogram (Görsel)",
    auth: "api_key",
    baseUrl: "https://api.ideogram.ai",
    alias: "ideogram",
    badgeColor: "#0EA5E9",
    badgeLetter: "I",
    enabled: true,
    models: IDEOGRAM_MODELS,
  },
  {
    id: "ollama",
    type: "ollama",
    displayName: "Ollama (Yerel LLM)",
    auth: "none",
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    alias: "yerel",
    badgeColor: "#16A34A",
    badgeLetter: "O",
    enabled: true,
    models: [],
  },
  {
    id: "comfyui",
    type: "comfyui",
    displayName: "ComfyUI (Yerel Görsel)",
    auth: "none",
    baseUrl: "http://127.0.0.1:8188",
    alias: "comfy",
    badgeColor: "#059669",
    badgeLetter: "U",
    enabled: true,
    models: COMFYUI_MODELS,
  },
  {
    id: "video_studio",
    type: "video",
    displayName: "Video Stüdyo (Kling / Veo / Runway)",
    auth: "api_key",
    baseUrl: "https://fal.run",
    alias: "video",
    badgeColor: "#DC2626",
    badgeLetter: "V",
    enabled: true,
    models: VIDEO_MODELS,
  },
  {
    id: "audio_studio",
    type: "audio",
    displayName: "Müzik & Ses (ElevenLabs / Suno / Udio)",
    auth: "api_key",
    alias: "muzik",
    badgeColor: "#D97706",
    badgeLetter: "♪",
    enabled: true,
    models: AUDIO_MUSIC_MODELS,
  },
  {
    id: "model3d_studio",
    type: "model3d",
    displayName: "3D Model Stüdyo (Meshy / Tripo3D)",
    auth: "api_key",
    alias: "3d",
    badgeColor: "#0D9488",
    badgeLetter: "3D",
    enabled: true,
    models: MODEL3D_MODELS,
  },
];

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor() {
    this.register(new SymforyxDemoAdapter());
    this.register(new OpenAIAdapter());
    this.register(new AnthropicAdapter());
    this.register(new GoogleAdapter());
    this.register(new OllamaAdapter());
    this.register(new FalImageAdapter());
    this.register(new StabilityImageAdapter());
    this.register(new IdeogramImageAdapter());
    this.register(new ComfyUIAdapter());
    this.register(new VideoStudioAdapter());
    this.register(new AudioMusicAdapter());
    this.register(new Model3DAdapter());
  }

  register(adapter: ProviderAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string, config?: ProviderConfig): ProviderAdapter {
    const existing = this.adapters.get(providerId);
    if (existing) return existing;
    if (config && (config.type === "openai_compatible" || config.baseUrl)) {
      const dynamic = new OpenAIAdapter({
        id: config.id,
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        badgeColor: config.badgeColor,
        badgeLetter: config.badgeLetter,
        models: config.models,
        auth: config.auth,
      });
      this.adapters.set(config.id, dynamic);
      return dynamic;
    }
    throw new SymError("invalid_request", `Bilinmeyen sağlayıcı: ${providerId}`, { providerId });
  }

  /**
   * Streams chat chunks with exponential backoff retry (max 2 retries on rate_limit/unavailable).
   */
  async *streamWithRetry(
    adapter: ProviderAdapter,
    req: ChatRequest,
    signal: AbortSignal,
    maxRetries = 2
  ): AsyncIterable<ChatChunk> {
    let attempt = 0;
    while (true) {
      try {
        for await (const chunk of adapter.chat(req, signal)) {
          yield chunk;
        }
        return;
      } catch (err) {
        if (signal.aborted) throw err;
        const symErr = err instanceof SymError ? err : null;
        if (symErr?.retryable && attempt < maxRetries) {
          attempt++;
          await sleep(400 * Math.pow(2, attempt), signal);
          continue;
        }
        throw err;
      }
    }
  }
}
