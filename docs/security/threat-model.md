# Threat Model

## Security Objectives

- Preserve user control over filesystem mutations.
- Prevent unauthorized or accidental destructive actions.
- Keep sensitive local data local by default.

## Threats

1. **Accidental destructive action**
   - Risk: User confirms a broad operation unintentionally.
   - Mitigation: Preview diff, scope warnings, confirmation step.

2. **Policy bypass**
   - Risk: Internal module mutates files without safety checks.
   - Mitigation: Centralized `safety` gateway and module contract enforcement.

3. **Prompt-induced unsafe actions**
   - Risk: LLM suggests or appears to execute risky actions.
   - Mitigation: Assistant responses are advisory; no direct filesystem access.

4. **Data leakage**
   - Risk: File content exfiltration through remote APIs.
   - Mitigation: Local-first model runtime and explicit opt-in for any remote integrations.

5. **Replay of old confirmations**
   - Risk: Reusing stale approvals.
   - Mitigation: Expiring non-replayable confirmation tokens.

## Trust Guarantees to Users

- No hidden processes performing destructive cleanup.
- No auto-delete in MVP.
- Audit trail for all mutating actions.
- Clear indication of what can and cannot be rolled back.

## Security Backlog Priorities

- Add signed action log records.
- Add sandboxing for high-risk filesystem operations.
- Add optional encrypted DB mode for metadata at rest.
