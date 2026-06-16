import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import NotesViewport from "./NotesViewport";
import PaneResizeHandle from "./PaneResizeHandle";
import ReaderViewport from "./ReaderViewport";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { useReaderPaneLayoutController } from "../lib/reader/useReaderPaneLayoutController";
import type {
  DocumentPayload,
  DocumentState,
  NoteDocument,
  NoteNavigationItem,
  NoteRevealRequest,
  OutlineItem,
  PdfNavigationTarget,
  PdfOutlineItem,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";

type ReaderWorkspaceProps = {
  document: DocumentPayload | null;
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
  onSetUserOutlineItems: (items: PdfOutlineItem[]) => void;
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
  windowControls: ReactNode;
  showHeaders: boolean;
  showFullscreenHint: boolean;
  fullscreen: boolean;
  readerPaneSplitRatio: number;
  hidePaneResizeHandle: boolean;
  onChangeReaderPaneSplitRatio: (nextRatio: number) => void;
};

export default function ReaderWorkspace({
  document,
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
  onSetUserOutlineItems,
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
  windowControls,
  showHeaders,
  showFullscreenHint,
  fullscreen,
  readerPaneSplitRatio,
  hidePaneResizeHandle,
  onChangeReaderPaneSplitRatio
}: ReaderWorkspaceProps) {
  const { containerRef, workspaceStyle, isDragging, isStackedLayout, separatorProps } =
    useReaderPaneLayoutController({
      preferredRatio: readerPaneSplitRatio,
      onCommitRatio: onChangeReaderPaneSplitRatio
    });
  const hasOpenDocument = document != null && documentHeaderPageCount > 0;
  const documentPageLabel = hasOpenDocument
    ? `${documentHeaderCurrentPage} / ${documentHeaderPageCount}`
    : "No document";
  const documentZoomLabel = `${Math.round(documentHeaderZoom * 100)}%`;

  return (
    <div
      ref={containerRef}
      className={`reader-workspace${showHeaders ? "" : " reader-workspace--immersive"}`}
      style={workspaceStyle}
    >
      {showHeaders ? (
        <header
          className="reader-workspace__header reader-workspace__header--document"
          onMouseDown={onHeaderMouseDown}
        >
        <div className="reader-workspace__document-header-layout">
          <div className="reader-workspace__document-header-title-region">
            <div className="reader-workspace__header-main">
              <span className="reader-workspace__header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M7 4.5h6.8L18.5 9v10.5A1.5 1.5 0 0 1 17 21H7A1.5 1.5 0 0 1 5.5 19.5v-13A1.5 1.5 0 0 1 7 5Z" />
                  <path d="M13.5 4.8V9h4.2" />
                </svg>
              </span>
              <div className="reader-workspace__header-copy">
                <strong className="reader-workspace__header-title">{documentHeaderTitle}</strong>
              </div>
            </div>
          </div>

          <div className="reader-workspace__document-header-controls reader-workspace__document-header-controls--page">
            <button
              className="reader-workspace__header-button reader-workspace__header-button--compact"
              type="button"
              aria-label="Previous page"
              disabled={!hasOpenDocument}
              data-no-window-drag
              onClick={() => viewerApi?.previousPage()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m14.5 6.5-5 5 5 5" />
              </svg>
            </button>
            <span className="reader-workspace__header-value" data-no-window-drag>
              {documentPageLabel}
            </span>
            <button
              className="reader-workspace__header-button reader-workspace__header-button--compact"
              type="button"
              aria-label="Next page"
              disabled={!hasOpenDocument}
              data-no-window-drag
              onClick={() => viewerApi?.nextPage()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m9.5 6.5 5 5-5 5" />
              </svg>
            </button>
          </div>

          <div className="reader-workspace__document-header-controls reader-workspace__document-header-controls--zoom">
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
            <span className="reader-workspace__header-value" data-no-window-drag>
              {documentZoomLabel}
            </span>
            <button
              className="reader-workspace__header-button reader-workspace__header-button--compact"
              type="button"
              aria-label="Zoom in"
              disabled={!hasOpenDocument}
              data-no-window-drag
              onClick={() => viewerApi?.zoomIn()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 6v12" />
                <path d="M6 12h12" />
              </svg>
            </button>
          </div>
        </div>
        </header>
      ) : null}

      {showHeaders ? (
        <header
          className="reader-workspace__header reader-workspace__header--notes"
          onMouseDown={onHeaderMouseDown}
        >
          <div className="reader-workspace__notes-header-trailing" data-no-window-drag>
            <div
              id="reader-workspace-notes-header-tools"
              className="reader-workspace__notes-header-tools"
            />
            <div className="reader-workspace__header-actions">{windowControls}</div>
          </div>
        </header>
      ) : null}

      <div className="reader-workspace__splitter">
        <PaneResizeHandle
          active={isDragging}
          hidden={isStackedLayout || hidePaneResizeHandle}
          separatorProps={separatorProps}
        />
      </div>

      <div className="reader-workspace__document">
        <ReaderViewport
          document={document}
          onSnapshotChange={onSnapshotChange}
          onOutlineChange={onOutlineChange}
          onStateChange={onStateChange}
          onStatusChange={onStatusChange}
          registerApi={registerApi}
          viewerDisplayConfig={viewerDisplayConfig}
        />
      </div>
      <div className="reader-workspace__notes">
        <NotesViewport
          note={note}
          loading={notesLoading}
          fullscreen={fullscreen}
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
          onSetUserOutlineItems={onSetUserOutlineItems}
          currentPage={currentReaderPage}
          revealRequest={noteRevealRequest}
          headerActionsContainerId="reader-workspace-notes-header-tools"
        />
      </div>
      {showFullscreenHint ? (
        <div className="reader-workspace__fullscreen-hint">Press Esc to exit fullscreen</div>
      ) : null}
    </div>
  );
}
