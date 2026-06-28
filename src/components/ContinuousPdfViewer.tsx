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
import { getPdfNativeOutline, getPdfNativeTextPage, getPdfPageGeometries, saveDocumentState } from "../lib/api";
import { dedupeBookmarks } from "../lib/commands";
import { debugAction } from "../lib/debugLog";
import {
  captureContinuousScrollAnchor,
  captureContinuousSemanticAnchor,
  computeContinuousPagePlacements,
  computeContinuousVirtualRange,
  createEstimatedPageMetrics,
  mergeContinuousVirtualRanges,
  resolveContinuousActivePage,
  restoreScrollTopForContinuousAnchor,
  restoreScrollTopForContinuousSemanticAnchor,
  updateMeasuredPageHeight,
  type ContinuousPageMetric
} from "../lib/reader/continuousPageMetrics";
import { createPageCache, type CachedRenderedPage } from "../lib/reader/PageCache";
import {
  isScrollRenderIdentityChangedError,
  makeRasterIdentityKey,
  ScrollRenderCoordinator,
  type RasterIdentity,
  type RenderPriority
} from "../lib/reader/ScrollRenderCoordinator";
import {
  resolveScrollRasterScale,
  scaleZoomByWheelDelta,
  snapScrollZoom,
  stepScrollZoom
} from "../lib/reader/zoom";
import type {
  Bookmark,
  DocumentState,
  NativeTextPagePayload,
  OutlineItem,
  EffectivePageGeometry,
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

const CONTINUOUS_RENDER_CACHE_BYTES = 192 * 1024 * 1024;
const CONTINUOUS_PAGE_GAP_PX = 0;
const CONTINUOUS_OVERSCAN_PX = 720;
const DEFAULT_ESTIMATED_PAGE_WIDTH = 800;
const DEFAULT_ESTIMATED_PAGE_HEIGHT = 1120;
const READER_STATE_SAVE_DEBOUNCE_MS = 700;
const WHEEL_ZOOM_COMMIT_DELAY_MS = 110;
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

function getPageGeometry(page: EffectivePageGeometry, zoom: number) {
  const rotated = Math.abs(page.rotation) % 180 === 90;
  return {
    width: (rotated ? page.baseHeight : page.baseWidth) * zoom,
    height: (rotated ? page.baseWidth : page.baseHeight) * zoom
  };
}

function validatePageGeometries(
  geometries: EffectivePageGeometry[],
  pageCount: number
) {
  const byPage = new Map(geometries.map((geometry) => [geometry.pageNumber, geometry]));
  if (geometries.length !== pageCount || byPage.size !== pageCount) {
    throw new Error(`Expected geometry for ${pageCount} pages, received ${byPage.size}.`);
  }

  return Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    const geometry = byPage.get(pageNumber);
    if (
      !geometry ||
      !Number.isFinite(geometry.baseWidth) ||
      geometry.baseWidth <= 0 ||
      !Number.isFinite(geometry.baseHeight) ||
      geometry.baseHeight <= 0
    ) {
      throw new Error(`Invalid geometry for page ${pageNumber}.`);
    }
    return geometry;
  });
}

function centerHorizontalOverflow(scrollSurface: HTMLDivElement) {
  scrollSurface.scrollLeft = Math.max(
    (scrollSurface.scrollWidth - scrollSurface.clientWidth) / 2,
    0
  );
}

function scaleTextLayerTransform(
  transform: CachedRenderedPage["textLayerTransform"],
  layoutZoom: number,
  rasterScale: number
) {
  const scale = rasterScale > 0 ? layoutZoom / rasterScale : 1;
  return {
    ...transform,
    matrix: transform.matrix.map((value) => value * scale) as typeof transform.matrix
  };
}

function makeEffectivePageIdentity(
  documentId: string,
  documentGenerationId: string,
  pageNumber: number,
  zoom: number,
  geometry: EffectivePageGeometry
): RasterIdentity {
  return {
    documentId,
    documentGenerationId,
    pageNumber,
    rasterScale: zoom,
    rotation: geometry.rotation,
    normalizationToken: geometry.normalizationToken,
    renderVariant: geometry.source
  };
}

