import { memo } from "react";

import NotesPane from "./notes/ui/NotesPane";
import type {
  Bookmark,
  NoteDocument,
  NoteNavigationItem,
  NoteRevealRequest,
  OutlineItem,
  PdfNavigationTarget
} from "../lib/types";

type NotesViewportProps = {
  note: NoteDocument | null;
  loading: boolean;
  ignoredSpellcheckWords: string[];
  capabilityMode: "document" | "standalone";
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
  headerActionsContainerId: string | null;
  navigationOpen: boolean;
  onNavigationOpenChange: (open: boolean) => void;
  navigationOpenRequest: number;
  commandPaletteOpen: boolean;
  onToggleCommandPalette: () => void;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
  navigationItems: NoteNavigationItem[];
  onChangeTitle: (title: string) => void;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onToggleIgnoredSpellcheckWord: (word: string, ignored: boolean) => void;
  onFlush: () => void | Promise<void>;
  onCopyAllText: () => Promise<void>;
  onGoToPage: (page: number) => void;
  documentId: string | null;
  outlineItems: OutlineItem[];
  bookmarks: Bookmark[];
  onNavigateToTarget: (target: PdfNavigationTarget) => void;
  onSetBookmarks: (bookmarks: Bookmark[]) => void;
  currentPage: number | null;
  revealRequest: NoteRevealRequest | null;
};

const NotesViewport = memo(function NotesViewport({
  note,
  loading,
  ignoredSpellcheckWords,
  capabilityMode,
  fullscreen,
  onToggleFullscreen,
  headerActionsContainerId,
  navigationOpen,
  onNavigationOpenChange,
  navigationOpenRequest,
  commandPaletteOpen,
  onToggleCommandPalette,
  registerCommandPaletteAnchor,
  navigationItems,
  onChangeTitle,
  onChangeBlocks,
  onToggleIgnoredSpellcheckWord,
  onFlush,
  onCopyAllText,
  onGoToPage,
  documentId,
  outlineItems,
  bookmarks,
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
        ignoredSpellcheckWords={ignoredSpellcheckWords}
        capabilityMode={capabilityMode}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        headerActionsContainerId={headerActionsContainerId}
        navigationOpen={navigationOpen}
        onNavigationOpenChange={onNavigationOpenChange}
        navigationOpenRequest={navigationOpenRequest}
        commandPaletteOpen={commandPaletteOpen}
        onToggleCommandPalette={onToggleCommandPalette}
        registerCommandPaletteAnchor={registerCommandPaletteAnchor}
        navigationItems={navigationItems}
        onChangeTitle={onChangeTitle}
        onChangeBlocks={onChangeBlocks}
        onToggleIgnoredSpellcheckWord={onToggleIgnoredSpellcheckWord}
        onFlush={onFlush}
        onCopyAllText={onCopyAllText}
        onGoToPage={onGoToPage}
        documentId={documentId}
        outlineItems={outlineItems}
        bookmarks={bookmarks}
        onNavigateToTarget={onNavigateToTarget}
        onSetBookmarks={onSetBookmarks}
        currentPage={currentPage}
        revealRequest={revealRequest}
      />
    </section>
  );
});

export default NotesViewport;
