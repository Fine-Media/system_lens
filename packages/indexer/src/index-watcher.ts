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
 * Windows and macOS; on Linux, registers one watcher per directory up to maxDepth.
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
  const watchedDirs = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, Set<string>>();

  const emitError = (err: unknown) => {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const isIgnored = (targetPath: string): boolean => {
    return options.ignorePatterns?.some((pattern) => pattern.test(targetPath)) ?? false;
  };

  const depthFromRoot = (root: string, targetDir: string): number => {
    const rel = path.relative(root, targetDir);
    if (!rel) {
      return 0;
    }
    return rel.split(path.sep).filter(Boolean).length;
  };

  const maxWatchDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;

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

  const attach = (root: string, watchDir: string, recursive: boolean): void => {
    if (watchedDirs.has(watchDir) || isIgnored(watchDir)) {
      return;
    }

    const w = fs.watch(
      watchDir,
      { recursive },
      (_eventType: string, filename: string | Buffer | null) => {
        const rel =
          filename === null || filename === undefined
            ? null
            : typeof filename === "string"
              ? filename
              : filename.toString("utf-8");
        const targetPath = rel === null ? watchDir : path.join(watchDir, rel);
        const rootRel = path.relative(root, targetPath);

        scheduleRescan(root, rootRel ? rootRel : null);

        if (!recursive && process.platform === "linux") {
          attachLinuxTree(root, targetPath);
        }
      },
    );
    watchedDirs.add(watchDir);
    watchers.push(w);
  };

  const attachLinuxTree = (root: string, targetPath: string): void => {
    let startDir = targetPath;
    try {
      const st = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
      if (!st) {
        return;
      }
      startDir = st.isDirectory() ? targetPath : path.dirname(targetPath);
    } catch (err) {
      emitError(err);
      return;
    }

    const stack = [startDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      const depth = depthFromRoot(root, dir);
      if (depth > maxWatchDepth || isIgnored(dir)) {
        continue;
      }

      try {
        attach(root, dir, false);
      } catch (err) {
        emitError(err);
        continue;
      }

      if (depth >= maxWatchDepth) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        emitError(err);
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          stack.push(path.join(dir, entry.name));
        }
      }
    }
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    if (process.platform === "linux") {
      attachLinuxTree(root, root);
      continue;
    }

    try {
      attach(root, root, true);
    } catch {
      try {
        attach(root, root, false);
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
    watchedDirs.clear();
  };
}
