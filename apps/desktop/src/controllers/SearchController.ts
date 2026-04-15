import { SearchService } from "@system-lens/search";
import { SearchFilters } from "@system-lens/shared-db";

export class SearchController {
  private readonly searchService: SearchService;

  constructor(searchService: SearchService) {
    this.searchService = searchService;
  }

  async query(text: string, filters: SearchFilters = {}, limit = 20) {
    return this.searchService.queryHybrid(text, filters, limit);
  }
}
