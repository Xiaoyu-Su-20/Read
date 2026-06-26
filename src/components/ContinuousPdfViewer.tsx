import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type UIEvent,
  type WheelEvent
} from "react";

import NativePdfTextLayer from "./NativePdfTextLayer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { getPdfNativeOutline, getPdfNativeTextPage, saveDocumentState } from "../lib/api";
import { dedupeBookmarks } from "../lib/commands";
import { debugAction } from "../lib/debugLog";
import {
  captureContinuousScrollAnchor,
  captureContinuousSemanticAnchor,
  computeContinuousPagePlacements,
  computeContinuousVirtualRange,
  createEstimatedPageMetrics,
  resolveContinuousActivePage,
  restoreScrollTopForContinuousAnchor,
  restoreScrollTopForContinuousSemanticAnchor,
  updateMeasuredPageHeight,
  type ContinuousPageMetric
} from "../lib/reader/continuousPageMetrics";
import { createPageCache, makePageCacheKey, type CachedRenderedPage } from "../lib/reader/PageCache";
import { renderVisiblePdfPage } from "../lib/reader/PdfPageRenderer";
import { scaleZoomByKeyboardDirection, scaleZoomByWheelDelta } from "../lib/reader/zoom";
import type {
  Bookmark,
  DocumentState,
  NativeTextPagePayload,
  OutlineItem,
  PdfNavigationTarget,
  ReaderFitMode,
  ReaderSession,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";

type ContinuousPdfViewerProps = {
  readerSession: ReaderSession | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  suspendAutoFitDuringPaneResize: boolean;
};

const CONTINUOUS_RENDER_CACHE_SIZE = 60;
const CONTINUOUS_PAGE_GAP_PX = 28;
const CONTINUOUS_OVERSCAN_PX = 720;
const DEFAULT_ESTIMATED_PAGE_WIDTH = 800;
const DEFAULT_ESTIMATED_PAGE_HEIGHT = 1120;
const READER_STATE_SAVE_DEBOUNCE_MS = 700;
const SCROLL_READER_FIT_MODE: ReaderFitMode = "free";

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(pageCount, 1));
}

function makeDocumentState(
  readerSession: ReaderSession,
  page: number,
  zoom: number,
  fitMode: ReaderFitMode,
  bookmarks: Bookmark[]
): DocumentState {
  return {
    ...readerSession.document.state,
    lastOpenedAt: new Date().toISOString(),
    lastPage: clampPage(page, readerSession.document.pageCount),
    zoom,
    bookmarks: dedupeBookmarks(bookmarks),
    preferences: {
      fitMode
    }
  };
}

function appearanceStyle(viewerDisplayConfig: ViewerDisplayConfig) {
  return {
    ["--viewer-paper-color"]: viewerDisplayConfig.paperColor,
    ["--viewer-ink-color"]: viewerDisplayConfig.inkColor,
    ["--viewer-image-filter"]: viewerDisplayConfig.imageFilter,
    ["--viewer-image-blend-mode"]: viewerDisplayConfig.blendMode
  } as CSSProperties;
}

function estimateHeightFromKnownPage(
  pageNumber: number,
  baseHeightsRef: MutableRefObject<Map<number, number>>,
  zoom: number
) {
  return (baseHeightsRef.current.get(pageNumber) ?? DEFAULT_ESTIMATED_PAGE_HEIGHT) * zoom;
}

function estimateWidthFromKnownPage(
  pageNumber: number,
  baseWidthsRef: MutableRefObject<Map<number, number>>,
  zoom: number
) {
  return (baseWidthsRef.current.get(pageNumber) ?? DEFAULT_ESTIMATED_PAGE_WIDTH) * zoom;
}

function ContinuousScrollModel({
  children,
  metrics,
  onScroll,
  scrollSurfaceRef,
  viewerDisplayConfig
}: {
  children: ReactNode;
  metrics: ContinuousPageMetric[];
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollSurfaceRef: RefObject<HTMLDivElement>;
  viewerDisplayConfig: ViewerDisplayConfig;
}) {
  return (
    <div
      className="reader-stage continuous-reader"
      data-document-appearance={viewerDisplayConfig.mode}
      style={appearanceStyle(viewerDisplayConfig)}
    >
      <div
        ref={scrollSurfaceRef}
        className="reader-scroll-surface continuous-reader__scroll-surface"
        tabIndex={0}
        onScroll={onScroll}
      >
        {metrics.length > 0 ? children : null}
      </div>
    </div>
  );
}

