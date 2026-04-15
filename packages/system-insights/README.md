# System Insights Module

Analyzes file metadata to produce safe, actionable organization insights.

## Responsibilities

- Detect duplicate and near-duplicate files.
- Identify stale files based on recency thresholds.
- Report large files and storage concentration by directory/type.
- Generate explainable findings for the UI and assistant.

## Public API (proposed)

- `runDetectors(scope, detectorSet)`
- `getFindings(filters)`
- `explainStorage(scope)`
- `dismissFinding(findingId)`

## Detector Set (MVP)

1. Duplicate detector (hash + size grouping).
2. Stale file detector (last opened/modified windows).
3. Storage hog detector (large files, largest folders).

## Guardrails

- Insights are recommendations only.
- No mutating filesystem action occurs in this module.
