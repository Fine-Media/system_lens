import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SharedDb } from '@system-lens/shared-db';
import type { IndexerOptions, IndexerStatus } from './types.js';

export * from './types.js';

export class IndexerService {
  private readonly db: SharedDb;
  private readonly status: IndexerStatus;
  private isStopped = false;

  constructor(db: SharedDb) {
    this.db = db;
    this.status = {
      running: false,
      scannedFiles: 0,
      scannedDirs: 0,
      lastRunAt: null,
    };
  }

  async startIndexing(scanRoots: string[], options: IndexerOptions = {}): Promise<IndexerStatus> {
    this.status.running = true;
    this.isStopped = false;
    this.status.scannedFiles = 0;
    this.status.scannedDirs = 0;

    try {
      for (const root of scanRoots) {
        if (this.isStopped) {
          break;
        }

        await this.indexPath(root, options, 0);
      }

      this.status.lastRunAt = new Date().toISOString();
      return this.getIndexerStatus();
    } finally {
      this.status.running = false;
    }
  }

  stopIndexing(): void {
    this.isStopped = true;
    this.status.running = false;
  }

  async rescanPath(targetPath: string, options: IndexerOptions = {}): Promise<void> {
    await this.indexPath(targetPath, options, 0);
  }

  getIndexerStatus(): IndexerStatus {
    return { ...this.status };
  }

  private async indexPath(
    currentPath: string,
    options: IndexerOptions,
    depth: number,
  ): Promise<void> {
    if (this.isStopped) {
      return;
    }

    if (options.maxDepth !== undefined && depth > options.maxDepth) {
      return;
    }

    if (this.isIgnored(currentPath, options.ignorePatterns)) {
      return;
    }

    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(currentPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.db.tombstonePathAndDescendants(currentPath);
      }
      return;
    }

    const updatedAt = stats.mtime.toISOString();
    const createdAt = stats.birthtime.toISOString();

    if (stats.isDirectory()) {
      this.status.scannedDirs += 1;
      this.db.upsertFile({
        path: currentPath,
        type: 'directory',
        createdAt,
        updatedAt,
        sizeBytes: stats.size,
      });

      const entries = await fs.readdir(currentPath).catch((readErr: unknown) => {
        const code = (readErr as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          this.db.tombstonePathAndDescendants(currentPath);
        }
        return [] as string[];
      });
      for (const entry of entries) {
        await this.indexPath(path.join(currentPath, entry), options, depth + 1);
      }
      return;
    }

    if (stats.isSymbolicLink()) {
      this.status.scannedFiles += 1;
      this.db.upsertFile({
        path: currentPath,
        type: 'symlink',
        createdAt,
        updatedAt,
        sizeBytes: stats.size,
      });
      return;
    }

    if (!stats.isFile()) {
      return;
    }

    this.status.scannedFiles += 1;
    const hashHint = await this.computeHashHint(currentPath).catch(() => undefined);
    this.db.upsertFile({
      path: currentPath,
      type: 'file',
      createdAt,
      updatedAt,
      sizeBytes: stats.size,
      hashHint,
    });
  }

  private isIgnored(targetPath: string, patterns?: RegExp[]): boolean {
    if (!patterns?.length) {
      return false;
    }

    return patterns.some((pattern) => pattern.test(targetPath));
  }

  private async computeHashHint(filePath: string): Promise<string> {
    const fileHandle = await fs.open(filePath, 'r');

    try {
      const maxBytes = 1024 * 64;
      const prefix = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await fileHandle.read(prefix, 0, maxBytes, 0);
      return createHash('sha1').update(prefix.subarray(0, bytesRead)).digest('hex');
    } finally {
      await fileHandle.close();
    }
  }
}

export * from './index-config.js';
export * from './index-state.js';
export { startIndexWatchers } from './index-watcher.js';
