# Chunk-Level Embeddings Design

## Goal

Large files should be searchable by the sections that match a query, not only by a single file-level embedding made from the file prefix. Chunk-level embeddings add section retrieval while preserving the current file-level search API and local-first trust rules.

## Current State

- `packages/search` builds one embedding input per indexed file.
- `packages/shared-db` stores one embedding pointer per `(file_id, model)`.
- Hybrid search combines keyword results with semantic file scores.
- The indexer already owns ignore patterns, max depth, and file-size guardrails. Chunking must reuse those boundaries instead of reading new paths directly.

## Proposed Data Model

Add a new table instead of storing JSON arrays in `embeddings.vector_ref`.

```sql
CREATE TABLE IF NOT EXISTS embedding_chunks(
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id),
  model TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  preview TEXT NOT NULL,
  vector_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(file_id, model, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embedding_chunks_file_id ON embedding_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_model ON embedding_chunks(model);
```

Rationale:

- Rows can be deleted or refreshed per file without rewriting a large JSON payload.
- Query-time ranking can keep the top chunk per file while still exposing the matching snippet later.
- The existing `embeddings` table can remain as a file-level cache during migration.

## Chunking Rules

- Only chunk files that pass the existing indexer and `isProbablyTextualFile` checks.
- Reuse the current embedding text source path in `buildEmbeddingInput`, then split the textual content into bounded chunks.
- Default chunk target: about 1,200-1,800 characters.
- Default overlap: about 150-250 characters.
- Hard cap chunks per file with an environment variable such as `SEARCH_MAX_CHUNKS_PER_FILE`, defaulting to a conservative value.
- Store a short `preview` for UI/debug display, not full file contents.

## Indexing Flow

1. `SearchService.indexFileEmbedding(fileId)` continues to update the file-level embedding for backward compatibility.
2. A new `indexFileEmbeddingChunks(fileId)` deletes old chunk rows for `(fileId, model)` and inserts fresh chunk rows.
3. `warmEmbeddingsForRecentFiles()` can call the chunk indexer after file-level indexing when chunking is enabled.
4. `removeFileEmbedding(fileId)` deletes both file-level and chunk-level rows.

This keeps existing callers working while allowing chunk indexing to be turned on gradually.

## Query Flow

1. Build the query embedding once.
2. Select candidate chunks from active files that match `SearchFilters`.
3. Rank chunks by cosine similarity.
4. Collapse chunk hits by `file_id`, keeping the strongest chunk score and preview.
5. Combine the best chunk score with keyword score in `queryHybrid`.

The public result shape can remain file-centered at first:

```ts
interface SearchResult {
  id: string;
  path: string;
  score: number;
  rationale: string;
  bestChunk?: {
    index: number;
    preview: string;
    startByte: number;
    endByte: number;
  };
}
```

## Backward Compatibility

- Existing `embeddings` rows and file-level search continue to work.
- If `embedding_chunks` is empty, semantic search falls back to file-level vectors.
- Existing API callers do not need to pass new parameters.
- A later UI can show `bestChunk.preview` when present without changing search controls.

## Migration Path

1. Add the `embedding_chunks` table in a forward-only `shared-db` migration.
2. Add chunk DAO methods:
   - `upsertEmbeddingChunk(...)`
   - `listEmbeddingChunks(filters, limit)`
   - `removeEmbeddingChunks(fileId, model?)`
3. Add chunking helpers in `packages/search`.
4. Index chunks for new or updated files first.
5. Backfill chunks lazily through `warmEmbeddingsForRecentFiles()` instead of forcing an immediate full-database rebuild.
6. Remove no old table or column in the first release.

## Safety and Privacy

- Chunking never walks the filesystem independently; it only processes files already accepted by the indexer.
- Ignore patterns, max depth, and file-size caps remain the authority.
- Chunk previews should stay short and local-only.
- No chunk data leaves the machine except through the configured local/remote embedding provider already selected by the user.
- Mutating file actions remain out of scope and continue to route through the safety layer.

## Open Decisions

- Exact chunk size and overlap should be tuned after measuring common local-file sizes.
- `vector_ref` can initially store serialized vectors, matching current behavior; a later vector-store adapter can replace it.
- UI snippet display should be follow-up work after query results expose `bestChunk`.
