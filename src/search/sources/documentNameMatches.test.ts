import { describe, expect, it } from "vitest";

import { searchDocumentNameMatches } from "./documentNameMatches";

const documents = [
  {
    id: "doc-1",
    title: "Deep Work",
    fileName: "deep-work.pdf",
    folderId: "f",
    relativePath: "deep-work.pdf",
    fingerprint: "fp-1",
    importedAt: "now",
    lastOpenedAt: null,
    availability: "available" as const
  },
  {
    id: "doc-2",
    title: "Missing Manual",
    fileName: "missing-manual.pdf",
    folderId: "f",
    relativePath: "missing-manual.pdf",
    fingerprint: "fp-2",
    importedAt: "now",
    lastOpenedAt: null,
    availability: "missing" as const
  }
];

describe("searchDocumentNameMatches", () => {
  it("matches both titles and raw file names", () => {
    const titleResults = searchDocumentNameMatches(documents, "deep");
    const fileNameResults = searchDocumentNameMatches(documents, "manual.pdf");

    expect(titleResults[0]).toMatchObject({
      kind: "document",
      documentId: "doc-1",
      available: true
    });
    expect(fileNameResults[0]).toMatchObject({
      kind: "document",
      documentId: "doc-2",
      available: false
    });
  });

  it("returns no results for empty queries", () => {
    expect(searchDocumentNameMatches(documents, "")).toEqual([]);
    expect(searchDocumentNameMatches(documents, "   ")).toEqual([]);
  });
});
