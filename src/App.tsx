import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

import CollectionViewRefresh from "./components/CollectionViewRefresh";
import DisplaySettingsPopover from "./components/DisplaySettingsPopover";
import CollectionLibraryGlyph from "./components/icons/CollectionLibraryGlyph";
import { createUnifiedSearchController } from "./search";
import { openLibraryFolder } from "./lib/api";
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
import { debugAction, debugLocalAction } from "./lib/debugLog";
import { collectDocuments } from "./lib/tree";

function startupTrace(step: string, fields: Record<string, unknown> = {}) {
  const payload = {
    step,
    epochMs: Date.now(),
    navigationMs: Math.round(performance.now()),
    ...fields
  };
  console.info(`[CR-STARTUP][app] ${step}`, payload);
  debugLocalAction(`frontend.startup.app.${step}`, payload);
  debugAction(`frontend.startup.app.${step}`, payload);
}

startupTrace("module-loaded");
const appWindow = getCurrentWindow();
const COLLECTION_CLICK_MARK = "collection-click";
const COLLECTION_FIRST_FRAME_MARK = "collection-first-frame";
const COLLECTION_CLICK_TO_FRAME_MEASURE = "collection-click-to-frame";
const COLLECTION_SIDEBAR_CONTROL_ID = "sidebar-collection";
const LazyCommandPalette = lazy(() => import("./components/CommandPalette"));
const LazyOutlineOverlay = lazy(() => import("./components/OutlineOverlay"));
const LazyReaderWorkspace = lazy(() => import("./components/ReaderWorkspace"));

type FullscreenState =
  | "windowed"
  | "entering"
  | "fullscreen"
  | "exiting";

type ViewMode = "reader" | "collection";

type PendingViewNavigationTrace = {
  clickStartedAtMs: number;
  documentId: string | null;
  fromView: ViewMode;
  openSessionId: string | null;
  source: string;
  toView: ViewMode;
  viewTransitionId: string;
};

type ActiveViewTransition = Pick<
  PendingViewNavigationTrace,
  "clickStartedAtMs" | "fromView" | "source" | "toView" | "viewTransitionId"
>;

type SavedWindowState = {
  maximized: boolean;
  fullscreen: boolean;
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
};

function toViewEventName(view: ViewMode) {
  return view === "reader" ? "document" : "collection";
}

function shouldStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return !target.closest(
    "button, input, textarea, select, [contenteditable='true'], [data-no-window-drag]"
  );
}

function describePointerElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return {
    ariaLabel: target.getAttribute("aria-label"),
    className: target.className,
    dataset: { ...target.dataset },
    tagName: target.tagName.toLowerCase()
  };
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
  startupTrace("component-render-start");
  const workspace = useWorkspaceController();
  const notes = useNotesController({
    activeDocument: workspace.activeDocument,
    setStatusMessage: workspace.setStatusMessage
  });
  const { settings, selectors, setSetting, updateSettings } = useAppSettings();
  const palette = usePaletteController();
  const searchController = useMemo(() => createUnifiedSearchController(), []);
  const searchUiOpen = useSyncExternalStore(
    searchController.subscribe,
    () => searchController.getSnapshot().open,
    () => false
  );
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [noteRevealRequest, setNoteRevealRequest] = useState<import("./lib/types").NoteRevealRequest | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteAnchorElement, setPaletteAnchorElement] = useState<HTMLButtonElement | null>(null);
  const [fullscreenState, setFullscreenState] = useState<FullscreenState>("windowed");
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const fullscreenTransitionRef = useRef(false);
  const fullscreenWindowStateRef = useRef<SavedWindowState | null>(null);
  const pendingViewNavigationRef = useRef<PendingViewNavigationTrace | null>(null);
  const committedViewNavigationRef = useRef<PendingViewNavigationTrace | null>(null);
  const activeViewTransitionRef = useRef<ActiveViewTransition | null>(null);
  const currentViewRef = useRef<ViewMode>(workspace.workspaceMode);
  const activeDocumentIdRef = useRef<string | null>(workspace.activeDocumentId);
  const collectionPointerDownSequenceRef = useRef(0);
  const lastCollectionPointerDownRef = useRef<{
    eventTimestamp: number;
    receivedAt: number;
    sequence: number;
  } | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const searchableDocuments = useMemo(
    () => workspace.libraryTree ? collectDocuments(workspace.libraryTree) : [],
    [workspace.libraryTree]
  );
  const [themePreview, setThemePreview] = useState<ThemeDefinition | null>(null);
  const activeTheme = selectors.activeTheme(settings);
  const themeList = selectors.themeList(settings);

  useEffect(() => {
    startupTrace("component-mounted");
    return () => {
      startupTrace("component-unmounted");
    };
  }, []);

  useEffect(() => {
    startupTrace("workspace-snapshot", {
      activeDocumentId: workspace.activeDocument?.document.id ?? null,
      activeReaderSessionId: workspace.activeReaderSession?.openSessionId ?? null,
      libraryLoaded: workspace.libraryTree !== null,
      selectedCollectionId: workspace.selectedCollection?.folder.id ?? null,
      workspaceMode: workspace.workspaceMode
    });
  }, [
    workspace.activeDocument?.document.id,
    workspace.activeReaderSession?.openSessionId,
    workspace.libraryTree,
    workspace.selectedCollection?.folder.id,
    workspace.workspaceMode
  ]);
  const readerPreferences = selectors.readerPreferences(settings);
  const viewerDisplayConfig = themePreview
    ? createViewerDisplayConfig(themePreview)
    : selectors.viewerDisplayConfig(settings);
  const readerPaneSplitRatio = selectors.readerPaneSplitRatio(settings);
  const readerOverlayOpen = palette.paletteOpen || searchUiOpen || outlineOpen;
  const readerFullscreenActive =
    workspace.workspaceMode === "reader" && fullscreenState === "fullscreen";
  const shouldRenderReaderWorkspace =
    workspace.workspaceMode === "reader" || workspace.activeReaderSession !== null;
  const shouldRenderCollectionWorkspace = workspace.workspaceMode === "collection";
  const shouldStackWorkspacePanels =
    shouldRenderReaderWorkspace && shouldRenderCollectionWorkspace;
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

  const startViewNavigationTrace = useCallback(
    (toView: ViewMode, source: string) => {
      const fromView = workspace.workspaceMode;
      const trace: PendingViewNavigationTrace = {
        clickStartedAtMs: performance.now(),
        documentId: workspace.activeDocument?.document.id ?? null,
        fromView,
        openSessionId: workspace.activeReaderSession?.openSessionId ?? null,
        source,
        toView,
        viewTransitionId: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
      pendingViewNavigationRef.current = trace;
      activeViewTransitionRef.current = {
        clickStartedAtMs: trace.clickStartedAtMs,
        fromView: trace.fromView,
        source: trace.source,
        toView: trace.toView,
        viewTransitionId: trace.viewTransitionId
      };
      if (toView === "collection") {
        performance.clearMarks(COLLECTION_CLICK_MARK);
        performance.clearMarks(COLLECTION_FIRST_FRAME_MARK);
        performance.clearMeasures(COLLECTION_CLICK_TO_FRAME_MEASURE);
        performance.mark(COLLECTION_CLICK_MARK);
      }
      debugAction(`view.${toViewEventName(toView)}:click`, {
        documentId: trace.documentId,
        elapsedFromClickMs: 0,
        fromView: toViewEventName(trace.fromView),
        openSessionId: trace.openSessionId,
        source: trace.source,
        toView: toViewEventName(trace.toView),
        viewTransitionId: trace.viewTransitionId
      });
    },
    [workspace.activeDocument, workspace.activeReaderSession?.openSessionId, workspace.workspaceMode]
  );

  useEffect(() => {
    currentViewRef.current = workspace.workspaceMode;
    activeDocumentIdRef.current = workspace.activeDocumentId;
  }, [workspace.activeDocumentId, workspace.workspaceMode]);

  useEffect(() => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      return;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        debugAction("frontend.long-task", {
          activeDocumentId: activeDocumentIdRef.current,
          currentView: toViewEventName(currentViewRef.current),
          duration: Math.round(entry.duration),
          startTime: Math.round(entry.startTime)
        });
      }
    });

    observer.observe({ type: "longtask", buffered: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const intervalMs = 100;
    const gapThresholdMs = 250;
    let lastTick = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const gapMs = Math.round(now - lastTick - intervalMs);
      lastTick = now;
      if (gapMs < gapThresholdMs) {
        return;
      }

      debugAction("frontend.event-loop-gap", {
        activeDocumentId: activeDocumentIdRef.current,
        currentView: toViewEventName(currentViewRef.current),
        expectedIntervalMs: intervalMs,
        gapMs
      });
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const pendingTrace = pendingViewNavigationRef.current;
    if (!pendingTrace || workspace.workspaceMode !== pendingTrace.toView) {
      return;
    }

    committedViewNavigationRef.current = pendingTrace;
    pendingViewNavigationRef.current = null;
    debugAction(`view.${toViewEventName(pendingTrace.toView)}:state-committed`, {
      documentId: pendingTrace.documentId,
      elapsedFromClickMs: Math.round(performance.now() - pendingTrace.clickStartedAtMs),
      fromView: toViewEventName(pendingTrace.fromView),
      openSessionId: pendingTrace.openSessionId,
      source: pendingTrace.source,
      toView: toViewEventName(pendingTrace.toView),
      viewTransitionId: pendingTrace.viewTransitionId
    });
  }, [workspace.workspaceMode]);

  useEffect(() => {
    const committedTrace = committedViewNavigationRef.current;
    if (!committedTrace || workspace.workspaceMode !== committedTrace.toView) {
      return;
    }

    let cancelled = false;
    let secondFrameId = 0;
    const firstFrameId = window.requestAnimationFrame(() => {
      if (!cancelled && committedTrace.toView === "collection") {
        let measureMs: number | null = null;
        try {
          performance.mark(COLLECTION_FIRST_FRAME_MARK);
          performance.measure(
            COLLECTION_CLICK_TO_FRAME_MEASURE,
            COLLECTION_CLICK_MARK,
            COLLECTION_FIRST_FRAME_MARK
          );
          const measures = performance.getEntriesByName(COLLECTION_CLICK_TO_FRAME_MEASURE);
          const latestMeasure = measures[measures.length - 1];
          measureMs = latestMeasure ? Math.round(latestMeasure.duration) : null;
        } catch {
          measureMs = null;
        }

        debugAction("view.collection:first-frame", {
          documentId: committedTrace.documentId,
          elapsedFromClickMs: Math.round(performance.now() - committedTrace.clickStartedAtMs),
          fromView: toViewEventName(committedTrace.fromView),
          measureMs,
          openSessionId: committedTrace.openSessionId,
          source: committedTrace.source,
          toView: toViewEventName(committedTrace.toView),
          viewTransitionId: committedTrace.viewTransitionId
        });
      }

      secondFrameId = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        debugAction(`view.${toViewEventName(committedTrace.toView)}:first-painted`, {
          documentId: committedTrace.documentId,
          elapsedFromClickMs: Math.round(performance.now() - committedTrace.clickStartedAtMs),
          fromView: toViewEventName(committedTrace.fromView),
          openSessionId: committedTrace.openSessionId,
          source: committedTrace.source,
          toView: toViewEventName(committedTrace.toView),
          viewTransitionId: committedTrace.viewTransitionId
        });
        if (committedTrace.toView === "collection") {
          debugAction("view.collection:presented", {
            documentId: committedTrace.documentId,
            clickToPresentedMs: Math.round(performance.now() - committedTrace.clickStartedAtMs),
            fromView: toViewEventName(committedTrace.fromView),
            openSessionId: committedTrace.openSessionId,
            source: committedTrace.source,
            toView: toViewEventName(committedTrace.toView),
            viewTransitionId: committedTrace.viewTransitionId
          });
        }
        if (committedViewNavigationRef.current === committedTrace) {
          committedViewNavigationRef.current = null;
          if (
            activeViewTransitionRef.current?.viewTransitionId === committedTrace.viewTransitionId
          ) {
            activeViewTransitionRef.current = null;
          }
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [workspace.workspaceMode]);

  const syncFullscreenState = useCallback(async () => {
    if (fullscreenTransitionRef.current) {
      return;
    }

    try {
      const nativeFullscreen = await appWindow.isFullscreen();
      const readerFullscreenActive = nativeFullscreen || fullscreenWindowStateRef.current !== null;
      setFullscreenState(readerFullscreenActive ? "fullscreen" : "windowed");
    } catch (error) {
      console.error("fullscreen sync failed:", error);
    }
  }, []);

  const waitForWindowTransitionFrame = useCallback(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      }),
    []
  );

  const captureWindowState = useCallback(async (): Promise<SavedWindowState> => {
    const [maximized, fullscreen, position, size] = await Promise.all([
      appWindow.isMaximized(),
      appWindow.isFullscreen(),
      appWindow.outerPosition().catch(() => null),
      appWindow.outerSize().catch(() => null)
    ]);

    return {
      maximized,
      fullscreen,
      position: position ? { x: position.x, y: position.y } : null,
      size: size ? { width: size.width, height: size.height } : null
    };
  }, []);

  const restoreWindowState = useCallback(
    async (savedWindowState: SavedWindowState | null) => {
      if (!savedWindowState) {
        return;
      }

      const maximized = await appWindow.isMaximized();
      if (maximized && !savedWindowState.maximized) {
        await appWindow.unmaximize();
        await waitForWindowTransitionFrame();
      }

      if (savedWindowState.size) {
        await appWindow.setSize(
          new PhysicalSize(savedWindowState.size.width, savedWindowState.size.height)
        );
      }

      if (savedWindowState.position) {
        await appWindow.setPosition(
          new PhysicalPosition(savedWindowState.position.x, savedWindowState.position.y)
        );
      }

      if (savedWindowState.maximized) {
        await appWindow.maximize();
      }

      if (savedWindowState.fullscreen) {
        await appWindow.setFullscreen(true);
      }
    },
    [waitForWindowTransitionFrame]
  );

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
      fullscreenWindowStateRef.current = await captureWindowState();
      await appWindow.setFullscreen(true);
      setSettingsOpen(false);
      setFullscreenState("fullscreen");
    } catch (error) {
      fullscreenWindowStateRef.current = null;
      setFullscreenState("windowed");
      workspace.setStatusMessage("Unable to enter fullscreen.");
      console.error("enter fullscreen failed:", error);
    } finally {
      window.setTimeout(() => {
        fullscreenTransitionRef.current = false;
        void syncFullscreenState();
      }, 300);
    }
  }, [
    captureWindowState,
    fullscreenState,
    syncFullscreenState,
    workspace.setStatusMessage,
    workspace.workspaceMode
  ]);

  const exitFullscreen = useCallback(async () => {
    if (fullscreenTransitionRef.current || fullscreenState === "windowed" || fullscreenState === "exiting") {
      return;
    }

    fullscreenTransitionRef.current = true;
    setFullscreenState("exiting");

    try {
      const nativeFullscreen = await appWindow.isFullscreen();
      const previousWindowState = fullscreenWindowStateRef.current;
      fullscreenWindowStateRef.current = null;
      if (nativeFullscreen) {
        await appWindow.setFullscreen(false);
        await waitForWindowTransitionFrame();
      }
      await restoreWindowState(previousWindowState);
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
  }, [fullscreenState, restoreWindowState, syncFullscreenState, waitForWindowTransitionFrame]);

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
    if (workspace.workspaceMode !== "reader") {
      workspace.setWorkspaceMode("reader");
    }
    searchController.open();
    setSearchFocusRequest((current) => current + 1);
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
    importDocumentsToCollection: workspace.importDocumentsToCollection,
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
    noteTitle: notes.note?.title ?? null,
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
    openSearch: openUnifiedSearch,
    renameNote: async (title) => {
      notes.updateTitle(title);
      await notes.flushNow("rename-note");
    },
    copyAllNoteText: notes.copyAllText
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
          return;
        }

        event.preventDefault();
        openUnifiedSearch();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && normalizedKey === "p") {
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
        searchController.dismiss();
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
    palette.closePalette,
    palette.openCommands,
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

  useEffect(() => {
    searchController.dismiss();
  }, [searchController, workspace.activeDocumentId]);

  const collectionModeActive =
    workspace.workspaceMode === "collection" && !readerFullscreenActive;

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

  function handleCollectionPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();

    const receivedAt = performance.now();
    const previousPointerDown = lastCollectionPointerDownRef.current;
    const sequence = collectionPointerDownSequenceRef.current + 1;
    collectionPointerDownSequenceRef.current = sequence;
    lastCollectionPointerDownRef.current = {
      eventTimestamp: event.timeStamp,
      receivedAt,
      sequence
    };

    debugAction("view.collection:pointer-down", {
      activeDocumentId: workspace.activeDocumentId,
      currentTarget: describePointerElement(event.currentTarget),
      dispatchDelayMs: Math.max(0, Math.round(receivedAt - event.timeStamp)),
      duplicateWithinMs: previousPointerDown
        ? Math.round(receivedAt - previousPointerDown.receivedAt)
        : null,
      eventTimestamp: Math.round(event.timeStamp),
      handlerReceivedAt: Math.round(receivedAt),
      isPrimary: event.isPrimary,
      openSessionId: workspace.activeReaderSession?.openSessionId ?? null,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      previousEventTimestamp: previousPointerDown
        ? Math.round(previousPointerDown.eventTimestamp)
        : null,
      previousSequence: previousPointerDown?.sequence ?? null,
      sequence,
      target: describePointerElement(event.target),
      workspaceMode: workspace.workspaceMode
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
      className={`app-shell${readerFullscreenActive ? " app-shell--reader-fullscreen" : ""}${
        collectionModeActive ? " app-shell--collection" : ""
      }`}
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
            data-sidebar-control={COLLECTION_SIDEBAR_CONTROL_ID}
            onPointerDownCapture={handleCollectionPointerDown}
            onClick={() => {
              if (workspace.workspaceMode !== "collection") {
                startViewNavigationTrace("collection", "sidebar");
              }
              workspace.setWorkspaceMode("collection");
            }}
          >
            <ChromeIcon label="Collections">
              <CollectionLibraryGlyph />
            </ChromeIcon>
          </button>
          <button
            className={`sidebar__icon-button${
              workspace.workspaceMode === "reader" ? " sidebar__icon-button--active" : ""
            }`}
            type="button"
            aria-label="Reader"
            onClick={() => {
              if (workspace.workspaceMode !== "reader") {
                startViewNavigationTrace("reader", "sidebar");
              }
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
              <path
                fill="currentColor"
                stroke="none"
                d="M14.08 1.5a.75.75 0 0 1 .714.52l.825 2.564c.346.17.678.36.994.575l2.634-.568a.75.75 0 0 1 .807.36l2.079 3.6a.75.75 0 0 1-.094.879l-1.808 1.996a8.37 8.37 0 0 1 0 1.149l1.808 1.998a.75.75 0 0 1 .094.878l-2.079 3.6a.75.75 0 0 1-.807.36l-2.633-.568a8.238 8.238 0 0 1-.993.575l-.827 2.564a.75.75 0 0 1-.713.52H9.92a.75.75 0 0 1-.714-.52l-.824-2.562a8.553 8.553 0 0 1-.998-.578l-2.633.57a.75.75 0 0 1-.807-.36l-2.079-3.6a.75.75 0 0 1 .095-.879l1.807-1.997a8.37 8.37 0 0 1 0-1.146L1.959 9.43a.75.75 0 0 1-.094-.879l2.079-3.6a.75.75 0 0 1 .807-.359l2.633.569c.318-.214.65-.406.996-.575l.824-2.563A.75.75 0 0 1 9.92 1.5h4.159Zm-.549 1.5H10.47l-.852 2.651-.575.28a6.893 6.893 0 0 0-.815.47l-.53.359-2.724-.588-1.53 2.651 1.869 2.069-.045.636a6.87 6.87 0 0 0 0 .942l.045.636-1.87 2.068 1.532 2.652 2.722-.586.531.358c.258.175.53.332.815.47l.575.281.853 2.651h3.06l.855-2.652.573-.278c.288-.14.56-.297.814-.47l.53-.358 2.724.586 1.53-2.651-1.868-2.069.045-.636a6.87 6.87 0 0 0 0-.944l-.045-.635 1.87-2.067-1.532-2.652-2.724.585-.529-.357a6.734 6.734 0 0 0-.814-.47l-.573-.278L13.53 3Zm-1.53 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 1.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
              />
            </ChromeIcon>
          </button>
        </div>
      </nav>
      ) : null}

      {!readerFullscreenActive ? (
        <div className="app-window-chrome">
          <div
            className="app-window-chrome__drag"
            aria-hidden="true"
            onMouseDown={handleTopbarMouseDown}
          />
          <div className="app-window-chrome__controls">
            {renderWindowControls()}
          </div>
        </div>
      ) : null}

      <section
        className={`workspace${workspace.workspaceMode === "reader" ? " workspace--reader" : ""}${
          collectionModeActive ? " workspace--collection" : ""
        }${
          shouldStackWorkspacePanels ? " workspace--stacked" : ""
        }`}
      >
        {shouldRenderCollectionWorkspace ? (
          <div
            className={`workspace__panel workspace__panel--collection${
              workspace.workspaceMode === "collection" ? " workspace__panel--active" : " workspace__panel--hidden"
            }`}
            aria-hidden={workspace.workspaceMode !== "collection"}
          >
            <CollectionViewRefresh
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
                startViewNavigationTrace("reader", "collection-document-open");
                await workspace.handleOpenDocument(documentId, { source: "collection" });
              }}
              onRenameDocument={async (documentId, nextName) => {
                await workspace.renameDocumentInLibrary(documentId, nextName);
              }}
              onPromptImportCollection={async (collectionId) => {
                await flows.promptImportIntoCollectionFlow(collectionId);
              }}
              onImportDocuments={async (collectionId, sourcePaths) => {
                await workspace.importDocumentsToCollection(sourcePaths, collectionId);
              }}
              onMoveDocumentToCollection={async (documentId, destinationCollectionId) => {
                await workspace.moveDocumentInLibrary(documentId, destinationCollectionId);
              }}
              onReorderCollections={async (collectionIds) => {
                await workspace.reorderLibraryCollections(collectionIds);
              }}
              onReorderDocuments={async (collectionId, documentIds) => {
                await workspace.reorderDocumentsInCollection(collectionId, documentIds);
              }}
              onShowStatus={workspace.setStatusMessage}
            />
          </div>
        ) : null}
        {shouldRenderReaderWorkspace ? (
          <div
            className={`workspace__panel workspace__panel--reader${
              workspace.workspaceMode === "reader" ? " workspace__panel--active" : " workspace__panel--hidden"
            }`}
            aria-hidden={workspace.workspaceMode !== "reader"}
          >
            <Suspense fallback={null}>
              <LazyReaderWorkspace
                activeViewTransition={activeViewTransitionRef.current}
                readerSession={workspace.activeReaderSession}
                readerActive={workspace.workspaceMode === "reader"}
                pendingReaderOpenSessionId={workspace.pendingReaderOpenSessionId}
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
                searchController={searchController}
                searchFocusRequest={searchFocusRequest}
                commandPaletteOpen={palette.paletteOpen}
                onToggleCommandPalette={() => {
                  if (palette.paletteOpen) {
                    palette.closePalette();
                    return;
                  }
                  palette.openCommands(commandRegistry);
                }}
                registerCommandPaletteAnchor={setPaletteAnchorElement}
                onSearchOpenDocument={(documentId) =>
                  workspace.handleOpenDocument(documentId, { source: "search-result" })
                }
                onSearchGoToPage={workspace.goToReaderPage}
                onSearchRevealNoteBlock={(blockId) => {
                  setNoteRevealRequest((current) => ({ blockId, sequence: (current?.sequence ?? 0) + 1 }));
                }}
                showHeaders={!readerFullscreenActive}
                showFullscreenHint={showFullscreenHint}
                fullscreen={readerFullscreenActive}
                onToggleFullscreen={toggleFullscreen}
                readerPaneSplitRatio={readerPaneSplitRatio}
                hidePaneResizeHandle={readerOverlayOpen}
                onChangeReaderPaneSplitRatio={(nextRatio) => {
                  setSetting("readerPaneSplitRatio", nextRatio);
                }}
              />
            </Suspense>
          </div>
        ) : null}
      </section>

      {palette.paletteOpen ? (
        <Suspense fallback={null}>
          <LazyCommandPalette
            open={palette.paletteOpen}
            session={palette.paletteSession}
            onClose={palette.closePalette}
            onChangeQuery={palette.changeQuery}
            anchorElement={paletteAnchorElement}
          />
        </Suspense>
      ) : null}

      {outlineOpen ? (
        <Suspense fallback={null}>
          <LazyOutlineOverlay
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
        </Suspense>
      ) : null}

    </main>
  );
}
