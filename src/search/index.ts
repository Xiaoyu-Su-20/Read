import { UnifiedSearchController } from "./controller/UnifiedSearchController";
import { createSearchPlan } from "./planning/SearchPlanner";
import { documentNameSearch } from "./sources/documentNameSearch";
import { notesSearch } from "./sources/notesSearch";
import { pdfTextSearch } from "./sources/pdfTextSearch";

export function createUnifiedSearchController() {
  return new UnifiedSearchController(
    createSearchPlan,
    new Map([
      [notesSearch.id, notesSearch],
      [documentNameSearch.id, documentNameSearch],
      [pdfTextSearch.id, pdfTextSearch]
    ])
  );
}

export type { UnifiedSearchContext, UnifiedSearchState } from "./controller/UnifiedSearchController";
export type { PdfSearchPort, SearchSourceId } from "./model/SearchRequest";
export type { SearchGroupId, SearchResult, SearchResultGroup } from "./model/SearchResult";
export type { SearchPhase } from "./model/SearchPhase";
export type { SearchViewGroup, SearchViewSnapshot } from "./model/SearchViewSnapshot";
export { analyzeQuery } from "./planning/queryAnalysis";
export { createSearchPlan, orderPagesOutward } from "./planning/SearchPlanner";
export { classifyDocumentSize, selectSearchMode } from "./planning/SearchModes";
