import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import CommandPalette, { type PaletteSession } from "./components/CommandPalette";
import LibraryOverlay from "./components/LibraryOverlay";
import OutlineOverlay from "./components/OutlineOverlay";
import PdfViewer from "./components/PdfViewer";
import {
  createFolder,
  importPdf,
  listLibrary,
  listRecentDocuments,
  moveDocument,
  openDocument,
  saveDocumentState
} from "./lib/api";
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

function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
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

  async function refreshLibraryState() {
    const [tree, recents] = await Promise.all([listLibrary(), listRecentDocuments()]);
    setLibraryTree(tree);
    setRecentDocuments(sortRecentDocuments(recents));
  }

  useEffect(() => {
    void refreshLibraryState().catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : "Unable to load library.");
    });
  }, []);

  useEffect(() => {
    if (!activeDocument || !readerState) {
      return;
    }
    if (activeDocument.document.id !== readerState.documentId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveDocumentState(activeDocument.document.id, readerState).catch((error) => {
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

  async function handleOpenDocument(documentId: string) {
    const payload = await openDocument(documentId);
    setActiveDocument(payload);
    setReaderState(payload.state);
    setCurrentFolderId(payload.document.folderId);
    setStatusMessage(`Opened ${payload.document.title}.`);
    setLibraryOpen(false);
    setOutlineOpen(false);
    await refreshLibraryState();
  }

  function closePalette() {
    setPaletteOpen(false);
    setPaletteSession(null);
  }

  function openCommands(items: PaletteItem[]) {
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
      return;
    }

    if (folderOptions.length === 0) {
      const record = await importPdf(selection, ROOT_FOLDER_ID);
      await handleOpenDocument(record.id);
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
          await handleOpenDocument(record.id);
        }
      })),
      "Create a folder first or import into Library."
    );
  }

  async function createFolderFlow() {
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
          await handleOpenDocument(moved.id);
        }
      })),
      "There is no other folder available yet."
    );
  }

  function recentDocumentItems() {
    return recentDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      subtitle: document.lastOpenedAt
        ? new Date(document.lastOpenedAt).toLocaleString()
        : "Never opened",
      onSelect: async () => {
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

  const commandRegistry: PaletteItem[] = [
    {
      id: "import-pdf",
      title: "Import PDF",
      subtitle: "Copy a local PDF into the app library",
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
      subtitle: "Add a folder inside the managed document library",
      keywords: ["folder library create"],
      onSelect: async () => {
        await createFolderFlow();
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
      id: "open-library",
      title: "Open library browser",
      subtitle: "Browse folders and stored PDFs",
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
      subtitle: recentDocuments[0]?.title ?? "No document in history yet",
      keywords: ["last recent reopen"],
      onSelect: async () => {
        if (!recentDocuments[0]) {
          setStatusMessage("No recent document is available yet.");
          closePalette();
          return;
        }
        closePalette();
        await handleOpenDocument(recentDocuments[0].id);
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
      const isCommand = event.ctrlKey || event.metaKey;

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
        viewerApiRef.current?.nextPage();
      }

      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        viewerApiRef.current?.previousPage();
      }

      if (isCommand && event.key === "=") {
        event.preventDefault();
        viewerApiRef.current?.zoomIn();
      }

      if (isCommand && event.key === "-") {
        event.preventDefault();
        viewerApiRef.current?.zoomOut();
      }

      if (isCommand && event.key === "0") {
        event.preventDefault();
        viewerApiRef.current?.resetZoom();
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
          filePath={activeDocument?.filePath ?? null}
          initialState={readerState}
          onSnapshotChange={(snapshot) => {
            setViewerSnapshot(snapshot);
            setReaderState((current) => {
              if (!current) {
                return current;
              }
              if (activeDocument && current.documentId !== activeDocument.document.id) {
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
          }}
          onOutlineChange={setOutlineItems}
          onStatusChange={setStatusMessage}
          registerApi={(api) => {
            viewerApiRef.current = api;
          }}
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
