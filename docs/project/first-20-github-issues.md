# First 20 GitHub Issues

This backlog is ordered for phased delivery and parallel contributor onboarding.

## Standard Issue Template

Each issue should contain:

- Goal
- User value
- Acceptance criteria
- Safety constraints
- Telemetry/logging
- Test plan
- Labels

---

## M1 Smart Search App (Issues 1-8)

### 1) Bootstrap monorepo skeleton
- **Goal**: Create `apps/desktop`, `packages/*`, and base tooling config.
- **User value**: Enables parallel development without structural churn.
- **Acceptance criteria**: Workspace boots; package boundaries match architecture docs.
- **Safety constraints**: Include `safety` package from day one.
- **Telemetry/logging**: N/A (infra setup).
- **Test plan**: Validate local install and package discovery.
- **Labels**: `core`, `docs`

### 2) Implement index roots configuration
- **Goal**: User can select include/exclude scan roots.
- **User value**: Control over indexed data and privacy.
- **Acceptance criteria**: Persisted settings, exclusion patterns honored.
- **Safety constraints**: No indexing outside approved roots.
- **Telemetry/logging**: Log root change events.
- **Test plan**: Unit test config parser + integration test with nested folders.
- **Labels**: `core`, `ui`

### 3) Initial full filesystem crawl service
- **Goal**: Build initial scan job and metadata persistence.
- **User value**: Search and insights become possible.
- **Acceptance criteria**: Files recorded with type, path, size, timestamps.
- **Safety constraints**: Read-only crawl behavior.
- **Telemetry/logging**: Scan duration, files processed, errors by type.
- **Test plan**: Integration test against fixture directory tree.
- **Labels**: `core`, `performance`

### 4) Incremental filesystem watcher
- **Goal**: Keep index fresh via create/update/delete events.
- **User value**: Results stay accurate without rescanning.
- **Acceptance criteria**: DB updates reflect live filesystem changes.
- **Safety constraints**: Read-only event handling.
- **Telemetry/logging**: Event throughput, dropped event count.
- **Test plan**: Simulate event stream and verify DB delta updates.
- **Labels**: `core`, `performance`

### 5) SQLite schema and migration runner
- **Goal**: Implement initial `files`, `file_stats`, `embeddings`, `action_log`.
- **User value**: Reliable local persistence.
- **Acceptance criteria**: Forward-only migrations succeed from empty DB.
- **Safety constraints**: Migration rollback strategy documented.
- **Telemetry/logging**: Migration start/success/failure entries.
- **Test plan**: Migration tests across fresh and partially migrated states.
- **Labels**: `core`

### 6) Embedding pipeline for index updates
- **Goal**: Generate embeddings for supported file content types.
- **User value**: Semantic search beyond filenames.
- **Acceptance criteria**: New/updated files enqueue embeddings; stale vectors removed.
- **Safety constraints**: Respect excluded/private paths.
- **Telemetry/logging**: Embedding queue size, processing latency, failures.
- **Test plan**: Unit tests for enqueue logic + integration test with sample docs.
- **Labels**: `ai`, `core`, `performance`

### 7) Semantic search API with metadata filters
- **Goal**: Query by natural language and return ranked results.
- **User value**: Fast discovery of relevant files.
- **Acceptance criteria**: Supports filters by path/type/recency/size.
- **Safety constraints**: Results are read-only; no actions executed.
- **Telemetry/logging**: Query latency, result count, filter usage.
- **Test plan**: Relevance regression tests on fixture corpus.
- **Labels**: `ai`, `core`

### 8) Search UI MVP
- **Goal**: Build search screen with query bar, facets, result cards.
- **User value**: Usable end-to-end search experience.
- **Acceptance criteria**: Query submit, filter chips, open file/folder actions.
- **Safety constraints**: Any mutating action affordance disabled or gated.
- **Telemetry/logging**: Query submissions and result click-through.
- **Test plan**: Component tests + end-to-end search flow test.
- **Labels**: `ui`, `core`

---

## M2 Insights Layer (Issues 9-13)

### 9) Duplicate detector (hash + size grouping)
- **Goal**: Identify exact duplicates safely.
- **User value**: Recover wasted storage.
- **Acceptance criteria**: Duplicate sets include canonical suggestion and confidence.
- **Safety constraints**: No direct deletion; findings only.
- **Telemetry/logging**: Duplicate sets found, bytes reclaimable estimate.
- **Test plan**: Fixture-based duplicate matching tests.
- **Labels**: `core`, `performance`

### 10) Stale file detector
- **Goal**: Flag files likely unused over configurable windows.
- **User value**: Identify archival candidates.
- **Acceptance criteria**: Threshold options (6m/1y/2y/custom) and rationale fields.
- **Safety constraints**: Suggestions only.
- **Telemetry/logging**: Detector run counts and stale candidate distribution.
- **Test plan**: Unit tests for recency logic edge cases.
- **Labels**: `core`

