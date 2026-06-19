import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import ReaderWorkspace from "./ReaderWorkspace";
import { normalizeReaderFitMode } from "../lib/reader/zoom";
import type { DocumentPayload, ReaderSession, ViewerApi } from "../lib/types";
import { createUnifiedSearchController } from "../search";

vi.mock("./NotesViewport", () => ({
  default: () => null
}));

vi.mock("./ReaderViewport", () => ({
  default: () => null
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
    },
    userOutlineItems: []
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
    getFitMode: vi.fn(() => normalizeReaderFitMode(documentPayload.state.preferences.fitMode)),
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
    setUserOutlineItems: vi.fn(),
    ...overrides
  };
}

function renderWorkspace(overrides?: Partial<Parameters<typeof ReaderWorkspace>[0]>) {
  return ReaderWorkspace({
    activeViewTransition: null,
    readerSession,
    readerActive: true,
    pendingReaderOpenSessionId: null,
    note: null,
    notesLoading: false,
    noteNavigationItems: [],
    onChangeNoteTitle: vi.fn(),
    onChangeNoteBlocks: vi.fn(),
    onFlushNote: vi.fn(),
    onCopyAllNoteText: vi.fn(),
    onGoToNotePage: vi.fn(),
    currentReaderPage: 52,
    noteRevealRequest: null,
    outlineItems: [],
    readerState: documentPayload.state,
    onNavigateToTarget: vi.fn(),
    onSetUserOutlineItems: vi.fn(),
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
    viewerApi: makeViewerApi(),
    onHeaderMouseDown: vi.fn(),
    windowControls: null,
    searchController: createUnifiedSearchController(),
    searchFocusRequest: 0,
    commandPaletteOpen: false,
    onToggleCommandPalette: vi.fn(),
    registerCommandPaletteAnchor: vi.fn(),
    onSearchOpenDocument: vi.fn(async () => undefined),
    onSearchGoToPage: vi.fn(),
    onSearchRevealNoteBlock: vi.fn(),
    showHeaders: true,
    showFullscreenHint: false,
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    readerPaneSplitRatio: 0.46,
    hidePaneResizeHandle: false,
    onChangeReaderPaneSplitRatio: vi.fn(),
    ...overrides
  });
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
  return [element, ...collectElements(element.props.children)];
}

describe("ReaderWorkspace document header", () => {
  it("renders title, page, and zoom regions with stable control labels", () => {
    const tree = renderWorkspace();
    const elements = collectElements(tree);

    const layout = elements.find(
      (element) => element.props.className === "reader-workspace__document-header-layout"
    );
    const pageValue = elements.find(
      (element) =>
        element.props.className === "reader-workspace__header-value" && element.props.children === "52 / 191"
    );
    const zoomValue = elements.find(
      (element) =>
        element.props.className === "reader-workspace__header-value" && element.props.children === "100%"
    );

    expect(layout).toBeDefined();
    expect(elements.some((element) => element.props.className === "reader-workspace__header-title")).toBe(true);
    expect(pageValue).toBeDefined();
    expect(zoomValue).toBeDefined();
    expect(elements.some((element) => element.props["aria-label"] === "Previous page")).toBe(true);
    expect(elements.some((element) => element.props["aria-label"] === "Next page")).toBe(true);
    expect(elements.some((element) => element.props["aria-label"] === "Zoom out")).toBe(true);
    expect(elements.some((element) => element.props["aria-label"] === "Zoom in")).toBe(true);
    expect(elements.some((element) => element.props["aria-label"] === "Switch to free zoom")).toBe(true);
  });

  it("disables page and zoom controls when no document is open", () => {
    const tree = renderWorkspace({
      readerSession: null,
      documentHeaderCurrentPage: 1,
      documentHeaderPageCount: 0,
      viewerApi: null
    });
    const elements = collectElements(tree);
    const controlButtons = elements.filter((element) =>
      [
        "Previous page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Switch to auto maximize",
        "Switch to free zoom"
      ].includes(String(element.props["aria-label"]))
    );
    const pageValue = elements.find(
      (element) =>
        element.props.className === "reader-workspace__header-value" &&
        element.props.children === "No document"
    );

    expect(pageValue).toBeDefined();
    expect(controlButtons).toHaveLength(5);
    expect(controlButtons.filter((element) => element.props.disabled === true)).toHaveLength(5);
  });

  it("routes page, zoom, and fit mode button clicks through the viewer api", () => {
    const viewerApi = makeViewerApi();
    const tree = renderWorkspace({ viewerApi });
    const elements = collectElements(tree);

    const previousPageButton = elements.find((element) => element.props["aria-label"] === "Previous page");
    const nextPageButton = elements.find((element) => element.props["aria-label"] === "Next page");
    const zoomOutButton = elements.find((element) => element.props["aria-label"] === "Zoom out");
    const zoomInButton = elements.find((element) => element.props["aria-label"] === "Zoom in");
    const fitModeButton = elements.find((element) => element.props["aria-label"] === "Switch to free zoom");

    const previousPageClick = previousPageButton?.props.onClick as (() => void) | undefined;
    const nextPageClick = nextPageButton?.props.onClick as (() => void) | undefined;
    const zoomOutClick = zoomOutButton?.props.onClick as (() => void) | undefined;
    const zoomInClick = zoomInButton?.props.onClick as (() => void) | undefined;
    const fitModeClick = fitModeButton?.props.onClick as (() => void) | undefined;

    previousPageClick?.();
    nextPageClick?.();
    zoomOutClick?.();
    zoomInClick?.();
    fitModeClick?.();

    expect(viewerApi.previousPage).toHaveBeenCalledTimes(1);
    expect(viewerApi.nextPage).toHaveBeenCalledTimes(1);
    expect(viewerApi.zoomOut).toHaveBeenCalledTimes(1);
    expect(viewerApi.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewerApi.setFitMode).toHaveBeenCalledWith("free");
  });
});
