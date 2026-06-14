import type { SearchMode } from "../model/SearchPlan";
import type { QueryAnalysis } from "./queryAnalysis";

export function selectSearchMode(
  analysis: QueryAnalysis,
  explicitFullSearch: boolean
): SearchMode {
  if (explicitFullSearch) {
    return "full";
  }
  if (analysis.normalizedQuery.length <= 1) {
    return "instant";
  }
  if (analysis.meaningfulTokens.length >= 2) {
    return "full";
  }
  if (analysis.isCommonTerm || analysis.normalizedQuery.length <= 3) {
    return "broad-query";
  }
  if (analysis.normalizedQuery.length <= 5) {
    return "local";
  }
  return "progressive";
}

export function classifyDocumentSize(totalPages: number) {
  if (totalPages <= 100) {
    return "small" as const;
  }
  if (totalPages <= 400) {
    return "medium" as const;
  }
  return "large" as const;
}

export function chunkSizeForDocument(size: "small" | "medium" | "large") {
  return size === "small" ? 24 : size === "medium" ? 16 : 8;
}

