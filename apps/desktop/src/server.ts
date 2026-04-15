import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLogger, initLogger, type LogLevel } from "@system-lens/logger";
import { AIAssistantService } from "@system-lens/ai-assistant";
import { AutomationService } from "@system-lens/automation";
import { IndexerService } from "@system-lens/indexer";
import { SafetyService } from "@system-lens/safety";
import { SearchService } from "@system-lens/search";
import { SharedDb } from "@system-lens/shared-db";
import { SystemInsightsService } from "@system-lens/system-insights";
import { SearchController } from "./controllers/SearchController.js";

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  const allowed: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];
  if (raw && (allowed as string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return "info";
}

const LOG_LEVEL = resolveLogLevel();

initLogger({
  level: LOG_LEVEL,
  json: true,
  colorize: false,
  defaultContext: { source: "desktop-server" },
});

const log = getLogger();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../..");
const publicDir = path.resolve(__dirname, "../public");
const dbPath = path.resolve(workspaceRoot, ".system-lens.sqlite");

const db = new SharedDb(dbPath);
const indexer = new IndexerService(db);
const searchService = new SearchService(db);
const insightsService = new SystemInsightsService(db);
const safetyService = new SafetyService(db);
const assistantService = new AIAssistantService(db, searchService, insightsService);
const automationService = new AutomationService(db, safetyService);
const searchController = new SearchController(searchService);

async function seedIndex(): Promise<void> {
  const startedAt = Date.now();
  log.info("index.seed.start", { root: workspaceRoot });
  await indexer.startIndexing([workspaceRoot], {
    maxDepth: 4,
    ignorePatterns: [/node_modules/i, /[\\/]dist[\\/]/i, /[\\/]\.git[\\/]/i],
  });
  const findings = insightsService.runDetectors({ pathPrefix: workspaceRoot });
  log.info("index.seed.done", {
    durationMs: Date.now() - startedAt,
    findingCount: findings.length,
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/status" && req.method === "GET") {
    sendJson(res, 200, {
      app: "System Lens",
      indexer: indexer.getIndexerStatus(),
      rules: automationService.listRules().length,
      pendingFindings: insightsService.getFindings({ status: "open" }).length,
    });
    return;
  }

  if (url.pathname === "/api/search" && req.method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim();
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const extension = url.searchParams.get("ext");
    const results = await searchController.query(
      query,
      extension ? { extensions: [extension.startsWith(".") ? extension : `.${extension}`] } : {},
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
    );

    sendJson(res, 200, { query, count: results.length, results });
    return;
  }

  if (url.pathname === "/api/insights/run" && req.method === "POST") {
    const body = await readJsonBody(req);
    const pathPrefix = typeof body.pathPrefix === "string" ? body.pathPrefix : workspaceRoot;
    const findings = insightsService.runDetectors({ pathPrefix });
    sendJson(res, 200, { count: findings.length, findings });
    return;
  }

  if (url.pathname === "/api/insights/findings" && req.method === "GET") {
    const detector = (url.searchParams.get("detector") ?? undefined) as
      | "duplicates"
      | "stale"
      | "storage-hogs"
      | undefined;
    const status = (url.searchParams.get("status") ?? undefined) as "open" | "dismissed" | undefined;
    sendJson(res, 200, { findings: insightsService.getFindings({ detector, status }) });
    return;
  }

  if (url.pathname === "/api/assistant/ask" && req.method === "POST") {
    const body = await readJsonBody(req);
    const question = typeof body.question === "string" ? body.question : "";
    const pathPrefix = typeof body.pathPrefix === "string" ? body.pathPrefix : workspaceRoot;
    const response = await assistantService.ask(question, { pathPrefix });
    sendJson(res, 200, response);
    return;
  }

  if (url.pathname === "/api/assistant/explain-computer" && req.method === "GET") {
    sendJson(res, 200, assistantService.explainComputer({ pathPrefix: workspaceRoot }));
    return;
  }

  if (url.pathname === "/api/automation/rules" && req.method === "GET") {
    sendJson(res, 200, { rules: automationService.listRules() });
    return;
  }

  if (url.pathname === "/api/automation/rules" && req.method === "POST") {
    const body = await readJsonBody(req);
    const rule = automationService.createRule({
      name: typeof body.name === "string" ? body.name : "Untitled Rule",
      scopePathPrefix: typeof body.scopePathPrefix === "string" ? body.scopePathPrefix : workspaceRoot,
      mode: body.mode === "archive-stale" ? "archive-stale" : "sort-by-extension",
      staleDays: typeof body.staleDays === "number" ? body.staleDays : undefined,
    });

    sendJson(res, 201, { rule });
    return;
  }

  if (url.pathname.startsWith("/api/automation/rules/") && req.method === "POST") {
    const segments = url.pathname.split("/").filter(Boolean);
    const ruleId = segments[3];
    const action = segments[4];

    if (!ruleId) {
      sendJson(res, 400, { error: "Missing rule id." });
      return;
    }

    if (action === "activate") {
      automationService.activateRule(ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === "deactivate") {
      automationService.deactivateRule(ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === "simulate") {
      sendJson(res, 200, { run: automationService.simulateRule(ruleId) });
      return;
    }

    if (action === "execute") {
      sendJson(res, 200, { run: automationService.executeRule(ruleId, { actor: "desktop-ui" }) });
      return;
    }
  }

  if (url.pathname === "/api/safety/logs" && req.method === "GET") {
    sendJson(res, 200, { logs: safetyService.getActionLog({ limit: 100 }) });
    return;
  }

  const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.join(publicDir, staticPath);

  try {
    const file = await fs.readFile(filePath);
    const contentType =
      filePath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : filePath.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/javascript; charset=utf-8";

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function bootstrap(): Promise<void> {
  await seedIndex();

  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const method = req.method ?? "UNKNOWN";
    const requestUrl = req.url ?? "/";
    const reqLog = log.child({ requestId });

    res.on("finish", () => {
      reqLog.info("http.request", {
        method,
        url: requestUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    handleRequest(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      reqLog.error("http.request.error", {
        method,
        url: requestUrl,
        durationMs: Date.now() - startedAt,
        message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      sendJson(res, 500, { error: message });
    });
  });

  const port = Number(process.env.PORT ?? "3180");
  server.listen(port, () => {
    log.info("server.started", {
      app: "System Lens",
      port,
      url: `http://localhost:${port}`,
      logLevel: LOG_LEVEL,
    });
  });
}

bootstrap().catch((error: unknown) => {
  getLogger().error("server.bootstrap.failed", {
    message: error instanceof Error ? error.message : "Unknown bootstrap error",
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
