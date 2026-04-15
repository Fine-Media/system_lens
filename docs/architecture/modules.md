# Module Contracts

## `apps/desktop`

**Responsibility**
- Render app UI, capture user intent, show previews and confirmations.

**Consumes**
- `search.query()`
- `system-insights.analyze()`
- `ai-assistant.ask()`
- `safety.preview()` and `safety.executeConfirmed()`

**Never does**
- Direct filesystem mutations.

## `packages/indexer`

**Responsibility**
- Full scan, incremental watch updates, metadata extraction.

**Produces**
- Upsert file metadata events into `shared-db`.

**Depends on**
- `shared-db`, `filesystem wrappers`.

## `packages/search`

**Responsibility**
- Semantic indexing and retrieval for local files.

**Public API**
- `buildEmbedding(fileId)`
- `querySemantic(text, filters)`

**Depends on**
- `shared-db`, local embedding provider.

## `packages/system-insights`

**Responsibility**
- Non-destructive analyzers: duplicates, stale files, large files, directory bloat.

**Public API**
- `runDetectors(scope)`
- `explainStorage(scope)`

**Output**
- Findings only; no mutating actions.

## `packages/ai-assistant`

**Responsibility**
- Local LLM orchestration (Ollama), context assembly, response generation.

**Public API**
- `ask(question, scope)`
- `summarizeFolder(path)`
- `suggestActions(context)`

**Constraint**
- Suggestions are advisory; execution routes through `safety`.

## `packages/safety`

**Responsibility**
- Single gateway for mutating actions.

**Public API**
- `preview(actionIntent)`
- `validatePolicy(actionIntent, userPolicy)`
- `executeConfirmed(confirmationToken)`
- `rollback(actionId)` when possible

**Guarantee**
- No mutation without explicit, recorded confirmation.

## `packages/automation`

**Responsibility**
- Run user-approved rules under policy limits.

**Public API**
- `simulateRule(ruleId)`
- `activateRule(ruleId)`
- `executeRule(ruleId, scheduleContext)`

**Constraint**
- Rule executions still use `safety` gate semantics.

## `packages/shared-db`

**Responsibility**
- SQLite schema, migrations, and data access contracts.

**Tables (initial)**
- `files`, `file_stats`, `embeddings`, `insight_findings`, `action_log`, `automation_rules`.

## Cross-Cutting Rules

1. `safety` is mandatory for all write/delete/move/rename/archive operations.
2. `ai-assistant` and `automation` cannot call filesystem wrappers directly.
3. UI must surface preview details before confirmation.
4. All operations emit structured logs for auditability.
