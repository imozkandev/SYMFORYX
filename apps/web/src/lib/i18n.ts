import type { LanguageCode, QuotaResetInterval, ReferenceRole } from "@symforyx/core";

export const UI_STRINGS = {
  tr: {
    newChat: "Yeni Sohbet",
    newProject: "Yeni Çalışma Alanı",
    deleteProject: "Çalışma Alanını Sil",
    deleteProjectConfirm: "bu çalışma alanını ve içindeki tüm sohbetleri kalıcı olarak silmek istiyor musun?",
    projectDeleted: "Çalışma alanı silindi",
    noWorkspaces: "Çalışma alanı yok",
    threads: "Sohbetler",
    flows: "Akışlar",
    tools: "Araçlar & MCP",
    quotas: "Kotalar & Maliyet",
    memory: "Hafıza & Dosyalar",
    settings: "Ayarlar",
    commandPalette: "Komut",
    artifacts: "Artefaktlar",
    context: "Bağlam",
    pinned: "sabit",
    summaries: "özet",
    manage: "Yönet",
    send: "Gönder",
    stop: "Durdur",
    autoModel: "Otomatik",
    placeholder: "İstediğin model/araçla üret (@flux, @claude, @gpt, @yerel, /zincir)...",
    refImageAdd: "Referans Görsel",
    refIdeaAdd: "Referans Fikir",
    refIdeaPlaceholder: "Fikir, stil notu veya kısıt yaz (ör. İsviçre ızgara, yüksek kontrast, gradyan yok)...",
    refTitlePlaceholder: "Başlık (ör. Tipografi / Mood)",
    add: "Ekle",
    cancel: "İptal",
    save: "Kaydet",
    close: "Kapat",
    sendTo: "Aktar",
    useAsRef: "Referans Ekle",
    regenerate: "Yeniden",
    branch: "Dallan",
    pin: "Sabitle",
    unpin: "Sabiti kaldır",
    copy: "Kopyala",
    copied: "Kopyalandı",
    saveMemory: "Hafızaya al",
    selectWinner: "Ana dal olarak seç",
    selectedWinner: "Seçildi",
    emptyTitle: "Çalışma Tezgâhı",
    emptySub: "Kısıtlama yok. Görseli istediğin modelle, kodu istediğin modelle üret; referans görsel ve fikir ekle, tüm araçların kotasını ve maliyetini canlı takip et.",
    quotaUsed: "Kullanılan",
    quotaRemaining: "Kalan",
    quotaResets: "Sıfırlanma",
    quotaCost: "Maliyet",
    unlimited: "Sınırsız",
    totalMonthSpend: "Aylık Maliyet",
    customModelPlaceholder: "Özel model ID ekle (ör. claude-opus-4, flux-schnell)...",
    addModel: "Model Ekle",
    themeLight: "Açık",
    themeDark: "Koyu",
    themeSystem: "Sistem",
    providersTab: "Sağlayıcılar & Modeller",
    rolesTab: "Görev Rolleri",
    quotasTab: "Kotalar & Maliyet",
    appearanceTab: "Görünüm & Dil",
    chatTab: "Sohbet & Bağlam",
    memoryTab: "Hafıza & Dosyalar",
    shortcutsTab: "Kısayollar",
    aboutTab: "Veri & Hakkında",
    editQuota: "Limiti Düzenle",
    noReset: "Sıfırlanmaz",
    codeWith: "Kodla ▸",
    preview: "Önizleme",
    code: "Kod",
    run: "Çalıştır",
    editArtifactPlaceholder: "Bu çıktıda ne değişsin?...",
    update: "Uygula",
  },
  en: {
    newChat: "New Thread",
    newProject: "New Workspace",
    deleteProject: "Delete Workspace",
    deleteProjectConfirm: "permanently delete this workspace and all its threads?",
    projectDeleted: "Workspace deleted",
    noWorkspaces: "No workspaces",
    threads: "Threads",
    flows: "Flows",
    tools: "Tools & MCP",
    quotas: "Quotas & Cost",
    memory: "Memory & Files",
    settings: "Settings",
    commandPalette: "Command",
    artifacts: "Artifacts",
    context: "Context",
    pinned: "pinned",
    summaries: "summary",
    manage: "Manage",
    send: "Send",
    stop: "Stop",
    autoModel: "Auto",
    placeholder: "Create with any model or tool (@flux, @claude, @gpt, @yerel, /zincir)...",
    refImageAdd: "Ref Image",
    refIdeaAdd: "Ref Idea",
    refIdeaPlaceholder: "Write style note, inspiration, or constraint (e.g. Swiss grid, zero gradients)...",
    refTitlePlaceholder: "Title (e.g. Typography / Mood)",
    add: "Add",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    sendTo: "Handoff",
    useAsRef: "Use as Ref",
    regenerate: "Retry",
    branch: "Branch",
    pin: "Pin",
    unpin: "Unpin",
    copy: "Copy",
    copied: "Copied",
    saveMemory: "Memorize",
    selectWinner: "Select as primary",
    selectedWinner: "Selected",
    emptyTitle: "Studio Workbench",
    emptySub: "Zero lock-in. Generate visuals with any image engine, code with any LLM, attach reference images & ideas, and track live quotas, resets, and costs across every tool.",
    quotaUsed: "Used",
    quotaRemaining: "Remaining",
    quotaResets: "Resets",
    quotaCost: "Cost",
    unlimited: "Unlimited",
    totalMonthSpend: "Monthly Spend",
    customModelPlaceholder: "Add any custom model ID (e.g. claude-opus-4, flux-schnell)...",
    addModel: "Add Model",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    providersTab: "Providers & Models",
    rolesTab: "Task Roles",
    quotasTab: "Quotas & Cost",
    appearanceTab: "Appearance & Language",
    chatTab: "Chat & Context",
    memoryTab: "Memory & Files",
    shortcutsTab: "Shortcuts",
    aboutTab: "Data & About",
    editQuota: "Edit Quota",
    noReset: "Never",
    codeWith: "Code ▸",
    preview: "Preview",
    code: "Code",
    run: "Run",
    editArtifactPlaceholder: "Describe changes to this artifact...",
    update: "Apply",
  },
} as const;

