# Automation Module

Runs user-approved organization workflows under strict safety controls.

## Responsibilities

- Define and store automation rules.
- Simulate rule outcomes before activation.
- Execute active rules on schedule or trigger.
- Route every mutating operation through `safety`.

## Public API (proposed)

- `createRule(ruleDraft)`
- `simulateRule(ruleId, scope)`
- `activateRule(ruleId)`
- `deactivateRule(ruleId)`
- `executeRule(ruleId, context)`
- `listRuleRuns(filters)`

## Rule Guardrails

- Rule scope must be explicit (path/type/age constraints).
- Rules cannot include direct delete by default in MVP.
- Every rule run emits preview and audit logs.

## MVP Rule Examples

- Auto-sort Downloads by file type.
- Archive files older than N days into dated folders.
- Apply naming convention to selected directories.
