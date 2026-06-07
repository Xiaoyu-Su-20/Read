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

export default function PdfViewer({
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
          <span className="eyebrow">Reader</span>
          <h2>Your desk is clear.</h2>
          <p>Press Tab to open commands, import a PDF, and start reading.</p>
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
    <div className="reader-stage" onWheel={handleWheel}>
      <div className="reader-page">
        {displayedPage || incomingPage ? (
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
        ) : null}

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
    </div>
  );
}
