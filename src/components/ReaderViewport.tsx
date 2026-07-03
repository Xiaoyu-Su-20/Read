import { memo, useCallback, useEffect } from "react";

import PdfViewer from "./PdfViewer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { debugAction } from "../lib/debugLog";
import type { DocumentState, OutlineItem, ReaderSession, ReaderViewMode, ViewerApi, ViewerSnapshot } from "../lib/types";
import { toViewEventName, type ViewTransition } from "../lib/workspaceView";
import ContinuousPdfViewer from "./ContinuousPdfViewer";

type ReaderViewportProps = {
  activeViewTransition: ViewTransition | null;
  readerSession: ReaderSession | null;
  readerState: DocumentState | null;
  initialReaderPage: number | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  onSnapshotChange: (mode: ReaderViewMode, snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (mode: ReaderViewMode, state: DocumentState | null) => void;
  registerApi: (mode: ReaderViewMode, api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  readerViewMode: ReaderViewMode;
  suspendAutoFitDuringPaneResize: boolean;
};

const ReaderViewport = memo(function ReaderViewport({
  activeViewTransition,
  readerSession,
  readerState,
  initialReaderPage,
  readerActive,
  pendingReaderOpenSessionId,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  readerViewMode,
  suspendAutoFitDuringPaneResize
}: ReaderViewportProps) {
  const handleSnapshotChange = useCallback(
    (snapshot: ViewerSnapshot) => onSnapshotChange(readerViewMode, snapshot),
    [onSnapshotChange, readerViewMode]
  );
  const handleStateChange = useCallback(
    (state: DocumentState | null) => onStateChange(readerViewMode, state),
    [onStateChange, readerViewMode]
  );
  const handleRegisterApi = useCallback(
    (api: ViewerApi | null) => registerApi(readerViewMode, api),
    [readerViewMode, registerApi]
  );

  useEffect(() => {
    if (!readerSession) {
      return;
    }

    const elapsedFromClickMs =
      activeViewTransition?.clickStartedAtMs == null
        ? null
        : Math.round(performance.now() - activeViewTransition.clickStartedAtMs);
    const destinationEventName = activeViewTransition
      ? toViewEventName(activeViewTransition.toView)
      : "document";

    debugAction(`view.${destinationEventName}:component-mounted`, {
      documentId: readerSession.documentId,
      elapsedFromClickMs,
      fromView: activeViewTransition ? toViewEventName(activeViewTransition.fromView) : null,
      openSessionId: readerSession.openSessionId,
      source: activeViewTransition?.source ?? null,
      toView: activeViewTransition ? toViewEventName(activeViewTransition.toView) : null,
      viewTransitionId: activeViewTransition?.viewTransitionId ?? null
    });
    debugAction("reader:mounted", {
      documentId: readerSession.documentId,
      elapsedFromClickMs,
      openSessionId: readerSession.openSessionId,
      viewTransitionId: activeViewTransition?.viewTransitionId ?? null
    });

    return () => {
      debugAction("reader:unmounted", {
        documentId: readerSession.documentId,
        openSessionId: readerSession.openSessionId,
        viewTransitionId: activeViewTransition?.viewTransitionId ?? null
      });
    };
  }, [activeViewTransition, readerSession]);

  return (
    <section
      className="reader-viewport"
      aria-label="Reader viewport"
      data-reader-view-mode={readerViewMode}
    >
      {readerViewMode === "scroll" ? (
        <ContinuousPdfViewer
          readerSession={readerSession}
          readerState={readerState}
          initialPage={initialReaderPage}
          readerActive={readerActive}
          pendingReaderOpenSessionId={pendingReaderOpenSessionId}
          onSnapshotChange={handleSnapshotChange}
          onOutlineChange={onOutlineChange}
          onStateChange={handleStateChange}
          onStatusChange={onStatusChange}
          registerApi={handleRegisterApi}
          viewerDisplayConfig={viewerDisplayConfig}
          suspendAutoFitDuringPaneResize={suspendAutoFitDuringPaneResize}
        />
      ) : (
        <PdfViewer
        readerSession={readerSession}
        readerState={readerState}
        initialPage={initialReaderPage}
        readerActive={readerActive}
        pendingReaderOpenSessionId={pendingReaderOpenSessionId}
        onSnapshotChange={handleSnapshotChange}
        onOutlineChange={onOutlineChange}
        onStateChange={handleStateChange}
        onStatusChange={onStatusChange}
        registerApi={handleRegisterApi}
        viewerDisplayConfig={viewerDisplayConfig}
        suspendAutoFitDuringPaneResize={suspendAutoFitDuringPaneResize}
      />
      )}
    </section>
  );
});

export default ReaderViewport;
