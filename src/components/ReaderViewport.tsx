import { Component, memo, useEffect, type ErrorInfo, type ReactNode } from "react";

import PdfViewer from "./PdfViewer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { debugAction } from "../lib/debugLog";
import type { DocumentState, OutlineItem, ReaderSession, ReaderViewMode, ViewerApi, ViewerSnapshot } from "../lib/types";
import { toViewEventName, type ViewTransition } from "../lib/workspaceView";
import ContinuousPdfViewer from "./ContinuousPdfViewer";

type ReaderViewportProps = {
  activeViewTransition: ViewTransition | null;
  readerSession: ReaderSession | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  readerViewMode: ReaderViewMode;
  suspendAutoFitDuringPaneResize: boolean;
};

type ContinuousReaderBoundaryProps = {
  children: ReactNode;
  fallback: (errorMessage: string | null) => ReactNode;
  resetKey: string;
};

type ContinuousReaderBoundaryState = {
  errorMessage: string | null;
  failed: boolean;
};

class ContinuousReaderBoundary extends Component<
  ContinuousReaderBoundaryProps,
  ContinuousReaderBoundaryState
> {
  state: ContinuousReaderBoundaryState = {
    errorMessage: null,
    failed: false
  };

  static getDerivedStateFromError(error: unknown): ContinuousReaderBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      failed: true
    };
  }

  componentDidUpdate(previousProps: ContinuousReaderBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ errorMessage: null, failed: false });
    }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    debugAction("continuous-reader.render-error", {
      componentStack: errorInfo.componentStack,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback(this.state.errorMessage);
    }

    return this.props.children;
  }
}

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
  readerViewMode,
  suspendAutoFitDuringPaneResize
}: ReaderViewportProps) {
  const continuousResetKey = `${readerSession?.documentId ?? "none"}:${readerSession?.openSessionId ?? "none"}:${readerViewMode}`;

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
        <ContinuousReaderBoundary
          resetKey={continuousResetKey}
          fallback={(errorMessage) => (
            <div className="continuous-reader__fallback">
              <div className="continuous-reader__fallback-banner" role="status">
                Scroll mode hit an error and temporarily fell back to Page mode.
                {errorMessage ? (
                  <span className="continuous-reader__fallback-error">{errorMessage}</span>
                ) : null}
              </div>
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
            </div>
          )}
        >
          <ContinuousPdfViewer
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
        </ContinuousReaderBoundary>
      ) : (
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
      )}
    </section>
  );
});

export default ReaderViewport;
