import type { MouseEvent as ReactMouseEvent } from "react";

import NotesViewport from "./NotesViewport";
import WorkspaceSearchField from "../search/components/WorkspaceSearchField";
import type { NoteDocument, NoteNavigationItem, NoteRevealRequest } from "../lib/types";
import type { UnifiedSearchController } from "../search/controller/UnifiedSearchController";

type NotesWorkspaceProps = {
  note: NoteDocument | null;
  notesLoading: boolean;
  noteNavigationItems: NoteNavigationItem[];
  noteRevealRequest: NoteRevealRequest | null;
  navigationOpen: boolean;
  onNavigationOpenChange: (open: boolean) => void;
  navigationOpenRequest: number;
  onChangeNoteTitle: (title: string) => void;
  onChangeNoteBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlushNote: () => void | Promise<void>;
  onCopyAllNoteText: () => Promise<void>;
  onCreateStandaloneNote: () => void | Promise<void>;
  onOpenStandaloneNoteResult: (noteId: string, blockId: string) => void | Promise<void>;
  onHeaderMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  searchController: UnifiedSearchController;
  searchFocusRequest: number;
  commandPaletteOpen: boolean;
  onToggleCommandPalette: () => void;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
  showHeaders: boolean;
  showFullscreenHint: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
};

export default function NotesWorkspace({
  note,
  notesLoading,
  noteNavigationItems,
  noteRevealRequest,
  navigationOpen,
  onNavigationOpenChange,
  navigationOpenRequest,
  onChangeNoteTitle,
  onChangeNoteBlocks,
  onFlushNote,
  onCopyAllNoteText,
  onCreateStandaloneNote,
  onOpenStandaloneNoteResult,
  onHeaderMouseDown,
  searchController,
  searchFocusRequest,
  commandPaletteOpen,
  onToggleCommandPalette,
  registerCommandPaletteAnchor,
  showHeaders,
  showFullscreenHint,
  fullscreen,
  onToggleFullscreen
}: NotesWorkspaceProps) {
  const headerTitle = note?.title?.trim() || "Notes";

  return (
    <div
      className={`reader-workspace notes-workspace${
        showHeaders ? "" : " reader-workspace--immersive notes-workspace--immersive"
      }`}
    >
      {showHeaders ? (
        <div className="reader-workspace__header-shell">
          <header className="reader-workspace__header" onMouseDown={onHeaderMouseDown}>
            <div className="reader-workspace__toolbar reader-workspace__toolbar--notes">
              <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--left">
                <div className="reader-workspace__document-header-layout reader-workspace__header-left">
                  <div className="reader-workspace__header-group reader-workspace__header-group--title">
                    <div className="reader-workspace__header-main">
                      <div className="reader-workspace__header-copy">
                        <strong className="reader-workspace__header-title">{headerTitle}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="reader-workspace__header-center" data-no-window-drag>
                <div className="reader-workspace__notes-header-search">
                  <WorkspaceSearchField
                    controller={searchController}
                    focusRequest={searchFocusRequest}
                    placeholder="Search notes"
                    onOpenDocument={async () => undefined}
                    onGoToPage={() => undefined}
                    onOpenNoteResult={onOpenStandaloneNoteResult}
                  />
                </div>
              </div>

              <div className="reader-workspace__toolbar-side reader-workspace__toolbar-side--right">
                <div
                  id="notes-workspace-header-tools"
                  className="reader-workspace__notes-header-tools reader-workspace__header-right"
                  data-no-window-drag
                />
              </div>
            </div>
          </header>
        </div>
      ) : null}

      <div className="reader-workspace__body reader-workspace__body--notes-only notes-workspace__body">
        <div className="reader-workspace__notes reader-workspace__notes--only">
          {notesLoading ? (
            <div className="notes-workspace__empty">
              <div className="notes-workspace__empty-copy">
                <p className="notes-workspace__empty-label">Loading note...</p>
                <p className="notes-workspace__empty-help">
                  Restoring your standalone note workspace.
                </p>
              </div>
            </div>
          ) : note ? (
            <NotesViewport
              note={note}
              loading={notesLoading}
              capabilityMode="standalone"
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
              onGoToPage={() => undefined}
              documentId={null}
              outlineItems={[]}
              bookmarks={[]}
              onNavigateToTarget={() => undefined}
              onSetBookmarks={() => undefined}
              currentPage={null}
              revealRequest={noteRevealRequest}
              headerActionsContainerId="notes-workspace-header-tools"
              commandPaletteOpen={commandPaletteOpen}
              onToggleCommandPalette={onToggleCommandPalette}
              registerCommandPaletteAnchor={registerCommandPaletteAnchor}
            />
          ) : (
            <div className="notes-workspace__empty">
              <div className="notes-workspace__empty-copy">
                <p className="notes-workspace__empty-label">Start writing...</p>
                <p className="notes-workspace__empty-help">
                  Create a standalone note to begin your writing workspace.
                </p>
              </div>
              <button
                className="notes-workspace__empty-action"
                type="button"
                onClick={() => {
                  void onCreateStandaloneNote();
                }}
              >
                Create note
              </button>
            </div>
          )}
        </div>
      </div>

      {showFullscreenHint ? (
        <div className="reader-workspace__fullscreen-hint">Press Esc to exit fullscreen</div>
      ) : null}
    </div>
  );
}
