import crypto from 'node:crypto';
import pathModule from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type FileStatus = 'active' | 'deleted';
export type FindingStatus = 'open' | 'dismissed';
export type ActionStatus = 'previewed' | 'executed' | 'blocked' | 'rolled_back';
export type RuleStatus = 'draft' | 'active' | 'inactive';
export type RunStatus = 'simulated' | 'success' | 'failed' | 'blocked';

export interface FileRecord {
  id: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  ext: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  hashHint: string | null;
  status: FileStatus;
}

export interface EmbeddingRecord {
  id: string;
  fileId: string;
  model: string;
  vectorRef: string;
  updatedAt: string;
}

export interface SearchFilters {
  pathPrefix?: string;
  extensions?: string[];
  minSizeBytes?: number;
  maxSizeBytes?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface QueryFileResult extends FileRecord {
  score: number;
}

export interface InsightFinding {
  id: string;
  detector: string;
  severity: 'low' | 'medium' | 'high';
  payloadJson: string;
  createdAt: string;
  status: FindingStatus;
}

export interface ActionLogEntry {
  id: string;
  actionType: string;
  scopeJson: string;
  previewJson: string;
  resultJson: string;
  createdAt: string;
  actor: string;
  status: ActionStatus;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  scheduleJson: string;
  policyJson: string;
  createdAt: string;
  updatedAt: string;
  status: RuleStatus;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  previewJson: string;
  resultJson: string;
  startedAt: string;
  endedAt: string;
  status: RunStatus;
}

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  ext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  hash_hint TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'deleted'))
);

