import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const INDEX_CONFIG_VERSION = 1 as const;

export interface IndexRootsConfig {
  version: typeof INDEX_CONFIG_VERSION;
  roots: string[];
  ignorePatternSources: string[];
  maxDepth: number;
}

const DEFAULT_IGNORE_SOURCES = ['node_modules', '[\\\\/]dist[\\\\/]', '[\\\\/]\\.git[\\\\/]'];

export function createDefaultIndexConfig(workspaceRoot: string): IndexRootsConfig {
  return {
    version: INDEX_CONFIG_VERSION,
    roots: [path.normalize(workspaceRoot)],
    ignorePatternSources: [...DEFAULT_IGNORE_SOURCES],
    maxDepth: 4,
  };
}

export function configDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.system-lens');
}

export function indexConfigPath(workspaceRoot: string): string {
  return path.join(configDir(workspaceRoot), 'index-config.json');
}

export function compileIgnorePatterns(sources: string[]): RegExp[] {
  return sources
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => new RegExp(s, 'i'));
}

export function validateIgnorePatternSources(
  sources: string[],
): { ok: true; sources: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i].trim();
    if (!s) {
      continue;
    }
    try {
      new RegExp(s, 'i');
      out.push(s);
    } catch {
      errors.push(`Invalid regex at line ${i + 1}: ${s}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, sources: out.length > 0 ? out : [...DEFAULT_IGNORE_SOURCES] };
}

export async function validateRootsForIndexing(
  roots: string[],
  workspaceRoot: string,
): Promise<{ ok: true; normalized: string[] } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  if (roots.length === 0) {
    return { ok: false, errors: ['At least one index root is required.'] };
  }
  if (roots.length > 32) {
    return { ok: false, errors: ['Too many roots (max 32).'] };
  }

  for (const raw of roots) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
      continue;
    }

    const abs = path.isAbsolute(trimmed)
      ? path.normalize(trimmed)
      : path.normalize(path.resolve(workspaceRoot, trimmed));
    const key = abs.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    try {
      await fs.access(abs, fsConstants.R_OK);
      const st = await fs.stat(abs);
      if (!st.isDirectory()) {
        errors.push(`Not a directory: ${abs}`);
        continue;
      }
    } catch {
      errors.push(`Path not accessible: ${abs}`);
      continue;
    }

    normalized.push(abs);
  }

  if (normalized.length === 0) {
    return { ok: false, errors: errors.length > 0 ? errors : ['No valid directory roots.'] };
  }

  return { ok: true, normalized };
}

function normalizeLoadedConfig(parsed: unknown, workspaceRoot: string): IndexRootsConfig {
  const fallback = createDefaultIndexConfig(workspaceRoot);
  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }

  const o = parsed as Record<string, unknown>;
  const rootsRaw = Array.isArray(o.roots)
    ? o.roots.filter((x): x is string => typeof x === 'string')
    : [];
  const ignoreRaw = Array.isArray(o.ignorePatternSources)
    ? o.ignorePatternSources.filter((x): x is string => typeof x === 'string')
    : fallback.ignorePatternSources;
  let maxDepth = typeof o.maxDepth === 'number' ? o.maxDepth : fallback.maxDepth;
  if (!Number.isFinite(maxDepth) || maxDepth < 0) {
    maxDepth = fallback.maxDepth;
  }
  maxDepth = Math.min(Math.floor(maxDepth), 50);

  return {
    version: INDEX_CONFIG_VERSION,
    roots: rootsRaw.length > 0 ? rootsRaw.map((r) => path.normalize(r)) : fallback.roots,
    ignorePatternSources: ignoreRaw.length > 0 ? ignoreRaw : fallback.ignorePatternSources,
    maxDepth,
  };
}

export async function loadOrCreateIndexConfig(workspaceRoot: string): Promise<IndexRootsConfig> {
  const dir = configDir(workspaceRoot);
  const file = indexConfigPath(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });

  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return normalizeLoadedConfig(parsed, workspaceRoot);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
    const cfg = createDefaultIndexConfig(workspaceRoot);
    await fs.writeFile(file, JSON.stringify(cfg, null, 2), 'utf-8');
    return cfg;
  }
}

export async function saveIndexConfig(
  workspaceRoot: string,
  config: IndexRootsConfig,
): Promise<void> {
  const file = indexConfigPath(workspaceRoot);
  await fs.mkdir(configDir(workspaceRoot), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
}
