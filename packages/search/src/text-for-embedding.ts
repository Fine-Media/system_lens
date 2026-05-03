import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileRecord } from '@system-lens/shared-db';

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

export function isProbablyTextualFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();

  if (['dockerfile', 'makefile', 'jenkinsfile', 'rakefile', 'gemfile'].includes(base)) {
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '' && (base.startsWith('.env') || base === '.npmrc' || base === '.nvmrc')) {
    return true;
  }

  const nameNoExt = ext ? base.slice(0, base.length - ext.length) : base;
  if (['readme', 'license', 'copying', 'changelog', 'contributing'].includes(nameNoExt)) {
    return true;
  }

  return TEXT_EXTENSIONS.has(ext);
}

async function readUtf8Prefix(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(Math.min(maxBytes, 512 * 1024));
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

function maxCharsForEmbedding(): number {
  const raw = process.env.SEARCH_EMBED_MAX_CHARS;
  if (raw === undefined || raw === '') {
    return 32_000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000) {
    return 32_000;
  }
  return Math.min(Math.floor(n), 200_000);
}

/**
 * Text passed to the embedding model: path + optional UTF-8 prefix of file contents for textual files.
 */
export async function buildEmbeddingInput(file: FileRecord): Promise<string> {
  if (file.type !== 'file') {
    return file.path;
  }

  if (!isProbablyTextualFile(file.path)) {
    return file.path;
  }

  const maxBytes = 96 * 1024;
  const raw = await readUtf8Prefix(file.path, maxBytes);
  if (!raw) {
    return file.path;
  }

  const maxChars = maxCharsForEmbedding();
  const body = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  return `${file.path}\n\n${body}`;
}
