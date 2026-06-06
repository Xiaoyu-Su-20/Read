import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import CommandPalette, { type PaletteSession } from "./components/CommandPalette";
import LibraryOverlay from "./components/LibraryOverlay";
import OutlineOverlay from "./components/OutlineOverlay";
import PdfViewer from "./components/PdfViewer";
import {
  createFolder,
  getLibraryRoot,
  importPdf,
  listLibrary,
  listRecentDocuments,
  moveDocument,
  openLibraryFolder,
  openDocument,
  removeFromLibrary,
  renameDocument,
  renameFolder,
  rescanLibrary,
  saveDocumentState,
  showDocumentInExplorer,
  showFolderInExplorer
} from "./lib/api";
import { debugAction, runDebugProcess, startDebugProcess } from "./lib/debugLog";
import { findBookmarkAtPage, formatShortcut, sortRecentDocuments } from "./lib/commands";
import { flattenFolders } from "./lib/tree";
import type {
  DocumentPayload,
  DocumentRecord,
  DocumentState,
  OutlineItem,
  PaletteItem,
  ViewerApi,
  ViewerSnapshot
} from "./lib/types";
import { ROOT_FOLDER_ID } from "./lib/types";

function bookmarkSignature(bookmarks: DocumentState["bookmarks"]) {
  return bookmarks.map((bookmark) => `${bookmark.id}:${bookmark.page}`).join("|");
}

function now() {
  return new Date().toISOString();
}

function makeBookmark(page: number) {
  return {
    id: `bookmark-${page}-${Date.now()}`,
    page,
    label: `Page ${page}`,
    createdAt: now()
  };
}

const appWindow = getCurrentWindow();

function isPassiveStatusMessage(message: string) {
  return (
    message === "Ready" ||
    message === "Open a document to use reader commands." ||
    /^Opened \d+ pages\.$/.test(message)
  );
}

function ChromeIcon({
  children,
  label
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span className="sidebar__icon" aria-hidden="true" title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        {children}
      </svg>
    </span>
  );
}

