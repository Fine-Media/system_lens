# GitHub issues to create (copy-paste)

Use this list when creating issues in GitHub. Each block is **Title** (issue title), **Labels** (create labels in repo settings if missing), and **Body** (issue description).

**Already implemented in the repo (skip or close duplicates):** monorepo workspaces, index roots + ignore patterns + max depth, full crawl + EPERM-safe traversal, incremental `fs.watch` (Windows/macOS; Linux is limited), SQLite + tombstoning deleted paths, hybrid search + content-aware embeddings + optional Ollama, index state (skip full crawl on restart), assistant RAG via Ollama, insights detectors (duplicates / stale / large files), automation + safety stubs, static tabbed UI, contributor docs + issue templates.

---

## Open work (recommended order)

### Issue 1 — Title: `ci: GitHub Actions workflow for build (and optional typecheck)`

**Labels:** `task`, `area:repo`

**Body:**

```markdown
## Goal

Run `npm ci`, `npm run build`, and optionally `npm run typecheck` on every PR and push to default branch.

## Acceptance criteria

- [ ] Workflow file under `.github/workflows/`
- [ ] Uses Node LTS (20 or 22) matrix optional
- [ ] Fails PR if build fails
- [ ] Document in README or CONTRIBUTING

## Notes

Monorepo root must run commands from repository root.
```

---

### Issue 2 — Title: `test: add minimal smoke tests for SharedDb and SearchService`

**Labels:** `task`, `good first issue`, `area:db`

**Body:**

```markdown
## Goal

Add automated tests so schema and search helpers do not regress silently.

## Acceptance criteria

- [ ] Test runner chosen (e.g. `node:test` built into Node, or Vitest)
- [ ] In-memory or temp-file SQLite for `SharedDb`
- [ ] At least one test: insert file + query
- [ ] Script in root `package.json` e.g. `npm test`

## Safety

Tests must not touch real user directories; use temp dirs only.
```

---

### Issue 3 — Title: `feat(db): forward-only migration runner for SQLite schema`

**Labels:** `feature`, `area:db`

**Body:**

```markdown
## Goal

Replace one-shot `CREATE TABLE IF NOT EXISTS` bootstrap with versioned migrations so schema changes are explicit and auditable.

## Acceptance criteria

- [ ] `schema_migrations` (or equivalent) table
- [ ] Migrations run in order on app startup
- [ ] Document how to add a new migration for contributors

## Non-goals

Full downgrade/rollback of migrations (document as forward-only unless we add it later).
```

---

### Issue 4 — Title: `feat(indexer): recursive watch on Linux or documented fallback`

**Labels:** `feature`, `area:indexer`, `help wanted`

**Body:**

```markdown
## Context

`fs.watch` with `{ recursive: true }` is not supported for directory trees on Linux the same way as Windows/macOS. Today we fall back to non-recursive watch.

## Goal

Either implement a reliable recursive strategy on Linux (e.g. bounded `chokidar` dependency or manual subtree registration) OR document limitations and recommend periodic full reindex.

## Acceptance criteria

- [ ] Behavior documented in README
- [ ] No silent data loss; debounced rescans still safe
```

---

### Issue 5 — Title: `feat(search): chunk-level embeddings for large files`

**Labels:** `feature`, `area:search`, `ai`

**Body:**

```markdown
## Context

Embeddings currently use a single vector per file from a text prefix. Very large files may be poorly represented.

## Goal

Split text into chunks, embed each chunk, retrieve top chunks at query time (design TBD: new table vs. JSON array).

## Acceptance criteria

- [ ] Design doc in `docs/architecture/` or issue discussion
- [ ] Backward compatible or migration path

## Safety

Respect existing ignore patterns and max size limits; do not exfiltrate paths outside index roots.
```

---

### Issue 6 — Title: `feat(ui): search results — filters, sorting, and open-in-folder`

**Labels:** `feature`, `area:desktop`, `ui`

**Body:**

```markdown
## Goal

Improve `apps/desktop/public/index.html` search UX: extension filter, sort by name/date/size, and copy path / reveal folder (where the OS allows).

## Acceptance criteria

- [ ] Uses existing `/api/search` (extend API if needed with query params)
- [ ] Accessible controls (keyboard + labels)
- [ ] No destructive actions without preview (align with trust model)

## Notes

Electron shell is out of scope for this issue; browser-only is fine.
```

---

### Issue 7 — Title: `feat(desktop): Electron shell wrapping HTTP server`

**Labels:** `feature`, `area:desktop`, `help wanted`

**Body:**

