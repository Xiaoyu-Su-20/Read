import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ReactNode } from "react";

import WorkspaceSearchField from "../search/components/WorkspaceSearchField";
import { debugAction } from "../lib/debugLog";
import type { ReaderViewMode, ViewerApi } from "../lib/types";
import type { UnifiedSearchController } from "../search/controller/UnifiedSearchController";

type DocumentWorkspaceHeaderProps = {
  title: string;
  currentPage: number;
  pageCount: number;
  zoom: number;
  readerViewMode: ReaderViewMode;
  viewerApi: ViewerApi | null;
  onReaderViewModeChange: (mode: ReaderViewMode) => void;
  onHeaderMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  searchController: UnifiedSearchController;
  searchFocusRequest: number;
  onSearchOpenDocument: (documentId: string) => Promise<void>;
  onSearchGoToPage: (pageNumber: number) => void;
  onSearchOpenNoteResult: ((noteId: string, blockId: string) => void | Promise<void>) | null;
  headerActionsContainerId: string;
  rightSlot?: ReactNode;
};

type DocumentControlsProps = {
  title: string;
  currentPage: number;
  pageCount: number;
  zoom: number;
  readerViewMode: ReaderViewMode;
  viewerApi: ViewerApi | null;
  onReaderViewModeChange: (mode: ReaderViewMode) => void;
};

const DocumentControls = memo(function DocumentControls({
  title,
  currentPage,
  pageCount,
  zoom,
  readerViewMode,
  viewerApi,
  onReaderViewModeChange
}: DocumentControlsProps) {
  const hasOpenDocument = pageCount > 0;
  const documentPageLabel = hasOpenDocument ? `${currentPage} / ${pageCount}` : "No document";
  const documentZoomLabel = `${Math.round(zoom * 100)}%`;
  const autoMaximizeZoom = viewerApi?.getAutoMaximizeZoom() ?? null;
  const zoomInDisabled =
    !hasOpenDocument ||
    (readerViewMode === "page" &&
      autoMaximizeZoom !== null &&
      zoom >= autoMaximizeZoom - 0.005);

  function handleHeaderPageNavigation(direction: "previous" | "next") {
    debugAction("reader.navigate-header-click", {
      currentPage,
      direction,
      hasViewerApi: Boolean(viewerApi),
      pageCount
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
    <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--left">
      <div className="reader-workspace__document-header-layout reader-workspace__header-left">
        <div className="reader-workspace__header-group reader-workspace__header-group--title">
          <div className="reader-workspace__header-main">
            <div className="reader-workspace__header-copy">
              <strong className="reader-workspace__header-title">{title}</strong>
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
          <span
            className="reader-workspace__header-value reader-workspace__header-value--page"
            data-no-window-drag
          >
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
          <span
            className="reader-workspace__header-value reader-workspace__header-value--zoom"
            data-no-window-drag
          >
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

        <div
          className="reader-workspace__header-group reader-workspace__header-group--view-mode"
          role="group"
          aria-label="Reader view mode"
          data-no-window-drag
        >
          <button
            className={`reader-workspace__view-mode-button${
              readerViewMode === "page" ? " reader-workspace__view-mode-button--active" : ""
            }`}
            type="button"
            aria-pressed={readerViewMode === "page"}
            disabled={!hasOpenDocument}
            onClick={() => onReaderViewModeChange("page")}
          >
            Page
          </button>
          <button
            className={`reader-workspace__view-mode-button${
              readerViewMode === "scroll" ? " reader-workspace__view-mode-button--active" : ""
            }`}
            type="button"
            aria-pressed={readerViewMode === "scroll"}
            disabled={!hasOpenDocument}
            onClick={() => onReaderViewModeChange("scroll")}
          >
            Scroll
          </button>
        </div>
      </div>
    </div>
  );
});

type HeaderSearchProps = {
  searchController: UnifiedSearchController;
  searchFocusRequest: number;
  onSearchOpenDocument: (documentId: string) => Promise<void>;
  onSearchGoToPage: (pageNumber: number) => void;
  onSearchOpenNoteResult: ((noteId: string, blockId: string) => void | Promise<void>) | null;
};

const HeaderSearch = memo(function HeaderSearch({
  searchController,
  searchFocusRequest,
  onSearchOpenDocument,
  onSearchGoToPage,
  onSearchOpenNoteResult
}: HeaderSearchProps) {
  return (
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
  );
});

type HeaderActionsProps = {
  headerActionsContainerId: string;
  rightSlot?: ReactNode;
};

const HeaderActions = memo(function HeaderActions({
  headerActionsContainerId,
  rightSlot
}: HeaderActionsProps) {
  return (
    <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--right">
      <div
        id={headerActionsContainerId}
        className="reader-workspace__notes-header-tools reader-workspace__header-right"
        data-no-window-drag
      >
        {rightSlot}
      </div>
    </div>
  );
});

export default function DocumentWorkspaceHeader({
  title,
  currentPage,
  pageCount,
  zoom,
  readerViewMode,
  viewerApi,
  onReaderViewModeChange,
  onHeaderMouseDown,
  searchController,
  searchFocusRequest,
  onSearchOpenDocument,
  onSearchGoToPage,
  onSearchOpenNoteResult,
  headerActionsContainerId,
  rightSlot
}: DocumentWorkspaceHeaderProps) {

  return (
    <div className="reader-workspace__header-shell">
      <header className="reader-workspace__header" onMouseDown={onHeaderMouseDown}>
        <div className="reader-workspace__toolbar reader-workspace__toolbar--document">
          <DocumentControls
            title={title}
            currentPage={currentPage}
            pageCount={pageCount}
            zoom={zoom}
            readerViewMode={readerViewMode}
            viewerApi={viewerApi}
            onReaderViewModeChange={onReaderViewModeChange}
          />
          <HeaderSearch
            searchController={searchController}
            searchFocusRequest={searchFocusRequest}
            onSearchOpenDocument={onSearchOpenDocument}
            onSearchGoToPage={onSearchGoToPage}
            onSearchOpenNoteResult={onSearchOpenNoteResult}
          />
          <HeaderActions
            headerActionsContainerId={headerActionsContainerId}
            rightSlot={rightSlot}
          />
        </div>
      </header>
    </div>
  );
}
