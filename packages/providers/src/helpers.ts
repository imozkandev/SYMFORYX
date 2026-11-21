import { SymError, type SymErrorCode, type SymMessage } from "@symforyx/core";

export function mapHttpError(
  providerId: string,
  status: number,
  bodyText: string
): SymError {
  const lower = bodyText.toLowerCase();
  let code: SymErrorCode = "unavailable";
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("authentication")) {
    code = "auth";
  } else if (status === 429 || lower.includes("rate limit") || lower.includes("quota")) {
    code = "rate_limit";
  } else if (
    lower.includes("context length") ||
    lower.includes("too many tokens") ||
    lower.includes("maximum context")
  ) {
    code = "context_overflow";
  } else if (lower.includes("content_filter") || lower.includes("safety") || lower.includes("blocked")) {
    code = "content_filter";
  } else if (status >= 400 && status < 500) {
    code = "invalid_request";
  }

  const friendlyMessages: Record<SymErrorCode, string> = {
    auth: `${providerId}: API anahtarı geçersiz veya yetkisiz. Ayarlar → Sağlayıcılar'dan kontrol edin.`,
    rate_limit: `${providerId}: Hız sınırına ulaşıldı. Otomatik tekrar veya yedek model deneniyor.`,
    context_overflow: `${providerId}: Bağlam penceresi aşıldı. Otomatik özetleme gerekiyor.`,
    content_filter: `${providerId}: İçerik güvenlik filtresine takıldı.`,
    unavailable: `${providerId}: Sağlayıcı şu anda ulaşılamıyor (HTTP ${status}).`,
    invalid_request: `${providerId}: Geçersiz istek (HTTP ${status}): ${bodyText.slice(0, 180)}`,
    budget_exceeded: "Bütçe limiti aşıldı.",
    permission_denied: "İzin reddedildi.",
    timeout: `${providerId}: İstek zaman aşımına uğradı.`,
  };

  return new SymError(code, friendlyMessages[code], {
    providerId,
    retryable: code === "rate_limit" || code === "unavailable",
    details: { status, body: bodyText.slice(0, 400) },
  });
}

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: string | undefined;

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          currentEvent = undefined;
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) {
            yield { event: currentEvent, data };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function flattenMessageText(msg: SymMessage): string {
  const chunks: string[] = [];
  if (msg.role === "assistant" && msg.author.modelName) {
    // Preserve model provenance in multi-model shared threads
    chunks.push(`[${msg.author.modelName}]`);
  }
  for (const part of msg.parts) {
    if (part.type === "text") chunks.push(part.text);
    else if (part.type === "summary") chunks.push(`[Önceki sohbet özeti]: ${part.text}`);
    else if (part.type === "transfer_note") {
      chunks.push(
        `[Aktarım notu: Bu içerik ${part.fromAuthor} tarafından üretildi${
          part.originalPrompt ? ` (istek: "${part.originalPrompt}")` : ""
        }]`
      );
    } else if (part.type === "tool_result") {
      const inner = part.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      if (inner) {
        chunks.push(
          part.untrusted
            ? `<untrusted_tool_data tool="${part.toolId ?? "tool"}">\n${inner}\n</untrusted_tool_data>`
            : `[Araç sonucu (${part.toolId ?? "tool"})]: ${inner}`
        );
      }
    }
  }
  return chunks.join("\n").trim();
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}
