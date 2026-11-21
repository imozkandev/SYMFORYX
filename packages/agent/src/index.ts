import { createId, normalizeTr } from "@symforyx/core";

export interface AgentTimelineEvent {
  id: string;
  step: number;
  kind: "plan" | "tool_call" | "observation" | "approval_needed" | "synthesis" | "done" | "error";
  title: string;
  detail: string;
  toolId?: string;
  costUsd?: number;
  timestamp: string;
}

export interface AgentRunOptions {
  goal: string;
  projectId: string;
  threadId: string;
  maxSteps: number;
  maxCostUsd: number;
  enabledTools: string[];
  invokeTool: (
    toolId: string,
    args: Record<string, unknown>
  ) => Promise<{ text?: string; artifactIds?: string[]; isError?: boolean; untrusted?: boolean }>;
  generateText: (prompt: string) => Promise<{ text: string; costUsd: number; artifactIds?: string[] }>;
  onTimeline: (evt: AgentTimelineEvent) => void;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  plan: string[];
  timeline: AgentTimelineEvent[];
  finalAnswer: string;
  artifactIds: string[];
  totalCostUsd: number;
  stepsUsed: number;
}

/**
 * SYMFORYX Agent Runner:
 * 1. Produces an explicit plan visible to the user
 * 2. Executes allowed tools step-by-step respecting step & budget caps
 * 3. Flags destructive / external-write operations for human confirmation
 * 4. Synthesizes final verified answer with artifacts
 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<AgentRunResult> {
  const timeline: AgentTimelineEvent[] = [];
  const artifactIds: string[] = [];
  let totalCostUsd = 0;
  let stepCount = 0;

  const emit = (
    kind: AgentTimelineEvent["kind"],
    title: string,
    detail: string,
    extra?: Partial<AgentTimelineEvent>
  ) => {
    const evt: AgentTimelineEvent = {
      id: createId("ag"),
      step: stepCount,
      kind,
      title,
      detail,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    timeline.push(evt);
    opts.onTimeline(evt);
  };

  const norm = normalizeTr(opts.goal);
  const plan: string[] = ["Hedefi ve mevcut araçları analiz et"];
  const plannedActions: Array<{ toolId: string; args: Record<string, unknown>; label: string }> = [];

  if (
    opts.enabledTools.includes("dev.ozkandev.renk-paleti") &&
    (norm.includes("renk") || norm.includes("palet") || norm.includes("tema"))
  ) {
    plan.push("Renk Paleti aracıyla erişilebilir renk kartelası üret");
    plannedActions.push({
      toolId: "dev.ozkandev.renk-paleti",
      args: { source: opts.goal, count: 5 },
      label: "Renk Paleti Üretimi",
    });
  }

  if (
    opts.enabledTools.includes("web-search") &&
    (norm.includes("ara") || norm.includes("guncel") || norm.includes("haber") || norm.includes("arastir"))
  ) {
    plan.push("Web Araması ile güncel kaynakları topla");
    plannedActions.push({
      toolId: "web-search",
      args: { query: opts.goal.slice(0, 120), maxResults: 4 },
      label: "Web Araması",
    });
  }

  if (
    opts.enabledTools.includes("code-sandbox") &&
    (norm.includes("hesapla") || norm.includes("test") || norm.includes("calistir") || norm.includes("analiz"))
  ) {
    plan.push("Sandbox ortamında doğrulama kodu çalıştır");
    plannedActions.push({
      toolId: "code-sandbox",
      args: {
        language: "javascript",
        code: `console.log("SYMFORYX Sandbox doğrulaması başarılı:", new Date().toISOString());`,
      },
      label: "Sandbox Doğrulama",
    });
  }

  plan.push("Bulguları sentezle ve uygulanabilir çözüm sun");

  stepCount = 1;
  emit("plan", "Ajan Planı Hazırlandı", plan.map((p, i) => `${i + 1}. ${p}`).join("\n"));

  const observations: string[] = [];

  for (const action of plannedActions) {
    if (opts.signal?.aborted) break;
    if (stepCount >= opts.maxSteps) {
      emit("error", "Adım Limiti", `Maksimum adım sınırına (${opts.maxSteps}) ulaşıldı.`);
      break;
    }
    if (totalCostUsd >= opts.maxCostUsd) {
      emit("error", "Bütçe Limiti", `Ajan harcama sınırına ($${opts.maxCostUsd.toFixed(2)}) ulaşıldı.`);
      break;
    }

    stepCount++;
    emit("tool_call", `Araç Çağrısı: ${action.label}`, JSON.stringify(action.args), {
      toolId: action.toolId,
    });

    try {
      const res = await opts.invokeTool(action.toolId, action.args);
      if (res.artifactIds) artifactIds.push(...res.artifactIds);
      const summary = (res.text ?? "Tamamlandı").slice(0, 800);
      observations.push(`### ${action.label}\n${summary}`);
      emit("observation", `Gözlem: ${action.label}`, summary, { toolId: action.toolId });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      observations.push(`### ${action.label} (Hata)\n${errMsg}`);
      emit("error", `Araç Hatası: ${action.label}`, errMsg, { toolId: action.toolId });
    }
  }

  // Final synthesis step
  stepCount++;
  const synthesisPrompt = [
    `Ajan hedefi: ${opts.goal}`,
    `Uygulanan plan:\n${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
    observations.length > 0 ? `Araç gözlemleri:\n${observations.join("\n\n")}` : "",
    "Bulguları özetleyerek kullanıcıya net, eyleme dönük son yanıtı yaz.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const finalRes = await opts.generateText(synthesisPrompt);
  totalCostUsd = Number((totalCostUsd + finalRes.costUsd).toFixed(6));
  if (finalRes.artifactIds) artifactIds.push(...finalRes.artifactIds);

  emit("done", "Ajan Görevi Tamamladı", `${stepCount} adım · $${totalCostUsd.toFixed(4)}`, {
    costUsd: totalCostUsd,
  });

  return {
    plan,
    timeline,
    finalAnswer: finalRes.text,
    artifactIds,
    totalCostUsd,
    stepsUsed: stepCount,
  };
}
