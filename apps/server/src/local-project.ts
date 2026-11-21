import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export interface LocalFileEntry {
  path: string;
  name: string;
  kind: "file" | "dir";
  size: number;
  depth: number;
}

export interface LocalSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface LocalGitStatus {
  isGitRepo: boolean;
  branch: string;
  changedFiles: Array<{ status: string; path: string }>;
  diffStat: string;
}

export interface ShellRunResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AppliedFileResult {
  path: string;
  bytes: number;
  created: boolean;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svelte-kit",
  ".next",
  "dist",
  "build",
  "target",
  ".build",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".turbo",
  "DerivedData",
]);

const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".icns",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".dmg",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".db",
  ".sqlite",
  ".sqlite-wal",
  ".sqlite-shm",
]);

export function resolveSafeProjectPath(rootPath: string, relPath: string): string {
  const absRoot = resolve(rootPath);
  const cleaned = relPath.replace(/^\/+/, "");
  const absTarget = resolve(absRoot, cleaned);
  if (absTarget !== absRoot && !absTarget.startsWith(absRoot + "/")) {
    throw new Error(`Güvenlik: Proje klasörü dışına erişilemez (${relPath})`);
  }
  return absTarget;
}

export function listProjectTree(rootPath: string, maxDepth = 4, maxEntries = 260): LocalFileEntry[] {
  const absRoot = resolve(rootPath);
  if (!existsSync(absRoot)) return [];
  const out: LocalFileEntry[] = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      if (out.length >= maxEntries) break;
      if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
      if (!item.isDirectory() && IGNORED_FILES.has(item.name)) continue;

      const full = join(dir, item.name);
      const rel = relative(absRoot, full);
      if (item.isDirectory()) {
        out.push({ path: rel, name: item.name, kind: "dir", size: 0, depth });
        walk(full, depth + 1);
      } else {
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          // ignore
        }
        out.push({ path: rel, name: item.name, kind: "file", size, depth });
      }
    }
  }

  walk(absRoot, 0);
  return out;
}

export function readProjectFile(
  rootPath: string,
  relPath: string
): { path: string; content: string; size: number; lines: number; truncated: boolean } {
  const abs = resolveSafeProjectPath(rootPath, relPath);
  if (!existsSync(abs)) throw new Error(`Dosya bulunamadı: ${relPath}`);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error(`Bu bir klasör: ${relPath}`);
  const MAX_BYTES = 240_000;
  const raw = readFileSync(abs);
  const truncated = raw.length > MAX_BYTES;
  const content = raw.subarray(0, MAX_BYTES).toString("utf8");
  return {
    path: relative(resolve(rootPath), abs),
    content,
    size: st.size,
    lines: content.split("\n").length,
    truncated,
  };
}

export function writeProjectFile(rootPath: string, relPath: string, content: string): AppliedFileResult {
  const abs = resolveSafeProjectPath(rootPath, relPath);
  const created = !existsSync(abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return {
    path: relative(resolve(rootPath), abs),
    bytes: Buffer.byteLength(content, "utf8"),
    created,
  };
}

export function patchProjectFile(
  rootPath: string,
  relPath: string,
  search: string,
  replace: string
): { path: string; replacedCount: number; bytes: number } {
  const abs = resolveSafeProjectPath(rootPath, relPath);
  if (!existsSync(abs)) throw new Error(`Dosya bulunamadı: ${relPath}`);
  const original = readFileSync(abs, "utf8");
  if (!search || !original.includes(search)) {
    throw new Error(`Aranan blok dosyada bulunamadı: ${relPath}`);
  }
  const parts = original.split(search);
  const replacedCount = parts.length - 1;
  const updated = parts.join(replace);
  writeFileSync(abs, updated, "utf8");
  return {
    path: relative(resolve(rootPath), abs),
    replacedCount,
    bytes: Buffer.byteLength(updated, "utf8"),
  };
}

export function deleteProjectFile(rootPath: string, relPath: string): boolean {
  const abs = resolveSafeProjectPath(rootPath, relPath);
  if (!existsSync(abs)) return false;
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error("Klasör silme desteklenmiyor; yalnızca dosya silinebilir.");
  unlinkSync(abs);
  return true;
}

export function searchProjectText(rootPath: string, query: string, maxMatches = 60): LocalSearchMatch[] {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const entries = listProjectTree(rootPath, 5, 450);
  const matches: LocalSearchMatch[] = [];

  for (const entry of entries) {
    if (entry.kind !== "file" || entry.size > 300_000) continue;
    const dotIdx = entry.name.lastIndexOf(".");
    if (dotIdx >= 0 && BINARY_EXTS.has(entry.name.slice(dotIdx).toLowerCase())) continue;

    try {
      const abs = resolveSafeProjectPath(rootPath, entry.path);
      const text = readFileSync(abs, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lower)) {
          matches.push({ path: entry.path, line: i + 1, text: lines[i].trim().slice(0, 180) });
          if (matches.length >= maxMatches) return matches;
        }
      }
    } catch {
      // skip unreadable file
    }
  }
  return matches;
}

