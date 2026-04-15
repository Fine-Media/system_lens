# Safety Module

Central guardrail for all mutating filesystem operations.

## Responsibilities

- Validate whether an action is allowed by policy.
- Produce dry-run previews of intended changes.
- Issue confirmation tokens scoped to exact targets.
- Execute confirmed actions through filesystem wrappers.
- Persist structured logs and rollback metadata.

## Public API (proposed)

- `preview(actionIntent)`
- `validatePolicy(actionIntent, userPolicy)`
- `requestConfirmation(actionPreview)`
- `executeConfirmed(confirmationToken)`
- `getActionLog(filters)`
- `rollback(actionId)`

## Required Guarantees

1. No mutation without explicit confirmation.
2. Confirmation token expires and is non-replayable.
3. Execution payload must match previewed payload.
4. Action history is queryable from UI.

## Non-Goals

- No hidden background cleanup.
- No destructive automation without visible user opt-in.
