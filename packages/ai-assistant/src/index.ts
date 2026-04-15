import { SearchService } from "@system-lens/search";
import { SharedDb } from "@system-lens/shared-db";
import { InsightScope, SystemInsightsService } from "@system-lens/system-insights";

export interface AssistantResponse {
  answer: string;
  confidence: number;
  citations: string[];
  suggestedActions: Array<{
    title: string;
    rationale: string;
    targetFileIds: string[];
  }>;
}

export class AIAssistantService {
  private readonly db: SharedDb;
  private readonly search: SearchService;
  private readonly insights: SystemInsightsService;

  constructor(db: SharedDb, search: SearchService, insights: SystemInsightsService) {
    this.db = db;
    this.search = search;
    this.insights = insights;
  }

  async ask(question: string, scope: InsightScope = {}): Promise<AssistantResponse> {
    const semanticResults = await this.search.queryHybrid(question, { pathPrefix: scope.pathPrefix }, 5);
    const storageSummary = this.insights.explainStorage(scope);
    const topPaths = semanticResults.map((result) => result.path);

    const answer = [
      `Based on your local index, I found ${semanticResults.length} relevant files.`,
      `You currently have ${storageSummary.totalFiles} indexed files totaling ${storageSummary.totalBytes} bytes in scope.`,
      "I might be incomplete if indexing has not finished; verify with search results before taking action.",
    ].join(" ");

    return {
      answer,
      confidence: semanticResults.length > 0 ? 0.72 : 0.41,
      citations: topPaths,
      suggestedActions: semanticResults.slice(0, 2).map((result) => ({
        title: `Review file: ${result.path}`,
        rationale: `Matched your question with score ${result.score.toFixed(3)}.`,
        targetFileIds: [result.id],
      })),
    };
  }

  summarizeFolder(folderPath: string, depth = 2): AssistantResponse {
    const files = this.db
      .listFiles(20_000)
      .filter((file) => file.path.startsWith(folderPath))
      .filter((file) => file.path.slice(folderPath.length).split(/[\\/]/).length <= depth + 1);

    const totalSize = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const topExts = Array.from(
      files.reduce((map, file) => {
        const key = file.ext || "(none)";
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext}: ${count}`);

    return {
      answer: `Folder summary for ${folderPath}: ${files.length} files, ${totalSize} bytes, dominant types ${topExts.join(", ")}.`,
      confidence: files.length > 0 ? 0.84 : 0.5,
      citations: files.slice(0, 8).map((file) => file.path),
      suggestedActions: [],
    };
  }

  suggestOrganization(scope: InsightScope = {}): AssistantResponse {
    const staleFindings = this.insights.getFindings({ detector: "stale", status: "open" });
    const duplicateFindings = this.insights.getFindings({ detector: "duplicates", status: "open" });
    const scopedFiles = this.db
      .listFiles(20_000)
      .filter((file) => !scope.pathPrefix || file.path.startsWith(scope.pathPrefix));

    const suggestions: AssistantResponse["suggestedActions"] = [];

    if (duplicateFindings.length > 0) {
      const payload = JSON.parse(duplicateFindings[0].payloadJson) as { files: Array<{ id: string }> };
      suggestions.push({
        title: "Review duplicate cluster",
        rationale: "Duplicate detector found files with matching hash hints.",
        targetFileIds: payload.files.slice(0, 5).map((file) => file.id),
      });
    }

    if (staleFindings.length > 0) {
      const payload = JSON.parse(staleFindings[0].payloadJson) as { files: Array<{ id: string }> };
      suggestions.push({
        title: "Archive stale files",
        rationale: "These files have not been modified within the stale threshold window.",
        targetFileIds: payload.files.slice(0, 5).map((file) => file.id),
      });
    }

    return {
      answer: `I reviewed ${scopedFiles.length} files and generated ${suggestions.length} organization suggestions.`,
      confidence: suggestions.length > 0 ? 0.76 : 0.55,
      citations: scopedFiles.slice(0, 10).map((file) => file.path),
      suggestedActions: suggestions,
    };
  }

  explainComputer(scope: InsightScope = {}): AssistantResponse {
    const summary = this.insights.explainStorage(scope);
    const topDirectory = summary.topDirectories[0];
    const topType = summary.topExtensions[0];

    return {
      answer: `System Lens indexed ${summary.totalFiles} files (${summary.totalBytes} bytes). Largest directory is ${
        topDirectory?.directory ?? "unknown"
      } and top file type is ${topType?.ext ?? "unknown"}.`,
      confidence: summary.totalFiles > 0 ? 0.83 : 0.45,
      citations: summary.topDirectories.map((entry) => entry.directory),
      suggestedActions: [],
    };
  }
}
