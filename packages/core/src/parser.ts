/**
 * SYMFORYX Mention, Slash Command, Chain, and Artifact Parser
 * Supports both Turkish characters and ASCII equivalents (e.g. /görsel === /gorsel, @görsel === @gorsel).
 */

export function normalizeTr(input: string): string {
  return input
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

export interface ParsedUserInput {
  raw: string;
  cleanText: string;
  slashCommand?: {
    command: string; // normalized, without leading '/'
    rawCommand: string;
    args: string;
  };
  mentions: string[]; // normalized without '@'
  rawMentions: string[];
  fileRefs: string[]; // without '#'
  isChain: boolean;
  chainSteps?: string[];
}

const SLASH_ALIASES: Record<string, string> = {
  gorsel: "gorsel",
  image: "gorsel",
  duzenle: "duzenle",
  edit: "duzenle",
  kod: "kod",
  code: "kod",
  calistir: "calistir",
  run: "calistir",
  onizle: "onizle",
  preview: "onizle",
  ara: "ara",
  search: "ara",
  oku: "oku",
  read: "oku",
  ozetle: "ozetle",
  summarize: "ozetle",
  karsilastir: "karsilastir",
  compare: "karsilastir",
  zincir: "zincir",
  chain: "zincir",
  konsey: "council",
  council: "council",
  akis: "akis",
  flow: "akis",
  ajan: "ajan",
  agent: "ajan",
  ses: "ses",
  voice: "ses",
  tts: "ses",
  audio: "ses",
  muzik: "music",
  music: "music",
  video: "video",
  promo: "video",
  "3d": "3d",
  model3d: "3d",
  aso: "aso",
  store: "store",
  magaza: "store",
  launch: "launch",
  lansman: "launch",
  ads: "ads",
  reklam: "ads",
  brand: "brand",
  marka: "brand",
  debug: "debug",
  hata: "debug",
  review: "review",
  incele: "review",
  test: "test",
  refactor: "refactor",
  sql: "sql",
  data: "data",
  veri: "data",
  optimize: "optimize",
  tasarruf: "optimize",
  "anti-slop": "anti-slop",
  slop: "anti-slop",
  quota: "quota",
  kota: "quota",
  hafiza: "hafiza",
  memory: "hafiza",
  maliyet: "maliyet",
  cost: "maliyet",
  "disa-aktar": "disa-aktar",
  export: "disa-aktar",
  yardim: "yardim",
  help: "yardim",
  palet: "palet",
  palette: "palet",
  referans: "referans",
  ref: "referans",
  reference: "referans",
};

export function parseUserInput(rawInput: string): ParsedUserInput {
  const raw = rawInput.trim();
  let remaining = raw;
  let slashCommand: ParsedUserInput["slashCommand"];

  // 1. Slash command at start of message
  const slashMatch = remaining.match(/^\/([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?:\s+([\s\S]*))?$/);
  if (slashMatch) {
    const rawCmd = slashMatch[1];
    const norm = normalizeTr(rawCmd);
    const canonical = SLASH_ALIASES[norm] ?? norm;
    const args = (slashMatch[2] ?? "").trim();
    slashCommand = {
      command: canonical,
      rawCommand: rawCmd,
      args,
    };
    remaining = args;
  }

  // 2. Chain detection (`/zincir a > b > c` or explicit multi-step with `\n> `)
  let isChain = slashCommand?.command === "zincir";
  let chainSteps: string[] | undefined;

  if (isChain || /\n\s*>\s*/.test(remaining)) {
    const parts = remaining
      .split(/\n\s*>\s*|\s+>\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      isChain = true;
      chainSteps = parts;
    }
  }

  // 3. Mentions (@claude, @gorsel, @herkes, etc.)
  const rawMentions: string[] = [];
  const mentions: string[] = [];
  const mentionRegex = /(^|\s)@([a-zA-Z0-9_\-\.ğüşıöçĞÜŞİÖÇ]+)/g;
  let m: RegExpExecArray | null;
  while ((m = mentionRegex.exec(remaining)) !== null) {
    const token = m[2];
    rawMentions.push(token);
    const norm = normalizeTr(token);
    if (!mentions.includes(norm)) {
      mentions.push(norm);
    }
  }

  // 4. File / artifact refs (#report.pdf, #art_123)
  const fileRefs: string[] = [];
  const fileRegex = /(^|\s)#([a-zA-Z0-9_\-\.ğüşıöçĞÜŞİÖÇ]+)/g;
  while ((m = fileRegex.exec(remaining)) !== null) {
    if (!fileRefs.includes(m[2])) {
      fileRefs.push(m[2]);
    }
  }

  const cleanText = remaining
    .replace(/(^|\s)@[a-zA-Z0-9_\-\.ğüşıöçĞÜŞİÖÇ]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw,
    cleanText: cleanText || remaining,
    slashCommand,
    mentions,
    rawMentions,
    fileRefs,
    isChain,
    chainSteps,
  };
}

export interface ExtractedCodeBlock {
  language: string;
  filename?: string;
  content: string;
}

export function extractCodeBlocks(markdown: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const regex = /```([a-zA-Z0-9_\-+.#]*)(?:[ \t]+([^\n]+))?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const lang = (match[1] || "text").toLowerCase();
    const meta = (match[2] || "").trim();
    const content = match[3].trimEnd();
    if (!content) continue;
    let filename: string | undefined;
    const fileMatch = meta.match(/(?:file=|title=)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/);
    if (fileMatch) filename = fileMatch[1];
    blocks.push({ language: lang, filename, content });
  }
  return blocks;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough approximation suitable for Turkish & English (~3.8 chars per token)
  return Math.max(1, Math.ceil(text.length / 3.8));
}

export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return "••••••••";
  const prefix = secret.slice(0, Math.min(6, secret.indexOf("-") > 0 ? secret.indexOf("-") + 4 : 4));
  const suffix = secret.slice(-4);
  return `${prefix}•••${suffix}`;
}

export function createId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${rand}`;
}
