import { memo } from "react";

import NotesPane from "./notes/NotesPane";
import type { NoteDocument, NoteNavigationItem } from "../lib/types";

type NotesViewportProps = {
  note: NoteDocument | null;
  loading: boolean;
  navigationItems: NoteNavigationItem[];
  onChangeTitle: (title: string) => void;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlush: () => void | Promise<void>;
  onCopyAllText: () => Promise<void>;
  onGoToPage: (page: number) => void;
  currentPage: number | null;
};

const NotesViewport = memo(function NotesViewport({
  note,
  loading,
  navigationItems,
  onChangeTitle,
  onChangeBlocks,
  onFlush,
  onCopyAllText,
  onGoToPage,
  currentPage
}: NotesViewportProps) {
  return (
    <section className="notes-viewport" aria-label="Notes viewport">
      <NotesPane
        note={note}
        loading={loading}
        navigationItems={navigationItems}
        onChangeTitle={onChangeTitle}
        onChangeBlocks={onChangeBlocks}
        onFlush={onFlush}
        onCopyAllText={onCopyAllText}
        onGoToPage={onGoToPage}
        currentPage={currentPage}
      />
    </section>
  );
});

export default NotesViewport;