function ContinuousScrollModel({
  children,
  zoomGestureActive,
  metrics,
  onScroll,
  scrollSurfaceRef,
  viewerDisplayConfig
}: {
  children: ReactNode;
  zoomGestureActive: boolean;
  metrics: ContinuousPageMetric[];
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollSurfaceRef: RefObject<HTMLDivElement>;
  viewerDisplayConfig: ViewerDisplayConfig;
}) {
  return (
    <div
      className="reader-stage continuous-reader"
      data-zoom-gesture={zoomGestureActive ? "active" : undefined}
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
  coordinator,
  documentId,
  pageGeometries,
  openSessionId,
  pageCacheRef,
  placements,
  range,
  readingLineY,
  renderZoom,
  rasterScale,
  transientScale,
  transientOriginY,
  visibleRange,
  viewerDisplayConfig,
  onIdentityChanged,
  onPageMeasured
}: {
  coordinator: ScrollRenderCoordinator;
  documentId: string;
  pageGeometries: EffectivePageGeometry[];
  openSessionId: string | null;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  placements: ReturnType<typeof computeContinuousPagePlacements>;
  range: ReturnType<typeof computeContinuousVirtualRange>;
  readingLineY: number;
  renderZoom: number;
  rasterScale: number;
  transientScale: number;
  transientOriginY: number;
  visibleRange: ReturnType<typeof computeContinuousVirtualRange>;
  viewerDisplayConfig: ViewerDisplayConfig;
  onIdentityChanged: () => void;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
}) {
  const mountedPages = [];
  for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber += 1) {
    if (pageNumber > 0) {
      mountedPages.push(pageNumber);
    }
  }
  const documentWidth =
    pageGeometries.reduce(
      (widestWidth, page) => Math.max(widestWidth, getPageGeometry(page, renderZoom).width),
      1
    );
  return (
    <div
      className="continuous-reader__document"
      style={{
        minHeight: `${range.totalHeight}px`,
        width: `${documentWidth}px`,
        transform: transientScale === 1 ? undefined : `scale(${transientScale})`,
        transformOrigin: `center ${transientOriginY}px`
      }}
    >
      <div style={{ height: `${range.topSpacerHeight}px` }} aria-hidden="true" />
      <div className="continuous-reader__page-window">
        {mountedPages.map((pageNumber) => (
          <ContinuousPage
            key={`${documentId}:${pageNumber}`}
            coordinator={coordinator}
            documentId={documentId}
            geometry={pageGeometries[pageNumber - 1]}
            openSessionId={openSessionId}
            pageCacheRef={pageCacheRef}
            pageNumber={pageNumber}
            priority={
              pageNumber >= visibleRange.startPage && pageNumber <= visibleRange.endPage
                ? "visible"
                : "overscan"
            }
            readingLineDistance={Math.abs(
              (placements[pageNumber - 1]?.top ?? 0) - readingLineY
            )}
            renderZoom={renderZoom}
            rasterScale={rasterScale}
            viewerDisplayConfig={viewerDisplayConfig}
            onIdentityChanged={onIdentityChanged}
            onPageMeasured={onPageMeasured}
          />
        ))}
      </div>
      <div style={{ height: `${range.bottomSpacerHeight}px` }} aria-hidden="true" />
    </div>
  );
}

