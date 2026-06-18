import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PdfViewer from "./PdfViewer";
import type { CachedRenderedPage } from "../lib/reader/PageCache";
import type { PresentedPage } from "../lib/reader/useReaderController";
import type { DocumentPayload, ReaderSession } from "../lib/types";

vi.mock("../lib/reader/useReaderController", () => ({
  useReaderController: vi.fn(() => ({
    currentPage: 1,
    targetPage: 1,
    navigationGeneration: 1,
    pageCount: 12,
    fitMode: "auto-maximize",
    displayZoom: 1,
    committedZoom: 1,
    displayedPage: null,
    incomingPage: null,
    rapidTurnOverlay: null,
    scrollResetRequest: null,
    displayedPageTextLayer: null,
    displayedPageTextDebugStatus: {
      itemCount: 0,
      pageNumber: null,
      state: "missing"
    },
    isRendering: false,
    loadingDocument: false,
    documentError: null,
    renderError: null,
    handleKeyDown: vi.fn(),
    handleNavigationKeyUp: vi.fn(),
    handleNativeScroll: vi.fn(),
    handleWheel: vi.fn(),
    releaseSmoothWheelForManualScroll: vi.fn(),
    finishManualScroll: vi.fn(),
    commitIncomingPageSwap: vi.fn(),
    finalizeIncomingPageSwap: vi.fn(),
    markDisplayedPageReadyForPreload: vi.fn(),
    markDisplayedPageVisible: vi.fn(),
    previewAutoMaximizeZoom: vi.fn(),
    commitAutoMaximizeZoom: vi.fn(),
    reportAutoMaximizeZoom: vi.fn()
  }))
}));

const mockRenderedPage: CachedRenderedPage = {
  documentId: "doc-1",
  imageBytes: [1, 2, 3],
  imageUrl: "/page-1.png",
  pageNumber: 1,
  width: 800,
  height: 1200,
  cacheKey: "cache-1",
  requestKey: "request-1",
  logicalKey: "doc-1:1:1.00",
  renderVariant: "raw",
  normalizationToken: null,
  renderZoom: 1,
  textLayerTransform: {
    sourceWidth: 800,
    sourceHeight: 1200,
    matrix: [1, 0, 0, 1, 0, 0]
  }
};

function asPresentedPage(
  page: CachedRenderedPage,
  overrides?: Partial<PresentedPage["presentation"]>
): PresentedPage {
  return {
    ...page,
    presentation: {
      navigationGeneration: 1,
      requestId: 1,
      source: "local-cache",
      targetPage: page.pageNumber,
      ...overrides
    }
  };
}

