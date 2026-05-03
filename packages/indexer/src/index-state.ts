import fs from 'node:fs/promises';
import path from 'node:path';
import { configDir } from './index-config.js';

export const INDEX_STATE_VERSION = 1 as const;

export interface IndexBootstrapState {
  version: typeof INDEX_STATE_VERSION;
  /** ISO timestamp of the last completed full-tree index run. */
  lastFullIndexAt: string | null;
}

export function indexStatePath(workspaceRoot: string): string {
  return path.join(configDir(workspaceRoot), 'index-state.json');
}

export async function loadIndexState(workspaceRoot: string): Promise<IndexBootstrapState | null> {
  const file = indexStatePath(workspaceRoot);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    const last =
      typeof o.lastFullIndexAt === 'string' && o.lastFullIndexAt.length > 0
        ? o.lastFullIndexAt
        : null;
    return { version: INDEX_STATE_VERSION, lastFullIndexAt: last };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveIndexState(
  workspaceRoot: string,
  state: IndexBootstrapState,
): Promise<void> {
  const file = indexStatePath(workspaceRoot);
  await fs.mkdir(configDir(workspaceRoot), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Decide whether startup should crawl all configured roots.
 *
 * - `INDEX_FORCE_FULL=1` — always run a full index.
 * - `INDEX_FULL_ON_START=1` — always run a full index on each start (legacy / heavy).
 * - `INDEX_FULL_ON_START=0` — skip unless this machine has never completed a full index.
 * - Default — same as `INDEX_FULL_ON_START=0` (first successful run only).
 */
export async function shouldRunStartupFullIndex(workspaceRoot: string): Promise<boolean> {
  if (process.env.INDEX_FORCE_FULL === '1' || process.env.INDEX_FULL_ON_START === '1') {
    return true;
  }

  const state = await loadIndexState(workspaceRoot);
  return !state?.lastFullIndexAt;
}
