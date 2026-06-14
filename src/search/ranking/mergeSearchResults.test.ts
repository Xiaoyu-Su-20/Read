import { describe, expect, it } from "vitest";

import type { SearchResult } from "../model/SearchResult";
import { groupSearchResults, rankSearchResults } from "./mergeSearchResults";

const common = { snippet: "match", highlights: [] };

describe("search result ranking", () => {
  it("orders result tiers and groups them", () => {
    const results: SearchResult[] = [
      { ...common, id: "far", kind: "pdf", sourceId: "pdf-text", title: "Page 20", pageNumber: 20, matchIndex: 0, location: "across" },
      { ...common, id: "document", kind: "document", sourceId: "document-name", title: "Match", documentId: "d", available: true },
      { ...common, id: "near", kind: "pdf", sourceId: "pdf-text", title: "Page 6", pageNumber: 6, matchIndex: 0, location: "nearby" },
      { ...common, id: "current", kind: "pdf", sourceId: "pdf-text", title: "Page 5", pageNumber: 5, matchIndex: 0, location: "current" },
      { ...common, id: "note", kind: "note", sourceId: "notes", title: "Note", noteId: "n", blockId: "b" }
    ];
    const ranked = rankSearchResults(results, { currentPage: 5, nearbyPages: new Set([4, 5, 6]) });
    expect(ranked.map((result) => result.id)).toEqual(["note", "current", "near", "document", "far"]);
    expect(groupSearchResults(ranked).map((group) => group.id)).toEqual([
      "notes", "current-page", "nearby-pages", "across-document", "documents"
    ]);
  });
});

