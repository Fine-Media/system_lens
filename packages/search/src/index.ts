import crypto from 'node:crypto';
import { QueryFileResult, SearchFilters, SharedDb } from '@system-lens/shared-db';
import { buildEmbeddingInput } from './text-for-embedding.js';

export interface SearchResult extends QueryFileResult {
  rationale: string;
}

export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
  /** Label stored with embeddings (e.g. `deterministic-v1`, `ollama:nomic-embed-text`). */
  modelLabel(): string;
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  modelLabel(): string {
    return 'deterministic-v1';
  }

  async embedText(text: string): Promise<number[]> {
    const bytes = crypto.createHash('sha256').update(text).digest();
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
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama embeddings failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as { embedding?: number[]; embeddings?: number[][] };
    const vector = data.embedding ?? data.embeddings?.[0];
    if (!vector?.length) {
      throw new Error('Ollama embeddings response missing embedding vector.');
    }
    return vector;
  }
}

/**
 * Prefer Ollama when `OLLAMA_HOST` or `OLLAMA_BASE_URL` is set; otherwise deterministic hashes.
 * Override model with `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`).
 */
export { buildEmbeddingInput, isProbablyTextualFile } from './text-for-embedding.js';

export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const raw = process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL;
  const model = (process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text').trim();
  if (raw?.trim()) {
    return new OllamaEmbeddingProvider(raw.trim(), model);
  }
  return new DeterministicEmbeddingProvider();
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
  private readonly embeddingCache = new Map<string, number[]>();

  constructor(db: SharedDb, embedder: EmbeddingProvider = new DeterministicEmbeddingProvider()) {
    this.db = db;
    this.embedder = embedder;
  }

  async indexFileEmbedding(fileId: string): Promise<void> {
    const file = this.db.getFileById(fileId);
    if (!file) {
      throw new Error(`Cannot index missing file: ${fileId}`);
    }

    this.embeddingCache.delete(fileId);
    const input = await buildEmbeddingInput(file);
    const vector = await this.embedder.embedText(input);
    this.embeddingCache.set(fileId, vector);
    this.db.upsertEmbedding(fileId, this.embedder.modelLabel(), JSON.stringify(vector));
  }

  /**
   * Pre-compute embeddings for recently updated files (by DB order). Useful after a full index
   * when Ollama is available. Controlled by `SEARCH_WARM_EMBEDDINGS_MAX` from the desktop server.
   */
  async warmEmbeddingsForRecentFiles(
    maxFiles: number,
    filters: SearchFilters = {},
  ): Promise<{
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
      if (file.type !== 'file') {
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
    this.embeddingCache.delete(fileId);
    this.db.removeEmbedding(fileId);
  }

  async querySemantic(
    text: string,
    filters: SearchFilters = {},
    limit = 20,
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embedText(text);
    const candidates = this.db.queryFilesByText('', filters, 2_000);
    const results: SearchResult[] = [];

    for (const candidate of candidates) {
      if (!this.embeddingCache.has(candidate.id)) {
        await this.indexFileEmbedding(candidate.id);
      }

      const vector = this.embeddingCache.get(candidate.id);
      if (!vector) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, vector);
      results.push({
        ...candidate,
        score,
        rationale: `Semantic vector similarity (${this.embedder.modelLabel()}).`,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async queryHybrid(
    text: string,
    filters: SearchFilters = {},
    limit = 20,
  ): Promise<SearchResult[]> {
    const textResults = this.db.queryFilesByText(text, filters, 2_000);
    const semanticResults = await this.querySemantic(text, filters, 2_000);
    const semanticById = new Map(semanticResults.map((entry) => [entry.id, entry]));

    const combined = textResults.map((textResult) => {
      const semanticResult = semanticById.get(textResult.id);
      const semanticScore = semanticResult?.score ?? 0;
      const score = textResult.score * 0.5 + semanticScore * 0.5;

      return {
        ...textResult,
        score,
        rationale:
          semanticResult !== undefined
            ? 'Hybrid score combines keyword match and semantic similarity.'
            : 'Keyword score only because semantic vector was unavailable.',
      };
    });

    return combined.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
