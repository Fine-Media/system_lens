import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export interface QueryFileResult {
  id: string;
  path: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export class SharedDb {
  private db: Database | null = null;

  async init(): Promise<void> {
    this.db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  async insertFile(path: string, content: string): Promise<QueryFileResult> {
    if (!this.db) throw new Error('Database not initialized');

    const id = crypto.randomUUID();
    const name = path.split('/').pop() || path;
    const now = Date.now();

    await this.db.run(
      'INSERT INTO files (id, path, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, path, name, content, now, now]
    );

    return {
      id,
      path,
      name,
      content,
      createdAt: now,
      updatedAt: now,
    };
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.all(sql, params);
  }

  async getFileById(id: string): Promise<QueryFileResult | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = await this.db.get('SELECT * FROM files WHERE id = ?', id);
    return row
      ? {
          id: row.id,
          path: row.path,
          name: row.name,
          content: row.content,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}