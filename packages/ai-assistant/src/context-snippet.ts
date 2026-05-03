import fs from 'node:fs/promises';
import path from 'node:path';
import type { QueryFileResult } from '@system-lens/shared-db';

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.vue',
  '.svelte',
  '.xml',
  '.svg',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.rs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.cs',
  '.swift',
  '.rb',
  '.php',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.env',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.dockerignore',
]);

export function isProbablyTextual(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const noExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;

  if (
    [
      'readme',
      'license',
      'copying',
      'changelog',
      'contributing',
      'dockerfile',
      'makefile',
      'jenkinsfile',
      'gemfile',
    ].includes(noExt) ||
    ['dockerfile', 'makefile', 'jenkinsfile', 'rakefile'].includes(base)
  ) {
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '' && (base.startsWith('.env') || base === '.npmrc' || base === '.nvmrc')) {
    return true;
  }

  return TEXT_EXTENSIONS.has(ext);
}

export async function readTextSnippet(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(Math.min(maxBytes, 256 * 1024));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);
      if (slice.includes(0)) {
        return null;
      }
      return slice.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export interface SnippetBuildOptions {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalChars: number;
}

export async function buildContextFromSearchResults(
  results: QueryFileResult[],
  options: SnippetBuildOptions,
): Promise<string> {
  let total = 0;
  const parts: string[] = [];

  for (const record of results) {
    if (record.type !== 'file') {
      continue;
    }
    if (!isProbablyTextual(record.path)) {
      continue;
    }
    if (parts.length >= options.maxFiles) {
      break;
    }

    const raw = await readTextSnippet(record.path, options.maxBytesPerFile);
    if (!raw) {
      continue;
    }

    const clipped =
      raw.length > options.maxBytesPerFile ? raw.slice(0, options.maxBytesPerFile) : raw;
    const block = `Path: ${record.path}\n${clipped}`;
    if (total + block.length > options.maxTotalChars) {
      if (parts.length === 0) {
        parts.push(block.slice(0, options.maxTotalChars));
      }
      break;
    }
    parts.push(block);
    total += block.length;
  }

  return parts.join('\n\n---\n\n');
}
