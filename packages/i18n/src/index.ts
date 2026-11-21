import tr from "./tr.json";
import en from "./en.json";
import type { LanguageCode } from "@symforyx/core";

export const dictionaries = { tr, en } as const;
export type Dictionary = typeof tr;

export function getDictionary(lang: LanguageCode): Dictionary {
  return dictionaries[lang] ?? dictionaries.tr;
}

export function t(lang: LanguageCode, path: string): string {
  const dict = getDictionary(lang) as Record<string, unknown>;
  const keys = path.split(".");
  let cur: unknown = dict;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in cur) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return path;
    }
  }
  return typeof cur === "string" ? cur : path;
}
