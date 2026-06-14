import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UnifiedSearchController, UnifiedSearchState } from "../controller/UnifiedSearchController";
import UnifiedSearchOverlay from "./UnifiedSearchOverlay";

function makeState(overrides: Partial<UnifiedSearchState> = {}): UnifiedSearchState {
  return {
    open: true,
    inputQuery: "focus",
    liveGeneration: null,
    phase: "streaming",
    activeResultId: "pdf:4:0",
    selectionOrigin: "keyboard",
    expandedGroups: new Set(),
    committedView: {
      query: "focus",
      stale: false,
      warnings: [],
      progress: { completedPages: 3, totalPages: 8 },
      groups: [
        {
          id: "current-page",
          label: "Document · Current page",
          total: 1,
          countIsFinal: false,
          state: "searching",
          truncated: false,
          action: null,
          results: [{
            id: "pdf:4:0", kind: "pdf", sourceId: "pdf-text", title: "Page 4",
            snippet: "Deep focus matters", highlights: [{ start: 5, end: 10 }],
            pageNumber: 4, matchIndex: 0, location: "current"
          }]
        },
        {
          id: "across-document",
          label: "Document · Across document",
          total: 0,
          countIsFinal: true,
          state: "idle",
          truncated: false,
          action: { kind: "search-entire-document", label: "Search entire document" },
          results: []
        }
      ]
    },
    ...overrides
  };
}

function renderState(state: UnifiedSearchState) {
  const controller = {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    setQuery: vi.fn(), close: vi.fn(), moveActiveResult: vi.fn(), searchEntireDocument: vi.fn(),
    getActiveResult: vi.fn(), setActiveResult: vi.fn(), toggleGroup: vi.fn(), cancel: vi.fn()
  } as unknown as UnifiedSearchController;
  return renderToStaticMarkup(createElement(UnifiedSearchOverlay, {
    controller,
    onOpenDocument: vi.fn(),
    onGoToPage: vi.fn(),
    onRevealNoteBlock: vi.fn()
  }));
}

describe("UnifiedSearchOverlay", () => {
  it("renders fixed groups, approximate counts, and no planner mode", () => {
    const markup = renderState(makeState());
    expect(markup).toContain("Document · Current page");
    expect(markup).toContain("Document · Across document");
    expect(markup).toContain(">1+<");
    expect(markup).toContain("<mark>focus</mark>");
    expect(markup).toContain("Search entire document");
    expect(markup).toContain("3/8 pages");
    expect(markup).not.toContain("progressive");
  });

  it("dims and disables stale committed rows", () => {
    const state = makeState({
      inputQuery: "focused",
      phase: "typing",
      committedView: { ...makeState().committedView, stale: true }
    });
    const markup = renderState(state);
    expect(markup).toContain("unified-search__body--stale");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Searching current reader");
  });

  it("reserves the clear-button slot when the query is empty", () => {
    const state = makeState({
      inputQuery: "",
      phase: "idle",
      activeResultId: null,
      selectionOrigin: null,
      committedView: { ...makeState().committedView, query: "", stale: false }
    });
    const markup = renderState(state);
    expect(markup).toContain("unified-search__clear unified-search__clear--hidden");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('tabindex="-1"');
  });
});
