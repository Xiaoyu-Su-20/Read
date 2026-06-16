import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  createNewCustomTheme,
  createViewerDisplayConfig,
  deleteCustomTheme,
  deriveThemeCssVariables,
  duplicateTheme,
  saveCustomThemeDraft,
  type ThemeDefinition,
  type ThemeDraft
} from "./lib/app/settingsRegistry";
import { useAppSettings } from "./lib/app/useAppSettings";
import { useCommandRegistry } from "./lib/app/useCommandRegistry";
import { useLibraryFlows } from "./lib/app/useLibraryFlows";
import { useNotesController } from "./lib/app/useNotesController";
import { usePaletteController } from "./lib/app/usePaletteController";
import { useWorkspaceController } from "./lib/app/useWorkspaceController";
import { collectDocuments } from "./lib/tree";

const appWindow = getCurrentWindow();

type FullscreenState =
  | "windowed"
  | "entering"
  | "fullscreen"
  | "exiting";

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
  const { settings, selectors, setSetting, updateSettings } = useAppSettings();
  const palette = usePaletteController();
  const searchController = useMemo(() => createUnifiedSearchController(), []);
  const searchOverlayOpen = useSyncExternalStore(
    searchController.subscribe,
    () => searchController.getSnapshot().open,
    () => false
  );
  const [noteRevealRequest, setNoteRevealRequest] = useState<import("./lib/types").NoteRevealRequest | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreenState, setFullscreenState] = useState<FullscreenState>("windowed");
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const fullscreenTransitionRef = useRef(false);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const searchableDocuments = useMemo(
    () => workspace.libraryTree ? collectDocuments(workspace.libraryTree) : [],
    [workspace.libraryTree]
  );
  const [themePreview, setThemePreview] = useState<ThemeDefinition | null>(null);
  const activeTheme = selectors.activeTheme(settings);
  const themeList = selectors.themeList(settings);
  const readerPreferences = selectors.readerPreferences(settings);
  const viewerDisplayConfig = themePreview
    ? createViewerDisplayConfig(themePreview)
    : selectors.viewerDisplayConfig(settings);
  const readerPaneSplitRatio = selectors.readerPaneSplitRatio(settings);
  const readerOverlayOpen = palette.paletteOpen || searchOverlayOpen || outlineOpen;
  const readerFullscreenActive =
    workspace.workspaceMode === "reader" && fullscreenState === "fullscreen";
  const fullscreenTransitionActive =
    fullscreenState === "entering" || fullscreenState === "exiting";
  const readerPreferenceStates = useMemo(
    () => ({
      fullscreenMode: {
        checked: fullscreenState === "fullscreen" || fullscreenState === "entering",
        disabled: fullscreenTransitionActive
      }
    }),
    [fullscreenState, fullscreenTransitionActive]
  );

  const syncFullscreenState = useCallback(async () => {
    if (fullscreenTransitionRef.current) {
      return;
    }

    try {
      const fullscreen = await appWindow.isFullscreen();
      setFullscreenState(fullscreen ? "fullscreen" : "windowed");
    } catch (error) {
      console.error("fullscreen sync failed:", error);
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (workspace.workspaceMode !== "reader") {
      workspace.setStatusMessage("Open the reader to enter fullscreen.");
      return;
    }

    if (fullscreenTransitionRef.current || fullscreenState === "fullscreen" || fullscreenState === "entering") {
      return;
    }

    fullscreenTransitionRef.current = true;
    setFullscreenState("entering");

    try {
      await appWindow.setFullscreen(true);
      setSettingsOpen(false);
      setFullscreenState("fullscreen");
    } catch (error) {
      setFullscreenState("windowed");
      workspace.setStatusMessage("Unable to enter fullscreen.");
      console.error("enter fullscreen failed:", error);
    } finally {
      window.setTimeout(() => {
        fullscreenTransitionRef.current = false;
        void syncFullscreenState();
      }, 300);
    }
  }, [fullscreenState, syncFullscreenState, workspace.setStatusMessage, workspace.workspaceMode]);

  const exitFullscreen = useCallback(async () => {
    if (fullscreenTransitionRef.current || fullscreenState === "windowed" || fullscreenState === "exiting") {
      return;
    }

    fullscreenTransitionRef.current = true;
    setFullscreenState("exiting");

    try {
      await appWindow.setFullscreen(false);
      setFullscreenState("windowed");
    } catch (error) {
      setFullscreenState("fullscreen");
      console.error("exit fullscreen failed:", error);
    } finally {
      window.setTimeout(() => {
        fullscreenTransitionRef.current = false;
        void syncFullscreenState();
      }, 300);
    }
  }, [fullscreenState, syncFullscreenState]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenState === "fullscreen") {
      await exitFullscreen();
      return;
    }

    if (fullscreenState === "windowed") {
      await enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, fullscreenState]);

  useEffect(() => {
    if (themePreview && themePreview.id !== activeTheme.id) {
      setThemePreview(null);
    }
  }, [activeTheme.id, themePreview]);

  useEffect(() => {
    if (fullscreenState === "fullscreen" || fullscreenState === "windowed") {
      const nextFullscreenPreference = fullscreenState === "fullscreen";
      if (readerPreferences.fullscreenMode !== nextFullscreenPreference) {
        setSetting("readerPreferences", (currentValue) => ({
          ...currentValue,
          fullscreenMode: nextFullscreenPreference
        }));
      }
    }
  }, [fullscreenState, readerPreferences.fullscreenMode, setSetting]);

  useEffect(() => {
    if (workspace.workspaceMode !== "reader" && fullscreenState === "fullscreen") {
      void exitFullscreen();
    }
  }, [exitFullscreen, fullscreenState, workspace.workspaceMode]);

  useEffect(() => {
    if (!readerFullscreenActive) {
      setShowFullscreenHint(false);
      return;
    }

    setShowFullscreenHint(true);
    const timer = window.setTimeout(() => {
      setShowFullscreenHint(false);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [readerFullscreenActive]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const rootStyle = document.documentElement.style;
    const themeVariables = deriveThemeCssVariables(themePreview ?? activeTheme);
    for (const [variableName, variableValue] of Object.entries(themeVariables)) {
      rootStyle.setProperty(variableName, variableValue);
    }
  }, [activeTheme, themePreview]);

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
    let unlistenFocusChanged: (() => void) | null = null;

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
        const fullscreen = await appWindow.isFullscreen();
        if (!fullscreen && !(await appWindow.isMaximized())) {
          await appWindow.maximize();
        }
      } catch (error) {
        console.error("startup maximize failed:", error);
      }

      await Promise.all([syncWindowChromeState(), syncFullscreenState()]);

      try {
        [unlistenResized, unlistenScaleChanged, unlistenMoved, unlistenFocusChanged] =
          await Promise.all([
            appWindow.onResized(() => {
              void syncWindowChromeState();
              void syncFullscreenState();
            }),
            appWindow.onScaleChanged(() => {
              void syncWindowChromeState();
              void syncFullscreenState();
            }),
            appWindow.onMoved(() => {
              void syncWindowChromeState();
            }),
            appWindow.onFocusChanged(() => {
              void syncWindowChromeState();
              void syncFullscreenState();
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
      unlistenFocusChanged?.();
    };
  }, [syncFullscreenState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const originatedFromEditable = isEditableTarget(event.target);
      const normalizedKey = event.key.toLowerCase();

      if (event.key === "F11" || normalizedKey === "f11" || event.code === "F11") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (event.key === "Escape" && fullscreenState === "fullscreen") {
        event.preventDefault();
        void exitFullscreen();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && normalizedKey === "f") {
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
    exitFullscreen,
    fullscreenState,
    outlineOpen,
    palette.closePalette,
    palette.openCommands,
    palette.paletteOpen,
    searchController,
    settingsOpen,
    toggleFullscreen,
    workspace.workspaceMode
  ]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void syncFullscreenState();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncFullscreenState]);

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
    workspace.selectedCollection?.folder.name ?? "Library";
  const topbarStatus =
    workspace.selectedCollection
      ? `${workspace.selectedCollection.documents.length} books`
      : "No collection selected";

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

  function renderWindowControls() {
    return (
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
    );
  }

  return (
    <main
      className={`app-shell${readerFullscreenActive ? " app-shell--reader-fullscreen" : ""}`}
      data-fullscreen={readerFullscreenActive ? "true" : "false"}
    >
      {!readerFullscreenActive ? (
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
              activeTheme={activeTheme}
              activeThemeId={settings.activeThemeId}
              readerPreferences={readerPreferences}
              readerPreferenceStates={readerPreferenceStates}
              themeList={themeList}
              onCreateTheme={() => {
                setThemePreview(null);
                updateSettings((currentSettings) => createNewCustomTheme(currentSettings));
              }}
              onDeleteTheme={(themeId) => {
                setThemePreview(null);
                updateSettings((currentSettings) =>
                  deleteCustomTheme(currentSettings, themeId)
                );
              }}
              onDuplicateTheme={(themeId) => {
                setThemePreview(null);
                updateSettings((currentSettings) =>
                  duplicateTheme(currentSettings, themeId)
                );
              }}
              onPreviewTheme={(themeDefinition) => {
                setThemePreview(themeDefinition);
              }}
              onSaveThemeDraft={(themeId, themeDraft: ThemeDraft) => {
                setThemePreview(null);
                updateSettings((currentSettings) =>
                  saveCustomThemeDraft(currentSettings, themeId, themeDraft)
                );
              }}
              onSelectTheme={(themeId) => {
                setThemePreview(null);
                setSetting("activeThemeId", themeId);
              }}
              onToggleReaderPreference={(key) => {
                if (key === "fullscreenMode") {
                  void toggleFullscreen();
                  return;
                }

                setSetting("readerPreferences", (currentValue) => ({
                  ...currentValue,
                  [key]: !currentValue[key]
                }));
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
              setSettingsOpen((currentValue) => {
                const nextValue = !currentValue;
                if (!nextValue) {
                  setThemePreview(null);
                }
                return nextValue;
              });
            }}
          >
            <ChromeIcon label="Settings">
              <circle cx="12" cy="12" r="2.6" />
              <path d="M12 4.2v2.1" />
              <path d="M12 17.7v2.1" />
              <path d="m6.35 6.35 1.48 1.48" />
              <path d="m16.17 16.17 1.48 1.48" />
              <path d="M4.2 12h2.1" />
              <path d="M17.7 12h2.1" />
              <path d="m6.35 17.65 1.48-1.48" />
              <path d="m16.17 7.83 1.48-1.48" />
              <path d="M9.3 5.35 8.6 3.9" />
              <path d="m15.4 20.1-.7-1.45" />
              <path d="m5.35 14.7-1.45.7" />
              <path d="m20.1 9.3-1.45.7" />
            </ChromeIcon>
          </button>
        </div>
      </nav>
      ) : null}

      {workspace.workspaceMode === "collection" && !readerFullscreenActive ? (
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
          {renderWindowControls()}
        </header>
      ) : null}

      <section
        className={`workspace${workspace.workspaceMode === "reader" ? " workspace--reader" : ""}`}
      >
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
            documentHeaderTitle={workspace.activeDocument?.document.title ?? "Reader"}
            documentHeaderCurrentPage={workspace.viewerSnapshot.currentPage}
            documentHeaderPageCount={workspace.viewerSnapshot.pageCount}
            documentHeaderZoom={workspace.viewerSnapshot.zoom}
            viewerApi={workspace.viewerApi}
            onHeaderMouseDown={handleTopbarMouseDown}
            windowControls={renderWindowControls()}
            showHeaders={!readerFullscreenActive}
            showFullscreenHint={showFullscreenHint}
            fullscreen={readerFullscreenActive}
            readerPaneSplitRatio={readerPaneSplitRatio}
            hidePaneResizeHandle={readerOverlayOpen}
            onChangeReaderPaneSplitRatio={(nextRatio) => {
              setSetting("readerPaneSplitRatio", nextRatio);
            }}
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
