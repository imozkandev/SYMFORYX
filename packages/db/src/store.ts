import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createId,
  DEFAULT_TASK_ROLES,
  DEFAULT_USER_SETTINGS,
  type Artifact,
  type ArtifactVersion,
  type AuditLogEntry,
  type Budget,
  type FlowDefinition,
  type FlowRun,
  type MemoryItem,
  type MessagePart,
  type PermissionPolicy,
  type Project,
  type ProjectFile,
  type ProviderConfig,
  type QuotaConfig,
  type QuotaResetInterval,
  type QuotaStatus,
  type SymMessage,
  type TaskRole,
  type Thread,
  type ToolManifest,
  type UsageRecord,
  type UserSettings,
  type WebhookConfig,
  type Workspace,
} from "@symforyx/core";
import { SCHEMA_SQL } from "./schema.ts";
import { KeyVault } from "./vault.ts";

export class SymforyxDB {
  readonly db: Database;
  readonly vault: KeyVault;

  constructor(opts?: { dbPath?: string; secret?: string; dataDir?: string }) {
    const dbPath = opts?.dbPath ?? process.env.SYMFORYX_DB_PATH ?? "./data/symforyx.db";
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.vault = new KeyVault({ secret: opts?.secret, dataDir: opts?.dataDir });
    this.db.exec(SCHEMA_SQL);
    this.seedDefaults();
  }

