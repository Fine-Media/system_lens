# Search Module

Provides semantic retrieval over local files and metadata.

## Responsibilities

- Manage embedding generation lifecycle.
- Store and query vector references tied to file IDs.
- Support natural-language search with metadata filters.
- Return explainable result metadata (why it matched).

## Public API (proposed)

- `indexFileEmbedding(fileId)`
- `removeFileEmbedding(fileId)`
- `querySemantic(text, filters, limit)`
- `queryHybrid(text, filters, limit)` (keyword + semantic)

## Dependencies

- `shared-db` for metadata and embedding pointers.
- Local embedding runtime/provider.

## Safety Notes

- Search is read-only.
- Any action from a result card routes to `safety` and never executes directly.

## MVP Success Criteria

- Query latency under practical desktop thresholds.
- Relevance ranking combines textual and semantic signals.
- Filters support path, file type, recency, and size.
