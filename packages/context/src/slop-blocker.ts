/**
 * SYMFORYX AI Slop Blocker Engine
 *
 * Layer 1 (Pre-Generation): Injects strict editorial, UI craft, and visual anti-slop directives
 *   into LLM system prompts and image generation prompts.
 * Layer 2 (Post-Generation): Deterministically strips sycophantic openers, cliché AI filler phrases,
 *   and emoji spam, and computes an honest Craft Score (0-100) with specific flags.
 */

export const ANTI_SLOP_SYSTEM_DIRECTIVE = `## SYMFORYX AI SLOP BLOCKER (ACTIVE — STRICT CRAFT MODE)
You MUST follow these non-negotiable craft standards:
1. ZERO SYCOPHANCY & FILLER: Never start with "Great question!", "Certainly!", "Absolutely!", "Harika bir soru!", "Tabii ki, memnuniyetle!", or empty throat-clearing. Start directly with substance.
2. ZERO AI CLICHÉ PROSE: Strictly avoid English clichés ("delve", "tapestry", "testament", "in today's fast-paced world", "game-changer", "revolutionize", "unlock the power", "elevate your", "seamless", "leverage", "beacon", "cutting-edge", "embark on a journey", "it's worth noting") and Turkish clichés ("günümüzün hızla değişen dünyasında", "oyun değiştirici", "devrim niteliğinde", "bir üst seviyeye taşı", "kusursuz bir deneyim", "benzersiz bir yolculuk"). Write sharp, concrete, human-editorial sentences with specific facts and examples.
3. ZERO EMOJI SPAM: Do not decorate headings or bullet points with repetitive AI emojis (🚀✨💡🔥🎯).
4. ZERO AI-SLOP UI / FRONTEND: When generating HTML, CSS, React, Svelte, or UI designs:
   - NEVER use generic purple/indigo-to-pink neon gradients, glowing glassmorphic cards on muddy dark-blue backgrounds, sparkle icons, or generic 3-card "Lightning Fast / Enterprise Security / AI-Powered" boilerplate.
   - ALWAYS craft intentional, Swiss/editorial studio layouts: refined warm-neutral or deep matte obsidian surfaces, crisp 1px hairlines, strong typographic contrast (tight display tracking, tabular-nums for data), authentic domain copy, asymmetric or deliberate grid structure, and WCAG AA contrast.`;

export function enhanceImagePromptAntiSlop(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt;
  return `${prompt}\n[Craft Direction: editorial art direction, crisp studio lighting, authentic tactile materials, deliberate composition, clean typography; avoid generic neon purple-cyan AI glow, plastic 3D gloss, oversaturated HDR slop, and garbled text]`;
}

export interface SlopAuditResult {
  cleanedText: string;
  craftScore: number;
  cleanedCount: number;
  flags: string[];
}

const SYCOPHANTIC_OPENERS: RegExp[] = [
  /^(?:great question!|that's a great question!|certainly!|absolutely!|of course!|sure thing!|i'd be happy to help(?: with that)?[.!]?)\s+/i,
  /^(?:harika bir soru!|çok güzel bir soru!|tabii ki[,!]?|elbette[,!]?|memnuniyetle[,!]?)\s+/i,
];

const CLICHE_PATTERNS: Array<{ pattern: RegExp; label: string; replace?: string }> = [
  { pattern: /\bin today's fast-paced (?:digital )?world,?\s*/gi, label: "cliche:fast-paced-world", replace: "" },
  { pattern: /\bgünümüzün hızla değişen(?: dijital)? dünyasında,?\s*/gi, label: "cliche:hizla-degisen", replace: "" },
  { pattern: /\b(?:delve into|embark on a journey|a testament to|rich tapestry of)\b/gi, label: "cliche:en-prose" },
  { pattern: /\b(?:game-changer|unlock the power of|elevate your .*? to the next level|revolutionize the way)\b/gi, label: "cliche:en-marketing" },
  { pattern: /\b(?:oyun değiştirici|devrim niteliğinde|bir üst seviyeye taşı|kusursuz bir deneyim|benzersiz bir yolculuk)\b/gi, label: "cliche:tr-marketing" },
  { pattern: /\bit(?:'s| is) worth noting that\s*/gi, label: "cliche:worth-noting", replace: "" },
  { pattern: /\b(?:sonuç olarak|öte yandan|dikkat çekmek gerekir ki),?\s+/gi, label: "cliche:tr-filler" },
];

const UI_SLOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /linear-gradient\([^)]*(?:#6366f1|#8b5cf6|#a855f7|#ec4899|purple|violet)[^)]*\)/gi, label: "ui-slop:purple-neon-gradient" },
  { pattern: /backdrop-filter:\s*blur\([1-9][0-9]px\)/gi, label: "ui-slop:heavy-glassmorphism" },
  { pattern: /(?:Lightning Fast|AI-Powered|Enterprise-Grade Security)/gi, label: "ui-slop:generic-feature-cards" },
];

export function auditAndCleanSlop(text: string, enabled: boolean): SlopAuditResult {
  if (!enabled || !text) {
    return { cleanedText: text, craftScore: 100, cleanedCount: 0, flags: [] };
  }

  let out = text;
  let cleanedCount = 0;
  const flags: string[] = [];

  // Separate fenced code blocks so we scrub prose without breaking code syntax
  const codeSegments: string[] = [];
  const placeholderText = out.replace(/```[\s\S]*?```/g, (block) => {
    const idx = codeSegments.length;
    codeSegments.push(block);
    return `__SYM_CODE_BLOCK_${idx}__`;
  });

  let prose = placeholderText;

  // 1. Strip sycophantic openers
  for (const re of SYCOPHANTIC_OPENERS) {
    if (re.test(prose)) {
      prose = prose.replace(re, "");
      cleanedCount++;
      flags.push("stripped:sycophancy");
    }
  }

  // 2. Detect & clean cliché filler phrases
  for (const c of CLICHE_PATTERNS) {
    if (c.pattern.test(prose)) {
      flags.push(c.label);
      if (c.replace !== undefined) {
        prose = prose.replace(c.pattern, c.replace);
        cleanedCount++;
      }
    }
  }

  // 3. Strip repetitive AI-slop bullet emojis (🚀✨💡🔥🎯) in prose
  const emojiMatches = prose.match(/[🚀✨💡🔥🎯🌟⚡🤖]/g);
  if (emojiMatches && emojiMatches.length >= 2) {
    prose = prose.replace(/[🚀✨💡🔥🎯🌟⚡🤖]\s?/g, "");
    cleanedCount += emojiMatches.length;
    flags.push("stripped:emoji-spam");
  }

  // Restore code blocks & audit UI/HTML code for visual slop
  out = prose.replace(/__SYM_CODE_BLOCK_(\d+)__/g, (_, idxStr) => codeSegments[Number(idxStr)] ?? "");
  for (const block of codeSegments) {
    for (const ui of UI_SLOP_PATTERNS) {
      if (ui.pattern.test(block)) {
        flags.push(ui.label);
      }
    }
  }

  const uniqueFlags = Array.from(new Set(flags));
  // Penalty for remaining uncleaned flags (smaller penalty for flags that were auto-cleaned)
  const uncleanedFlags = uniqueFlags.filter((f) => !f.startsWith("stripped:"));
  const craftScore = Math.max(40, Math.min(100, 100 - uncleanedFlags.length * 8 - (cleanedCount > 0 ? 2 : 0)));

  return {
    cleanedText: out.trimStart(),
    craftScore,
    cleanedCount,
    flags: uniqueFlags,
  };
}
