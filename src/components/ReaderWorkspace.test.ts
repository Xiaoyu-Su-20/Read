import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ReaderWorkspace from "./ReaderWorkspace";
import type { DocumentPayload, ReaderFitMode, ReaderSession, ViewerApi } from "../lib/types";
import { createUnifiedSearchController } from "../search";

vi.mock("./NotesViewport", () => ({
  default: () => null
}));

vi.mock("./ReaderViewport", () => ({
  default: ({
    activeViewTransition
  }: {
    activeViewTransition: import("../lib/workspaceView").ViewTransition | null;
  }) =>
    createElement("div", {
      "data-testid": "reader-viewport",
      "data-from-view": activeViewTransition?.fromView ?? "",
      "data-to-view": activeViewTransition?.toView ?? ""
    })
}));

vi.mock("./PaneResizeHandle", () => ({
  default: () => null
}));

vi.mock("../lib/reader/useReaderPaneLayoutController", () => ({
  useReaderPaneLayoutController: () => ({
    containerRef: { current: null },
    workspaceStyle: undefined,
    isDragging: false,
    isStackedLayout: false,
    separatorProps: {
      role: "separator",
      "aria-label": "Resize document and notes panes",
      "aria-orientation": "vertical",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": 46,
      tabIndex: 0,
      onKeyDown: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onLostPointerCapture: vi.fn()
    }
  })
}));

const documentPayload: DocumentPayload = {
  document: {
    id: "doc-1",
    title: "A Very Long Reader Title That Should Truncate Before Controls Collapse",
    fileName: "example.pdf",
    folderId: "collection-1",
    relativePath: "collection-1/example.pdf",
    fingerprint: "fingerprint-1",
    importedAt: "2026-06-14T00:00:00Z",
    lastOpenedAt: "2026-06-14T00:00:00Z",
    availability: "available"
  },
  state: {
    version: 1,
    documentId: "doc-1",
    fingerprint: "fingerprint-1",
    lastOpenedAt: "2026-06-14T00:00:00Z",
    lastPage: 52,
    zoom: 1,
    bookmarks: [],
    preferences: {
      fitMode: "width"
    }
  },
  filePath: "D:/Read/example.pdf",
  pageCount: 191
};

const readerSession: ReaderSession = {
  document: documentPayload,
  documentId: documentPayload.document.id,
  page: documentPayload.state.lastPage,
  zoom: documentPayload.state.zoom,
  openSessionId: "open-test",
  clickStartedAtMs: 0,
  source: "collection"
};

function makeViewerApi(overrides?: Partial<ViewerApi>): ViewerApi {
  return {
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    getAutoMaximizeZoom: vi.fn(() => 1),
    getAutoMaximizeMinDocumentWidth: vi.fn(() => 640),
    getFitMode: vi.fn((): ReaderFitMode => "auto-maximize"),
    setFitMode: vi.fn(),
    goToPage: vi.fn(),
    navigateToTarget: vi.fn(),
    searchPort: {
      getExtractedPageNumbers: vi.fn(() => new Set<number>()),
      getPageSearchText: vi.fn()
    },
    jumpToOutline: vi.fn(),
    getCurrentPage: vi.fn(() => 52),
    getPageCount: vi.fn(() => 191),
    getReaderState: vi.fn(() => documentPayload.state),
    setBookmarks: vi.fn(),
    ...overrides
  };
}

function renderWorkspace(overrides?: Partial<Parameters<typeof ReaderWorkspace>[0]>) {
  return ReaderWorkspace({
    layoutMode: "reader",
    activeViewTransition: null,
    readerSession,
    readerActive: true,
    pendingReaderOpenSessionId: null,
    note: null,
    notesLoading: false,
    ignoredSpellcheckWords: [],
    noteNavigationItems: [],
    onChangeNoteTitle: vi.fn(),
    onChangeNoteBlocks: vi.fn(),
    onToggleIgnoredSpellcheckWord: vi.fn(),
    onFlushNote: vi.fn(),
    onCopyAllNoteText: vi.fn(),
    onGoToNotePage: vi.fn(),
    currentReaderPage: 52,
    noteRevealRequest: null,
    outlineItems: [],
    readerState: documentPayload.state,
    onNavigateToTarget: vi.fn(),
    onSetBookmarks: vi.fn(),
    onSnapshotChange: vi.fn(),
    onOutlineChange: vi.fn(),
    onStatusChange: vi.fn(),
    onStateChange: vi.fn(),
    registerApi: vi.fn(),
    viewerDisplayConfig: {
      mode: "dark",
      paperColor: "#20242a",
      inkColor: "#d8d8d8",
      blendMode: "screen",
      imageFilter: "invert(1)"
    },
    documentHeaderTitle: documentPayload.document.title,
    documentHeaderCurrentPage: 52,
    documentHeaderPageCount: 191,
    documentHeaderZoom: 1,
    readerViewMode: "page",
    onReaderViewModeChange: vi.fn(),
    viewerApi: makeViewerApi(),
    onHeaderMouseDown: vi.fn(),
    searchController: createUnifiedSearchController(),
    searchFocusRequest: 0,
    navigationOpen: false,
    onNavigationOpenChange: vi.fn(),
    navigationOpenRequest: 0,
    commandPaletteOpen: false,
    onToggleCommandPalette: vi.fn(),
    registerCommandPaletteAnchor: vi.fn(),
    onSearchOpenDocument: vi.fn(async () => undefined),
    onSearchGoToPage: vi.fn(),
    onSearchOpenNoteResult: vi.fn(),
    showHeaders: true,
    showFullscreenHint: false,
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    readerPaneSplitRatio: 0.42,
    hidePaneResizeHandle: false,
    autoHidePaneResizeHandle: true,
    onChangeReaderPaneSplitRatio: vi.fn(),
    ...overrides
  });
}

