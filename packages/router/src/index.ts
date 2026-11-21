import {
  normalizeTr,
  type ParsedUserInput,
  type ProviderConfig,
  type RoutingDecision,
  type RoutingRule,
  type TaskRole,
  type UserSettings,
} from "@symforyx/core";

export interface RouteContext {
  parsed: ParsedUserInput;
  attachments: Array<{ kind: "image" | "file"; mime: string; name?: string }>;
  roles: TaskRole[];
  providers: ProviderConfig[];
  settings: UserSettings;
  manualTarget?: { providerId: string; modelId: string } | null;
  mode: "manual" | "smart" | "chain" | "compare" | "council" | "agent";
  learnedPreferences?: Record<string, string>; // keyword -> roleId
}

const PROVIDER_MENTION_MAP: Record<string, { providerId: string; demoModelId: string; label: string }> = {
  claude: { providerId: "anthropic", demoModelId: "demo-claude", label: "Claude" },
  anthropic: { providerId: "anthropic", demoModelId: "demo-claude", label: "Claude" },
  gpt: { providerId: "openai", demoModelId: "demo-gpt", label: "GPT" },
  openai: { providerId: "openai", demoModelId: "demo-gpt", label: "GPT" },
  gemini: { providerId: "google", demoModelId: "demo-gemini", label: "Gemini" },
  google: { providerId: "google", demoModelId: "demo-gemini", label: "Gemini" },
  openrouter: { providerId: "openrouter", demoModelId: "demo-claude", label: "OpenRouter" },
  router: { providerId: "openrouter", demoModelId: "demo-claude", label: "OpenRouter" },
  deepseek: { providerId: "deepseek", demoModelId: "demo-claude", label: "DeepSeek" },
  grok: { providerId: "xai", demoModelId: "demo-gpt", label: "Grok" },
  xai: { providerId: "xai", demoModelId: "demo-gpt", label: "xAI" },
  flux: { providerId: "fal", demoModelId: "demo-image", label: "Flux / Fal.ai" },
  fal: { providerId: "fal", demoModelId: "demo-image", label: "Flux / Fal.ai" },
  sd: { providerId: "stability", demoModelId: "demo-image", label: "Stability AI" },
  stability: { providerId: "stability", demoModelId: "demo-image", label: "Stability AI" },
  ideogram: { providerId: "ideogram", demoModelId: "demo-image", label: "Ideogram" },
  comfy: { providerId: "comfyui", demoModelId: "demo-image", label: "ComfyUI" },
  comfyui: { providerId: "comfyui", demoModelId: "demo-image", label: "ComfyUI" },
  yerel: { providerId: "ollama", demoModelId: "demo-fast", label: "Yerel (Ollama)" },
  ollama: { providerId: "ollama", demoModelId: "demo-fast", label: "Yerel (Ollama)" },
  local: { providerId: "ollama", demoModelId: "demo-fast", label: "Yerel (Ollama)" },
  demo: { providerId: "demo", demoModelId: "demo-gpt", label: "Demo" },
};

const INTENT_LEXICON: Record<string, string[]> = {
  kodlama: [
    "kod", "kodla", "yazilim", "fonksiyon", "class", "component", "react", "svelte", "vue",
    "html", "css", "tailwind", "typescript", "javascript", "python", "sql", "api", "hata",
    "bug", "refactor", "test", "algoritma", "uygulama", "endpoint", "regex", "docker", "git",
  ],
  "gorsel-uretim": [
    "gorsel", "resim", "ciz", "tasarla", "tasarim", "logo", "ikon", "afis", "kapak",
    "illustrasyon", "mockup", "wireframe", "ekran", "arayuz", "banner", "poster",
  ],
  arastirma: [
    "arastir", "ara", "guncel", "haber", "kaynak", "karsilastirma", "rapor", "piyasa",
    "fiyat", "trend", "nedir", "kimdir", "tarihce", "istatistik", "dokumantasyon",
  ],
  "veri-analizi": [
    "csv", "excel", "tablo", "grafik", "analiz", "ciro", "satis", "ortalama", "medyan",
    "korelasyon", "veri", "dataset", "sql", "metrik",
  ],
  yazi: [
    "makale", "blog", "yazi", "metin", "slogan", "eposta", "mail", "sosyal medya",
    "tweet", "linkedin", "tanitim", "aciklama", "cevir", "tercume", "duzenle", "resmi",
  ],
  ozetleme: ["ozet", "ozetle", "kisalt", "tldr", "ana fikir", "maddeler halinde"],
};

