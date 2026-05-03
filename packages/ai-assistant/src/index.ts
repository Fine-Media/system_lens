import { SearchService } from '@system-lens/search';
import { SharedDb } from '@system-lens/shared-db';
import { InsightScope, SystemInsightsService } from '@system-lens/system-insights';
import { buildContextFromSearchResults } from './context-snippet.js';
import { isOllamaChatAvailable, ollamaChatCompletion } from './ollama-rag.js';

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
    const trimmed = question.trim();
    const storageSummary = this.insights.explainStorage(scope);
    const searchQuery = trimmed.length > 0 ? trimmed : ' ';
    const semanticResults = await this.search.queryHybrid(
      searchQuery,
      { pathPrefix: scope.pathPrefix },
      10,
    );
    const topPaths = semanticResults.map((result) => result.path);

    const suggestedActions = semanticResults.slice(0, 3).map((result) => ({
      title: `Review file: ${result.path}`,
      rationale: `Matched your question with score ${result.score.toFixed(3)}.`,
      targetFileIds: [result.id],
    }));

    if (!trimmed.length) {
      return {
        answer:
          'Ask a specific question about your indexed files. When Ollama is configured (OLLAMA_HOST), answers use retrieved text snippets; otherwise you get a short summary from the local index only.',
        confidence: 0.35,
        citations: topPaths.slice(0, 5),
        suggestedActions,
      };
    }

    if (isOllamaChatAvailable()) {
      try {
        const snippets = await buildContextFromSearchResults(semanticResults, {
          maxFiles: 6,
          maxBytesPerFile: 16_384,
          maxTotalChars: 32_000,
        });
        const pathsOnly = topPaths.slice(0, 12).join('\n');
        const userBlock = snippets
          ? `${snippets}\n\n---\n\nOther relevant paths (may be binary or unreadable):\n${pathsOnly}`
          : `No readable text snippets were collected. Indexed paths (by relevance):\n${pathsOnly}\n\nAnswer using path names and scope only, or say you need text content indexed.`;

        const answer = await ollamaChatCompletion([
          {
            role: 'system',
            content:
              'You are System Lens, a local-first assistant. Use the provided file snippets and paths to answer. If the answer is not supported by the snippets, say so briefly. Do not invent file contents. Be concise.',
          },
          {
            role: 'user',
            content: `${userBlock}\n\n---\n\nQuestion: ${trimmed}\n\nScope: ${storageSummary.totalFiles} indexed files, ${storageSummary.totalBytes} bytes under the current path prefix.`,
          },
        ]);

        return {
          answer,
          confidence: semanticResults.length > 0 ? 0.86 : 0.52,
          citations: topPaths.slice(0, 10),
          suggestedActions,
        };
      } catch {
        // fall through to offline template
      }
    }

    const ollamaHint = isOllamaChatAvailable()
      ? 'The local model request failed; ensure Ollama is running and the chat model is pulled (OLLAMA_CHAT_MODEL).'
      : 'Set OLLAMA_HOST and pull a chat model to enable RAG answers from file snippets.';

    const answer = [
      `Based on your local index, I found ${semanticResults.length} relevant files.`,
      `You currently have ${storageSummary.totalFiles} indexed files totaling ${storageSummary.totalBytes} bytes in scope.`,
      ollamaHint,
      'Verify search results before taking action.',
    ].join(' ');

    return {
      answer,
      confidence: semanticResults.length > 0 ? 0.72 : 0.41,
      citations: topPaths,
      suggestedActions,
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
        const key = file.ext || '(none)';
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext}: ${count}`);

    return {
      answer: `Folder summary for ${folderPath}: ${files.length} files, ${totalSize} bytes, dominant types ${topExts.join(', ')}.`,
      confidence: files.length > 0 ? 0.84 : 0.5,
      citations: files.slice(0, 8).map((file) => file.path),
      suggestedActions: [],
    };
  }

  suggestOrganization(scope: InsightScope = {}): AssistantResponse {
    const staleFindings = this.insights.getFindings({ detector: 'stale', status: 'open' });
    const duplicateFindings = this.insights.getFindings({ detector: 'duplicates', status: 'open' });
    const scopedFiles = this.db
      .listFiles(20_000)
      .filter((file) => !scope.pathPrefix || file.path.startsWith(scope.pathPrefix));

    const suggestions: AssistantResponse['suggestedActions'] = [];

    if (duplicateFindings.length > 0) {
      const payload = JSON.parse(duplicateFindings[0].payloadJson) as {
        files: Array<{ id: string }>;
      };
      suggestions.push({
        title: 'Review duplicate cluster',
        rationale: 'Duplicate detector found files with matching hash hints.',
        targetFileIds: payload.files.slice(0, 5).map((file) => file.id),
      });
    }

    if (staleFindings.length > 0) {
      const payload = JSON.parse(staleFindings[0].payloadJson) as { files: Array<{ id: string }> };
      suggestions.push({
        title: 'Archive stale files',
        rationale: 'These files have not been modified within the stale threshold window.',
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
        topDirectory?.directory ?? 'unknown'
      } and top file type is ${topType?.ext ?? 'unknown'}.`,
      confidence: summary.totalFiles > 0 ? 0.83 : 0.45,
      citations: summary.topDirectories.map((entry) => entry.directory),
      suggestedActions: [],
    };
  }
}
