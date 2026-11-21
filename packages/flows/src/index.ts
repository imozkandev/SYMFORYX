import {
  createId,
  type FlowDefinition,
  type FlowRun,
  type FlowStep,
  type FlowStepRunState,
} from "@symforyx/core";

export interface FlowStepExecutor {
  runModelStep: (opts: {
    stepId: string;
    use: string;
    prompt: string;
    attachArtifactIds: string[];
    modelOverride?: { providerId: string; modelId: string };
    projectId: string;
    threadId?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; artifactIds: string[]; costUsd: number }>;

  runToolStep: (opts: {
    toolId: string;
    input: unknown;
    projectId: string;
    threadId?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; json?: unknown; artifactIds: string[]; costUsd: number }>;

  onUpdate?: (run: FlowRun) => void;
  onEvent?: (eventName: string, payload: Record<string, unknown>) => void;
}

export function interpolateTemplate(
  template: string,
  vars: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    let cur: unknown = vars;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    if (cur === undefined || cur === null) return "";
    return typeof cur === "string" ? cur : JSON.stringify(cur);
  });
}

export class FlowEngine {
  /**
   * Starts or resumes a FlowRun until completion, failure, or an approval pause gate.
   */
  async execute(
    flow: FlowDefinition,
    opts: {
      existingRun?: FlowRun;
      inputs?: Record<string, unknown>;
      stepModelOverrides?: Record<string, { providerId: string; modelId: string }>;
      projectId: string;
      threadId?: string;
      approvalDecision?: { approved: boolean; feedback?: string };
      executor: FlowStepExecutor;
      signal?: AbortSignal;
    }
  ): Promise<FlowRun> {
    const now = new Date().toISOString();
    const run: FlowRun = opts.existingRun
      ? structuredClone(opts.existingRun)
      : {
          id: createId("run"),
          flowId: flow.id,
          flowName: flow.name,
          threadId: opts.threadId,
          projectId: opts.projectId,
          status: "running",
          inputs: { ...(opts.inputs ?? {}) },
          stepStates: flow.steps.map((s) => ({ stepId: s.id, status: "pending" })),
          currentStepIndex: 0,
          totalCostUsd: 0,
          outputs: {},
          createdAt: now,
          updatedAt: now,
        };

    // Apply defaults for missing inputs
    for (const [key, field] of Object.entries(flow.inputs ?? {})) {
      if (run.inputs[key] === undefined && field.default !== undefined) {
        run.inputs[key] = field.default;
      }
    }

    // Build context variables map from inputs + completed steps
    const vars: Record<string, unknown> = { ...run.inputs };
    for (const st of run.stepStates) {
      if (st.output !== undefined) {
        vars[st.stepId] = st.output;
      }
    }

    // Handle resuming from awaiting_approval
    if (run.status === "awaiting_approval" && opts.approvalDecision) {
      const curStep = flow.steps[run.currentStepIndex];
      const st = run.stepStates[run.currentStepIndex];
      if (opts.approvalDecision.approved) {
        st.status = "completed";
        st.finishedAt = new Date().toISOString();
        st.output = { approved: true, feedback: opts.approvalDecision.feedback ?? "" };
        vars[curStep.id] = st.output;
        run.currentStepIndex += 1;
        run.status = "running";
      } else if (curStep.on_reject?.goto) {
        const targetIdx = flow.steps.findIndex((s) => s.id === curStep.on_reject!.goto);
        if (targetIdx >= 0) {
          vars.feedback = opts.approvalDecision.feedback ?? "Kullanıcı değişiklik istedi";
          st.status = "pending";
          for (let i = targetIdx; i < run.stepStates.length; i++) {
            run.stepStates[i].status = "pending";
          }
          run.currentStepIndex = targetIdx;
          run.status = "running";
        } else {
          run.status = "cancelled";
        }
      } else {
        st.status = "failed";
        st.error = "Kullanıcı tarafından reddedildi";
        run.status = "cancelled";
      }
      run.updatedAt = new Date().toISOString();
      opts.executor.onUpdate?.(run);
      if (run.status !== "running") return run;
    }

    const maxBudget = flow.budget?.max_cost_usd;

    while (run.currentStepIndex < flow.steps.length) {
      if (opts.signal?.aborted) {
        run.status = "cancelled";
        break;
      }
      if (maxBudget !== undefined && run.totalCostUsd >= maxBudget) {
        run.status = "failed";
        const st = run.stepStates[run.currentStepIndex];
        if (st) {
          st.status = "failed";
          st.error = `Akış bütçe limiti ($${maxBudget.toFixed(2)}) aşıldı.`;
        }
        opts.executor.onEvent?.("budget.exceeded", { flowRunId: run.id, maxBudget });
        break;
      }

      const step = flow.steps[run.currentStepIndex];
      const state = run.stepStates[run.currentStepIndex];
      state.startedAt = new Date().toISOString();

      // Approval gate pauses execution until human responds
      if (step.type === "approval") {
        state.status = "awaiting_approval";
        state.approvalMessage = interpolateTemplate(step.message ?? "Devam edilsin mi?", vars);
        run.status = "awaiting_approval";
        run.updatedAt = new Date().toISOString();
        opts.executor.onUpdate?.(run);
        opts.executor.onEvent?.("flow.awaiting_approval", {
          flowRunId: run.id,
          stepId: step.id,
          message: state.approvalMessage,
        });
        return run;
      }

      state.status = "running";
      run.updatedAt = new Date().toISOString();
      opts.executor.onUpdate?.(run);

      try {
        await this.executeStep(step, state, vars, run, opts.executor, opts.stepModelOverrides, opts.signal);
        state.status = "completed";
        state.finishedAt = new Date().toISOString();
        vars[step.id] = state.output;
        run.outputs[step.id] = state.output;
        run.currentStepIndex += 1;
      } catch (err) {
        state.status = "failed";
        state.error = err instanceof Error ? err.message : String(err);
        state.finishedAt = new Date().toISOString();
        run.status = "failed";
        run.updatedAt = new Date().toISOString();
        opts.executor.onUpdate?.(run);
        opts.executor.onEvent?.("flow.failed", { flowRunId: run.id, error: state.error });
        return run;
      }

      run.updatedAt = new Date().toISOString();
      opts.executor.onUpdate?.(run);
    }

    if (run.status === "running") {
      run.status = "completed";
      run.updatedAt = new Date().toISOString();
      opts.executor.onUpdate?.(run);
      opts.executor.onEvent?.("flow.completed", {
        flowRunId: run.id,
        flowId: run.flowId,
        totalCostUsd: run.totalCostUsd,
      });
    }

    return run;
  }

