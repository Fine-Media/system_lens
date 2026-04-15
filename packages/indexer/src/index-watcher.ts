import fs from "node:fs";
import path from "node:path";
import type { IndexerOptions, IndexerRescan } from "./types.js";

const DEBOUNCE_MS = 750;

export interface IndexWatcherOptions {
  /** Called when a scheduled rescan throws (e.g. EPERM on a path). */
  onError?: (error: Error) => void;
}

/**
 * Watch index roots and run debounced incremental rescans. Uses recursive watching on
 * Windows and macOS; on Linux, falls back to non-recursive watch on each root (top-level only).
 *
 * @returns Stop function that closes watchers and clears timers.
 */
export function startIndexWatchers(
  roots: string[],
  indexer: IndexerRescan,
  options: IndexerOptions,
  watcherOptions: IndexWatcherOptions = {},
): () => void {
  const { onError } = watcherOptions;
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, Set<string>>();

  const emitError = (err: unknown) => {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const flushRoot = (root: string): void => {
    const paths = pending.get(root);
    pending.delete(root);
    if (!paths) {
      return;
    }

    void (async () => {
      try {
        if (paths.has(".")) {
          await indexer.rescanPath(root, options);
          return;
        }
        for (const rel of paths) {
          await indexer.rescanPath(path.join(root, rel), options);
        }
      } catch (err) {
        emitError(err);
      }
    })();
  };

  const scheduleRescan = (root: string, relPath: string | null): void => {
    if (!pending.has(root)) {
      pending.set(root, new Set());
    }
    const set = pending.get(root)!;
    if (relPath === null) {
      set.add(".");
    } else {
      set.add(relPath);
    }

    const existing = timers.get(root);
    if (existing) {
      clearTimeout(existing);
    }
    timers.set(
      root,
      setTimeout(() => {
        timers.delete(root);
        flushRoot(root);
      }, DEBOUNCE_MS),
    );
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    const attach = (recursive: boolean): void => {
      const w = fs.watch(
        root,
        { recursive },
        (_eventType: string, filename: string | Buffer | null) => {
          const rel =
            filename === null || filename === undefined
              ? null
              : typeof filename === "string"
                ? filename
                : filename.toString("utf-8");
          scheduleRescan(root, rel);
        },
      );
      watchers.push(w);
    };

    try {
      attach(true);
    } catch {
      try {
        attach(false);
      } catch (err) {
        emitError(err);
      }
    }
  }

  return () => {
    for (const t of timers.values()) {
      clearTimeout(t);
    }
    timers.clear();
    pending.clear();
    for (const w of watchers) {
      w.close();
    }
  };
}
