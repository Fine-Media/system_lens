# Shared DB Module

Defines SQLite schema, migrations, and safe access patterns for all modules.

## Responsibilities

- Own database schema evolution.
- Provide typed repository interfaces for each domain.
- Support indexing and query performance for search/insights.
- Maintain audit log tables for safety and automation operations.

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