export function resolveProviderModel(
  providerId: string,
  preferredModelId: string | undefined,
  providers: ProviderConfig[]
): { providerId: string; modelId: string; fallbackToDemo: boolean } {
  const provider = providers.find((p) => p.id === providerId && p.enabled);

  // Use real provider if it has credentials (or auth === 'none' and has models)
  if (provider) {
    const usable =
      provider.id === "demo" ||
      (provider.auth === "api_key" && provider.hasKey) ||
      (provider.auth === "none" && provider.models.length > 0);

    if (usable && provider.models.length > 0) {
      const exact = preferredModelId
        ? provider.models.find((m) => m.id === preferredModelId)
        : undefined;
      return {
        providerId: provider.id,
        modelId: exact?.id ?? provider.models[0].id,
        fallbackToDemo: false,
      };
    }
  }

  // Fallback gracefully to matching Demo model so UX never dead-ends on first launch
  const mapEntry = Object.values(PROVIDER_MENTION_MAP).find((v) => v.providerId === providerId);
  return {
    providerId: "demo",
    modelId: preferredModelId?.startsWith("demo-")
      ? preferredModelId
      : mapEntry?.demoModelId ?? "demo-gpt",
    fallbackToDemo: providerId !== "demo",
  };
}

export function routeMessage(ctx: RouteContext): RoutingDecision {
  const { parsed, attachments, roles, providers, settings, manualTarget, mode } = ctx;

  // ==================== LAYER 1: Explicit Intent (<1 ms) ====================

  // 1a. @herkes or /karsilastir with multiple mentions
  if (
    parsed.mentions.includes("herkes") ||
    parsed.mentions.includes("all") ||
    (parsed.slashCommand?.command === "karsilastir" && parsed.mentions.length >= 2)
  ) {
    const targets: Array<{ providerId: string; modelId: string; roleId?: string }> = [];
    if (parsed.mentions.includes("herkes") || parsed.mentions.includes("all")) {
      for (const alias of ["claude", "gpt", "gemini"]) {
        const entry = PROVIDER_MENTION_MAP[alias];
        const resolved = resolveProviderModel(entry.providerId, undefined, providers);
        targets.push({ providerId: resolved.providerId, modelId: resolved.modelId });
      }
    } else {
      for (const m of parsed.mentions) {
        const target = resolveMentionTarget(m, roles, providers);
        if (target) targets.push(target);
      }
    }
    const primary = targets[0] ?? { providerId: "demo", modelId: "demo-claude" };
    return {
      layer: 1,
      roleId: "karsilastir",
      roleName: "Karşılaştır",
      providerId: primary.providerId,
      modelId: primary.modelId,
      reason: "Açık çoklu model etiketi",
      confidence: 1.0,
      suggestedTools: [],
      isCompareAll: true,
      explicitTargets: targets,
    };
  }

  // 1b. Explicit slash command mapping
  if (parsed.slashCommand) {
    const cmd = parsed.slashCommand.command;
    if (cmd === "gorsel" || cmd === "duzenle") {
      return buildRoleDecision(
        cmd === "duzenle" ? "gorsel-duzenleme" : "gorsel-uretim",
        roles,
        providers,
        1,
        1.0,
        `Açık komut: /${parsed.slashCommand.rawCommand}`
      );
    }
    if (cmd === "kod" || cmd === "debug" || cmd === "review" || cmd === "test" || cmd === "refactor" || cmd === "sql") {
      return buildRoleDecision("kodlama", roles, providers, 1, 1.0, `Command: /${cmd}`, ["live-preview", "code-sandbox"]);
    }
    if (cmd === "data") {
      return buildRoleDecision("veri-analizi", roles, providers, 1, 1.0, "Command: /data", ["code-sandbox", "file-reader"]);
    }
    if (cmd === "video") {
      return buildRoleDecision("video-uretim", roles, providers, 1, 1.0, "Command: /video");
    }
    if (cmd === "music" || cmd === "ses") {
      return buildRoleDecision("muzik-ses", roles, providers, 1, 1.0, `Command: /${cmd}`);
    }
    if (cmd === "3d") {
      return buildRoleDecision("3d-model", roles, providers, 1, 1.0, "Command: /3d");
    }
    if (cmd === "aso" || cmd === "store" || cmd === "ads" || cmd === "launch") {
      return buildRoleDecision("aso-pazarlama", roles, providers, 1, 1.0, `Command: /${cmd}`);
    }
    if (cmd === "brand") {
      return buildRoleDecision("gorsel-uretim", roles, providers, 1, 1.0, "Command: /brand");
    }
    if (cmd === "ara" || cmd === "oku") {
      return buildRoleDecision("arastirma", roles, providers, 1, 1.0, `Command: /${cmd}`, [
        cmd === "ara" ? "web-search" : "url-reader",
      ]);
    }
    if (cmd === "ozetle") {
      return buildRoleDecision("ozetleme", roles, providers, 1, 1.0, "Command: /summarize");
    }
  }

  // 1c. Explicit @mention
  if (parsed.mentions.length > 0) {
    const first = parsed.mentions[0];
    const target = resolveMentionTarget(first, roles, providers);
    if (target) {
      const role = roles.find((r) => r.id === target.roleId);
      return {
        layer: 1,
        roleId: role?.id ?? "explicit",
        roleName: role?.name ?? `@${first}`,
        providerId: target.providerId,
        modelId: target.modelId,
        reason: `Açık etiket: @${first}`,
        confidence: 1.0,
        suggestedTools: role?.defaultTools ?? [],
      };
    }
  }

  // 1d. Manual mode or pinned model
  if (mode === "manual" && manualTarget) {
    const resolved = resolveProviderModel(manualTarget.providerId, manualTarget.modelId, providers);
    return {
      layer: 1,
      roleId: "manual",
      roleName: "Manuel Seçim",
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      reason: "Kullanıcı tarafından seçilen model",
      confidence: 1.0,
      suggestedTools: [],
    };
  }

  // ==================== LAYER 2: Declarative Rules (<5 ms) ====================

  const normText = normalizeTr(parsed.cleanText);

  // Economy Mode for very short / simple greetings
  if (
    settings.economyMode &&
    attachments.length === 0 &&
    parsed.cleanText.length < 48 &&
    /^(merhaba|selam|hey|hi|hello|nasilsin|tesekkurler|sagol|ok|tamam)\b/.test(normText)
  ) {
    return buildRoleDecision(
      "ozetleme",
      roles,
      providers,
      2,
      0.95,
      "Ekonomi Modu: Kısa/basit soru ekonomik modele yönlendirildi"
    );
  }

  for (const rule of settings.routingRules) {
    if (matchesRule(rule, parsed.cleanText, attachments)) {
      const roleId = rule.use.startsWith("role:") ? rule.use.slice(5) : "genel";
      return buildRoleDecision(
        roleId,
        roles,
        providers,
        2,
        0.92,
        rule.description || `Kural eşleşmesi (${rule.id})`,
        rule.tools ?? []
      );
    }
  }

  // ==================== LAYER 3: Lightweight Local Classifier (<30 ms) ====================

  const scores = new Map<string, number>();
  const words = normText.split(/[^a-z0-9]+/).filter(Boolean);

  for (const [roleId, keywords] of Object.entries(INTENT_LEXICON)) {
    let score = 0;
    for (const kw of keywords) {
      if (kw.includes(" ")) {
        if (normText.includes(kw)) score += 2.2;
      } else if (words.includes(kw)) {
        score += 1.5;
      } else if (normText.includes(kw) && kw.length >= 5) {
        score += 0.8;
      }
    }
    if (score > 0) scores.set(roleId, score);
  }

  // Boost from learned local preferences
  if (ctx.learnedPreferences) {
    for (const [kw, roleId] of Object.entries(ctx.learnedPreferences)) {
      if (normText.includes(normalizeTr(kw))) {
        scores.set(roleId, (scores.get(roleId) ?? 0) + 1.8);
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0) {
    const [topRoleId, topScore] = ranked[0];
    const secondScore = ranked[1]?.[1] ?? 0;
    const confidence = Math.min(0.95, Number((topScore / (topScore + secondScore + 1.2)).toFixed(2)));
    const decision = buildRoleDecision(
      topRoleId,
      roles,
      providers,
      3,
      confidence,
      `Yerel niyet sınıflandırıcı (%${Math.round(confidence * 100)} güven)`
    );

    // If below confidence threshold, offer top 2 choices to user
    if (confidence < settings.routingConfidenceThreshold) {
      const altRoleId = ranked[1]?.[0] ?? "genel";
      const alt = buildRoleDecision(altRoleId, roles, providers, 3, 1 - confidence, "Alternatif");
      decision.uncertainAlternatives = [
        {
          roleId: decision.roleId,
          roleName: decision.roleName,
          providerId: decision.providerId,
          modelId: decision.modelId,
        },
        {
          roleId: alt.roleId,
          roleName: alt.roleName,
          providerId: alt.providerId,
          modelId: alt.modelId,
        },
      ];
    }
    return decision;
  }

  // Default fallback role: genel
  return buildRoleDecision("genel", roles, providers, 3, 0.85, "Varsayılan genel sohbet rolü");
}

function resolveMentionTarget(
  normMention: string,
  roles: TaskRole[],
  providers: ProviderConfig[]
): { providerId: string; modelId: string; roleId?: string } | null {
  // Check custom provider aliases first
  const byAlias = providers.find(
    (p) => p.enabled && (normalizeTr(p.id) === normMention || (p.alias && normalizeTr(p.alias) === normMention))
  );
  if (byAlias) {
    const res = resolveProviderModel(byAlias.id, undefined, providers);
    return { providerId: res.providerId, modelId: res.modelId };
  }

  // Check built-in provider mentions (@claude, @gpt, @gemini, @yerel)
  const known = PROVIDER_MENTION_MAP[normMention];
  if (known) {
    const res = resolveProviderModel(known.providerId, undefined, providers);
    return { providerId: res.providerId, modelId: res.modelId };
  }

  // Check role mentions (@gorsel, @kod, @yazi, @arastirma, custom roles)
  const role = roles.find(
    (r) => normalizeTr(r.mention) === normMention || normalizeTr(r.id) === normMention
  );
  if (role) {
    const res = resolveProviderModel(role.primaryProviderId, role.primaryModelId, providers);
    return { providerId: res.providerId, modelId: res.modelId, roleId: role.id };
  }

  return null;
}

function buildRoleDecision(
  roleId: string,
  roles: TaskRole[],
  providers: ProviderConfig[],
  layer: 1 | 2 | 3,
  confidence: number,
  reason: string,
  extraTools: string[] = []
): RoutingDecision {
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const resolved = resolveProviderModel(
    role?.primaryProviderId ?? "demo",
    role?.primaryModelId,
    providers
  );
  const tools = Array.from(new Set([...(role?.defaultTools ?? []), ...extraTools]));
  return {
    layer,
    roleId: role?.id ?? roleId,
    roleName: role?.name ?? roleId,
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    reason,
    confidence,
    suggestedTools: tools,
  };
}

function matchesRule(
  rule: RoutingRule,
  text: string,
  attachments: RouteContext["attachments"]
): boolean {
  if (rule.when.attachment) {
    const wanted = Array.isArray(rule.when.attachment)
      ? rule.when.attachment
      : [rule.when.attachment];
    const hasMatch = attachments.some((att) =>
      wanted.some((w) => {
        if (w === "image") return att.kind === "image" || att.mime.startsWith("image/");
        return (
          att.name?.toLowerCase().endsWith(`.${w.toLowerCase()}`) ||
          att.mime.toLowerCase().includes(w.toLowerCase())
        );
      })
    );
    if (!hasMatch) return false;
  }

  if (rule.when.text_matches) {
    try {
      const re = new RegExp(rule.when.text_matches, "i");
      if (!re.test(text) && !re.test(normalizeTr(text))) return false;
    } catch {
      return false;
    }
  }
  return Boolean(rule.when.attachment || rule.when.text_matches);
}
