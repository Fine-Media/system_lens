# Chunk-Level Embeddings

## Context

System Lens previously embedded one vector per indexed file. That works for small files, but large files can bury useful sections because only one mixed representation is available at query time.

## Data Model

Chunk vectors are stored in `embedding_chunks`:

- `file_id`, `model`, and `chunk_index` identify a chunk.
- `start_char` and `end_char` identify the source text range within the bounded text prefix.
- `content_preview` stores a short UI/debug snippet.
- `vector_ref` keeps the serialized embedding vector, matching the existing file-level `embeddings` storage pattern.

The existing `embeddings` table is left in place for backward compatibility. `SharedDb.removeEmbedding(fileId)` now removes both file-level and chunk-level vectors so delete/tombstone cleanup stays consistent.

## Indexing Flow

`SearchService.indexFileEmbedding(fileId)` now:

1. Loads the indexed file record from `SharedDb`.
2. Builds bounded chunks with `buildEmbeddingChunks(file)`.
3. Embeds each chunk with the configured embedding provider.
4. Upserts chunk records in `embedding_chunks`.
5. Caches chunk vectors in memory for fast repeated queries.

Chunking respects the same file-type guard as the original embedding input. Non-text files, directories, and unreadable files fall back to a single path-only chunk.

## Query Flow

Semantic search embeds the user query once, then scores each candidate file by its best matching chunk. Results keep the existing file-level shape and add optional chunk metadata:

- `chunkIndex`
- `chunkStartChar`
- `chunkEndChar`
- `snippet`

Hybrid search now unions keyword and semantic matches so a semantic-only chunk match can still be returned even when the query text does not appear in the file path.

## Limits and Safety

Chunking stays bounded by environment variables:

- `SEARCH_EMBED_MAX_CHARS`: maximum text characters read for embeddings, default `32000`, capped at `200000`.
- `SEARCH_EMBED_CHUNK_CHARS`: chunk size, default `4000`.
- `SEARCH_EMBED_CHUNK_OVERLAP_CHARS`: overlap between adjacent chunks, default up to `400`.
- `SEARCH_EMBED_MAX_CHUNKS_PER_FILE`: max chunks per file, default `32`.

Search only reads file paths already present in the index database, so existing ignore patterns, index roots, and file size policies remain the source of truth for what enters the embedding pipeline.

## Migration Path

No destructive migration is required. Existing databases create `embedding_chunks` on startup through `CREATE TABLE IF NOT EXISTS`. Existing file-level vector rows can remain until a file is re-indexed or removed; new query behavior uses chunk vectors and rebuilds stale/missing chunks on demand.
