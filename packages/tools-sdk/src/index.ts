import type { Artifact, ToolManifest } from "@symforyx/core";

/**
 * Lightweight Zod-compatible schema builder for @symforyx/tools-sdk
 * so third-party and built-in tools can author validated inputs cleanly.
 */
export interface SchemaType<T = unknown> {
  parse(val: unknown): T;
  toJsonSchema(): Record<string, unknown>;
}

class StringSchema implements SchemaType<string> {
  private _min?: number;
  private _default?: string;
  private _desc?: string;

  min(n: number) {
    this._min = n;
    return this;
  }
  default(v: string) {
    this._default = v;
    return this;
  }
  describe(d: string) {
    this._desc = d;
    return this;
  }
  parse(val: unknown): string {
    const v = val === undefined ? this._default : val;
    if (typeof v !== "string") throw new Error("Expected string");
    if (this._min !== undefined && v.length < this._min) {
      throw new Error(`String must be at least ${this._min} chars`);
    }
    return v;
  }
  toJsonSchema() {
    return { type: "string", ...(this._desc ? { description: this._desc } : {}), ...(this._default !== undefined ? { default: this._default } : {}) };
  }
}

class NumberSchema implements SchemaType<number> {
  private _int = false;
  private _min?: number;
  private _max?: number;
  private _default?: number;
  private _desc?: string;

  int() {
    this._int = true;
    return this;
  }
  min(n: number) {
    this._min = n;
    return this;
  }
  max(n: number) {
    this._max = n;
    return this;
  }
  default(v: number) {
    this._default = v;
    return this;
  }
  describe(d: string) {
    this._desc = d;
    return this;
  }
  parse(val: unknown): number {
    const raw = val === undefined ? this._default : val;
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (typeof n !== "number" || Number.isNaN(n)) throw new Error("Expected number");
    if (this._int && !Number.isInteger(n)) throw new Error("Expected integer");
    if (this._min !== undefined && n < this._min) throw new Error(`Minimum value is ${this._min}`);
    if (this._max !== undefined && n > this._max) throw new Error(`Maximum value is ${this._max}`);
    return n;
  }
  toJsonSchema() {
    return {
      type: this._int ? "integer" : "number",
      ...(this._min !== undefined ? { minimum: this._min } : {}),
      ...(this._max !== undefined ? { maximum: this._max } : {}),
      ...(this._default !== undefined ? { default: this._default } : {}),
      ...(this._desc ? { description: this._desc } : {}),
    };
  }
}

class ObjectSchema<T extends Record<string, SchemaType>> implements SchemaType<{ [K in keyof T]: ReturnType<T[K]["parse"]> }> {
  constructor(private shape: T) {}
  parse(val: unknown): { [K in keyof T]: ReturnType<T[K]["parse"]> } {
    const obj = (val && typeof val === "object" ? val : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      out[key] = schema.parse(obj[key]);
    }
    return out as { [K in keyof T]: ReturnType<T[K]["parse"]> };
  }
  toJsonSchema() {
    const properties: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(this.shape)) {
      properties[k] = s.toJsonSchema();
    }
    return { type: "object", properties };
  }
}

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  object: <T extends Record<string, SchemaType>>(shape: T) => new ObjectSchema(shape),
};

export interface ToolRunContext {
  threadId?: string;
  projectId: string;
  signal: AbortSignal;
  progress: (message: string) => void;
  artifacts: {
    get: (id: string) => Promise<Artifact | null>;
    create: (input: {
      kind: Artifact["kind"];
      title: string;
      mime: string;
      content: string;
      language?: string;
    }) => Promise<Artifact>;
  };
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  secret: (name: string) => string | undefined;
}

export interface ToolRunResult {
  text?: string;
  json?: unknown;
  image?: { mime: string; base64: string; title?: string };
  artifactIds?: string[];
  untrusted?: boolean;
  isError?: boolean;
}

export interface RegisteredTool<TInput = Record<string, unknown>> {
  id: string;
  manifest: ToolManifest;
  input: SchemaType<TInput>;
  run: (opts: { input: TInput; ctx: ToolRunContext }) => Promise<ToolRunResult>;
}

export function defineTool<TInput>(def: RegisteredTool<TInput>): RegisteredTool<TInput> {
  return def;
}
