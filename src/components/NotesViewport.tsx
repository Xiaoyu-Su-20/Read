import { memo } from "react";

import NotesPane from "./notes/NotesPane";
import type {
  DocumentState,
  NoteDocument,
  NoteNavigationItem,
  NoteRevealRequest,
  OutlineItem,
  PdfNavigationTarget
} from "../lib/types";

type NotesViewportProps = {
  note: NoteDocument | null;
  loading: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
  headerActionsContainerId: string | null;
  commandPaletteOpen: boolean;
  onToggleCommandPalette: () => void;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
  navigationItems: NoteNavigationItem[];
  onChangeTitle: (title: string) => void;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlush: () => void | Promise<void>;
  onCopyAllText: () => Promise<void>;
  onGoToPage: (page: number) => void;
  documentId: string | null;
  outlineItems: OutlineItem[];
  readerState: DocumentState | null;
  onNavigateToTarget: (target: PdfNavigationTarget) => void;
  onSetBookmarks: (bookmarks: DocumentState["bookmarks"]) => void;
  currentPage: number | null;
  revealRequest: NoteRevealRequest | null;
};

const NotesViewport = memo(function NotesViewport({
  note,
  loading,
  fullscreen,
  onToggleFullscreen,
  headerActionsContainerId,
  commandPaletteOpen,
  onToggleCommandPalette,
  registerCommandPaletteAnchor,
  navigationItems,
  onChangeTitle,
  onChangeBlocks,
  onFlush,
  onCopyAllText,
  onGoToPage,
  documentId,
  outlineItems,
  readerState,
  onNavigateToTarget,
  onSetBookmarks,
  currentPage,
  revealRequest
}: NotesViewportProps) {
  return (
    <section
      className={`notes-viewport${fullscreen ? " notes-viewport--fullscreen" : ""}`}
      aria-label="Notes viewport"
    >
      <NotesPane
        note={note}
        loading={loading}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        headerActionsContainerId={headerActionsContainerId}
        commandPaletteOpen={commandPaletteOpen}
        onToggleCommandPalette={onToggleCommandPalette}
        registerCommandPaletteAnchor={registerCommandPaletteAnchor}
        navigationItems={navigationItems}
        onChangeTitle={onChangeTitle}
        onChangeBlocks={onChangeBlocks}
        onFlush={onFlush}
        onCopyAllText={onCopyAllText}
        onGoToPage={onGoToPage}
        documentId={documentId}
        outlineItems={outlineItems}
        readerState={readerState}
        onNavigateToTarget={onNavigateToTarget}
        onSetBookmarks={onSetBookmarks}
        currentPage={currentPage}
        revealRequest={revealRequest}
      />
    </section>
  );
});

export default NotesViewport;