export async function runProjectShell(
  rootPath: string,
  command: string,
  timeoutMs = 25_000
): Promise<ShellRunResult> {
  const absRoot = resolve(rootPath);
  if (!existsSync(absRoot)) throw new Error(`Klasör bulunamadı: ${absRoot}`);
  const start = Date.now();
  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: absRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TERM: "dumb",
      NO_COLOR: "1",
    },
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return {
    command,
    cwd: absRoot,
    exitCode,
    stdout: stdout.slice(0, 32_000),
    stderr: stderr.slice(0, 16_000),
    durationMs: Date.now() - start,
  };
}

export async function getProjectGitStatus(rootPath: string): Promise<LocalGitStatus> {
  const absRoot = resolve(rootPath);
  if (!existsSync(join(absRoot, ".git"))) {
    return { isGitRepo: false, branch: "", changedFiles: [], diffStat: "" };
  }
  const [branchRes, statusRes, statRes] = await Promise.all([
    runProjectShell(absRoot, "git branch --show-current", 5000),
    runProjectShell(absRoot, "git status --short", 5000),
    runProjectShell(absRoot, "git diff --stat", 5000),
  ]);
  const changedFiles = statusRes.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "M",
      path: line.slice(3).trim(),
    }));
  return {
    isGitRepo: true,
    branch: branchRes.stdout.trim() || "main",
    changedFiles,
    diffStat: statRes.stdout.trim(),
  };
}

export async function getProjectGitDiff(rootPath: string, relPath?: string): Promise<string> {
  const absRoot = resolve(rootPath);
  if (!existsSync(join(absRoot, ".git"))) return "Bu klasör bir Git deposu değil.";
  const safeArg = relPath ? ` -- "${resolveSafeProjectPath(absRoot, relPath)}"` : "";
  const res = await runProjectShell(absRoot, `git diff${safeArg}`, 8000);
  return res.stdout.trim() || "Henüz kaydedilmemiş değişiklik yok (clean working tree).";
}

export function initProjectFolder(
  folderPath: string,
  template: "empty" | "typescript" | "web" | "python" | "swift" = "empty"
): { rootPath: string; name: string; createdFiles: string[] } {
  const absRoot = resolve(folderPath);
  mkdirSync(absRoot, { recursive: true });
  const name = basename(absRoot) || "NewProject";
  const createdFiles: string[] = [];

  if (template === "typescript") {
    writeProjectFile(
      absRoot,
      "package.json",
      JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), version: "0.1.0", scripts: { dev: "bun run src/index.ts", test: "bun test" } }, null, 2) + "\n"
    );
    writeProjectFile(absRoot, "src/index.ts", `console.log("Hello from ${name} — built with SYMFORYX Desktop");\n`);
    writeProjectFile(absRoot, "README.md", `# ${name}\n\nCreated inside SYMFORYX Desktop.\n`);
    createdFiles.push("package.json", "src/index.ts", "README.md");
  } else if (template === "web") {
    writeProjectFile(
      absRoot,
      "index.html",
      `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <main class="shell">\n    <h1>${name}</h1>\n    <p>Created from scratch in SYMFORYX Desktop.</p>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n`
    );
    writeProjectFile(
      absRoot,
      "style.css",
      `:root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; }\nbody { margin: 0; padding: 3rem; }\n.shell { max-width: 720px; margin: 0 auto; }\n`
    );
    writeProjectFile(absRoot, "app.js", `console.log("${name} ready");\n`);
    createdFiles.push("index.html", "style.css", "app.js");
  } else if (template === "python") {
    writeProjectFile(absRoot, "main.py", `def main() -> None:\n    print("Hello from ${name}")\n\nif __name__ == "__main__":\n    main()\n`);
    writeProjectFile(absRoot, "README.md", `# ${name}\n`);
    createdFiles.push("main.py", "README.md");
  } else if (template === "swift") {
    writeProjectFile(absRoot, "main.swift", `import Foundation\nprint("Hello from ${name}")\n`);
    createdFiles.push("main.swift");
  }

  return { rootPath: absRoot, name, createdFiles };
}

