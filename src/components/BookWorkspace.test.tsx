import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import BookWorkspace from "./BookWorkspace";
import type { DocumentPayload, ReaderFitMode, ReaderSession, ViewerApi } from "../lib/types";
import { createUnifiedSearchController } from "../search";
import type { ViewTransition } from "../lib/workspaceView";

vi.mock("./ReaderViewport", () => ({
  default: ({
    activeViewTransition
  }: {
    activeViewTransition: ViewTransition | null;
  }) => (
    <div
      data-testid="reader-viewport"
      data-from-view={activeViewTransition?.fromView ?? ""}
      data-to-view={activeViewTransition?.toView ?? ""}
    />
  )
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
    version: 2,
    documentId: "doc-1",
    fingerprint: "fingerprint-1",
    lastOpenedAt: "2026-06-14T00:00:00Z",
    lastPage: 12,
    scrollZoom: 1,
    bookmarks: []
  },
  filePath: "D:/Read/example.pdf",
  pageCount: 120
};

const readerSession: ReaderSession = {
  document: documentPayload,
  documentId: documentPayload.document.id,
  page: documentPayload.state.lastPage,
  scrollZoom: documentPayload.state.scrollZoom,
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
    getCurrentPage: vi.fn(() => 12),
    getPageCount: vi.fn(() => 120),
    getReaderState: vi.fn(() => documentPayload.state),
    setBookmarks: vi.fn(),
    ...overrides
  };
}

function renderWorkspace(overrides?: Partial<Parameters<typeof BookWorkspace>[0]>) {
  return renderToStaticMarkup(
    <BookWorkspace
      activeViewTransition={null}
      readerSession={readerSession}
      readerActive={true}
      pendingReaderOpenSessionId={null}
      readerState={documentPayload.state}
      onSnapshotChange={vi.fn()}
      onOutlineChange={vi.fn()}
      onStatusChange={vi.fn()}
      onStateChange={vi.fn()}
      registerApi={vi.fn()}
      viewerDisplayConfig={{
        mode: "dark",
        paperColor: "#20242a",
        inkColor: "#d8d8d8",
        blendMode: "screen",
        imageFilter: "invert(1)"
      }}
      documentHeaderTitle={documentPayload.document.title}
      documentHeaderCurrentPage={12}
      documentHeaderPageCount={120}
      documentHeaderZoom={1}
      readerViewMode="page"
      onReaderViewModeChange={vi.fn()}
      viewerApi={makeViewerApi()}
      onHeaderMouseDown={vi.fn()}
      searchController={createUnifiedSearchController()}
      searchFocusRequest={0}
      commandPaletteOpen={false}
      onToggleCommandPalette={vi.fn()}
      registerCommandPaletteAnchor={vi.fn()}
      onSearchOpenDocument={vi.fn(async () => undefined)}
      onSearchGoToPage={vi.fn()}
      showHeaders={true}
      showFullscreenHint={false}
      fullscreen={false}
      onToggleFullscreen={vi.fn()}
      {...overrides}
    />
  );
}

describe("BookWorkspace", () => {
  it("renders the shared document header and a single document pane", () => {
    const markup = renderWorkspace();

    expect(markup).toContain('class="reader-workspace__header-title"');
    expect(markup).toContain("Book Mode Title");
    expect(markup).toContain("reader-workspace__body reader-workspace__body--book-only");
    expect(markup).toContain("reader-workspace__document reader-workspace__document--only");
    expect(markup).not.toContain('class="reader-workspace__notes"');
    expect(markup).not.toContain("reader-workspace__splitter");
  });

  it("accepts book transitions and forwards them to the reader viewport", () => {
    const markup = renderWorkspace({
      activeViewTransition: {
        clickStartedAtMs: 10,
        fromView: "collection",
        source: "collection-document-open",
        toView: "book",
        viewTransitionId: "view-book-1"
      }
    });

    expect(markup).toContain('data-testid="reader-viewport"');
    expect(markup).toContain('data-from-view="collection"');
    expect(markup).toContain('data-to-view="book"');
  });

  it("shows the empty document header state when no PDF is open", () => {
    const markup = renderWorkspace({
      readerSession: null,
      documentHeaderTitle: "Book",
      documentHeaderCurrentPage: 1,
      documentHeaderPageCount: 0,
      viewerApi: null
    });

    expect(markup).toContain("No document");
  });
});
