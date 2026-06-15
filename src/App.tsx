import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import CommandPalette from "./components/CommandPalette";
import CollectionView from "./components/CollectionView";
import DisplaySettingsPopover from "./components/DisplaySettingsPopover";
import OutlineOverlay from "./components/OutlineOverlay";
import ReaderWorkspace from "./components/ReaderWorkspace";
import UnifiedSearchOverlay from "./search/components/UnifiedSearchOverlay";
import { createUnifiedSearchController } from "./search";
import { openLibraryFolder } from "./lib/api";
import { isPassiveStatusMessage } from "./lib/app/helpers";
import {
  resetActiveDocumentAppearanceProfile,
  resetAllDocumentAppearanceSettings,
  toggleSharedDocumentAppearancePaper,
  updateDocumentAppearanceMode,
  updateDocumentAppearancePaperColor
} from "./lib/app/settingsRegistry";
import { useAppSettings } from "./lib/app/useAppSettings";
import { useCommandRegistry } from "./lib/app/useCommandRegistry";
import { useLibraryFlows } from "./lib/app/useLibraryFlows";
import { useNotesController } from "./lib/app/useNotesController";
import { usePaletteController } from "./lib/app/usePaletteController";
import { useWorkspaceController } from "./lib/app/useWorkspaceController";
import { collectDocuments } from "./lib/tree";

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

function isNotesTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(".notes-pane"));
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
  const { settings, selectors, setSetting } = useAppSettings();
  const palette = usePaletteController();
  const searchController = useMemo(() => createUnifiedSearchController(), []);
  const [noteRevealRequest, setNoteRevealRequest] = useState<import("./lib/types").NoteRevealRequest | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const searchableDocuments = useMemo(
    () => workspace.libraryTree ? collectDocuments(workspace.libraryTree) : [],
    [workspace.libraryTree]
  );
  const viewerDisplayConfig = selectors.viewerDisplayConfig(settings);
  const readerControlsEnabled =
    workspace.workspaceMode === "reader" && workspace.activeDocument !== null;

  useEffect(() => {
    searchController.setContext({
      currentPage: workspace.viewerSnapshot.currentPage,
      totalPages: workspace.viewerSnapshot.pageCount,
      activeDocumentId: workspace.activeDocumentId,
      currentNote: notes.note,
      documents: searchableDocuments,
      pdfPort: workspace.viewerApi?.searchPort ?? null
    });
  }, [
    notes.note,
    searchableDocuments,
    searchController,
    workspace.activeDocumentId,
    workspace.viewerApi,
    workspace.viewerSnapshot.currentPage,
    workspace.viewerSnapshot.pageCount
  ]);

  function openUnifiedSearch() {
    palette.closePalette();
    setOutlineOpen(false);
    setSettingsOpen(false);
    searchController.open();
  }
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
    rescanLibraryFlow: flows.rescanLibraryFlow,
    openLibraryFolder,
    openDocumentById: async (documentId) => {
      setOutlineOpen(false);
      await workspace.handleOpenDocument(documentId);
    },
    openSearch: openUnifiedSearch
  });

  useEffect(() => {
    let cancelled = false;
    let unlistenResized: (() => void) | null = null;
    let unlistenScaleChanged: (() => void) | null = null;
    let unlistenMoved: (() => void) | null = null;

    async function syncWindowChromeState() {
      try {
        const maximized = await appWindow.isMaximized();
        if (cancelled) {
          return;
        }
        document.documentElement.dataset.windowMaximized = maximized ? "true" : "false";
      } catch (error) {
        console.error("window chrome sync failed:", error);
      }
    }

    async function stabilizeStartupWindow() {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });

      if (cancelled) {
        return;
      }

      try {
        if (!(await appWindow.isMaximized())) {
          await appWindow.maximize();
        }
      } catch (error) {
        console.error("startup maximize failed:", error);
      }

      await syncWindowChromeState();

      try {
        [unlistenResized, unlistenScaleChanged, unlistenMoved] = await Promise.all([
          appWindow.onResized(() => {
            void syncWindowChromeState();
          }),
          appWindow.onScaleChanged(() => {
            void syncWindowChromeState();
          }),
          appWindow.onMoved(() => {
            void syncWindowChromeState();
          })
        ]);
      } catch (error) {
        console.error("window event subscription failed:", error);
      }
    }

    void stabilizeStartupWindow();

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.windowMaximized;
      unlistenResized?.();
      unlistenScaleChanged?.();
      unlistenMoved?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const originatedFromEditable = isEditableTarget(event.target);

      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        if (event.shiftKey) {
          event.preventDefault();
          openUnifiedSearch();
          return;
        }

        if (isNotesTarget(event.target)) {
          return;
        }

        event.preventDefault();
        openUnifiedSearch();
        return;
      }

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
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }

        palette.closePalette();
        searchController.close();
        setOutlineOpen(false);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    commandRegistry,
    outlineOpen,
    palette.closePalette,
    palette.openCommands,
    palette.paletteOpen,
    searchController,
    settingsOpen,
    workspace.workspaceMode
  ]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (settingsContainerRef.current?.contains(target)) {
        return;
      }

      setSettingsOpen(false);
    }

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
    };
  }, [settingsOpen]);

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
    <main className="app-shell">
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
              <path d="M12 7.45C10.35 5.9 8.42 5.23 6.1 5.23H4.45A1.16 1.16 0 0 0 3.29 6.39v10.26a1.16 1.16 0 0 0 1.16 1.16H6.1c2.32 0 4.25.68 5.9 2.23" />
              <path d="M12 7.45c1.65-1.55 3.58-2.22 5.9-2.22h1.65a1.16 1.16 0 0 1 1.16 1.16v10.26a1.16 1.16 0 0 1-1.16 1.16H17.9c-2.32 0-4.25.68-5.9 2.23" />
              <path d="M12 7.45v12.58" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Annotate">
            <ChromeIcon label="Annotate">
              <path d="M4 20h4l10-10-4-4L4 16v4Z" />
              <path d="m12.5 7.5 4 4" />
            </ChromeIcon>
          </button>
          <button className="sidebar__icon-button" type="button" aria-label="Search" onClick={openUnifiedSearch}>
            <ChromeIcon label="Search">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </ChromeIcon>
          </button>
          <button
            className={`sidebar__icon-button${outlineOpen ? " sidebar__icon-button--active" : ""}`}
            type="button"
            aria-label="Marks"
            onClick={() => setOutlineOpen((value) => !value)}
          >
            <ChromeIcon label="Marks">
              <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" />
            </ChromeIcon>
          </button>
        </div>

        <div ref={settingsContainerRef} className="sidebar__bottom-slot" data-no-window-drag>
          {settingsOpen ? (
            <DisplaySettingsPopover
              id="display-settings-popover"
              controlsDisabled={!readerControlsEnabled}
              settings={settings}
              onChangeDocumentAppearanceMode={(appearance) => {
                setSetting("documentAppearance", (currentValue) =>
                  updateDocumentAppearanceMode(currentValue, appearance)
                );
              }}
              onChangeDocumentPaperColor={(value) => {
                setSetting("documentAppearance", (currentValue) =>
                  updateDocumentAppearancePaperColor(currentValue, value)
                );
              }}
              onResetActiveDocumentAppearance={() => {
                setSetting("documentAppearance", (currentValue) =>
                  resetActiveDocumentAppearanceProfile(currentValue)
                );
              }}
              onResetAllDocumentAppearance={() => {
                setSetting("documentAppearance", (currentValue) =>
                  resetAllDocumentAppearanceSettings(currentValue.mode)
                );
              }}
              onToggleSharedDocumentPaperColor={() => {
                setSetting("documentAppearance", (currentValue) =>
                  toggleSharedDocumentAppearancePaper(currentValue)
                );
              }}
              onChangeThemeColor={(key, value) => {
                setSetting("themeProfile", (currentValue) => ({
                  ...currentValue,
                  [key]: value
                }));
              }}
              onToggleSetting={(key) => {
                setSetting(key, (currentValue) => !currentValue);
              }}
            />
          ) : null}
          <button
            className={`sidebar__icon-button sidebar__icon-button--bottom${
              settingsOpen ? " sidebar__icon-button--active" : ""
            }`}
            type="button"
            aria-label="Settings"
            aria-controls="display-settings-popover"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((currentValue) => !currentValue);
            }}
          >
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
        </div>
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
            noteRevealRequest={noteRevealRequest}
            outlineItems={workspace.outlineItems}
            readerState={workspace.readerState}
            onNavigateToTarget={(target) => {
              workspace.viewerApiRef.current?.navigateToTarget(target);
            }}
            onSetUserOutlineItems={(items) => {
              workspace.viewerApiRef.current?.setUserOutlineItems(items);
            }}
            onSnapshotChange={workspace.handleViewerSnapshotChange}
            onOutlineChange={workspace.handleViewerOutlineChange}
            onStateChange={workspace.handleViewerStateChange}
            onStatusChange={workspace.handleViewerStatusChange}
            registerApi={workspace.registerViewerApi}
            viewerDisplayConfig={viewerDisplayConfig}
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
        bookmarks={workspace.readerState?.bookmarks ?? []}
        onClose={() => setOutlineOpen(false)}
        onSelect={(item) => {
          workspace.viewerApiRef.current?.jumpToOutline(item);
          setOutlineOpen(false);
        }}
        onSelectBookmark={(bookmark) => {
          workspace.viewerApiRef.current?.goToPage(bookmark.page);
          setOutlineOpen(false);
        }}
      />

      <UnifiedSearchOverlay
        controller={searchController}
        onOpenDocument={workspace.handleOpenDocument}
        onGoToPage={workspace.goToReaderPage}
        onRevealNoteBlock={(blockId) => {
          setNoteRevealRequest((current) => ({ blockId, sequence: (current?.sequence ?? 0) + 1 }));
        }}
      />
    </main>
  );
}
