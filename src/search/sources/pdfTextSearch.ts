import type { PdfSearchResult, SearchSource } from "../model/SearchResult";
import { findMatchIndexes, makeSnippet } from "./searchText";

export const pdfTextSearch: SearchSource = {
  id: "pdf-text",
  async *search(request, signal) {
    if (request.sourceId !== "pdf-text") return;
    const pages = [...request.pageNumbers];
    let completedPages = 0;

    for (let index = 0; index < pages.length && !signal.aborted; index += request.concurrency) {
      const batchPages = pages.slice(index, index + request.concurrency);
      const pageResults = await Promise.all(batchPages.map(async (pageNumber) => {
        const text = await request.port.getPageSearchText(pageNumber, signal);
        if (signal.aborted) return [];
        const location = pageNumber === request.currentPage
          ? "current"
          : request.nearbyPages.has(pageNumber) ? "nearby" : "across";
        return findMatchIndexes(text, request.normalizedQuery, 3).map((matchIndex, resultIndex) => ({
          id: `pdf:${pageNumber}:${matchIndex}`,
          kind: "pdf" as const,
          sourceId: "pdf-text" as const,
          title: `Page ${pageNumber}`,
          pageNumber,
          matchIndex: resultIndex,
          location,
          ...makeSnippet(text, matchIndex, request.normalizedQuery.length)
        }));
      }));
      if (signal.aborted) return;
      completedPages += batchPages.length;
      yield {
        sourceId: "pdf-text",
        stageId: request.stageId,
        results: pageResults.flat() as PdfSearchResult[],
        completed: completedPages === pages.length,
        progress: { completedPages, totalPages: pages.length }
      };
    }
  }
};
