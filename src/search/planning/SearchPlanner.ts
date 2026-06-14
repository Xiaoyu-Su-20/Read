import type { SearchPlan, SearchPlanningContext, SearchStage } from "../model/SearchPlan";
import { SEARCH_MANIFEST } from "./SearchManifest";
import { chunkSizeForDocument, selectSearchMode } from "./SearchModes";
import { analyzeQuery } from "./queryAnalysis";

function pagesWithin(currentPage: number, radius: number, totalPages: number) {
  const pages: number[] = [];
  for (let page = Math.max(1, currentPage - radius); page <= Math.min(totalPages, currentPage + radius); page += 1) {
    pages.push(page);
  }
  return pages;
}

export function orderPagesOutward(currentPage: number, totalPages: number) {
  const pages: number[] = [];
  for (let distance = 1; pages.length < Math.max(0, totalPages - 1); distance += 1) {
    const after = currentPage + distance;
    const before = currentPage - distance;
    if (after <= totalPages) pages.push(after);
    if (before >= 1) pages.push(before);
  }
  return pages;
}

function addPdfStage(
  stages: SearchStage[],
  seenPages: Set<number>,
  id: string,
  delayMs: number,
  pages: readonly number[]
) {
  const pageNumbers = pages.filter((page) => page > 0 && !seenPages.has(page));
  pageNumbers.forEach((page) => seenPages.add(page));
  if (pageNumbers.length > 0) {
    stages.push({ id, delayMs, sourceId: "pdf-text", pageNumbers });
  }
}

export function createSearchPlan(context: SearchPlanningContext): SearchPlan {
  const analysis = analyzeQuery(context.query);
  const mode = selectSearchMode(analysis, context.explicitFullSearch);
  const stages: SearchStage[] = [];
  const seenPages = new Set<number>();
  const nearbyPages = new Set(pagesWithin(context.currentPage, 5, context.totalPages));

  if (context.availableSources.has("notes") && analysis.normalizedQuery.length >= SEARCH_MANIFEST.notes.minimumCharacters) {
    stages.push({ id: "notes", delayMs: 0, sourceId: "notes" });
  }
  if (mode !== "instant" && context.availableSources.has("document-name") && analysis.normalizedQuery.length >= SEARCH_MANIFEST.documentName.minimumCharacters) {
    stages.push({ id: "document-names", delayMs: 0, sourceId: "document-name" });
  }

  if (mode !== "instant" && context.availableSources.has("pdf-text") && context.totalPages > 0) {
    addPdfStage(stages, seenPages, "current-page", 0, [context.currentPage]);

    if (mode !== "broad-query") {
      addPdfStage(stages, seenPages, "nearby-2", 80, pagesWithin(context.currentPage, 2, context.totalPages));
      addPdfStage(stages, seenPages, "nearby-5", 160, pagesWithin(context.currentPage, 5, context.totalPages));

      const extracted = [...context.extractedPages].sort((left, right) => {
        const distance = Math.abs(left - context.currentPage) - Math.abs(right - context.currentPage);
        return distance || left - right;
      });
      addPdfStage(stages, seenPages, "extracted-pages", 250, extracted);
    }

    if (mode === "progressive" || mode === "full") {
      const remaining = orderPagesOutward(context.currentPage, context.totalPages);
      const chunkSize = chunkSizeForDocument(context.documentSizeClass);
      const delayMs = mode === "full" ? 80 : 250;
      for (let index = 0; index < remaining.length; index += chunkSize) {
        addPdfStage(
          stages,
          seenPages,
          `remaining-${Math.floor(index / chunkSize) + 1}`,
          delayMs,
          remaining.slice(index, index + chunkSize)
        );
      }
    }
  }

  return {
    mode,
    stages,
    ranking: { currentPage: context.currentPage, nearbyPages }
  };
}

