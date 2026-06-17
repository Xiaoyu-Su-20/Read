import type { SearchHighlightRange } from "../model/SearchResult";

export function normalizeSearchText(text: string) {
  return text
    .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function findMatchIndexes(text: string, normalizedQuery: string, limit = Number.POSITIVE_INFINITY) {
  const normalizedText = normalizeSearchText(text).toLocaleLowerCase();
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

export function buildMatchSnippet(text: string, matchStart: number, matchEnd: number, maxLength = 110) {
  const matchLength = matchEnd - matchStart;
  const remaining = Math.max(0, maxLength - matchLength);

  let start = Math.max(0, matchStart - Math.floor(remaining * 0.4));
  let end = Math.min(text.length, matchEnd + Math.ceil(remaining * 0.6));

  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) {
    start--;
  }

  while (end < text.length && !/\s/.test(text[end] ?? "")) {
    end++;
  }

  const hasPrefix = start > 0;
  const hasSuffix = end < text.length;
  const prefix = hasPrefix ? "… " : "";
  const suffix = hasSuffix ? " …" : "";
  const rawPassage = text.slice(start, end);
  const passage = rawPassage.trim();
  const trimmedOffset = rawPassage.length - rawPassage.trimStart().length;
  const highlightStart = prefix.length + matchStart - start - trimmedOffset;
  const highlightEnd = highlightStart + matchLength;

  if (!passage || highlightStart < 0 || highlightEnd > prefix.length + passage.length + suffix.length) {
    return null;
  }

  return {
    snippet: `${prefix}${passage}${suffix}`,
    highlights: [{ start: highlightStart, end: highlightEnd }] satisfies SearchHighlightRange[]
  };
}

export function makeSnippet(text: string, matchIndex: number, queryLength: number) {
  const normalizedText = normalizeSearchText(text);
  return buildMatchSnippet(normalizedText, matchIndex, matchIndex + queryLength);
}