  private async executeStep(
    step: FlowStep,
    state: FlowStepRunState,
    vars: Record<string, unknown>,
    run: FlowRun,
    executor: FlowStepExecutor,
    stepModelOverrides?: Record<string, { providerId: string; modelId: string }>,
    signal?: AbortSignal
  ) {
    // Parallel step executes child steps concurrently
    if (step.type === "parallel" && step.steps?.length) {
      const results = await Promise.all(
        step.steps.map(async (child) => {
          const childState: FlowStepRunState = { stepId: child.id, status: "running" };
          await this.executeStep(child, childState, vars, run, executor, stepModelOverrides, signal);
          return { id: child.id, output: childState.output, artifactIds: childState.artifactIds ?? [] };
        })
      );
      state.output = Object.fromEntries(results.map((r) => [r.id, r.output]));
      state.artifactIds = results.flatMap((r) => r.artifactIds);
      return;
    }

    // Tool step
    if (step.type === "tool" || step.use?.startsWith("tool:")) {
      const toolId = (step.use ?? "").replace(/^tool:/, "");
      const resolvedInput =
        typeof step.input === "string"
          ? interpolateTemplate(step.input, vars)
          : step.input ?? { text: interpolateTemplate(step.prompt ?? "", vars) };
      const res = await executor.runToolStep({
        toolId,
        input: resolvedInput,
        projectId: run.projectId,
        threadId: run.threadId,
        signal,
      });
      state.output = { text: res.text, json: res.json, artifactIds: res.artifactIds };
      state.artifactIds = res.artifactIds;
      state.costUsd = res.costUsd;
      run.totalCostUsd = Number((run.totalCostUsd + res.costUsd).toFixed(6));
      return;
    }

    // Model / Role step (default)
    const promptBase = interpolateTemplate(step.prompt ?? "", vars);
    const feedback = vars.feedback ? `\n\nKullanıcı geri bildirimi: ${String(vars.feedback)}` : "";
    const attachIds: string[] = [];
    for (const ref of step.attach ?? []) {
      const stepKey = ref.split(".")[0];
      const prev = vars[stepKey] as { artifactIds?: string[] } | undefined;
      if (prev?.artifactIds) attachIds.push(...prev.artifactIds);
    }

    const res = await executor.runModelStep({
      stepId: step.id,
      use: step.use ?? "role:genel",
      prompt: promptBase + feedback,
      attachArtifactIds: attachIds,
      modelOverride: stepModelOverrides?.[step.id],
      projectId: run.projectId,
      threadId: run.threadId,
      signal,
    });
    state.output = { text: res.text, artifactIds: res.artifactIds };
    state.artifactIds = res.artifactIds;
    state.costUsd = res.costUsd;
    run.totalCostUsd = Number((run.totalCostUsd + res.costUsd).toFixed(6));
  }
}

