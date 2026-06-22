import type { DocumentRecord } from "../../lib/types";
import type { DocumentNameSearchResult } from "../model/SearchResult";
import { makeSnippet } from "./searchText";

export function searchDocumentNameMatches(
  documents: readonly DocumentRecord[],
  normalizedQuery: string,
  limit = 51
): DocumentNameSearchResult[] {
  const trimmedQuery = normalizedQuery.trim();
  if (!trimmedQuery) {
    return [];
  }

  return documents
    .flatMap((document) => {
      const searchable = `${document.title} ${document.fileName}`;
      const matchIndex = searchable.toLocaleLowerCase().indexOf(trimmedQuery);
      if (matchIndex < 0) {
        return [];
      }

      const preview = makeSnippet(searchable, matchIndex, trimmedQuery.length);
      if (!preview) {
        return [];
      }

      return [{
        id: `document:${document.id}`,
        kind: "document" as const,
        sourceId: "document-name" as const,
        title: document.title,
        documentId: document.id,
        available: document.availability === "available",
        ...preview
      }];
    })
    .slice(0, limit);
}
