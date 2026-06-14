import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { isDebugModeEnabled } from "../lib/debugLog";
import { computePageShellOffsets } from "../lib/reader/pageLayout";
import { useReaderController } from "../lib/reader/useReaderController";
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
};

const PdfViewer = memo(function PdfViewer({
  document,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi
}: PdfViewerProps) {
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [pageOffsets, setPageOffsets] = useState({ offsetX: 0, offsetY: 0 });
  const {
    displayedPage,
    incomingPage,
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

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    const layoutPage = displayedPage ?? incomingPage;
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
        layoutPage.width,
        layoutPage.height
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
  }, [displayedPage, incomingPage]);

  const pageLayoutStyle = {
    ["--page-offset-x"]: `${pageOffsets.offsetX.toFixed(2)}px`,
    ["--page-offset-y"]: `${pageOffsets.offsetY.toFixed(2)}px`
  } as CSSProperties;

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
    <div className="reader-stage">
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
              <div className="reader-page__surface">
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
                    />
                  </>
                ) : null}

                {incomingPage ? (
                  <img
                    key={incomingPage.requestKey}
                    className="reader-page__image reader-page__image--incoming"
                    src={incomingPage.imageUrl}
                    alt={`Page ${incomingPage.pageNumber}`}
                    draggable={false}
                    onLoad={() => {
                      markIncomingReady(incomingPage.requestKey);
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

      {isDebugModeEnabled && displayedPage ? (
        <div className="reader-page__status reader-page__status--debug" role="status">
          {`Text: ${displayedPageTextDebugStatus.state} (p${displayedPageTextDebugStatus.pageNumber ?? displayedPage.pageNumber}, items ${displayedPageTextDebugStatus.itemCount})`}
        </div>
      ) : null}
    </div>
  );
});

export default PdfViewer;
