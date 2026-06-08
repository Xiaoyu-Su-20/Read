import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useMemo } from "react";

import { findBookmarkAtPage, formatShortcut } from "../commands";
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
  libraryRoot: string;
  recentDocuments: DocumentRecord[];
  activeDocument: DocumentPayload | null;
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
  moveDocumentFlow: () => void;
  removeFromLibraryFlow: () => Promise<void>;
  rescanLibraryFlow: () => Promise<void>;
  openLibraryFolder: () => Promise<void>;
  openDocumentById: (documentId: string) => Promise<void>;
  showDocumentInExplorer: (documentId: string) => Promise<void>;
  showFolderInExplorer: (folderId?: string) => Promise<void>;
};

export function useCommandRegistry({
  libraryRoot,
  recentDocuments,
  activeDocument,
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
  moveDocumentFlow,
  removeFromLibraryFlow,
  rescanLibraryFlow,
  openLibraryFolder,
  openDocumentById,
  showDocumentInExplorer,
  showFolderInExplorer
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

    const bookmarkItems = (readerState?.bookmarks ?? []).map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.label,
      subtitle: `Page ${bookmark.page}`,
      onSelect: async () => {
        viewerApiRef.current?.goToPage(bookmark.page);
        closePalette();
      }
    }));

    return [
      {
        id: "import-pdf",
        title: "Import PDF",
        subtitle: "Copy a local PDF into a collection",
        meta: formatShortcut(["Tab"]),
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
        keywords: ["rescan refresh sync explorer"],
        onSelect: async () => {
          closePalette();
          await rescanLibraryFlow();
        }
      },
      {
        id: "move-document",
        title: "Move document to collection",
        subtitle: activeDocument?.document.title ?? "Open a PDF first",
        keywords: ["move folder collection"],
        onSelect: async () => {
          moveDocumentFlow();
        }
      },
      {
        id: "show-in-explorer",
        title: "Show in File Explorer",
        subtitle: activeDocument?.document.fileName ?? "Open the current library folder",
        keywords: ["explorer reveal show file folder"],
        onSelect: async () => {
          closePalette();
          if (activeDocument) {
            await showDocumentInExplorer(activeDocument.document.id);
            return;
          }
          await showFolderInExplorer(selectedCollection?.folder.id);
        }
      },
      {
        id: "remove-from-library",
        title: "Remove from library",
        subtitle: "Move the current PDF out of the library without deleting it",
        keywords: ["remove library move out keep file"],
        onSelect: async () => {
          closePalette();
          await removeFromLibraryFlow();
        }
      },
      {
        id: "open-recent",
        title: "Open recent document",
        subtitle: "Switch to a recently opened PDF",
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
        id: "find",
        title: "Find in document",
        subtitle: "Search text in the current PDF",
        keywords: ["search find text"],
        onSelect: () => {
          const viewer = viewerOrStatus();
          if (!viewer) {
            closePalette();
            return;
          }
          openPrompt("Find in document", "Search text", "Search", async (value) => {
            await viewer.search(value);
          });
        }
      },
      {
        id: "go-to-page",
        title: "Go to page",
        subtitle: `Current page ${viewerSnapshot.currentPage}`,
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
        id: "toggle-outline",
        title: "Toggle outline panel",
        subtitle: outlineItems.length > 0 ? "Show the document map" : "No outline found",
        keywords: ["outline table contents headings"],
        onSelect: () => {
          closePalette();
          setOutlineOpen((value) => !value);
        }
      },
      {
        id: "bookmark-toggle",
        title: findBookmarkAtPage(readerState?.bookmarks ?? [], viewerSnapshot.currentPage)
          ? "Remove bookmark"
          : "Add bookmark",
        subtitle: `Page ${viewerSnapshot.currentPage}`,
        keywords: ["bookmark save page"],
        onSelect: () => {
          const currentState = viewerApiRef.current?.getReaderState();
          if (!currentState) {
            closePalette();
            setStatusMessage("Open a document before editing bookmarks.");
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
              ? `Removed bookmark from page ${viewerSnapshot.currentPage}.`
              : `Bookmarked page ${viewerSnapshot.currentPage}.`
          );
          closePalette();
        }
      },
      {
        id: "bookmark-jump",
        title: "Jump to bookmark",
        subtitle: `${readerState?.bookmarks.length ?? 0} saved pages`,
        keywords: ["bookmark jump"],
        onSelect: () => {
          openSelection(
            "Bookmarks",
            bookmarkItems,
            "No bookmarks have been saved in this document yet."
          );
        }
      }
    ] satisfies PaletteItem[];
  }, [
    activeDocument,
    closePalette,
    libraryRoot,
    openDocumentById,
    openLibraryFolder,
    openPrompt,
    openSelection,
    outlineItems,
    promptImportFlow,
    readerState,
    recentDocuments,
    removeFromLibraryFlow,
    rescanLibraryFlow,
    selectedCollection,
    setOutlineOpen,
    setStatusMessage,
    showDocumentInExplorer,
    showFolderInExplorer,
    moveDocumentFlow,
    viewerApiRef,
    viewerOrStatus,
    viewerSnapshot
  ]);
}
