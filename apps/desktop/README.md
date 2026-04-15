# Desktop App Module

Electron-based UI and interaction layer for System Lens.

## Responsibilities

- Render main views: Home, Search, Insights, Assistant, Automation, Action Center.
- Collect user input and map it to service calls.
- Show preview payloads for all mutating actions.
- Require explicit confirmation before dispatching execution.
- Display action logs and rollback affordances where supported.

## Boundaries

- May call domain APIs exposed by core services.
- Must not directly perform filesystem mutation.
- Must treat assistant suggestions as suggestions, not commands.

## Primary Interfaces

- `SearchController`: natural language and faceted search UX.
- `InsightsController`: detector findings and action staging.
- `AssistantController`: Q&A, summaries, and recommendation prompts.
- `ActionCenterController`: pending approvals, execution history, rollback prompts.

## MVP UX Constraints

1. Show scope before action (`N files`, `estimated impact`, `paths`).
2. Require one-click explicit approval for each action batch.
3. Preserve undo or mitigation guidance if rollback is unsupported.
