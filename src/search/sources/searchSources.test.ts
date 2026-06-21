import { describe, expect, it } from "vitest";

import type { SearchResultBatch } from "../model/SearchResult";
import { documentNameSearch } from "./documentNameSearch";
import { notesSearch } from "./notesSearch";
import { pdfTextSearch } from "./pdfTextSearch";

async function collect(iterable: AsyncIterable<SearchResultBatch>) {
  const batches: SearchResultBatch[] = [];
  for await (const batch of iterable) batches.push(batch);
  return batches;
}

describe("search sources", () => {
  it("returns one current-note result per matching block", async () => {
    const batches = await collect(notesSearch.search({
      sourceId: "notes",
      mode: "current-note",
      stageId: "notes",
      query: "focus",
      normalizedQuery: "focus",
      note: {
        id: "note-1",
        title: "Reading notes",
        bookId: "doc-1",
        createdAt: "now",
        updatedAt: "now",
        version: 1,
        blocks: [
          { id: "a", type: "paragraph", children: [{ type: "text", text: "Deep focus matters." }] },
          { id: "b", type: "paragraph", children: [{ type: "text", text: "No match." }] }
        ]
      }
    }, new AbortController().signal));
    expect(batches[0]?.results).toHaveLength(1);
    expect(batches[0]?.results[0]).toMatchObject({ kind: "note", blockId: "a" });
    expect(batches[0]?.results[0]?.highlights).toHaveLength(1);
  });

  it("keeps missing document matches disabled", async () => {
    const batches = await collect(documentNameSearch.search({
      sourceId: "document-name",
      stageId: "documents",
      query: "deep",
      normalizedQuery: "deep",
      documents: [{
        id: "doc-1", title: "Deep Work", fileName: "deep-work.pdf", folderId: "f",
        relativePath: "deep-work.pdf", fingerprint: "fp", importedAt: "now",
        lastOpenedAt: null, availability: "missing"
      }]
    }, new AbortController().signal));
    expect(batches[0]?.results[0]).toMatchObject({ kind: "document", available: false });
  });

  it("matches both document title and raw pdf file name", async () => {
    const requestBase = {
      sourceId: "document-name" as const,
      stageId: "documents",
      documents: [{
        id: "doc-1",
        title: "Deep Work",
        fileName: "deep-work.pdf",
        folderId: "f",
        relativePath: "deep-work.pdf",
        fingerprint: "fp",
        importedAt: "now",
        lastOpenedAt: null,
        availability: "available" as const
      }]
    };

    const titleBatches = await collect(documentNameSearch.search({
      ...requestBase,
      query: "deep",
      normalizedQuery: "deep"
    }, new AbortController().signal));

    const fileNameBatches = await collect(documentNameSearch.search({
      ...requestBase,
      query: "work.pdf",
      normalizedQuery: "work.pdf"
    }, new AbortController().signal));

    expect(titleBatches[0]?.results[0]).toMatchObject({ kind: "document", documentId: "doc-1" });
    expect(fileNameBatches[0]?.results[0]).toMatchObject({ kind: "document", documentId: "doc-1" });
  });

  it("streams PDF matches with snippets and page progress", async () => {
    const batches = await collect(pdfTextSearch.search({
      sourceId: "pdf-text",
      stageId: "pages",
      query: "focus",
      normalizedQuery: "focus",
      pageNumbers: [2, 3],
      currentPage: 2,
      nearbyPages: new Set([2, 3]),
      concurrency: 2,
      port: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async (page) => page === 2 ? "Focus here and focus again." : "Nothing here."
      }
    }, new AbortController().signal));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.results).toHaveLength(2);
    expect(batches[0]?.results[0]).toMatchObject({ kind: "pdf", pageNumber: 2, location: "current" });
    expect(batches[0]?.progress).toEqual({ completedPages: 2, totalPages: 2 });
  });

  it("builds PDF snippets around normalized matches and keeps highlights in range", async () => {
    const batches = await collect(pdfTextSearch.search({
      sourceId: "pdf-text",
      stageId: "pages",
      query: "produce",
      normalizedQuery: "produce",
      pageNumbers: [7],
      currentPage: 7,
      nearbyPages: new Set([7]),
      concurrency: 1,
      port: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async () =>
          "The system may pro- duce meaning across line breaks while preserving searchable text."
      }
    }, new AbortController().signal));

    const result = batches[0]?.results[0];
    expect(result).toMatchObject({ kind: "pdf", pageNumber: 7, location: "current" });
    expect(result?.snippet.toLocaleLowerCase()).toContain("produce");
    expect(result?.snippet).not.toContain("pro- duce");
    expect(result?.highlights).toHaveLength(1);
    expect(result?.highlights[0]?.start).toBeGreaterThanOrEqual(0);
    expect(result?.highlights[0]?.end).toBeLessThanOrEqual(result?.snippet.length ?? 0);
  });
});
