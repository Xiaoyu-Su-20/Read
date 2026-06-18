import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UnifiedSearchController, UnifiedSearchState } from "../controller/UnifiedSearchController";
import WorkspaceSearchField from "./WorkspaceSearchField";

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
          id: "nearby-page",
          label: "Document Â· Nearby Page",
          total: 1,
          countIsFinal: false,
          state: "searching",
          truncated: false,
          action: null,
          results: [{
            id: "pdf:4:0",
            kind: "pdf",
            sourceId: "pdf-text",
            title: "Page 4",
            snippet: "Deep focus matters",
            highlights: [{ start: 5, end: 10 }],
            pageNumber: 4,
            matchIndex: 0,
            location: "current"
          }]
        },
        {
          id: "across-document",
          label: "Document Â· Across document",
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
    setQuery: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    dismiss: vi.fn(),
    moveActiveResult: vi.fn(),
    searchEntireDocument: vi.fn(),
    getActiveResult: vi.fn(),
    setActiveResult: vi.fn(),
    toggleGroup: vi.fn(),
    cancel: vi.fn()
  } as unknown as UnifiedSearchController;

  return renderToStaticMarkup(createElement(WorkspaceSearchField, {
    controller,
    focusRequest: 0,
    onOpenDocument: vi.fn(),
    onGoToPage: vi.fn(),
    onRevealNoteBlock: vi.fn()
  }));
}

describe("WorkspaceSearchField", () => {
  it("renders as a header field with a dropdown instead of an overlay", () => {
    const markup = renderState(makeState());
    expect(markup).toContain("workspace-search__field");
    expect(markup).toContain("workspace-search__dropdown");
    expect(markup).not.toContain("search-overlay");
    expect(markup).toContain("Document");
    expect(markup).toContain("Nearby Page");
    expect(markup).toContain("Search entire document");
    expect(markup).not.toContain("3/8 pages");
    expect(markup).toContain("search-group__decorator");
    expect(markup).not.toContain("search-result__icon");
  });

  it("renders the ready state when focused without a query", () => {
    const markup = renderState(makeState({
      inputQuery: "",
      phase: "idle",
      activeResultId: null,
      selectionOrigin: null,
      committedView: { ...makeState().committedView, query: "", stale: false }
    }));
    expect(markup).not.toContain("workspace-search__dropdown");
    expect(markup).not.toContain("Type to search the current note, current document, and library titles.");
  });

  it("does not render an empty dropdown when a query has no visible result groups", () => {
    const markup = renderState(makeState({
      committedView: {
        ...makeState().committedView,
        groups: [],
        warnings: []
      }
    }));
    expect(markup).not.toContain("workspace-search__dropdown");
  });

  it("renders with no placeholder text", () => {
    const markup = renderState(makeState());
    expect(markup).not.toContain("placeholder=");
  });

  it("renders the trailing chevron on show-all actions", () => {
    const markup = renderState(makeState({
      committedView: {
        ...makeState().committedView,
        groups: [{
          ...makeState().committedView.groups[0],
          total: 9,
          results: new Array(6).fill(null).map((_, index) => ({
            id: `pdf:4:${index}`,
            kind: "pdf" as const,
            sourceId: "pdf-text" as const,
            title: "Page 4",
            snippet: `Deep focus matters ${index}`,
            highlights: [{ start: 5, end: 10 }],
            pageNumber: 4,
            matchIndex: index,
            location: "current" as const
          }))
        }]
      }
    }));
    expect(markup).toContain("Show all 9 results &gt;");
  });
});
