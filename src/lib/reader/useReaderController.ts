import type { KeyboardEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import { readDocumentBytes, saveDocumentState } from "../api";
import { debugAction, startDebugProcess } from "../debugLog";
import type {
  Bookmark,
  DocumentPayload,
  DocumentState,
  OutlineItem,
  ViewerApi,
  ViewerSnapshot
} from "../types";
import { createPageCache, makePageCacheKey, type CachedRenderedPage } from "./PageCache";
import { renderVisiblePdfPage } from "./PdfPageRenderer";

const RENDER_CACHE_SIZE = 20;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const PAGE_TURN_COMMIT_THROTTLE_MS = 150;
const PRELOAD_DELAY_MS = 150;
const NAVIGATION_SAVE_DEBOUNCE_MS = 700;
const BOOKMARK_SAVE_DEBOUNCE_MS = 200;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).toString();

type LoadedPdfTextDocument = Awaited<ReturnType<typeof loadPdfTextDocument>>;

type UseReaderControllerArgs = {
  document: DocumentPayload | null;
  onOutlineChange: (items: OutlineItem[]) => void;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
};

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

const standardFontDataUrl = withTrailingSlash(
  new URL("pdfjs-dist/standard_fonts/", import.meta.url).toString()
);
const cMapUrl = withTrailingSlash(
  new URL("pdfjs-dist/cmaps/", import.meta.url).toString()
);
const iccUrl = withTrailingSlash(
  new URL("pdfjs-dist/iccs/", import.meta.url).toString()
);
const wasmUrl = withTrailingSlash(
  new URL("pdfjs-dist/wasm/", import.meta.url).toString()
);

async function loadPdfTextDocument(data: Uint8Array) {
  return pdfjsLib.getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    iccUrl,
    standardFontDataUrl,
    wasmUrl,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: false,
    useSystemFonts: true
  }).promise;
}

async function resolveDestinationPage(
  document: LoadedPdfTextDocument,
  destination: unknown
) {
  if (!destination) {
    return null;
  }

  const target =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;

  if (!Array.isArray(target) || target.length === 0) {
    return null;
  }

  const reference = target[0];
  if (typeof reference === "number") {
    return reference + 1;
  }

  if (reference && typeof reference === "object") {
    const index = await document.getPageIndex(
      reference as Parameters<LoadedPdfTextDocument["getPageIndex"]>[0]
    );
    return index + 1;
  }

  return null;
}

async function extractOutline(
  document: LoadedPdfTextDocument,
  items: unknown[] | null,
  prefix = "outline"
): Promise<OutlineItem[]> {
  if (!items) {
    return [];
  }

  const result: OutlineItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as {
      title?: string;
      dest?: unknown;
      items?: unknown[];
    };
    const page = await resolveDestinationPage(document, item.dest);
    result.push({
      id: `${prefix}-${index}`,
      title: item.title?.trim() || "Untitled section",
      page,
      items: await extractOutline(document, item.items ?? null, `${prefix}-${index}`)
    });
  }
  return result;
}

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(pageCount, 1));
}

