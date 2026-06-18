import type { KeyboardEvent, UIEvent, WheelEvent } from "react";
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
  ReaderSession,
  ReaderFitMode,
  ViewerApi,
  ViewerSnapshot
} from "../types";
import { createPageCache, makePageCacheKey, type CachedRenderedPage } from "./PageCache";
import {
  getCompletedRenderedPage,
  getInFlightRenderedPage,
  invalidatePdfPageRenders,
  renderVisiblePdfPage,
  startFreshPdfPageRender
} from "./PdfPageRenderer";
import { resolveAdjacentPreloadPages } from "./preloadStrategy";
import { createPdfRuntimeSession, type PdfRuntimeSession } from "./PdfRuntimeSession";
import {
  makeRapidTurnOverlayModel,
  shouldResetRapidTurnSession,
  shouldActivateRapidTurn,
  type NavigationDirection,
  type RapidTurnIntent,
  type RapidTurnLastInput,
  type RapidTurnOverlayModel
} from "./rapidTurn";
import {
  clampZoom,
  normalizeReaderFitMode,
  normalizeZoom,
  scaleZoomByKeyboardDirection,
  shouldAutoFitReaderPage,
  scaleZoomByWheelDelta
} from "./zoom";

const RENDER_CACHE_SIZE = 20;
const PRELOAD_DELAY_MS = 0;
const NAVIGATION_SAVE_DEBOUNCE_MS = 700;
const BOOKMARK_SAVE_DEBOUNCE_MS = 200;
const KEYBOARD_RAPID_TURN_WINDOW_MS = 220;
const WHEEL_RAPID_TURN_WINDOW_MS = 180;
const ZOOM_COMMIT_DEBOUNCE_MS = 120;
const WHEEL_GESTURE_IDLE_MS = 160;
const WHEEL_PAGE_TURN_THRESHOLD_PX = 56;
const WHEEL_BOUNDARY_EPSILON_PX = 1;
const DISCRETE_WHEEL_STEP_CAP_PX = 88;
const SMOOTH_WHEEL_SETTLE_EPSILON_PX = 0.5;
const SMOOTH_WHEEL_MIN_BLEND = 0.18;
const SMOOTH_WHEEL_MAX_BLEND = 0.42;
const SMOOTH_WHEEL_BASE_DURATION_MS = 110;
const MANUAL_SCROLL_BOUNDARY_SUPPRESSION_MS = 220;

type UseReaderControllerArgs = {
  readerSession: ReaderSession | null;
  pendingReaderOpenSessionId: string | null;
  onOutlineChange: (items: OutlineItem[]) => void;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  getAutoMaximizeMinDocumentWidth?: () => number | null;
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

type WheelGestureState = {
  accumulatedBoundaryDistance: number;
  direction: NavigationDirection | null;
  lastAt: number;
  pageTurned: boolean;
};

type ScrollResetPosition = "top" | "bottom";

type ScrollResetRequest = {
  pageNumber: number;
  position: ScrollResetPosition;
  token: number;
};

type SmoothWheelState = {
  ignoreScrollEvents: number;
  surface: HTMLDivElement | null;
  targetScrollTop: number;
  animationFrameId: number | null;
  lastFrameAt: number;
};

type ActiveForegroundRender = {
  logicalKey: string;
  requestId: number;
};

type ForegroundPageSource =
  | "local-cache"
  | "completed-registry"
  | "inflight-join"
  | "fresh-render";

type ForegroundPhase = "acquire" | "assign" | "promote";

type PagePresentation = {
  navigationGeneration: number;
  requestId: number;
  source: ForegroundPageSource;
  targetPage: number;
};

export type PresentedPage = CachedRenderedPage & {
  presentation: PagePresentation;
};

type ForegroundPageCandidate = {
  navigationGeneration: number;
  openSessionId: string | null;
  page: CachedRenderedPage;
  requestId: number;
  source: ForegroundPageSource;
  targetPage: number;
};

type ManualScrollState = {
  active: boolean;
  suppressBoundaryUntil: number;
};

type IdleCallbackHandle = number;

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type ReaderOpenMetrics = {
  cacheHit: boolean;
  clickStartedAtMs: number | null;
  documentId: string | null;
  firstRenderRequestAtMs: number | null;
  openSessionId: string | null;
  page: number | null;
  pdfRuntimeStartedBeforeVisible: boolean;
  renderResponseReceivedAtMs: number | null;
  source: ReaderSession["source"];
  staleRequestCount: number;
  summaryLogged: boolean;
  zoom: number | null;
};

type PreloadReadyTarget = {
  documentId: string;
  pageNumber: number;
  requestKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type NormalizationReadyEvent = {
  documentId: string;
  fingerprint: string;
  token: string;
};

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(pageCount, 1));
}

function makeReaderSessionKey(readerSession: ReaderSession | null) {
  if (!readerSession) {
    return null;
  }

  return `${readerSession.documentId}:${readerSession.openSessionId}`;
}

function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  viewportSize: number
) {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * Math.max(viewportSize, 1);
  }
  return delta;
}

function isLikelyDiscreteWheelInput(event: WheelEvent<HTMLDivElement>) {
  if (event.deltaMode !== 0) {
    return true;
  }

  const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
    ? Math.abs(event.deltaY)
    : Math.abs(event.deltaX);

  if (primaryDelta === 0) {
    return false;
  }

  return Number.isInteger(primaryDelta) && primaryDelta >= 8;
}

function clampDiscreteWheelDelta(delta: number) {
  return Math.sign(delta) * Math.min(Math.abs(delta), DISCRETE_WHEEL_STEP_CAP_PX);
}

