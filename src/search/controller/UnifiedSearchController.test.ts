import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchPlan, SearchPlanningContext } from "../model/SearchPlan";
import type { SearchSource } from "../model/SearchResult";
import { createSearchPlan } from "../planning/SearchPlanner";
import { UnifiedSearchController } from "./UnifiedSearchController";

type SearchPlanner = (context: SearchPlanningContext) => SearchPlan;

const documentRecord = {
  id: "d1",
  title: "Structure",
  fileName: "structure.pdf",
  folderId: "f",
  relativePath: "structure.pdf",
  fingerprint: "fp",
  importedAt: "now",
  lastOpenedAt: null,
  availability: "available" as const
};

function documentSource(log?: string[]): SearchSource {
  return {
    id: "document-name",
    async *search(request) {
      if (request.sourceId !== "document-name") return;
      log?.push(`documents:${Date.now()}`);
      yield {
        sourceId: "document-name",
        stageId: request.stageId,
        completed: true,
        results: [{
          id: "document:d1",
          kind: "document",
          sourceId: "document-name",
          title: "Structure",
          documentId: "d1",
          available: true,
          snippet: "Structure",
          highlights: [{ start: 0, end: 9 }]
        }]
      };
    }
  };
}

describe("UnifiedSearchController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the committed view stable through rapid typing and commits atomically", async () => {
    const source = documentSource();
    const controller = new UnifiedSearchController(createSearchPlan, new Map([[source.id, source]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 0,
      activeDocumentId: null,
      currentNote: null,
      pdfPort: null,
      documents: [documentRecord]
    });
    controller.open();

    controller.setQuery("struct");
    await vi.advanceTimersByTimeAsync(40);
    controller.setQuery("structu");
    await vi.advanceTimersByTimeAsync(40);
    controller.setQuery("structur");
    await vi.advanceTimersByTimeAsync(40);
    controller.setQuery("structure");

    expect(controller.getSnapshot().phase).toBe("typing");
    expect(controller.getSnapshot().committedView.query).toBe("");
    expect(controller.getSnapshot().committedView.stale).toBe(true);

    await vi.advanceTimersByTimeAsync(139);
    expect(controller.getSnapshot().committedView.query).toBe("");

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot().committedView.query).toBe("structure");
    expect(controller.getSnapshot().committedView.stale).toBe(false);
    expect(controller.getSnapshot().committedView.groups[0]?.results[0]?.id).toBe("document:d1");
  });

  it("runs cheap sources at 60 ms and uncached PDF work at 220 ms", async () => {
    const log: string[] = [];
    const documents = documentSource(log);
    const pdf: SearchSource = {
      id: "pdf-text",
      async *search(request) {
        if (request.sourceId !== "pdf-text") return;
        log.push(`pdf:${Date.now()}`);
        yield { sourceId: "pdf-text", stageId: request.stageId, results: [], completed: true };
      }
    };
    const planner = (() => ({
      mode: "local" as const,
      ranking: { currentPage: 1, nearbyPages: new Set([1]) },
      stages: [
        { id: "documents", delayMs: 0, sourceId: "document-name" as const },
        { id: "current-page", delayMs: 0, sourceId: "pdf-text" as const, pageNumbers: [1] }
      ]
    })) satisfies SearchPlanner;
    const controller = new UnifiedSearchController(planner, new Map([[documents.id, documents], [pdf.id, pdf]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 10,
      activeDocumentId: "d1",
      currentNote: null,
      documents: [documentRecord],
      pdfPort: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async () => ""
      }
    });
    controller.open();
    controller.setQuery("focus");

    await vi.advanceTimersByTimeAsync(60);
    expect(log).toEqual(["documents:60"]);
    await vi.advanceTimersByTimeAsync(159);
    expect(log).toEqual(["documents:60"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["documents:60", "pdf:220"]);
  });

  it("runs an extracted current page with cheap sources", async () => {
    const log: string[] = [];
    const pdf: SearchSource = {
      id: "pdf-text",
      async *search(request) {
        if (request.sourceId !== "pdf-text") return;
        log.push(`pdf:${Date.now()}`);
        yield { sourceId: "pdf-text", stageId: request.stageId, results: [], completed: true };
      }
    };
    const planner = (() => ({
      mode: "broad-query" as const,
      ranking: { currentPage: 1, nearbyPages: new Set([1]) },
      stages: [{ id: "current-page", delayMs: 0, sourceId: "pdf-text" as const, pageNumbers: [1] }]
    })) satisfies SearchPlanner;
    const controller = new UnifiedSearchController(planner, new Map([[pdf.id, pdf]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 10,
      activeDocumentId: "d1",
      currentNote: null,
      documents: [],
      pdfPort: {
        getExtractedPageNumbers: () => new Set([1]),
        getPageSearchText: async () => ""
      }
    });
    controller.open();
    controller.setQuery("the");
    await vi.advanceTimersByTimeAsync(60);
    expect(log).toEqual(["pdf:60"]);
  });

  it("bypasses execution gates for explicit full search", async () => {
    const log: string[] = [];
    const pdf: SearchSource = {
      id: "pdf-text",
      async *search(request) {
        if (request.sourceId !== "pdf-text") return;
        log.push(`pdf:${Date.now()}`);
        yield { sourceId: "pdf-text", stageId: request.stageId, results: [], completed: true };
      }
    };
    const planner = (() => ({
      mode: "full" as const,
      ranking: { currentPage: 1, nearbyPages: new Set([1]) },
      stages: [{ id: "current-page", delayMs: 0, sourceId: "pdf-text" as const, pageNumbers: [1] }]
    })) satisfies SearchPlanner;
    const controller = new UnifiedSearchController(planner, new Map([[pdf.id, pdf]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 10,
      activeDocumentId: "d1",
      currentNote: null,
      documents: [],
      pdfPort: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async () => ""
      }
    });
    controller.open();
    controller.setQuery("focus");
    controller.searchEntireDocument();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["pdf:0"]);
  });

  it("keeps the fixed capability group shell for broad queries", async () => {
    const controller = new UnifiedSearchController(createSearchPlan, new Map());
    controller.setContext({
      currentPage: 1,
      totalPages: 10,
      activeDocumentId: "d1",
      currentNote: {
        id: "n", title: "Note", bookId: "d1", createdAt: "now", updatedAt: "now", version: 1, blocks: []
      },
      documents: [documentRecord],
      pdfPort: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async () => ""
      }
    });
    controller.open();
    controller.setQuery("the");
    await vi.advanceTimersByTimeAsync(180);
    expect(controller.getSnapshot().committedView.groups.map((group) => group.id)).toEqual([
      "notes", "current-page", "nearby-pages", "across-document", "documents"
    ]);
    expect(controller.getSnapshot().committedView.groups.find((group) => group.id === "across-document")?.action?.kind)
      .toBe("search-entire-document");
  });

  it("does not notify subscribers for live batches before presentation commits", async () => {
    const source: SearchSource = {
      id: "document-name",
      async *search(request) {
        if (request.sourceId !== "document-name") return;
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        yield {
          sourceId: "document-name",
          stageId: request.stageId,
          completed: true,
          results: [{
            id: "document:d1", kind: "document", sourceId: "document-name", title: "Structure",
            documentId: "d1", available: true, snippet: "Structure", highlights: []
          }]
        };
      }
    };
    const controller = new UnifiedSearchController(createSearchPlan, new Map([[source.id, source]]));
    controller.setContext({
      currentPage: 1, totalPages: 0, activeDocumentId: null, currentNote: null, pdfPort: null,
      documents: [documentRecord]
    });
    let notifications = 0;
    controller.subscribe(() => { notifications += 1; });
    controller.open();
    controller.setQuery("structure");
    await vi.advanceTimersByTimeAsync(60);
    const afterSettling = notifications;
    await vi.advanceTimersByTimeAsync(20);
    expect(notifications).toBe(afterSettling);
    await vi.advanceTimersByTimeAsync(60);
    expect(notifications).toBe(afterSettling + 1);
  });

  it("cancels the active generation without clearing committed results", async () => {
    const source = documentSource();
    const controller = new UnifiedSearchController(createSearchPlan, new Map([[source.id, source]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 0,
      activeDocumentId: null,
      currentNote: null,
      pdfPort: null,
      documents: [documentRecord]
    });
    controller.open();
    controller.setQuery("structure");
    await vi.advanceTimersByTimeAsync(140);
    const committed = controller.getSnapshot().committedView;
    controller.setQuery("structure again");
    controller.cancel();
    expect(controller.getSnapshot().phase).toBe("cancelled");
    expect(controller.getSnapshot().committedView.groups).toEqual(committed.groups);
  });

  it("defers final sorting during keyboard selection and sorts when selection clears", async () => {
    const pdf: SearchSource = {
      id: "pdf-text",
      async *search(request) {
        if (request.sourceId !== "pdf-text") return;
        yield {
          sourceId: "pdf-text",
          stageId: request.stageId,
          completed: false,
          progress: { completedPages: 1, totalPages: 2 },
          results: [{
            id: "late", kind: "pdf", sourceId: "pdf-text", title: "Page 20", snippet: "match",
            highlights: [], pageNumber: 20, matchIndex: 0, location: "across"
          }]
        };
        await new Promise((resolve) => window.setTimeout(resolve, 130));
        yield {
          sourceId: "pdf-text",
          stageId: request.stageId,
          completed: true,
          progress: { completedPages: 2, totalPages: 2 },
          results: [{
            id: "early", kind: "pdf", sourceId: "pdf-text", title: "Page 2", snippet: "match",
            highlights: [], pageNumber: 2, matchIndex: 0, location: "across"
          }]
        };
      }
    };
    const planner = (() => ({
      mode: "full" as const,
      ranking: { currentPage: 1, nearbyPages: new Set([1]) },
      stages: [{ id: "remaining", delayMs: 0, sourceId: "pdf-text" as const, pageNumbers: [20, 2] }]
    })) satisfies SearchPlanner;
    const controller = new UnifiedSearchController(planner, new Map([[pdf.id, pdf]]));
    controller.setContext({
      currentPage: 1,
      totalPages: 20,
      activeDocumentId: "d1",
      currentNote: null,
      documents: [],
      pdfPort: {
        getExtractedPageNumbers: () => new Set(),
        getPageSearchText: async () => ""
      }
    });
    controller.open();
    controller.setQuery("deep work");

    await vi.advanceTimersByTimeAsync(260);
    expect(controller.getSnapshot().committedView.groups.find((group) => group.id === "across-document")?.results.map((result) => result.id))
      .toEqual(["late"]);
    controller.moveActiveResult(1);

    await vi.advanceTimersByTimeAsync(120);
    expect(controller.getSnapshot().committedView.groups.find((group) => group.id === "across-document")?.results.map((result) => result.id))
      .toEqual(["late", "early"]);

    controller.setActiveResult(null);
    expect(controller.getSnapshot().committedView.groups.find((group) => group.id === "across-document")?.results.map((result) => result.id))
      .toEqual(["early", "late"]);
  });
});
