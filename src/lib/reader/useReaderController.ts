import type { KeyboardEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { saveDocumentState } from "../api";
import { dedupeBookmarks } from "../commands";
import { debugAction, startDebugProcess } from "../debugLog";
import { dedupeOutlineItems, mergeOutlineItems } from "../documentReferences";
import type {
  Bookmark,
  DocumentPayload,
  DocumentState,
  OutlineItem,
  PageTextLayerData,
  PdfNavigationTarget,
  PdfOutlineItem,
  ViewerApi,
  ViewerSnapshot
} from "../types";
import { createPageCache, makePageCacheKey, type CachedRenderedPage } from "./PageCache";
import { invalidatePdfPageRenders, renderVisiblePdfPage } from "./PdfPageRenderer";
import { createPdfRuntimeSession, type PdfRuntimeSession } from "./PdfRuntimeSession";
import {
  makeRapidTurnOverlayModel,
  shouldActivateRapidTurn,
  type NavigationDirection,
  type RapidTurnIntent,
  type RapidTurnLastInput,
  type RapidTurnOverlayModel
} from "./rapidTurn";
import {
  clampZoom,
  normalizeZoom,
  scaleZoomByKeyboardDirection,
  scaleZoomByWheelDelta
} from "./zoom";

const RENDER_CACHE_SIZE = 20;
const PAGE_TURN_COMMIT_THROTTLE_MS = 150;
const PRELOAD_DELAY_MS = 150;
const NAVIGATION_SAVE_DEBOUNCE_MS = 700;
const BOOKMARK_SAVE_DEBOUNCE_MS = 200;
const KEYBOARD_RAPID_TURN_WINDOW_MS = 220;
const WHEEL_RAPID_TURN_WINDOW_MS = 180;
const ZOOM_COMMIT_DEBOUNCE_MS = 120;

type UseReaderControllerArgs = {
  document: DocumentPayload | null;
  onOutlineChange: (items: OutlineItem[]) => void;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
};

type DisplayedPageTextDebugStatus = {
  itemCount: number;
  pageNumber: number | null;
  state: "missing" | "missing-runtime" | "loading" | "loaded" | "empty" | "error";
};

type RapidTurnSession = {
  active: boolean;
  direction: NavigationDirection | null;
  source: RapidTurnIntent["source"] | null;
  targetPage: number;
};

type NormalizationReadyEvent = {
  documentId: string;
  fingerprint: string;
  token: string;
};

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(pageCount, 1));
}

function shouldIgnoreRenderResponse(requestSequence: number, activeSequence: number) {
  return requestSequence !== activeSequence;
}

function normalizeDocumentState(state: DocumentState): DocumentState {
  return {
    ...state,
    bookmarks: dedupeBookmarks(state.bookmarks ?? []),
    userOutlineItems: dedupeOutlineItems(state.userOutlineItems ?? [])
  };
}

function stateSignature(state: DocumentState) {
  const normalizedState = normalizeDocumentState(state);
  return JSON.stringify({
    version: normalizedState.version,
    documentId: normalizedState.documentId,
    fingerprint: normalizedState.fingerprint,
    lastPage: normalizedState.lastPage,
    zoom: normalizedState.zoom,
    bookmarks: normalizedState.bookmarks,
    preferences: normalizedState.preferences,
    userOutlineItems: normalizedState.userOutlineItems
  });
}