const documentPayload: DocumentPayload = {
  document: {
    id: "doc-1",
    title: "Example PDF",
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
    lastPage: 1,
    zoom: 1,
    bookmarks: [],
    preferences: {
      fitMode: "width"
    },
    userOutlineItems: []
  },
  filePath: "D:/Read/example.pdf",
  pageCount: 12
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

async function renderViewer(
  mode: "light" | "dark",
  options?: {
    displayZoom?: number;
    committedZoom?: number;
    displayedPage?: PresentedPage | null;
    incomingPage?: PresentedPage | null;
  }
) {
  const { useReaderController } = await import("../lib/reader/useReaderController");
  vi.mocked(useReaderController).mockReturnValue({
    currentPage: 1,
    targetPage: 1,
    navigationGeneration: 1,
    pageCount: 12,
    fitMode: "auto-maximize",
    displayZoom: options?.displayZoom ?? 1,
    committedZoom: options?.committedZoom ?? 1,
    displayedPage: options?.displayedPage ?? null,
    incomingPage: options?.incomingPage ?? null,
    rapidTurnOverlay: null,
    scrollResetRequest: null,
    displayedPageTextLayer: null,
    displayedPageTextDebugStatus: {
      itemCount: 0,
      pageNumber: null,
      state: "missing"
    },
    isRendering: false,
    loadingDocument: false,
    documentError: null,
    renderError: null,
    handleKeyDown: vi.fn(),
    handleNavigationKeyUp: vi.fn(),
    handleNativeScroll: vi.fn(),
    handleWheel: vi.fn(),
    releaseSmoothWheelForManualScroll: vi.fn(),
    finishManualScroll: vi.fn(),
    commitIncomingPageSwap: vi.fn(),
    finalizeIncomingPageSwap: vi.fn(),
    markDisplayedPageReadyForPreload: vi.fn(),
    markDisplayedPageVisible: vi.fn(),
    previewAutoMaximizeZoom: vi.fn(),
    commitAutoMaximizeZoom: vi.fn(),
    reportAutoMaximizeZoom: vi.fn()
  });

  return renderToStaticMarkup(
    createElement(PdfViewer, {
      readerSession,
      pendingReaderOpenSessionId: null,
      onSnapshotChange: vi.fn(),
      onOutlineChange: vi.fn(),
      onStatusChange: vi.fn(),
      onStateChange: vi.fn(),
      registerApi: vi.fn(),
      suspendAutoFitDuringPaneResize: false,
      viewerDisplayConfig: {
        mode,
        paperColor: mode === "dark" ? "#20242a" : "#f7f1e5",
        inkColor: mode === "dark" ? "#d8d8d8" : "#2f261c",
        blendMode: mode === "dark" ? "screen" : "multiply",
        imageFilter:
          mode === "dark"
            ? "invert(1) hue-rotate(180deg) grayscale(1) sepia(0.1) saturate(1.4) hue-rotate(0deg) brightness(0.9) contrast(0.92)"
            : "grayscale(1) sepia(0.04) saturate(1.1) hue-rotate(15deg) brightness(1) contrast(1)"
      }
    })
  );
}

describe("PdfViewer", () => {
  it("renders the light appearance without a dark marker", async () => {
    const markup = await renderViewer("light");

    expect(markup).toContain('class="reader-stage"');
    expect(markup).toContain('data-document-appearance="light"');
    expect(markup).toContain("--viewer-paper-color:#f7f1e5");
    expect(markup).not.toContain('data-document-appearance="dark"');
  });

  it("renders the dark appearance marker and filter on the pdf shell", async () => {
    const markup = await renderViewer("dark");

    expect(markup).toContain('data-document-appearance="dark"');
    expect(markup).toContain("--viewer-paper-color:#20242a");
    expect(markup).toContain("--viewer-ink-color:#d8d8d8");
    expect(markup).toContain("--viewer-image-blend-mode:screen");
    expect(markup).toContain("invert(1)");
    expect(markup).toContain("brightness(0.9)");
    expect(markup).toContain("contrast(0.92)");
    expect(markup).toContain('class="reader-scrollbar"');
  });

  it("scales the page shell from display zoom while keeping raster dimensions stable", async () => {
    const markup = await renderViewer("dark", {
      displayZoom: 1.5,
      committedZoom: 1.2,
      displayedPage: {
        ...asPresentedPage(mockRenderedPage),
        renderZoom: 1.2
      }
    });

    expect(markup).toContain('class="reader-page__surface-shell" style="width:1000px;height:1500px"');
    expect(markup).toContain(
      'class="reader-page__surface" style="width:800px;height:1200px;transform:scale(1.25)"'
    );
  });

  it("keeps the incoming raster hidden until swap", async () => {
    const markup = await renderViewer("dark", {
      displayZoom: 1.5,
      committedZoom: 1.2,
      displayedPage: {
        ...asPresentedPage(mockRenderedPage),
        requestKey: "displayed-1",
        renderZoom: 1
      },
      incomingPage: {
        ...asPresentedPage(mockRenderedPage, {
          requestId: 2,
          source: "fresh-render",
          targetPage: 1
        }),
        requestKey: "incoming-1",
        renderZoom: 1.2,
        width: 960,
        height: 1440
      }
    });

    expect(markup).toContain('class="reader-page__surface-shell" style="width:1200px;height:1800px"');
    expect(markup).toContain('class="reader-page__image reader-page__image--incoming"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
