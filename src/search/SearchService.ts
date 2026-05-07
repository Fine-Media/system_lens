import { SharedDb, QueryFileResult } from '../db/SharedDb';

export interface SearchResult extends QueryFileResult {
  score: number;
}

export class SearchService {
  private readonly db: SharedDb;

  constructor(db: SharedDb) {
    this.db = db;
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const rows = await this.db.query<QueryFileResult>(
      `SELECT * FROM files WHERE name LIKE ? OR content LIKE ?`,
      [`%${query}%`, `%${query}%`]
    );

    return rows.map((row) => ({
      ...row,
      score: this.calculateRelevanceScore(row, query),
    }));
  }

  private calculateRelevanceScore(file: QueryFileResult, query: string): number {
    const nameMatch = file.name.toLowerCase().includes(query.toLowerCase()) ? 0.6 : 0;
    const contentMatch = file.content?.toLowerCase().includes(query.toLowerCase()) ? 0.4 : 0;
    return nameMatch + contentMatch;
  }
}