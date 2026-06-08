import NotesViewport from "./NotesViewport";
import ReaderViewport from "./ReaderViewport";
import type {
  DocumentPayload,
  DocumentState,
  NoteDocument,
  NoteNavigationItem,
  OutlineItem,
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
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
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
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi
}: ReaderWorkspaceProps) {
  if (!document) {
    return (
      <ReaderViewport
        document={document}
        onSnapshotChange={onSnapshotChange}
        onOutlineChange={onOutlineChange}
        onStateChange={onStateChange}
        onStatusChange={onStatusChange}
        registerApi={registerApi}
      />
    );
  }

  return (
    <div className="reader-workspace">
      <div className="reader-workspace__document">
        <ReaderViewport
          document={document}
          onSnapshotChange={onSnapshotChange}
          onOutlineChange={onOutlineChange}
          onStateChange={onStateChange}
          onStatusChange={onStatusChange}
          registerApi={registerApi}
        />
      </div>
      <div className="reader-workspace__notes">
        <NotesViewport
          note={note}
          loading={notesLoading}
          navigationItems={noteNavigationItems}
          onChangeTitle={onChangeNoteTitle}
          onChangeBlocks={onChangeNoteBlocks}
          onFlush={onFlushNote}
          onCopyAllText={onCopyAllNoteText}
          onGoToPage={onGoToNotePage}
          currentPage={currentReaderPage}
        />
      </div>
    </div>
  );
}
