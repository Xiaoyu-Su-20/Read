import type { DocumentRecord } from "./types";

export type CollectionDocumentSortMode = "manual" | "recent" | "name";

const TITLE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

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

export function sortCollectionDocumentsByName(documents: DocumentRecord[]) {
  const manualIndex = new Map(documents.map((document, index) => [document.id, index]));

  return [...documents].sort((left, right) => {
    const title = TITLE_COLLATOR.compare(left.title.trim(), right.title.trim());
    if (title !== 0) {
      return title;
    }
    return (manualIndex.get(left.id) ?? 0) - (manualIndex.get(right.id) ?? 0);
  });
}

export function sortCollectionDocuments(
  documents: DocumentRecord[],
  mode: CollectionDocumentSortMode
) {
  if (mode === "recent") {
    return sortCollectionDocumentsByRecent(documents);
  }
  if (mode === "name") {
    return sortCollectionDocumentsByName(documents);
  }
  return documents;
}
