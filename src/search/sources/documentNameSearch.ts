import type { SearchSource } from "../model/SearchResult";
import { searchDocumentNameMatches } from "./documentNameMatches";

export const documentNameSearch: SearchSource = {
  id: "document-name",
  async *search(request, signal) {
    if (request.sourceId !== "document-name") return;
    const results = signal.aborted
      ? []
      : searchDocumentNameMatches(request.documents, request.normalizedQuery, 51);
    if (!signal.aborted) {
      yield { sourceId: "document-name", stageId: request.stageId, results, completed: true };
    }
  }
};