function ContinuousPageList({
  documentId,
  metrics,
  openSessionId,
  baseWidthsRef,
  pageCacheRef,
  range,
  renderZoom,
  viewerDisplayConfig,
  onPageMeasured
}: {
  documentId: string;
  metrics: ContinuousPageMetric[];
  openSessionId: string | null;
  baseWidthsRef: MutableRefObject<Map<number, number>>;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  range: ReturnType<typeof computeContinuousVirtualRange>;
  renderZoom: number;
  viewerDisplayConfig: ViewerDisplayConfig;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
}) {
  const mountedPages = [];
  for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber += 1) {
    if (pageNumber > 0) {
      mountedPages.push(pageNumber);
    }
  }
  const documentWidth = Math.max(
    ...mountedPages.map((pageNumber) =>
      estimateWidthFromKnownPage(pageNumber, baseWidthsRef, renderZoom)
    ),
    DEFAULT_ESTIMATED_PAGE_WIDTH * renderZoom
  );

  return (
    <div
      className="continuous-reader__document"
      style={{
        minHeight: `${range.totalHeight}px`,
        width: `${documentWidth}px`
      }}
    >
      <div style={{ height: `${range.topSpacerHeight}px` }} aria-hidden="true" />
      <div className="continuous-reader__page-window">
        {mountedPages.map((pageNumber) => (
          <ContinuousPage
            key={`${documentId}:${pageNumber}`}
            documentId={documentId}
            metric={metrics[pageNumber - 1]}
            openSessionId={openSessionId}
            baseWidthsRef={baseWidthsRef}
            pageCacheRef={pageCacheRef}
            pageNumber={pageNumber}
            renderZoom={renderZoom}
            viewerDisplayConfig={viewerDisplayConfig}
            onPageMeasured={onPageMeasured}
          />
        ))}
      </div>
      <div style={{ height: `${range.bottomSpacerHeight}px` }} aria-hidden="true" />
    </div>
  );
}

