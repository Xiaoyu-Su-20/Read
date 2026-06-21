import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useMemo } from "react";

import { dedupeBookmarks, findBookmarkAtPage } from "../commands";
import { flattenOutlineItems } from "../documentReferences";
import type {
  DocumentPayload,
  DocumentRecord,
  DocumentState,
  FolderTreeNode,
  OutlineItem,
  PaletteItem,
  ViewerApi,
  ViewerSnapshot
} from "../types";
import { makeBookmark } from "./helpers";

type UseCommandRegistryArgs = {
  workspaceMode: "reader" | "collection" | "notes" | "book";
  libraryRoot: string;
  recentDocuments: DocumentRecord[];
  activeDocument: DocumentPayload | null;
  noteTitle: string | null;
  readerState: DocumentState | null;
  viewerSnapshot: ViewerSnapshot;
  outlineItems: OutlineItem[];
  selectedCollection: FolderTreeNode | null;
  viewerApiRef: MutableRefObject<ViewerApi | null>;
  closePalette: () => void;
  openSelection: (title: string, items: PaletteItem[], emptyMessage: string) => void;
  openPrompt: (
    title: string,
    placeholder: string,
    confirmLabel: string,
    onSubmit: (value: string) => void | Promise<void>,
    initialValue?: string
  ) => void;
  setStatusMessage: (message: string) => void;
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  viewerOrStatus: () => ViewerApi | null;
  promptImportFlow: () => Promise<void>;
  rescanLibraryFlow: () => Promise<void>;
  openLibraryFolder: () => Promise<void>;
  openDocumentById: (documentId: string) => Promise<void>;
  openSearch: () => void;
  openNotesNavigation: () => void;
  createStandaloneNote: () => Promise<void>;
  renameNote: (title: string) => void | Promise<void>;
  copyAllNoteText: () => Promise<void>;
};

