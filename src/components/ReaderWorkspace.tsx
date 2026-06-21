import type { MouseEvent as ReactMouseEvent } from "react";

import NotesViewport from "./NotesViewport";
import PaneResizeHandle from "./PaneResizeHandle";
import ReaderViewport from "./ReaderViewport";
import WorkspaceSearchField from "../search/components/WorkspaceSearchField";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { debugAction } from "../lib/debugLog";
import { useReaderPaneLayoutController } from "../lib/reader/useReaderPaneLayoutController";
import { normalizeReaderFitMode } from "../lib/reader/zoom";
import type {
  DocumentPayload,
  DocumentState,
  NoteDocument,
  NoteNavigationItem,
  NoteRevealRequest,
  OutlineItem,
  PdfNavigationTarget,
  ReaderSession,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";
import type { UnifiedSearchController } from "../search/controller/UnifiedSearchController";

type ReaderWorkspaceProps = {
  activeViewTransition: {
    clickStartedAtMs: number;
    fromView: "reader" | "collection" | "notes";
    source: string;
    toView: "reader" | "collection" | "notes";
    viewTransitionId: string;
  } | null;
  readerSession: ReaderSession | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  note: NoteDocument | null;
  notesLoading: boolean;
  noteNavigationItems: NoteNavigationItem[];
  onChangeNoteTitle: (title: string) => void;
  onChangeNoteBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlushNote: () => void | Promise<void>;
  onCopyAllNoteText: () => Promise<void>;
  onGoToNotePage: (page: number) => void;
  currentReaderPage: number | null;
  noteRevealRequest: NoteRevealRequest | null;
  outlineItems: OutlineItem[];
  readerState: DocumentState | null;
  onNavigateToTarget: (target: PdfNavigationTarget) => void;
  onSetBookmarks: (bookmarks: DocumentState["bookmarks"]) => void;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
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
  onSearchOpenNoteResult: (noteId: string, blockId: string) => void | Promise<void>;
  showHeaders: boolean;
  showFullscreenHint: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
  readerPaneSplitRatio: number;
  hidePaneResizeHandle: boolean;
  autoHidePaneResizeHandle: boolean;
  onChangeReaderPaneSplitRatio: (nextRatio: number) => void;
};

export default function ReaderWorkspace({
  activeViewTransition,
  readerSession,
  readerActive,
  pendingReaderOpenSessionId,
  note,
  notesLoading,
  noteNavigationItems,
  onChangeNoteTitle,
  onChangeNoteBlocks,
  onFlushNote,
  onCopyAllNoteText,
  onGoToNotePage,
  currentReaderPage,
  noteRevealRequest,
  outlineItems,
  readerState,
  onNavigateToTarget,
  onSetBookmarks,
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
  onSearchOpenNoteResult,
  showHeaders,
  showFullscreenHint,
  fullscreen,
  onToggleFullscreen,
  readerPaneSplitRatio,
  hidePaneResizeHandle,
  autoHidePaneResizeHandle,
  onChangeReaderPaneSplitRatio
}: ReaderWorkspaceProps) {
  const document = readerSession?.document ?? null;
  const documentFitMode = normalizeReaderFitMode(readerState?.preferences.fitMode);
  const autoMaximizeMinDocumentWidth =
    documentFitMode === "auto-maximize"
      ? viewerApi?.getAutoMaximizeMinDocumentWidth() ?? null
      : null;
  const { containerRef, workspaceStyle, isDragging, isStackedLayout, separatorProps } =
    useReaderPaneLayoutController({
      preferredRatio: readerPaneSplitRatio,
      onCommitRatio: onChangeReaderPaneSplitRatio,
      minDocumentWidthPx: autoMaximizeMinDocumentWidth
    });
  const hasOpenDocument = document != null && documentHeaderPageCount > 0;
  const documentPageLabel = hasOpenDocument
    ? `${documentHeaderCurrentPage} / ${documentHeaderPageCount}`
    : "No document";
  const documentZoomLabel = `${Math.round(documentHeaderZoom * 100)}%`;
  const autoMaximizeZoom = viewerApi?.getAutoMaximizeZoom() ?? null;
  const zoomInDisabled =
    !hasOpenDocument ||
    (documentFitMode === "auto-maximize" &&
      autoMaximizeZoom !== null &&
      documentHeaderZoom >= autoMaximizeZoom - 0.005);

  function handleHeaderPageNavigation(direction: "previous" | "next") {
    debugAction("reader.navigate-header-click", {
      currentPage: documentHeaderCurrentPage,
      direction,
      hasViewerApi: Boolean(viewerApi),
      pageCount: documentHeaderPageCount
    });

    if (!viewerApi) {
      return;
    }

    if (direction === "previous") {
      viewerApi.previousPage();
      return;
    }

    viewerApi.nextPage();
  }

  return (
    <div
      className={`reader-workspace${showHeaders ? "" : " reader-workspace--immersive"}`}
    >
      {showHeaders ? (
        <div className="reader-workspace__header-shell">
          <header
            className="reader-workspace__header"
            onMouseDown={onHeaderMouseDown}
          >
            <div className="reader-workspace__toolbar">
              <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--left">
                <div className="reader-workspace__document-header-layout reader-workspace__header-left">
                  <div className="reader-workspace__header-group reader-workspace__header-group--title">
                    <div className="reader-workspace__header-main">
                      <div className="reader-workspace__header-copy">
                        <strong className="reader-workspace__header-title">{documentHeaderTitle}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="reader-workspace__header-group reader-workspace__header-group--page">
                    <button
                      className="reader-workspace__header-button reader-workspace__header-button--compact"
                      type="button"
                      aria-label="Previous page"
                      disabled={!hasOpenDocument}
                      data-no-window-drag
                      onClick={() => handleHeaderPageNavigation("previous")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="m14.5 6.5-5 5 5 5" />
                      </svg>
                    </button>
                    <span className="reader-workspace__header-value reader-workspace__header-value--page" data-no-window-drag>
                      {documentPageLabel}
                    </span>
                    <button
                      className="reader-workspace__header-button reader-workspace__header-button--compact"
                      type="button"
                      aria-label="Next page"
                      disabled={!hasOpenDocument}
                      data-no-window-drag
                      onClick={() => handleHeaderPageNavigation("next")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="m9.5 6.5 5 5-5 5" />
                      </svg>
                    </button>
                  </div>

                  <div className="reader-workspace__header-group reader-workspace__header-group--zoom">
                    <button
                      className="reader-workspace__header-button reader-workspace__header-button--compact"
                      type="button"
                      aria-label="Zoom out"
                      disabled={!hasOpenDocument}
                      data-no-window-drag
                      onClick={() => viewerApi?.zoomOut()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 12h12" />
                      </svg>
                    </button>
                    <span className="reader-workspace__header-value reader-workspace__header-value--zoom" data-no-window-drag>
                      {documentZoomLabel}
                    </span>
                    <button
                      className="reader-workspace__header-button reader-workspace__header-button--compact"
                      type="button"
                      aria-label="Zoom in"
                      disabled={zoomInDisabled}
                      data-no-window-drag
                      onClick={() => viewerApi?.zoomIn()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 6v12" />
                        <path d="M6 12h12" />
                      </svg>
                    </button>
                  </div>

                  <div className="reader-workspace__header-group reader-workspace__header-group--lock">
                    <button
                      className="reader-workspace__header-button reader-workspace__header-button--lock"
                      type="button"
                      aria-label={
                        documentFitMode === "free"
                          ? "Switch to auto maximize"
                          : "Switch to free zoom"
                      }
                      aria-pressed={documentFitMode === "auto-maximize"}
                      disabled={!hasOpenDocument}
                      data-no-window-drag
                      onClick={() =>
                        viewerApi?.setFitMode(
                          documentFitMode === "free" ? "auto-maximize" : "free"
                        )
                      }
                    >
                      {documentFitMode === "free" ? (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.95"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M7.35 11V7.55C7.35 5.15 8.9 3.65 12.05 3.65C14.15 3.65 15.42 4.48 16.15 5.72" />
                          <path d="M4.85 11H19.15V20.35H4.85Z" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.95"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M7.35 11V7.55C7.35 5.15 8.95 3.65 12 3.65C15.05 3.65 16.65 5.15 16.65 7.55V11" />
                          <path d="M4.85 11H19.15V20.35H4.85Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="reader-workspace__header-center" data-no-window-drag>
                <div className="reader-workspace__notes-header-search">
                  <WorkspaceSearchField
                    controller={searchController}
                    focusRequest={searchFocusRequest}
                    placeholder="Search"
                    onOpenDocument={onSearchOpenDocument}
                    onGoToPage={onSearchGoToPage}
                    onOpenNoteResult={onSearchOpenNoteResult}
                  />
                </div>
              </div>

              <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--right">
                <div
                  id="reader-workspace-notes-header-tools"
                  className="reader-workspace__notes-header-tools reader-workspace__header-right"
                  data-no-window-drag
                />
              </div>
            </div>
          </header>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="reader-workspace__body"
        style={workspaceStyle}
      >
        <div className="reader-workspace__splitter">
          <PaneResizeHandle
            active={isDragging}
            autoHide={autoHidePaneResizeHandle}
            hidden={isStackedLayout || hidePaneResizeHandle}
            separatorProps={separatorProps}
          />
        </div>

        <div className="reader-workspace__document">
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
            suspendAutoFitDuringPaneResize={isDragging && documentFitMode === "auto-maximize"}
          />
        </div>
        <div className="reader-workspace__notes">
          <NotesViewport
            note={note}
            loading={notesLoading}
            capabilityMode="document"
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            titleMode="hidden"
            navigationOpenRequest={0}
            navigationItems={noteNavigationItems}
            onChangeTitle={onChangeNoteTitle}
            onChangeBlocks={onChangeNoteBlocks}
            onFlush={onFlushNote}
            onCopyAllText={onCopyAllNoteText}
            onGoToPage={onGoToNotePage}
            documentId={document?.document.id ?? null}
            outlineItems={outlineItems}
            readerState={readerState}
            onNavigateToTarget={onNavigateToTarget}
            onSetBookmarks={onSetBookmarks}
            currentPage={currentReaderPage}
            revealRequest={noteRevealRequest}
            headerActionsContainerId="reader-workspace-notes-header-tools"
            commandPaletteOpen={commandPaletteOpen}
            onToggleCommandPalette={onToggleCommandPalette}
            registerCommandPaletteAnchor={registerCommandPaletteAnchor}
          />
        </div>
      </div>
      {showFullscreenHint ? (
        <div className="reader-workspace__fullscreen-hint">Press Esc to exit fullscreen</div>
      ) : null}
    </div>
  );
}