### 11) Storage hog analyzer ("Explain my computer")
- **Goal**: Break down space usage by folder and file class.
- **User value**: Immediate insight into disk consumption.
- **Acceptance criteria**: Top folders/files and percentage breakdown.
- **Safety constraints**: Read-only analyzer.
- **Telemetry/logging**: Analysis duration and category coverage.
- **Test plan**: Snapshot tests for breakdown output.
- **Labels**: `core`, `ui`

### 12) Insights UI MVP
- **Goal**: Build insights screen with duplicates/stale/large tabs.
- **User value**: One place to review cleanup opportunities.
- **Acceptance criteria**: Sort/filter findings and stage candidate actions.
- **Safety constraints**: Stage only; execution needs confirmation flow.
- **Telemetry/logging**: Finding views and staging interactions.
- **Test plan**: End-to-end test for viewing and staging findings.
- **Labels**: `ui`

### 13) Action staging model and preview DTO
- **Goal**: Define shared structure for staged actions and preview payloads.
- **User value**: Clear understanding before changes occur.
- **Acceptance criteria**: Typed schema used across insights/search/assistant.
- **Safety constraints**: Preview payload required before confirmation.
- **Telemetry/logging**: Staging lifecycle events.
- **Test plan**: Contract tests for preview schema validation.
- **Labels**: `core`, `safety`

---

## M3 Assistant Layer (Issues 14-17)

### 14) Ollama integration adapter
- **Goal**: Implement local model client with configurable model selection.
- **User value**: Local AI assistance without cloud dependency.
- **Acceptance criteria**: Health check, invoke, timeout, retry behavior.
- **Safety constraints**: Adapter has no filesystem mutation methods.
- **Telemetry/logging**: Invocation latency, token usage estimates, failures.
- **Test plan**: Mocked adapter tests + runtime smoke test.
- **Labels**: `ai`, `core`

### 15) Folder summarization endpoint
- **Goal**: Generate concise folder summaries based on metadata/content snippets.
- **User value**: Quickly understand unknown folders.
- **Acceptance criteria**: Summary includes key file groups and confidence notes.
- **Safety constraints**: Summaries cite source scope; no action execution.
- **Telemetry/logging**: Summary request counts and latency.
- **Test plan**: Deterministic fixture prompts and response shape tests.
- **Labels**: `ai`, `core`

### 16) Assistant Q&A over indexed files
- **Goal**: Answer natural language questions with file-grounded context.
- **User value**: Ask "where is X?" without manual hunting.
- **Acceptance criteria**: Response includes references to relevant files/folders.
- **Safety constraints**: Suggestions only; action buttons route to staging.
- **Telemetry/logging**: Question classes, source recall rate, failure modes.
- **Test plan**: Retrieval-augmented QA integration tests.
- **Labels**: `ai`, `ui`

### 17) Contextual suggestion cards
- **Goal**: Show proactive but safe recommendations in home/assistant views.
- **User value**: Useful guidance without noisy automation.
- **Acceptance criteria**: Cards include reason, impact estimate, and dismiss action.
- **Safety constraints**: "Apply" routes to preview/confirmation flow.
- **Telemetry/logging**: Suggestion impression/accept/dismiss metrics.
- **Test plan**: UI tests for card lifecycle and routing.
- **Labels**: `ui`, `ai`, `safety`

---

## M4 Controlled Automation (Issues 18-20)

### 18) Rule schema and simulation engine
- **Goal**: Define automation rule DSL and dry-run evaluator.
- **User value**: Confidence in automation before activation.
- **Acceptance criteria**: Simulations output deterministic preview payload.
- **Safety constraints**: Simulation cannot mutate files.
- **Telemetry/logging**: Rule simulation events and validation errors.
- **Test plan**: Rule parser and simulation snapshot tests.
- **Labels**: `core`, `safety`

### 19) Rule activation UX and policy prompts
- **Goal**: Build UI to create/edit/activate rules with explicit scope.
- **User value**: Controlled automation onboarding.
- **Acceptance criteria**: Activation requires policy acknowledgment and preview.
- **Safety constraints**: No hidden activation, clear disable controls.
- **Telemetry/logging**: Rule activation/deactivation audit entries.
- **Test plan**: End-to-end activation flow tests.
- **Labels**: `ui`, `safety`

### 20) Safety gate execution + rollback MVP
- **Goal**: Finalize confirm-token flow, executeConfirmed path, and rollback API.
- **User value**: Trustworthy and reversible actions.
- **Acceptance criteria**: Non-replayable tokens, action log linkage, rollback coverage matrix.
- **Safety constraints**: Hard block when preview and execution payload diverge.
- **Telemetry/logging**: Full action lifecycle logs.
- **Test plan**: Integration tests for preview->confirm->execute->rollback.
- **Labels**: `core`, `safety`, `performance`

---

## Labeling and Difficulty Guidance

- `good-first-issue`: Apply to scoped UI polish, docs, and isolated detector improvements.
- `core`: Cross-module implementation work.
- `ai`: Embeddings, retrieval, assistant orchestration.
- `safety`: Confirmation, policy, execution gate, and audit behavior.
- `performance`: Indexing/query optimization and heavy-path profiling tasks.