export const READY_FLOW_TEMPLATES: FlowDefinition[] = [
  {
    id: "magaza-gorselleri",
    name: "Mağaza Görselleri (App Store & Play Store 5'li Set)",
    nameEn: "App Store & Play Store Screenshots (5-Screen Kit)",
    description: "5 ekranlık mağaza görseli konsepti, başlık hiyerarşisi, vitrin görseli ve canlı önizlenebilir App Store / Play Store ekran seti üretir.",
    descriptionEn: "Generates 5-screen store screenshot layout, conversion copy, hero visual, and live previewable App Store / Play Store cards.",
    category: "App & ASO",
    tags: ["app-store", "play-store", "screenshots", "ui"],
    estimatedCostUsd: 0.08,
    isTemplate: true,
    inputs: {
      uygulama: {
        type: "text",
        label: "Uygulama adı ve temel faydası",
        placeholder: "Ör. FocusPulse — Pomodoro ve derin çalışma takip uygulaması",
        required: true,
      },
      platform: {
        type: "select",
        label: "Hedef Mağaza",
        options: ["iOS App Store + Google Play", "iOS App Store (6.9\")", "Google Play Store"],
        default: "iOS App Store + Google Play",
      },
      stil: {
        type: "text",
        label: "Görsel tarz / referans notu",
        placeholder: "Ör. Editoryal minimalist, koyu grafit + sıcak turuncu vurgu",
        default: "Editoryal minimalist, yüksek kontrast",
      },
    },
    steps: [
      {
        id: "konsept",
        name: "5 Ekran Storyboard & Dönüşüm Metinleri",
        type: "model",
        use: "role:aso-pazarlama",
        prompt: "{{uygulama}} için {{platform}} mağaza görselleri planla. 5 ekran (1: Hero Değer Önerisi, 2: Ana Özellik, 3: İş Akışı, 4: İstatistik/Sosyal Kanıt, 5: CTA) için kısa güçlü başlıklar ve alt metinler yaz. Stil: {{stil}}.",
      },
      {
        id: "vitrin_gorsel",
        name: "Ana Vitrin Görseli",
        type: "model",
        use: "role:gorsel-uretim",
        prompt: "{{uygulama}} için {{stil}} tarzında App Store vitrin görseli tasarla.",
      },
      {
        id: "ekran_seti",
        name: "5'li Mağaza Ekran Şablonu (HTML Önizleme)",
        type: "model",
        use: "role:kodlama",
        attach: ["vitrin_gorsel.image"],
        prompt: "mağaza görseli seti oluştur: {{uygulama}} için 5 adet App Store / Play Store ekran görüntüsü kartını yan yana yüksek kaliteli tek dosyalık HTML/CSS şablonu olarak kodla. Metinler: {{konsept.text}}",
      },
    ],
    outputs: ["konsept", "vitrin_gorsel", "ekran_seti"],
    budget: { max_cost_usd: 1.0 },
  },
  {
    id: "aso-paketi",
    name: "ASO Tam Optimizasyon Paketi (TR + EN)",
    nameEn: "Full ASO Optimization Kit (TR + EN)",
    description: "App Store (30/30/100 kar.) ve Google Play metadata, anahtar kelime matrisi, rakip analizi ve A/B test planı üretir.",
    descriptionEn: "Generates App Store (30/30/100 char) & Google Play metadata, keyword matrix, competitor gaps, and A/B test plan.",
    category: "App & ASO",
    tags: ["aso", "keywords", "app-store", "growth"],
    estimatedCostUsd: 0.04,
    isTemplate: true,
    inputs: {
      uygulama: {
        type: "text",
        label: "Uygulama açıklaması ve rakipler",
        placeholder: "Ör. Yapay zekâ destekli kişisel finans ve bütçe uygulaması",
        required: true,
      },
      pazar: {
        type: "select",
        label: "Hedef Pazar",
        options: ["Türkiye + Global (TR & EN)", "Sadece Global (EN)", "Avrupa + ABD"],
        default: "Türkiye + Global (TR & EN)",
      },
    },
    steps: [
      {
        id: "anahtar_kelimeler",
        name: "Anahtar Kelime & Niyet Analizi",
        type: "model",
        use: "role:aso-pazarlama",
        prompt: "ASO analizi yap: {{uygulama}} ({{pazar}}). Yüksek niyetli, orta rekabetli 30 anahtar kelimeyi hacim/zorluk/öncelik tablosu halinde çıkar.",
      },
      {
        id: "metadata",
        name: "App Store & Play Store Metadata + A/B Test",
        type: "model",
        use: "role:aso-pazarlama",
        prompt: "ASO paketi hazırla: {{uygulama}} için {{anahtar_kelimeler.text}} temelinde iOS App Title (maks 30 kar.), Subtitle (maks 30 kar.), Keyword Field (maks 100 kar.), Google Play Short (80 kar.) & Full Description (4000 kar.), What's New ve 3 A/B test hipotezini TR ve EN olarak yaz.",
      },
    ],
    outputs: ["anahtar_kelimeler", "metadata"],
    budget: { max_cost_usd: 0.6 },
  },
  {
    id: "video-promo",
    name: "Video & Promo Tanıtım Prodüksiyonu",
    nameEn: "Video & Promo Production Pipeline",
    description: "Zaman kodlu senaryo, Runway/Kling/Veo sahne promptları, ana kare (keyframe) görseli ve seslendirme + müzik brief'i üretir.",
    descriptionEn: "Produces timecoded script, Runway/Kling/Veo scene prompts, hero keyframe visual, voiceover script, and music brief.",
    category: "Video & Medya",
    tags: ["video", "promo", "kling", "veo", "runway"],
    estimatedCostUsd: 0.12,
    isTemplate: true,
    inputs: {
      urun: {
        type: "text",
        label: "Tanıtılacak ürün / uygulama",
        placeholder: "Ör. SYMFORYX — Tek çalışma alanında tüm AI modelleri",
        required: true,
      },
      sure: {
        type: "select",
        label: "Video Süresi",
        options: ["15 saniye (Reels / Shorts)", "30 saniye (App Preview / Reklam)", "60 saniye (Ürün Lansman)"],
        default: "30 saniye (App Preview / Reklam)",
      },
      ton: {
        type: "text",
        label: "Atmosfer / Kamera tonu",
        placeholder: "Ör. Apple keynote estetiği, keskin geçişler, yüksek tempo",
        default: "Temiz sinematik ürün lansmanı",
      },
    },
    steps: [
      {
        id: "storyboard",
        name: "Zaman Kodlu Video Senaryosu & AI Sahne Promptları",
        type: "model",
        use: "role:video-uretim",
        prompt: "Video promo prodüksiyonu: {{urun}} için {{sure}} süresinde, {{ton}} tarzında saniye saniye storyboard, kamera hareketleri, Runway/Kling/Veo video promptları ve seslendirme (VO) metnini hazırla.",
      },
      {
        id: "paralel_medya",
        name: "Ana Kare Görseli + Müzik/SFX Yönergesi",
        type: "parallel",
        steps: [
          {
            id: "keyframe",
            name: "Hero Keyframe Görseli",
            type: "model",
            use: "role:gorsel-uretim",
            prompt: "{{urun}} tanıtım videosu açılış karesi, {{ton}} estetiğinde sinematik keyframe.",
          },
          {
            id: "ses_brief",
            name: "Seslendirme & Müzik Promptu",
            type: "model",
            use: "role:muzik-ses",
            prompt: "{{urun}} promo videosu ({{sure}}) için Suno/Udio müzik promptu (BPM, enstrüman, yapı) ve ElevenLabs seslendirme zamanlaması oluştur.",
          },
        ],
      },
    ],
    outputs: ["storyboard", "paralel_medya"],
    budget: { max_cost_usd: 1.5 },
  },
  {
    id: "kod-gorsel-3d-muzik",
    name: "Kod + Görsel + 3D Model + Müzik (Tam Prodüksiyon)",
    nameEn: "Code + Visual + 3D Model + Music (Full Studio)",
    description: "Tek bir fikirden paralel olarak konsept görsel, etkileşimli 3D model sahnesi, çalınabilir müzik/ses ve çalışır kod prototipi üretir.",
    descriptionEn: "From one idea, generates concept art, interactive 3D model scene, playable synth/music, and working code prototype in parallel.",
    category: "Tam Stüdyo",
    tags: ["code", "image", "3d", "music", "game"],
    estimatedCostUsd: 0.15,
    isTemplate: true,
    inputs: {
      fikir: {
        type: "text",
        label: "Proje / Oyun / Ürün fikri",
        placeholder: "Ör. Uzay istasyonunda geçen minimalist bulmaca oyunu",
        required: true,
      },
      tarz: {
        type: "text",
        label: "Sanat & Ses tarzı",
        placeholder: "Ör. Low-poly İsviçre tasarım, ambient synthwave",
        default: "Modern minimalist, ambient elektronik",
      },
    },
    steps: [
      {
        id: "coklu_uretim",
        name: "Paralel: Görsel + 3D Model + Müzik",
        type: "parallel",
        steps: [
          {
            id: "konsept_gorsel",
            name: "Konsept Görsel",
            type: "model",
            use: "role:gorsel-uretim",
            prompt: "{{fikir}} için {{tarz}} tarzında ana konsept görseli tasarla.",
          },
          {
            id: "model_3d",
            name: "3D Model Sahnesi & Blender/GLTF Betiği",
            type: "model",
            use: "role:3d-model",
            prompt: "3D model sahnesi oluştur: {{fikir}} ({{tarz}}) için etkileşimli HTML5 3D önizleme kodu, Meshy/Tripo promptu ve Blender Python materyal betiği üret.",
          },
          {
            id: "muzik_ses",
            name: "Müzik & SFX Stüdyosu (Çalınabilir Önizleme)",
            type: "model",
            use: "role:muzik-ses",
            prompt: "Müzik ve ses üretimi: {{fikir}} ({{tarz}}) için Suno/Udio müzik promptu, SFX listesi ve tarayıcıda anında çalınabilir Web Audio API synth önizlemesi oluştur.",
          },
        ],
      },
      {
        id: "calisir_kod",
        name: "Birleşik Çalışır Kod Prototipi",
        type: "model",
        use: "role:kodlama",
        prompt: "{{fikir}} için konsept, 3D sahne ve ses tasarımını birleştiren çalışır, temiz bir HTML/JS prototipi kodla.",
      },
    ],
    outputs: ["coklu_uretim", "calisir_kod"],
    budget: { max_cost_usd: 1.5 },
  },
  {
    id: "tasarimdan-koda",
    name: "Tasarımdan Koda (Onaylı)",
    nameEn: "Design to Code (With Approval)",
    description: "Bir fikirden arayüz tasarımı üretir, onayından sonra kodlar ve canlı önizler.",
    descriptionEn: "Creates UI mockup, pauses for human approval, then codes a live previewable app.",
    category: "Tasarım & Kod",
    tags: ["ui", "code", "preview"],
    estimatedCostUsd: 0.06,
    isTemplate: true,
    inputs: {
      brief: {
        type: "text",
        label: "Ne tasarlayalım?",
        placeholder: "Ör. kahve dükkânı için sade, açık renkli ana sayfa",
        required: true,
      },
      framework: {
        type: "select",
        label: "Çatı",
        options: ["HTML + Tailwind", "React + Tailwind", "Svelte", "Vue"],
        default: "HTML + Tailwind",
      },
    },
    steps: [
      {
        id: "tasarim",
        name: "Arayüz Tasarımı",
        type: "model",
        use: "role:gorsel-uretim",
        prompt: "{{brief}} için modern, temiz ve erişilebilir bir arayüz tasarımı oluştur.",
      },
      {
        id: "onay",
        name: "Tasarım Onayı",
        type: "approval",
        message: "Tasarım uygun mu? Değilse ne değişsin?",
        on_reject: { goto: "tasarim", feedback: true },
      },
      {
        id: "kod",
        name: "Kodlama",
        type: "model",
        use: "role:kodlama",
        attach: ["tasarim.image"],
        prompt: "Bu tasarımı {{framework}} ile birebir kodla. Temiz, mobil uyumlu ve önizlenebilir olsun.",
      },
    ],
    outputs: ["tasarim", "kod"],
    budget: { max_cost_usd: 1.0 },
  },
  {
    id: "saas-lansman-kiti",
    name: "SaaS & Ürün Lansman Kiti (Product Hunt + Landing)",
    nameEn: "SaaS Launch Kit (Product Hunt + Landing)",
    description: "Canlı önizlenebilir landing page, Product Hunt lansman metinleri ve 7 günlük X/LinkedIn takvimi üretir.",
    descriptionEn: "Generates live landing page, Product Hunt launch copy, and 7-day social rollout plan.",
    category: "App & ASO",
    tags: ["launch", "saas", "landing", "marketing"],
    estimatedCostUsd: 0.08,
    isTemplate: true,
    inputs: {
      urun: {
        type: "text",
        label: "Ürün ve hedef kitle",
        placeholder: "Ör. Bağımsız geliştiriciler için tek tıkla fiyat analitiği",
        required: true,
      },
    },
    steps: [
      {
        id: "landing",
        name: "Açılış Sayfası (HTML Önizleme)",
        type: "model",
        use: "role:kodlama",
        prompt: "{{urun}} için yüksek dönüşümlü, minimalist ve canlı önizlenebilir HTML açılış sayfası kodla.",
      },
      {
        id: "lansman_metin",
        name: "Product Hunt + 7 Günlük Lansman Planı",
        type: "model",
        use: "role:yazi",
        prompt: "{{urun}} için Product Hunt tagline (60 kar.), ilk yapımcı yorumu ve 7 günlük X/LinkedIn lansman paylaşımları yaz.",
      },
    ],
    outputs: ["landing", "lansman_metin"],
    budget: { max_cost_usd: 0.8 },
  },
  {
    id: "marka-kimlik-studyo",
    name: "Marka Kimliği, Logo & Design Tokens",
    nameEn: "Brand Identity, Logo & Design Tokens",
    description: "Logo konsepti, WCAG AA renk paleti, tipografi sistemi ve kullanıma hazır CSS tasarım tokenları üretir.",
    descriptionEn: "Produces logo concept, WCAG AA palette, typography scale, and production CSS design tokens.",
    category: "Tasarım & Kod",
    tags: ["brand", "logo", "palette", "tokens"],
    estimatedCostUsd: 0.05,
    isTemplate: true,
    inputs: {
      marka: {
        type: "text",
        label: "Marka adı ve karakteri",
        placeholder: "Ör. SYMFORYX — kesinlikçi İsviçre AI çalışma alanı",
        required: true,
      },
    },
    steps: [
      {
        id: "logo",
        name: "Logo & Marka Konsepti",
        type: "model",
        use: "role:gorsel-uretim",
        prompt: "{{marka}} için minimalist, zamansız logo konsepti tasarla.",
      },
      {
        id: "palet",
        name: "WCAG AA Renk Paleti",
        type: "tool",
        use: "tool:dev.ozkandev.renk-paleti",
        input: { source: "{{marka}}", count: 5 },
      },
      {
        id: "tokens",
        name: "CSS Design Tokens & Marka Rehberi",
        type: "model",
        use: "role:kodlama",
        prompt: "{{marka}} için {{palet.text}} renklerine dayalı :root CSS design tokens ve tipografi ölçeğini yaz.",
      },
    ],
    outputs: ["logo", "palet", "tokens"],
    budget: { max_cost_usd: 0.6 },
  },
  {
    id: "reklam-kreatif-matrisi",
    name: "Performans Reklamı & A/B Kreatif Matrisi",
    nameEn: "Performance Ad & A/B Creative Matrix",
    description: "3 farklı psikolojik açı (Acı Noktası, Sosyal Kanıt, Merak) için Meta/TikTok/Google reklam metni ve görsel brief üretir.",
    descriptionEn: "Creates 3 psychological angle variations (Pain, Social Proof, Curiosity) for Meta/TikTok/Google ads.",
    category: "App & ASO",
    tags: ["ads", "ab-test", "growth"],
    estimatedCostUsd: 0.06,
    isTemplate: true,
    inputs: {
      teklif: {
        type: "text",
        label: "Ürün / teklif ve hedef kitle",
        placeholder: "Ör. Haftada 5 saat kazandıran AI muhasebe asistanı",
        required: true,
      },
    },
    steps: [
      {
        id: "kreatifler",
        name: "3 Açı x 3 Hook Reklam Matrisi",
        type: "model",
        use: "role:aso-pazarlama",
        prompt: "{{teklif}} için Acı Noktası, Sosyal Kanıt ve Merak açılarından 9 reklam hook'u, Meta/TikTok gövde metinleri ve CTA varyasyonları üret.",
      },
      {
        id: "gorsel_varyasyon",
        name: "Reklam Kreatif Görseli",
        type: "model",
        use: "role:gorsel-uretim",
        prompt: "{{teklif}} için yüksek tıklama oranlı temiz reklam kreatif görseli tasarla.",
      },
    ],
    outputs: ["kreatifler", "gorsel_varyasyon"],
    budget: { max_cost_usd: 0.7 },
  },
  {
    id: "podcast-ses-studyo",
    name: "Müzik, Podcast & Ses Prodüksiyonu",
    nameEn: "Music, Podcast & Audio Production",
    description: "Seslendirme metni, Suno/Udio müzik promptları, SFX listesi ve tarayıcıda çalınabilir Web Audio müzik önizlemesi üretir.",
    descriptionEn: "Generates voiceover script, Suno/Udio prompts, SFX cue sheet, and playable Web Audio preview.",
    category: "Video & Medya",
    tags: ["music", "audio", "podcast", "suno"],
    estimatedCostUsd: 0.04,
    isTemplate: true,
    inputs: {
      konu: {
        type: "text",
        label: "Müzik / Podcast teması",
        placeholder: "Ör. Gece kodlama oturumları için lo-fi synth parçası + 60sn giriş konuşması",
        required: true,
      },
    },
    steps: [
      {
        id: "prod",
        name: "Müzik & Ses Paketi",
        type: "model",
        use: "role:muzik-ses",
        prompt: "Müzik ve ses üretimi: {{konu}} için Suno/Udio yapılandırılmış şarkı promptu, ElevenLabs seslendirme metni ve tarayıcıda çalınabilir Web Audio API synth oynatıcı HTML'i üret.",
      },
    ],
    outputs: ["prod"],
    budget: { max_cost_usd: 0.5 },
  },
  {
    id: "icerik-kiti",
    name: "İçerik Kiti (Makale + Kapak + Sosyal Medya)",
    nameEn: "Content Kit (Article + Cover + Social)",
    description: "Konudan makale, kapak görseli ve 5 sosyal medya paylaşımı tek tıkla üretir.",
    descriptionEn: "Turns a topic into a full article, cover visual, and 5 social posts in parallel.",
    category: "İçerik & Araştırma",
    tags: ["blog", "social", "cover"],
    estimatedCostUsd: 0.06,
    isTemplate: true,
    inputs: {
      konu: {
        type: "text",
        label: "İçerik konusu",
        placeholder: "Ör. Evden çalışırken verimlilik ipuçları",
        required: true,
      },
    },
    steps: [
      {
        id: "makale",
        name: "Makale Yazımı",
        type: "model",
        use: "role:yazi",
        prompt: '"{{konu}}" konusunda akıcı, alt başlıklı, örnekli bir makale yaz.',
      },
      {
        id: "paralel_uretim",
        name: "Kapak Görseli + Sosyal Medya",
        type: "parallel",
        steps: [
          {
            id: "kapak",
            name: "Kapak Görseli",
            type: "model",
            use: "role:gorsel-uretim",
            prompt: '"{{konu}}" makalesi için modern, minimalist kapak görseli tasarla.',
          },
          {
            id: "sosyal",
            name: "5 Sosyal Medya Metni",
            type: "model",
            use: "role:genel",
            prompt: '"{{konu}}" konusunda 5 farklı dikkat çekici LinkedIn/X paylaşımı yaz.',
          },
        ],
      },
    ],
    outputs: ["makale", "paralel_uretim"],
    budget: { max_cost_usd: 0.8 },
  },
  {
    id: "hata-avcisi",
    name: "Hata Avcısı & Birim Test",
    nameEn: "Bug Hunter & Unit Test",
    description: "Hata kaydını inceler, kök nedeni bulur ve birim testleriyle düzeltme önerir.",
    descriptionEn: "Analyzes stack traces, finds root cause, and writes safe fix + unit tests.",
    category: "Geliştirici",
    tags: ["debug", "tests", "code"],
    estimatedCostUsd: 0.04,
    isTemplate: true,
    inputs: {
      hata: {
        type: "text",
        label: "Hata mesajı veya stack trace",
        placeholder: "TypeError: Cannot read properties of undefined...",
        required: true,
      },
    },
    steps: [
      {
        id: "analiz",
        name: "Kök Neden Analizi",
        type: "model",
        use: "role:kodlama",
        prompt: "Şu hatanın kök nedenini ve olası tetikleyicilerini analiz et:\n{{hata}}",
      },
      {
        id: "cozum",
        name: "Düzeltme ve Test",
        type: "model",
        use: "role:kodlama",
        prompt: "Analize göre en güvenli düzeltmeyi ve tekrar oluşmasını önleyecek birim testini yaz: {{analiz.text}}",
      },
    ],
    outputs: ["analiz", "cozum"],
    budget: { max_cost_usd: 0.6 },
  },
  {
    id: "kod-incelemesi",
    name: "Kod İncelemesi (Çift Model + Hakem)",
    nameEn: "Dual-Model Code Review + Judge",
    description: "İki farklı model kodu bağımsız inceler, hakem model bulguları önceliklendirir.",
    descriptionEn: "Two independent models audit security & performance; judge merges findings.",
    category: "Geliştirici",
    tags: ["review", "security", "council"],
    estimatedCostUsd: 0.06,
    isTemplate: true,
    inputs: {
      kod: {
        type: "text",
        label: "İncelenecek kod veya PR özeti",
        placeholder: "Fonksiyonu veya diff'i yapıştırın...",
        required: true,
      },
    },
    steps: [
      {
        id: "incelemeler",
        name: "Bağımsız İncelemeler",
        type: "parallel",
        steps: [
          {
            id: "guvenlik",
            name: "Güvenlik & Hata İncelemesi",
            type: "model",
            use: "role:kodlama",
            prompt: "Bu kodu güvenlik açıkları, kenar durumları ve hata riskleri açısından incele:\n{{kod}}",
          },
          {
            id: "performans",
            name: "Performans & Okunabilirlik",
            type: "model",
            use: "role:genel",
            prompt: "Bu kodu performans, karmaşıklık ve okunabilirlik açısından incele:\n{{kod}}",
          },
        ],
      },
      {
        id: "hakem",
        name: "Hakem Özeti",
        type: "model",
        use: "role:kodlama",
        prompt: "İki incelemeyi birleştirip öncelikli aksiyon listesi çıkar:\n{{incelemeler}}",
      },
    ],
    outputs: ["incelemeler", "hakem"],
    budget: { max_cost_usd: 0.8 },
  },
  {
    id: "arastirma-raporu",
    name: "Kaynaklı Araştırma Raporu",
    nameEn: "Sourced Research Report",
    description: "Web araması yapıp kaynakları sentezler ve yapılandırılmış rapor oluşturur.",
    descriptionEn: "Runs web search and synthesizes findings into a structured sourced report.",
    category: "İçerik & Araştırma",
    tags: ["research", "web", "report"],
    estimatedCostUsd: 0.03,
    isTemplate: true,
    inputs: {
      soru: {
        type: "text",
        label: "Araştırma sorusu",
        placeholder: "Ör. 2026 açık kaynak vektör veritabanları karşılaştırması",
        required: true,
      },
    },
    steps: [
      {
        id: "arama",
        name: "Web Araması",
        type: "tool",
        use: "tool:web-search",
        input: { query: "{{soru}}", maxResults: 5 },
      },
      {
        id: "rapor",
        name: "Kaynaklı Rapor",
        type: "model",
        use: "role:arastirma",
        prompt: 'Soru: "{{soru}}"\nArama bulguları: {{arama.text}}\nKarşılaştırmalı ve kaynaklı bir araştırma raporu hazırla.',
      },
    ],
    outputs: ["arama", "rapor"],
    budget: { max_cost_usd: 0.5 },
  },
  {
    id: "veri-analizi",
    name: "Veri Analizi & Metrik Raporu",
    nameEn: "Data Analysis & Metrics",
    description: "CSV veya tablo verisini inceler, içgörü, SQL/Python kodu ve özet rapor çıkarır.",
    descriptionEn: "Inspects CSV/tabular data, outputs insights, Python/SQL queries, and charts.",
    category: "Geliştirici",
    tags: ["data", "csv", "python"],
    estimatedCostUsd: 0.04,
    isTemplate: true,
    inputs: {
      hedef: {
        type: "text",
        label: "Analiz hedefi",
        placeholder: "Aylara göre ciro ve en çok satan 5 ürünü çıkar",
        required: true,
      },
    },
    steps: [
      {
        id: "yorum",
        name: "Veri İnceleme & Yorum",
        type: "model",
        use: "role:veri-analizi",
        prompt: "Hedef: {{hedef}}. Analiz adımlarını, metrikleri ve önerilen Python/SQL sorgusunu üret.",
      },
    ],
    outputs: ["yorum"],
    budget: { max_cost_usd: 0.5 },
  },
];

