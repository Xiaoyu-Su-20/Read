import { memo, useEffect, useState } from "react";
import type { ComponentProps, MouseEvent as ReactMouseEvent } from "react";

import DocumentWorkspaceHeader from "./DocumentWorkspaceHeader";
import NotesViewport from "./NotesViewport";
import PaneResizeHandle from "./PaneResizeHandle";
import ReaderViewport from "./ReaderViewport";
import type { ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import type { ViewTransition } from "../lib/workspaceView";
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
  activeViewTransition: ViewTransition | null;
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
  navigationOpen: boolean;
  onNavigationOpenChange: (open: boolean) => void;
  navigationOpenRequest: number;
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

type DeferredNotesViewportProps = ComponentProps<typeof NotesViewport>;

const DeferredNotesViewport = memo(function DeferredNotesViewport(
  props: DeferredNotesViewportProps
) {
  const [notesReady, setNotesReady] = useState(false);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setNotesReady(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  if (!notesReady) {
    return (
      <section
        className={`notes-viewport${props.fullscreen ? " notes-viewport--fullscreen" : ""} notes-viewport--deferred`}
        aria-label="Notes viewport"
        aria-busy="true"
      />
    );
  }

  return <NotesViewport {...props} />;
});

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
  navigationOpen,
  onNavigationOpenChange,
  navigationOpenRequest,
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
  const bookmarks = readerState?.bookmarks ?? [];
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

  return (
    <div
      className={`reader-workspace${showHeaders ? "" : " reader-workspace--immersive"}`}
    >
      {showHeaders ? (
        <DocumentWorkspaceHeader
          title={documentHeaderTitle}
          currentPage={documentHeaderCurrentPage}
          pageCount={documentHeaderPageCount}
          zoom={documentHeaderZoom}
          documentFitMode={documentFitMode}
          viewerApi={viewerApi}
          onHeaderMouseDown={onHeaderMouseDown}
          searchController={searchController}
          searchFocusRequest={searchFocusRequest}
          onSearchOpenDocument={onSearchOpenDocument}
          onSearchGoToPage={onSearchGoToPage}
          onSearchOpenNoteResult={onSearchOpenNoteResult}
          headerActionsContainerId="reader-workspace-notes-header-tools"
        />
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
          <DeferredNotesViewport
            note={note}
            loading={notesLoading}
            capabilityMode="document"
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            titleMode="hidden"
            navigationOpen={navigationOpen}
            onNavigationOpenChange={onNavigationOpenChange}
            navigationOpenRequest={navigationOpenRequest}
            navigationItems={noteNavigationItems}
            onChangeTitle={onChangeNoteTitle}
            onChangeBlocks={onChangeNoteBlocks}
            onFlush={onFlushNote}
            onCopyAllText={onCopyAllNoteText}
            onGoToPage={onGoToNotePage}
            documentId={document?.document.id ?? null}
            outlineItems={outlineItems}
            bookmarks={bookmarks}
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
