export interface IndexerOptions {
  ignorePatterns?: RegExp[];
  maxDepth?: number;
}

export interface IndexerStatus {
  running: boolean;
  scannedFiles: number;
  scannedDirs: number;
  lastRunAt: string | null;
}

/** Minimal surface used by incremental watchers. */
export interface IndexerRescan {
  rescanPath(targetPath: string, options?: IndexerOptions): Promise<void>;
}
