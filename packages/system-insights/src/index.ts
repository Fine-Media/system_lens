import path from "node:path";
import { InsightFinding, SharedDb } from "@system-lens/shared-db";

export type DetectorName = "duplicates" | "stale" | "storage-hogs";

export interface InsightScope {
  pathPrefix?: string;
}

export interface DetectorConfig {
  staleDays?: number;
  largeFileBytes?: number;
}

function inScope(filePath: string, scope: InsightScope): boolean {
  if (!scope.pathPrefix) {
    return true;
  }

  return filePath.startsWith(scope.pathPrefix);
}

export class SystemInsightsService {
  private readonly db: SharedDb;

  constructor(db: SharedDb) {
    this.db = db;
  }

  runDetectors(
    scope: InsightScope = {},
    detectorSet: DetectorName[] = ["duplicates", "stale", "storage-hogs"],
    config: DetectorConfig = {},
  ): InsightFinding[] {
    const findings: InsightFinding[] = [];

    if (detectorSet.includes("duplicates")) {
      findings.push(...this.detectDuplicates(scope));
    }

    if (detectorSet.includes("stale")) {
      findings.push(...this.detectStaleFiles(scope, config.staleDays ?? 120));
    }

    if (detectorSet.includes("storage-hogs")) {
      findings.push(...this.detectStorageHogs(scope, config.largeFileBytes ?? 100 * 1024 * 1024));
    }

    return findings;
  }

  getFindings(filters: { detector?: DetectorName; status?: "open" | "dismissed" } = {}): InsightFinding[] {
    const rows = this.db.listInsightFindings(filters.status);
    if (!filters.detector) {
      return rows;
    }

    return rows.filter((row) => row.detector === filters.detector);
  }

  dismissFinding(findingId: string): void {
    this.db.dismissInsightFinding(findingId);
  }

  explainStorage(scope: InsightScope = {}): {
    totalFiles: number;
    totalBytes: number;
    topExtensions: Array<{ ext: string; bytes: number; count: number }>;
    topDirectories: Array<{ directory: string; bytes: number; count: number }>;
  } {
    const files = this.db.listFiles(20_000).filter((file) => file.type === "file" && inScope(file.path, scope));
    const extMap = new Map<string, { bytes: number; count: number }>();
    const dirMap = new Map<string, { bytes: number; count: number }>();

    for (const file of files) {
      const ext = file.ext || "(none)";
      const directory = path.dirname(file.path);
      const extStats = extMap.get(ext) ?? { bytes: 0, count: 0 };
      extStats.bytes += file.sizeBytes;
      extStats.count += 1;
      extMap.set(ext, extStats);

      const dirStats = dirMap.get(directory) ?? { bytes: 0, count: 0 };
      dirStats.bytes += file.sizeBytes;
      dirStats.count += 1;
      dirMap.set(directory, dirStats);
    }

    const topExtensions = Array.from(extMap.entries())
      .map(([ext, stats]) => ({ ext, ...stats }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8);

    const topDirectories = Array.from(dirMap.entries())
      .map(([directory, stats]) => ({ directory, ...stats }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8);

    return {
      totalFiles: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      topExtensions,
      topDirectories,
    };
  }

  private detectDuplicates(scope: InsightScope): InsightFinding[] {
    const files = this.db.listFiles(20_000).filter((file) => file.type === "file" && inScope(file.path, scope));
    const groups = new Map<string, typeof files>();

    for (const file of files) {
      const key = `${file.hashHint ?? "none"}:${file.sizeBytes}`;
      const existing = groups.get(key) ?? [];
      existing.push(file);
      groups.set(key, existing);
    }

    const findings: InsightFinding[] = [];
    for (const [groupKey, groupFiles] of groups.entries()) {
      if (groupFiles.length < 2 || groupKey.startsWith("none:")) {
        continue;
      }

      const payload = JSON.stringify({
        groupKey,
        duplicateCount: groupFiles.length,
        totalBytes: groupFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
        files: groupFiles.map((file) => ({ id: file.id, path: file.path, sizeBytes: file.sizeBytes })),
      });

      findings.push(
        this.db.upsertInsightFinding({
          detector: "duplicates",
          severity: groupFiles.length > 4 ? "high" : "medium",
          payloadJson: payload,
        }),
      );
    }

    return findings;
  }

  private detectStaleFiles(scope: InsightScope, staleDays: number): InsightFinding[] {
    const files = this.db.listFiles(20_000).filter((file) => file.type === "file" && inScope(file.path, scope));
    const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const staleFiles = files
      .filter((file) => Date.parse(file.updatedAt) < staleThreshold)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(0, 200);

    if (!staleFiles.length) {
      return [];
    }

    const payload = JSON.stringify({
      staleDays,
      staleCount: staleFiles.length,
      files: staleFiles.map((file) => ({
        id: file.id,
        path: file.path,
        updatedAt: file.updatedAt,
        sizeBytes: file.sizeBytes,
      })),
    });

    return [
      this.db.upsertInsightFinding({
        detector: "stale",
        severity: staleFiles.length > 100 ? "high" : "medium",
        payloadJson: payload,
      }),
    ];
  }

  private detectStorageHogs(scope: InsightScope, largeFileBytes: number): InsightFinding[] {
    const files = this.db.listFiles(20_000).filter((file) => file.type === "file" && inScope(file.path, scope));
    const largeFiles = files
      .filter((file) => file.sizeBytes >= largeFileBytes)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 100);

    if (!largeFiles.length) {
      return [];
    }

    const payload = JSON.stringify({
      thresholdBytes: largeFileBytes,
      largeFileCount: largeFiles.length,
      files: largeFiles.map((file) => ({
        id: file.id,
        path: file.path,
        sizeBytes: file.sizeBytes,
      })),
    });

    return [
      this.db.upsertInsightFinding({
        detector: "storage-hogs",
        severity: "medium",
        payloadJson: payload,
      }),
    ];
  }
}