function renderWorkspaceMarkup(overrides?: Partial<Parameters<typeof ReaderWorkspace>[0]>) {
  return renderToStaticMarkup(renderWorkspace(overrides));
}

function collectElements(node: unknown): Array<ReactElement<{ [key: string]: unknown }>> {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(collectElements);
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ [key: string]: unknown }>;
  const memoComponent = (() => {
    if (
      typeof element.type === "object" &&
      element.type !== null &&
      "type" in element.type &&
      typeof (element.type as { type?: unknown }).type === "function"
    ) {
      return (element.type as { type: (props: { [key: string]: unknown }) => unknown }).type;
    }

    return null;
  })();
  const componentType = element.type as {
    name?: string;
    displayName?: string;
    (props: { [key: string]: unknown }): unknown;
  };
  const resolvedType = memoComponent ?? (typeof element.type === "function" ? componentType : null);
  const resolvedTypeName =
    resolvedType?.name ??
    ((resolvedType as { displayName?: string } | null)?.displayName ?? "");
  if (
    resolvedType &&
    resolvedTypeName !== "WorkspaceSearchField" &&
    !resolvedTypeName.includes("DeferredNotesViewport")
  ) {
    return collectElements(resolvedType(element.props));
  }
  return [element, ...collectElements(element.props.children)];
}

describe("ReaderWorkspace document header", () => {
  it("renders title, page, and zoom regions with stable control labels", () => {
    const markup = renderWorkspaceMarkup();

    expect(markup).toContain("reader-workspace__document-header-layout");
    expect(markup).toContain('class="reader-workspace__header-title"');
    expect(markup).toContain("52 / 191");
    expect(markup).toContain("100%");
    expect(markup).toContain('aria-label="Previous page"');
    expect(markup).toContain('aria-label="Next page"');
    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain('aria-label="Zoom in"');
    expect(markup).not.toContain("Switch to free zoom");
    expect(markup).not.toContain("Switch to auto maximize");
    expect(markup).toContain('aria-label="Reader view mode"');
    expect(markup).toContain("Page");
    expect(markup).toContain("Scroll");
  });

  it("disables page and zoom controls when no document is open", () => {
    const markup = renderWorkspaceMarkup({
      readerSession: null,
      documentHeaderCurrentPage: 1,
      documentHeaderPageCount: 0,
      viewerApi: null
    });

    expect(markup).toContain("No document");
    expect(markup.match(/aria-label="Previous page"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Next page"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Zoom out"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Zoom in"/g)).toHaveLength(1);
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("routes page, zoom, and reader view mode button clicks through the viewer api", () => {
    const viewerApi = makeViewerApi();
    const onReaderViewModeChange = vi.fn();
    const tree = renderWorkspace({ viewerApi, onReaderViewModeChange });
    const elements = collectElements(tree);

    const previousPageButton = elements.find((element) => element.props["aria-label"] === "Previous page");
    const nextPageButton = elements.find((element) => element.props["aria-label"] === "Next page");
    const zoomOutButton = elements.find((element) => element.props["aria-label"] === "Zoom out");
    const zoomInButton = elements.find((element) => element.props["aria-label"] === "Zoom in");
    const scrollModeButton = elements.find((element) => element.props.children === "Scroll");

    const previousPageClick = previousPageButton?.props.onClick as (() => void) | undefined;
    const nextPageClick = nextPageButton?.props.onClick as (() => void) | undefined;
    const zoomOutClick = zoomOutButton?.props.onClick as (() => void) | undefined;
    const zoomInClick = zoomInButton?.props.onClick as (() => void) | undefined;
    const scrollModeClick = scrollModeButton?.props.onClick as (() => void) | undefined;

    previousPageClick?.();
    nextPageClick?.();
    zoomOutClick?.();
    zoomInClick?.();
    scrollModeClick?.();

    expect(viewerApi.previousPage).toHaveBeenCalledTimes(1);
    expect(viewerApi.nextPage).toHaveBeenCalledTimes(1);
    expect(viewerApi.zoomOut).toHaveBeenCalledTimes(1);
    expect(viewerApi.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewerApi.setFitMode).not.toHaveBeenCalled();
    expect(onReaderViewModeChange).toHaveBeenCalledWith("scroll");
  });

  it("uses the persistent document pane for the full-width book layout", () => {
    const markup = renderWorkspaceMarkup({ layoutMode: "book" });

    expect(markup).toContain("reader-workspace--book-only");
    expect(markup).toContain("reader-workspace__body reader-workspace__body--book-only");
    expect(markup).toContain("reader-workspace__document reader-workspace__document--only");
    expect(markup).toContain('data-testid="reader-viewport"');
    expect(markup).not.toContain('class="reader-workspace__notes"');
    expect(markup).not.toContain("reader-workspace__splitter");
    expect(markup).toContain('aria-label="Open command palette"');
    expect(markup).toContain('aria-label="Enter fullscreen"');
  });

  it("forwards book transitions through the same reader viewport", () => {
    const markup = renderWorkspaceMarkup({
      layoutMode: "book",
      activeViewTransition: {
        clickStartedAtMs: 10,
        fromView: "reader",
        source: "sidebar",
        toView: "book",
        viewTransitionId: "view-book-1"
      }
    });

    expect(markup).toContain('data-from-view="reader"');
    expect(markup).toContain('data-to-view="book"');
  });
});
