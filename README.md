# System Lens

System Lens is a trust-first desktop app that helps users understand, search, and organize local files with local AI.

## Run the project

### Prerequisites

- [Node.js](https://nodejs.org/) **18+** and **npm** (npm is included with Node).
- Check your versions:

```bash
node -v
npm -v
```

### Repository root

All commands below must be run from the **repository root** (the folder that contains the root `package.json`), not from `apps/desktop` alone.

```bash
cd path/to/system_lens
```

### Steps

| Step | Command |
|------|---------|
| **1. Install dependencies** | `npm install` |
| **2. Build TypeScript** | `npm run build` |
| **3. Start the server** | `npm --workspace @system-lens/desktop start` |

Leave the terminal running after step 3.

**Open the app:** [http://localhost:3180](http://localhost:3180)

### One-shot (after `cd` into the repo)

```bash
npm install
npm run build
npm --workspace @system-lens/desktop start
```

### Optional — different port (PowerShell)

```powershell
$env:PORT = "3190"
npm --workspace @system-lens/desktop start
```

### Optional — Ollama (embeddings + assistant chat)

1. Install and run [Ollama](https://ollama.com/) on your machine.
2. Pull models you plan to use, for example:

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
```

(`OLLAMA_EMBED_MODEL` defaults to `nomic-embed-text`; `OLLAMA_CHAT_MODEL` defaults to `llama3.2` — set them if you use other model names.)

3. Point the app at Ollama and start (same terminal session):

**PowerShell**

```powershell
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
npm --workspace @system-lens/desktop start
```

**Bash**

```bash
export OLLAMA_HOST=http://127.0.0.1:11434
npm --workspace @system-lens/desktop start
```

### First run and local files

- The first successful run performs a **full index** (or after index state is reset). Later starts **skip** repeating the full crawl unless you force it (see env vars below).
- **Index config and state** live under **`.system-lens/`** in the repo root (for example `index-config.json`, `index-state.json`).
- The SQLite database is **`.system-lens.sqlite`** in the repo root.

### Optional environment variables

| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` | Desktop server log verbosity: `debug`, `info`, `warn`, or `error` (default **info**). Logs are JSON lines on stdout/stderr. |
| `PORT` | HTTP port (default **3180**). |
| `OLLAMA_HOST` or `OLLAMA_BASE_URL` | Ollama base URL for embeddings and assistant chat. |
| `OLLAMA_EMBED_MODEL` | Embedding model name (default `nomic-embed-text`). |
| `OLLAMA_CHAT_MODEL` | Chat model name (default `llama3.2`). |
| `INDEX_FORCE_FULL` | Set to `1` to run a full index on the next startup. |
| `INDEX_FULL_ON_START` | Set to `1` to run a full index on **every** startup (heavy). |
| `INDEX_WATCH` | Set to `0` to disable filesystem watchers. |
| `SEARCH_WARM_EMBEDDINGS_MAX` | After a full index, pre-warm embeddings for up to this many files (async; `0` = off). |

If the server fails with **address already in use** on port 3180, stop the other process using that port or set `PORT` to a free port.

## What it is

- AI-powered file intelligence over your local machine.
- Semantic search across filenames and content.
- Actionable system insights (duplicates, stale files, large storage hogs).
- Assistant-style guidance for organization and cleanup.

## What it is not

- Not a silent cleaner.
- Not a fully autonomous agent.
- Not a background process that mutates files without consent.

## Trust Model

Safety is a product feature, not an afterthought:

1. No destructive action without preview.
2. No mutating action without explicit user confirmation.
3. Every action is logged and inspectable.
4. Rollback is provided when technically possible.
5. Local-first AI by default (Ollama runtime).

## Initial Milestones

- M1: Smart search app (indexing + semantic retrieval + basic chat).
- M2: Insights layer (duplicates, stale files, storage breakdown).
- M3: Assistant layer (folder summaries + contextual suggestions).
- M4: Controlled automation (user-approved rules only).

## Contributing

We welcome issues and pull requests. Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** for issue kinds, dev setup, and PR expectations. See **[CONTRIBUTORS.md](CONTRIBUTORS.md)** for how attribution works and how to join as a maintainer or community contributor. This project uses the **[Code of Conduct](CODE_OF_CONDUCT.md)**. Report security issues privately per **[SECURITY.md](SECURITY.md)**.

When you open an issue, GitHub offers templates for **bugs**, **features**, **tasks/chores**, and **documentation**.

**Ready-made backlog (copy into GitHub):** [docs/project/GITHUB_ISSUES_TO_CREATE.md](docs/project/GITHUB_ISSUES_TO_CREATE.md).

## Repository Shape

- `apps/desktop`: HTTP server and static UI (MVP; Electron shell planned).
- `packages/indexer`: file crawling and incremental filesystem sync.
- `packages/search`: embedding and semantic retrieval services.
- `packages/system-insights`: non-destructive analyzers.
- `packages/ai-assistant`: local AI orchestration.
- `packages/safety`: guardrails, confirmation gates, and rollback.
- `packages/automation`: policy-bound automation runner.
- `packages/shared-db`: SQLite schema and access contracts.
- `docs`: architecture, security, product and contributor guidance.