export function useCommandRegistry({
  workspaceMode,
  libraryRoot,
  recentDocuments,
  activeDocument,
  noteTitle,
  readerState,
  viewerSnapshot,
  outlineItems,
  selectedCollection,
  viewerApiRef,
  closePalette,
  openSelection,
  openPrompt,
  setStatusMessage,
  setOutlineOpen,
  viewerOrStatus,
  promptImportFlow,
  rescanLibraryFlow,
  openLibraryFolder,
  openDocumentById,
  openSearch,
  openNotesNavigation,
  createStandaloneNote,
  renameNote,
  copyAllNoteText
}: UseCommandRegistryArgs) {
  return useMemo(() => {
    const latestAvailableRecentDocument = recentDocuments.find(
      (document) => document.availability === "available"
    );

    const recentDocumentItems = recentDocuments.map((document) => ({
      id: document.id,
      title:
        document.availability === "missing" ? `${document.title} (Missing)` : document.title,
      subtitle:
        document.availability === "missing"
          ? `Unavailable at ${document.relativePath}`
          : document.lastOpenedAt
            ? new Date(document.lastOpenedAt).toLocaleString()
            : "Never opened",
      glyph: "book" as const,
      onSelect: async () => {
        if (document.availability === "missing") {
          closePalette();
          setStatusMessage("That PDF is currently missing from the library.");
          return;
        }
        closePalette();
        await openDocumentById(document.id);
      }
    }));

    const savedMarks = dedupeBookmarks(readerState?.bookmarks ?? []);
    const flatOutlineItems = flattenOutlineItems(outlineItems);
    const markItems = [
      ...savedMarks.map((bookmark) => ({
        id: `saved-mark-${bookmark.id}`,
        title: bookmark.label,
        subtitle: `Page ${bookmark.page} - Saved`,
        glyph: "bookmark" as const,
        keywords: ["mark", "bookmark", "saved", `page ${bookmark.page}`],
        onSelect: async () => {
          viewerApiRef.current?.goToPage(bookmark.page);
          closePalette();
        }
      })),
      ...flatOutlineItems.map(({ item, depth }) => ({
        id: `section-mark-${item.id}`,
        title: `${"> ".repeat(depth)}${item.title}`,
        subtitle: `${item.page ? `Page ${item.page}` : item.externalUrl ? "External" : "No target"} - PDF`,
        glyph: "bookmark" as const,
        keywords: ["mark", "outline", "section", "heading", item.source],
        onSelect: async () => {
          const viewer = viewerApiRef.current;
          if (viewer && item.target) {
            viewer.navigateToTarget(item.target);
          } else if (viewer && item.page) {
            viewer.goToPage(item.page);
          } else {
            setStatusMessage("That mark does not have a readable page target.");
          }
          closePalette();
        }
      }))
    ];

    const savedMarkCount = savedMarks.length;
    const sectionMarkCount = flatOutlineItems.length;
    const totalMarkCount = markItems.length;

    const currentPageHasMark = findBookmarkAtPage(
      savedMarks,
      viewerSnapshot.currentPage
    );

    const libraryCommands = [
      {
        id: "import-pdf",
        title: "Import PDF",
        subtitle: "Copy a local PDF into a collection",
        glyph: "file-plus",
        group: "library",
        keywords: ["open file add pdf import"],
        onSelect: async () => {
          closePalette();
          await promptImportFlow();
        }
      },
      {
        id: "open-library-folder",
        title: "Open library folder",
        subtitle: libraryRoot || "Open the Reader library in File Explorer",
        glyph: "folder-open",
        group: "library",
        keywords: ["library explorer folder root open"],
        onSelect: async () => {
          closePalette();
          await openLibraryFolder();
        }
      },
      {
        id: "rescan-library",
        title: "Rescan library",
        subtitle: "Refresh the app index from the current folder structure",
        glyph: "refresh",
        group: "library",
        keywords: ["rescan refresh sync explorer"],
        onSelect: async () => {
          closePalette();
          await rescanLibraryFlow();
        }
      }
    ] satisfies PaletteItem[];

    const noteCommands = [
      {
        id: "rename-note",
        title: "Rename note",
        subtitle: noteTitle?.trim().length ? noteTitle : "Rename the current note",
        glyph: "page",
        group: "view",
        keywords: ["note rename title"],
        onSelect: () => {
          openPrompt(
            "Rename note",
            "Note title",
            "Rename",
            async (value) => {
              await renameNote(value);
            },
            noteTitle ?? ""
          );
        }
      },
      {
        id: "copy-note-text",
        title: "Copy all text",
        subtitle: "Copy the entire current note",
        glyph: "book",
        group: "view",
        keywords: ["copy note text clipboard"],
        onSelect: async () => {
          closePalette();
          await copyAllNoteText();
        }
      }
    ] satisfies PaletteItem[];

    if (workspaceMode === "notes") {
      return [
        {
          id: "find-notes",
          title: "Search notes",
          subtitle: "Search standalone notes",
          glyph: "search",
          group: "navigation",
          keywords: ["search find notes standalone"],
          onSelect: () => {
            closePalette();
            openSearch();
          }
        },
        {
          id: "open-note-navigation",
          title: "Open note navigation",
          subtitle: "Jump between headings in the current note",
          glyph: "panel",
          group: "navigation",
          keywords: ["note headings outline navigation"],
          onSelect: () => {
            closePalette();
            openNotesNavigation();
          }
        },
        {
          id: "create-note",
          title: "Create note",
          subtitle: "Start a new standalone note",
          glyph: "file-plus",
          group: "view",
          keywords: ["new create note standalone"],
          onSelect: async () => {
            closePalette();
            await createStandaloneNote();
          }
        },
        ...noteCommands,
        ...libraryCommands
      ] satisfies PaletteItem[];
    }

    const documentCommands = [
      {
        id: "go-to-page",
        title: "Go to page",
        subtitle: `Current page ${viewerSnapshot.currentPage}`,
        glyph: "page",
        group: "navigation",
        keywords: ["page jump navigate"],
        onSelect: () => {
          const viewer = viewerOrStatus();
          if (!viewer) {
            closePalette();
            return;
          }
          openPrompt(
            "Go to page",
            "Page number",
            "Jump",
            async (value) => {
              const page = Number.parseInt(value, 10);
              if (Number.isNaN(page)) {
                setStatusMessage("Enter a valid page number.");
                return;
              }
              viewer.goToPage(page);
            },
            String(viewerSnapshot.currentPage)
          );
        }
      },
      {
        id: "find",
        title: "Find in document",
        subtitle: "Search text in the current PDF",
        glyph: "search",
        group: "navigation",
        keywords: ["search find text"],
        onSelect: () => {
          closePalette();
          openSearch();
        }
      },
      {
        id: "open-recent",
        title: "Open recent document",
        subtitle: "Switch to a recently opened PDF",
        glyph: "history",
        group: "navigation",
        keywords: ["recent open document"],
        onSelect: () => {
          openSelection(
            "Recent documents",
            recentDocumentItems,
            "No recent documents have been opened yet."
          );
        }
      },
      {
        id: "reopen-last",
        title: "Reopen last document",
        subtitle: latestAvailableRecentDocument?.title ?? "No available document in history yet",
        glyph: "history",
        group: "navigation",
        keywords: ["last recent reopen"],
        onSelect: async () => {
          if (!latestAvailableRecentDocument) {
            setStatusMessage("No available recent document is ready to reopen.");
            closePalette();
            return;
          }
          closePalette();
          await openDocumentById(latestAvailableRecentDocument.id);
        }
      },
      {
        id: "open-marks",
        title: "Open marks",
        subtitle:
          totalMarkCount > 0
            ? `${totalMarkCount} mark${totalMarkCount === 1 ? "" : "s"}`
            : "No marks in this document yet",
        glyph: "bookmark",
        group: "bookmarks",
        keywords: ["marks bookmark outline table contents headings sections"],
        onSelect: () => {
          closePalette();
          setOutlineOpen(true);
        }
      },
      {
        id: "bookmark-toggle",
        title: currentPageHasMark ? "Remove mark" : "Add mark",
        subtitle: `Page ${viewerSnapshot.currentPage}`,
        glyph: "bookmark",
        group: "bookmarks",
        keywords: ["mark bookmark save page"],
        onSelect: () => {
          const currentState = viewerApiRef.current?.getReaderState();
          if (!currentState) {
            closePalette();
            setStatusMessage("Open a document before editing marks.");
            return;
          }

          const existing = findBookmarkAtPage(currentState.bookmarks, viewerSnapshot.currentPage);
          viewerApiRef.current?.setBookmarks(
            existing
              ? currentState.bookmarks.filter((bookmark) => bookmark.id !== existing.id)
              : [...currentState.bookmarks, makeBookmark(viewerSnapshot.currentPage)]
          );
          setStatusMessage(
            existing
              ? `Removed mark from page ${viewerSnapshot.currentPage}.`
              : `Marked page ${viewerSnapshot.currentPage}.`
          );
          closePalette();
        }
      },
      {
        id: "bookmark-jump",
        title: "Jump to mark",
        subtitle:
          totalMarkCount > 0
            ? `${savedMarkCount} saved, ${sectionMarkCount} section${sectionMarkCount === 1 ? "" : "s"}`
            : "No marks in this document yet",
        glyph: "bookmark",
        group: "bookmarks",
        keywords: ["mark bookmark jump outline section heading"],
        onSelect: () => {
          openSelection("Marks", markItems, "No marks in this document yet.");
        }
      },
      ...libraryCommands
    ] satisfies PaletteItem[];

    if (workspaceMode === "book") {
      return documentCommands;
    }

    return [
      ...documentCommands.slice(0, -libraryCommands.length),
      ...noteCommands,
      ...libraryCommands
    ] satisfies PaletteItem[];
  }, [
    closePalette,
    copyAllNoteText,
    createStandaloneNote,
    libraryRoot,
    noteTitle,
    openNotesNavigation,
    openDocumentById,
    openLibraryFolder,
    openPrompt,
    openSearch,
    openSelection,
    outlineItems,
    promptImportFlow,
    readerState,
    recentDocuments,
    renameNote,
    rescanLibraryFlow,
    setOutlineOpen,
    setStatusMessage,
    viewerApiRef,
    viewerOrStatus,
    viewerSnapshot,
    workspaceMode
  ]);
}