function clampZoom(zoom: number) {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

function shouldIgnoreRenderResponse(requestSequence: number, activeSequence: number) {
  return requestSequence !== activeSequence;
}

function stateSignature(state: DocumentState) {
  return JSON.stringify({
    version: state.version,
    documentId: state.documentId,
    fingerprint: state.fingerprint,
    lastPage: state.lastPage,
    zoom: state.zoom,
    bookmarks: state.bookmarks,
    preferences: state.preferences
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
  const [zoom, setZoom] = useState(1);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [displayedPage, setDisplayedPage] = useState<CachedRenderedPage | null>(null);
  const [incomingPage, setIncomingPage] = useState<CachedRenderedPage | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);

  const textDocumentRef = useRef<LoadedPdfTextDocument | null>(null);
  const textDocumentPromiseRef = useRef<Promise<LoadedPdfTextDocument> | null>(null);
  const pageTextCache = useRef(new Map<number, string>());
  const pageCache = useRef(createPageCache(RENDER_CACHE_SIZE));
  const preloadInFlight = useRef(new Set<string>());
  const lastWheelActionAt = useRef(0);
  const renderSequenceRef = useRef(0);
  const incomingPageKeyRef = useRef<string | null>(null);
  const initializedDocumentIdRef = useRef<string | null>(null);
  const outlineLoadedForDocumentIdRef = useRef<string | null>(null);
  const currentDocumentRef = useRef<DocumentPayload | null>(null);
  const readerStateRef = useRef<DocumentState | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  const dirtyStateRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const preloadTimerRef = useRef<number | null>(null);
  const pageCommitTimerRef = useRef<number | null>(null);
  const pendingCommittedPageRef = useRef<number | null>(null);
  const lastPageCommitAtRef = useRef(0);

  function clearPageCommitTimer() {
    if (pageCommitTimerRef.current !== null) {
      window.clearTimeout(pageCommitTimerRef.current);
      pageCommitTimerRef.current = null;
    }
  }

  function clearScheduledSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }

  function updateReaderState(nextState: DocumentState | null) {
    readerStateRef.current = nextState;
    setReaderState(nextState);
    onStateChange(nextState);
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
    delayMs = NAVIGATION_SAVE_DEBOUNCE_MS
  ) {
    const signature = stateSignature(nextState);
    const isDirty = signature !== lastPersistedSignatureRef.current;
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

  function requestPageTurn(nextPage: number, reason: string) {
    setTargetPage((currentTargetPage) => {
      if (currentTargetPage === nextPage) {
        return currentTargetPage;
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

    initializedDocumentIdRef.current = document?.document.id ?? null;
    currentDocumentRef.current = document;
    textDocumentRef.current = null;
    textDocumentPromiseRef.current = null;
    pageTextCache.current.clear();
    pageCache.current.clear();
    preloadInFlight.current.clear();
    if (preloadTimerRef.current !== null) {
      window.clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    clearPageCommitTimer();
    pendingCommittedPageRef.current = null;
    lastPageCommitAtRef.current = 0;
    outlineLoadedForDocumentIdRef.current = null;
    setDocumentError(null);
    setRenderError(null);
    setIsRendering(false);
    setDisplayedPage(null);
    setIncomingPage(null);
    setIncomingReady(false);
    incomingPageKeyRef.current = null;
    onOutlineChange([]);

    if (!document) {
      setPageCount(0);
      setCurrentPage(1);
      setTargetPage(1);
      setZoom(1);
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
    setZoom(nextZoom);
    const nextState = {
      ...document.state,
      lastPage: nextPage,
      zoom: nextZoom
    };
    clearScheduledSave();
    dirtyStateRef.current = false;
    lastPersistedSignatureRef.current = stateSignature(nextState);
    updateReaderState(nextState);
    onStatusChange(`Opened ${nextPageCount} pages.`);
  }, [document, onOutlineChange, onStateChange, onStatusChange]);

  useEffect(() => {
    function flushOnVisibilityChange() {
      if (window.document.visibilityState === "hidden") {
        flushReaderState("document-hidden");
      }
    }

    function flushOnWindowBlur() {
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
      flushReaderState("controller-unmount");
    };
  }, []);

  useEffect(() => {
    onSnapshotChange({
      currentPage: targetPage,
      pageCount,
      zoom
    });

    setReaderState((current) => {
      if (!current) {
        return current;
      }
      if (current.lastPage === targetPage && Math.abs(current.zoom - zoom) < 0.001) {
        return current;
      }
      const nextState = {
        ...current,
        lastPage: targetPage,
        zoom
      };
      readerStateRef.current = nextState;
      markReaderStateDirty(nextState, "navigation");
      onStateChange(nextState);
      return nextState;
    });
  }, [onSnapshotChange, onStateChange, pageCount, targetPage, zoom]);

  async function ensureTextDocument() {
    if (textDocumentRef.current) {
      return textDocumentRef.current;
    }

    if (textDocumentPromiseRef.current) {
      return textDocumentPromiseRef.current;
    }

    if (!document) {
      throw new Error("No document open.");
    }

    const process = startDebugProcess("reader.text-document", {
      documentId: document.document.id
    });

    const promise = (async () => {
      const loadedBytes = await readDocumentBytes(document.document.id);
      process.checkpoint("bytes-loaded", {
        byteCount: loadedBytes.length
      });
      const loadedDocument = await loadPdfTextDocument(Uint8Array.from(loadedBytes));
      process.finish({
        pageCount: loadedDocument.numPages
      });
      textDocumentRef.current = loadedDocument;
      return loadedDocument;
    })();

    textDocumentPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      textDocumentPromiseRef.current = null;
    }
  }

  useEffect(() => {
    if (!document || !displayedPage) {
      return;
    }

    if (outlineLoadedForDocumentIdRef.current === document.document.id) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const textDocument = await ensureTextDocument();
        if (cancelled) {
          return;
        }
        const nextOutline = await extractOutline(textDocument, await textDocument.getOutline());
        if (!cancelled) {
          outlineLoadedForDocumentIdRef.current = document.document.id;
          onOutlineChange(nextOutline);
        }
      } catch {
        if (!cancelled) {
          onOutlineChange([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [displayedPage, document, onOutlineChange]);

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

    const requestKey = makePageCacheKey(document.document.id, currentPage, zoom);
    const cachedPage = pageCache.current.get(requestKey);
    const requestSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = requestSequence;

    debugAction("reader.render-request", {
      documentId: document.document.id,
      currentPage,
      zoom,
      requestSequence,
      cached: Boolean(cachedPage)
    });

    if (cachedPage) {
      if (!displayedPage) {
        setDisplayedPage(cachedPage);
        setLoadingDocument(false);
      } else if (displayedPage.requestKey !== requestKey) {
        incomingPageKeyRef.current = requestKey;
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
      zoom,
      requestSequence
    });

    void renderVisiblePdfPage(document.document.id, currentPage, zoom)
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

        pageCache.current.set(requestKey, page);
        if (!displayedPage) {
          setDisplayedPage(page);
          setIncomingPage(null);
          setIncomingReady(false);
          incomingPageKeyRef.current = null;
          setLoadingDocument(false);
        } else {
          incomingPageKeyRef.current = requestKey;
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
  }, [currentPage, displayedPage, document, onStatusChange, zoom]);

  useEffect(() => {
    if (!incomingPage || !incomingReady) {
      return;
    }

    debugAction("reader.page-swap-committed", {
      documentId: incomingPage.requestKey.split(":")[0],
      page: incomingPage.pageNumber
    });
    setDisplayedPage(incomingPage);
    setIncomingPage(null);
    setIncomingReady(false);
    incomingPageKeyRef.current = null;
    setIsRendering(false);
  }, [incomingPage, incomingReady]);

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
        const key = makePageCacheKey(document.document.id, pageNumber, zoom);
        if (pageCache.current.has(key) || preloadInFlight.current.has(key)) {
          debugAction("reader.preload-skipped", {
            key,
            page: pageNumber,
            reason: pageCache.current.has(key) ? "cached" : "in-flight"
          });
          continue;
        }

        preloadInFlight.current.add(key);
        debugAction("reader.preload-scheduled", {
          anchorPage,
          page: pageNumber,
          zoom
        });
        void renderVisiblePdfPage(document.document.id, pageNumber, zoom)
          .then((page) => {
            pageCache.current.set(key, page);
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
  }, [currentPage, displayedPage, document, pageCount, zoom]);

  useEffect(() => {
    const api: ViewerApi | null = document
      ? {
          nextPage: () => {
            const nextPage = clampPage(targetPage + 1, pageCount);
            requestPageTurn(nextPage, "next-page");
          },
          previousPage: () => {
            const nextPage = clampPage(targetPage - 1, pageCount);
            requestPageTurn(nextPage, "previous-page");
          },
          goToPage: (page) => {
            requestPageTurn(clampPage(page, pageCount), "go-to-page");
          },
          search: async (query) => {
            const normalizedQuery = query.trim().toLowerCase();
            if (!normalizedQuery) {
              onStatusChange("Enter a phrase to search.");
              return 0;
            }

            const textDocument = await ensureTextDocument();
            for (let pageNumber = 1; pageNumber <= textDocument.numPages; pageNumber += 1) {
              let pageText = pageTextCache.current.get(pageNumber);
              if (!pageText) {
                const page = await textDocument.getPage(pageNumber);
                const content = await page.getTextContent();
                pageText = content.items
                  .map((item) =>
                    "str" in item && typeof item.str === "string" ? item.str : ""
                  )
                  .join(" ")
                  .toLowerCase();
                pageTextCache.current.set(pageNumber, pageText);
              }

              if (pageText.includes(normalizedQuery)) {
                requestPageTurn(pageNumber, "search");
                onStatusChange(`Found "${query}" on page ${pageNumber}.`);
                return pageNumber;
              }
            }

            onStatusChange(`No matches found for "${query}".`);
            return 0;
          },
          jumpToOutline: (item) => {
            if (item.page) {
              requestPageTurn(item.page, "outline");
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
              const nextState = {
                ...current,
                bookmarks
              };
              readerStateRef.current = nextState;
              markReaderStateDirty(nextState, "bookmarks", BOOKMARK_SAVE_DEBOUNCE_MS);
              onStateChange(nextState);
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
    zoom,
    displayedPage,
    incomingPage,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.key === "PageDown" || event.key === "ArrowRight") {
        event.preventDefault();
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "next"
        });
        requestPageTurn(clampPage(targetPage + 1, pageCount || targetPage), "keyboard-next");
      }

      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        debugAction("reader.navigate-keyboard", {
          key: event.key,
          direction: "previous"
        });
        requestPageTurn(clampPage(targetPage - 1, pageCount), "keyboard-previous");
      }
    },
    handleWheel(event: WheelEvent<HTMLDivElement>) {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
        setZoom((currentZoom) => {
          const nextZoom =
            delta < 0
              ? Math.min(currentZoom + ZOOM_STEP, MAX_ZOOM)
              : Math.max(currentZoom - ZOOM_STEP, MIN_ZOOM);

          debugAction("reader.zoom-wheel", {
            currentPage,
            nextZoom
          });

          return Number(nextZoom.toFixed(2));
        });
        return;
      }

      const now = Date.now();
      if (now - lastWheelActionAt.current < 180) {
        return;
      }

      const primaryDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (primaryDelta < 0) {
        debugAction("reader.navigate-wheel", {
          direction: "previous",
          currentPage: targetPage
        });
        requestPageTurn(clampPage(targetPage - 1, pageCount), "wheel-previous");
      } else if (primaryDelta > 0) {
        debugAction("reader.navigate-wheel", {
          direction: "next",
          currentPage: targetPage
        });
        requestPageTurn(clampPage(targetPage + 1, pageCount || targetPage), "wheel-next");
      }

      lastWheelActionAt.current = now;
    },
    markIncomingReady(requestKey: string) {
      if (requestKey !== incomingPageKeyRef.current) {
        return;
      }
      setIncomingReady(true);
    }
  };
}