function normalizeDocumentState(state: DocumentState): DocumentState {
  const rawPreferences: Record<string, unknown> = isRecord(state.preferences)
    ? state.preferences
    : {};

  return {
    ...state,
    bookmarks: dedupeBookmarks(state.bookmarks ?? []),
    preferences: {
      fitMode: normalizeReaderFitMode(rawPreferences.fitMode)
    },
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
  readerSession,
  pendingReaderOpenSessionId,
  onOutlineChange,
  onSnapshotChange,
  onStatusChange,
  onStateChange,
  registerApi,
  getAutoMaximizeMinDocumentWidth
}: UseReaderControllerArgs) {
  const document = readerSession?.document ?? null;
  const openSessionId = readerSession?.openSessionId ?? null;
  const readerSessionKey = makeReaderSessionKey(readerSession);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [displayZoom, setDisplayZoom] = useState(1);
  const [committedZoom, setCommittedZoom] = useState(1);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [displayedPage, setDisplayedPage] = useState<PresentedPage | null>(null);
  const [incomingPage, setIncomingPage] = useState<PresentedPage | null>(null);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);
  const [initialStateResolved, setInitialStateResolved] = useState(false);
  const [preloadReadyTarget, setPreloadReadyTarget] = useState<PreloadReadyTarget | null>(null);
  const [postVisibleWorkReadyKey, setPostVisibleWorkReadyKey] = useState<string | null>(null);
  const [displayedPageTextLayer, setDisplayedPageTextLayer] = useState<PageTextLayerData | null>(null);
  const [displayedPageTextDebugStatus, setDisplayedPageTextDebugStatus] =
    useState<DisplayedPageTextDebugStatus>({
      itemCount: 0,
      pageNumber: null,
      state: "missing"
    });
  const [rapidTurnOverlay, setRapidTurnOverlay] = useState<RapidTurnOverlayModel | null>(null);
  const [scrollResetRequest, setScrollResetRequest] = useState<ScrollResetRequest | null>(null);

  const runtimeSessionRef = useRef<PdfRuntimeSession | null>(null);
  const pageCache = useRef(createPageCache(RENDER_CACHE_SIZE));
  const preloadInFlight = useRef(new Set<string>());
  const navigationGenerationRef = useRef(0);
  const navigationTargetPageRef = useRef(1);
  const pageCountRef = useRef(0);
  const displayZoomRef = useRef(1);
  const renderSequenceRef = useRef(0);
  const latestForegroundRequestIdRef = useRef(0);
  const activeForegroundRenderRef = useRef<ActiveForegroundRender | null>(null);
  const normalizationGenerationRef = useRef(0);
  const documentGenerationRef = useRef(0);
  const incomingPageKeyRef = useRef<string | null>(null);
  const initializedDocumentIdRef = useRef<string | null>(null);
  const outlineLoadedForDocumentIdRef = useRef<string | null>(null);
  const embeddedOutlineItemsRef = useRef<OutlineItem[]>([]);
  const currentDocumentRef = useRef<DocumentPayload | null>(null);
  const displayedPageRef = useRef<PresentedPage | null>(null);
  const incomingPageRef = useRef<PresentedPage | null>(null);
  const readerStateRef = useRef<DocumentState | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  const dirtyStateRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const preloadTimerRef = useRef<number | null>(null);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const rapidTurnWheelFinalizeTimerRef = useRef<number | null>(null);
  const rapidTurnLastInputRef = useRef<RapidTurnLastInput | null>(null);
  const lastNavigationDirectionRef = useRef<NavigationDirection | null>(null);
  const autoMaximizeZoomRef = useRef<number | null>(null);
  const rapidTurnSessionRef = useRef<RapidTurnSession>({
    active: false,
    direction: null,
    source: null,
    targetPage: 1
  });
  const wheelGestureRef = useRef<WheelGestureState>({
    accumulatedBoundaryDistance: 0,
    direction: null,
    lastAt: 0,
    pageTurned: false
  });
  const scrollResetTokenRef = useRef(0);
  const smoothWheelStateRef = useRef<SmoothWheelState>({
    ignoreScrollEvents: 0,
    surface: null,
    targetScrollTop: 0,
    animationFrameId: null,
    lastFrameAt: 0
  });
  const manualScrollStateRef = useRef<ManualScrollState>({
    active: false,
    suppressBoundaryUntil: 0
  });
  const firstRenderRequestedSessionRef = useRef<string | null>(null);
  const postVisibleIdleHandleRef = useRef<IdleCallbackHandle | null>(null);
  const initializedReaderSessionKeyRef = useRef<string | null>(null);
  const finalizeRapidTurnListenerRef = useRef<(reason: string) => void>(() => undefined);
  const flushReaderStateListenerRef = useRef<(reason: string) => void>(() => undefined);
  const openMetricsRef = useRef<ReaderOpenMetrics>({
    cacheHit: false,
    clickStartedAtMs: null,
    documentId: null,
    firstRenderRequestAtMs: null,
    openSessionId: null,
    page: null,
    pdfRuntimeStartedBeforeVisible: false,
    renderResponseReceivedAtMs: null,
    source: "unknown",
    staleRequestCount: 0,
    summaryLogged: false,
    zoom: null
  });

  function resetOpenMetrics() {
    openMetricsRef.current = {
      cacheHit: false,
      clickStartedAtMs: readerSession?.clickStartedAtMs ?? null,
      documentId: readerSession?.documentId ?? null,
      firstRenderRequestAtMs: null,
      openSessionId: readerSession?.openSessionId ?? null,
      page: readerSession?.page ?? null,
      pdfRuntimeStartedBeforeVisible: false,
      renderResponseReceivedAtMs: null,
      source: readerSession?.source ?? "unknown",
      staleRequestCount: 0,
      summaryLogged: false,
      zoom: readerSession?.zoom ?? null
    };
  }

  const backgroundWorkSuspended =
    pendingReaderOpenSessionId !== null && pendingReaderOpenSessionId !== openSessionId;

  navigationTargetPageRef.current = targetPage;
  pageCountRef.current = pageCount;
  displayZoomRef.current = displayZoom;
  displayedPageRef.current = displayedPage;
  incomingPageRef.current = incomingPage;

  function cancelPostVisibleIdleWork() {
    const activeHandle = postVisibleIdleHandleRef.current;
    if (activeHandle === null) {
      return;
    }

    window.cancelAnimationFrame(activeHandle);
    window.clearTimeout(activeHandle);

    postVisibleIdleHandleRef.current = null;
  }

  function schedulePostVisibleIdleWork(requestKey: string) {
    cancelPostVisibleIdleWork();

    const commitReady = () => {
      postVisibleIdleHandleRef.current = null;
      setPostVisibleWorkReadyKey((currentKey) => (currentKey === requestKey ? currentKey : requestKey));
      debugAction("reader.post-visible-work-ready", {
        documentId: currentDocumentRef.current?.document.id ?? null,
        openSessionId,
        requestKey
      });
    };

    // Text selection should become available as soon as the visible page settles,
    // so gate post-visible work by the next frame instead of waiting for idle time.
    postVisibleIdleHandleRef.current =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            commitReady();
          })
        : window.setTimeout(commitReady, 16);
  }

  function markPageReadyForPreload(target: PreloadReadyTarget) {
    debugAction("reader.preload-ready-received", {
      displayedPage: displayedPage?.pageNumber ?? null,
      documentId: target.documentId,
      incomingPage: incomingPage?.pageNumber ?? null,
      page: target.pageNumber,
      requestKey: target.requestKey
    });
    setPreloadReadyTarget((currentTarget) =>
      currentTarget &&
      currentTarget.documentId === target.documentId &&
      currentTarget.pageNumber === target.pageNumber &&
      currentTarget.requestKey === target.requestKey
        ? currentTarget
        : target
    );
  }

  function recordNavigationIntent(
    nextPage: number,
    reason: string,
    previousTargetPage: number | null
  ) {
    const previousGeneration = navigationGenerationRef.current;
    const nextGeneration = previousGeneration + 1;
    navigationGenerationRef.current = nextGeneration;
    navigationTargetPageRef.current = nextPage;
    debugAction("reader.navigation-intent", {
      currentGeneration: previousGeneration,
      navigationGeneration: nextGeneration,
      previousTargetPage,
      reason,
      targetPage: nextPage
    });
  }

  function isLatestNavigationIntent(navigationGeneration: number, resultPage: number) {
    return (
      navigationGeneration === navigationGenerationRef.current &&
      resultPage === navigationTargetPageRef.current
    );
  }

  function buildPresentedPage(candidate: ForegroundPageCandidate): PresentedPage {
    return {
      ...candidate.page,
      presentation: {
        navigationGeneration: candidate.navigationGeneration,
        requestId: candidate.requestId,
        source: candidate.source,
        targetPage: candidate.targetPage
      }
    };
  }

  function toForegroundCandidate(page: PresentedPage): ForegroundPageCandidate {
    return {
      navigationGeneration: page.presentation.navigationGeneration,
      openSessionId,
      page,
      requestId: page.presentation.requestId,
      source: page.presentation.source,
      targetPage: page.presentation.targetPage
    };
  }

  function logForegroundResult(
    event: "reader.render-result-accepted" | "reader.render-result-discarded",
    candidate: ForegroundPageCandidate,
    phase: ForegroundPhase
  ) {
    debugAction(event, {
      currentGeneration: navigationGenerationRef.current,
      currentTargetPage: navigationTargetPageRef.current,
      navigationGeneration: candidate.navigationGeneration,
      openSessionId: candidate.openSessionId,
      page: candidate.page.pageNumber,
      phase,
      requestId: candidate.requestId,
      resultPage: candidate.page.pageNumber,
      source: candidate.source,
      targetPage: candidate.targetPage
    });
  }

  function shouldAcceptForegroundCandidate(
    candidate: ForegroundPageCandidate,
    phase: ForegroundPhase
  ) {
    const activeDocumentId = currentDocumentRef.current?.document.id ?? null;
    const candidateDocumentId = candidate.page.documentId;
    if (
      activeDocumentId !== candidateDocumentId ||
      candidate.navigationGeneration !== navigationGenerationRef.current ||
      candidate.requestId !== latestForegroundRequestIdRef.current ||
      candidate.targetPage !== navigationTargetPageRef.current ||
      candidate.page.pageNumber !== navigationTargetPageRef.current
    ) {
      logForegroundResult("reader.render-result-discarded", candidate, phase);
      return false;
    }

    logForegroundResult("reader.render-result-accepted", candidate, phase);
    return true;
  }

  function assignForegroundPage(candidate: ForegroundPageCandidate) {
    if (!shouldAcceptForegroundCandidate(candidate, "assign")) {
      if (activeForegroundRenderRef.current?.requestId === candidate.requestId) {
        activeForegroundRenderRef.current = null;
      }
      return false;
    }

    pageCache.current.set(candidate.page.cacheKey, candidate.page);
    const presentedPage = buildPresentedPage(candidate);
    const currentDisplayedPage = displayedPageRef.current;
    const currentIncomingPage = incomingPageRef.current;

    if (currentDisplayedPage?.requestKey === presentedPage.requestKey) {
      setDisplayedPage(presentedPage);
      setCurrentPage(presentedPage.pageNumber);
      setLoadingDocument(false);
      setRenderError(null);
      if (!currentIncomingPage || currentIncomingPage.requestKey === presentedPage.requestKey) {
        setIsRendering(false);
      }
      if (activeForegroundRenderRef.current?.requestId === candidate.requestId) {
        activeForegroundRenderRef.current = null;
      }
      return true;
    }

    if (currentIncomingPage?.requestKey === presentedPage.requestKey) {
      setIncomingPage(presentedPage);
      setRenderError(null);
      if (activeForegroundRenderRef.current?.requestId === candidate.requestId) {
        activeForegroundRenderRef.current = null;
      }
      return true;
    }

    if (!currentDisplayedPage) {
      setDisplayedPage(presentedPage);
      setCurrentPage(presentedPage.pageNumber);
      setIncomingPage(null);
      incomingPageKeyRef.current = null;
      setLoadingDocument(false);
      setRenderError(null);
      setIsRendering(false);
      if (activeForegroundRenderRef.current?.requestId === candidate.requestId) {
        activeForegroundRenderRef.current = null;
      }
      return true;
    }

    incomingPageKeyRef.current = presentedPage.requestKey;
    setIncomingPage(presentedPage);
    setRenderError(null);
    if (activeForegroundRenderRef.current?.requestId === candidate.requestId) {
      activeForegroundRenderRef.current = null;
    }
    return true;
  }

  function acquireForegroundPage(
    nextPage: number,
    nextZoom: number,
    navigationGeneration: number,
    requestId: number
  ) {
    const logicalKey = makePageCacheKey(document?.document.id ?? "", nextPage, nextZoom);
    const localCachedPage = pageCache.current.getByLogicalKey(logicalKey);
    if (localCachedPage) {
      return {
        logicalKey,
        mode: "immediate" as const,
        candidate: {
          navigationGeneration,
          openSessionId,
          page: localCachedPage,
          requestId,
          source: "local-cache" as const,
          targetPage: nextPage
        }
      };
    }

    if (!document) {
      return null;
    }

    const completedPage = getCompletedRenderedPage(
      document.document.id,
      nextPage,
      nextZoom,
      "foreground"
    );
    if (completedPage) {
      return {
        logicalKey,
        mode: "immediate" as const,
        candidate: {
          navigationGeneration,
          openSessionId,
          page: completedPage,
          requestId,
          source: "completed-registry" as const,
          targetPage: nextPage
        }
      };
    }

    const joinedRender = getInFlightRenderedPage(
      document.document.id,
      nextPage,
      nextZoom,
      "foreground"
    );
    if (joinedRender) {
      return {
        logicalKey,
        mode: "async" as const,
        source: "inflight-join" as const,
        promise: joinedRender
      };
    }

    return {
      logicalKey,
      mode: "async" as const,
      source: "fresh-render" as const,
      promise: startFreshPdfPageRender(document.document.id, nextPage, nextZoom, {
        caller: "foreground",
        openSessionId,
        requestSequence: requestId
      })
    };
  }

  function resetWheelGesture(options?: { clearRapidTurnInput?: boolean }) {
    wheelGestureRef.current = {
      accumulatedBoundaryDistance: 0,
      direction: null,
      lastAt: 0,
      pageTurned: false
    };

    if (options?.clearRapidTurnInput && rapidTurnLastInputRef.current?.source === "wheel") {
      rapidTurnLastInputRef.current = null;
    }
  }

  useEffect(() => {
    if (!backgroundWorkSuspended) {
      return;
    }

    cancelPostVisibleIdleWork();
    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    setPreloadReadyTarget(null);
    setPostVisibleWorkReadyKey(null);
  }, [backgroundWorkSuspended]);

  function cancelSmoothWheelAnimation() {
    const smoothWheelState = smoothWheelStateRef.current;
    if (smoothWheelState.animationFrameId !== null) {
      window.cancelAnimationFrame(smoothWheelState.animationFrameId);
    }
    smoothWheelState.animationFrameId = null;
    smoothWheelState.lastFrameAt = 0;
  }

  function syncSmoothWheelStateToSurface(
    scrollSurface: HTMLDivElement,
    options?: { cancelAnimation?: boolean }
  ) {
    if (options?.cancelAnimation) {
      cancelSmoothWheelAnimation();
    }

    const smoothWheelState = smoothWheelStateRef.current;
    smoothWheelState.surface = scrollSurface;
    smoothWheelState.targetScrollTop = scrollSurface.scrollTop;
    wheelGestureRef.current.accumulatedBoundaryDistance = 0;
    wheelGestureRef.current.pageTurned = false;
  }

  function suppressBoundaryNavigationWindow(durationMs = MANUAL_SCROLL_BOUNDARY_SUPPRESSION_MS) {
    manualScrollStateRef.current.suppressBoundaryUntil = Date.now() + durationMs;
  }

  function cancelQueuedScrollReset(pageNumber?: number) {
    setScrollResetRequest((currentRequest) => {
      if (!currentRequest) {
        return currentRequest;
      }

      if (typeof pageNumber === "number" && currentRequest.pageNumber !== pageNumber) {
        return currentRequest;
      }

      return null;
    });
  }

  function beginManualScroll(scrollSurface: HTMLDivElement) {
    manualScrollStateRef.current.active = true;
    suppressBoundaryNavigationWindow();
    cancelQueuedScrollReset(displayedPage?.pageNumber ?? currentPage);
    syncSmoothWheelStateToSurface(scrollSurface, { cancelAnimation: true });
  }

  function endManualScroll() {
    manualScrollStateRef.current.active = false;
    suppressBoundaryNavigationWindow();
  }

  function shouldSuppressBoundaryNavigation(now: number) {
    const manualScrollState = manualScrollStateRef.current;
    return (
      manualScrollState.active || now < manualScrollState.suppressBoundaryUntil
    );
  }

  function animateSmoothWheelScroll() {
    const smoothWheelState = smoothWheelStateRef.current;
    const scrollSurface = smoothWheelState.surface;
    if (!scrollSurface) {
      cancelSmoothWheelAnimation();
      return;
    }

    const step = (timestamp: number) => {
      const activeState = smoothWheelStateRef.current;
      const activeSurface = activeState.surface;
      if (!activeSurface) {
        cancelSmoothWheelAnimation();
        return;
      }

      const previousFrameAt = activeState.lastFrameAt || timestamp;
      const elapsed = Math.max(timestamp - previousFrameAt, 1);
      activeState.lastFrameAt = timestamp;

      const delta = activeState.targetScrollTop - activeSurface.scrollTop;
      if (Math.abs(delta) <= SMOOTH_WHEEL_SETTLE_EPSILON_PX) {
        activeSurface.scrollTop = activeState.targetScrollTop;
        activeState.animationFrameId = null;
        activeState.lastFrameAt = 0;
        return;
      }

      const blend = Math.min(
        SMOOTH_WHEEL_MAX_BLEND,
        Math.max(SMOOTH_WHEEL_MIN_BLEND, elapsed / SMOOTH_WHEEL_BASE_DURATION_MS)
      );
      activeState.ignoreScrollEvents += 1;
      activeSurface.scrollTop += delta * blend;
      activeState.animationFrameId = window.requestAnimationFrame(step);
    };

    if (smoothWheelState.animationFrameId === null) {
      smoothWheelState.lastFrameAt = 0;
      smoothWheelState.animationFrameId = window.requestAnimationFrame(step);
    }
  }

  function queueSmoothWheelScroll(scrollSurface: HTMLDivElement, nextScrollTop: number) {
    const smoothWheelState = smoothWheelStateRef.current;
    if (smoothWheelState.surface !== scrollSurface) {
      syncSmoothWheelStateToSurface(scrollSurface, { cancelAnimation: true });
    }

    smoothWheelState.targetScrollTop = nextScrollTop;
    animateSmoothWheelScroll();
  }

  function queueScrollReset(pageNumber: number, position: ScrollResetPosition) {
    scrollResetTokenRef.current += 1;
    setScrollResetRequest({
      pageNumber,
      position,
      token: scrollResetTokenRef.current
    });
  }

  function resolveScrollResetPosition(
    nextPage: number,
    currentTargetPage: number,
    reason: string
  ): ScrollResetPosition {
    if (reason === "go-to-page" || reason === "target" || reason === "outline") {
      return "top";
    }

    if (reason.includes("previous")) {
      return "bottom";
    }

    if (reason.includes("next")) {
      return "top";
    }

    return nextPage < currentTargetPage ? "bottom" : "top";
  }

  function clearRapidTurnWheelFinalizeTimer() {
    if (rapidTurnWheelFinalizeTimerRef.current !== null) {
      window.clearTimeout(rapidTurnWheelFinalizeTimerRef.current);
      rapidTurnWheelFinalizeTimerRef.current = null;
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

  function setReaderFitMode(nextFitMode: ReaderFitMode, reason: string) {
    const normalizedFitMode = normalizeReaderFitMode(nextFitMode);
    setReaderState((current) => {
      if (!current || current.preferences.fitMode === normalizedFitMode) {
        return current;
      }

      const nextState = {
        ...current,
        preferences: {
          ...current.preferences,
          fitMode: normalizedFitMode
        }
      };

      readerStateRef.current = nextState;
      markReaderStateDirty(nextState, reason);
      onStateChange(nextState);
      return nextState;
    });
  }

  function resolveZoomForFitMode(nextZoom: number, fitMode: ReaderFitMode) {
    const normalizedFitMode = normalizeReaderFitMode(fitMode);
    if (normalizedFitMode !== "auto-maximize") {
      return normalizeZoom(nextZoom);
    }

    const autoMaximizeZoom = autoMaximizeZoomRef.current;
    if (typeof autoMaximizeZoom !== "number" || !Number.isFinite(autoMaximizeZoom)) {
      return normalizeZoom(nextZoom);
    }

    return normalizeZoom(Math.min(nextZoom, autoMaximizeZoom));
  }

  function updateZoom(
    nextZoom: number,
    reason: string,
    options?: {
      commitImmediately?: boolean;
      fitMode?: ReaderFitMode;
    }
  ) {
    const resolvedFitMode = options?.fitMode ?? readerStateRef.current?.preferences.fitMode ?? "auto-maximize";
    const normalizedZoom = resolveZoomForFitMode(nextZoom, resolvedFitMode);
    if (options?.fitMode && options.fitMode !== readerStateRef.current?.preferences.fitMode) {
      setReaderFitMode(options.fitMode, `${reason}:fit-mode`);
    }
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

  function resetRapidTurnSession(reason: string) {
    rapidTurnLastInputRef.current = null;
    hideRapidTurnOverlay(reason);
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
      updateZoom(target.zoom, reason, {
        commitImmediately: true,
        fitMode: "free"
      });
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

    if (displayedPage?.pageNumber === nextPage && !incomingPage && !isRendering) {
      hideRapidTurnOverlay(`${reason}:ready`);
      return;
    }

    updateRapidTurnSession(nextPage, true);
  }

  function noteRapidTurnIntent(intent: RapidTurnIntent, nextPage: number) {
    const now = Date.now();
    const activeSession = rapidTurnSessionRef.current;

    if (shouldResetRapidTurnSession(activeSession, intent)) {
      hideRapidTurnOverlay("stream-changed");
      rapidTurnLastInputRef.current = {
        at: now,
        direction: intent.direction,
        source: intent.source
      };
      return;
    }

    const shouldActivate = shouldActivateRapidTurn(rapidTurnLastInputRef.current, intent, now);

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
        debugAction("reader.page-request-ignored", {
          currentGeneration: navigationGenerationRef.current,
          currentTargetPage,
          nextPage,
          reason
        });
        return currentTargetPage;
      }

      recordNavigationIntent(nextPage, reason, currentTargetPage);

      lastNavigationDirectionRef.current =
        nextPage > currentTargetPage ? "next" : "previous";

      queueScrollReset(
        nextPage,
        resolveScrollResetPosition(nextPage, currentTargetPage, reason)
      );

      if (intent) {
        noteRapidTurnIntent(intent, nextPage);
      } else {
        resetRapidTurnSession(`${reason}:non-rapid-navigation`);
        resetWheelGesture();
      }

      debugAction("reader.page-request", {
        nextPage,
        previousPage: currentTargetPage,
        reason
      });
      return nextPage;
    });
    debugAction("reader.page-commit", {
      page: nextPage,
      reason
    });
  }

  finalizeRapidTurnListenerRef.current = finalizeRapidTurn;
  flushReaderStateListenerRef.current = flushReaderState;

  useEffect(() => {
    const nextDocumentId = document?.document.id ?? null;
    const sameDocumentId = nextDocumentId === initializedDocumentIdRef.current;
    const sameReaderSessionKey = readerSessionKey === initializedReaderSessionKeyRef.current;

    if (sameDocumentId && sameReaderSessionKey) {
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
    const previousDocumentId = previousDocument?.document.id ?? null;
    const shouldRecreateRuntimeSession =
      (!previousRuntimeSession && Boolean(document)) || previousDocumentId !== nextDocumentId;
    if (shouldRecreateRuntimeSession) {
      runtimeSessionRef.current = document ? createPdfRuntimeSession(document.document.id) : null;
    }
    if (previousRuntimeSession && previousDocumentId !== nextDocumentId) {
      void previousRuntimeSession.dispose();
    }

    initializedDocumentIdRef.current = nextDocumentId;
    initializedReaderSessionKeyRef.current = null;
    currentDocumentRef.current = document;
    resetOpenMetrics();
    pageCache.current.clear();
    preloadInFlight.current.clear();
    documentGenerationRef.current += 1;
    navigationGenerationRef.current = 0;
    navigationTargetPageRef.current = 1;
    renderSequenceRef.current += 1;
    latestForegroundRequestIdRef.current = renderSequenceRef.current;
    activeForegroundRenderRef.current = null;
    firstRenderRequestedSessionRef.current = null;
    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    clearRapidTurnWheelFinalizeTimer();
    rapidTurnLastInputRef.current = null;
    rapidTurnSessionRef.current = {
      active: false,
      direction: null,
      source: null,
      targetPage: 1
    };
    lastNavigationDirectionRef.current = null;
    resetWheelGesture();
    manualScrollStateRef.current = {
      active: false,
      suppressBoundaryUntil: 0
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
    cancelSmoothWheelAnimation();
    smoothWheelStateRef.current.ignoreScrollEvents = 0;
    smoothWheelStateRef.current.surface = null;
    smoothWheelStateRef.current.targetScrollTop = 0;
    autoMaximizeZoomRef.current = null;
    setScrollResetRequest(null);
    setIsRendering(false);
    setDisplayedPage(null);
    setIncomingPage(null);
    setRapidTurnOverlay(null);
    incomingPageKeyRef.current = null;
    setInitialStateResolved(false);
    cancelPostVisibleIdleWork();
    setPreloadReadyTarget(null);
    setPostVisibleWorkReadyKey(null);
    onOutlineChange([]);

    if (!document) {
      setPageCount(0);
      setCurrentPage(1);
      setTargetPage(1);
      navigationTargetPageRef.current = 1;
      latestForegroundRequestIdRef.current = 0;
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
    const nextPage = clampPage(readerSession?.page ?? document.state.lastPage, nextPageCount);
    const nextZoom = clampZoom(readerSession?.zoom ?? document.state.zoom ?? 1);
    latestForegroundRequestIdRef.current = 0;
    setPageCount(nextPageCount);
    setCurrentPage(nextPage);
    setTargetPage(nextPage);
    recordNavigationIntent(nextPage, "document-open", null);
    clearZoomCommitTimer();
    setDisplayZoom(nextZoom);
    setCommittedZoom(nextZoom);
    debugAction("reader.initial-page:resolved", {
      documentId: document.document.id,
      openSessionId,
      page: nextPage,
      pageCount: nextPageCount,
      source: "stored-state",
      zoom: nextZoom
    });
    const rawNextState = {
      ...document.state,
      lastPage: nextPage,
      zoom: nextZoom,
      preferences: document.state.preferences ?? { fitMode: "auto-maximize" },
      userOutlineItems: document.state.userOutlineItems ?? []
    };
    const nextState = normalizeDocumentState(rawNextState);
    const stateWasNormalized =
      JSON.stringify(rawNextState.bookmarks ?? []) !== JSON.stringify(nextState.bookmarks) ||
      JSON.stringify(rawNextState.preferences ?? null) !== JSON.stringify(nextState.preferences) ||
      JSON.stringify(rawNextState.userOutlineItems ?? []) !==
        JSON.stringify(nextState.userOutlineItems);
    clearScheduledSave();
    dirtyStateRef.current = false;
    lastPersistedSignatureRef.current = stateSignature(nextState);
    updateReaderState(nextState);
    onOutlineChange(nextState.userOutlineItems);
    if (stateWasNormalized) {
      markReaderStateDirty(nextState, "dedupe-reader-state", BOOKMARK_SAVE_DEBOUNCE_MS, {
        force: true
      });
    }
    initializedReaderSessionKeyRef.current = readerSessionKey;
    setInitialStateResolved(true);
    onStatusChange(`Opened ${nextPageCount} pages.`);
  }, [onOutlineChange, onStateChange, onStatusChange, readerSession, readerSessionKey]);

  useEffect(() => {
    return () => {
      const runtimeSession = runtimeSessionRef.current;
      runtimeSessionRef.current = null;
      cancelSmoothWheelAnimation();
      smoothWheelStateRef.current.ignoreScrollEvents = 0;
      manualScrollStateRef.current = {
        active: false,
        suppressBoundaryUntil: 0
      };
      clearZoomCommitTimer();
      cancelPostVisibleIdleWork();
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
      documentGenerationRef.current += 1;
      renderSequenceRef.current += 1;
      latestForegroundRequestIdRef.current = renderSequenceRef.current;
      pageCache.current.clear();
      preloadInFlight.current.clear();
      invalidatePdfPageRenders(event.payload.documentId);
      setIncomingPage(null);
      incomingPageKeyRef.current = null;
      setIsRendering(false);
      activeForegroundRenderRef.current = null;
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
        flushReaderStateListenerRef.current("document-hidden");
      }
    }

    function flushOnWindowBlur() {
      finalizeRapidTurnListenerRef.current("window-blur");
      flushReaderStateListenerRef.current("window-blur");
    }

    function flushOnBeforeUnload() {
      flushReaderStateListenerRef.current("before-unload");
    }

    window.document.addEventListener("visibilitychange", flushOnVisibilityChange);
    window.addEventListener("blur", flushOnWindowBlur);
    window.addEventListener("beforeunload", flushOnBeforeUnload);

    return () => {
      window.document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      window.removeEventListener("blur", flushOnWindowBlur);
      window.removeEventListener("beforeunload", flushOnBeforeUnload);
      clearZoomCommitTimer();
      finalizeRapidTurnListenerRef.current("controller-unmount");
      flushReaderStateListenerRef.current("controller-unmount");
    };
  }, []);

  useEffect(() => {
    onSnapshotChange({
      currentPage,
      pageCount,
      zoom: displayZoom
    });
  }, [currentPage, displayZoom, onSnapshotChange, pageCount]);

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

    if (backgroundWorkSuspended) {
      return;
    }

    if (postVisibleWorkReadyKey !== displayedPage.requestKey) {
      return;
    }

    const runtimeSession = runtimeSessionRef.current;
    if (!runtimeSession) {
      return;
    }

    void runtimeSession.load().catch(() => undefined);
  }, [backgroundWorkSuspended, displayedPage, document, postVisibleWorkReadyKey]);

  useEffect(() => {
    if (!document || !displayedPage) {
      return;
    }

    if (backgroundWorkSuspended) {
      return;
    }

    if (postVisibleWorkReadyKey !== displayedPage.requestKey) {
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
  }, [backgroundWorkSuspended, displayedPage, document, onOutlineChange, postVisibleWorkReadyKey]);

  const displayedPageDocumentId = displayedPage?.documentId ?? null;
  const displayedPageNumber = displayedPage?.pageNumber ?? null;
  const displayedPageRequestKey = displayedPage?.requestKey ?? null;

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

    if (backgroundWorkSuspended) {
      setDisplayedPageTextLayer(null);
      setDisplayedPageTextDebugStatus({
        itemCount: 0,
        pageNumber: displayedPage.pageNumber,
        state: "missing"
      });
      return;
    }

    if (displayedPage.documentId !== document.document.id) {
      debugAction("reader.text-layer-cleared", {
        displayedPageDocumentId: displayedPage.documentId,
        displayedPageNumber: displayedPage.pageNumber,
        documentId: document.document.id,
        reason: "page-document-mismatch"
      });
      setDisplayedPageTextLayer(null);
      setDisplayedPageTextDebugStatus({
        itemCount: 0,
        pageNumber: displayedPage.pageNumber,
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
  }, [backgroundWorkSuspended, displayedPageDocumentId, displayedPageNumber, displayedPageRequestKey]);

  useEffect(() => {
    if (!document) {
      renderSequenceRef.current += 1;
      activeForegroundRenderRef.current = null;
      setDisplayedPage(null);
      setIncomingPage(null);
      incomingPageKeyRef.current = null;
      setIsRendering(false);
      setRenderError(null);
      setLoadingDocument(false);
      return;
    }

    if (!initialStateResolved) {
      return;
    }

    if (initializedReaderSessionKeyRef.current !== readerSessionKey) {
      debugAction("reader.render-session-waiting", {
        documentId: document.document.id,
        openSessionId,
        requestedSessionKey: readerSessionKey,
        initializedSessionKey: initializedReaderSessionKeyRef.current,
        currentPage,
        zoom: committedZoom
      });
      return;
    }

    const renderPage = targetPage;
    const renderZoom = committedZoom;
    const navigationGeneration = navigationGenerationRef.current;

    if (openSessionId && firstRenderRequestedSessionRef.current !== openSessionId) {
      openMetricsRef.current.firstRenderRequestAtMs = performance.now();
      openMetricsRef.current.page = renderPage;
      openMetricsRef.current.zoom = renderZoom;
      debugAction("reader.render:first-request", {
        documentId: document.document.id,
        openSessionId,
        source: openMetricsRef.current.source,
        page: renderPage,
        zoom: renderZoom
      });
      firstRenderRequestedSessionRef.current = openSessionId;
    }

    const logicalKey = makePageCacheKey(document.document.id, renderPage, renderZoom);
    const currentDisplayedPage = displayedPageRef.current;
    const currentIncomingPage = incomingPageRef.current;

    if (currentDisplayedPage?.logicalKey === logicalKey) {
      if (currentIncomingPage && currentIncomingPage.logicalKey !== logicalKey) {
        setIncomingPage(null);
        incomingPageKeyRef.current = null;
      }
      activeForegroundRenderRef.current = null;
      setIsRendering(false);
      setRenderError(null);
      setLoadingDocument(false);
      return;
    }

    if (currentIncomingPage?.logicalKey === logicalKey) {
      setRenderError(null);
      return;
    }

    if (activeForegroundRenderRef.current?.logicalKey === logicalKey) {
      debugAction("reader.render-deduped", {
        documentId: document.document.id,
        openSessionId,
        page: renderPage,
        requestId: activeForegroundRenderRef.current.requestId,
        zoom: renderZoom
      });
      return;
    }

    const requestId = renderSequenceRef.current + 1;
    renderSequenceRef.current = requestId;
    latestForegroundRequestIdRef.current = requestId;
    activeForegroundRenderRef.current = {
      logicalKey,
      requestId
    };

    const acquisition = acquireForegroundPage(renderPage, renderZoom, navigationGeneration, requestId);
    if (!acquisition) {
      if (activeForegroundRenderRef.current?.requestId === requestId) {
        activeForegroundRenderRef.current = null;
      }
      return;
    }

    debugAction("reader.render-request", {
      cached: acquisition.mode === "immediate",
      documentId: document.document.id,
      openSessionId,
      currentPage: renderPage,
      currentGeneration: navigationGenerationRef.current,
      navigationGeneration,
      requestId,
      source: acquisition.mode === "immediate" ? acquisition.candidate.source : acquisition.source,
      targetPage: renderPage,
      zoom: renderZoom
    });

    if (acquisition.mode === "immediate") {
      const acceptedCandidate = acquisition.candidate;
      openMetricsRef.current.cacheHit = true;
      openMetricsRef.current.renderResponseReceivedAtMs = performance.now();
      openMetricsRef.current.page = acceptedCandidate.page.pageNumber;
      openMetricsRef.current.zoom = renderZoom;
      debugAction(
        acceptedCandidate.source === "local-cache"
          ? "reader.foreground-local-page-cache-hit"
          : "reader.foreground-completed-registry-hit",
        {
          anchorPage: currentDisplayedPage?.pageNumber ?? renderPage,
          cacheKey: acceptedCandidate.page.cacheKey,
          documentGeneration: documentGenerationRef.current,
          elapsedMs: 0,
          page: acceptedCandidate.page.pageNumber,
          requestId,
          startedAt: performance.now(),
          zoom: renderZoom
        }
      );
      if (shouldAcceptForegroundCandidate(acceptedCandidate, "acquire")) {
        assignForegroundPage(acceptedCandidate);
      } else if (activeForegroundRenderRef.current?.requestId === requestId) {
        activeForegroundRenderRef.current = null;
      }
      setIsRendering(false);
      return;
    }

    setIsRendering(true);
    setRenderError(null);
    const process = startDebugProcess("reader.render-page", {
      documentId: document.document.id,
      openSessionId,
      page: renderPage,
      requestId,
      zoom: renderZoom
    });

    void acquisition.promise
      .then((page) => {
        const candidate: ForegroundPageCandidate = {
          navigationGeneration,
          openSessionId,
          page,
          requestId,
          source: acquisition.source,
          targetPage: renderPage
        };

        if (!shouldAcceptForegroundCandidate(candidate, "acquire")) {
          openMetricsRef.current.staleRequestCount += 1;
          if (activeForegroundRenderRef.current?.requestId === requestId) {
            activeForegroundRenderRef.current = null;
            setIsRendering(false);
          }
          process.finish({ stale: true });
          return;
        }

        openMetricsRef.current.renderResponseReceivedAtMs = performance.now();
        openMetricsRef.current.page = page.pageNumber;
        openMetricsRef.current.zoom = renderZoom;
        debugAction("reader.render:response-received", {
          documentId: document.document.id,
          openSessionId,
          page: page.pageNumber,
          requestId,
          requestKey: page.requestKey,
          zoom: renderZoom
        });
        assignForegroundPage(candidate);
        process.finish({
          page: page.pageNumber
        });
      })
      .catch((renderFailure) => {
        if (latestForegroundRequestIdRef.current !== requestId) {
          return;
        }

        process.fail(renderFailure);
        if (activeForegroundRenderRef.current?.requestId === requestId) {
          activeForegroundRenderRef.current = null;
        }
        setRenderError("Unable to render this PDF page.");
        setIsRendering(false);
        setLoadingDocument(false);
        onStatusChange("Unable to render this PDF page.");
      });
  }, [
    committedZoom,
    displayedPage,
    document,
    incomingPage,
    initialStateResolved,
    onStatusChange,
    openSessionId,
    readerSessionKey,
    targetPage
  ]);

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

    if (backgroundWorkSuspended) {
      return;
    }

    if (!document || !preloadReadyTarget) {
      return;
    }

    if (preloadReadyTarget.documentId !== document.document.id) {
      return;
    }

    if (preloadReadyTarget.pageNumber !== currentPage) {
      debugAction("reader.preload-skipped", {
        currentPage,
        displayedPage: displayedPage?.pageNumber ?? null,
        preloadReadyPage: preloadReadyTarget.pageNumber,
        reason: "preload-ready-page-not-current"
      });
      return;
    }

    const anchorPage = preloadReadyTarget.pageNumber;
    const requestedDocumentId = document.document.id;
    const requestedDocumentGeneration = documentGenerationRef.current;
    const adjacentPages = resolveAdjacentPreloadPages(
      anchorPage,
      pageCount,
      lastNavigationDirectionRef.current
    );

    if (adjacentPages.length === 0) {
      return;
    }

    let cancelled = false;
    const chainStartedAt = performance.now();
    const currentDocumentGeneration = documentGenerationRef.current;

    debugAction("reader.preload-chain-started", {
      anchorPage,
      cacheKey: makePageCacheKey(requestedDocumentId, anchorPage, committedZoom),
      documentGeneration: currentDocumentGeneration,
      elapsedMs: 0,
      page: anchorPage,
      startedAt: chainStartedAt,
      zoom: committedZoom
    });

    preloadTimerRef.current = window.setTimeout(() => {
      if (
        cancelled ||
        !currentDocumentRef.current ||
        currentDocumentRef.current.document.id !== document.document.id
      ) {
        debugAction("reader.preload-chain-cancelled", {
          anchorPage,
          cacheKey: makePageCacheKey(requestedDocumentId, anchorPage, committedZoom),
          discardReason: cancelled ? "effect-cleanup" : "document-changed-before-start",
          documentGeneration: currentDocumentGeneration,
          elapsedMs: Math.round(performance.now() - chainStartedAt),
          page: anchorPage,
          startedAt: chainStartedAt,
          zoom: committedZoom
        });
        return;
      }

      if (preloadReadyTarget.pageNumber !== currentPage) {
        debugAction("reader.preload-skipped", {
          anchorPage,
          currentPage,
          reason: "navigation-advanced"
        });
        debugAction("reader.preload-chain-cancelled", {
          anchorPage,
          cacheKey: makePageCacheKey(requestedDocumentId, anchorPage, committedZoom),
          discardReason: "navigation-advanced-before-start",
          documentGeneration: currentDocumentGeneration,
          elapsedMs: Math.round(performance.now() - chainStartedAt),
          page: anchorPage,
          startedAt: chainStartedAt,
          zoom: committedZoom
        });
        return;
      }

      const normalizationGeneration = normalizationGenerationRef.current;

      const preloadSequentially = async () => {
        for (const [index, pageNumber] of adjacentPages.entries()) {
          if (
            cancelled ||
            currentDocumentRef.current?.document.id !== requestedDocumentId ||
            documentGenerationRef.current !== requestedDocumentGeneration
          ) {
            return;
          }

          const key = makePageCacheKey(document.document.id, pageNumber, committedZoom);
          const localCachedPage = pageCache.current.getByLogicalKey(key);
          const registryCachedPage = localCachedPage
            ? null
            : getCompletedRenderedPage(
                document.document.id,
                pageNumber,
                committedZoom,
                "preload"
              );
          const completedPage = localCachedPage ?? registryCachedPage;
          if (registryCachedPage) {
            pageCache.current.set(registryCachedPage.cacheKey, registryCachedPage);
          }

          if (completedPage || preloadInFlight.current.has(key)) {
            debugAction("reader.preload-skipped", {
              key,
              page: pageNumber,
              priority: index === 0 ? "primary" : "secondary",
              reason: completedPage ? "cached" : "in-flight"
            });
            continue;
          }

          preloadInFlight.current.add(key);
          const requestStartedAt = performance.now();
          debugAction("reader.preload-scheduled", {
            anchorPage,
            page: pageNumber,
            preferredDirection: lastNavigationDirectionRef.current,
            priority: index === 0 ? "primary" : "secondary",
            zoom: committedZoom
          });
          debugAction("reader.preload-requested", {
            anchorPage,
            cacheKey: key,
            documentGeneration: currentDocumentGeneration,
            elapsedMs: Math.round(requestStartedAt - chainStartedAt),
            page: pageNumber,
            startedAt: requestStartedAt,
            zoom: committedZoom
          });

          try {
            const page = await renderVisiblePdfPage(requestedDocumentId, pageNumber, committedZoom, {
              caller: "preload",
              openSessionId
            });
            if (
              !cancelled &&
              normalizationGeneration === normalizationGenerationRef.current &&
              currentDocumentRef.current?.document.id === requestedDocumentId &&
              documentGenerationRef.current === requestedDocumentGeneration
            ) {
              pageCache.current.set(page.cacheKey, page);
              debugAction("reader.preload-completed", {
                anchorPage,
                cacheKey: key,
                documentGeneration: currentDocumentGeneration,
                elapsedMs: Math.round(performance.now() - requestStartedAt),
                page: pageNumber,
                startedAt: requestStartedAt,
                zoom: committedZoom
              });
            } else {
              debugAction("reader.preload-discarded", {
                anchorPage,
                cacheKey: key,
                discardReason: cancelled
                  ? "effect-cleanup-after-complete"
                  : normalizationGeneration !== normalizationGenerationRef.current
                    ? "normalization-generation-changed"
                    : currentDocumentRef.current?.document.id !== requestedDocumentId
                      ? "document-changed"
                      : documentGenerationRef.current !== requestedDocumentGeneration
                        ? "document-generation-changed"
                        : "unknown",
                documentGeneration: currentDocumentGeneration,
                elapsedMs: Math.round(performance.now() - requestStartedAt),
                page: pageNumber,
                startedAt: requestStartedAt,
                zoom: committedZoom
              });
            }
          } catch (preloadFailure) {
            debugAction("reader.preload-failed", {
              documentId: requestedDocumentId,
              error:
                preloadFailure instanceof Error
                  ? preloadFailure.message
                  : String(preloadFailure),
              page: pageNumber,
              priority: index === 0 ? "primary" : "secondary",
              zoom: committedZoom
            });
            debugAction("reader.preload-discarded", {
              anchorPage,
              cacheKey: key,
              discardReason:
                preloadFailure instanceof Error
                  ? preloadFailure.message
                  : String(preloadFailure),
              documentGeneration: currentDocumentGeneration,
              elapsedMs: Math.round(performance.now() - requestStartedAt),
              page: pageNumber,
              startedAt: requestStartedAt,
              zoom: committedZoom
            });
          } finally {
            preloadInFlight.current.delete(key);
          }
        }
      };

      void preloadSequentially();
    }, PRELOAD_DELAY_MS);

    return () => {
      cancelled = true;
      if (preloadTimerRef.current !== null) {
        window.clearTimeout(preloadTimerRef.current);
        preloadTimerRef.current = null;
      }
    };
  }, [
    backgroundWorkSuspended,
    committedZoom,
    currentPage,
    displayedPage,
    document,
    pageCount,
    preloadReadyTarget
  ]);

  useEffect(() => {
    const api: ViewerApi | null = document
      ? {
          nextPage: () => {
            const baseTargetPage = navigationTargetPageRef.current;
            const currentPageCount = pageCountRef.current;
            const nextPage = clampPage(baseTargetPage + 1, currentPageCount || baseTargetPage);
            debugAction("reader.navigate-header", {
              currentPageCount,
              direction: "next",
              nextPage,
              targetPage: baseTargetPage
            });
            requestPageTurnWithIntent(nextPage, "next-page");
          },
          previousPage: () => {
            const baseTargetPage = navigationTargetPageRef.current;
            const currentPageCount = pageCountRef.current;
            const nextPage = clampPage(baseTargetPage - 1, currentPageCount || baseTargetPage);
            debugAction("reader.navigate-header", {
              currentPageCount,
              direction: "previous",
              nextPage,
              targetPage: baseTargetPage
            });
            requestPageTurnWithIntent(nextPage, "previous-page");
          },
          zoomIn: () => {
            const nextFitMode = readerStateRef.current?.preferences.fitMode ?? "auto-maximize";
            updateZoom(scaleZoomByKeyboardDirection(displayZoomRef.current, "in"), "header", {
              fitMode: nextFitMode
            });
          },
          zoomOut: () => {
            const nextFitMode = readerStateRef.current?.preferences.fitMode ?? "auto-maximize";
            updateZoom(scaleZoomByKeyboardDirection(displayZoomRef.current, "out"), "header", {
              fitMode: nextFitMode
            });
          },
          getAutoMaximizeZoom: () => autoMaximizeZoomRef.current,
          getAutoMaximizeMinDocumentWidth: () => getAutoMaximizeMinDocumentWidth?.() ?? null,
          getFitMode: () => readerStateRef.current?.preferences.fitMode ?? "auto-maximize",
          setFitMode: (fitMode) => {
            const normalizedFitMode = normalizeReaderFitMode(fitMode);
            setReaderFitMode(normalizedFitMode, "header-fit-mode");
            if (normalizedFitMode === "auto-maximize" && autoMaximizeZoomRef.current !== null) {
              updateZoom(autoMaximizeZoomRef.current, "header-fit-mode-sync", {
                commitImmediately: true,
                fitMode: normalizedFitMode
              });
            }
          },
          goToPage: (page) => {
            requestPageTurnWithIntent(clampPage(page, pageCountRef.current || page), "go-to-page");
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
          getCurrentPage: () => navigationTargetPageRef.current,
          getPageCount: () => pageCountRef.current,
          getReaderState: () => readerStateRef.current,
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
  }, [document, getAutoMaximizeMinDocumentWidth, onStateChange, registerApi]);

  useEffect(() => {
    return () => registerApi(null);
  }, [registerApi]);

  return {
    currentPage,
    targetPage,
    navigationGeneration: navigationGenerationRef.current,
    pageCount,
    fitMode: readerState ? normalizeReaderFitMode(readerState.preferences.fitMode) : "auto-maximize",
    displayZoom,
    committedZoom,
    displayedPage,
    incomingPage,
    rapidTurnOverlay,
    scrollResetRequest,
    displayedPageTextLayer,
    displayedPageTextDebugStatus,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      debugAction("reader.keydown-entry", {
        key: event.key,
        repeat: event.repeat,
        timeStamp: event.timeStamp,
        lastInputAt: rapidTurnLastInputRef.current?.at ?? null,
        now: Date.now()
      });

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
          const nextFitMode = readerStateRef.current?.preferences.fitMode ?? "auto-maximize";
          updateZoom(nextZoom, "keyboard", { fitMode: nextFitMode });
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
        cancelSmoothWheelAnimation();
        const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
        const nextZoom = scaleZoomByWheelDelta(displayZoom, delta);
        debugAction("reader.zoom-wheel", {
          currentPage,
          displayZoom,
          nextZoom
        });
        const nextFitMode = readerStateRef.current?.preferences.fitMode ?? "auto-maximize";
        updateZoom(nextZoom, "wheel", { fitMode: nextFitMode });
        return;
      }

      const scrollSurface = event.currentTarget;
      const deltaX = normalizeWheelDelta(
        event.deltaX,
        event.deltaMode,
        scrollSurface.clientWidth
      );
      const deltaY = normalizeWheelDelta(
        event.deltaY,
        event.deltaMode,
        scrollSurface.clientHeight
      );
      const isDiscreteWheelInput = isLikelyDiscreteWheelInput(event);

      if (deltaX !== 0) {
        scrollSurface.scrollLeft += deltaX;
      }

      if (deltaY === 0) {
        return;
      }

      const now = Date.now();
      const nextDirection: NavigationDirection = deltaY > 0 ? "next" : "previous";
      const wheelGesture = wheelGestureRef.current;
      if (now - wheelGesture.lastAt > WHEEL_GESTURE_IDLE_MS) {
        resetWheelGesture({ clearRapidTurnInput: true });
      }

      if (wheelGestureRef.current.direction !== nextDirection) {
        wheelGestureRef.current.accumulatedBoundaryDistance = 0;
        wheelGestureRef.current.direction = nextDirection;
        wheelGestureRef.current.pageTurned = false;
      }
      wheelGestureRef.current.lastAt = now;

      if (wheelGestureRef.current.pageTurned) {
        return;
      }

      const selectionActive =
        scrollSurface.querySelector(".reader-page__text-layer.selecting") !== null;
      const maxScrollTop = Math.max(
        scrollSurface.scrollHeight - scrollSurface.clientHeight,
        0
      );
      const previousScrollTop = scrollSurface.scrollTop;
      const previousTargetScrollTop =
        smoothWheelStateRef.current.surface === scrollSurface
          ? smoothWheelStateRef.current.targetScrollTop
          : previousScrollTop;
      const rawDeltaY = isDiscreteWheelInput
        ? clampDiscreteWheelDelta(deltaY)
        : deltaY;
      const unclampedNextTargetScrollTop = previousTargetScrollTop + rawDeltaY;
      const nextTargetScrollTop = Math.min(
        Math.max(unclampedNextTargetScrollTop, 0),
        maxScrollTop
      );

      if (isDiscreteWheelInput) {
        queueSmoothWheelScroll(scrollSurface, nextTargetScrollTop);
      } else {
        cancelSmoothWheelAnimation();
        smoothWheelStateRef.current.surface = scrollSurface;
        smoothWheelStateRef.current.targetScrollTop = nextTargetScrollTop;
        const nextScrollTop = Math.min(
          Math.max(previousScrollTop + deltaY, 0),
          maxScrollTop
        );
        if (Math.abs(nextScrollTop - previousScrollTop) > 0.01) {
          scrollSurface.scrollTop = nextScrollTop;
        }
      }

      if (selectionActive || pageCount <= 1) {
        wheelGestureRef.current.accumulatedBoundaryDistance = 0;
        return;
      }

      if (shouldSuppressBoundaryNavigation(now)) {
        wheelGestureRef.current.accumulatedBoundaryDistance = 0;
        return;
      }

      const atTop = scrollSurface.scrollTop <= WHEEL_BOUNDARY_EPSILON_PX;
      const atBottom =
        scrollSurface.scrollTop >= maxScrollTop - WHEEL_BOUNDARY_EPSILON_PX;

      let boundaryOverflow = 0;
      if (nextDirection === "previous" && atTop) {
        boundaryOverflow = Math.max(0, -unclampedNextTargetScrollTop);
        if (boundaryOverflow === 0 && previousTargetScrollTop <= WHEEL_BOUNDARY_EPSILON_PX) {
          boundaryOverflow = Math.abs(rawDeltaY);
        }
      } else if (nextDirection === "next" && atBottom) {
        boundaryOverflow = Math.max(0, unclampedNextTargetScrollTop - maxScrollTop);
        if (
          boundaryOverflow === 0 &&
          previousTargetScrollTop >= maxScrollTop - WHEEL_BOUNDARY_EPSILON_PX
        ) {
          boundaryOverflow = Math.abs(rawDeltaY);
        }
      }

      if (boundaryOverflow <= 0) {
        wheelGestureRef.current.accumulatedBoundaryDistance = 0;
        return;
      }

      wheelGestureRef.current.accumulatedBoundaryDistance += boundaryOverflow;
      if (
        wheelGestureRef.current.accumulatedBoundaryDistance <
        WHEEL_PAGE_TURN_THRESHOLD_PX
      ) {
        return;
      }

      const requestedPage =
        nextDirection === "previous"
          ? clampPage(targetPage - 1, pageCount)
          : clampPage(targetPage + 1, pageCount || targetPage);
      if (requestedPage === targetPage) {
        wheelGestureRef.current.accumulatedBoundaryDistance = 0;
        return;
      }

      wheelGestureRef.current.pageTurned = true;
      wheelGestureRef.current.accumulatedBoundaryDistance = 0;
      cancelSmoothWheelAnimation();
      smoothWheelStateRef.current.surface = scrollSurface;
      smoothWheelStateRef.current.targetScrollTop = scrollSurface.scrollTop;
      debugAction("reader.navigate-wheel-boundary", {
        currentPage: targetPage,
        direction: nextDirection,
        maxScrollTop,
        scrollTop: scrollSurface.scrollTop
      });
      requestPageTurnWithIntent(
        requestedPage,
        nextDirection === "previous" ? "wheel-boundary-previous" : "wheel-boundary-next",
        {
          activationWindowMs: WHEEL_RAPID_TURN_WINDOW_MS,
          direction: nextDirection,
          source: "wheel"
        }
      );
    },
    handleNativeScroll(event: UIEvent<HTMLDivElement>) {
      const scrollSurface = event.currentTarget;
      const smoothWheelState = smoothWheelStateRef.current;
      if (smoothWheelState.ignoreScrollEvents > 0) {
        smoothWheelState.ignoreScrollEvents -= 1;
        return;
      }

      syncSmoothWheelStateToSurface(scrollSurface);
      cancelQueuedScrollReset(displayedPage?.pageNumber ?? currentPage);
      suppressBoundaryNavigationWindow();
    },
    releaseSmoothWheelForManualScroll(scrollSurface: HTMLDivElement) {
      beginManualScroll(scrollSurface);
    },
    finishManualScroll() {
      endManualScroll();
    },
    commitIncomingPageSwap(requestKey: string) {
      if (requestKey !== incomingPageKeyRef.current) {
        return;
      }

      setIncomingPage((currentIncomingPage) => {
        if (!currentIncomingPage || currentIncomingPage.requestKey !== requestKey) {
          return currentIncomingPage;
        }

        const candidate = toForegroundCandidate(currentIncomingPage);
        if (!shouldAcceptForegroundCandidate(candidate, "promote")) {
          debugAction("viewer.slot-promotion-discarded", {
            currentGeneration: navigationGenerationRef.current,
            currentTargetPage: navigationTargetPageRef.current,
            navigationGeneration: candidate.navigationGeneration,
            phase: "promote",
            requestId: candidate.requestId,
            resultPage: currentIncomingPage.pageNumber,
            source: candidate.source,
            targetPage: candidate.targetPage
          });
          if (incomingPageKeyRef.current === requestKey) {
            incomingPageKeyRef.current = null;
          }
          setIsRendering(false);
          return null;
        }

        debugAction("viewer.slot-promotion-accepted", {
          currentGeneration: navigationGenerationRef.current,
          currentTargetPage: navigationTargetPageRef.current,
          navigationGeneration: candidate.navigationGeneration,
          phase: "promote",
          requestId: candidate.requestId,
          resultPage: currentIncomingPage.pageNumber,
          source: candidate.source,
          targetPage: candidate.targetPage
        });
        debugAction("reader.page-swap-committed", {
          documentId: currentDocumentRef.current?.document.id ?? null,
          page: currentIncomingPage.pageNumber
        });
        setDisplayedPage(currentIncomingPage);
        setCurrentPage(currentIncomingPage.pageNumber);
        setLoadingDocument(false);
        return currentIncomingPage;
      });
    },
    finalizeIncomingPageSwap(requestKey: string) {
      if (requestKey !== incomingPageKeyRef.current) {
        return;
      }

      setIncomingPage((currentIncomingPage) => {
        if (!currentIncomingPage || currentIncomingPage.requestKey !== requestKey) {
          return currentIncomingPage;
        }

        debugAction("reader.page-swap-finalized", {
          documentId: currentDocumentRef.current?.document.id ?? null,
          page: currentIncomingPage.pageNumber
        });
        setIsRendering(false);
        incomingPageKeyRef.current = null;
        return null;
      });
    },
    markDisplayedPageReadyForPreload(target: PreloadReadyTarget) {
      markPageReadyForPreload(target);
    },
    markDisplayedPageVisible(requestKey: string) {
      const metrics = openMetricsRef.current;
      if (
        openSessionId &&
        metrics.openSessionId === openSessionId &&
        !metrics.summaryLogged &&
        metrics.clickStartedAtMs !== null
      ) {
        const now = performance.now();
        debugAction("reader.open:summary", {
          cacheHit: metrics.cacheHit,
          clickToRenderRequestMs:
            metrics.firstRenderRequestAtMs === null
              ? null
              : Math.round(metrics.firstRenderRequestAtMs - metrics.clickStartedAtMs),
          clickToVisibleMs: Math.round(now - metrics.clickStartedAtMs),
          documentId: metrics.documentId,
          openSessionId: metrics.openSessionId,
          page: metrics.page,
          pdfRuntimeStartedBeforeVisible: metrics.pdfRuntimeStartedBeforeVisible,
          renderMs:
            metrics.firstRenderRequestAtMs === null || metrics.renderResponseReceivedAtMs === null
              ? null
              : Math.round(
                  metrics.renderResponseReceivedAtMs - metrics.firstRenderRequestAtMs
                ),
          source: metrics.source,
          staleRequestCount: metrics.staleRequestCount,
          zoom: metrics.zoom
        });
        metrics.summaryLogged = true;
      }
      schedulePostVisibleIdleWork(requestKey);
    },
    previewAutoMaximizeZoom(nextZoom: number) {
      autoMaximizeZoomRef.current = normalizeZoom(nextZoom);
      if (!shouldAutoFitReaderPage(readerStateRef.current?.preferences.fitMode)) {
        return;
      }

      setDisplayZoom(resolveZoomForFitMode(nextZoom, "auto-maximize"));
    },
    commitAutoMaximizeZoom(nextZoom: number) {
      autoMaximizeZoomRef.current = normalizeZoom(nextZoom);
      if (!shouldAutoFitReaderPage(readerStateRef.current?.preferences.fitMode)) {
        return;
      }

      updateZoom(nextZoom, "auto-maximize", {
        fitMode: "auto-maximize",
        commitImmediately: true
      });
    },
    reportAutoMaximizeZoom(nextZoom: number) {
      autoMaximizeZoomRef.current = normalizeZoom(nextZoom);
    }
  };
}
