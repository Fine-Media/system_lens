# Shared DB Module

Defines SQLite schema, migrations, and safe access patterns for all modules.

## Responsibilities

- Own database schema evolution.
- Provide typed repository interfaces for each domain.
- Support indexing and query performance for search/insights.
- Maintain audit log tables for safety and automation operations.
- Run forward-only SQLite migrations at startup and record applied versions in `schema_migrations`.

## Initial Schema (proposed)

- `files(id, path, type, ext, created_at, updated_at, size_bytes, hash_hint, status)`
- `file_stats(file_id, last_opened_at, last_modified_at, access_count)`
- `embeddings(id, file_id, model, vector_ref, updated_at)`
- `insight_findings(id, detector, severity, payload_json, created_at, status)`
- `action_log(id, action_type, scope_json, preview_json, result_json, created_at, actor)`
- `automation_rules(id, name, enabled, schedule_json, policy_json, created_at, updated_at)`
- `automation_runs(id, rule_id, preview_json, result_json, started_at, ended_at, status)`

## Access Rules

- Write methods require validated payloads.
- Soft-delete over hard-delete for auditable entities.
- Migrations are forward-only and idempotent.

## Adding a Migration

1. Add a new entry to `MIGRATIONS` in `src/index.ts` with the next integer `version`, a short snake-case `name`, and idempotent SQL.
2. Keep migrations forward-only. Do not edit an already-applied migration after release; add a new migration instead.
3. Prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and additive schema changes that can run safely on existing databases.
4. Run the shared DB typecheck and full build before opening a PR:

```bash
npm --prefix packages/shared-db run typecheck
npx tsc -b tsconfig.json
```
