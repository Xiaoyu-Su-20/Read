import { useEffect, useState } from "react";

import { renderPdfPage } from "../lib/api";

type RenderState =
  | { status: "idle" | "loading"; url: string | null }
  | { status: "ready"; url: string; width: number; height: number }
  | { status: "error"; message: string };

type MobilePdfPageProps = {
  documentId: string;
  openSessionId: string | null;
  pageNumber: number;
  zoom: number;
  className?: string;
};

export default function MobilePdfPage({
  documentId,
  openSessionId,
  pageNumber,
  zoom,
  className
}: MobilePdfPageProps) {
  const [renderState, setRenderState] = useState<RenderState>({
    status: "idle",
    url: null
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setRenderState((current) => ({
      status: "loading",
      url: current.status === "ready" || current.status === "loading" ? current.url : null
    }));

    renderPdfPage(documentId, pageNumber, zoom, { openSessionId: openSessionId ?? undefined })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const imageBlob = new Blob([Uint8Array.from(payload.imageBytes)], {
          type: "image/jpeg"
        });
        objectUrl = URL.createObjectURL(imageBlob);
        setRenderState({
          status: "ready",
          url: objectUrl,
          width: payload.width,
          height: payload.height
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRenderState({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [documentId, openSessionId, pageNumber, zoom]);

  const previousUrl =
    renderState.status === "loading" && renderState.url ? renderState.url : null;

  return (
    <figure className={`mobile-pdf-page ${className ?? ""}`} data-page-number={pageNumber}>
      {renderState.status === "ready" ? (
        <img
          src={renderState.url}
          width={renderState.width}
          height={renderState.height}
          alt={`Page ${pageNumber}`}
        />
      ) : previousUrl ? (
        <img src={previousUrl} alt={`Page ${pageNumber}`} />
      ) : (
        <div className="mobile-pdf-page__placeholder">
          <span>{renderState.status === "error" ? "Preview unavailable" : `Page ${pageNumber}`}</span>
          {renderState.status === "error" ? <small>{renderState.message}</small> : null}
        </div>
      )}
    </figure>
  );
}
