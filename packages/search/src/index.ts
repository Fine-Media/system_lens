import crypto from "node:crypto";
import { QueryFileResult, SearchFilters, SharedDb } from "@system-lens/shared-db";

export interface SearchResult extends QueryFileResult {
  rationale: string;
}

export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  async embedText(text: string): Promise<number[]> {
    const bytes = crypto.createHash("sha256").update(text).digest();
    return Array.from({ length: 16 }, (_, index) => bytes[index] / 255);
  }
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
    const file = this.db.listFiles(5_000).find((record) => record.id === fileId);
    if (!file) {
      throw new Error(`Cannot index missing file: ${fileId}`);
    }

    const vector = await this.embedder.embedText(file.path);
    this.embeddingCache.set(fileId, vector);
    this.db.upsertEmbedding(fileId, "deterministic-v1", JSON.stringify(vector));
  }

  removeFileEmbedding(fileId: string): void {
    this.embeddingCache.delete(fileId);
    this.db.removeEmbedding(fileId);
  }

  async querySemantic(text: string, filters: SearchFilters = {}, limit = 20): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embedText(text);
    const candidates = this.db.queryFilesByText("", filters, 2_000);
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
        rationale: "Semantic vector similarity over file path signal.",
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async queryHybrid(text: string, filters: SearchFilters = {}, limit = 20): Promise<SearchResult[]> {
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
            ? "Hybrid score combines keyword match and semantic similarity."
            : "Keyword score only because semantic vector was unavailable.",
      };
    });

    return combined.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