const ContinuousPage = memo(function ContinuousPage({
  documentId,
  metric,
  openSessionId,
  baseWidthsRef,
  pageCacheRef,
  pageNumber,
  renderZoom,
  viewerDisplayConfig,
  onPageMeasured
}: {
  documentId: string;
  metric: ContinuousPageMetric | undefined;
  openSessionId: string | null;
  baseWidthsRef: MutableRefObject<Map<number, number>>;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  pageNumber: number;
  renderZoom: number;
  viewerDisplayConfig: ViewerDisplayConfig;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<CachedRenderedPage | null>(() => {
    return pageCacheRef.current.get(makePageCacheKey(documentId, pageNumber, renderZoom)) ?? null;
  });
  const [textLayer, setTextLayer] = useState<NativeTextPagePayload | null>(null);
  const estimatedHeight = metric?.measuredHeight ?? metric?.estimatedHeight ?? DEFAULT_ESTIMATED_PAGE_HEIGHT * renderZoom;
  const estimatedWidth = Math.max(estimateWidthFromKnownPage(pageNumber, baseWidthsRef, renderZoom), 1);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = makePageCacheKey(documentId, pageNumber, renderZoom);
    const cached = pageCacheRef.current.get(cacheKey);
    if (cached) {
      setPage(cached);
      return;
    }

    void renderVisiblePdfPage(documentId, pageNumber, renderZoom, {
      caller: "foreground"
    })
      .then((renderedPage) => {
        if (cancelled) {
          return;
        }
        baseWidthsRef.current.set(renderedPage.pageNumber, renderedPage.pageBaseWidth);
        pageCacheRef.current.set(cacheKey, renderedPage);
        setPage(renderedPage);
        onPageMeasured(renderedPage, renderedPage.height);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        debugAction("continuous-reader.page-render-error", {
          documentId,
          pageNumber,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, onPageMeasured, pageCacheRef, pageNumber, renderZoom]);

  useEffect(() => {
    if (!page) {
      setTextLayer(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      void getPdfNativeTextPage(documentId, pageNumber, {
        openSessionId: openSessionId ?? undefined
      })
        .then((payload) => {
          if (cancelled || payload.pageNumber !== pageNumber) {
            return;
          }
          setTextLayer(payload);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          debugAction("continuous-reader.text-layer-error", {
            documentId,
            pageNumber,
            error: error instanceof Error ? error.message : String(error)
          });
        });
    }, 80);

    setTextLayer(null);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [documentId, openSessionId, page, pageNumber]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !page) {
      return;
    }

    const report = () => {
      onPageMeasured(page, shell.getBoundingClientRect().height);
    };

    report();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    resizeObserver?.observe(shell);
    return () => resizeObserver?.disconnect();
  }, [onPageMeasured, page]);

  return (
    <article className="continuous-reader__page" data-page-number={pageNumber}>
      <div
        ref={shellRef}
        className="reader-page__surface-shell continuous-reader__page-shell"
        style={{
          width: `${page?.width ?? estimatedWidth}px`,
          height: `${page?.height ?? estimatedHeight}px`
        }}
      >
        {page ? (
          <div
            className="reader-page__surface"
            style={{
              width: `${page.width}px`,
              height: `${page.height}px`
            }}
          >
            <img
              className="reader-page__image reader-page__image--active"
              src={page.imageUrl}
              alt={`Page ${page.pageNumber}`}
              draggable={false}
              style={{
                filter: viewerDisplayConfig.imageFilter,
                mixBlendMode: viewerDisplayConfig.blendMode
              }}
            />
            <NativePdfTextLayer
              pageNumber={page.pageNumber}
              textLayer={textLayer}
              renderedWidth={page.width}
              renderedHeight={page.height}
              renderTransform={page.textLayerTransform}
            />
          </div>
        ) : (
          <div className="continuous-reader__page-placeholder" aria-label={`Loading page ${pageNumber}`} />
        )}
      </div>
    </article>
  );
});

export default function ContinuousPdfViewer({
  readerSession,
  readerActive,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig
}: ContinuousPdfViewerProps) {
  const document = readerSession?.document ?? null;
  const documentId = document?.document.id ?? null;
  const pageCount = document?.pageCount ?? 0;
  const openSessionId = readerSession?.openSessionId ?? null;
  const initialZoom = readerSession?.zoom ?? readerSession?.document.state.zoom ?? 1;
  const initialFitMode = SCROLL_READER_FIT_MODE;
  const initialBookmarks = readerSession?.document.state.bookmarks ?? [];
  const initialPage = readerSession ? clampPage(readerSession.page || readerSession.document.state.lastPage, pageCount) : 1;
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageCacheRef = useRef(createPageCache(CONTINUOUS_RENDER_CACHE_SIZE));
  const baseWidthsRef = useRef(new Map<number, number>());
  const baseHeightsRef = useRef(new Map<number, number>());
  const saveTimerRef = useRef<number | null>(null);
  const latestStateRef = useRef<DocumentState | null>(readerSession?.document.state ?? null);
  const initialScrollAppliedRef = useRef<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(() => initialZoom);
  const [fitMode, setFitModeState] = useState<ReaderFitMode>(() => initialFitMode);
  const [bookmarks, setBookmarksState] = useState<Bookmark[]>(() => initialBookmarks);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [metrics, setMetrics] = useState<ContinuousPageMetric[]>(() =>
    createEstimatedPageMetrics(pageCount, (pageNumber) =>
      estimateHeightFromKnownPage(pageNumber, baseHeightsRef, initialZoom)
    )
  );
  const placements = useMemo(
    () => computeContinuousPagePlacements(metrics, CONTINUOUS_PAGE_GAP_PX),
    [metrics]
  );
  const currentPageRef = useRef(currentPage);
  const displayZoomRef = useRef(displayZoom);
  const fitModeRef = useRef(fitMode);
  const metricsRef = useRef(metrics);
  const pageCountRef = useRef(pageCount);
  const scrollTopRef = useRef(scrollTop);
  const publishStateRef = useRef<(page: number, zoom?: number, fitMode?: ReaderFitMode, bookmarks?: Bookmark[]) => void>(() => undefined);
  const scrollToPageRef = useRef<(page: number, options?: { align?: "top" | "reading-line" }) => void>(() => undefined);
  const updateZoomRef = useRef<(zoom: number) => void>(() => undefined);

  currentPageRef.current = currentPage;
  displayZoomRef.current = displayZoom;
  fitModeRef.current = fitMode;
  metricsRef.current = metrics;
  pageCountRef.current = pageCount;
  scrollTopRef.current = scrollTop;
  const virtualRange = useMemo(
    () =>
      computeContinuousVirtualRange({
        metrics,
        scrollTop,
        viewportHeight,
        overscanPx: CONTINUOUS_OVERSCAN_PX,
        pageGapPx: CONTINUOUS_PAGE_GAP_PX
      }),
    [metrics, scrollTop, viewportHeight]
  );

  const readingLineOffsetPx = Math.max(Math.min(viewportHeight * 0.28, 220), 48);

  const publishState = useCallback(
    (nextPage: number, nextZoom = displayZoom, nextFitMode = fitMode, nextBookmarks = bookmarks) => {
      if (!readerSession) {
        return;
      }
      const nextState = makeDocumentState(readerSession, nextPage, nextZoom, nextFitMode, nextBookmarks);
      latestStateRef.current = nextState;
      onStateChange(nextState);
      onSnapshotChange({
        currentPage: nextState.lastPage,
        pageCount: readerSession.document.pageCount,
        zoom: nextZoom
      });

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void saveDocumentState(readerSession.documentId, nextState).catch((error) => {
          debugAction("continuous-reader.state-save-error", {
            documentId: readerSession.documentId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }, READER_STATE_SAVE_DEBOUNCE_MS);
    },
    [bookmarks, displayZoom, fitMode, onSnapshotChange, onStateChange, readerSession]
  );
  publishStateRef.current = publishState;

  const scrollToPage = useCallback(
    (page: number, options?: { align?: "top" | "reading-line" }) => {
      const scrollSurface = scrollSurfaceRef.current;
      if (!scrollSurface) {
        return;
      }
      const clampedPage = clampPage(page, pageCount);
      const placement = placements.find((candidate) => candidate.pageNumber === clampedPage);
      if (!placement) {
        return;
      }
      const nextScrollTop =
        options?.align === "reading-line"
          ? Math.max(placement.top - readingLineOffsetPx, 0)
          : placement.top;
      scrollSurface.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
      setCurrentPage(clampedPage);
      publishState(clampedPage);
    },
    [pageCount, placements, publishState, readingLineOffsetPx]
  );
  scrollToPageRef.current = scrollToPage;

  const updateZoom = useCallback(
    (nextZoom: number) => {
      const normalizedZoom = Math.min(Math.max(nextZoom, 0.4), 3);
      const anchor = captureContinuousSemanticAnchor(
        metrics,
        scrollSurfaceRef.current?.scrollTop ?? scrollTop,
        readingLineOffsetPx,
        CONTINUOUS_PAGE_GAP_PX
      );
      setDisplayZoom(normalizedZoom);
      setMetrics(
        createEstimatedPageMetrics(pageCount, (pageNumber) =>
          estimateHeightFromKnownPage(pageNumber, baseHeightsRef, normalizedZoom)
        )
      );
      window.requestAnimationFrame(() => {
        const scrollSurface = scrollSurfaceRef.current;
        if (!scrollSurface) {
          return;
        }
        const nextMetrics = createEstimatedPageMetrics(pageCount, (pageNumber) =>
          estimateHeightFromKnownPage(pageNumber, baseHeightsRef, normalizedZoom)
        );
        const nextScrollTop = restoreScrollTopForContinuousSemanticAnchor(
          nextMetrics,
          anchor,
          readingLineOffsetPx,
          CONTINUOUS_PAGE_GAP_PX
        );
        scrollSurface.scrollTop = nextScrollTop;
        setScrollTop(nextScrollTop);
      });
      publishState(currentPage, normalizedZoom);
    },
    [currentPage, metrics, pageCount, publishState, readingLineOffsetPx, scrollTop]
  );
  updateZoomRef.current = updateZoom;

  const handlePageMeasured = useCallback((page: CachedRenderedPage, measuredHeight: number) => {
    baseHeightsRef.current.set(page.pageNumber, page.pageBaseHeight);
    const currentMetric = metricsRef.current[page.pageNumber - 1];
    if (
      currentMetric?.measuredHeight !== null &&
      Math.abs((currentMetric?.measuredHeight ?? 0) - measuredHeight) < 0.5
    ) {
      return;
    }

    const anchor = captureContinuousScrollAnchor(
      metricsRef.current,
      scrollSurfaceRef.current?.scrollTop ?? scrollTopRef.current,
      CONTINUOUS_PAGE_GAP_PX
    );
    setMetrics((currentMetrics) => {
      const currentMetric = currentMetrics[page.pageNumber - 1];
      if (currentMetric?.measuredHeight !== null && Math.abs((currentMetric?.measuredHeight ?? 0) - measuredHeight) < 0.5) {
        return currentMetrics;
      }
      const nextMetrics = updateMeasuredPageHeight(currentMetrics, page.pageNumber, measuredHeight);
      metricsRef.current = nextMetrics;
      window.requestAnimationFrame(() => {
        const scrollSurface = scrollSurfaceRef.current;
        if (!scrollSurface) {
          return;
        }
        const nextScrollTop = restoreScrollTopForContinuousAnchor(
          nextMetrics,
          anchor,
          CONTINUOUS_PAGE_GAP_PX
        );
        if (Math.abs(scrollSurface.scrollTop - nextScrollTop) > 0.5) {
          scrollSurface.scrollTop = nextScrollTop;
          setScrollTop(nextScrollTop);
        }
      });
      return nextMetrics;
    });
  }, []);

  useEffect(() => {
    latestStateRef.current = readerSession?.document.state ?? null;
    setDisplayZoom(initialZoom);
    setFitModeState(initialFitMode);
    setBookmarksState(initialBookmarks);
    setCurrentPage(initialPage);
    setScrollTop(0);
    initialScrollAppliedRef.current = null;
    baseWidthsRef.current = new Map();
    baseHeightsRef.current = new Map();
    pageCacheRef.current.clear();
    pageCacheRef.current = createPageCache(CONTINUOUS_RENDER_CACHE_SIZE);
    setMetrics(
      createEstimatedPageMetrics(pageCount, (pageNumber) =>
        estimateHeightFromKnownPage(pageNumber, baseHeightsRef, initialZoom)
      )
    );
  }, [documentId, initialFitMode, initialPage, initialZoom, openSessionId, pageCount]);

  useEffect(() => {
    if (!readerSession || !readerActive) {
      return;
    }
    onSnapshotChange({
      currentPage,
      pageCount,
      zoom: displayZoom
    });
  }, [currentPage, displayZoom, onSnapshotChange, pageCount, readerActive, readerSession]);

  useEffect(() => {
    if (!documentId || !readerSession) {
      onOutlineChange([]);
      return;
    }

    let cancelled = false;
    void getPdfNativeOutline(documentId, {
      openSessionId: readerSession.openSessionId
    })
      .then((items) => {
        if (!cancelled) {
          onOutlineChange(items);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          debugAction("continuous-reader.outline-error", {
            documentId,
            error: error instanceof Error ? error.message : String(error)
          });
          onOutlineChange([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, onOutlineChange, readerSession]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    if (!scrollSurface || pageCount <= 0) {
      return;
    }
    const updateViewport = () => {
      setViewportHeight(scrollSurface.clientHeight);
    };
    updateViewport();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scrollSurface);
    window.addEventListener("resize", updateViewport);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, [pageCount]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    const scrollKey = documentId ? `${documentId}:${initialPage}` : null;
    if (
      !scrollSurface ||
      !scrollKey ||
      placements.length === 0 ||
      initialScrollAppliedRef.current === scrollKey
    ) {
      return;
    }
    const placement = placements.find((candidate) => candidate.pageNumber === initialPage);
    if (placement) {
      initialScrollAppliedRef.current = scrollKey;
      scrollSurface.scrollTop = placement.top;
      setScrollTop(placement.top);
    }
  }, [documentId, initialPage, placements.length]);

  useEffect(() => {
    const activeOpenSessionId = readerSession?.openSessionId ?? null;
    const api: ViewerApi | null =
      readerSession && documentId
        ? {
            nextPage: () => scrollToPageRef.current(currentPageRef.current + 1),
            previousPage: () => scrollToPageRef.current(currentPageRef.current - 1),
            zoomIn: () => updateZoomRef.current(scaleZoomByKeyboardDirection(displayZoomRef.current, "in")),
            zoomOut: () => updateZoomRef.current(scaleZoomByKeyboardDirection(displayZoomRef.current, "out")),
            getAutoMaximizeZoom: () => null,
            getAutoMaximizeMinDocumentWidth: () => null,
            getFitMode: () => SCROLL_READER_FIT_MODE,
            setFitMode: () => {
              setFitModeState(SCROLL_READER_FIT_MODE);
              publishStateRef.current(
                currentPageRef.current,
                displayZoomRef.current,
                SCROLL_READER_FIT_MODE
              );
            },
            goToPage: (page) => scrollToPageRef.current(page),
            navigateToTarget: (target: PdfNavigationTarget) => {
              scrollToPageRef.current(target.pageIndex + 1);
            },
            searchPort: {
              getExtractedPageNumbers: () =>
                new Set(Array.from({ length: pageCountRef.current }, (_, index) => index + 1)),
              getPageSearchText: async (pageNumber, signal) => {
                if (signal.aborted) {
                  return "";
                }
                const textPage = await getPdfNativeTextPage(documentId, pageNumber, {
                  openSessionId: activeOpenSessionId ?? undefined
                });
                return signal.aborted ? "" : textPage.lines.map((line) => line.text).join("\n");
              }
            },
            jumpToOutline: (item: OutlineItem) => {
              if (item.target) {
                scrollToPageRef.current(item.target.pageIndex + 1);
              } else if (item.page) {
                scrollToPageRef.current(item.page);
              }
            },
            getCurrentPage: () => currentPageRef.current,
            getPageCount: () => pageCountRef.current,
            getReaderState: () => latestStateRef.current,
            setBookmarks: (nextBookmarks) => {
              const normalizedBookmarks = dedupeBookmarks(nextBookmarks);
              setBookmarksState(normalizedBookmarks);
              publishStateRef.current(
                currentPageRef.current,
                displayZoomRef.current,
                SCROLL_READER_FIT_MODE,
                normalizedBookmarks
              );
            }
          }
        : null;

    registerApi(api);
    return () => registerApi(null);
  }, [documentId, readerSession?.openSessionId, registerApi]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      pageCacheRef.current.clear();
    };
  }, []);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const nextScrollTop = event.currentTarget.scrollTop;
      setScrollTop(nextScrollTop);
      const nextPage = clampPage(
        resolveContinuousActivePage(metrics, nextScrollTop, readingLineOffsetPx, CONTINUOUS_PAGE_GAP_PX),
        pageCount || 1
      );
      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
        publishState(nextPage);
      }
    },
    [currentPage, metrics, pageCount, publishState, readingLineOffsetPx]
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
      updateZoom(scaleZoomByWheelDelta(displayZoom, delta));
    },
    [displayZoom, updateZoom]
  );

  if (!readerSession || !document || !documentId) {
    return (
      <div className="reader-empty">
        <div className="empty-state" />
      </div>
    );
  }

  const activeOpenSessionId = readerSession.openSessionId;

  return (
    <ContinuousScrollModel
      metrics={metrics}
      onScroll={handleScroll}
      scrollSurfaceRef={scrollSurfaceRef}
      viewerDisplayConfig={viewerDisplayConfig}
    >
      <div onWheel={handleWheel}>
        {virtualRange.startPage > 0 ? (
          <div className="continuous-reader__status" aria-live="polite">
            Scroll mode loading pages {virtualRange.startPage}-{virtualRange.endPage}
          </div>
        ) : null}
        <ContinuousPageList
          documentId={documentId}
          metrics={metrics}
          openSessionId={activeOpenSessionId}
          baseWidthsRef={baseWidthsRef}
          pageCacheRef={pageCacheRef}
          range={virtualRange}
          renderZoom={displayZoom}
          viewerDisplayConfig={viewerDisplayConfig}
          onPageMeasured={handlePageMeasured}
        />
      </div>
    </ContinuousScrollModel>
  );
}