/**
 * Extracts file-annotated fenced code blocks from model output and writes them safely to disk.
 * Supports:
 *   ```ts:src/app.ts
 *   ```typescript src/app.ts
 *   ```html filename="index.html"
 *   or first-line comment: `// file: src/app.ts` / `# file: main.py` / `<!-- file: index.html -->`
 */
export function extractFileEditsFromMarkdown(markdown: string): Array<{ path: string; language: string; content: string }> {
  const edits: Array<{ path: string; language: string; content: string }> = [];
  const regex = /```([^\n]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const header = (match[1] ?? "").trim();
    let content = match[2] ?? "";
    let filePath = "";
    let language = "text";

    // Case 1: ```lang:path/to/file.ext
    const colonMatch = header.match(/^([a-zA-Z0-9_+-]+):([^\s]+)$/);
    if (colonMatch) {
      language = colonMatch[1];
      filePath = colonMatch[2];
    } else {
      // Case 2: ```lang filename="path" or ```lang path/to/file.ext
      const attrMatch = header.match(/^([a-zA-Z0-9_+-]*)\s+(?:file|filename|path)=["']?([^"'\s]+)["']?/i);
      if (attrMatch) {
        language = attrMatch[1] || "text";
        filePath = attrMatch[2];
      } else {
        const spaceParts = header.split(/\s+/).filter(Boolean);
        if (spaceParts.length >= 2 && /[./]/.test(spaceParts[1])) {
          language = spaceParts[0];
          filePath = spaceParts[1];
        } else if (spaceParts.length === 1) {
          language = spaceParts[0];
        }
      }
    }

    // Case 3: First line comment declares file path: `// file: src/foo.ts` or `# file: app.py`
    if (!filePath) {
      const firstLine = content.split("\n")[0]?.trim() ?? "";
      const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*(?:file|path):\s*([^\s*<>]+)\s*(?:\*\/|-->)?$/i);
      if (commentMatch) {
        filePath = commentMatch[1];
        content = content.split("\n").slice(1).join("\n");
      }
    }

    if (filePath && !filePath.startsWith("http") && !filePath.includes("..")) {
      edits.push({ path: filePath.replace(/^\.\//, ""), language, content });
    }
  }
  return edits;
}

export function applyMarkdownEditsToProject(rootPath: string, markdown: string): AppliedFileResult[] {
  const edits = extractFileEditsFromMarkdown(markdown);
  const applied: AppliedFileResult[] = [];
  for (const edit of edits) {
    applied.push(writeProjectFile(rootPath, edit.path, edit.content));
  }
  return applied;
}

export function buildLocalProjectContextPrompt(rootPath: string, git?: LocalGitStatus): string {
  const entries = listProjectTree(rootPath, 3, 90);
  const treeLines = entries.map((e) => `${"  ".repeat(e.depth)}${e.kind === "dir" ? "📁" : "·"} ${e.path}`);
  return [
    `[LOCAL MACOS PROJECT ATTACHED: ${rootPath}]`,
    git?.isGitRepo
      ? `Git Branch: ${git.branch} · Changed files: ${git.changedFiles.length > 0 ? git.changedFiles.slice(0, 12).map((c) => `${c.status} ${c.path}`).join(", ") : "clean"}`
      : "Git: not initialized",
    "Directory Structure:",
    treeLines.length > 0 ? treeLines.join("\n") : "(empty directory — ready to build from scratch)",
    "",
    "CLAUDE-CODE WORKSPACE FILE-EDIT PROTOCOL:",
    "- You are working directly inside the user's real local project directory on macOS.",
    "- Whenever you create or modify a file, ALWAYS put the exact relative file path on the code fence header as ```<lang>:<relative/path> (for example ```ts:src/app.ts or ```html:index.html) with complete, production-ready code so SYMFORYX Desktop can apply it straight to disk.",
  ].join("\n");
}
