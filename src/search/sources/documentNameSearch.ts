import type { SearchSource } from "../model/SearchResult";
import { makeSnippet } from "./searchText";

export const documentNameSearch: SearchSource = {
  id: "document-name",
  async *search(request, signal) {
    if (request.sourceId !== "document-name") return;
    const results = request.documents.flatMap((document) => {
      if (signal.aborted) return [];
      const searchable = `${document.title} ${document.fileName}`;
      const matchIndex = searchable.toLocaleLowerCase().indexOf(request.normalizedQuery);
      if (matchIndex < 0) return [];
      const preview = makeSnippet(searchable, matchIndex, request.normalizedQuery.length);
      if (!preview) return [];
      return [{
        id: `document:${document.id}`,
        kind: "document" as const,
        sourceId: "document-name" as const,
        title: document.title,
        documentId: document.id,
        available: document.availability === "available",
        ...preview
      }];
    }).slice(0, 51);
    if (!signal.aborted) {
      yield { sourceId: "document-name", stageId: request.stageId, results, completed: true };
    }
  }
};