  private seedDefaults() {
    const now = new Date().toISOString();
    const ws = this.db.query("SELECT id FROM workspaces LIMIT 1").get() as { id: string } | null;
    if (!ws) {
      const wsId = "ws_default";
      this.db
        .query("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)")
        .run(wsId, "Kişisel Çalışma Alanı", now);

      const projId = "proj_default";
      this.db
        .query(
          `INSERT INTO projects (id, workspace_id, name, description, instructions, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          projId,
          wsId,
          "Genel Çalışma Alanı",
          "Çoklu model ve araç denemeleri için varsayılan proje",
          "Türkçe, net ve uygulanabilir yanıtlar üret. Kod üretirken temiz ve modern yapı kullan.",
          now,
          now
        );

      const threadId = "thr_welcome";
      this.db
        .query(
          `INSERT INTO threads (id, project_id, title, mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(threadId, projId, "Yeni Sohbet", "smart", now, now);
    }

    // Seed default roles if empty
    const roleCount = (
      this.db.query("SELECT COUNT(*) as c FROM task_roles WHERE project_id = ''").get() as {
        c: number;
      }
    ).c;
    if (roleCount === 0) {
      for (const role of DEFAULT_TASK_ROLES) {
        this.upsertRole(role);
      }
    }

    // Seed default settings if missing
    const existingSettings = this.db
      .query("SELECT value_json FROM settings WHERE key = 'user_settings'")
      .get();
    if (!existingSettings) {
      this.db
        .query("INSERT INTO settings (key, value_json, updated_at) VALUES ('user_settings', ?, ?)")
        .run(JSON.stringify(DEFAULT_USER_SETTINGS), now);
    }
  }

  // ==================== WORKSPACES & PROJECTS ====================

  listWorkspaces(): Workspace[] {
    const rows = this.db.query("SELECT id, name, created_at FROM workspaces ORDER BY created_at").all() as Array<{
      id: string;
      name: string;
      created_at: string;
    }>;
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  createWorkspace(name: string): Workspace {
    const id = createId("ws");
    const now = new Date().toISOString();
    this.db.query("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(id, name, now);
    this.logAudit("user", "workspace.create", id, { name });
    return { id, name, createdAt: now };
  }

  deleteWorkspace(id: string): boolean {
    const projRows = this.db.query("SELECT id FROM projects WHERE workspace_id = ?").all(id) as Array<{ id: string }>;
    for (const p of projRows) {
      this.deleteProject(p.id);
    }
    const res = this.db.query("DELETE FROM workspaces WHERE id = ?").run(id);
    if (res.changes > 0) this.logAudit("user", "workspace.delete", id);
    return res.changes > 0;
  }

  listProjects(workspaceId?: string): Project[] {
    if (workspaceId) {
      const rows = this.db
        .query("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC")
        .all(workspaceId) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapProject(r));
    }
    const rows = this.db
      .query("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapProject(r));
  }

  getProject(id: string): Project | null {
    const row = this.db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.mapProject(row) : null;
  }

  createProject(input: {
    name: string;
    description?: string;
    instructions?: string;
    isPrivate?: boolean;
    allowedProviders?: string[];
    workspaceId?: string;
  }): Project {
    const id = createId("proj");
    const now = new Date().toISOString();
    let wsId = input.workspaceId;
    if (!wsId) {
      const existingWs = this.db.query("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string } | null;
      wsId = existingWs?.id ?? this.createWorkspace("Kişisel Çalışma Alanı").id;
    }
    this.db
      .query(
        `INSERT INTO projects (id, workspace_id, name, description, instructions, is_private, allowed_providers, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        wsId,
        input.name,
        input.description ?? "",
        input.instructions ?? "",
        input.isPrivate ? 1 : 0,
        JSON.stringify(input.allowedProviders ?? []),
        now,
        now
      );
    this.logAudit("user", "project.create", id, { name: input.name });
    return this.getProject(id)!;
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, "name" | "description" | "instructions" | "isPrivate" | "allowedProviders">>
  ): Project | null {
    const cur = this.getProject(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE projects SET name = ?, description = ?, instructions = ?, is_private = ?, allowed_providers = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        patch.name ?? cur.name,
        patch.description ?? cur.description ?? "",
        patch.instructions ?? cur.instructions ?? "",
        (patch.isPrivate ?? cur.isPrivate) ? 1 : 0,
        JSON.stringify(patch.allowedProviders ?? cur.allowedProviders ?? []),
        now,
        id
      );
    return this.getProject(id);
  }

  deleteProject(id: string): boolean {
    const threadRows = this.db.query("SELECT id FROM threads WHERE project_id = ?").all(id) as Array<{ id: string }>;
    for (const t of threadRows) {
      this.db.query("DELETE FROM messages_fts WHERE thread_id = ?").run(t.id);
    }
    this.db.query("DELETE FROM project_files_fts WHERE project_id = ?").run(id);
    this.db.query("DELETE FROM artifacts WHERE project_id = ?").run(id);
    this.db.query("DELETE FROM memories WHERE project_id = ?").run(id);
    this.db.query("DELETE FROM flow_runs WHERE project_id = ?").run(id);
    const res = this.db.query("DELETE FROM projects WHERE id = ?").run(id);
    if (res.changes > 0) this.logAudit("user", "project.delete", id);
    return res.changes > 0;
  }

  private mapProject(r: Record<string, unknown>): Project {
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      name: String(r.name),
      description: String(r.description ?? ""),
      instructions: String(r.instructions ?? ""),
      isPrivate: Boolean(r.is_private),
      allowedProviders: JSON.parse(String(r.allowed_providers ?? "[]")),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ==================== THREADS ====================

  listThreads(projectId?: string, includeDeleted = false): Thread[] {
    let sql = "SELECT * FROM threads WHERE 1=1";
    const params: unknown[] = [];
    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (!includeDeleted) {
      sql += " AND deleted_at IS NULL";
    }
    sql += " ORDER BY updated_at DESC";
    const rows = this.db.query(sql).all(...(params as [string])) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapThread(r));
  }

  getThread(id: string): Thread | null {
    const row = this.db.query("SELECT * FROM threads WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.mapThread(row) : null;
  }

  createThread(input: { projectId: string; title?: string; mode?: Thread["mode"] }): Thread {
    const id = createId("thr");
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO threads (id, project_id, title, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.title ?? "Yeni Sohbet", input.mode ?? "smart", now, now);
    return this.getThread(id)!;
  }

  updateThread(
    id: string,
    patch: Partial<
      Pick<
        Thread,
        "title" | "mode" | "pinnedModelId" | "pinnedProviderId" | "activeBranchHeadId" | "draftText" | "deletedAt"
      >
    >
  ): Thread | null {
    const cur = this.getThread(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE threads SET
           title = ?, mode = ?, pinned_model_id = ?, pinned_provider_id = ?,
           active_branch_head_id = ?, draft_text = ?, deleted_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.title ?? cur.title,
        patch.mode ?? cur.mode,
        patch.pinnedModelId !== undefined ? patch.pinnedModelId : cur.pinnedModelId ?? null,
        patch.pinnedProviderId !== undefined ? patch.pinnedProviderId : cur.pinnedProviderId ?? null,
        patch.activeBranchHeadId !== undefined ? patch.activeBranchHeadId : cur.activeBranchHeadId ?? null,
        patch.draftText !== undefined ? patch.draftText : cur.draftText ?? "",
        patch.deletedAt !== undefined ? patch.deletedAt : cur.deletedAt ?? null,
        now,
        id
      );
    return this.getThread(id);
  }

  softDeleteThread(id: string): boolean {
    const res = this.db
      .query("UPDATE threads SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), id);
    return res.changes > 0;
  }

  restoreThread(id: string): boolean {
    const res = this.db
      .query("UPDATE threads SET deleted_at = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return res.changes > 0;
  }

  private mapThread(r: Record<string, unknown>): Thread {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      title: String(r.title),
      mode: String(r.mode) as Thread["mode"],
      pinnedModelId: r.pinned_model_id ? String(r.pinned_model_id) : null,
      pinnedProviderId: r.pinned_provider_id ? String(r.pinned_provider_id) : null,
      activeBranchHeadId: r.active_branch_head_id ? String(r.active_branch_head_id) : null,
      draftText: String(r.draft_text ?? ""),
      deletedAt: r.deleted_at ? String(r.deleted_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ==================== MESSAGES ====================

  listMessages(threadId: string): SymMessage[] {
    const rows = this.db
      .query("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(threadId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapMessage(r));
  }

  getMessage(id: string): SymMessage | null {
    const row = this.db.query("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.mapMessage(row) : null;
  }

  addMessage(msg: Omit<SymMessage, "id" | "createdAt"> & { id?: string; createdAt?: string }): SymMessage {
    const id = msg.id ?? createId("msg");
    const createdAt = msg.createdAt ?? new Date().toISOString();
    const plainText = extractPlainText(msg.parts);

    this.db
      .query(
        `INSERT INTO messages (
          id, thread_id, parent_id, branch_id, version_index, role,
          author_json, parts_json, artifacts_json, usage_json,
          pinned, compare_group_id, selected_compare, plain_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        msg.threadId,
        msg.parentId ?? null,
        msg.branchId ?? null,
        msg.versionIndex ?? 0,
        msg.role,
        JSON.stringify(msg.author),
        JSON.stringify(msg.parts),
        JSON.stringify(msg.artifacts ?? []),
        msg.usage ? JSON.stringify(msg.usage) : null,
        msg.pinned ? 1 : 0,
        msg.compareGroupId ?? null,
        msg.selectedCompare ? 1 : 0,
        plainText,
        createdAt
      );

    if (plainText) {
      this.db
        .query("INSERT INTO messages_fts (message_id, thread_id, plain_text) VALUES (?, ?, ?)")
        .run(id, msg.threadId, plainText);
    }

    this.db
      .query("UPDATE threads SET updated_at = ?, active_branch_head_id = ? WHERE id = ?")
      .run(createdAt, id, msg.threadId);

    return this.getMessage(id)!;
  }

  updateMessage(
    id: string,
    patch: Partial<Pick<SymMessage, "parts" | "artifacts" | "usage" | "pinned" | "selectedCompare">>
  ): SymMessage | null {
    const cur = this.getMessage(id);
    if (!cur) return null;
    const parts = patch.parts ?? cur.parts;
    const plainText = extractPlainText(parts);
    this.db
      .query(
        `UPDATE messages SET parts_json = ?, artifacts_json = ?, usage_json = ?, pinned = ?, selected_compare = ?, plain_text = ? WHERE id = ?`
      )
      .run(
        JSON.stringify(parts),
        JSON.stringify(patch.artifacts ?? cur.artifacts ?? []),
        patch.usage !== undefined ? JSON.stringify(patch.usage) : cur.usage ? JSON.stringify(cur.usage) : null,
        (patch.pinned ?? cur.pinned) ? 1 : 0,
        (patch.selectedCompare ?? cur.selectedCompare) ? 1 : 0,
        plainText,
        id
      );

    this.db.query("DELETE FROM messages_fts WHERE message_id = ?").run(id);
    if (plainText) {
      this.db
        .query("INSERT INTO messages_fts (message_id, thread_id, plain_text) VALUES (?, ?, ?)")
        .run(id, cur.threadId, plainText);
    }

    return this.getMessage(id);
  }

  selectCompareWinner(threadId: string, compareGroupId: string, winnerMessageId: string): void {
    this.db
      .query("UPDATE messages SET selected_compare = 0 WHERE thread_id = ? AND compare_group_id = ?")
      .run(threadId, compareGroupId);
    this.db
      .query("UPDATE messages SET selected_compare = 1 WHERE id = ?")
      .run(winnerMessageId);
    this.db
      .query("UPDATE threads SET active_branch_head_id = ?, updated_at = ? WHERE id = ?")
      .run(winnerMessageId, new Date().toISOString(), threadId);
  }

  deleteMessage(id: string): boolean {
    this.db.query("DELETE FROM messages_fts WHERE message_id = ?").run(id);
    const res = this.db.query("DELETE FROM messages WHERE id = ?").run(id);
    return res.changes > 0;
  }

  searchMessages(query: string, limit = 30): Array<{ messageId: string; threadId: string; snippet: string }> {
    const clean = query.replace(/['"*]/g, " ").trim();
    if (!clean) return [];
    try {
      const rows = this.db
        .query(
          `SELECT message_id, thread_id, snippet(messages_fts, 2, '<mark>', '</mark>', '…', 20) as snippet
           FROM messages_fts WHERE messages_fts MATCH ? LIMIT ?`
        )
        .all(clean + "*", limit) as Array<{ message_id: string; thread_id: string; snippet: string }>;
      return rows.map((r) => ({
        messageId: r.message_id,
        threadId: r.thread_id,
        snippet: r.snippet,
      }));
    } catch {
      const rows = this.db
        .query("SELECT id, thread_id, substr(plain_text, 1, 160) as snippet FROM messages WHERE plain_text LIKE ? LIMIT ?")
        .all(`%${clean}%`, limit) as Array<{ id: string; thread_id: string; snippet: string }>;
      return rows.map((r) => ({ messageId: r.id, threadId: r.thread_id, snippet: r.snippet }));
    }
  }

  private mapMessage(r: Record<string, unknown>): SymMessage {
    return {
      id: String(r.id),
      threadId: String(r.thread_id),
      parentId: r.parent_id ? String(r.parent_id) : null,
      branchId: r.branch_id ? String(r.branch_id) : undefined,
      versionIndex: Number(r.version_index ?? 0),
      role: String(r.role) as SymMessage["role"],
      author: JSON.parse(String(r.author_json)),
      parts: JSON.parse(String(r.parts_json)),
      artifacts: JSON.parse(String(r.artifacts_json ?? "[]")),
      usage: r.usage_json ? JSON.parse(String(r.usage_json)) : undefined,
      pinned: Boolean(r.pinned),
      compareGroupId: r.compare_group_id ? String(r.compare_group_id) : undefined,
      selectedCompare: Boolean(r.selected_compare),
      createdAt: String(r.created_at),
    };
  }

  // ==================== ARTIFACTS ====================

  listArtifacts(filter?: { threadId?: string; projectId?: string }): Artifact[] {
    let sql = "SELECT * FROM artifacts WHERE 1=1";
    const params: string[] = [];
    if (filter?.threadId) {
      sql += " AND thread_id = ?";
      params.push(filter.threadId);
    }
    if (filter?.projectId) {
      sql += " AND project_id = ?";
      params.push(filter.projectId);
    }
    sql += " ORDER BY updated_at DESC";
    const rows = this.db.query(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapArtifact(r));
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.query("SELECT * FROM artifacts WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.mapArtifact(row) : null;
  }

  createArtifact(input: {
    threadId: string;
    projectId: string;
    messageId?: string;
    kind: Artifact["kind"];
    title: string;
    mime: string;
    language?: string;
    content: string;
    files?: ArtifactVersion["files"];
    note?: string;
  }): Artifact {
    const id = createId("art");
    const now = new Date().toISOString();
    const versions: ArtifactVersion[] = [
      {
        version: 1,
        content: input.content,
        files: input.files,
        mime: input.mime,
        note: input.note ?? "İlk sürüm",
        createdAt: now,
      },
    ];
    this.db
      .query(
        `INSERT INTO artifacts (id, thread_id, project_id, message_id, kind, title, mime, language, current_version, versions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        input.threadId,
        input.projectId,
        input.messageId ?? null,
        input.kind,
        input.title,
        input.mime,
        input.language ?? null,
        JSON.stringify(versions),
        now,
        now
      );
    return this.getArtifact(id)!;
  }

  addArtifactVersion(
    id: string,
    update: { content: string; files?: ArtifactVersion["files"]; mime?: string; note?: string; title?: string }
  ): Artifact | null {
    const cur = this.getArtifact(id);
    if (!cur) return null;
    const now = new Date().toISOString();
    const nextVersion = cur.versions.length + 1;
    const versions: ArtifactVersion[] = [
      ...cur.versions,
      {
        version: nextVersion,
        content: update.content,
        files: update.files,
        mime: update.mime ?? cur.mime,
        note: update.note ?? `v${nextVersion}`,
        createdAt: now,
      },
    ];
    this.db
      .query(
        `UPDATE artifacts SET title = ?, current_version = ?, versions_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(update.title ?? cur.title, nextVersion, JSON.stringify(versions), now, id);
    return this.getArtifact(id);
  }

  setArtifactCurrentVersion(id: string, version: number): Artifact | null {
    const cur = this.getArtifact(id);
    if (!cur || version < 1 || version > cur.versions.length) return null;
    this.db
      .query("UPDATE artifacts SET current_version = ?, updated_at = ? WHERE id = ?")
      .run(version, new Date().toISOString(), id);
    return this.getArtifact(id);
  }

  private mapArtifact(r: Record<string, unknown>): Artifact {
    return {
      id: String(r.id),
      threadId: String(r.thread_id),
      projectId: String(r.project_id),
      messageId: r.message_id ? String(r.message_id) : undefined,
      kind: String(r.kind) as Artifact["kind"],
      title: String(r.title),
      mime: String(r.mime),
      language: r.language ? String(r.language) : undefined,
      currentVersion: Number(r.current_version ?? 1),
      versions: JSON.parse(String(r.versions_json)),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ==================== PROVIDERS & KEYS ====================

  listProviders(): ProviderConfig[] {
    const rows = this.db.query("SELECT * FROM providers ORDER BY id ASC").all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapProvider(r));
  }

  getProvider(id: string): ProviderConfig | null {
    const row = this.db.query("SELECT * FROM providers WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? this.mapProvider(row) : null;
  }

  upsertProvider(
    config: Omit<ProviderConfig, "hasKey" | "maskedKey"> & { apiKey?: string }
  ): ProviderConfig {
    const existing = this.db
      .query("SELECT encrypted_key, masked_key FROM providers WHERE id = ?")
      .get(config.id) as { encrypted_key: string | null; masked_key: string | null } | null;

    let encryptedKey = existing?.encrypted_key ?? null;
    let maskedKey = existing?.masked_key ?? null;

    if (config.apiKey !== undefined) {
      if (config.apiKey === "") {
        encryptedKey = null;
        maskedKey = null;
      } else {
        encryptedKey = this.vault.encrypt(config.apiKey);
        maskedKey = this.vault.mask(config.apiKey);
      }
    }

    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO providers (id, type, display_name, auth, base_url, alias, badge_color, badge_letter, enabled, encrypted_key, masked_key, models_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           display_name = excluded.display_name,
           auth = excluded.auth,
           base_url = excluded.base_url,
           alias = excluded.alias,
           badge_color = excluded.badge_color,
           badge_letter = excluded.badge_letter,
           enabled = excluded.enabled,
           encrypted_key = excluded.encrypted_key,
           masked_key = excluded.masked_key,
           models_json = excluded.models_json,
           updated_at = excluded.updated_at`
      )
      .run(
        config.id,
        config.type,
        config.displayName,
        config.auth,
        config.baseUrl ?? null,
        config.alias ?? null,
        config.badgeColor,
        config.badgeLetter,
        config.enabled ? 1 : 0,
        encryptedKey,
        maskedKey,
        JSON.stringify(config.models),
        now
      );

    if (config.apiKey) {
      this.logAudit("user", "provider.key_set", config.id);
    }

    return this.getProvider(config.id)!;
  }

  getDecryptedProviderKey(providerId: string): string | undefined {
    const row = this.db
      .query("SELECT encrypted_key FROM providers WHERE id = ?")
      .get(providerId) as { encrypted_key: string | null } | null;
    if (!row?.encrypted_key) return undefined;
    try {
      return this.vault.decrypt(row.encrypted_key);
    } catch {
      return undefined;
    }
  }

  private mapProvider(r: Record<string, unknown>): ProviderConfig {
    return {
      id: String(r.id),
      type: String(r.type) as ProviderConfig["type"],
      displayName: String(r.display_name),
      auth: String(r.auth) as ProviderConfig["auth"],
      baseUrl: r.base_url ? String(r.base_url) : undefined,
      alias: r.alias ? String(r.alias) : undefined,
      badgeColor: String(r.badge_color),
      badgeLetter: String(r.badge_letter),
      enabled: Boolean(r.enabled),
      hasKey: Boolean(r.encrypted_key),
      maskedKey: r.masked_key ? String(r.masked_key) : undefined,
      models: JSON.parse(String(r.models_json ?? "[]")),
    };
  }

  // ==================== TASK ROLES ====================

  listRoles(projectId?: string): TaskRole[] {
    const globalRows = this.db
      .query("SELECT data_json FROM task_roles WHERE project_id = ''")
      .all() as Array<{ data_json: string }>;
    const map = new Map<string, TaskRole>();
    for (const r of globalRows) {
      const role = JSON.parse(r.data_json) as TaskRole;
      map.set(role.id, role);
    }
    if (projectId) {
      const projRows = this.db
        .query("SELECT data_json FROM task_roles WHERE project_id = ?")
        .all(projectId) as Array<{ data_json: string }>;
      for (const r of projRows) {
        const role = JSON.parse(r.data_json) as TaskRole;
        map.set(role.id, role);
      }
    }
    return Array.from(map.values());
  }

  upsertRole(role: TaskRole): TaskRole {
    const now = new Date().toISOString();
    const projectId = role.projectId ?? "";
    this.db
      .query(
        `INSERT INTO task_roles (id, project_id, data_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id, project_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
      )
      .run(role.id, projectId, JSON.stringify(role), now);
    return role;
  }

  deleteRole(id: string, projectId = ""): boolean {
    const res = this.db
      .query("DELETE FROM task_roles WHERE id = ? AND project_id = ?")
      .run(id, projectId);
    return res.changes > 0;
  }

  // ==================== TOOLS & PERMISSIONS ====================

  listTools(): ToolManifest[] {
    const rows = this.db.query("SELECT * FROM tools ORDER BY id ASC").all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const manifest = JSON.parse(String(r.manifest_json)) as ToolManifest;
      return {
        ...manifest,
        installed: Boolean(r.installed),
        enabled: Boolean(r.enabled),
        policy: String(r.policy) as PermissionPolicy,
      };
    });
  }

  getTool(id: string): ToolManifest | null {
    const r = this.db.query("SELECT * FROM tools WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;
    const manifest = JSON.parse(String(r.manifest_json)) as ToolManifest;
    return {
      ...manifest,
      installed: Boolean(r.installed),
      enabled: Boolean(r.enabled),
      policy: String(r.policy) as PermissionPolicy,
    };
  }

  upsertTool(manifest: ToolManifest, secrets?: Record<string, string>): ToolManifest {
    const now = new Date().toISOString();
    const existing = this.db
      .query("SELECT encrypted_secrets_json FROM tools WHERE id = ?")
      .get(manifest.id) as { encrypted_secrets_json: string } | null;

    let encSecrets: Record<string, string> = existing ? JSON.parse(existing.encrypted_secrets_json || "{}") : {};
    if (secrets) {
      for (const [k, v] of Object.entries(secrets)) {
        encSecrets[k] = this.vault.encrypt(v);
      }
    }

    this.db
      .query(
        `INSERT INTO tools (id, manifest_json, installed, enabled, policy, encrypted_secrets_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           manifest_json = excluded.manifest_json,
           installed = excluded.installed,
           enabled = excluded.enabled,
           policy = excluded.policy,
           encrypted_secrets_json = excluded.encrypted_secrets_json,
           updated_at = excluded.updated_at`
      )
      .run(
        manifest.id,
        JSON.stringify(manifest),
        manifest.installed ? 1 : 0,
        manifest.enabled !== false ? 1 : 0,
        manifest.policy ?? (manifest.permissions.writes_external ? "ask_every_time" : "allow_project"),
        JSON.stringify(encSecrets),
        now
      );

    return this.getTool(manifest.id)!;
  }

  getToolSecret(toolId: string, secretName: string): string | undefined {
    const row = this.db
      .query("SELECT encrypted_secrets_json FROM tools WHERE id = ?")
      .get(toolId) as { encrypted_secrets_json: string } | null;
    if (!row) return undefined;
    const map = JSON.parse(row.encrypted_secrets_json || "{}") as Record<string, string>;
    if (!map[secretName]) return undefined;
    try {
      return this.vault.decrypt(map[secretName]);
    } catch {
      return undefined;
    }
  }

  setToolPermission(toolId: string, scope: "thread" | "project" | "global", scopeId: string, policy: PermissionPolicy) {
    const id = `${toolId}:${scope}:${scopeId}`;
    this.db
      .query(
        `INSERT INTO tool_permissions (id, tool_id, scope, scope_id, policy, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET policy = excluded.policy`
      )
      .run(id, toolId, scope, scopeId, policy, new Date().toISOString());
    if (scope === "global") {
      this.db.query("UPDATE tools SET policy = ? WHERE id = ?").run(policy, toolId);
    }
  }

  getEffectiveToolPolicy(toolId: string, threadId?: string, projectId?: string): PermissionPolicy {
    if (threadId) {
      const r = this.db
        .query("SELECT policy FROM tool_permissions WHERE id = ?")
        .get(`${toolId}:thread:${threadId}`) as { policy: PermissionPolicy } | null;
      if (r) return r.policy;
    }
    if (projectId) {
      const r = this.db
        .query("SELECT policy FROM tool_permissions WHERE id = ?")
        .get(`${toolId}:project:${projectId}`) as { policy: PermissionPolicy } | null;
      if (r) return r.policy;
    }
    const tool = this.getTool(toolId);
    return tool?.policy ?? "ask_every_time";
  }

  // ==================== FLOWS & FLOW RUNS ====================

  listFlows(): FlowDefinition[] {
    const rows = this.db.query("SELECT * FROM flows ORDER BY is_template DESC, updated_at DESC").all() as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      ...(JSON.parse(String(r.definition_json)) as FlowDefinition),
      yamlSource: String(r.yaml_source ?? ""),
      isTemplate: Boolean(r.is_template),
    }));
  }

  getFlow(id: string): FlowDefinition | null {
    const r = this.db.query("SELECT * FROM flows WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;
    return {
      ...(JSON.parse(String(r.definition_json)) as FlowDefinition),
      yamlSource: String(r.yaml_source ?? ""),
      isTemplate: Boolean(r.is_template),
    };
  }

  upsertFlow(flow: FlowDefinition): FlowDefinition {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO flows (id, name, description, category, definition_json, yaml_source, is_template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           category = excluded.category,
           definition_json = excluded.definition_json,
           yaml_source = excluded.yaml_source,
           is_template = excluded.is_template,
           updated_at = excluded.updated_at`
      )
      .run(
        flow.id,
        flow.name,
        flow.description ?? "",
        flow.category ?? "custom",
        JSON.stringify(flow),
        flow.yamlSource ?? "",
        flow.isTemplate ? 1 : 0,
        now,
        now
      );
    return this.getFlow(flow.id)!;
  }

  deleteFlow(id: string): boolean {
    return this.db.query("DELETE FROM flows WHERE id = ?").run(id).changes > 0;
  }

  saveFlowRun(run: FlowRun): FlowRun {
    this.db
      .query(
        `INSERT INTO flow_runs (id, flow_id, flow_name, thread_id, project_id, status, inputs_json, step_states_json, current_step_index, total_cost_usd, outputs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           step_states_json = excluded.step_states_json,
           current_step_index = excluded.current_step_index,
           total_cost_usd = excluded.total_cost_usd,
           outputs_json = excluded.outputs_json,
           updated_at = excluded.updated_at`
      )
      .run(
        run.id,
        run.flowId,
        run.flowName,
        run.threadId ?? null,
        run.projectId,
        run.status,
        JSON.stringify(run.inputs),
        JSON.stringify(run.stepStates),
        run.currentStepIndex,
        run.totalCostUsd,
        JSON.stringify(run.outputs),
        run.createdAt,
        run.updatedAt
      );
    return run;
  }

  getFlowRun(id: string): FlowRun | null {
    const r = this.db.query("SELECT * FROM flow_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return r ? this.mapFlowRun(r) : null;
  }

  listFlowRuns(projectId?: string, limit = 30): FlowRun[] {
    const sql = projectId
      ? "SELECT * FROM flow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM flow_runs ORDER BY created_at DESC LIMIT ?";
    const rows = (
      projectId ? this.db.query(sql).all(projectId, limit) : this.db.query(sql).all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapFlowRun(r));
  }

  private mapFlowRun(r: Record<string, unknown>): FlowRun {
    return {
      id: String(r.id),
      flowId: String(r.flow_id),
      flowName: String(r.flow_name),
      threadId: r.thread_id ? String(r.thread_id) : undefined,
      projectId: String(r.project_id),
      status: String(r.status) as FlowRun["status"],
      inputs: JSON.parse(String(r.inputs_json)),
      stepStates: JSON.parse(String(r.step_states_json)),
      currentStepIndex: Number(r.current_step_index),
      totalCostUsd: Number(r.total_cost_usd),
      outputs: JSON.parse(String(r.outputs_json)),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ==================== MEMORIES & PROJECT FILES ====================

  listMemories(filter?: { scope?: "project" | "personal"; projectId?: string }): MemoryItem[] {
    let sql = "SELECT * FROM memories WHERE 1=1";
    const params: string[] = [];
    if (filter?.scope) {
      sql += " AND scope = ?";
      params.push(filter.scope);
    }
    if (filter?.projectId) {
      sql += " AND project_id = ?";
      params.push(filter.projectId);
    }
    sql += " ORDER BY created_at DESC";
    const rows = this.db.query(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      scope: String(r.scope) as MemoryItem["scope"],
      projectId: r.project_id ? String(r.project_id) : null,
      content: String(r.content),
      sourceMessageId: r.source_message_id ? String(r.source_message_id) : null,
      approved: Boolean(r.approved),
      createdAt: String(r.created_at),
    }));
  }

  addMemory(input: {
    scope: "project" | "personal";
    projectId?: string | null;
    content: string;
    sourceMessageId?: string | null;
    approved?: boolean;
  }): MemoryItem {
    const id = createId("mem");
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO memories (id, scope, project_id, content, source_message_id, approved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scope,
        input.projectId ?? null,
        input.content,
        input.sourceMessageId ?? null,
        input.approved !== false ? 1 : 0,
        createdAt
      );
    return {
      id,
      scope: input.scope,
      projectId: input.projectId ?? null,
      content: input.content,
      sourceMessageId: input.sourceMessageId ?? null,
      approved: input.approved !== false,
      createdAt,
    };
  }

  updateMemory(id: string, patch: { content?: string; approved?: boolean }): boolean {
    const row = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return false;
    this.db
      .query("UPDATE memories SET content = ?, approved = ? WHERE id = ?")
      .run(patch.content ?? String(row.content), (patch.approved ?? Boolean(row.approved)) ? 1 : 0, id);
    return true;
  }

  deleteMemory(id: string): boolean {
    return this.db.query("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  }

  listProjectFiles(projectId: string): ProjectFile[] {
    const rows = this.db
      .query("SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      mime: String(r.mime),
      size: Number(r.size),
      contentText: String(r.content_text),
      artifactId: r.artifact_id ? String(r.artifact_id) : undefined,
      createdAt: String(r.created_at),
    }));
  }

  addProjectFile(input: Omit<ProjectFile, "id" | "createdAt">): ProjectFile {
    const id = createId("file");
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO project_files (id, project_id, name, mime, size, content_text, artifact_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.name, input.mime, input.size, input.contentText, input.artifactId ?? null, createdAt);
    this.db
      .query("INSERT INTO project_files_fts (file_id, project_id, name, content_text) VALUES (?, ?, ?, ?)")
      .run(id, input.projectId, input.name, input.contentText);
    return { ...input, id, createdAt };
  }

  searchProjectFiles(projectId: string, query: string, limit = 5): Array<{ fileId: string; name: string; snippet: string }> {
    const clean = query.replace(/['"*]/g, " ").trim();
    if (!clean) return [];
    try {
      const rows = this.db
        .query(
          `SELECT file_id, name, snippet(project_files_fts, 3, '', '', '…', 32) as snippet
           FROM project_files_fts WHERE project_id = ? AND project_files_fts MATCH ? LIMIT ?`
        )
        .all(projectId, clean + "*", limit) as Array<{ file_id: string; name: string; snippet: string }>;
      return rows.map((r) => ({ fileId: r.file_id, name: r.name, snippet: r.snippet }));
    } catch {
      const rows = this.db
        .query("SELECT id, name, substr(content_text, 1, 240) as snippet FROM project_files WHERE project_id = ? AND (name LIKE ? OR content_text LIKE ?) LIMIT ?")
        .all(projectId, `%${clean}%`, `%${clean}%`, limit) as Array<{ id: string; name: string; snippet: string }>;
      return rows.map((r) => ({ fileId: r.id, name: r.name, snippet: r.snippet }));
    }
  }

  deleteProjectFile(id: string): boolean {
    this.db.query("DELETE FROM project_files_fts WHERE file_id = ?").run(id);
    return this.db.query("DELETE FROM project_files WHERE id = ?").run(id).changes > 0;
  }

  // ==================== BUDGETS & USAGE ====================

  listBudgets(): Budget[] {
    const rows = this.db.query("SELECT * FROM budgets ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      scope: String(r.scope) as Budget["scope"],
      scopeId: r.scope_id ? String(r.scope_id) : null,
      type: String(r.type) as Budget["type"],
      limitUsd: Number(r.limit_usd),
      period: String(r.period) as Budget["period"],
      warnAtPercent: Number(r.warn_at_percent),
      enabled: Boolean(r.enabled),
      createdAt: String(r.created_at),
    }));
  }

  createBudget(input: Omit<Budget, "id" | "createdAt">): Budget {
    const id = createId("bdg");
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO budgets (id, name, scope, scope_id, type, limit_usd, period, warn_at_percent, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.scope,
        input.scopeId ?? null,
        input.type,
        input.limitUsd,
        input.period,
        input.warnAtPercent,
        input.enabled ? 1 : 0,
        createdAt
      );
    return { ...input, id, createdAt };
  }

  deleteBudget(id: string): boolean {
    return this.db.query("DELETE FROM budgets WHERE id = ?").run(id).changes > 0;
  }

  recordUsage(input: Omit<UsageRecord, "id" | "createdAt">): UsageRecord {
    const id = createId("usg");
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO usage_records (id, workspace_id, project_id, thread_id, message_id, provider_id, model_id, tool_id, input_tokens, output_tokens, cost_usd, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workspaceId,
        input.projectId,
        input.threadId ?? null,
        input.messageId ?? null,
        input.providerId,
        input.modelId,
        input.toolId ?? null,
        input.inputTokens,
        input.outputTokens,
        input.costUsd,
        input.latencyMs,
        createdAt
      );
    return { ...input, id, createdAt };
  }

  checkBudgets(opts: { projectId?: string; providerId?: string; isLocal?: boolean }): {
    blocked: boolean;
    warnings: Array<{ budget: Budget; spentUsd: number; percent: number }>;
    exceeded?: { budget: Budget; spentUsd: number };
  } {
    if (opts.isLocal) return { blocked: false, warnings: [] };
    const budgets = this.listBudgets().filter((b) => b.enabled);
    const warnings: Array<{ budget: Budget; spentUsd: number; percent: number }> = [];

    for (const b of budgets) {
      if (b.scope === "project" && b.scopeId && b.scopeId !== opts.projectId) continue;
      if (b.scope === "provider" && b.scopeId && b.scopeId !== opts.providerId) continue;

      const since = getPeriodStart(b.period);
      let sql = "SELECT COALESCE(SUM(cost_usd), 0) as total FROM usage_records WHERE created_at >= ?";
      const params: string[] = [since];
      if (b.scope === "project" && b.scopeId) {
        sql += " AND project_id = ?";
        params.push(b.scopeId);
      } else if (b.scope === "provider" && b.scopeId) {
        sql += " AND provider_id = ?";
        params.push(b.scopeId);
      }
      const total = (this.db.query(sql).get(...params) as { total: number }).total;
      const percent = b.limitUsd > 0 ? Math.round((total / b.limitUsd) * 100) : 0;

      if (b.type === "hard" && total >= b.limitUsd) {
        return { blocked: true, warnings, exceeded: { budget: b, spentUsd: total } };
      }
      if (percent >= b.warnAtPercent) {
        warnings.push({ budget: b, spentUsd: total, percent });
      }
    }

    return { blocked: false, warnings };
  }

  getUsageSummary(period: "daily" | "weekly" | "monthly" = "monthly") {
    const since = getPeriodStart(period);
    const totals = this.db
      .query(
        `SELECT
           COALESCE(SUM(cost_usd), 0) as totalCostUsd,
           COALESCE(SUM(input_tokens), 0) as totalInputTokens,
           COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
           COUNT(*) as requestCount
         FROM usage_records WHERE created_at >= ?`
      )
      .get(since) as {
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      requestCount: number;
    };

    const byProvider = this.db
      .query(
        `SELECT provider_id as providerId, SUM(cost_usd) as costUsd, SUM(input_tokens + output_tokens) as tokens, COUNT(*) as count
         FROM usage_records WHERE created_at >= ? GROUP BY provider_id ORDER BY costUsd DESC`
      )
      .all(since);

    const byModel = this.db
      .query(
        `SELECT provider_id as providerId, model_id as modelId, SUM(cost_usd) as costUsd, SUM(input_tokens + output_tokens) as tokens, COUNT(*) as count
         FROM usage_records WHERE created_at >= ? GROUP BY provider_id, model_id ORDER BY costUsd DESC`
      )
      .all(since);

    const byProject = this.db
      .query(
        `SELECT u.project_id as projectId, COALESCE(p.name, u.project_id) as projectName, SUM(u.cost_usd) as costUsd, COUNT(*) as count
         FROM usage_records u LEFT JOIN projects p ON p.id = u.project_id
         WHERE u.created_at >= ? GROUP BY u.project_id ORDER BY costUsd DESC`
      )
      .all(since);

    const topThreads = this.db
      .query(
        `SELECT u.thread_id as threadId, COALESCE(t.title, u.thread_id) as title, SUM(u.cost_usd) as costUsd, COUNT(*) as count
         FROM usage_records u LEFT JOIN threads t ON t.id = u.thread_id
         WHERE u.created_at >= ? AND u.thread_id IS NOT NULL
         GROUP BY u.thread_id ORDER BY costUsd DESC LIMIT 10`
      )
      .all(since);

    return { period, since, ...totals, byProvider, byModel, byProject, topThreads };
  }

  exportUsageCsv(period: "daily" | "weekly" | "monthly" = "monthly"): string {
    const since = getPeriodStart(period);
    const rows = this.db
      .query("SELECT * FROM usage_records WHERE created_at >= ? ORDER BY created_at DESC")
      .all(since) as Array<Record<string, unknown>>;
    const header = "id,created_at,project_id,thread_id,provider_id,model_id,input_tokens,output_tokens,cost_usd,latency_ms";
    const lines = rows.map(
      (r) =>
        `${r.id},${r.created_at},${r.project_id},${r.thread_id ?? ""},${r.provider_id},${r.model_id},${r.input_tokens},${r.output_tokens},${r.cost_usd},${r.latency_ms}`
    );
    return [header, ...lines].join("\n");
  }

  // ==================== PER-PROVIDER & PER-TOOL QUOTAS ====================

  ensureDefaultQuotas() {
    const defaults: Array<Omit<QuotaConfig, "id" | "updatedAt">> = [
      { targetType: "provider", targetId: "openai", displayName: "OpenAI (GPT / Image)", planName: "API Tier 1", metric: "usd", limitAmount: 20, resetInterval: "monthly" },
      { targetType: "provider", targetId: "anthropic", displayName: "Anthropic (Claude)", planName: "API / 5 Saatlik Kota", metric: "tokens", limitAmount: 1_000_000, resetInterval: "5h" },
      { targetType: "provider", targetId: "google", displayName: "Google Gemini", planName: "Günlük Kota", metric: "requests", limitAmount: 1500, resetInterval: "daily" },
      { targetType: "provider", targetId: "openrouter", displayName: "OpenRouter", planName: "Aylık Kredi", metric: "usd", limitAmount: 15, resetInterval: "monthly" },
      { targetType: "provider", targetId: "fal", displayName: "Flux / Fal.ai Görsel", planName: "Görsel Kotası", metric: "images", limitAmount: 200, resetInterval: "monthly" },
      { targetType: "provider", targetId: "stability", displayName: "Stability AI", planName: "Görsel Kotası", metric: "images", limitAmount: 150, resetInterval: "monthly" },
      { targetType: "provider", targetId: "ideogram", displayName: "Ideogram", planName: "Görsel Kotası", metric: "images", limitAmount: 100, resetInterval: "monthly" },
      { targetType: "provider", targetId: "deepseek", displayName: "DeepSeek", planName: "API Bütçe", metric: "usd", limitAmount: 10, resetInterval: "monthly" },
      { targetType: "provider", targetId: "xai", displayName: "xAI (Grok)", planName: "API Bütçe", metric: "usd", limitAmount: 15, resetInterval: "monthly" },
      { targetType: "provider", targetId: "ollama", displayName: "Ollama (Yerel)", planName: "Yerel · Sınırsız", metric: "requests", limitAmount: null, resetInterval: "never" },
      { targetType: "provider", targetId: "comfyui", displayName: "ComfyUI (Yerel Görsel)", planName: "Yerel · Sınırsız", metric: "images", limitAmount: null, resetInterval: "never" },
      { targetType: "provider", targetId: "video_studio", displayName: "Video Stüdyo (Kling/Veo/Runway)", planName: "Aylık Video Kredisi", metric: "usd", limitAmount: 25, resetInterval: "monthly" },
      { targetType: "provider", targetId: "audio_studio", displayName: "Müzik & Ses (Suno/ElevenLabs)", planName: "Aylık Ses/Müzik", metric: "usd", limitAmount: 15, resetInterval: "monthly" },
      { targetType: "provider", targetId: "model3d_studio", displayName: "3D Model (Meshy/Tripo)", planName: "Aylık 3D Varlık", metric: "images", limitAmount: 50, resetInterval: "monthly" },
      { targetType: "provider", targetId: "demo", displayName: "SYMFORYX Stüdyo Demo", planName: "Yerleşik · Ücretsiz", metric: "requests", limitAmount: null, resetInterval: "never" },
      { targetType: "tool", targetId: "web-search", displayName: "Web Araması (Tavily/DDG)", planName: "Aylık 1000 Arama", metric: "requests", limitAmount: 1000, resetInterval: "monthly" },
      { targetType: "tool", targetId: "code-sandbox", displayName: "Kod Sandbox", planName: "Yerel · Sınırsız", metric: "requests", limitAmount: null, resetInterval: "never" },
      { targetType: "tool", targetId: "dev.ozkandev.renk-paleti", displayName: "Renk Paleti", planName: "Yerleşik · Sınırsız", metric: "requests", limitAmount: null, resetInterval: "never" },
    ];
    for (const d of defaults) {
      const exists = this.db
        .query("SELECT id FROM quotas WHERE target_type = ? AND target_id = ?")
        .get(d.targetType, d.targetId);
      if (!exists) {
        this.upsertQuota(d);
      }
    }
  }

  upsertQuota(input: Omit<QuotaConfig, "id" | "updatedAt"> & { id?: string }): QuotaConfig {
    const id = input.id ?? `qt_${input.targetType}_${input.targetId}`;
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO quotas (id, target_type, target_id, display_name, plan_name, metric, limit_amount, reset_interval, reset_anchor_iso, live_remaining, live_limit, live_reset_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(target_type, target_id) DO UPDATE SET
           display_name = excluded.display_name,
           plan_name = excluded.plan_name,
           metric = excluded.metric,
           limit_amount = excluded.limit_amount,
           reset_interval = excluded.reset_interval,
           reset_anchor_iso = COALESCE(excluded.reset_anchor_iso, quotas.reset_anchor_iso),
           live_remaining = COALESCE(excluded.live_remaining, quotas.live_remaining),
           live_limit = COALESCE(excluded.live_limit, quotas.live_limit),
           live_reset_at = COALESCE(excluded.live_reset_at, quotas.live_reset_at),
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.targetType,
        input.targetId,
        input.displayName,
        input.planName,
        input.metric,
        input.limitAmount,
        input.resetInterval,
        input.resetAnchorIso ?? now,
        input.liveRemaining ?? null,
        input.liveLimit ?? null,
        input.liveResetAt ?? null,
        now
      );
    return this.getQuotaStatus(input.targetType, input.targetId)!;
  }

  updateLiveQuotaHeaders(
    targetId: string,
    patch: { liveRemaining?: number | null; liveLimit?: number | null; liveResetAt?: string | null }
  ) {
    this.db
      .query(
        `UPDATE quotas SET live_remaining = COALESCE(?, live_remaining), live_limit = COALESCE(?, live_limit), live_reset_at = COALESCE(?, live_reset_at), updated_at = ?
         WHERE target_type = 'provider' AND target_id = ?`
      )
      .run(
        patch.liveRemaining ?? null,
        patch.liveLimit ?? null,
        patch.liveResetAt ?? null,
        new Date().toISOString(),
        targetId
      );
  }

  listQuotaStatuses(): QuotaStatus[] {
    this.ensureDefaultQuotas();
    const rows = this.db
      .query("SELECT * FROM quotas ORDER BY target_type ASC, display_name ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.computeQuotaStatus(r));
  }

  getQuotaStatus(targetType: "provider" | "tool", targetId: string): QuotaStatus | null {
    const row = this.db
      .query("SELECT * FROM quotas WHERE target_type = ? AND target_id = ?")
      .get(targetType, targetId) as Record<string, unknown> | null;
    return row ? this.computeQuotaStatus(row) : null;
  }

  private computeQuotaStatus(r: Record<string, unknown>): QuotaStatus {
    const targetType = String(r.target_type) as "provider" | "tool";
    const targetId = String(r.target_id);
    const metric = String(r.metric) as QuotaConfig["metric"];
    const resetInterval = String(r.reset_interval) as QuotaResetInterval;
    const limitAmount = r.limit_amount === null || r.limit_amount === undefined ? null : Number(r.limit_amount);
    const { windowStartIso, nextResetAt } = computeResetWindow(resetInterval);

    const whereCol = targetType === "provider" ? "provider_id = ?" : "tool_id = ?";
    const winStats = this.db
      .query(
        `SELECT COUNT(*) as reqs, COALESCE(SUM(input_tokens + output_tokens), 0) as toks, COALESCE(SUM(cost_usd), 0) as cost
         FROM usage_records WHERE ${whereCol} AND created_at >= ?`
      )
      .get(targetId, windowStartIso) as { reqs: number; toks: number; cost: number };

    const allStats = this.db
      .query(`SELECT COALESCE(SUM(cost_usd), 0) as cost FROM usage_records WHERE ${whereCol}`)
      .get(targetId) as { cost: number };

    let usedAmount = winStats.reqs;
    if (metric === "tokens") usedAmount = winStats.toks;
    else if (metric === "usd") usedAmount = Number(winStats.cost.toFixed(5));
    else if (metric === "images") usedAmount = winStats.reqs;

    const effectiveLimit = r.live_limit !== null && r.live_limit !== undefined ? Number(r.live_limit) : limitAmount;
    const remainingAmount =
      r.live_remaining !== null && r.live_remaining !== undefined
        ? Number(r.live_remaining)
        : effectiveLimit !== null
        ? Math.max(0, Number((effectiveLimit - usedAmount).toFixed(5)))
        : null;

    const percentUsed =
      effectiveLimit && effectiveLimit > 0
        ? Math.min(100, Math.round(((effectiveLimit - (remainingAmount ?? 0)) / effectiveLimit) * 100))
        : 0;

    return {
      id: String(r.id),
      targetType,
      targetId,
      displayName: String(r.display_name),
      planName: String(r.plan_name),
      metric,
      limitAmount: effectiveLimit,
      resetInterval,
      resetAnchorIso: r.reset_anchor_iso ? String(r.reset_anchor_iso) : undefined,
      liveRemaining: r.live_remaining !== null && r.live_remaining !== undefined ? Number(r.live_remaining) : null,
      liveLimit: r.live_limit !== null && r.live_limit !== undefined ? Number(r.live_limit) : null,
      liveResetAt: r.live_reset_at ? String(r.live_reset_at) : null,
      updatedAt: String(r.updated_at),
      usedAmount,
      remainingAmount,
      percentUsed,
      windowStartIso,
      nextResetAt: r.live_reset_at ? String(r.live_reset_at) : nextResetAt,
      windowCostUsd: Number(winStats.cost.toFixed(5)),
      totalCostUsd: Number(allStats.cost.toFixed(5)),
      windowRequests: winStats.reqs,
      windowTokens: winStats.toks,
    };
  }

  // ==================== SETTINGS, TOKENS, WEBHOOKS, AUDIT ====================

  getSettings(): UserSettings {
    const row = this.db
      .query("SELECT value_json FROM settings WHERE key = 'user_settings'")
      .get() as { value_json: string } | null;
    if (!row) return { ...DEFAULT_USER_SETTINGS };
    return { ...DEFAULT_USER_SETTINGS, ...JSON.parse(row.value_json) };
  }

  updateSettings(patch: Partial<UserSettings>): UserSettings {
    const merged = { ...this.getSettings(), ...patch };
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO settings (key, value_json, updated_at) VALUES ('user_settings', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(merged), now);
    return merged;
  }

  createApiToken(name: string, scopes: string[] = ["*"]): { id: string; token: string; maskedToken: string } {
    const id = createId("tok");
    const raw = `sym_${randomBytes(24).toString("hex")}`;
    const hash = createHash("sha256").update(raw).digest("hex");
    const masked = this.vault.mask(raw);
    this.db
      .query(
        `INSERT INTO api_tokens (id, name, token_hash, masked_token, scopes_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, name, hash, masked, JSON.stringify(scopes), new Date().toISOString());
    this.logAudit("user", "token.create", id, { name });
    return { id, token: raw, maskedToken: masked };
  }

  verifyApiToken(rawToken: string): { id: string; scopes: string[] } | null {
    const hash = createHash("sha256").update(rawToken).digest("hex");
    const row = this.db
      .query("SELECT id, scopes_json FROM api_tokens WHERE token_hash = ?")
      .get(hash) as { id: string; scopes_json: string } | null;
    if (!row) return null;
    this.db.query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { id: row.id, scopes: JSON.parse(row.scopes_json) };
  }

  listApiTokens() {
    return this.db
      .query("SELECT id, name, masked_token as maskedToken, scopes_json as scopesJson, created_at as createdAt, last_used_at as lastUsedAt FROM api_tokens ORDER BY created_at DESC")
      .all();
  }

  listWebhooks(): WebhookConfig[] {
    const rows = this.db.query("SELECT * FROM webhooks ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      url: String(r.url),
      secret: "••••••••",
      events: JSON.parse(String(r.events_json)),
      enabled: Boolean(r.enabled),
      createdAt: String(r.created_at),
    }));
  }

  addWebhook(input: { url: string; secret: string; events: string[] }): WebhookConfig {
    const id = createId("wh");
    const createdAt = new Date().toISOString();
    this.db
      .query("INSERT INTO webhooks (id, url, encrypted_secret, events_json, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)")
      .run(id, input.url, this.vault.encrypt(input.secret), JSON.stringify(input.events), createdAt);
    return { id, url: input.url, secret: "••••••••", events: input.events, enabled: true, createdAt };
  }

  getActiveWebhooksWithSecret(eventName: string): Array<{ id: string; url: string; secret: string }> {
    const rows = this.db.query("SELECT * FROM webhooks WHERE enabled = 1").all() as Array<Record<string, unknown>>;
    const matched: Array<{ id: string; url: string; secret: string }> = [];
    for (const r of rows) {
      const events = JSON.parse(String(r.events_json)) as string[];
      if (events.includes("*") || events.includes(eventName)) {
        matched.push({
          id: String(r.id),
          url: String(r.url),
          secret: this.vault.decrypt(String(r.encrypted_secret)),
        });
      }
    }
    return matched;
  }

  logAudit(actor: string, action: string, target?: string, meta?: Record<string, unknown>) {
    this.db
      .query("INSERT INTO audit_logs (id, actor, action, target, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createId("aud"), actor, action, target ?? null, meta ? JSON.stringify(meta) : null, new Date().toISOString());
  }

  listAuditLogs(limit = 50): AuditLogEntry[] {
    const rows = this.db
      .query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      actor: String(r.actor),
      action: String(r.action),
      target: r.target ? String(r.target) : undefined,
      meta: r.meta_json ? JSON.parse(String(r.meta_json)) : undefined,
      createdAt: String(r.created_at),
    }));
  }

  // ==================== EXPORT (Never includes secrets!) ====================

  exportAllData() {
    return {
      format: "symforyx-export-v1",
      exportedAt: new Date().toISOString(),
      workspaces: this.listWorkspaces(),
      projects: this.listProjects(),
      threads: this.listThreads(undefined, true),
      messages: this.db.query("SELECT * FROM messages ORDER BY created_at ASC").all().map((r) => this.mapMessage(r as Record<string, unknown>)),
      artifacts: this.listArtifacts(),
      roles: this.listRoles(),
      flows: this.listFlows(),
      memories: this.listMemories(),
      budgets: this.listBudgets(),
      settings: this.getSettings(),
    };
  }
}

function extractPlainText(parts: MessagePart[]): string {
  return parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "summary") return p.text;
      if (p.type === "tool_result") return extractPlainText(p.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getPeriodStart(period: "daily" | "weekly" | "monthly"): string {
  const d = new Date();
  if (period === "daily") {
    d.setHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    d.setDate(d.getDate() - 7);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

function computeResetWindow(interval: QuotaResetInterval): {
  windowStartIso: string;
  nextResetAt: string | null;
} {
  const now = new Date();
  if (interval === "never") {
    return { windowStartIso: "1970-01-01T00:00:00.000Z", nextResetAt: null };
  }
  if (interval === "hourly") {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    const next = new Date(start.getTime() + 3600_000);
    return { windowStartIso: start.toISOString(), nextResetAt: next.toISOString() };
  }
  if (interval === "5h") {
    const blockMs = 5 * 3600_000;
    const blockStart = Math.floor(now.getTime() / blockMs) * blockMs;
    return {
      windowStartIso: new Date(blockStart).toISOString(),
      nextResetAt: new Date(blockStart + blockMs).toISOString(),
    };
  }
  if (interval === "daily") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return { windowStartIso: start.toISOString(), nextResetAt: next.toISOString() };
  }
  if (interval === "weekly") {
    const start = new Date(now);
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    const next = new Date(start);
    next.setDate(next.getDate() + 7);
    return { windowStartIso: start.toISOString(), nextResetAt: next.toISOString() };
  }
  // monthly
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { windowStartIso: start.toISOString(), nextResetAt: next.toISOString() };
}
