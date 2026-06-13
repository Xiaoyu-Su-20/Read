import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import CommandPalette from "./components/CommandPalette";
import CollectionView from "./components/CollectionView";
import OutlineOverlay from "./components/OutlineOverlay";
import ReaderWorkspace from "./components/ReaderWorkspace";
import {
  openLibraryFolder,
  showDocumentInExplorer,
  showFolderInExplorer
} from "./lib/api";
import { isPassiveStatusMessage } from "./lib/app/helpers";
import { useCommandRegistry } from "./lib/app/useCommandRegistry";
import { useLibraryFlows } from "./lib/app/useLibraryFlows";
import { useNotesController } from "./lib/app/useNotesController";
import { usePaletteController } from "./lib/app/usePaletteController";
import { useWorkspaceController } from "./lib/app/useWorkspaceController";

const appWindow = getCurrentWindow();

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function shouldStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return !target.closest(
    "button, input, textarea, select, [contenteditable='true'], [data-no-window-drag]"
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        {children}
      </svg>
    </span>
  );
}

export default function App() {
  const workspace = useWorkspaceController();
  const notes = useNotesController({
    activeDocument: workspace.activeDocument,
    setStatusMessage: workspace.setStatusMessage
  });
  const palette = usePaletteController();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
  const flows = useLibraryFlows({
    libraryTree: workspace.libraryTree,
    collectionOptions: workspace.collectionOptions,
    activeDocument: workspace.activeDocument,
    selectedCollection: workspace.selectedCollection,
    closePalette: palette.closePalette,
    openSelection: palette.openSelection,
    openPrompt: palette.openPrompt,
    setStatusMessage: workspace.setStatusMessage,
    createCollection: workspace.createCollection,
    importDocumentToCollection: workspace.importDocumentToCollection,
    moveActiveDocument: workspace.moveActiveDocument,
    renameActiveDocument: workspace.renameActiveDocument,
    renameCollection: workspace.renameCollection,
    removeActiveDocument: workspace.removeActiveDocument,
    rescanLibraryState: workspace.rescanLibraryState
  });

  const commandRegistry = useCommandRegistry({
    libraryRoot: workspace.libraryRoot,
    recentDocuments: workspace.recentDocuments,
    activeDocument: workspace.activeDocument,
    readerState: workspace.readerState,
    viewerSnapshot: workspace.viewerSnapshot,
    outlineItems: workspace.outlineItems,
    selectedCollection: workspace.selectedCollection,
    viewerApiRef: workspace.viewerApiRef,
    closePalette: palette.closePalette,
    openSelection: palette.openSelection,
    openPrompt: palette.openPrompt,
    setStatusMessage: workspace.setStatusMessage,
    setOutlineOpen,
    viewerOrStatus: workspace.viewerOrStatus,
    promptImportFlow: flows.promptImportFlow,
    moveDocumentFlow: flows.moveDocumentFlow,
    removeFromLibraryFlow: flows.removeFromLibraryFlow,
    rescanLibraryFlow: flows.rescanLibraryFlow,
    openLibraryFolder,
    openDocumentById: async (documentId) => {
      setOutlineOpen(false);
      await workspace.handleOpenDocument(documentId);
    },
    showDocumentInExplorer,
    showFolderInExplorer
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const originatedFromEditable = isEditableTarget(event.target);

      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        !palette.paletteOpen &&
        !outlineOpen &&
        !originatedFromEditable
      ) {
        event.preventDefault();
        palette.openCommands(commandRegistry);
        return;
      }

      if (event.key === "Escape") {
        palette.closePalette();
        setOutlineOpen(false);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commandRegistry,
    outlineOpen,
    palette.closePalette,
    palette.openCommands,
    palette.paletteOpen,
    workspace.workspaceMode
  ]);

  useEffect(() => {
    function suppressNativeContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    window.addEventListener("contextmenu", suppressNativeContextMenu, true);
    return () => {
      window.removeEventListener("contextmenu", suppressNativeContextMenu, true);
    };
  }, []);

  useEffect(() => {
    setOutlineOpen(false);
  }, [workspace.activeDocumentId]);

  useEffect(() => {
    let disposed = false;
    let unlistenResize: (() => void) | undefined;

    async function syncWindowLayoutState() {
      try {
        const [maximized, fullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen()
        ]);
        if (!disposed) {
          setIsWindowMaximized(maximized);
          setIsWindowFullscreen(fullscreen);
        }
      } catch (error) {
        console.error("Failed to read window maximize state:", error);
      }
    }

    void syncWindowLayoutState();

    void appWindow.onResized(() => {
      void syncWindowLayoutState();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenResize = unlisten;
    });

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, []);

  const topbarTitle =
    workspace.workspaceMode === "collection"
      ? workspace.selectedCollection?.folder.name ?? "Library"
      : workspace.activeDocument?.document.title ?? "Library";
  const topbarStatus =
    workspace.workspaceMode === "collection"
      ? workspace.selectedCollection
        ? `${workspace.selectedCollection.documents.length} books`
        : "No collection selected"
      : workspace.viewerSnapshot.pageCount > 0
        ? `${workspace.viewerSnapshot.currentPage} / ${workspace.viewerSnapshot.pageCount}`
        : "No document open";

  function handleTopbarMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    if (!shouldStartWindowDrag(event.target)) {
      return;
    }

    appWindow.startDragging().catch((error) => {
      console.error("startDragging failed:", error);
    });
  }

  return (
    <main
      className={`app-shell${
        isWindowMaximized && !isWindowFullscreen ? " app-shell--maximized" : ""
      }`}
    >
      <nav
        className={`sidebar${workspace.workspaceMode === "reader" ? " sidebar--reader" : ""}`}
        aria-label="Navigation"
      >
        <button
          className="sidebar__icon-button sidebar__icon-button--top"
          type="button"
          aria-label="Open commands"
          onClick={() => palette.openCommands(commandRegistry)}
        >
          <ChromeIcon label="Menu">
            <path d="M5 7.5h14" />
            <path d="M5 12h14" />
            <path d="M5 16.5h14" />
          </ChromeIcon>
        </button>

        <div className="sidebar__stack">
          <button
            className={`sidebar__icon-button${
              workspace.workspaceMode === "collection" ? " sidebar__icon-button--active" : ""
            }`}
            type="button"
            aria-label="Collections"
            onClick={() => {
              workspace.setWorkspaceMode("collection");
            }}
          >
            <ChromeIcon label="Collections">
              <rect x="5" y="5" width="5.5" height="5.5" rx="1" fill="currentColor" stroke="none" />
              <rect x="13.5" y="5" width="5.5" height="5.5" rx="1" />
              <rect x="5" y="13.5" width="5.5" height="5.5" rx="1" />
              <rect x="13.5" y="13.5" width="5.5" height="5.5" rx="1" fill="currentColor" stroke="none" />
            </ChromeIcon>
          </button>
          <button
            className={`sidebar__icon-button${
              workspace.workspaceMode === "reader" ? " sidebar__icon-button--active" : ""
            }`}
            type="button"
            aria-label="Reader"
            onClick={() => {
              workspace.setWorkspaceMode("reader");
            }}
          >
            <ChromeIcon label="Documents">
              <path d="M11.6 6.1c-1.2-.95-2.7-1.45-4.5-1.45H6.2c-.7 0-1.2.55-1.2 1.2v11.05c0 .7.58 1.25 1.28 1.22 1.95-.08 3.58.34 4.98 1.27.18.12.34.18.34.18Z" />
              <path d="M12.4 6.1c1.2-.95 2.7-1.45 4.5-1.45h.9c.7 0 1.2.55 1.2 1.2v11.05c0 .7-.58 1.25-1.28 1.22-1.95-.08-3.58.34-4.98 1.27-.18.12-.34.18-.34.18Z" />
              <path d="M12 6.15v13.2" />
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

      <header className="topbar" onMouseDown={handleTopbarMouseDown}>
        <div className="topbar__drag">
          <div className="topbar__brand">
            <strong>{topbarTitle}</strong>
          </div>
          <div className="topbar__status">
            <span>{topbarStatus}</span>
            {!isPassiveStatusMessage(workspace.statusMessage) ? (
              <span>{workspace.statusMessage}</span>
            ) : null}
          </div>
        </div>
        <div className="window-controls" data-no-window-drag>
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
        {workspace.workspaceMode === "collection" ? (
          <CollectionView
            tree={workspace.libraryTree}
            selectedCollectionId={workspace.selectedCollection?.folder.id ?? null}
            onSelectCollection={workspace.setSelectedCollectionId}
            onCreateCollection={flows.createCollectionFlow}
            onRenameCollection={async (collectionId, nextName) => {
              await workspace.renameCollection(collectionId, nextName);
            }}
            onDeleteCollection={async (collectionId) => {
              await workspace.deleteCollection(collectionId);
            }}
            onOpenDocument={async (documentId) => {
              setOutlineOpen(false);
              await workspace.handleOpenDocument(documentId);
            }}
            onRenameDocument={async (documentId, nextName) => {
              await workspace.renameDocumentInLibrary(documentId, nextName);
            }}
          />
        ) : (
          <ReaderWorkspace
            document={workspace.activeDocument}
            note={notes.note}
            notesLoading={notes.loading}
            noteNavigationItems={notes.navigationItems}
            onChangeNoteTitle={notes.updateTitle}
            onChangeNoteBlocks={notes.updateBlocks}
            onFlushNote={() => notes.flushNow("editor-blur")}
            onCopyAllNoteText={notes.copyAllText}
            onGoToNotePage={workspace.goToReaderPage}
            currentReaderPage={workspace.viewerSnapshot.currentPage}
            onSnapshotChange={workspace.handleViewerSnapshotChange}
            onOutlineChange={workspace.handleViewerOutlineChange}
            onStateChange={workspace.handleViewerStateChange}
            onStatusChange={workspace.handleViewerStatusChange}
            registerApi={workspace.registerViewerApi}
          />
        )}
      </section>

      <CommandPalette
        open={palette.paletteOpen}
        session={palette.paletteSession}
        onClose={palette.closePalette}
        onChangeQuery={palette.changeQuery}
      />

      <OutlineOverlay
        open={outlineOpen}
        items={workspace.outlineItems}
        onClose={() => setOutlineOpen(false)}
        onSelect={(item) => {
          workspace.viewerApiRef.current?.jumpToOutline(item);
          setOutlineOpen(false);
        }}
      />
    </main>
  );
}
