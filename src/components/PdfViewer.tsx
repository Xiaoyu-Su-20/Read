import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { type ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { isDebugModeEnabled } from "../lib/debugLog";
import { computePageShellOffsets } from "../lib/reader/pageLayout";
import { useReaderController } from "../lib/reader/useReaderController";
import { resolveSurfaceScale } from "../lib/reader/zoom";
import type { DocumentPayload, DocumentState, OutlineItem, ViewerApi, ViewerSnapshot } from "../lib/types";
import PdfTextLayer from "./PdfTextLayer";
import RapidTurnOverlay from "./RapidTurnOverlay";

type PdfViewerProps = {
  document: DocumentPayload | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
};

const PdfViewer = memo(function PdfViewer({
  document,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig
}: PdfViewerProps) {
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const scrollbarMetricsRef = useRef({
    trackHeight: 0,
    thumbHeight: 0,
    maxThumbTop: 0,
    maxScroll: 0
  });
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const [pageOffsets, setPageOffsets] = useState({ offsetX: 0, offsetY: 0 });
  const [scrollbarState, setScrollbarState] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0
  });
  const {
    displayedPage,
    incomingPage,
    displayZoom,
    committedZoom,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    displayedPageTextLayer,
    displayedPageTextDebugStatus,
    rapidTurnOverlay,
    handleKeyDown,
    handleNavigationKeyUp,
    handleWheel,
    markIncomingReady
  } = useReaderController({
    document,
    onOutlineChange,
    onSnapshotChange,
    onStatusChange,
    onStateChange,
    registerApi
  });

  const layoutPage = displayedPage ?? incomingPage;
  const renderedZoom = layoutPage?.renderZoom ?? committedZoom;
  const surfaceScale = resolveSurfaceScale(displayZoom, renderedZoom);
  const scaledWidth = layoutPage ? layoutPage.width * surfaceScale : 0;
  const scaledHeight = layoutPage ? layoutPage.height * surfaceScale : 0;

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    if (!scrollSurface || !layoutPage) {
      setPageOffsets((current) =>
        current.offsetX === 0 && current.offsetY === 0
          ? current
          : { offsetX: 0, offsetY: 0 }
      );
      return;
    }

    const updateOverflowState = () => {
      const nextOffsets = computePageShellOffsets(
        scrollSurface.clientWidth,
        scrollSurface.clientHeight,
        scaledWidth,
        scaledHeight
      );
      setPageOffsets((current) =>
        Math.abs(current.offsetX - nextOffsets.offsetX) < 0.5 &&
        Math.abs(current.offsetY - nextOffsets.offsetY) < 0.5
          ? current
          : nextOffsets
      );
    };

    updateOverflowState();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateOverflowState();
          });

    resizeObserver?.observe(scrollSurface);
    window.addEventListener("resize", updateOverflowState);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [layoutPage, scaledHeight, scaledWidth]);

  const pageLayoutStyle = {
    ["--page-offset-x"]: `${pageOffsets.offsetX.toFixed(2)}px`,
    ["--page-offset-y"]: `${pageOffsets.offsetY.toFixed(2)}px`
  } as CSSProperties;
  const appearanceStyle = {
    ["--viewer-paper-color"]: viewerDisplayConfig.paperColor,
    ["--viewer-ink-color"]: viewerDisplayConfig.inkColor,
    ["--viewer-image-filter"]: viewerDisplayConfig.imageFilter
  } as CSSProperties;

  useEffect(() => {
    const scrollSurfaceElement = scrollSurfaceRef.current;
    if (!scrollSurfaceElement) {
      return;
    }
    const scrollSurface = scrollSurfaceElement;

    function updateReaderScrollbar() {
      const nextTrackHeight = Math.max(scrollSurface.clientHeight - 14, 0);
      const nextMaxScroll = Math.max(
        scrollSurface.scrollHeight - scrollSurface.clientHeight,
        0
      );

      if (nextTrackHeight <= 0 || nextMaxScroll <= 0) {
        scrollbarMetricsRef.current = {
          trackHeight: 0,
          thumbHeight: 0,
          maxThumbTop: 0,
          maxScroll: 0
        };
        setScrollbarState({
          visible: false,
          thumbHeight: 0,
          thumbTop: 0
        });
        return;
      }

      const scrollRatio = scrollSurface.clientHeight / scrollSurface.scrollHeight;
      const thumbHeight = Math.max(32, nextTrackHeight * scrollRatio);
      const maxThumbTop = Math.max(nextTrackHeight - thumbHeight, 0);
      const thumbTop =
        nextMaxScroll === 0 ? 0 : (scrollSurface.scrollTop / nextMaxScroll) * maxThumbTop;

      scrollbarMetricsRef.current = {
        trackHeight: nextTrackHeight,
        thumbHeight,
        maxThumbTop,
        maxScroll: nextMaxScroll
      };
      setScrollbarState({
        visible: true,
        thumbHeight,
        thumbTop
      });
    }

    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      if (!activeDrag) {
        return;
      }

      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      scrollSurface.scrollTop = activeDrag.startScrollTop + scrollDelta;
    }

    function handlePointerUp(event: PointerEvent) {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      scrollbarDragRef.current = null;
    }

    updateReaderScrollbar();
    scrollSurface.addEventListener("scroll", updateReaderScrollbar, { passive: true });
    window.addEventListener("resize", updateReaderScrollbar);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      scrollSurface.removeEventListener("scroll", updateReaderScrollbar);
      window.removeEventListener("resize", updateReaderScrollbar);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      scrollbarDragRef.current = null;
    };
  }, [displayedPage, incomingPage, scaledHeight, scaledWidth]);

  if (!document) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <h2>学中做，做中学</h2>
        </div>
      </div>
    );
  }

  if (documentError) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <p>{documentError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="reader-stage"
      data-document-appearance={viewerDisplayConfig.mode}
      style={appearanceStyle}
    >
      <div
        ref={scrollSurfaceRef}
        className="reader-scroll-surface"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleNavigationKeyUp}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement | null)?.closest(".reader-page__text-layer")) {
            return;
          }
          event.currentTarget.focus();
        }}
        onWheel={handleWheel}
      >
        <div className="reader-page" style={pageLayoutStyle}>
          {displayedPage || incomingPage ? (
            <div className="pdf-page-layer">
              <div
                className="reader-page__surface-shell"
                style={{
                  width: `${scaledWidth}px`,
                  height: `${scaledHeight}px`
                }}
              >
                <div
                  className="reader-page__surface"
                  style={{
                    width: `${layoutPage?.width ?? 0}px`,
                    height: `${layoutPage?.height ?? 0}px`,
                    transform: `scale(${surfaceScale})`
                  }}
                >
                  {displayedPage ? (
                    <>
                      <img
                        key={displayedPage.requestKey}
                        className="reader-page__image reader-page__image--displayed"
                        src={displayedPage.imageUrl}
                        alt={`Page ${displayedPage.pageNumber}`}
                        draggable={false}
                      />
                      <PdfTextLayer
                        pageNumber={displayedPage.pageNumber}
                        textLayer={displayedPageTextLayer}
                        renderedWidth={displayedPage.width}
                        renderedHeight={displayedPage.height}
                        renderTransform={displayedPage.textLayerTransform}
                      />
                    </>
                  ) : null}
                </div>

                {incomingPage ? (
                  <img
                    key={incomingPage.requestKey}
                    className="reader-page__image reader-page__image--incoming"
                    src={incomingPage.imageUrl}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    onLoad={(event) => {
                      markIncomingReady(incomingPage.requestKey, event.currentTarget);
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {isDebugModeEnabled && isRendering ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Rendering...
        </div>
      ) : null}

      {isDebugModeEnabled && loadingDocument && !displayedPage && !incomingPage ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Loading document...
        </div>
      ) : null}

      {renderError ? (
        <div className="reader-page__status reader-page__status--error" role="status">
          {renderError}
        </div>
      ) : null}

      {rapidTurnOverlay?.visible ? <RapidTurnOverlay overlay={rapidTurnOverlay} /> : null}

      <div
        ref={scrollbarRef}
        className={scrollbarState.visible ? "reader-scrollbar reader-scrollbar--visible" : "reader-scrollbar"}
        onPointerDown={(event) => {
          const scrollbarElement = scrollbarRef.current;
          if (!scrollbarElement || event.target !== event.currentTarget) {
            return;
          }

          const trackRect = scrollbarElement.getBoundingClientRect();
          const { thumbHeight, maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
          if (maxScroll <= 0 || maxThumbTop <= 0) {
            return;
          }

          const nextThumbTop = event.clientY - trackRect.top - thumbHeight / 2;
          const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
          const scrollSurface = scrollSurfaceRef.current;
          if (!scrollSurface) {
            return;
          }
          scrollSurface.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
        }}
      >
        <div
          className="reader-scrollbar-thumb"
          style={{
            height: `${scrollbarState.thumbHeight}px`,
            transform: `translateY(${scrollbarState.thumbTop}px)`
          }}
          onPointerDown={(event) => {
            const scrollSurface = scrollSurfaceRef.current;
            if (!scrollSurface) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            scrollbarDragRef.current = {
              pointerId: event.pointerId,
              startClientY: event.clientY,
              startScrollTop: scrollSurface.scrollTop
            };
          }}
        />
      </div>

      {isDebugModeEnabled && displayedPage ? (
        <div className="reader-page__status reader-page__status--debug" role="status">
          {`Text: ${displayedPageTextDebugStatus.state} (p${displayedPageTextDebugStatus.pageNumber ?? displayedPage.pageNumber}, items ${displayedPageTextDebugStatus.itemCount})`}
        </div>
      ) : null}
    </div>
  );
});

export default PdfViewer;
