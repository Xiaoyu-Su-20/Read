import { memo } from "react";

import { useReaderController } from "../lib/reader/useReaderController";
import type { DocumentPayload, DocumentState, OutlineItem, ViewerApi, ViewerSnapshot } from "../lib/types";

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
  const {
    displayedPage,
    incomingPage,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    handleKeyDown,
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
        className="reader-scroll-surface"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.focus();
        }}
        onWheel={handleWheel}
      >
        <div className="reader-page">
          {displayedPage || incomingPage ? (
            <div className="pdf-page-layer">
              <div className="reader-page__surface">
                {displayedPage ? (
                  <img
                    key={displayedPage.requestKey}
                    className="reader-page__image reader-page__image--displayed"
                    src={displayedPage.imageUrl}
                    alt={`Page ${displayedPage.pageNumber}`}
                    draggable={false}
                  />
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

      {isRendering ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Rendering...
        </div>
      ) : null}

      {loadingDocument && !displayedPage && !incomingPage ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Loading document...
        </div>
      ) : null}

      {renderError ? (
        <div className="reader-page__status reader-page__status--error" role="status">
          {renderError}
        </div>
      ) : null}
    </div>
  );
});

export default PdfViewer;