export function useReaderController({
  document,
  onOutlineChange,
  onSnapshotChange,
  onStatusChange,
  onStateChange,
  registerApi
}: UseReaderControllerArgs) {
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [displayZoom, setDisplayZoom] = useState(1);
  const [committedZoom, setCommittedZoom] = useState(1);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [displayedPage, setDisplayedPage] = useState<CachedRenderedPage | null>(null);
  const [incomingPage, setIncomingPage] = useState<CachedRenderedPage | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);
  const [displayedPageTextLayer, setDisplayedPageTextLayer] = useState<PageTextLayerData | null>(null);
  const [displayedPageTextDebugStatus, setDisplayedPageTextDebugStatus] =
    useState<DisplayedPageTextDebugStatus>({
      itemCount: 0,
      pageNumber: null,
      state: "missing"
    });
  const [rapidTurnOverlay, setRapidTurnOverlay] = useState<RapidTurnOverlayModel | null>(null);

  const runtimeSessionRef = useRef<PdfRuntimeSession | null>(null);
  const pageCache = useRef(createPageCache(RENDER_CACHE_SIZE));
  const preloadInFlight = useRef(new Set<string>());
  const renderSequenceRef = useRef(0);
  const normalizationGenerationRef = useRef(0);
  const incomingPageKeyRef = useRef<string | null>(null);
  const initializedDocumentIdRef = useRef<string | null>(null);
  const outlineLoadedForDocumentIdRef = useRef<string | null>(null);
  const embeddedOutlineItemsRef = useRef<OutlineItem[]>([]);
  const currentDocumentRef = useRef<DocumentPayload | null>(null);
  const readerStateRef = useRef<DocumentState | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  const dirtyStateRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const preloadTimerRef = useRef<number | null>(null);
  const pageCommitTimerRef = useRef<number | null>(null);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const pendingCommittedPageRef = useRef<number | null>(null);
  const lastPageCommitAtRef = useRef(0);
  const rapidTurnWheelFinalizeTimerRef = useRef<number | null>(null);
  const rapidTurnLastInputRef = useRef<RapidTurnLastInput | null>(null);
  const rapidTurnSessionRef = useRef<RapidTurnSession>({
    active: false,
    direction: null,
    source: null,
    targetPage: 1
  });

  function clearRapidTurnWheelFinalizeTimer() {
    if (rapidTurnWheelFinalizeTimerRef.current !== null) {
      window.clearTimeout(rapidTurnWheelFinalizeTimerRef.current);
      rapidTurnWheelFinalizeTimerRef.current = null;
    }
  }

  function clearPageCommitTimer() {
    if (pageCommitTimerRef.current !== null) {
      window.clearTimeout(pageCommitTimerRef.current);
      pageCommitTimerRef.current = null;
    }
  }

  function clearZoomCommitTimer() {
    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
  }

  function clearScheduledSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  function updateZoom(nextZoom: number, reason: string, options?: { commitImmediately?: boolean }) {
    const normalizedZoom = normalizeZoom(nextZoom);
    setDisplayZoom(normalizedZoom);

    if (options?.commitImmediately) {
      clearZoomCommitTimer();
      setCommittedZoom((currentZoom) => (Math.abs(currentZoom - normalizedZoom) < 0.001 ? currentZoom : normalizedZoom));
      debugAction("reader.zoom-commit", {
        currentPage,
        reason,
        zoom: normalizedZoom
      });
      return;
    }

    clearZoomCommitTimer();
    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = null;
      setCommittedZoom((currentZoom) => {
        if (Math.abs(currentZoom - normalizedZoom) < 0.001) {
          return currentZoom;
        }

        debugAction("reader.zoom-commit", {
          currentPage,
          reason,
          zoom: normalizedZoom
        });
        return normalizedZoom;
      });
    }, ZOOM_COMMIT_DEBOUNCE_MS);
  }

  function hideRapidTurnOverlay(reason: string) {
    const activeSession = rapidTurnSessionRef.current;
    if (!activeSession.active && !rapidTurnOverlay) {
      return;
    }

    debugAction("reader.rapid-turn-hidden", {
      reason,
      source: activeSession.source,
      targetPage: activeSession.targetPage
    });
    rapidTurnSessionRef.current = {
      active: false,
      direction: null,
      source: null,
      targetPage
    };
    clearRapidTurnWheelFinalizeTimer();
    setRapidTurnOverlay(null);
  }

  function updateReaderState(nextState: DocumentState | null) {
    const normalizedState = nextState ? normalizeDocumentState(nextState) : null;
    readerStateRef.current = normalizedState;
    setReaderState(normalizedState);
    onStateChange(normalizedState);
  }

  function publishOutlineItems(userOutlineItems?: PdfOutlineItem[]) {
    onOutlineChange(
      mergeOutlineItems(
        embeddedOutlineItemsRef.current,
        userOutlineItems ?? readerStateRef.current?.userOutlineItems ?? []
      )
    );
  }

  function navigateToTarget(target: PdfNavigationTarget, reason: string) {
    const activeDocument = currentDocumentRef.current;
    if (activeDocument && target.documentId && target.documentId !== activeDocument.document.id) {
      onStatusChange("This reference points to another document.");
      return;
    }

    const nextPage = clampPage(target.pageIndex + 1, pageCount || target.pageIndex + 1);
    if (typeof target.zoom === "number" && Number.isFinite(target.zoom) && target.zoom > 0) {
      updateZoom(target.zoom, reason, { commitImmediately: true });
    }
    requestPageTurnWithIntent(nextPage, reason);
  }

  async function persistReaderStateSnapshot(
    activeDocument: DocumentPayload,
    state: DocumentState,
    reason: string
  ) {
    const signature = stateSignature(state);
    const process = startDebugProcess("reader-state.save", {
      documentId: activeDocument.document.id,
      page: state.lastPage,
      reason,
      zoom: state.zoom
    });

    saveInFlightRef.current = true;
    try {
      await saveDocumentState(activeDocument.document.id, state);
      if (
        currentDocumentRef.current?.document.id === activeDocument.document.id &&
        readerStateRef.current &&
        stateSignature(readerStateRef.current) === signature
      ) {
        dirtyStateRef.current = false;
      }
      lastPersistedSignatureRef.current = signature;
      debugAction("reader-state.save-completed", {
        documentId: activeDocument.document.id,
        page: state.lastPage,
        reason,
        zoom: state.zoom
      });
      process.finish();
    } catch (error) {
      process.fail(error);
      onStatusChange(
        error instanceof Error ? error.message : String(error || "Unable to save reader state.")
      );
    } finally {
      saveInFlightRef.current = false;

      const latestDocument = currentDocumentRef.current;
      const latestState = readerStateRef.current;
      if (
        latestDocument &&
        latestState &&
        latestDocument.document.id === latestState.documentId &&
        stateSignature(latestState) !== lastPersistedSignatureRef.current
      ) {
        dirtyStateRef.current = true;
        scheduleReaderStateSave("reschedule-after-save", NAVIGATION_SAVE_DEBOUNCE_MS);
      }
    }
  }

  function flushReaderState(reason: string) {
    clearScheduledSave();

    const activeDocument = currentDocumentRef.current;
    const state = readerStateRef.current;
    if (!activeDocument || !state || activeDocument.document.id !== state.documentId) {
      return;
    }

    const signature = stateSignature(state);
    if (!dirtyStateRef.current && signature === lastPersistedSignatureRef.current) {
      return;
    }

    if (saveInFlightRef.current) {
      debugAction("reader-state.save-skipped-in-flight", {
        documentId: activeDocument.document.id,
        reason
      });
      return;
    }

    void persistReaderStateSnapshot(activeDocument, state, reason);
  }

  function scheduleReaderStateSave(reason: string, delayMs: number) {
    const activeDocument = currentDocumentRef.current;
    const state = readerStateRef.current;
    if (!activeDocument || !state || activeDocument.document.id !== state.documentId) {
      return;
    }

    clearScheduledSave();
    debugAction("reader-state.save-scheduled", {
      delayMs,
      documentId: activeDocument.document.id,
      page: state.lastPage,
      reason,
      zoom: state.zoom
    });
    saveTimerRef.current = window.setTimeout(() => {
      flushReaderState(`debounced:${reason}`);
    }, delayMs);
  }

  function markReaderStateDirty(
    nextState: DocumentState,
    reason: string,
    delayMs = NAVIGATION_SAVE_DEBOUNCE_MS,
    options?: { force?: boolean }
  ) {
    const signature = stateSignature(nextState);
    const isDirty = options?.force === true || signature !== lastPersistedSignatureRef.current;
    dirtyStateRef.current = isDirty;
    debugAction("reader-state.dirty", {
      delayMs,
      documentId: nextState.documentId,
      isDirty,
      page: nextState.lastPage,
      reason,
      zoom: nextState.zoom
    });

    if (isDirty) {
      scheduleReaderStateSave(reason, delayMs);
    } else {
      clearScheduledSave();
    }
  }

  function commitPageTurnImmediately(nextPage: number, reason: string) {
    clearPageCommitTimer();
    pendingCommittedPageRef.current = null;
    lastPageCommitAtRef.current = Date.now();
    debugAction("reader.page-commit", {
      page: nextPage,
      reason
    });
    setCurrentPage((page) => (page === nextPage ? page : nextPage));
  }

  function commitPageTurn(nextPage: number, reason: string) {
    pendingCommittedPageRef.current = nextPage;

    const runCommit = () => {
      clearPageCommitTimer();
      const pendingPage = pendingCommittedPageRef.current;
      if (pendingPage === null) {
        return;
      }

      pendingCommittedPageRef.current = null;
      lastPageCommitAtRef.current = Date.now();
      debugAction("reader.page-commit", {
        page: pendingPage,
        reason
      });
      setCurrentPage((page) => (page === pendingPage ? page : pendingPage));
    };

    const now = Date.now();
    const elapsed = now - lastPageCommitAtRef.current;
    const shouldCommitImmediately =
      elapsed >= PAGE_TURN_COMMIT_THROTTLE_MS && pageCommitTimerRef.current === null;

    if (shouldCommitImmediately) {
      runCommit();
      return;
    }

    const remainingDelay = Math.max(PAGE_TURN_COMMIT_THROTTLE_MS - elapsed, 0);
    clearPageCommitTimer();
    debugAction("reader.page-commit-scheduled", {
      delayMs: remainingDelay,
      page: nextPage,
      reason
    });
    pageCommitTimerRef.current = window.setTimeout(runCommit, remainingDelay);
  }

  function startRapidTurnSession(intent: RapidTurnIntent, nextPage: number) {
    rapidTurnSessionRef.current = {
      active: true,
      direction: intent.direction,
      source: intent.source,
      targetPage: nextPage
    };
    debugAction("reader.rapid-turn-started", {
      page: nextPage,
      pageCount,
      source: intent.source
    });
    setRapidTurnOverlay(makeRapidTurnOverlayModel(nextPage, pageCount, false));
  }

  function updateRapidTurnSession(nextPage: number, isFinalizing: boolean) {
    const activeSession = rapidTurnSessionRef.current;
    if (!activeSession.active) {
      return;
    }

    rapidTurnSessionRef.current = {
      ...activeSession,
      targetPage: nextPage
    };
    setRapidTurnOverlay(makeRapidTurnOverlayModel(nextPage, pageCount, isFinalizing));
  }

  function finalizeRapidTurn(reason: string) {
    const activeSession = rapidTurnSessionRef.current;
    if (!activeSession.active) {
      return;
    }

    clearRapidTurnWheelFinalizeTimer();

    const nextPage = activeSession.targetPage;
    debugAction("reader.rapid-turn-finalize", {
      currentPage,
      reason,
      source: activeSession.source,
      targetPage: nextPage
    });

    if (currentPage !== nextPage || pendingCommittedPageRef.current !== null) {
      updateRapidTurnSession(nextPage, true);
      commitPageTurnImmediately(nextPage, `${reason}:finalize`);
      return;
    }

    if (displayedPage?.pageNumber === nextPage && !incomingPage && !isRendering) {
      hideRapidTurnOverlay(`${reason}:ready`);
      return;
    }

    updateRapidTurnSession(nextPage, true);
  }

  function noteRapidTurnIntent(intent: RapidTurnIntent, nextPage: number) {
    const now = Date.now();
    const shouldActivate = shouldActivateRapidTurn(rapidTurnLastInputRef.current, intent, now);
    const activeSession = rapidTurnSessionRef.current;

    rapidTurnLastInputRef.current = {
      at: now,
      direction: intent.direction,
      source: intent.source
    };

    if (activeSession.active) {
      rapidTurnSessionRef.current = {
        ...rapidTurnSessionRef.current,
        direction: intent.direction,
        source: intent.source
      };
      updateRapidTurnSession(nextPage, false);
    } else if (shouldActivate) {
      startRapidTurnSession(intent, nextPage);
    }

    if (intent.source === "wheel" && rapidTurnSessionRef.current.active) {
      clearRapidTurnWheelFinalizeTimer();
      rapidTurnWheelFinalizeTimerRef.current = window.setTimeout(() => {
        finalizeRapidTurn("wheel-idle");
      }, WHEEL_RAPID_TURN_WINDOW_MS);
    }
  }

  function requestPageTurnWithIntent(
    nextPage: number,
    reason: string,
    intent?: RapidTurnIntent
  ) {
    setTargetPage((currentTargetPage) => {
      if (currentTargetPage === nextPage) {
        return currentTargetPage;
      }

      if (intent) {
        noteRapidTurnIntent(intent, nextPage);
      }

      debugAction("reader.page-request", {
        nextPage,
        previousPage: currentTargetPage,
        reason
      });
      return nextPage;
    });
    commitPageTurn(nextPage, reason);
  }

  useEffect(() => {
    if (document?.document.id === initializedDocumentIdRef.current) {
      if (!runtimeSessionRef.current && document) {
        runtimeSessionRef.current = createPdfRuntimeSession(document.document.id);
        debugAction("reader.runtime-session-recreated", {
          documentId: document.document.id,
          reason: "strict-mode-remount"
        });
      }
      return;
    }

    const previousDocument = currentDocumentRef.current;
    const previousState = readerStateRef.current;
    if (
      previousDocument &&
      previousState &&
      dirtyStateRef.current &&
      previousDocument.document.id === previousState.documentId
    ) {
      void persistReaderStateSnapshot(previousDocument, previousState, "document-switch");
    }

    const previousRuntimeSession = runtimeSessionRef.current;
    runtimeSessionRef.current = document ? createPdfRuntimeSession(document.document.id) : null;
    if (previousRuntimeSession) {
      void previousRuntimeSession.dispose();
    }

    initializedDocumentIdRef.current = document?.document.id ?? null;
    currentDocumentRef.current = document;
    pageCache.current.clear();
    preloadInFlight.current.clear();
    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    clearPageCommitTimer();
    clearRapidTurnWheelFinalizeTimer();
    pendingCommittedPageRef.current = null;
    lastPageCommitAtRef.current = 0;
    rapidTurnLastInputRef.current = null;
    rapidTurnSessionRef.current = {
      active: false,
      direction: null,
      source: null,
      targetPage: 1
    };
    outlineLoadedForDocumentIdRef.current = null;
    embeddedOutlineItemsRef.current = [];
    setDocumentError(null);
    setRenderError(null);
    setDisplayedPageTextLayer(null);
    setDisplayedPageTextDebugStatus({
      itemCount: 0,
      pageNumber: null,
      state: "missing"
    });
    setIsRendering(false);
    setDisplayedPage(null);
    setIncomingPage(null);
    setIncomingReady(false);
    setRapidTurnOverlay(null);
    incomingPageKeyRef.current = null;
    onOutlineChange([]);

    if (!document) {
      setPageCount(0);
      setCurrentPage(1);
      setTargetPage(1);
      clearZoomCommitTimer();
      setDisplayZoom(1);
      setCommittedZoom(1);
      clearScheduledSave();
      dirtyStateRef.current = false;
      lastPersistedSignatureRef.current = null;
      updateReaderState(null);
      setLoadingDocument(false);
      return;
    }

    setLoadingDocument(true);
    const nextPageCount = Math.max(document.pageCount, 1);
    const nextPage = clampPage(document.state.lastPage, nextPageCount);
    const nextZoom = clampZoom(document.state.zoom ?? 1);
    setPageCount(nextPageCount);
    setCurrentPage(nextPage);
    setTargetPage(nextPage);
    clearZoomCommitTimer();
    setDisplayZoom(nextZoom);
    setCommittedZoom(nextZoom);
    const rawNextState = {
      ...document.state,
      lastPage: nextPage,
      zoom: nextZoom,
      userOutlineItems: document.state.userOutlineItems ?? []
    };
    const nextState = normalizeDocumentState(rawNextState);
    const stateWasDeduped =
      JSON.stringify(rawNextState.bookmarks ?? []) !== JSON.stringify(nextState.bookmarks) ||
      JSON.stringify(rawNextState.userOutlineItems ?? []) !==
        JSON.stringify(nextState.userOutlineItems);
    clearScheduledSave();
    dirtyStateRef.current = false;
    lastPersistedSignatureRef.current = stateSignature(nextState);
    updateReaderState(nextState);
    onOutlineChange(nextState.userOutlineItems);
    if (stateWasDeduped) {
      markReaderStateDirty(nextState, "dedupe-reader-state", BOOKMARK_SAVE_DEBOUNCE_MS, {
        force: true
      });
    }
    onStatusChange(`Opened ${nextPageCount} pages.`);
  }, [document, onOutlineChange, onStateChange, onStatusChange]);

  useEffect(() => {
    return () => {
      const runtimeSession = runtimeSessionRef.current;
      runtimeSessionRef.current = null;
      clearZoomCommitTimer();
      if (runtimeSession) {
        void runtimeSession.dispose();
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<NormalizationReadyEvent>("page-normalization-ready", (event) => {
      const activeDocument = currentDocumentRef.current;
      if (
        !activeDocument ||
        event.payload.documentId !== activeDocument.document.id ||
        event.payload.fingerprint !== activeDocument.document.fingerprint
      ) {
        return;
      }

      normalizationGenerationRef.current += 1;
      renderSequenceRef.current += 1;
      pageCache.current.clear();
      preloadInFlight.current.clear();
      invalidatePdfPageRenders(event.payload.documentId);
      setIncomingPage(null);
      setIncomingReady(false);
      incomingPageKeyRef.current = null;
      setIsRendering(false);
      debugAction("reader.normalization-ready", {
        documentId: event.payload.documentId,
        token: event.payload.token
      });
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
      } else {
        unlisten = disposeListener;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function flushOnVisibilityChange() {
      if (window.document.visibilityState === "hidden") {
        flushReaderState("document-hidden");
      }
    }

    function flushOnWindowBlur() {
      finalizeRapidTurn("window-blur");
      flushReaderState("window-blur");
    }

    function flushOnBeforeUnload() {
      flushReaderState("before-unload");
    }

    window.document.addEventListener("visibilitychange", flushOnVisibilityChange);
    window.addEventListener("blur", flushOnWindowBlur);
    window.addEventListener("beforeunload", flushOnBeforeUnload);

    return () => {
      window.document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      window.removeEventListener("blur", flushOnWindowBlur);
      window.removeEventListener("beforeunload", flushOnBeforeUnload);
      clearZoomCommitTimer();
      finalizeRapidTurn("controller-unmount");
      flushReaderState("controller-unmount");
    };
  }, []);

  useEffect(() => {
    onSnapshotChange({
      currentPage: targetPage,
      pageCount,
      zoom: displayZoom
    });
  }, [displayZoom, onSnapshotChange, pageCount, targetPage]);

  useEffect(() => {
    setReaderState((current) => {
      if (!current) {
        return current;
      }
      if (current.lastPage === targetPage && Math.abs(current.zoom - committedZoom) < 0.001) {
        return current;
      }
      const nextState = {
        ...current,
        lastPage: targetPage,
        zoom: committedZoom
      };
      readerStateRef.current = nextState;
      markReaderStateDirty(nextState, "navigation");
      onStateChange(nextState);
      return nextState;
    });
  }, [committedZoom, onStateChange, targetPage]);

  useEffect(() => {
    if (!document || !displayedPage) {
      return;
    }

    const runtimeSession = runtimeSessionRef.current;
    if (!runtimeSession) {
      return;
    }

    void runtimeSession.load().catch(() => undefined);
  }, [displayedPage, document]);

  useEffect(() => {
    if (!document || !displayedPage) {
      return;
    }

    if (outlineLoadedForDocumentIdRef.current === document.document.id) {
      return;
    }

    const runtimeSession = runtimeSessionRef.current;
    if (!runtimeSession) {
      return;
    }

    let cancelled = false;
    void runtimeSession
      .getOutline()
      .then((nextOutline) => {
        if (cancelled || runtimeSessionRef.current !== runtimeSession) {
          return;
        }

        outlineLoadedForDocumentIdRef.current = document.document.id;
        embeddedOutlineItemsRef.current = nextOutline;
        publishOutlineItems();
      })
      .catch(() => {
        if (!cancelled && runtimeSessionRef.current === runtimeSession) {
          embeddedOutlineItemsRef.current = [];
          publishOutlineItems();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayedPage, document, onOutlineChange]);

  const displayedPageDocumentId = document?.document.id ?? null;
  const displayedPageNumber = displayedPage?.pageNumber ?? null;

  useEffect(() => {
    if (!document || !displayedPage) {
      debugAction("reader.text-layer-cleared", {
        displayedPageNumber: displayedPage?.pageNumber ?? null,
        documentId: document?.document.id ?? null,
        reason: "missing-document-or-page"
      });
      setDisplayedPageTextLayer(null);
      setDisplayedPageTextDebugStatus({
        itemCount: 0,
        pageNumber: displayedPage?.pageNumber ?? null,
        state: "missing"
      });
      return;
    }

    const runtimeSession = runtimeSessionRef.current;
    if (!runtimeSession) {
      debugAction("reader.text-layer-cleared", {
        displayedPageNumber: displayedPage.pageNumber,
        documentId: document.document.id,
        reason: "missing-runtime-session"
      });
      setDisplayedPageTextLayer(null);
      setDisplayedPageTextDebugStatus({
        itemCount: 0,
        pageNumber: displayedPage.pageNumber,
        state: "missing-runtime"
      });
      return;
    }

    let cancelled = false;
    const pageNumber = displayedPage.pageNumber;
    debugAction("reader.text-layer-requested", {
      displayedPageNumber: displayedPage.pageNumber,
      documentId: document.document.id,
      renderedHeight: displayedPage.height,
      renderedWidth: displayedPage.width
    });
    setDisplayedPageTextDebugStatus({
      itemCount: 0,
      pageNumber,
      state: "loading"
    });

    void runtimeSession
      .getPageText(pageNumber)
      .then((nextTextLayer) => {
        if (cancelled || runtimeSessionRef.current !== runtimeSession) {
          return;
        }
        const itemCount = nextTextLayer.textContent.items.length;
        debugAction("reader.text-layer-loaded", {
          displayedPageNumber: displayedPage.pageNumber,
          documentId: document.document.id,
          itemCount,
          textLayerPageNumber: nextTextLayer.pageNumber,
          viewportHeight: nextTextLayer.viewportHeight,
          viewportWidth: nextTextLayer.viewportWidth
        });
        setDisplayedPageTextLayer(nextTextLayer);
        setDisplayedPageTextDebugStatus({
          itemCount,
          pageNumber: nextTextLayer.pageNumber,
          state: itemCount > 0 ? "loaded" : "empty"
        });
      })
      .catch((error) => {
        if (!cancelled && runtimeSessionRef.current === runtimeSession) {
          debugAction("reader.text-layer-load-failed", {
            displayedPageNumber: displayedPage.pageNumber,
            documentId: document.document.id,
            error: error instanceof Error ? error.message : String(error)
          });
          setDisplayedPageTextLayer(null);
          setDisplayedPageTextDebugStatus({
            itemCount: 0,
            pageNumber,
            state: "error"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayedPageDocumentId, displayedPageNumber]);

  useEffect(() => {
    if (!document) {
      renderSequenceRef.current += 1;
      setDisplayedPage(null);
      setIncomingPage(null);
      setIncomingReady(false);
      incomingPageKeyRef.current = null;
      setIsRendering(false);
      setRenderError(null);
      setLoadingDocument(false);
      return;
    }

    const logicalKey = makePageCacheKey(document.document.id, currentPage, committedZoom);
    const cachedPage = pageCache.current.getByLogicalKey(logicalKey);
    const requestSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = requestSequence;

    debugAction("reader.render-request", {
      documentId: document.document.id,
      currentPage,
      zoom: committedZoom,
      requestSequence,
      cached: Boolean(cachedPage)
    });

    if (cachedPage) {
      if (!displayedPage) {
        setDisplayedPage(cachedPage);
        setLoadingDocument(false);
      } else if (displayedPage.requestKey !== cachedPage.requestKey) {
        incomingPageKeyRef.current = cachedPage.requestKey;
        setIncomingReady(false);
        setIncomingPage(cachedPage);
      }
      setRenderError(null);
      setIsRendering(false);
      return;
    }

    setIsRendering(true);
    setRenderError(null);
    const process = startDebugProcess("reader.render-page", {
      documentId: document.document.id,
      page: currentPage,
      zoom: committedZoom,
      requestSequence
    });

    void renderVisiblePdfPage(document.document.id, currentPage, committedZoom)
      .then((page) => {
        if (shouldIgnoreRenderResponse(requestSequence, renderSequenceRef.current)) {
          process.checkpoint("stale-response", {
            page: page.pageNumber,
            activeSequence: renderSequenceRef.current
          });
          debugAction("reader.render-stale-ignored", {
            activeSequence: renderSequenceRef.current,
            documentId: document.document.id,
            page: page.pageNumber,
            requestSequence
          });
          return;
        }

        pageCache.current.set(page.cacheKey, page);
        if (!displayedPage) {
          setDisplayedPage(page);
          setIncomingPage(null);
          setIncomingReady(false);
          incomingPageKeyRef.current = null;
          setLoadingDocument(false);
        } else {
          incomingPageKeyRef.current = page.requestKey;
          setIncomingReady(false);
          setIncomingPage(page);
        }
        setRenderError(null);
        process.finish({
          page: page.pageNumber
        });
      })
      .catch((renderFailure) => {
        if (shouldIgnoreRenderResponse(requestSequence, renderSequenceRef.current)) {
          return;
        }

        process.fail(renderFailure);
        setRenderError("Unable to render this PDF page.");
        setIsRendering(false);
        setLoadingDocument(false);
        onStatusChange("Unable to render this PDF page.");
      });
  }, [committedZoom, currentPage, displayedPage, document, onStatusChange]);

  useEffect(() => {
    if (!incomingPage || !incomingReady) {
      return;
    }

    debugAction("reader.page-swap-committed", {
      documentId: currentDocumentRef.current?.document.id ?? null,
      page: incomingPage.pageNumber
    });
    setDisplayedPage(incomingPage);
    setIncomingPage(null);
    setIncomingReady(false);
    incomingPageKeyRef.current = null;
    setIsRendering(false);
  }, [incomingPage, incomingReady]);

  useEffect(() => {
    if (!rapidTurnOverlay?.isFinalizing) {
      return;
    }

    if (displayedPage?.pageNumber === targetPage && !incomingPage && !isRendering) {
      hideRapidTurnOverlay("final-page-visible");
    }
  }, [displayedPage, incomingPage, isRendering, rapidTurnOverlay, targetPage]);

  useEffect(() => {
    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }

    if (!document || !displayedPage) {
      return;
    }

    if (displayedPage.pageNumber !== currentPage) {
      debugAction("reader.preload-skipped", {
        currentPage,
        displayedPage: displayedPage.pageNumber,
        reason: "displayed-page-not-current"
      });
      return;
    }

    const anchorPage = displayedPage.pageNumber;
    const adjacentPages = [anchorPage - 1, anchorPage + 1].filter(
      (page) => page >= 1 && page <= pageCount
    );

    if (adjacentPages.length === 0) {
      return;
    }

    preloadTimerRef.current = window.setTimeout(() => {
      if (!currentDocumentRef.current || currentDocumentRef.current.document.id !== document.document.id) {
        return;
      }

      if (displayedPage.pageNumber !== currentPage) {
        debugAction("reader.preload-skipped", {
          anchorPage,
          currentPage,
          reason: "navigation-advanced"
        });
        return;
      }

      for (const pageNumber of adjacentPages) {
        const key = makePageCacheKey(document.document.id, pageNumber, committedZoom);
        if (pageCache.current.hasLogicalKey(key) || preloadInFlight.current.has(key)) {
          debugAction("reader.preload-skipped", {
            key,
            page: pageNumber,
            reason: pageCache.current.hasLogicalKey(key) ? "cached" : "in-flight"
          });
          continue;
        }

        preloadInFlight.current.add(key);
        debugAction("reader.preload-scheduled", {
          anchorPage,
          page: pageNumber,
          zoom: committedZoom
        });
        const normalizationGeneration = normalizationGenerationRef.current;
        void renderVisiblePdfPage(document.document.id, pageNumber, committedZoom)
          .then((page) => {
            if (normalizationGeneration === normalizationGenerationRef.current) {
              pageCache.current.set(page.cacheKey, page);
            }
          })
          .finally(() => {
            preloadInFlight.current.delete(key);
          });
      }
    }, PRELOAD_DELAY_MS);

    return () => {
      if (preloadTimerRef.current !== null) {
        window.clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
    };
  }, [committedZoom, currentPage, displayedPage, document, pageCount]);

  useEffect(() => {
    const api: ViewerApi | null = document
      ? {
          nextPage: () => {
            const nextPage = clampPage(targetPage + 1, pageCount);
            requestPageTurnWithIntent(nextPage, "next-page");
          },
          previousPage: () => {
            const nextPage = clampPage(targetPage - 1, pageCount);
            requestPageTurnWithIntent(nextPage, "previous-page");
          },
          zoomIn: () => {
            updateZoom(scaleZoomByKeyboardDirection(displayZoom, "in"), "header");
          },
          zoomOut: () => {
            updateZoom(scaleZoomByKeyboardDirection(displayZoom, "out"), "header");
          },
          goToPage: (page) => {
            requestPageTurnWithIntent(clampPage(page, pageCount), "go-to-page");
          },
          navigateToTarget: (target) => {
            navigateToTarget(target, "target");
          },
          searchPort: {
            getExtractedPageNumbers: () =>
              runtimeSessionRef.current?.getExtractedPageNumbers() ?? new Set<number>(),
            getPageSearchText: async (pageNumber, signal) => {
              const runtimeSession = runtimeSessionRef.current;
              if (!runtimeSession) throw new Error("Search is unavailable for this document.");
              return runtimeSession.getPageSearchText(pageNumber, signal);
            }
          },
          jumpToOutline: (item) => {
            if (item.target) {
              navigateToTarget(item.target, "outline");
            } else if (item.page) {
              requestPageTurnWithIntent(item.page, "outline");
            }
          },
          getCurrentPage: () => targetPage,
          getPageCount: () => pageCount,
          getReaderState: () => readerState,
          setBookmarks: (bookmarks: Bookmark[]) => {
            setReaderState((current) => {
              if (!current) {
                return current;
              }
              const nextBookmarks = dedupeBookmarks(bookmarks);
              const nextState = {
                ...current,
                bookmarks: nextBookmarks
              };
              readerStateRef.current = nextState;
              markReaderStateDirty(nextState, "bookmarks", BOOKMARK_SAVE_DEBOUNCE_MS);
              onStateChange(nextState);
              return nextState;
            });
          },
          setUserOutlineItems: (items) => {
            setReaderState((current) => {
              if (!current) {
                return current;
              }
              const nextItems = dedupeOutlineItems(items);
              const nextState = {
                ...current,
                userOutlineItems: nextItems
              };
              readerStateRef.current = nextState;
              markReaderStateDirty(nextState, "outline");
              onStateChange(nextState);
              publishOutlineItems(nextItems);
              return nextState;
            });
          }
        }
      : null;

    registerApi(api);
    return () => registerApi(null);
  }, [document, onStateChange, onStatusChange, pageCount, readerState, registerApi, targetPage]);

  return {
    currentPage,
    pageCount,
    displayZoom,
    committedZoom,
    displayedPage,
    incomingPage,
    rapidTurnOverlay,
    displayedPageTextLayer,
    displayedPageTextDebugStatus,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.altKey) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const zoomInKey =
          event.key === "+" || event.key === "=" || event.key === "Add" || event.key === "NumpadAdd";
        const zoomOutKey =
          event.key === "-" || event.key === "_" || event.key === "Subtract" || event.key === "NumpadSubtract";

        if (zoomInKey || zoomOutKey) {
          event.preventDefault();
          const nextZoom = scaleZoomByKeyboardDirection(displayZoom, zoomInKey ? "in" : "out");
          debugAction("reader.zoom-keyboard", {
            currentPage,
            displayZoom,
            key: event.key,
            nextZoom
          });
          updateZoom(nextZoom, "keyboard");
        }
        return;
      }

      if (event.shiftKey) {
        return;
      }

      if (event.key === "PageDown" || event.key === "ArrowRight") {
        event.preventDefault();
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "next",
          repeat: event.repeat
        });
        requestPageTurnWithIntent(clampPage(targetPage + 1, pageCount || targetPage), "keyboard-next", {
          source: "keyboard",
          direction: "next",
          activationWindowMs: KEYBOARD_RAPID_TURN_WINDOW_MS,
          isRepeat: event.repeat
        });
      }

      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "previous",
          repeat: event.repeat
        });
        requestPageTurnWithIntent(clampPage(targetPage - 1, pageCount), "keyboard-previous", {
          source: "keyboard",
          direction: "previous",
          activationWindowMs: KEYBOARD_RAPID_TURN_WINDOW_MS,
          isRepeat: event.repeat
        });
      }
    },
    handleNavigationKeyUp(event: KeyboardEvent<HTMLDivElement>) {
      if (
        event.key !== "PageDown" &&
        event.key !== "ArrowRight" &&
        event.key !== "PageUp" &&
        event.key !== "ArrowLeft"
      ) {
        return;
      }

      const activeSession = rapidTurnSessionRef.current;
      if (activeSession.source !== "keyboard" || !activeSession.active) {
        return;
      }

      finalizeRapidTurn("keyboard-keyup");
    },
    handleWheel(event: WheelEvent<HTMLDivElement>) {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
        const nextZoom = scaleZoomByWheelDelta(displayZoom, delta);
        debugAction("reader.zoom-wheel", {
          currentPage,
          displayZoom,
          nextZoom
        });
        updateZoom(nextZoom, "wheel");
        return;
      }

      const primaryDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (primaryDelta < 0) {
        debugAction("reader.navigate-wheel", {
          direction: "previous",
          currentPage: targetPage
        });
        requestPageTurnWithIntent(clampPage(targetPage - 1, pageCount), "wheel-previous", {
          source: "wheel",
          direction: "previous",
          activationWindowMs: WHEEL_RAPID_TURN_WINDOW_MS
        });
      } else if (primaryDelta > 0) {
        debugAction("reader.navigate-wheel", {
          direction: "next",
          currentPage: targetPage
        });
        requestPageTurnWithIntent(clampPage(targetPage + 1, pageCount || targetPage), "wheel-next", {
          source: "wheel",
          direction: "next",
          activationWindowMs: WHEEL_RAPID_TURN_WINDOW_MS
        });
      }
    },
    markIncomingReady(requestKey: string, imageElement?: HTMLImageElement | null) {
      if (requestKey !== incomingPageKeyRef.current) {
        return;
      }

      const finalizeReady = () => {
        if (requestKey !== incomingPageKeyRef.current) {
          return;
        }
        setIncomingReady(true);
      };

      if (imageElement && typeof imageElement.decode === "function") {
        void imageElement.decode().then(finalizeReady).catch(() => {
          if (imageElement.complete) {
            finalizeReady();
          }
        });
        return;
      }

      finalizeReady();
    }
  };
}