CREATE TABLE IF NOT EXISTS file_stats(
  file_id TEXT PRIMARY KEY REFERENCES files(id),
  last_opened_at TEXT,
  last_modified_at TEXT NOT NULL,
  access_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings(
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  model TEXT NOT NULL,
  vector_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insight_findings(
  id TEXT PRIMARY KEY,
  detector TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS action_log(
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('previewed', 'executed', 'blocked', 'rolled_back'))
);

CREATE TABLE IF NOT EXISTS automation_rules(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  schedule_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS automation_runs(
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  preview_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('simulated', 'success', 'failed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at);
CREATE INDEX IF NOT EXISTS idx_files_size_bytes ON files(size_bytes);
CREATE INDEX IF NOT EXISTS idx_embeddings_file_id ON embeddings(file_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON insight_findings(status);
CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON action_log(created_at);
CREATE INDEX IF NOT EXISTS idx_rules_status ON automation_rules(status);
CREATE INDEX IF NOT EXISTS idx_runs_rule_id ON automation_runs(rule_id);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function fileIdFromPath(path: string): string {
  return crypto.createHash('sha1').update(path).digest('hex');
}

function normalizeExt(path: string): string {
  const extIndex = path.lastIndexOf('.');
  if (extIndex === -1) {
    return '';
  }

  return path.slice(extIndex).toLowerCase();
}

function stableId(prefix: string, content: string): string {
  return crypto.createHash('sha1').update(`${prefix}:${content}`).digest('hex');
}

export class SharedDb {
  private readonly db: DatabaseSync;

  constructor(databasePath = ':memory:') {
    this.db = new DatabaseSync(databasePath);
    this.db.exec(INITIAL_SCHEMA_SQL);
  }

  getSchemaSql(): string {
    return INITIAL_SCHEMA_SQL.trim();
  }

  upsertFile(input: {
    path: string;
    type: FileRecord['type'];
    createdAt?: string;
    updatedAt: string;
    sizeBytes: number;
    hashHint?: string | null;
    status?: FileStatus;
  }): FileRecord {
    const id = fileIdFromPath(input.path);
    const createdAt = input.createdAt ?? input.updatedAt;
    const status = input.status ?? 'active';
    const ext = normalizeExt(input.path);

    this.db
      .prepare(
        `INSERT INTO files(id, path, type, ext, created_at, updated_at, size_bytes, hash_hint, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           type = excluded.type,
           ext = excluded.ext,
           updated_at = excluded.updated_at,
           size_bytes = excluded.size_bytes,
           hash_hint = excluded.hash_hint,
           status = excluded.status`,
      )
      .run(
        id,
        input.path,
        input.type,
        ext,
        createdAt,
        input.updatedAt,
        input.sizeBytes,
        input.hashHint ?? null,
        status,
      );

    this.db
      .prepare(
        `INSERT INTO file_stats(file_id, last_opened_at, last_modified_at, access_count)
         VALUES(?, NULL, ?, 0)
         ON CONFLICT(file_id) DO UPDATE SET
           last_modified_at = excluded.last_modified_at`,
      )
      .run(id, input.updatedAt);

    const row = this.db
      .prepare(
        `SELECT id, path, type, ext, created_at, updated_at, size_bytes, hash_hint, status
         FROM files
         WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          path: string;
          type: FileRecord['type'];
          ext: string;
          created_at: string;
          updated_at: string;
          size_bytes: number;
          hash_hint: string | null;
          status: FileStatus;
        }
      | undefined;

    if (!row) {
      throw new Error('File upsert failed unexpectedly.');
    }

    return {
      id: row.id,
      path: row.path,
      type: row.type,
      ext: row.ext,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sizeBytes: row.size_bytes,
      hashHint: row.hash_hint,
      status: row.status,
    };
  }

  getFileById(fileId: string): FileRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, path, type, ext, created_at, updated_at, size_bytes, hash_hint, status
         FROM files
         WHERE id = ?`,
      )
      .get(fileId) as
      | {
          id: string;
          path: string;
          type: FileRecord['type'];
          ext: string;
          created_at: string;
          updated_at: string;
          size_bytes: number;
          hash_hint: string | null;
          status: FileStatus;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      path: row.path,
      type: row.type,
      ext: row.ext,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sizeBytes: row.size_bytes,
      hashHint: row.hash_hint,
      status: row.status,
    };
  }

  markFileDeleted(path: string): void {
    const id = fileIdFromPath(path);
    this.db
      .prepare(`UPDATE files SET status = 'deleted', updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
  }

  /**
   * Marks the path and any indexed descendants as deleted and drops their embeddings.
   * Used when the filesystem no longer has that path (e.g. deleted file or folder).
   */
  tombstonePathAndDescendants(targetPath: string): number {
    const norm = pathModule.normalize(targetPath);
    const likePattern = norm + pathModule.sep + '%';
    const rows = this.db
      .prepare(`SELECT id FROM files WHERE status = 'active' AND (path = ? OR path LIKE ?)`)
      .all(norm, likePattern) as Array<{ id: string }>;

    if (rows.length === 0) {
      return 0;
    }

    const updatedAt = nowIso();
    for (const row of rows) {
      this.removeEmbedding(row.id);
    }

    this.db
      .prepare(
        `UPDATE files SET status = 'deleted', updated_at = ? WHERE status = 'active' AND (path = ? OR path LIKE ?)`,
      )
      .run(updatedAt, norm, likePattern);

    return rows.length;
  }

  upsertEmbedding(fileId: string, model: string, vectorRef: string): EmbeddingRecord {
    const id = stableId('embedding', `${fileId}:${model}`);
    const updatedAt = nowIso();

    this.db
      .prepare(
        `INSERT INTO embeddings(id, file_id, model, vector_ref, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           vector_ref = excluded.vector_ref,
           updated_at = excluded.updated_at`,
      )
      .run(id, fileId, model, vectorRef, updatedAt);

    return { id, fileId, model, vectorRef, updatedAt };
  }

  removeEmbedding(fileId: string): void {
    this.db.prepare('DELETE FROM embeddings WHERE file_id = ?').run(fileId);
  }

  listFiles(limit = 100): FileRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, path, type, ext, created_at, updated_at, size_bytes, hash_hint, status
         FROM files
         WHERE status = 'active'
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      path: string;
      type: FileRecord['type'];
      ext: string;
      created_at: string;
      updated_at: string;
      size_bytes: number;
      hash_hint: string | null;
      status: FileStatus;
    }>;

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      type: row.type,
      ext: row.ext,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sizeBytes: row.size_bytes,
      hashHint: row.hash_hint,
      status: row.status,
    }));
  }

  queryFilesByText(text: string, filters: SearchFilters = {}, limit = 20): QueryFileResult[] {
    const normalizedText = text.trim().toLowerCase();
    const activeFiles = this.listFiles(4_000).filter((file) => {
      if (filters.pathPrefix && !file.path.startsWith(filters.pathPrefix)) {
        return false;
      }

      if (filters.extensions?.length) {
        const exts = new Set(filters.extensions.map((ext) => ext.toLowerCase()));
        if (!exts.has(file.ext)) {
          return false;
        }
      }

      if (typeof filters.minSizeBytes === 'number' && file.sizeBytes < filters.minSizeBytes) {
        return false;
      }

      if (typeof filters.maxSizeBytes === 'number' && file.sizeBytes > filters.maxSizeBytes) {
        return false;
      }

      if (filters.modifiedAfter && file.updatedAt < filters.modifiedAfter) {
        return false;
      }

      if (filters.modifiedBefore && file.updatedAt > filters.modifiedBefore) {
        return false;
      }

      return true;
    });

    return activeFiles
      .map((file) => {
        const pathLc = file.path.toLowerCase();
        const extLc = file.ext.toLowerCase();
        const exactBoost = normalizedText && pathLc.includes(normalizedText) ? 2 : 0;
        const extBoost =
          normalizedText === extLc || normalizedText === extLc.replace('.', '') ? 1 : 0;
        const daysOld = Math.max(
          1,
          Math.floor((Date.now() - Date.parse(file.updatedAt)) / (1000 * 60 * 60 * 24)),
        );
        const recencyBoost = 1 / (1 + daysOld);

        return { ...file, score: exactBoost + extBoost + recencyBoost };
      })
      .filter((result) => result.score > 0 || !normalizedText)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  upsertInsightFinding(input: {
    detector: string;
    severity: InsightFinding['severity'];
    payloadJson: string;
    status?: FindingStatus;
  }): InsightFinding {
    const id = stableId('finding', `${input.detector}:${input.payloadJson}`);
    const createdAt = nowIso();
    const status = input.status ?? 'open';

    this.db
      .prepare(
        `INSERT INTO insight_findings(id, detector, severity, payload_json, created_at, status)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           severity = excluded.severity,
           payload_json = excluded.payload_json,
           status = excluded.status`,
      )
      .run(id, input.detector, input.severity, input.payloadJson, createdAt, status);

    return {
      id,
      detector: input.detector,
      severity: input.severity,
      payloadJson: input.payloadJson,
      createdAt,
      status,
    };
  }

  listInsightFindings(status?: FindingStatus): InsightFinding[] {
    const rows = (
      status
        ? this.db
            .prepare(
              `SELECT id, detector, severity, payload_json, created_at, status
               FROM insight_findings
               WHERE status = ?
               ORDER BY created_at DESC`,
            )
            .all(status)
        : this.db
            .prepare(
              `SELECT id, detector, severity, payload_json, created_at, status
               FROM insight_findings
               ORDER BY created_at DESC`,
            )
            .all()
    ) as Array<{
      id: string;
      detector: string;
      severity: InsightFinding['severity'];
      payload_json: string;
      created_at: string;
      status: FindingStatus;
    }>;

    return rows.map((row) => ({
      id: row.id,
      detector: row.detector,
      severity: row.severity,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
      status: row.status,
    }));
  }

  dismissInsightFinding(findingId: string): void {
    this.db.prepare(`UPDATE insight_findings SET status = 'dismissed' WHERE id = ?`).run(findingId);
  }

  insertActionLog(input: {
    actionType: string;
    scopeJson: string;
    previewJson: string;
    resultJson: string;
    actor: string;
    status: ActionStatus;
  }): ActionLogEntry {
    const id = crypto.randomUUID();
    const createdAt = nowIso();

    this.db
      .prepare(
        `INSERT INTO action_log(id, action_type, scope_json, preview_json, result_json, created_at, actor, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.actionType,
        input.scopeJson,
        input.previewJson,
        input.resultJson,
        createdAt,
        input.actor,
        input.status,
      );

    return {
      id,
      actionType: input.actionType,
      scopeJson: input.scopeJson,
      previewJson: input.previewJson,
      resultJson: input.resultJson,
      createdAt,
      actor: input.actor,
      status: input.status,
    };
  }

  listActionLog(limit = 100): ActionLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, action_type, scope_json, preview_json, result_json, created_at, actor, status
         FROM action_log
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      action_type: string;
      scope_json: string;
      preview_json: string;
      result_json: string;
      created_at: string;
      actor: string;
      status: ActionStatus;
    }>;

    return rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      scopeJson: row.scope_json,
      previewJson: row.preview_json,
      resultJson: row.result_json,
      createdAt: row.created_at,
      actor: row.actor,
      status: row.status,
    }));
  }

  createAutomationRule(input: {
    name: string;
    enabled?: boolean;
    scheduleJson: string;
    policyJson: string;
    status?: RuleStatus;
  }): AutomationRule {
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const enabled = input.enabled ?? false;
    const status = input.status ?? 'draft';

    this.db
      .prepare(
        `INSERT INTO automation_rules(id, name, enabled, schedule_json, policy_json, created_at, updated_at, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        enabled ? 1 : 0,
        input.scheduleJson,
        input.policyJson,
        timestamp,
        timestamp,
        status,
      );

    return {
      id,
      name: input.name,
      enabled,
      scheduleJson: input.scheduleJson,
      policyJson: input.policyJson,
      createdAt: timestamp,
      updatedAt: timestamp,
      status,
    };
  }

  updateAutomationRuleState(ruleId: string, input: { enabled: boolean; status: RuleStatus }): void {
    this.db
      .prepare(
        `UPDATE automation_rules
         SET enabled = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.enabled ? 1 : 0, input.status, nowIso(), ruleId);
  }

  getAutomationRule(ruleId: string): AutomationRule | null {
    const row = this.db
      .prepare(
        `SELECT id, name, enabled, schedule_json, policy_json, created_at, updated_at, status
         FROM automation_rules
         WHERE id = ?`,
      )
      .get(ruleId) as
      | {
          id: string;
          name: string;
          enabled: number;
          schedule_json: string;
          policy_json: string;
          created_at: string;
          updated_at: string;
          status: RuleStatus;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      scheduleJson: row.schedule_json,
      policyJson: row.policy_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    };
  }

  listAutomationRules(): AutomationRule[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, schedule_json, policy_json, created_at, updated_at, status
         FROM automation_rules
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      enabled: number;
      schedule_json: string;
      policy_json: string;
      created_at: string;
      updated_at: string;
      status: RuleStatus;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      scheduleJson: row.schedule_json,
      policyJson: row.policy_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status,
    }));
  }

  insertAutomationRun(input: {
    ruleId: string;
    previewJson: string;
    resultJson: string;
    startedAt?: string;
    endedAt?: string;
    status: RunStatus;
  }): AutomationRun {
    const id = crypto.randomUUID();
    const startedAt = input.startedAt ?? nowIso();
    const endedAt = input.endedAt ?? nowIso();

    this.db
      .prepare(
        `INSERT INTO automation_runs(id, rule_id, preview_json, result_json, started_at, ended_at, status)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.ruleId, input.previewJson, input.resultJson, startedAt, endedAt, input.status);

    return {
      id,
      ruleId: input.ruleId,
      previewJson: input.previewJson,
      resultJson: input.resultJson,
      startedAt,
      endedAt,
      status: input.status,
    };
  }

  listAutomationRuns(limit = 100): AutomationRun[] {
    const rows = this.db
      .prepare(
        `SELECT id, rule_id, preview_json, result_json, started_at, ended_at, status
         FROM automation_runs
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      rule_id: string;
      preview_json: string;
      result_json: string;
      started_at: string;
      ended_at: string;
      status: RunStatus;
    }>;

    return rows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      previewJson: row.preview_json,
      resultJson: row.result_json,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
    }));
  }

  close(): void {
    this.db.close();
  }
}
