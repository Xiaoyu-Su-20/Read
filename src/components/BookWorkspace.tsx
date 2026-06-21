import type { MouseEvent as ReactMouseEvent } from "react";

import DocumentWorkspaceHeader from "./DocumentWorkspaceHeader";
import ReaderViewport from "./ReaderViewport";
import WorkspaceHeaderTools from "./WorkspaceHeaderTools";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import type {
  DocumentState,
  ReaderSession,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";
import type { UnifiedSearchController } from "../search/controller/UnifiedSearchController";

type BookWorkspaceProps = {
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
  readerState: DocumentState | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: import("../lib/types").OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  documentHeaderTitle: string;
  documentHeaderCurrentPage: number;
  documentHeaderPageCount: number;
  documentHeaderZoom: number;
  viewerApi: ViewerApi | null;
  onHeaderMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  searchController: UnifiedSearchController;
  searchFocusRequest: number;
  commandPaletteOpen: boolean;
  onToggleCommandPalette: () => void;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
  onSearchOpenDocument: (documentId: string) => Promise<void>;
  onSearchGoToPage: (pageNumber: number) => void;
  showHeaders: boolean;
  showFullscreenHint: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
};

export default function BookWorkspace({
  activeViewTransition,
  readerSession,
  readerActive,
  pendingReaderOpenSessionId,
  readerState,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  documentHeaderTitle,
  documentHeaderCurrentPage,
  documentHeaderPageCount,
  documentHeaderZoom,
  viewerApi,
  onHeaderMouseDown,
  searchController,
  searchFocusRequest,
  commandPaletteOpen,
  onToggleCommandPalette,
  registerCommandPaletteAnchor,
  onSearchOpenDocument,
  onSearchGoToPage,
  showHeaders,
  showFullscreenHint,
  fullscreen,
  onToggleFullscreen
}: BookWorkspaceProps) {
  return (
    <div className={`reader-workspace${showHeaders ? "" : " reader-workspace--immersive"}`}>
      {showHeaders ? (
        <DocumentWorkspaceHeader
          title={documentHeaderTitle}
          currentPage={documentHeaderCurrentPage}
          pageCount={documentHeaderPageCount}
          zoom={documentHeaderZoom}
          readerState={readerState}
          viewerApi={viewerApi}
          onHeaderMouseDown={onHeaderMouseDown}
          searchController={searchController}
          searchFocusRequest={searchFocusRequest}
          onSearchOpenDocument={onSearchOpenDocument}
          onSearchGoToPage={onSearchGoToPage}
          onSearchOpenNoteResult={async () => undefined}
          headerActionsContainerId="book-workspace-header-tools"
          rightSlot={
            <WorkspaceHeaderTools
              commandPaletteOpen={commandPaletteOpen}
              registerCommandPaletteAnchor={registerCommandPaletteAnchor}
              onToggleCommandPalette={onToggleCommandPalette}
              fullscreen={fullscreen}
              onToggleFullscreen={onToggleFullscreen}
            />
          }
        />
      ) : null}

      <div className="reader-workspace__body reader-workspace__body--book-only">
        <div className="reader-workspace__document reader-workspace__document--only">
          <ReaderViewport
            activeViewTransition={activeViewTransition}
            readerSession={readerSession}
            readerActive={readerActive}
            pendingReaderOpenSessionId={pendingReaderOpenSessionId}
            onSnapshotChange={onSnapshotChange}
            onOutlineChange={onOutlineChange}
            onStateChange={onStateChange}
            onStatusChange={onStatusChange}
            registerApi={registerApi}
            viewerDisplayConfig={viewerDisplayConfig}
            suspendAutoFitDuringPaneResize={false}
          />
        </div>
      </div>

      {showFullscreenHint ? (
        <div className="reader-workspace__fullscreen-hint">Press Esc to exit fullscreen</div>
      ) : null}
    </div>
  );
}