const ContinuousPage = memo(function ContinuousPage({
  coordinator,
  documentId,
  geometry,
  openSessionId,
  pageCacheRef,
  pageNumber,
  priority,
  readingLineDistance,
  rasterScale,
  renderZoom,
  viewerDisplayConfig,
  onIdentityChanged,
  onPageMeasured
}: {
  coordinator: ScrollRenderCoordinator;
  documentId: string;
  geometry: EffectivePageGeometry;
  openSessionId: string | null;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  pageNumber: number;
  priority: RenderPriority;
  readingLineDistance: number;
  rasterScale: number;
  renderZoom: number;
  viewerDisplayConfig: ViewerDisplayConfig;
  onIdentityChanged: () => void;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<CachedRenderedPage | null>(null);
  const pageRef = useRef(page);
  const previousPageRef = useRef<CachedRenderedPage | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const [previousPage, setPreviousPage] = useState<CachedRenderedPage | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(true);
  const [textLayer, setTextLayer] = useState<NativeTextPagePayload | null>(null);
  const targetGeometry = getPageGeometry(geometry, renderZoom);
  const targetRasterKey = makeRasterIdentityKey(
    makeEffectivePageIdentity(
      documentId,
      openSessionId ?? "legacy",
      pageNumber,
      rasterScale,
      geometry
    )
  );
  const pageIsFallback = page !== null && page.logicalKey !== targetRasterKey;
  const previousPageIsFallback =
    previousPage !== null && previousPage.logicalKey !== targetRasterKey;
  pageRef.current = page;

  const promotePage = useCallback((nextPage: CachedRenderedPage) => {
    const currentPage = pageRef.current;
    if (currentPage?.logicalKey === nextPage.logicalKey) {
      return;
    }
    if (!pageCacheRef.current.retain(nextPage)) {
      return;
    }
    if (fadeFrameRef.current !== null) {
      window.cancelAnimationFrame(fadeFrameRef.current);
    }
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
    }
    const supersededPreviousPage = previousPageRef.current;
    if (supersededPreviousPage) {
      pageCacheRef.current.release(supersededPreviousPage);
    }
    const canCrossfade =
      currentPage !== null &&
      currentPage.documentId === nextPage.documentId &&
      currentPage.documentGenerationId === nextPage.documentGenerationId &&
      currentPage.pageNumber === nextPage.pageNumber &&
      currentPage.rotation === nextPage.rotation &&
      currentPage.normalizationToken === nextPage.normalizationToken &&
      currentPage.renderVariant === nextPage.renderVariant;
    if (currentPage && !canCrossfade) {
      pageCacheRef.current.release(currentPage);
    }
    previousPageRef.current = canCrossfade ? currentPage : null;
    setPreviousPage(canCrossfade ? currentPage : null);
    setIncomingVisible(!canCrossfade);
    pageRef.current = nextPage;
    setPage(nextPage);
    if (canCrossfade) {
      fadeFrameRef.current = window.requestAnimationFrame(() => {
        fadeFrameRef.current = null;
        setIncomingVisible(true);
        fadeTimerRef.current = window.setTimeout(() => {
          fadeTimerRef.current = null;
          const fadedPage = previousPageRef.current;
          previousPageRef.current = null;
          setPreviousPage(null);
          if (fadedPage) {
            pageCacheRef.current.release(fadedPage);
          }
        }, 90);
      });
    }
  }, [pageCacheRef]);

  useLayoutEffect(() => {
    const identity = makeEffectivePageIdentity(
      documentId,
      openSessionId ?? "legacy",
      pageNumber,
      rasterScale,
      geometry
    );
    const cachedPage =
      pageCacheRef.current.getExact(identity) ??
      pageCacheRef.current.getCompatibleFallback(identity);
    if (cachedPage) {
      promotePage(cachedPage);
    }
  }, [documentId, geometry, openSessionId, pageCacheRef, pageNumber, promotePage, rasterScale]);

  useEffect(() => {
    let cancelled = false;
    const identity = makeEffectivePageIdentity(
      documentId,
      openSessionId ?? "legacy",
      pageNumber,
      rasterScale,
      geometry
    );
    const cacheKey = makeRasterIdentityKey(identity);
    const cached = pageCacheRef.current.getExact(identity);
    if (cached) {
      promotePage(cached);
      return;
    }

    const lease = coordinator.request({ identity, priority, distanceFromReadingLine: readingLineDistance });
    void lease.promise
      .then((renderedPage) => {
        if (cancelled) {
          pageCacheRef.current.discard(renderedPage, "obsolete-render");
          return;
        }
        const canonicalPage = pageCacheRef.current.set(cacheKey, renderedPage);
        promotePage(canonicalPage);
        onPageMeasured(canonicalPage, targetGeometry.height);
      })
      .catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        if (isScrollRenderIdentityChangedError(error)) {
          onIdentityChanged();
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
      lease.release();
    };
  }, [coordinator, documentId, geometry, onIdentityChanged, onPageMeasured, openSessionId, pageCacheRef, pageNumber, promotePage, rasterScale, renderZoom, targetGeometry.height]);

  useEffect(() => {
    coordinator.reprioritize({
      identity: makeEffectivePageIdentity(
        documentId,
        openSessionId ?? "legacy",
        pageNumber,
        rasterScale,
        geometry
      ),
      priority,
      distanceFromReadingLine: readingLineDistance
    });
  }, [coordinator, documentId, geometry, openSessionId, pageNumber, priority, rasterScale, readingLineDistance]);

  useEffect(() => {
    let cancelled = false;
    setTextLayer(null);
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

    return () => {
      cancelled = true;
    };
  }, [documentId, openSessionId, pageNumber]);

  useEffect(() => {
    return () => {
      if (fadeFrameRef.current !== null) {
        window.cancelAnimationFrame(fadeFrameRef.current);
      }
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
      const currentPage = pageRef.current;
      const priorPage = previousPageRef.current;
      pageRef.current = null;
      previousPageRef.current = null;
      if (currentPage) {
        pageCacheRef.current.release(currentPage);
      }
      if (priorPage) {
        pageCacheRef.current.release(priorPage);
      }
    };
  }, [pageCacheRef]);

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
          width: `${targetGeometry.width}px`,
          height: `${targetGeometry.height}px`
        }}
      >
        {page ? (
          <div
            className="reader-page__surface"
            style={{
              width: `${targetGeometry.width}px`,
              height: `${targetGeometry.height}px`
            }}
          >
            <div className="continuous-reader__page-image-stack">
              {previousPage ? (
                <img
                  className={`reader-page__image reader-page__image--active continuous-reader__page-image--previous${previousPageIsFallback ? " continuous-reader__page-image--fallback" : ""}`}
                  src={previousPage.imageUrl}
                  alt=""
                  draggable={false}
                  style={{
                    opacity: incomingVisible ? 0 : previousPageIsFallback ? 0.96 : 1
                  }}
                />
              ) : null}
              <img
                className={`reader-page__image reader-page__image--active continuous-reader__page-image--incoming${pageIsFallback ? " continuous-reader__page-image--fallback" : ""}`}
                src={page.imageUrl}
                alt={`Page ${page.pageNumber}`}
                draggable={false}
                style={{ opacity: incomingVisible ? (pageIsFallback ? 0.96 : 1) : 0 }}
              />
            </div>
            <NativePdfTextLayer
              pageNumber={page.pageNumber}
              textLayer={textLayer}
              renderedWidth={targetGeometry.width}
              renderedHeight={targetGeometry.height}
              renderTransform={scaleTextLayerTransform(
                page.textLayerTransform,
                renderZoom,
                rasterScale
              )}
            />
          </div>
        ) : (
          <div
            className="continuous-reader__page-placeholder"
            aria-label={`Loading page ${pageNumber}`}
          />
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
  const initialZoom = snapScrollZoom(readerSession?.zoom ?? readerSession?.document.state.zoom ?? 1);
  const initialFitMode = SCROLL_READER_FIT_MODE;
  const initialBookmarks = readerSession?.document.state.bookmarks ?? [];
  const initialPage = readerSession ? clampPage(readerSession.page || readerSession.document.state.lastPage, pageCount) : 1;
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageCacheRef = useRef(createPageCache({ maxBytes: CONTINUOUS_RENDER_CACHE_BYTES }));
  const renderCoordinatorRef = useRef<ScrollRenderCoordinator | null>(null);
  if (renderCoordinatorRef.current === null) {
    renderCoordinatorRef.current = new ScrollRenderCoordinator({ maxConcurrent: 2 });
  }
  const renderCoordinator = renderCoordinatorRef.current;
  const baseHeightsRef = useRef(new Map<number, number>());
  const saveTimerRef = useRef<number | null>(null);
  const wheelZoomTimerRef = useRef<number | null>(null);
  const wheelZoomTargetRef = useRef<number | null>(null);
  const geometryRefreshFrameRef = useRef<number | null>(null);
  const pendingZoomScrollTopRef = useRef<number | null>(null);
  const rangeReleaseFrameRef = useRef<number | null>(null);
  const rangeReleaseStableFrameRef = useRef<number | null>(null);
  const latestStateRef = useRef<DocumentState | null>(readerSession?.document.state ?? null);
  const initialScrollAppliedRef = useRef<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(() => initialZoom);
  const [wheelPreviewZoom, setWheelPreviewZoom] = useState<number | null>(null);
  const [fitMode, setFitModeState] = useState<ReaderFitMode>(() => initialFitMode);
  const [bookmarks, setBookmarksState] = useState<Bookmark[]>(() => initialBookmarks);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio
  );
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageGeometries, setPageGeometries] = useState<EffectivePageGeometry[]>([]);
  const [geometryRevision, setGeometryRevision] = useState(0);
  const [pinnedVirtualRange, setPinnedVirtualRange] = useState<{
    startPage: number;
    endPage: number;
  } | null>(null);
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
  const desiredVirtualRange = useMemo(
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
  const virtualRange = useMemo(
    () =>
      pinnedVirtualRange
        ? mergeContinuousVirtualRanges(metrics, CONTINUOUS_PAGE_GAP_PX, [
            pinnedVirtualRange,
            desiredVirtualRange
          ])
        : desiredVirtualRange,
    [desiredVirtualRange, metrics, pinnedVirtualRange]
  );
  const mountedRangeRef = useRef(virtualRange);
  mountedRangeRef.current = virtualRange;
  const visibleRange = useMemo(
    () =>
      computeContinuousVirtualRange({
        metrics,
        scrollTop,
        viewportHeight,
        overscanPx: 0,
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
      const normalizedZoom = snapScrollZoom(nextZoom);
      const mountedRange = mountedRangeRef.current;
      if (mountedRange.startPage > 0) {
        setPinnedVirtualRange({
          startPage: mountedRange.startPage,
          endPage: mountedRange.endPage
        });
      }
      if (rangeReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(rangeReleaseFrameRef.current);
        rangeReleaseFrameRef.current = null;
      }
      if (rangeReleaseStableFrameRef.current !== null) {
        window.cancelAnimationFrame(rangeReleaseStableFrameRef.current);
        rangeReleaseStableFrameRef.current = null;
      }
      const anchor = captureContinuousSemanticAnchor(
        metrics,
        scrollSurfaceRef.current?.scrollTop ?? scrollTop,
        readingLineOffsetPx,
        CONTINUOUS_PAGE_GAP_PX
      );
      const nextMetrics = createEstimatedPageMetrics(pageCount, (pageNumber) =>
        estimateHeightFromKnownPage(pageNumber, baseHeightsRef, normalizedZoom)
      );
      pendingZoomScrollTopRef.current = restoreScrollTopForContinuousSemanticAnchor(
        nextMetrics,
        anchor,
        readingLineOffsetPx,
        CONTINUOUS_PAGE_GAP_PX
      );
      setDisplayZoom(normalizedZoom);
      setMetrics(nextMetrics);
      publishState(currentPage, normalizedZoom);
    },
    [currentPage, metrics, pageCount, publishState, readingLineOffsetPx, scrollTop]
  );
  updateZoomRef.current = updateZoom;

  useLayoutEffect(() => {
    const nextScrollTop = pendingZoomScrollTopRef.current;
    const scrollSurface = scrollSurfaceRef.current;
    if (nextScrollTop === null || !scrollSurface) {
      return;
    }

    pendingZoomScrollTopRef.current = null;
    scrollSurface.scrollTop = nextScrollTop;
    scrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
    rangeReleaseFrameRef.current = window.requestAnimationFrame(() => {
      rangeReleaseFrameRef.current = null;
      rangeReleaseStableFrameRef.current = window.requestAnimationFrame(() => {
        rangeReleaseStableFrameRef.current = null;
        setPinnedVirtualRange(null);
      });
    });
  }, [displayZoom, metrics]);

  const handlePageMeasured = useCallback((page: CachedRenderedPage, measuredHeight: number) => {
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

  const requestPageGeometryRefresh = useCallback(() => {
    if (geometryRefreshFrameRef.current !== null) {
      return;
    }
    geometryRefreshFrameRef.current = window.requestAnimationFrame(() => {
      geometryRefreshFrameRef.current = null;
      debugAction("continuous-reader.geometry-refresh-requested", {
        documentId: documentId ?? null
      });
      setGeometryRevision((current) => current + 1);
    });
  }, [documentId]);

  useEffect(() => {
    latestStateRef.current = readerSession?.document.state ?? null;
    setDisplayZoom(initialZoom);
    setWheelPreviewZoom(null);
    wheelZoomTargetRef.current = null;
    pendingZoomScrollTopRef.current = null;
    setPinnedVirtualRange(null);
    if (rangeReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(rangeReleaseFrameRef.current);
      rangeReleaseFrameRef.current = null;
    }
    if (rangeReleaseStableFrameRef.current !== null) {
      window.cancelAnimationFrame(rangeReleaseStableFrameRef.current);
      rangeReleaseStableFrameRef.current = null;
    }
    setFitModeState(initialFitMode);
    setBookmarksState(initialBookmarks);
    setCurrentPage(initialPage);
    setScrollTop(0);
    initialScrollAppliedRef.current = null;
    baseHeightsRef.current = new Map();
    setPageGeometries([]);
    pageCacheRef.current.clear();
    setMetrics(
      createEstimatedPageMetrics(pageCount, (pageNumber) =>
        estimateHeightFromKnownPage(pageNumber, baseHeightsRef, initialZoom)
      )
    );
  }, [documentId, initialFitMode, initialPage, initialZoom, openSessionId, pageCount]);

  useEffect(() => {
    if (!documentId || !readerSession) {
      setPageGeometries([]);
      return;
    }

    let cancelled = false;
    void getPdfPageGeometries(documentId, { openSessionId: readerSession.openSessionId })
      .then((geometries) => {
        if (cancelled) {
          return;
        }
        const resolvedGeometries = validatePageGeometries(geometries, pageCount);
        const nextBaseHeights = new Map<number, number>();
        for (const geometry of resolvedGeometries) {
          nextBaseHeights.set(geometry.pageNumber, getPageGeometry(geometry, 1).height);
        }
        baseHeightsRef.current = nextBaseHeights;
        setPageGeometries(resolvedGeometries);
        setMetrics(
          createEstimatedPageMetrics(pageCount, (pageNumber) =>
            getPageGeometry(resolvedGeometries[pageNumber - 1], displayZoomRef.current).height
          )
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        debugAction("continuous-reader.page-geometry-error", {
          documentId,
          error: error instanceof Error ? error.message : String(error)
        });
        onStatusChange("Unable to load canonical page geometry for Scroll mode.");
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, geometryRevision, onStatusChange, pageCount, readerSession?.openSessionId]);

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
      setViewportWidth(scrollSurface.clientWidth);
      setDevicePixelRatio(window.devicePixelRatio);
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
    if (!scrollSurface || pageGeometries.length !== pageCount) {
      return;
    }

    centerHorizontalOverflow(scrollSurface);
  }, [displayZoom, pageCount, pageGeometries, viewportWidth]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    const scrollKey = documentId ? `${documentId}:${initialPage}` : null;
    if (
      !scrollSurface ||
      !scrollKey ||
      pageGeometries.length !== pageCount ||
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
  }, [documentId, initialPage, pageCount, pageGeometries.length, placements.length]);

  useEffect(() => {
    const activeOpenSessionId = readerSession?.openSessionId ?? null;
    const api: ViewerApi | null =
      readerSession && documentId
        ? {
            nextPage: () => scrollToPageRef.current(currentPageRef.current + 1),
            previousPage: () => scrollToPageRef.current(currentPageRef.current - 1),
            zoomIn: () => updateZoomRef.current(stepScrollZoom(displayZoomRef.current, "in")),
            zoomOut: () => updateZoomRef.current(stepScrollZoom(displayZoomRef.current, "out")),
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

  useEffect(
    () => () => renderCoordinator.cancelAll("viewer-effect-cleanup"),
    [renderCoordinator]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (wheelZoomTimerRef.current !== null) {
        window.clearTimeout(wheelZoomTimerRef.current);
      }
      if (geometryRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(geometryRefreshFrameRef.current);
      }
      if (rangeReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(rangeReleaseFrameRef.current);
      }
      if (rangeReleaseStableFrameRef.current !== null) {
        window.cancelAnimationFrame(rangeReleaseStableFrameRef.current);
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
      const nextZoom = scaleZoomByWheelDelta(
        wheelZoomTargetRef.current ?? displayZoomRef.current,
        delta
      );
      wheelZoomTargetRef.current = nextZoom;
      setWheelPreviewZoom(nextZoom);
      if (wheelZoomTimerRef.current !== null) {
        window.clearTimeout(wheelZoomTimerRef.current);
      }
      wheelZoomTimerRef.current = window.setTimeout(() => {
        wheelZoomTimerRef.current = null;
        const committedZoom = wheelZoomTargetRef.current;
        wheelZoomTargetRef.current = null;
        if (committedZoom === null) {
          return;
        }
        setWheelPreviewZoom(null);
        updateZoomRef.current(committedZoom);
      }, WHEEL_ZOOM_COMMIT_DELAY_MS);
    },
    []
  );

  if (!readerSession || !document || !documentId) {
    return (
      <div className="reader-empty">
        <div className="empty-state" />
      </div>
    );
  }

  const activeOpenSessionId = readerSession.openSessionId;
  const rasterScale = resolveScrollRasterScale(displayZoom, devicePixelRatio);
  const transientScale = wheelPreviewZoom === null ? 1 : wheelPreviewZoom / displayZoom;
  const transientOriginY = scrollTop + readingLineOffsetPx;

  return (
    <ContinuousScrollModel
      metrics={metrics}
      onScroll={handleScroll}
      scrollSurfaceRef={scrollSurfaceRef}
      viewerDisplayConfig={viewerDisplayConfig}
      zoomGestureActive={wheelPreviewZoom !== null}
    >
      <div onWheel={handleWheel}>
        {pageGeometries.length === pageCount ? <ContinuousPageList
          coordinator={renderCoordinator}
          documentId={documentId}
          pageGeometries={pageGeometries}
          openSessionId={activeOpenSessionId}
          pageCacheRef={pageCacheRef}
          placements={placements}
          range={virtualRange}
          readingLineY={scrollTop + readingLineOffsetPx}
          renderZoom={displayZoom}
          rasterScale={rasterScale}
          transientScale={transientScale}
          transientOriginY={transientOriginY}
          visibleRange={visibleRange}
          viewerDisplayConfig={viewerDisplayConfig}
          onIdentityChanged={requestPageGeometryRefresh}
          onPageMeasured={handlePageMeasured}
        /> : null}
      </div>
    </ContinuousScrollModel>
  );
}
