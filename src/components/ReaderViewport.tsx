import { memo } from "react";

import PdfViewer from "./PdfViewer";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import type { DocumentPayload, DocumentState, OutlineItem, ViewerApi, ViewerSnapshot } from "../lib/types";

type ReaderViewportProps = {
  document: DocumentPayload | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  suspendAutoFitDuringPaneResize: boolean;
};

const ReaderViewport = memo(function ReaderViewport({
  document,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  suspendAutoFitDuringPaneResize
}: ReaderViewportProps) {
  return (
    <section className="reader-viewport" aria-label="Reader viewport">
      <PdfViewer
        document={document}
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