export type UiKey = keyof typeof UI_STRINGS.tr;

export function tr(lang: LanguageCode, key: UiKey): string {
  return UI_STRINGS[lang]?.[key] ?? UI_STRINGS.tr[key];
}

export function refRoleLabel(lang: LanguageCode, role: ReferenceRole): string {
  const map: Record<ReferenceRole, { tr: string; en: string }> = {
    style: { tr: "Stil", en: "Style" },
    layout: { tr: "Düzen", en: "Layout" },
    palette: { tr: "Renk", en: "Palette" },
    subject: { tr: "Konu", en: "Subject" },
    edit_source: { tr: "Düzenle", en: "Edit Source" },
    inspiration: { tr: "Fikir", en: "Idea" },
    constraint: { tr: "Kısıt", en: "Constraint" },
  };
  return map[role]?.[lang] ?? role;
}

export function resetIntervalLabel(lang: LanguageCode, interval: QuotaResetInterval): string {
  const map: Record<QuotaResetInterval, { tr: string; en: string }> = {
    hourly: { tr: "Saatlik", en: "Hourly" },
    "5h": { tr: "5 Saatlik", en: "5-Hour" },
    daily: { tr: "Günlük", en: "Daily" },
    weekly: { tr: "Haftalık", en: "Weekly" },
    monthly: { tr: "Aylık", en: "Monthly" },
    never: { tr: "Sınırsız", en: "Never" },
  };
  return map[interval]?.[lang] ?? interval;
}

export function formatCountdown(iso: string | null, lang: LanguageCode): string {
  if (!iso) return lang === "en" ? "No reset" : "Sıfırlanmaz";
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return lang === "en" ? "Now" : "Şimdi";
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const remH = hours % 24;
    return lang === "en" ? `${days}d ${remH}h` : `${days}g ${remH}sa`;
  }
  if (hours > 0) {
    const remM = mins % 60;
    return lang === "en" ? `${hours}h ${remM}m` : `${hours}sa ${remM}dk`;
  }
  return lang === "en" ? `${mins}m` : `${mins}dk`;
}