export default function App() {
  const [libraryTree, setLibraryTree] = useState<Awaited<ReturnType<typeof listLibrary>> | null>(
    null
  );
  const [libraryRoot, setLibraryRootPath] = useState<string>("");
  const [recentDocuments, setRecentDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentPayload | null>(null);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);
  const [viewerSnapshot, setViewerSnapshot] = useState<ViewerSnapshot>({
    currentPage: 1,
    pageCount: 0,
    zoom: 1
  });
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteSession, setPaletteSession] = useState<PaletteSession | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID);

  const viewerApiRef = useRef<ViewerApi | null>(null);
  const activeDocumentId = activeDocument?.document.id ?? null;

  function resetOpenDocument() {
    debugAction("app.reset-open-document");
    setActiveDocument(null);
    setReaderState(null);
    setOutlineItems([]);
    setViewerSnapshot({
      currentPage: 1,
      pageCount: 0,
      zoom: 1
    });
  }

  async function refreshLibraryState(options?: { rescan?: boolean }) {
    return runDebugProcess(
      "app.refresh-library-state",
      {
        rescan: Boolean(options?.rescan)
      },
      async () => {
        const tree = await (options?.rescan ? rescanLibrary() : listLibrary());
        const [recents, root] = await Promise.all([listRecentDocuments(), getLibraryRoot()]);
        setLibraryTree(tree);
        setRecentDocuments(sortRecentDocuments(recents));
        setLibraryRootPath(root);
      }
    );
  }

  async function refreshRecentDocuments() {
    return runDebugProcess("app.refresh-recent-documents", {}, async () => {
      const recents = await listRecentDocuments();
      setRecentDocuments(sortRecentDocuments(recents));
    });
  }

  useEffect(() => {
    void refreshLibraryState().catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : "Unable to load library.");
    });
  }, []);

  useEffect(() => {
    if (!libraryTree) {
      return;
    }

    const folders = flattenFolders(libraryTree);
    if (!folders.some((folder) => folder.id === currentFolderId)) {
      setCurrentFolderId(ROOT_FOLDER_ID);
    }
  }, [currentFolderId, libraryTree]);

  useEffect(() => {
    if (!activeDocument || !readerState) {
      return;
    }
    if (activeDocument.document.id !== readerState.documentId) {
      return;
    }

    debugAction("reader-state.save-scheduled", {
      documentId: activeDocument.document.id,
      page: readerState.lastPage,
      zoom: readerState.zoom
    });

    const timeout = window.setTimeout(() => {
      const process = startDebugProcess("reader-state.save", {
        documentId: activeDocument.document.id,
        page: readerState.lastPage,
        zoom: readerState.zoom
      });
      void saveDocumentState(activeDocument.document.id, readerState)
        .then(() => {
          process.finish();
        })
        .catch((error) => {
          process.fail(error);
          setStatusMessage(
            error instanceof Error ? error.message : String(error || "Unable to save reader state.")
          );
        });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [
    activeDocument?.document.id,
    bookmarkSignature(readerState?.bookmarks ?? []),
    readerState?.lastPage,
    readerState?.preferences.fitMode,
    readerState?.zoom
  ]);

  const folderOptions = useMemo(() => {
    if (!libraryTree) {
      return [];
    }
    return flattenFolders(libraryTree);
  }, [libraryTree]);

  const handleViewerSnapshotChange = useCallback(
    (snapshot: ViewerSnapshot) => {
      setViewerSnapshot(snapshot);
      setReaderState((current) => {
        if (!current) {
          return current;
        }
        if (activeDocumentId && current.documentId !== activeDocumentId) {
          return current;
        }
        if (
          current.lastPage === snapshot.currentPage &&
          Math.abs(current.zoom - snapshot.zoom) < 0.001
        ) {
          return current;
        }
        return {
          ...current,
          lastPage: snapshot.currentPage,
          zoom: snapshot.zoom,
          lastOpenedAt: now()
        };
      });
    },
    [activeDocumentId]
  );

  const handleViewerOutlineChange = useCallback((items: OutlineItem[]) => {
    setOutlineItems(items);
  }, []);

  const handleViewerStatusChange = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const registerViewerApi = useCallback((api: ViewerApi | null) => {
    viewerApiRef.current = api;
  }, []);

  async function syncActiveDocument() {
    if (!activeDocument) {
      return;
    }

    try {
      await runDebugProcess(
        "app.sync-active-document",
        {
          documentId: activeDocument.document.id
        },
        async () => {
          const payload = await openDocument(activeDocument.document.id);
          setActiveDocument(payload);
          setReaderState(payload.state);
          setCurrentFolderId(payload.document.folderId);
          await refreshRecentDocuments();
        }
      );
    } catch {
      resetOpenDocument();
    }
  }

  async function handleOpenDocument(documentId: string, options?: { refreshLibrary?: boolean }) {
    await runDebugProcess(
      "app.open-document",
      {
        documentId,
        refreshLibrary: Boolean(options?.refreshLibrary)
      },
      async () => {
        const payload = await openDocument(documentId);
        setActiveDocument(payload);
        setReaderState(payload.state);
        setCurrentFolderId(payload.document.folderId);
        setStatusMessage(`Opened ${payload.document.title}.`);
        setLibraryOpen(false);
        setOutlineOpen(false);
        if (options?.refreshLibrary) {
          await refreshLibraryState();
        } else {
          await refreshRecentDocuments();
        }
      }
    );
  }

  function closePalette() {
    debugAction("palette.close");
    setPaletteOpen(false);
    setPaletteSession(null);
  }

  function openCommands(items: PaletteItem[]) {
    debugAction("palette.open-commands", {
      itemCount: items.length
    });
    setPaletteSession({
      kind: "commands",
      title: "Reader actions",
      query: "",
      items,
      emptyMessage: "No command matches that search."
    });
    setPaletteOpen(true);
  }

  function openSelection(title: string, items: PaletteItem[], emptyMessage: string) {
    debugAction("palette.open-selection", {
      title,
      itemCount: items.length
    });
    setPaletteSession({
      kind: "select",
      title,
      query: "",
      items,
      emptyMessage
    });
    setPaletteOpen(true);
  }

  function openPrompt(
    title: string,
    placeholder: string,
    confirmLabel: string,
    onSubmit: (value: string) => void | Promise<void>,
    initialValue = ""
  ) {
    debugAction("palette.open-prompt", {
      title
    });
    setPaletteSession({
      kind: "input",
      title,
      query: initialValue,
      placeholder,
      confirmLabel,
      onSubmit: async (value) => {
        await onSubmit(value);
        closePalette();
      }
    });
    setPaletteOpen(true);
  }

  async function promptImportFlow() {
    const process = startDebugProcess("app.prompt-import-flow");
    const selection = await open({
      multiple: false,
      filters: [
        {
          name: "PDF",
          extensions: ["pdf"]
        }
      ]
    });

    if (typeof selection !== "string") {
      process.finish({
        selected: false
      });
      return;
    }

    if (folderOptions.length === 0) {
      const record = await importPdf(selection, ROOT_FOLDER_ID);
      await handleOpenDocument(record.id, { refreshLibrary: true });
      process.finish({
        selected: true,
        destinationFolderId: ROOT_FOLDER_ID
      });
      return;
    }

    openSelection(
      "Import into folder",
      folderOptions.map((folder) => ({
        id: folder.id,
        title: folder.pathLabel,
        subtitle: folder.id === ROOT_FOLDER_ID ? "Library root" : "Library folder",
        onSelect: async () => {
          const record = await importPdf(selection, folder.id);
          closePalette();
          await handleOpenDocument(record.id, { refreshLibrary: true });
        }
      })),
      "Create a folder first or import into Library."
    );
    process.finish({
      selected: true,
      deferredSelection: true
    });
  }

  async function createFolderFlow() {
    debugAction("library.create-folder-flow", {
      currentFolderId
    });
    openPrompt("Create folder", "Folder name", "Create folder", async (value) => {
      const folder = await createFolder(value, currentFolderId || ROOT_FOLDER_ID);
      await refreshLibraryState();
      setCurrentFolderId(folder.id);
      setLibraryOpen(true);
      setStatusMessage(`Created ${folder.name}.`);
    });
  }

  async function moveDocumentFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before moving it.");
      return;
    }

    debugAction("library.move-document-flow", {
      documentId: activeDocument.document.id
    });

    const availableDestinations = folderOptions.filter(
      (folder) => folder.id !== activeDocument.document.folderId
    );

    openSelection(
      "Move document to folder",
      availableDestinations.map((folder) => ({
        id: folder.id,
        title: folder.pathLabel,
        subtitle: activeDocument.document.title,
        onSelect: async () => {
          const moved = await moveDocument(activeDocument.document.id, folder.id);
          closePalette();
          await handleOpenDocument(moved.id, { refreshLibrary: true });
        }
      })),
      "There is no other folder available yet."
    );
  }

  async function renameDocumentFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before renaming it.");
      return;
    }

    debugAction("library.rename-document-flow", {
      documentId: activeDocument.document.id
    });

    openPrompt(
      "Rename document",
      "New PDF name",
      "Rename",
      async (value) => {
        const renamed = await renameDocument(activeDocument.document.id, value);
        await handleOpenDocument(renamed.id, { refreshLibrary: true });
        setStatusMessage(`Renamed to ${renamed.fileName}.`);
      },
      activeDocument.document.fileName
    );
  }

  async function renameFolderFlow() {
    if (currentFolderId === ROOT_FOLDER_ID) {
      setStatusMessage("Select a folder before renaming it.");
      return;
    }

    debugAction("library.rename-folder-flow", {
      folderId: currentFolderId
    });

    const currentFolder = folderOptions.find((folder) => folder.id === currentFolderId);
    openPrompt(
      "Rename folder",
      "New folder name",
      "Rename",
      async (value) => {
        const renamed = await renameFolder(currentFolderId, value);
        await refreshLibraryState({ rescan: true });
        setCurrentFolderId(renamed.id);
        await syncActiveDocument();
        setStatusMessage(`Renamed folder to ${renamed.name}.`);
      },
      currentFolder?.name ?? ""
    );
  }

  async function removeFromLibraryFlow() {
    if (!activeDocument) {
      setStatusMessage("Open a document before removing it from the library.");
      return;
    }

    const process = startDebugProcess("library.remove-from-library-flow", {
      documentId: activeDocument.document.id
    });

    const selection = await open({
      directory: true,
      multiple: false
    });

    if (typeof selection !== "string") {
      process.finish({
        selected: false
      });
      return;
    }

    await removeFromLibrary(activeDocument.document.id, selection);
    resetOpenDocument();
    await refreshLibraryState({ rescan: true });
    setStatusMessage("Moved the PDF out of the library without deleting it.");
    process.finish({
      selected: true
    });
  }

  async function rescanLibraryFlow() {
    await runDebugProcess("library.rescan-flow", {}, async () => {
      await refreshLibraryState({ rescan: true });
      await syncActiveDocument();
      setStatusMessage("Rescanned the library.");
    });
  }

  function recentDocumentItems() {
    return recentDocuments.map((document) => ({
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
        await handleOpenDocument(document.id);
      }
    }));
  }

  function viewerOrStatus() {
    if (!viewerApiRef.current) {
      setStatusMessage("Open a document to use reader commands.");
      return null;
    }
    return viewerApiRef.current;
  }

  function bookmarkItems() {
    return (readerState?.bookmarks ?? []).map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.label,
      subtitle: `Page ${bookmark.page}`,
      onSelect: async () => {
        viewerApiRef.current?.goToPage(bookmark.page);
        closePalette();
      }
    }));
  }

  const latestAvailableRecentDocument = recentDocuments.find(
    (document) => document.availability === "available"
  );

  const commandRegistry: PaletteItem[] = [
    {
      id: "import-pdf",
      title: "Import PDF",
      subtitle: "Copy a local PDF into the selected library folder",
      meta: formatShortcut(["Tab"]),
      keywords: ["open file add pdf import"],
      onSelect: async () => {
        closePalette();
        await promptImportFlow();
      }
    },
    {
      id: "create-folder",
      title: "Create library folder",
      subtitle: "Add a folder inside the Reader library",
      keywords: ["folder library create"],
      onSelect: async () => {
        await createFolderFlow();
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
      title: "Move document to folder",
      subtitle: activeDocument?.document.title ?? "Open a PDF first",
      keywords: ["move folder"],
      onSelect: async () => {
        await moveDocumentFlow();
      }
    },
    {
      id: "rename-document",
      title: "Rename document",
      subtitle: activeDocument?.document.fileName ?? "Open a PDF first",
      keywords: ["rename file pdf"],
      onSelect: async () => {
        await renameDocumentFlow();
      }
    },
    {
      id: "rename-folder",
      title: "Rename folder",
      subtitle:
        currentFolderId === ROOT_FOLDER_ID
          ? "Select a library folder first"
          : folderOptions.find((folder) => folder.id === currentFolderId)?.pathLabel ??
            "Rename the current folder",
      keywords: ["rename folder collection"],
      onSelect: async () => {
        await renameFolderFlow();
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
        await showFolderInExplorer(currentFolderId);
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
      id: "open-library",
      title: "Open library browser",
      subtitle: "Browse the folder structure under the library root",
      keywords: ["library folders browse"],
      onSelect: () => {
        closePalette();
        setLibraryOpen(true);
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
          recentDocumentItems(),
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
        await handleOpenDocument(latestAvailableRecentDocument.id);
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
        if (!readerState) {
          closePalette();
          setStatusMessage("Open a document before editing bookmarks.");
          return;
        }

        const existing = findBookmarkAtPage(
          readerState.bookmarks,
          viewerSnapshot.currentPage
        );
        setReaderState((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            lastOpenedAt: now(),
            bookmarks: existing
              ? current.bookmarks.filter((bookmark) => bookmark.id !== existing.id)
              : [...current.bookmarks, makeBookmark(viewerSnapshot.currentPage)]
          };
        });
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
          bookmarkItems(),
          "No bookmarks have been saved in this document yet."
        );
      }
    }
  ];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        !paletteOpen &&
        !libraryOpen &&
        !outlineOpen
      ) {
        event.preventDefault();
        openCommands(commandRegistry);
        return;
      }

      if (event.key === "Escape") {
        closePalette();
        setLibraryOpen(false);
        setOutlineOpen(false);
        return;
      }

      if (paletteOpen) {
        return;
      }

      if (event.key === "PageDown" || event.key === "ArrowRight") {
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "next"
        });
        viewerApiRef.current?.nextPage();
      }

      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "previous"
        });
        viewerApiRef.current?.previousPage();
      }

    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandRegistry, libraryOpen, outlineOpen, paletteOpen]);

  return (
    <main className="app-shell">
      <nav className="sidebar" aria-label="Navigation">
        <button
          className="sidebar__icon-button sidebar__icon-button--top"
          type="button"
          aria-label="Open commands"
          onClick={() => openCommands(commandRegistry)}
        >
          <ChromeIcon label="Menu">
            <path d="M5 7.5h14" />
            <path d="M5 12h14" />
            <path d="M5 16.5h14" />
          </ChromeIcon>
        </button>

        <div className="sidebar__stack">
          <button className="sidebar__icon-button" type="button" aria-label="Documents">
            <ChromeIcon label="Documents">
              <path d="M8 3.5h6l4 4V20a.5.5 0 0 1-.5.5h-9A1.5 1.5 0 0 1 7 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
              <path d="M14 3.5V8h4" />
              <path d="M10 12h4" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Annotate">
            <ChromeIcon label="Annotate">
              <path d="M4 20h4l10-10-4-4L4 16v4Z" />
              <path d="m12.5 7.5 4 4" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Search">
            <ChromeIcon label="Search">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Bookmarks">
            <ChromeIcon label="Bookmarks">
              <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Download">
            <ChromeIcon label="Download">
              <path d="M12 4v10" />
              <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
              <path d="M5 19.5h14" />
            </ChromeIcon>
          </button>
        </div>

        <button className="sidebar__icon-button sidebar__icon-button--bottom" type="button" aria-label="Settings">
          <ChromeIcon label="Settings">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.8v2.1" />
            <path d="M12 19.1v2.1" />
            <path d="m4.9 4.9 1.5 1.5" />
            <path d="m17.6 17.6 1.5 1.5" />
            <path d="M2.8 12h2.1" />
            <path d="M19.1 12h2.1" />
            <path d="m4.9 19.1 1.5-1.5" />
            <path d="m17.6 6.4 1.5-1.5" />
          </ChromeIcon>
        </button>
      </nav>

      <header className="topbar">
        <div className="topbar__drag" data-tauri-drag-region>
          <div className="topbar__brand" data-tauri-drag-region>
            <strong>{activeDocument?.document.title ?? "Library"}</strong>
          </div>
          <div className="topbar__status" data-tauri-drag-region>
            <span>
              {viewerSnapshot.pageCount > 0
                ? `${viewerSnapshot.currentPage} / ${viewerSnapshot.pageCount}`
                : "No document open"}
            </span>
            {!isPassiveStatusMessage(statusMessage) ? <span>{statusMessage}</span> : null}
          </div>
        </div>
        <div className="window-controls">
          <button
            className="window-control"
            type="button"
            aria-label="Minimize window"
            onClick={() => {
              void appWindow.minimize();
            }}
          >
            <svg
              className="window-control__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M6 12.5h12" />
            </svg>
          </button>
          <button
            className="window-control"
            type="button"
            aria-label="Toggle maximize window"
            onClick={() => {
              void appWindow.toggleMaximize();
            }}
          >
            <svg
              className="window-control__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="6.5" y="6.5" width="11" height="11" rx="1" />
            </svg>
          </button>
          <button
            className="window-control window-control--close"
            type="button"
            aria-label="Close window"
            onClick={() => {
              void appWindow.close();
            }}
          >
            <svg
              className="window-control__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m7 7 10 10" />
              <path d="m17 7-10 10" />
            </svg>
          </button>
        </div>
      </header>

      <section className="workspace">
        <PdfViewer
          documentId={activeDocument?.document.id ?? null}
          initialState={readerState}
          onSnapshotChange={handleViewerSnapshotChange}
          onOutlineChange={handleViewerOutlineChange}
          onStatusChange={handleViewerStatusChange}
          registerApi={registerViewerApi}
        />
      </section>

      <CommandPalette
        open={paletteOpen}
        session={paletteSession}
        onClose={closePalette}
        onChangeQuery={(query) => {
          setPaletteSession((current) => (current ? { ...current, query } : current));
        }}
      />

      <LibraryOverlay
        open={libraryOpen}
        tree={libraryTree}
        currentFolderId={currentFolderId}
        onClose={() => setLibraryOpen(false)}
        onSelectFolder={setCurrentFolderId}
        onOpenDocument={(document) => {
          void handleOpenDocument(document.id);
        }}
      />

      <OutlineOverlay
        open={outlineOpen}
        items={outlineItems}
        onClose={() => setOutlineOpen(false)}
        onSelect={(item) => {
          viewerApiRef.current?.jumpToOutline(item);
          setOutlineOpen(false);
        }}
      />
    </main>
  );
}
