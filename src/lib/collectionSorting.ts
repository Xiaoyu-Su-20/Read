import type { DocumentRecord } from "./types";

export type CollectionDocumentSortMode = "manual" | "recent";

export function sortCollectionDocumentsByRecent(documents: DocumentRecord[]) {
  const manualIndex = new Map(documents.map((document, index) => [document.id, index]));

  return [...documents].sort((left, right) => {
    const recency = (right.lastOpenedAt ?? "").localeCompare(left.lastOpenedAt ?? "");
    if (recency !== 0) {
      return recency;
    }
    return (manualIndex.get(left.id) ?? 0) - (manualIndex.get(right.id) ?? 0);
  });
}
