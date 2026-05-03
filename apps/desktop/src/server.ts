import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIAssistantService } from '@system-lens/ai-assistant';
import { AutomationService } from '@system-lens/automation';
import {
  compileIgnorePatterns,
  INDEX_STATE_VERSION,
  IndexerService,
  indexConfigPath,
  loadOrCreateIndexConfig,
  saveIndexConfig,
  saveIndexState,
  shouldRunStartupFullIndex,
  startIndexWatchers,
  validateIgnorePatternSources,
  validateRootsForIndexing,
  type IndexRootsConfig,
} from '@system-lens/indexer';
import { SafetyService } from '@system-lens/safety';
import { createEmbeddingProviderFromEnv, SearchService } from '@system-lens/search';
import { SharedDb } from '@system-lens/shared-db';
import { SystemInsightsService } from '@system-lens/system-insights';
import { SearchController } from './controllers/SearchController.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === 'fatal') {
    return 'error';
  }
  const allowed: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (raw && (allowed as string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return 'info';
}

const LOG_LEVEL = resolveLogLevel();
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES ?? '1048576');
const LOG_SLOW_REQUEST_MS = Number(process.env.LOG_SLOW_REQUEST_MS ?? '2000');

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[LOG_LEVEL];
}

function cleanMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function asFinitePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function logLine(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldEmit(level)) {
    return;
  }
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ctx: { source: 'desktop-server' },
    pid: process.pid,
    host: os.hostname(),
    ...(cleanMeta(meta) ? { meta: cleanMeta(meta) } : {}),
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function createReqLogger(requestId: string) {
  return {
    debug: (msg: string, m?: Record<string, unknown>) => logLine('debug', msg, { requestId, ...m }),
    info: (msg: string, m?: Record<string, unknown>) => logLine('info', msg, { requestId, ...m }),
    warn: (msg: string, m?: Record<string, unknown>) => logLine('warn', msg, { requestId, ...m }),
    error: (msg: string, m?: Record<string, unknown>) => logLine('error', msg, { requestId, ...m }),
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const publicDir = path.resolve(__dirname, '../public');
const dbPath = path.resolve(workspaceRoot, '.system-lens.sqlite');

const db = new SharedDb(dbPath);
const indexer = new IndexerService(db);
const embeddingProvider = createEmbeddingProviderFromEnv();
const searchService = new SearchService(db, embeddingProvider);
const insightsService = new SystemInsightsService(db);
const safetyService = new SafetyService(db);
const assistantService = new AIAssistantService(db, searchService, insightsService);
const automationService = new AutomationService(db, safetyService);
const searchController = new SearchController(searchService);

let indexConfig!: IndexRootsConfig;
let stopIndexWatchers: (() => void) | null = null;

function defaultIndexScopePath(): string {
  return indexConfig.roots[0] ?? workspaceRoot;
}

async function initIndexConfig(): Promise<void> {
  indexConfig = await loadOrCreateIndexConfig(workspaceRoot);
}

async function runFullIndex(): Promise<void> {
  const startedAt = Date.now();
  const cfg = indexConfig;
  const patterns = compileIgnorePatterns(cfg.ignorePatternSources);
  logLine('info', 'index.seed.start', { roots: cfg.roots, maxDepth: cfg.maxDepth });
  await indexer.startIndexing(cfg.roots, {
    ignorePatterns: patterns,
    maxDepth: cfg.maxDepth,
  });
  const pathPrefix = cfg.roots[0] ?? workspaceRoot;
  const findings = insightsService.runDetectors({ pathPrefix });

  const warmMax = Number(process.env.SEARCH_WARM_EMBEDDINGS_MAX ?? '0');
  if (Number.isFinite(warmMax) && warmMax > 0) {
    void searchService
      .warmEmbeddingsForRecentFiles(Math.floor(warmMax), { pathPrefix })
      .then((r) => {
        logLine('info', 'search.embed.warm.done', { processed: r.processed, failed: r.failed });
      })
      .catch((err: unknown) => {
        logLine('warn', 'search.embed.warm.failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }

  logLine('info', 'index.seed.done', {
    durationMs: Date.now() - startedAt,
    findingCount: findings.length,
  });
  await saveIndexState(workspaceRoot, {
    version: INDEX_STATE_VERSION,
    lastFullIndexAt: new Date().toISOString(),
  });
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  return [];
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const maxBytes = asFinitePositiveInt(MAX_JSON_BODY_BYTES, 1024 * 1024);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    totalBytes += part.length;
    if (totalBytes > maxBytes) {
      const err = new Error(`Request body exceeds MAX_JSON_BODY_BYTES (${maxBytes}).`) as Error & {
        statusCode?: number;
      };
      err.statusCode = 413;
      throw err;
    }
    chunks.push(part);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
  } catch (error) {
    const err = new Error('Invalid JSON body.') as Error & { statusCode?: number };
    err.statusCode = 400;
    (err as Error & { cause?: unknown }).cause = error;
    throw err;
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, {
      app: 'System Lens',
      indexer: indexer.getIndexerStatus(),
      indexRoots: indexConfig.roots.length,
      rules: automationService.listRules().length,
      pendingFindings: insightsService.getFindings({ status: 'open' }).length,
    });
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, {
      configFile: indexConfigPath(workspaceRoot),
      ...indexConfig,
    });
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const rootsRaw = parseStringList(body.roots);
    const rootsToValidate = rootsRaw.length > 0 ? rootsRaw : indexConfig.roots;
    const rootsCheck = await validateRootsForIndexing(rootsToValidate, workspaceRoot);
    if (!rootsCheck.ok) {
      sendJson(res, 400, { error: 'Invalid index roots.', details: rootsCheck.errors });
      return;
    }

    const ignoreRaw = parseStringList(body.ignorePatternSources ?? body.ignorePatterns);
    const ign = validateIgnorePatternSources(
      ignoreRaw.length > 0 ? ignoreRaw : indexConfig.ignorePatternSources,
    );
    if (!ign.ok) {
      sendJson(res, 400, { error: 'Invalid ignore patterns.', details: ign.errors });
      return;
    }

    let maxDepth = typeof body.maxDepth === 'number' ? body.maxDepth : indexConfig.maxDepth;
    if (!Number.isFinite(maxDepth)) {
      maxDepth = indexConfig.maxDepth;
    }
    maxDepth = Math.min(Math.max(Math.floor(maxDepth), 0), 50);

    const next: IndexRootsConfig = {
      version: 1,
      roots: rootsCheck.normalized,
      ignorePatternSources: ign.sources,
      maxDepth,
    };

    await saveIndexConfig(workspaceRoot, next);
    indexConfig = next;
    logLine('info', 'config.saved', {
      rootCount: next.roots.length,
      ignorePatternCount: next.ignorePatternSources.length,
      maxDepth: next.maxDepth,
    });

    void runFullIndex().catch((err: unknown) => {
      logLine('error', 'index.rebuild.failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });

    sendJson(res, 200, { ok: true, config: next });
    return;
  }

  if (url.pathname === '/api/index/rebuild' && req.method === 'POST') {
    void runFullIndex().catch((err: unknown) => {
      logLine('error', 'index.rebuild.failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
    sendJson(res, 202, { accepted: true });
    return;
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    const query = (url.searchParams.get('q') ?? '').trim();
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const extension = url.searchParams.get('ext');
    const results = await searchController.query(
      query,
      extension ? { extensions: [extension.startsWith('.') ? extension : `.${extension}`] } : {},
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
    );

    sendJson(res, 200, { query, count: results.length, results });
    return;
  }

  if (url.pathname === '/api/insights/run' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const pathPrefix =
      typeof body.pathPrefix === 'string' ? body.pathPrefix : defaultIndexScopePath();
    const findings = insightsService.runDetectors({ pathPrefix });
    sendJson(res, 200, { count: findings.length, findings });
    return;
  }

  if (url.pathname === '/api/insights/findings' && req.method === 'GET') {
    const detector = (url.searchParams.get('detector') ?? undefined) as
      | 'duplicates'
      | 'stale'
      | 'storage-hogs'
      | undefined;
    const status = (url.searchParams.get('status') ?? undefined) as
      | 'open'
      | 'dismissed'
      | undefined;
    sendJson(res, 200, { findings: insightsService.getFindings({ detector, status }) });
    return;
  }

  if (url.pathname === '/api/assistant/ask' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const question = typeof body.question === 'string' ? body.question : '';
    const pathPrefix =
      typeof body.pathPrefix === 'string' ? body.pathPrefix : defaultIndexScopePath();
    const response = await assistantService.ask(question, { pathPrefix });
    sendJson(res, 200, response);
    return;
  }

  if (url.pathname === '/api/assistant/explain-computer' && req.method === 'GET') {
    sendJson(res, 200, assistantService.explainComputer({ pathPrefix: defaultIndexScopePath() }));
    return;
  }

  if (url.pathname === '/api/automation/rules' && req.method === 'GET') {
    sendJson(res, 200, { rules: automationService.listRules() });
    return;
  }

  if (url.pathname === '/api/automation/rules' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const rule = automationService.createRule({
      name: typeof body.name === 'string' ? body.name : 'Untitled Rule',
      scopePathPrefix:
        typeof body.scopePathPrefix === 'string' ? body.scopePathPrefix : defaultIndexScopePath(),
      mode: body.mode === 'archive-stale' ? 'archive-stale' : 'sort-by-extension',
      staleDays: typeof body.staleDays === 'number' ? body.staleDays : undefined,
    });

    sendJson(res, 201, { rule });
    return;
  }

  if (url.pathname.startsWith('/api/automation/rules/') && req.method === 'POST') {
    const segments = url.pathname.split('/').filter(Boolean);
    const ruleId = segments[3];
    const action = segments[4];

    if (!ruleId) {
      sendJson(res, 400, { error: 'Missing rule id.' });
      return;
    }

    if (action === 'activate') {
      automationService.activateRule(ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'deactivate') {
      automationService.deactivateRule(ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'simulate') {
      sendJson(res, 200, { run: automationService.simulateRule(ruleId) });
      return;
    }

    if (action === 'execute') {
      sendJson(res, 200, { run: automationService.executeRule(ruleId, { actor: 'desktop-ui' }) });
      return;
    }
  }

  if (url.pathname === '/api/safety/logs' && req.method === 'GET') {
    sendJson(res, 200, { logs: safetyService.getActionLog({ limit: 100 }) });
    return;
  }

  const staticPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(publicDir, staticPath);

  try {
    const file = await fs.readFile(filePath);
    const contentType = filePath.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : filePath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'application/javascript; charset=utf-8';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(file);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

async function bootstrap(): Promise<void> {
  logLine('info', 'server.bootstrap.start', {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    workspaceRoot,
    dbPath,
    env: process.env.NODE_ENV ?? 'development',
  });

  await initIndexConfig();

  const runFull = await shouldRunStartupFullIndex(workspaceRoot);
  if (runFull) {
    await runFullIndex();
  } else {
    logLine('info', 'index.seed.skip', {
      reason:
        'A full index already completed on this machine. Use POST /api/index/rebuild or set INDEX_FORCE_FULL=1 to crawl again.',
    });
  }

  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const method = req.method ?? 'UNKNOWN';
    const requestUrl = req.url ?? '/';
    const userAgent = req.headers['user-agent'] ?? undefined;
    const forwarded = req.headers['x-forwarded-for'];
    const remoteIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : (req.socket.remoteAddress ?? undefined);
    const reqLog = createReqLogger(requestId);
    reqLog.debug('http.request.start', {
      method,
      url: requestUrl,
      remoteIp,
      userAgent,
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const logMethod =
        durationMs >= asFinitePositiveInt(LOG_SLOW_REQUEST_MS, 2000) ? reqLog.warn : reqLog.info;
      logMethod('http.request', {
        method,
        url: requestUrl,
        statusCode: res.statusCode,
        durationMs,
        contentLength: res.getHeader('content-length'),
        remoteIp,
        userAgent,
      });
    });

    handleRequest(req, res).catch((error: unknown) => {
      const statusCode =
        typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? ((error as { statusCode: number }).statusCode ?? 500)
          : 500;
      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      const logMethod = statusCode >= 500 ? reqLog.error : reqLog.warn;
      logMethod('http.request.error', {
        method,
        url: requestUrl,
        durationMs: Date.now() - startedAt,
        statusCode,
        remoteIp,
        userAgent,
        ...serializeError(error),
      });
      sendJson(res, statusCode, { error: message });
    });
  });

  const port = Number(process.env.PORT ?? '3180');
  server.listen(port, () => {
    logLine('info', 'server.started', {
      app: 'System Lens',
      port,
      url: `http://localhost:${port}`,
      logLevel: LOG_LEVEL,
      maxJsonBodyBytes: asFinitePositiveInt(MAX_JSON_BODY_BYTES, 1024 * 1024),
      slowRequestMs: asFinitePositiveInt(LOG_SLOW_REQUEST_MS, 2000),
      embedder: embeddingProvider.modelLabel(),
      roots: indexConfig.roots.length,
      maxDepth: indexConfig.maxDepth,
      watchEnabled: process.env.INDEX_WATCH !== '0',
    });

    if (process.env.INDEX_WATCH !== '0') {
      const patterns = compileIgnorePatterns(indexConfig.ignorePatternSources);
      stopIndexWatchers = startIndexWatchers(
        indexConfig.roots,
        indexer,
        { ignorePatterns: patterns, maxDepth: indexConfig.maxDepth },
        {
          onError: (err) => {
            logLine('warn', 'index.watch.error', { message: err.message });
          },
        },
      );
      logLine('info', 'index.watch.started', { roots: indexConfig.roots.length });
    }
  });

  const shutdown = (): void => {
    logLine('info', 'server.shutdown.start');
    stopIndexWatchers?.();
    stopIndexWatchers = null;
    server.close(() => {
      logLine('info', 'server.shutdown.complete');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  logLine('error', 'server.bootstrap.failed', {
    ...serializeError(error),
  });
  process.exitCode = 1;
});
