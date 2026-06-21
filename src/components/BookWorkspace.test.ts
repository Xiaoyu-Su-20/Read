import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import BookWorkspace from "./BookWorkspace";
import { normalizeReaderFitMode } from "../lib/reader/zoom";
import type { DocumentPayload, ReaderSession, ViewerApi } from "../lib/types";
import { createUnifiedSearchController } from "../search";

vi.mock("./ReaderViewport", () => ({
  default: () => null
}));

const documentPayload: DocumentPayload = {
  document: {
    id: "doc-1",
    title: "Book Mode Title",
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
    lastPage: 12,
    zoom: 1,
    bookmarks: [],
    preferences: {
      fitMode: "width"
    }
  },
  filePath: "D:/Read/example.pdf",
  pageCount: 120
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
    getCurrentPage: vi.fn(() => 12),
    getPageCount: vi.fn(() => 120),
    getReaderState: vi.fn(() => documentPayload.state),
    setBookmarks: vi.fn(),
    ...overrides
  };
}

function renderWorkspace(overrides?: Partial<Parameters<typeof BookWorkspace>[0]>) {
  return BookWorkspace({
    activeViewTransition: null,
    readerSession,
    readerActive: true,
    pendingReaderOpenSessionId: null,
    readerState: documentPayload.state,
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
    documentHeaderCurrentPage: 12,
    documentHeaderPageCount: 120,
    documentHeaderZoom: 1,
    viewerApi: makeViewerApi(),
    onHeaderMouseDown: vi.fn(),
    searchController: createUnifiedSearchController(),
    searchFocusRequest: 0,
    commandPaletteOpen: false,
    onToggleCommandPalette: vi.fn(),
    registerCommandPaletteAnchor: vi.fn(),
    onSearchOpenDocument: vi.fn(async () => undefined),
    onSearchGoToPage: vi.fn(),
    showHeaders: true,
    showFullscreenHint: false,
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
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
  const componentType = element.type as {
    name?: string;
    displayName?: string;
    (props: { [key: string]: unknown }): unknown;
  };
  if (
    typeof element.type === "function" &&
    (componentType.name === "DocumentWorkspaceHeader" ||
      componentType.displayName === "DocumentWorkspaceHeader")
  ) {
    return collectElements(componentType(element.props));
  }
  return [element, ...collectElements(element.props.children)];
}

describe("BookWorkspace", () => {
  it("renders the shared document header and a single document pane", () => {
    const tree = renderWorkspace();
    const elements = collectElements(tree);

    expect(
      elements.some((element) => element.props.className === "reader-workspace__header-title")
    ).toBe(true);
    expect(
      elements.some((element) => element.props.className === "reader-workspace__body reader-workspace__body--book-only")
    ).toBe(true);
    expect(
      elements.some((element) => element.props.className === "reader-workspace__document reader-workspace__document--only")
    ).toBe(true);
    expect(
      elements.some((element) => element.props.className === "reader-workspace__notes")
    ).toBe(false);
    expect(
      elements.some((element) => element.props.className === "reader-workspace__splitter")
    ).toBe(false);
  });

  it("shows the empty document header state when no PDF is open", () => {
    const tree = renderWorkspace({
      readerSession: null,
      documentHeaderTitle: "Book",
      documentHeaderCurrentPage: 1,
      documentHeaderPageCount: 0,
      viewerApi: null
    });
    const elements = collectElements(tree);

    expect(
      elements.some(
        (element) =>
          typeof element.props.className === "string" &&
          element.props.className.includes("reader-workspace__header-value") &&
          element.props.children === "No document"
      )
    ).toBe(true);
  });
});