```markdown
## Goal

Package the existing Node HTTP server + static UI into an Electron app for a native window and simpler distribution.

## Acceptance criteria

- [ ] Electron launches server subprocess or in-process server
- [ ] Loads UI at `http://localhost:<port>` or `loadFile` for static build
- [ ] Document build/run in README

## Non-goals

Mac/Windows notarization (optional follow-up).
```

---

### Issue 8 — Title: `chore: guardrail — prevent stubbed workspace package.json`

**Labels:** `task`, `area:repo`

**Body:**

```markdown
## Context

Some workspace packages were accidentally reduced to `"main": "./index.js"` stubs, breaking `npm start` at runtime.

## Goal

Add a small script or CI check that verifies each `packages/*/package.json` has `version`, `main` pointing to `dist/`, and `scripts.build`.

## Acceptance criteria

- [ ] `npm run check:packages` (or similar) fails on invalid manifests
- [ ] Document in CONTRIBUTING
```

---

### Issue 9 — Title: `docs: consolidate troubleshooting (ports, Ollama, SQLite experimental)`

**Labels:** `docs`

**Body:**

```markdown
## Goal

Add a **Troubleshooting** section to README (or `docs/runbook/troubleshooting.md`) covering:

- Port already in use (`EADDRINUSE`)
- Ollama not running / wrong model
- Node SQLite experimental warning
- Windows EPERM on system folders (already partially handled)

## Acceptance criteria

- [ ] Linked from README
- [ ] Short copy-paste commands for Windows PowerShell and bash where relevant
```

---

### Issue 10 — Title: `feat(insights): dismiss finding in UI and persist`

**Labels:** `feature`, `area:desktop`, `area:insights`

**Body:**

```markdown
## Goal

Expose `dismissFinding` in the API if missing and add UI control on Insights tab to dismiss duplicates/stale/hogs findings.

## Acceptance criteria

- [ ] API: `POST /api/insights/findings/:id/dismiss` or equivalent
- [ ] UI button updates list
- [ ] State persists across reloads

## Safety

Dismissal is audit-friendly only; no file deletion.
```

---

### Issue 11 — Title: `feat(assistant): stream Ollama chat responses to UI`

**Labels:** `feature`, `area:assistant`, `ai`

**Body:**

```markdown
## Goal

Use Ollama streaming API for `/api/assistant/ask` and show tokens in the Assistant tab.

## Acceptance criteria

- [ ] Server supports SSE or chunked response
- [ ] UI displays incremental text
- [ ] Graceful fallback if streaming unsupported

## Safety

Same RAG and path constraints as today; no new filesystem privileges.
```

---

### Issue 12 — Title: `feat(safety): surface action log preview in UI`

**Labels:** `feature`, `area:safety`, `ui`

**Body:**

```markdown
## Goal

Automation & Safety tab should render `/api/safety/logs` in a readable table (time, actor, status, summary) with expandable JSON.

## Acceptance criteria

- [ ] No PII beyond what is already in logs
- [ ] Large log truncation with “load more” optional

## Notes

Aligns with trust model: inspectable actions.
```

---

### Issue 13 — Title: `perf(indexer): avoid full subtree rescan on every watcher debounce`

**Labels:** `task`, `area:indexer`, `performance`

**Body:**

```markdown
## Context

`startIndexWatchers` may rescan many paths per debounce window on busy trees.

## Goal

Coalesce events per root, cap work per tick, or rescan only changed subtrees.

## Acceptance criteria

- [ ] Measurable reduction in CPU on large directories (describe benchmark method)
- [ ] No correctness regressions for tombstoning
```

---

### Issue 14 — Title: `good first issue: add LICENSE file matching project intent`

**Labels:** `good first issue`, `docs`, `area:repo`

**Body:**

```markdown
## Goal

Choose and add an open-source license (MIT, Apache-2.0, etc.) at repo root after maintainer decision.

## Acceptance criteria

- [ ] `LICENSE` file present
- [ ] `package.json` `license` field aligned
- [ ] README mentions license briefly

## Note

This issue requires a maintainer decision; contributors can propose text only.
```

---

## Label set (create once in GitHub)

Suggested labels: `bug`, `feature`, `docs`, `task`, `good first issue`, `help wanted`, `area:desktop`, `area:indexer`, `area:search`, `area:insights`, `area:assistant`, `area:safety`, `area:db`, `area:repo`, `ui`, `ai`, `performance`.

---

## Relationship to `first-20-github-issues.md`

The older [first-20-github-issues.md](./first-20-github-issues.md) document is a **milestone roadmap**. This file **reflects the current codebase** and lists **open** follow-ups you can file today.
