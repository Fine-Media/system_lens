# System Lens

System Lens is a trust-first desktop app that helps users understand, search, and organize local files with local AI.

## Run the project

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and npm (included with Node).

All commands below are run from the **repository root** (the folder that contains `package.json`).

| Step | What to run |
|------|-------------|
| **1. Install all packages** | `npm install` |
| **2. Build TypeScript** | `npm run build` |
| **3. Start the server** | `npm --workspace @system-lens/desktop start` |

**Open the app:** [http://localhost:3180](http://localhost:3180)

**Optional — different port** (PowerShell): set `PORT` then start:

```powershell
$env:PORT=3190; npm --workspace @system-lens/desktop start
```

**One-shot flow** (copy-paste after `cd` into the repo):

```bash
npm install
npm run build
npm --workspace @system-lens/desktop start
```

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

## Repository Shape

- `apps/desktop`: Electron shell and user interaction flows.
- `packages/indexer`: file crawling and incremental filesystem sync.
- `packages/search`: embedding and semantic retrieval services.
- `packages/system-insights`: non-destructive analyzers.
- `packages/ai-assistant`: local AI orchestration.
- `packages/safety`: guardrails, confirmation gates, and rollback.
- `packages/automation`: policy-bound automation runner.
- `packages/shared-db`: SQLite schema and access contracts.
- `docs`: architecture, security, product and contributor guidance.
