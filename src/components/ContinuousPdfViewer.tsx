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
  type UIEvent
} from "react";

import NativePdfTextLayer from "./NativePdfTextLayer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import {
  activateDocumentStateWriter,
  getPdfNativeOutline,
  getPdfNativeTextPage,
  getPdfPageGeometries,
  saveDocumentState
} from "../lib/api";
import { dedupeBookmarks } from "../lib/commands";
import { debugAction } from "../lib/debugLog";
import {
  captureContinuousScrollAnchor,
  captureContinuousSemanticAnchor,
  computeContinuousPagePlacements,
  computeContinuousVirtualRange,
  computeContinuousVirtualRangeFromPlacements,
  createEstimatedPageMetrics,
  mergeContinuousVirtualRanges,
  resolveContinuousActivePageFromPlacements,
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
  isPinchWheelDelta,
  resolveScrollRasterScale,
  scaleZoomByPinchDelta,
  scaleZoomByWheelDelta,
  normalizeZoom,
  stepScrollZoom
} from "../lib/reader/zoom";
import {
  createDocumentStateWriterGeneration,
  isStaleDocumentStateWriterError
} from "../lib/reader/documentStateWriter";
import { predictFolio, type FolioPrediction } from "../lib/reader/folioPrediction";
import { updateScrollReaderState } from "../lib/reader/documentReaderState";
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
  readerState: DocumentState | null;
  initialPage: number | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  onFolioPrediction?: (pageNumber: number, prediction: FolioPrediction | null) => void;
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
  currentState: DocumentState,
  page: number,
  scrollZoom: number,
  _fitMode: ReaderFitMode,
  bookmarks: Bookmark[]
): DocumentState {
  return updateScrollReaderState(
    {
      ...currentState,
      lastOpenedAt: new Date().toISOString()
    },
    clampPage(page, readerSession.document.pageCount),
    scrollZoom,
    dedupeBookmarks(bookmarks)
  );
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

// Pages unmount and remount as they scroll through the virtual window; keep their
// text payloads so a remount does not cost another IPC round trip and JSON parse.
const NATIVE_TEXT_PAGE_CACHE_LIMIT = 24;
const nativeTextPageCache = new Map<string, Promise<NativeTextPagePayload>>();

function loadNativeTextPage(
  documentId: string,
  openSessionId: string | null,
  pageNumber: number
) {
  const key = `${documentId}:${openSessionId ?? "legacy"}:${pageNumber}`;
  const cached = nativeTextPageCache.get(key);
  if (cached) {
    nativeTextPageCache.delete(key);
    nativeTextPageCache.set(key, cached);
    return cached;
  }
  const request = getPdfNativeTextPage(documentId, pageNumber, {
    openSessionId: openSessionId ?? undefined
  });
  nativeTextPageCache.set(key, request);
  request.catch(() => {
    if (nativeTextPageCache.get(key) === request) {
      nativeTextPageCache.delete(key);
    }
  });
  while (nativeTextPageCache.size > NATIVE_TEXT_PAGE_CACHE_LIMIT) {
    const oldestKey = nativeTextPageCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    nativeTextPageCache.delete(oldestKey);
  }
  return request;
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
  readingLineYRef,
  renderZoom,
  rasterScale,
  transientScale,
  transientOriginY,
  visibleRange,
  viewerDisplayConfig,
  onIdentityChanged,
  onPageMeasured,
  onFolioPrediction,
  folioPredictionCacheRef
}: {
  coordinator: ScrollRenderCoordinator;
  documentId: string;
  pageGeometries: EffectivePageGeometry[];
  openSessionId: string | null;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  placements: ReturnType<typeof computeContinuousPagePlacements>;
  range: ReturnType<typeof computeContinuousVirtualRange>;
  readingLineYRef: MutableRefObject<number>;
  renderZoom: number;
  rasterScale: number;
  transientScale: number;
  transientOriginY: number;
  visibleRange: ReturnType<typeof computeContinuousVirtualRange>;
  viewerDisplayConfig: ViewerDisplayConfig;
  onIdentityChanged: () => void;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
  onFolioPrediction: (pageNumber: number, prediction: FolioPrediction | null) => void;
  folioPredictionCacheRef: MutableRefObject<Map<string, FolioPrediction | null>>;
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
            pageTop={placements[pageNumber - 1]?.top ?? 0}
            readingLineYRef={readingLineYRef}
            renderZoom={renderZoom}
            rasterScale={rasterScale}
            viewerDisplayConfig={viewerDisplayConfig}
            onIdentityChanged={onIdentityChanged}
            onPageMeasured={onPageMeasured}
            onFolioPrediction={onFolioPrediction}
            folioPredictionCacheRef={folioPredictionCacheRef}
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
  pageTop,
  readingLineYRef,
  rasterScale,
  renderZoom,
  viewerDisplayConfig,
  onIdentityChanged,
  onPageMeasured,
  onFolioPrediction,
  folioPredictionCacheRef
}: {
  coordinator: ScrollRenderCoordinator;
  documentId: string;
  geometry: EffectivePageGeometry;
  openSessionId: string | null;
  pageCacheRef: MutableRefObject<ReturnType<typeof createPageCache>>;
  pageNumber: number;
  priority: RenderPriority;
  pageTop: number;
  readingLineYRef: MutableRefObject<number>;
  rasterScale: number;
  renderZoom: number;
  viewerDisplayConfig: ViewerDisplayConfig;
  onIdentityChanged: () => void;
  onPageMeasured: (page: CachedRenderedPage, measuredHeight: number) => void;
  onFolioPrediction: (pageNumber: number, prediction: FolioPrediction | null) => void;
  folioPredictionCacheRef: MutableRefObject<Map<string, FolioPrediction | null>>;
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
  pageRef.current = page;
  // Values the effects below read at call time; keeping them out of the dependency
  // lists stops scrolling or a layout-only zoom change from restarting work.
  const targetHeightRef = useRef(targetGeometry.height);
  targetHeightRef.current = targetGeometry.height;
  const pageTopRef = useRef(pageTop);
  pageTopRef.current = pageTop;
  const onFolioPredictionRef = useRef(onFolioPrediction);
  onFolioPredictionRef.current = onFolioPrediction;
  const pageTextLayerTransform = page?.textLayerTransform ?? null;
  const textRenderTransform = useMemo(
    () =>
      pageTextLayerTransform
        ? scaleTextLayerTransform(pageTextLayerTransform, renderZoom, rasterScale)
        : undefined,
    [pageTextLayerTransform, rasterScale, renderZoom]
  );

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
        }, 140);
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

    const lease = coordinator.request({
      identity,
      priority,
      distanceFromReadingLine: Math.abs(pageTopRef.current - readingLineYRef.current)
    });
    void lease.promise
      .then((renderedPage) => {
        if (cancelled) {
          pageCacheRef.current.discard(renderedPage, "obsolete-render");
          return;
        }
        const canonicalPage = pageCacheRef.current.set(cacheKey, renderedPage);
        promotePage(canonicalPage);
        onPageMeasured(canonicalPage, targetHeightRef.current);
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
    // `priority` is deliberately omitted: the effect below reprioritizes a queued job
    // without cancelling and restarting it.
  }, [coordinator, documentId, geometry, onIdentityChanged, onPageMeasured, openSessionId, pageCacheRef, pageNumber, promotePage, rasterScale, readingLineYRef]);

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
      distanceFromReadingLine: Math.abs(pageTopRef.current - readingLineYRef.current)
    });
  }, [coordinator, documentId, geometry, openSessionId, pageNumber, priority, rasterScale, readingLineYRef]);

  useEffect(() => {
    let cancelled = false;
    setTextLayer(null);
    void loadNativeTextPage(documentId, openSessionId, pageNumber)
      .then((payload) => {
        if (cancelled || payload.pageNumber !== pageNumber) {
          return;
        }
        setTextLayer(payload);
        const cacheKey = `${documentId}:${openSessionId ?? "legacy"}:${pageNumber}`;
        const prediction = folioPredictionCacheRef.current.has(cacheKey)
          ? folioPredictionCacheRef.current.get(cacheKey) ?? null
          : predictFolio(payload).prediction;
        folioPredictionCacheRef.current.set(cacheKey, prediction);
        onFolioPredictionRef.current(pageNumber, prediction);
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
  }, [documentId, folioPredictionCacheRef, openSessionId, pageNumber]);

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
              {/* The outgoing raster stays fully opaque underneath while the new one
                  fades in on top, so the paper never shows through mid-swap. */}
              {previousPage ? (
                <img
                  className="reader-page__image reader-page__image--active continuous-reader__page-image--previous"
                  src={previousPage.imageUrl}
                  alt=""
                  draggable={false}
                />
              ) : null}
              <img
                className="reader-page__image reader-page__image--active continuous-reader__page-image--incoming"
                src={page.imageUrl}
                alt={`Page ${page.pageNumber}`}
                draggable={false}
                style={{ opacity: incomingVisible ? 1 : 0 }}
              />
            </div>
            <NativePdfTextLayer
              pageNumber={page.pageNumber}
              textLayer={textLayer}
              renderedWidth={targetGeometry.width}
              renderedHeight={targetGeometry.height}
              renderTransform={textRenderTransform}
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
  readerState,
  initialPage: initialPageOverride,
  readerActive,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  onFolioPrediction = () => undefined
}: ContinuousPdfViewerProps) {
  const document = readerSession?.document ?? null;
  const documentId = document?.document.id ?? null;
  const pageCount = document?.pageCount ?? 0;
  const openSessionId = readerSession?.openSessionId ?? null;
  const writerLeaseRef = useRef<{
    active: boolean;
    generation: number;
    openSessionId: string | null;
    ready: Promise<void>;
  }>({
    active: false,
    generation: createDocumentStateWriterGeneration(),
    openSessionId,
    ready: Promise.resolve()
  });
  if (writerLeaseRef.current.openSessionId !== openSessionId) {
    writerLeaseRef.current.active = false;
    writerLeaseRef.current = {
      active: false,
      generation: createDocumentStateWriterGeneration(),
      openSessionId,
      ready: Promise.resolve()
    };
  }
  const initialReaderStateRef = useRef<{
    openSessionId: string | null;
    state: DocumentState | null;
  }>({ openSessionId, state: readerState ?? readerSession?.document.state ?? null });
  if (initialReaderStateRef.current.openSessionId !== openSessionId) {
    initialReaderStateRef.current = {
      openSessionId,
      state: readerState ?? readerSession?.document.state ?? null
    };
  }
  const sourceReaderState = initialReaderStateRef.current.state;
  const initialPageSeedRef = useRef<{
    openSessionId: string | null;
    page: number | null;
  }>({ openSessionId, page: initialPageOverride });
  if (initialPageSeedRef.current.openSessionId !== openSessionId) {
    initialPageSeedRef.current = { openSessionId, page: initialPageOverride };
  }
  const initialZoom = normalizeZoom(
    sourceReaderState?.scrollZoom ?? readerSession?.scrollZoom ?? 1
  );
  const initialFitMode = SCROLL_READER_FIT_MODE;
  const initialBookmarks = sourceReaderState?.bookmarks ?? [];
  const initialPage = readerSession
    ? clampPage(
        initialPageSeedRef.current.page ??
          sourceReaderState?.lastPage ??
          readerSession.page ??
          readerSession.document.state.lastPage,
        pageCount
      )
    : 1;
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageCacheRef = useRef(createPageCache({ maxBytes: CONTINUOUS_RENDER_CACHE_BYTES }));
  const folioPredictionCacheRef = useRef(new Map<string, FolioPrediction | null>());
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
  const latestStateRef = useRef<DocumentState | null>(sourceReaderState);
  const initialScrollAppliedRef = useRef<string | null>(null);
  const pendingPageNavigationRef = useRef<{
    align: "top" | "reading-line";
    page: number;
  } | null>(null);
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
  const [initialLocationApplied, setInitialLocationApplied] = useState(false);
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
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
  const desiredVirtualRange = useMemo(
    () =>
      computeContinuousVirtualRangeFromPlacements({
        placements,
        scrollTop,
        viewportHeight,
        overscanPx: CONTINUOUS_OVERSCAN_PX
      }),
    [placements, scrollTop, viewportHeight]
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
      computeContinuousVirtualRangeFromPlacements({
        placements,
        scrollTop,
        viewportHeight,
        overscanPx: 0
      }),
    [placements, scrollTop, viewportHeight]
  );

  const readingLineOffsetPx = Math.max(Math.min(viewportHeight * 0.28, 220), 48);
  // Pages read this lazily when they queue a render, so scrolling does not re-render them.
  const readingLineYRef = useRef(0);
  readingLineYRef.current = scrollTop + readingLineOffsetPx;

  useEffect(() => {
    if (!documentId || !openSessionId) {
      return;
    }
    const lease = writerLeaseRef.current;
    lease.active = true;
    lease.ready = activateDocumentStateWriter(
      documentId,
      openSessionId,
      lease.generation
    );
    return () => {
      lease.active = false;
    };
  }, [documentId, openSessionId]);

  const publishState = useCallback(
    (nextPage: number, nextZoom = displayZoom, nextFitMode = fitMode, nextBookmarks = bookmarks) => {
      if (!readerSession) {
        return;
      }
      const nextState = makeDocumentState(
        readerSession,
        latestStateRef.current ?? sourceReaderState ?? readerSession.document.state,
        nextPage,
        nextZoom,
        nextFitMode,
        nextBookmarks
      );
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
        const lease = writerLeaseRef.current;
        void lease.ready.then(() => {
          if (!lease.active || lease !== writerLeaseRef.current || !openSessionId) {
            return;
          }
          return saveDocumentState(readerSession.documentId, nextState, {
            openSessionId,
            writerGeneration: lease.generation
          });
        }).catch((error) => {
          if (isStaleDocumentStateWriterError(error)) {
            lease.active = false;
            return;
          }
          if (lease.active) {
            debugAction("continuous-reader.state-save-error", {
              documentId: readerSession.documentId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
      }, READER_STATE_SAVE_DEBOUNCE_MS);
    },
    [bookmarks, displayZoom, fitMode, onSnapshotChange, onStateChange, openSessionId, readerSession, sourceReaderState]
  );
  publishStateRef.current = publishState;

  const scrollToPage = useCallback(
    (page: number, options?: { align?: "top" | "reading-line" }) => {
      const clampedPage = clampPage(page, pageCount);
      const align = options?.align ?? "top";
      pendingPageNavigationRef.current = { align, page: clampedPage };
      const scrollSurface = scrollSurfaceRef.current;
      if (!scrollSurface || pageGeometries.length !== pageCount) {
        return;
      }
      const placement = placements.find((candidate) => candidate.pageNumber === clampedPage);
      if (!placement) {
        return;
      }
      const nextScrollTop =
        align === "reading-line"
          ? Math.max(placement.top - readingLineOffsetPx, 0)
          : placement.top;
      pendingPageNavigationRef.current = null;
      if (documentId && openSessionId) {
        initialScrollAppliedRef.current = `${documentId}:${openSessionId}`;
      }
      scrollSurface.scrollTop = nextScrollTop;
      scrollTopRef.current = nextScrollTop;
      currentPageRef.current = clampedPage;
      setScrollTop(nextScrollTop);
      setCurrentPage(clampedPage);
      setInitialLocationApplied(true);
      publishState(clampedPage);
    },
    [
      documentId,
      openSessionId,
      pageCount,
      pageGeometries.length,
      placements,
      publishState,
      readingLineOffsetPx
    ]
  );
  scrollToPageRef.current = scrollToPage;

  const updateZoom = useCallback(
    (nextZoom: number) => {
      const normalizedZoom = normalizeZoom(nextZoom);
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
    latestStateRef.current = sourceReaderState;
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
    setInitialLocationApplied(false);
    setScrollTop(0);
    initialScrollAppliedRef.current = null;
    pendingPageNavigationRef.current = null;
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
    if (!readerSession || !readerActive || !initialLocationApplied) {
      return;
    }
    onSnapshotChange({
      currentPage,
      pageCount,
      zoom: displayZoom
    });
  }, [currentPage, displayZoom, initialLocationApplied, onSnapshotChange, pageCount, readerActive, readerSession]);

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
    const pendingNavigation = pendingPageNavigationRef.current;
    if (!pendingNavigation || pageGeometries.length !== pageCount) {
      return;
    }
    scrollToPageRef.current(pendingNavigation.page, {
      align: pendingNavigation.align
    });
  }, [pageCount, pageGeometries.length, placements.length]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    const scrollKey = documentId && openSessionId ? `${documentId}:${openSessionId}` : null;
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
      scrollTopRef.current = placement.top;
      currentPageRef.current = initialPage;
      setScrollTop(placement.top);
      setCurrentPage(initialPage);
      setInitialLocationApplied(true);
    }
  }, [documentId, initialPage, openSessionId, pageCount, pageGeometries.length, placements.length]);

  useEffect(() => {
    const activeOpenSessionId = readerSession?.openSessionId ?? null;
    // Joined line text per page for in-document search, scoped to this open session so repeated
    // queries do not refetch the (large) native text payload. Deliberately separate from the
    // shared native text LRU, which a full-document search would otherwise flush.
    const searchTextByPage = new Map<number, string>();
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
            goToPage: (page, options) =>
              scrollToPageRef.current(page, {
                align: options?.alignment === "reading-line" ? "reading-line" : "top"
              }),
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
                const cachedText = searchTextByPage.get(pageNumber);
                if (cachedText !== undefined) {
                  return cachedText;
                }
                const textPage = await getPdfNativeTextPage(documentId, pageNumber, {
                  openSessionId: activeOpenSessionId ?? undefined
                });
                const pageText = textPage.lines.map((line) => line.text).join("\n");
                searchTextByPage.set(pageNumber, pageText);
                return signal.aborted ? "" : pageText;
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
        resolveContinuousActivePageFromPlacements(
          placementsRef.current,
          nextScrollTop,
          readingLineOffsetPx
        ),
        pageCountRef.current || 1
      );
      if (nextPage !== currentPageRef.current) {
        currentPageRef.current = nextPage;
        setCurrentPage(nextPage);
        publishStateRef.current(nextPage);
      }
    },
    [readingLineOffsetPx]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const baseZoom = wheelZoomTargetRef.current ?? displayZoomRef.current;
      const nextZoom = isPinchWheelDelta(delta)
        ? scaleZoomByPinchDelta(baseZoom, delta)
        : scaleZoomByWheelDelta(baseZoom, delta);
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

  useEffect(() => {
    const surface = scrollSurfaceRef.current;
    if (!surface) return;
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [documentId, handleWheel, readerSession]);

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
      <div>
        {pageGeometries.length === pageCount ? <ContinuousPageList
          coordinator={renderCoordinator}
          documentId={documentId}
          pageGeometries={pageGeometries}
          openSessionId={activeOpenSessionId}
          pageCacheRef={pageCacheRef}
          placements={placements}
          range={virtualRange}
          readingLineYRef={readingLineYRef}
          renderZoom={displayZoom}
          rasterScale={rasterScale}
          transientScale={transientScale}
          transientOriginY={transientOriginY}
          visibleRange={visibleRange}
          viewerDisplayConfig={viewerDisplayConfig}
          onIdentityChanged={requestPageGeometryRefresh}
          onPageMeasured={handlePageMeasured}
          onFolioPrediction={onFolioPrediction}
          folioPredictionCacheRef={folioPredictionCacheRef}
        /> : null}
      </div>
    </ContinuousScrollModel>
  );
}
