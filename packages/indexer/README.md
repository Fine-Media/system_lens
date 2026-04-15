# Indexer Module

Tracks local filesystem state and keeps metadata current.

## Responsibilities

- Perform initial crawl over configured roots.
- Watch for file create/update/delete/move events.
- Extract lightweight metadata (path, size, type, modified time, hash hints).
- Emit incremental updates to `shared-db`.

## Public API (proposed)

- `startIndexing(scanRoots, options)`
- `stopIndexing()`
- `rescanPath(path)`
- `getIndexerStatus()`

## Inputs

- User-approved scan roots.
- Ignore patterns and privacy exclusions.

## Outputs

- Upserts into `files` and `file_stats`.
- Change events for search embedding pipeline.

## Performance Requirements

- Avoid full rescans when watchers provide deltas.
- Use bounded concurrency for I/O-heavy hash operations.
- Record progress checkpoints for crash-safe resume.
