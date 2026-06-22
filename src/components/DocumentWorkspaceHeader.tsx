import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ReactNode } from "react";

import WorkspaceSearchField from "../search/components/WorkspaceSearchField";
import { debugAction } from "../lib/debugLog";
import type { ResolvedReaderFitMode } from "../lib/reader/zoom";
import type { ViewerApi } from "../lib/types";
import type { UnifiedSearchController } from "../search/controller/UnifiedSearchController";

type DocumentWorkspaceHeaderProps = {
  title: string;
  currentPage: number;
  pageCount: number;
  zoom: number;
  documentFitMode: ResolvedReaderFitMode;
  viewerApi: ViewerApi | null;
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
  documentFitMode: ResolvedReaderFitMode;
  viewerApi: ViewerApi | null;
};

const DocumentControls = memo(function DocumentControls({
  title,
  currentPage,
  pageCount,
  zoom,
  documentFitMode,
  viewerApi
}: DocumentControlsProps) {
  const hasOpenDocument = pageCount > 0;
  const documentPageLabel = hasOpenDocument ? `${currentPage} / ${pageCount}` : "No document";
  const documentZoomLabel = `${Math.round(zoom * 100)}%`;
  const autoMaximizeZoom = viewerApi?.getAutoMaximizeZoom() ?? null;
  const zoomInDisabled =
    !hasOpenDocument ||
    (documentFitMode === "auto-maximize" &&
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
              viewerApi?.setFitMode(documentFitMode === "free" ? "auto-maximize" : "free")
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
  documentFitMode,
  viewerApi,
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
        <div className="reader-workspace__toolbar">
          <DocumentControls
            title={title}
            currentPage={currentPage}
            pageCount={pageCount}
            zoom={zoom}
            documentFitMode={documentFitMode}
            viewerApi={viewerApi}
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
