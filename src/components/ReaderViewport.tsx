import { memo, useEffect } from "react";

import PdfViewer from "./PdfViewer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { debugAction } from "../lib/debugLog";
import type { DocumentState, OutlineItem, ReaderSession, ViewerApi, ViewerSnapshot } from "../lib/types";

function toViewEventName(view: "reader" | "collection" | "notes" | "book") {
  if (view === "reader") {
    return "document";
  }
  if (view === "book") {
    return "book";
  }
  if (view === "notes") {
    return "notes";
  }
  return "collection";
}

type ReaderViewportProps = {
  activeViewTransition: {
    clickStartedAtMs: number;
    fromView: "reader" | "collection" | "notes" | "book";
    source: string;
    toView: "reader" | "collection" | "notes" | "book";
    viewTransitionId: string;
  } | null;
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

const ReaderViewport = memo(function ReaderViewport({
  activeViewTransition,
  readerSession,
  readerActive,
  pendingReaderOpenSessionId,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  suspendAutoFitDuringPaneResize
}: ReaderViewportProps) {
  useEffect(() => {
    const elapsedFromClickMs =
      activeViewTransition?.clickStartedAtMs == null
        ? null
        : Math.round(performance.now() - activeViewTransition.clickStartedAtMs);
    let mountLogged = false;
    const timeoutId = window.setTimeout(() => {
      mountLogged = true;
      debugAction("view.document:component-mounted", {
        documentId: readerSession?.documentId ?? null,
        elapsedFromClickMs,
        fromView: activeViewTransition ? toViewEventName(activeViewTransition.fromView) : null,
        openSessionId: readerSession?.openSessionId ?? null,
        source: activeViewTransition?.source ?? null,
        toView: activeViewTransition ? toViewEventName(activeViewTransition.toView) : null,
        viewTransitionId: activeViewTransition?.viewTransitionId ?? null
      });
      debugAction("reader:mounted", {
        documentId: readerSession?.documentId ?? null,
        elapsedFromClickMs,
        openSessionId: readerSession?.openSessionId ?? null,
        viewTransitionId: activeViewTransition?.viewTransitionId ?? null
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      if (!mountLogged) {
        return;
      }
      debugAction("reader:unmounted", {
        documentId: readerSession?.documentId ?? null,
        openSessionId: readerSession?.openSessionId ?? null,
        viewTransitionId: activeViewTransition?.viewTransitionId ?? null
      });
    };
  }, []);

  return (
    <section className="reader-viewport" aria-label="Reader viewport">
      <PdfViewer
        readerSession={readerSession}
        readerActive={readerActive}
        pendingReaderOpenSessionId={pendingReaderOpenSessionId}
        onSnapshotChange={onSnapshotChange}
        onOutlineChange={onOutlineChange}
        onStateChange={onStateChange}
        onStatusChange={onStatusChange}
        registerApi={registerApi}
        viewerDisplayConfig={viewerDisplayConfig}
        suspendAutoFitDuringPaneResize={suspendAutoFitDuringPaneResize}
      />
    </section>
  );
});

export default ReaderViewport;
