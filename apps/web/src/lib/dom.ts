import { marked } from "marked";
import type { ThemeMode } from "@symforyx/core";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(md: string): string {
  return marked.parse(md || "", { async: false }) as string;
}

/**
 * Safe HTML insertion following Modern Web Guidance (`sanitize-untrusted-html`):
 * Uses native Element.prototype.setHTML() when available, and lazy-loads DOMPurify
 * with matching restrictive flags only when native Sanitizer API is unsupported.
 */
const ALLOWED_ELEMENTS = [
  "p", "br", "strong", "b", "em", "i", "code", "pre", "blockquote",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "a", "span", "div", "del",
];
const ALLOWED_ATTRS = ["class", "href", "target", "rel"];

let domPurifyPromise: Promise<{ sanitize: (html: string, cfg?: Record<string, unknown>) => string }> | undefined;

function loadDOMPurify() {
  domPurifyPromise ??= import("dompurify").then((m) => (m.default ?? m) as any);
  return domPurifyPromise;
}

export async function safeSetHTML(el: HTMLElement, html: string) {
  if ("setHTML" in Element.prototype) {
    (el as HTMLElement & { setHTML: (h: string, opts?: unknown) => void }).setHTML(html, {
      sanitizer: { elements: ALLOWED_ELEMENTS, attributes: ALLOWED_ATTRS },
    });
  } else {
    const DOMPurify = await loadDOMPurify();
    el.innerHTML = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_ELEMENTS, "#text"],
      ALLOWED_ATTR: ALLOWED_ATTRS,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
  }
}

export function safeHtml(node: HTMLElement, html: string) {
  void safeSetHTML(node, html);
  return {
    update(nextHtml: string) {
      void safeSetHTML(node, nextHtml);
    },
  };
}

/**
 * Light-dismiss fallback for <dialog closedby="any"> in browsers (Safari)
 * that do not yet implement `closedBy` natively.
 */
export function lightDismissDialog(dialog: HTMLDialogElement) {
  if ("closedBy" in HTMLDialogElement.prototype) return;

  const onClick = (event: MouseEvent) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!inside) {
      dialog.close();
    }
  };

  dialog.addEventListener("click", onClick);
  return {
    destroy() {
      dialog.removeEventListener("click", onClick);
    },
  };
}

/**
 * Dark-mode theme controller adhering to Modern Web Guidance (`dark-mode-toggle`):
 * Updates <meta name="color-scheme"> and persists override in localStorage.
 * Removes stored entry when returning to system default ("light dark").
 */
export function applyTheme(theme: ThemeMode, accentColor?: string) {
  if (typeof document === "undefined") return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const root = document.documentElement;

  if (theme === "high-contrast") {
    root.classList.add("high-contrast");
    if (meta) meta.content = "dark";
    try {
      localStorage.setItem("color-scheme", "dark");
    } catch {}
  } else {
    root.classList.remove("high-contrast");
    const schemeValue = theme === "system" ? "light dark" : theme;
    if (meta) meta.content = schemeValue;
    try {
      if (theme === "system") {
        localStorage.removeItem("color-scheme");
      } else {
        localStorage.setItem("color-scheme", theme);
      }
    } catch {}
  }

  if (accentColor) {
    root.style.setProperty("--sym-primary", accentColor);
  }
}
