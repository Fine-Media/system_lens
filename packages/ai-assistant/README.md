# AI Assistant Module

Local assistant orchestration for file-aware Q&A and recommendations.

## Responsibilities

- Build context bundles from search/index/insight data.
- Query local LLM runtime (Ollama).
- Generate summaries, explanations, and suggested actions.
- Return structured suggestions with confidence and rationale.

## Public API (proposed)

- `ask(question, scope)`
- `summarizeFolder(path, depth)`
- `suggestOrganization(scope)`
- `explainComputer(scope)`

## Integration Points

- Reads from `shared-db`, `search`, and `system-insights`.
- Sends action suggestions to UI; execution must route through `safety`.

## Prompting Constraints

- Always disclose uncertainty.
- Cite source files/folders in responses when available.
- Never imply actions were taken unless action log confirms execution.
