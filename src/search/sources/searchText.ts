import type { SearchHighlightRange } from "../model/SearchResult";

export function findMatchIndexes(text: string, normalizedQuery: string, limit = Number.POSITIVE_INFINITY) {
  const normalizedText = text.toLocaleLowerCase();
  const indexes: number[] = [];
  let fromIndex = 0;
  while (indexes.length < limit) {
    const index = normalizedText.indexOf(normalizedQuery, fromIndex);
    if (index < 0) break;
    indexes.push(index);
    fromIndex = index + Math.max(1, normalizedQuery.length);
  }
  return indexes;
}

export function makeSnippet(text: string, matchIndex: number, queryLength: number, radius = 68) {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + queryLength + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  const core = text.slice(start, end).replace(/\s+/g, " ");
  const rawOffset = matchIndex - start;
  const compactBefore = text.slice(start, matchIndex).replace(/\s+/g, " ");
  const highlightStart = prefix.length + compactBefore.length;
  const matched = text.slice(matchIndex, matchIndex + queryLength).replace(/\s+/g, " ");
  return {
    snippet: `${prefix}${core}${suffix}`,
    highlights: [{ start: highlightStart, end: highlightStart + matched.length }] satisfies SearchHighlightRange[]
  };
}

