import crypto from "node:crypto";
import { EmbeddingChunkRecord, FileRecord, QueryFileResult, SearchFilters, SharedDb } from "@system-lens/shared-db";
import { buildEmbeddingChunks, buildEmbeddingInput } from "./text-for-embedding.js";

export interface SearchResult extends QueryFileResult {
  rationale: string;
  chunkIndex?: number;
  chunkStartChar?: number;
  chunkEndChar?: number;
  snippet?: string;
}

export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
  /** Label stored with embeddings (e.g. `deterministic-v1`, `ollama:nomic-embed-text`). */
  modelLabel(): string;
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  modelLabel(): string {
    return "deterministic-v1";
  }

  async embedText(text: string): Promise<number[]> {
    const bytes = crypto.createHash("sha256").update(text).digest();
    return Array.from({ length: 16 }, (_, index) => bytes[index] / 255);
  }
}

/**
 * Uses Ollama's `/api/embeddings` endpoint. Requires a running Ollama instance and a pulled
 * embedding model (for example `ollama pull nomic-embed-text`).
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  modelLabel(): string {
    return `ollama:${this.model}`;
  }

  async embedText(text: string): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama embeddings failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as { embedding?: number[]; embeddings?: number[][] };
    const vector = data.embedding ?? data.embeddings?.[0];
    if (!vector?.length) {
      throw new Error("Ollama embeddings response missing embedding vector.");
    }
    return vector;
  }
}

/**
 * Prefer Ollama when `OLLAMA_HOST` or `OLLAMA_BASE_URL` is set; otherwise deterministic hashes.
 * Override model with `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`).
 */
export { buildEmbeddingChunks, buildEmbeddingInput, isProbablyTextualFile } from "./text-for-embedding.js";

export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const raw = process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL;
  const model = (process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text").trim();
  if (raw?.trim()) {
    return new OllamaEmbeddingProvider(raw.trim(), model);
  }
  return new DeterministicEmbeddingProvider();
}

