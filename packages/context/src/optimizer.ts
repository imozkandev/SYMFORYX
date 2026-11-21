import { estimateTokens, type SymMessage } from "@symforyx/core";

export interface OptimizationResult {
  messages: SymMessage[];
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  compressionPercent: number;
}

/**
 * SYMFORYX Token & Cost Optimizer:
 * - Preserves pinned messages and the latest 2 turns verbatim
 * - Compresses verbose older code/HTML/tool payloads into concise excerpts + artifact ID pointers
 * - Removes redundant whitespace, duplicate blank lines, and boilerplate in older turns
 * - Significantly reduces outgoing input tokens and API cost without losing task context
 */
export function optimizeContextMessages(
  messages: SymMessage[],
  enabled: boolean
): OptimizationResult {
  const originalTokens = messages.reduce((sum, m) => sum + estimateMsgTok(m), 0);
  if (!enabled || messages.length <= 2) {
    return {
      messages,
      originalTokens,
      optimizedTokens: originalTokens,
      savedTokens: 0,
      compressionPercent: 0,
    };
  }

  const keepVerbatimFrom = Math.max(0, messages.length - 2);
  const optimized: SymMessage[] = messages.map((msg, idx) => {
    if (idx >= keepVerbatimFrom || msg.pinned) {
      // Only lightly trim trailing spaces in newest turns
      return msg;
    }

    const newParts = msg.parts.map((part) => {
      if (part.type === "text") {
        let txt = part.text;
        // Collapse huge fenced HTML/code blocks in older turns if already saved as artifact
        txt = txt.replace(/```([a-zA-Z0-9_-]*)(?:[^\n]*)\n([\s\S]*?)```/g, (full, lang, body: string) => {
          if (body.length < 420) return full;
          const head = body.split("\n").slice(0, 6).join("\n");
          const artHint = msg.artifacts?.[0] ? ` (tam kod: #${msg.artifacts[0]})` : "";
          return `\`\`\`${lang}\n${head}\n// ... [${body.length} karakter sıkıştırıldı${artHint}]\n\`\`\``;
        });
        // Collapse repetitive whitespace & blank lines
        txt = txt.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
        if (txt.length > 1400) {
          txt = `${txt.slice(0, 1100)}\n…[+${txt.length - 1100} kr. sıkıştırıldı]`;
        }
        return { ...part, text: txt };
      }
      if (part.type === "tool_result") {
        const compactContent = part.content.map((c) => {
          if (c.type === "text" && c.text.length > 700) {
            return { ...c, text: `${c.text.slice(0, 550)}…[araç çıktısı sıkıştırıldı]` };
          }
          return c;
        });
        return { ...part, content: compactContent };
      }
      return part;
    });

    return { ...msg, parts: newParts };
  });

  const optimizedTokens = optimized.reduce((sum, m) => sum + estimateMsgTok(m), 0);
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  const compressionPercent =
    originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 100) : 0;

  return {
    messages: optimized,
    originalTokens,
    optimizedTokens,
    savedTokens,
    compressionPercent,
  };
}

function estimateMsgTok(msg: SymMessage): number {
  let chars = 0;
  for (const p of msg.parts) {
    if (p.type === "text" || p.type === "summary") chars += p.text.length;
    else if (p.type === "tool_result") {
      for (const c of p.content) if (c.type === "text") chars += c.text.length;
    }
  }
  return estimateTokens("x".repeat(chars));
}
