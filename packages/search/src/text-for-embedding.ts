import fs from "node:fs/promises";
import path from "node:path";
import type { FileRecord } from "@system-lens/shared-db";

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".rs",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".swift",
  ".rb",
  ".php",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".env",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".dockerignore",
]);

export function isProbablyTextualFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();

  if (["dockerfile", "makefile", "jenkinsfile", "rakefile", "gemfile"].includes(base)) {
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === "" && (base.startsWith(".env") || base === ".npmrc" || base === ".nvmrc")) {
    return true;
  }

  const nameNoExt = ext ? base.slice(0, base.length - ext.length) : base;
  if (["readme", "license", "copying", "changelog", "contributing"].includes(nameNoExt)) {
    return true;
  }

  return TEXT_EXTENSIONS.has(ext);
}

export interface EmbeddingChunkInput {
  chunkIndex: number;
  startChar: number;
  endChar: number;
  text: string;
  preview: string;
}

async function readUtf8Prefix(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.allocUnsafe(Math.min(maxBytes, 512 * 1024));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);
      if (slice.includes(0)) {
        return null;
      }
      return slice.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

function maxCharsForEmbedding(): number {
  const raw = process.env.SEARCH_EMBED_MAX_CHARS;
  if (raw === undefined || raw === "") {
    return 32_000;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000) {
    return 32_000;
  }
  return Math.min(Math.floor(n), 200_000);
}

function positiveIntFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(n), min), max);
}

function chunkCharsForEmbedding(): number {
  return positiveIntFromEnv("SEARCH_EMBED_CHUNK_CHARS", 4_000, 1_000, 32_000);
}

function chunkOverlapChars(chunkChars: number): number {
  const fallback = Math.min(400, Math.floor(chunkChars / 4));
  return Math.min(positiveIntFromEnv("SEARCH_EMBED_CHUNK_OVERLAP_CHARS", fallback, 0, 8_000), Math.floor(chunkChars / 2));
}

function maxChunksForEmbedding(): number {
  return positiveIntFromEnv("SEARCH_EMBED_MAX_CHUNKS_PER_FILE", 32, 1, 512);
}

function previewForText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function pathOnlyChunk(file: FileRecord): EmbeddingChunkInput {
  return {
    chunkIndex: 0,
    startChar: 0,
    endChar: file.path.length,
    text: file.path,
    preview: file.path,
  };
}

/**
 * Text passed to the embedding model: path + optional UTF-8 prefix of file contents for textual files.
 */
export async function buildEmbeddingInput(file: FileRecord): Promise<string> {
  if (file.type !== "file") {
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

/**
 * Text chunks passed to the embedding model. Chunks are capped by the same max-char setting used
 * by the file-level embedding input, so large files stay bounded while no longer collapse into one
 * vector.
 */
export async function buildEmbeddingChunks(file: FileRecord): Promise<EmbeddingChunkInput[]> {
  if (file.type !== "file") {
    return [pathOnlyChunk(file)];
  }

  if (!isProbablyTextualFile(file.path)) {
    return [pathOnlyChunk(file)];
  }

  const maxChars = maxCharsForEmbedding();
  const maxBytes = Math.min(maxChars * 4, 1024 * 1024);
  const raw = await readUtf8Prefix(file.path, maxBytes);
  if (!raw) {
    return [pathOnlyChunk(file)];
  }

  const body = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  const chunkChars = Math.min(chunkCharsForEmbedding(), maxChars);
  const overlapChars = chunkOverlapChars(chunkChars);
  const maxChunks = maxChunksForEmbedding();
  const chunks: EmbeddingChunkInput[] = [];

  let start = 0;
  while (start < body.length && chunks.length < maxChunks) {
    const end = Math.min(start + chunkChars, body.length);
    const chunkBody = body.slice(start, end);
    chunks.push({
      chunkIndex: chunks.length,
      startChar: start,
      endChar: end,
      text: `Path: ${file.path}\nChunk ${chunks.length + 1} chars ${start}-${end}\n\n${chunkBody}`,
      preview: previewForText(chunkBody),
    });

    if (end >= body.length) {
      break;
    }
    start = end - overlapChars;
  }

  return chunks.length > 0 ? chunks : [pathOnlyChunk(file)];
}