interface CachedChunkVector extends EmbeddingChunkRecord {
  vector: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  const size = Math.min(a.length, b.length);
  for (let index = 0; index < size; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class SearchService {
  private readonly db: SharedDb;
  private readonly embedder: EmbeddingProvider;
  private readonly chunkEmbeddingCache = new Map<string, CachedChunkVector[]>();

  constructor(db: SharedDb, embedder: EmbeddingProvider = new DeterministicEmbeddingProvider()) {
    this.db = db;
    this.embedder = embedder;
  }

  async indexFileEmbedding(fileId: string): Promise<void> {
    const file = this.db.getFileById(fileId);
    if (!file) {
      throw new Error(`Cannot index missing file: ${fileId}`);
    }

    const cacheKey = this.cacheKey(fileId);
    this.chunkEmbeddingCache.delete(cacheKey);
    this.db.removeEmbedding(fileId);

    const chunks = await buildEmbeddingChunks(file);
    const cachedChunks: CachedChunkVector[] = [];
    for (const chunk of chunks) {
      const vector = await this.embedder.embedText(chunk.text);
      const record = this.db.upsertEmbeddingChunk({
        fileId,
        model: this.embedder.modelLabel(),
        chunkIndex: chunk.chunkIndex,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        contentPreview: chunk.preview,
        vectorRef: JSON.stringify(vector),
      });
      cachedChunks.push({ ...record, vector });
    }

    this.chunkEmbeddingCache.set(cacheKey, cachedChunks);
  }

  /**
   * Pre-compute embeddings for recently updated files (by DB order). Useful after a full index
   * when Ollama is available. Controlled by `SEARCH_WARM_EMBEDDINGS_MAX` from the desktop server.
   */
  async warmEmbeddingsForRecentFiles(maxFiles: number, filters: SearchFilters = {}): Promise<{
    processed: number;
    failed: number;
  }> {
    if (maxFiles <= 0) {
      return { processed: 0, failed: 0 };
    }

    const cap = Math.min(Math.max(maxFiles * 4, 5_000), 50_000);
    const rows = this.db.listFiles(cap);
    let processed = 0;
    let failed = 0;
    let tried = 0;

    for (const file of rows) {
      if (tried >= maxFiles) {
        break;
      }
      if (file.type !== "file") {
        continue;
      }
      if (filters.pathPrefix && !file.path.startsWith(filters.pathPrefix)) {
        continue;
      }

      tried += 1;
      try {
        await this.indexFileEmbedding(file.id);
        processed += 1;
      } catch {
        failed += 1;
      }
    }

    return { processed, failed };
  }

  removeFileEmbedding(fileId: string): void {
    this.chunkEmbeddingCache.delete(this.cacheKey(fileId));
    this.db.removeEmbedding(fileId);
  }

  async querySemantic(text: string, filters: SearchFilters = {}, limit = 20): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embedText(text);
    const candidates = this.db.queryFilesByText("", filters, 2_000);
    const results: SearchResult[] = [];

    for (const candidate of candidates) {
      const chunks = await this.getFileChunkVectors(candidate);
      if (chunks.length === 0) {
        continue;
      }

      let bestChunk: CachedChunkVector | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryEmbedding, chunk.vector);
        if (score > bestScore) {
          bestScore = score;
          bestChunk = chunk;
        }
      }

      if (!bestChunk) {
        continue;
      }

      results.push({
        ...candidate,
        score: bestScore,
        rationale: `Semantic vector similarity (${this.embedder.modelLabel()}) on chunk ${bestChunk.chunkIndex + 1}.`,
        chunkIndex: bestChunk.chunkIndex,
        chunkStartChar: bestChunk.startChar,
        chunkEndChar: bestChunk.endChar,
        snippet: bestChunk.contentPreview,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async queryHybrid(text: string, filters: SearchFilters = {}, limit = 20): Promise<SearchResult[]> {
    const textResults = this.db.queryFilesByText(text, filters, 2_000);
    const semanticResults = await this.querySemantic(text, filters, 2_000);
    const semanticById = new Map(semanticResults.map((entry) => [entry.id, entry]));
    const textById = new Map(textResults.map((entry) => [entry.id, entry]));
    const candidateIds = new Set([...textById.keys(), ...semanticById.keys()]);

    const combined = Array.from(candidateIds).map((id) => {
      const textResult = textById.get(id);
      const semanticResult = semanticById.get(id);
      const baseResult = textResult ?? semanticResult;
      if (!baseResult) {
        throw new Error(`Missing search result for ${id}.`);
      }
      const semanticScore = semanticResult?.score ?? 0;
      const keywordScore = textResult?.score ?? 0;
      const score = keywordScore * 0.5 + semanticScore * 0.5;

      return {
        ...baseResult,
        score,
        rationale:
          semanticResult !== undefined
            ? `Hybrid score combines keyword match and semantic chunk similarity.${semanticResult.snippet ? ` Best chunk: ${semanticResult.snippet}` : ""}`
            : "Keyword score only because semantic vector was unavailable.",
        chunkIndex: semanticResult?.chunkIndex,
        chunkStartChar: semanticResult?.chunkStartChar,
        chunkEndChar: semanticResult?.chunkEndChar,
        snippet: semanticResult?.snippet,
      };
    });

    return combined.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private cacheKey(fileId: string): string {
    return `${this.embedder.modelLabel()}:${fileId}`;
  }

  private async getFileChunkVectors(file: FileRecord): Promise<CachedChunkVector[]> {
    const cacheKey = this.cacheKey(file.id);
    const cached = this.chunkEmbeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const stored = this.db
      .listEmbeddingChunks(file.id, this.embedder.modelLabel())
      .filter((record) => record.updatedAt >= file.updatedAt);
    const restored: CachedChunkVector[] = [];

    for (const record of stored) {
      const vector = this.parseVector(record.vectorRef);
      if (vector) {
        restored.push({ ...record, vector });
      }
    }

    if (restored.length > 0) {
      this.chunkEmbeddingCache.set(cacheKey, restored);
      return restored;
    }

    await this.indexFileEmbedding(file.id);
    return this.chunkEmbeddingCache.get(cacheKey) ?? [];
  }

  private parseVector(vectorRef: string): number[] | null {
    try {
      const parsed = JSON.parse(vectorRef) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }
      const vector = parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return vector.length > 0 ? vector : null;
    } catch {
      return null;
    }
  }
}
