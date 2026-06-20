import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { type ViewerDisplayConfig } from "../lib/app/settingsRegistry";
import { debugAction, isDebugModeEnabled } from "../lib/debugLog";
import { computePageShellOffsets } from "../lib/reader/pageLayout";
import { useReaderController, type PresentedPage } from "../lib/reader/useReaderController";
import {
  AUTO_MAXIMIZE_HORIZONTAL_MARGIN_PX,
  hasMeaningfulZoomDelta,
  resolveAutoMaximizeZoom,
  resolveSurfaceScale,
  shouldAutoFitReaderPage
} from "../lib/reader/zoom";
import type { DocumentPayload, DocumentState, OutlineItem, ReaderSession, ViewerApi, ViewerSnapshot } from "../lib/types";
import NativePdfTextLayer from "./NativePdfTextLayer";
import RapidTurnOverlay from "./RapidTurnOverlay";

type PdfViewerProps = {
  readerSession: ReaderSession | null;
  readerActive: boolean;
  pendingReaderOpenSessionId: string | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  onStateChange: (state: DocumentState | null) => void;
  registerApi: (api: ViewerApi | null) => void;
  viewerDisplayConfig: ViewerDisplayConfig;
  suspendAutoFitDuringPaneResize: boolean;
};

type ImageSlotState = {
  page: PresentedPage | null;
  generation: number;
  ready: boolean;
};

const PdfViewer = memo(function PdfViewer({
  readerSession,
  readerActive,
  pendingReaderOpenSessionId,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  onStateChange,
  registerApi,
  viewerDisplayConfig,
  suspendAutoFitDuringPaneResize
}: PdfViewerProps) {
  const document = readerSession?.document ?? null;
  const openSessionId = readerSession?.openSessionId ?? null;
  const openSessionStartedAtMs = readerSession?.clickStartedAtMs ?? null;
  const AUTO_MAXIMIZE_RESIZE_SETTLE_MS = 160;
  const READER_SCROLLBAR_OVERFLOW_EPSILON_PX = 2;
  const scrollSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const scrollbarMetricsRef = useRef({
    trackHeight: 0,
    thumbHeight: 0,
    maxThumbTop: 0,
    maxScroll: 0
  });
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const [pageOffsets, setPageOffsets] = useState({ offsetX: 0, offsetY: 0 });
  const [scrollbarState, setScrollbarState] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0
  });
  const appliedScrollResetTokenRef = useRef<number | null>(null);
  const autoMaximizeMinDocumentWidthRef = useRef<number | null>(null);
  const getAutoMaximizeMinDocumentWidth = useCallback(
    () => autoMaximizeMinDocumentWidthRef.current,
    []
  );
  const {
    displayedPage,
    incomingPage,
    targetPage,
    navigationGeneration,
    fitMode,
    displayZoom,
    committedZoom,
    isRendering,
    loadingDocument,
    documentError,
    renderError,
    displayedPageTextLayer,
    displayedPageTextDebugStatus,
    rapidTurnOverlay,
    scrollResetRequest,
    handleKeyDown,
    handleNavigationKeyUp,
    handleNativeScroll,
    handleWheel,
    releaseSmoothWheelForManualScroll,
    finishManualScroll,
    commitIncomingPageSwap,
    finalizeIncomingPageSwap,
    markDisplayedPageReadyForPreload,
    markDisplayedPageVisible,
    previewAutoMaximizeZoom,
    commitAutoMaximizeZoom,
    reportAutoMaximizeZoom
  } = useReaderController({
    readerSession,
    readerActive,
    pendingReaderOpenSessionId,
    onOutlineChange,
    onSnapshotChange,
    onStatusChange,
    onStateChange,
    registerApi,
    getAutoMaximizeMinDocumentWidth
  });
  const latestDisplayedPageRef = useRef(displayedPage);
  const latestScrollResetRequestRef = useRef(scrollResetRequest);
  const displayZoomRef = useRef(displayZoom);
  const fitTargetZoomRef = useRef<number | null>(null);
  const fitCommitTimerRef = useRef<number | null>(null);
  const slotCleanupFrameRef = useRef<number | null>(null);
  const incomingPromotionCommitKeyRef = useRef<string | null>(null);
  const incomingPromotionFinalizeKeyRef = useRef<string | null>(null);
  const imageElementRefs = useRef<[HTMLImageElement | null, HTMLImageElement | null]>([null, null]);
  const imageSlotsRef = useRef<[ImageSlotState, ImageSlotState]>([
    { page: null, generation: 0, ready: false },
    { page: null, generation: 0, ready: false }
  ]);
  const firstVisibleLoggedSessionRef = useRef<string | null>(null);
  const lastSrcAssignedLogRef = useRef<{
    displayed: string | null;
    incoming: string | null;
  }>({
    displayed: null,
    incoming: null
  });
  const [activeImageSlot, setActiveImageSlot] = useState<0 | 1>(0);
  const [imageSlots, setImageSlots] = useState<[ImageSlotState, ImageSlotState]>(() => [
    {
      page: displayedPage,
      generation: 0,
      ready: Boolean(displayedPage)
    },
    {
      page: incomingPage,
      generation: 0,
      ready: false
    }
  ]);
  const activeImageSlotRef = useRef<0 | 1>(0);

  const layoutPage = displayedPage ?? incomingPage;
  const renderedZoom = layoutPage?.renderZoom ?? committedZoom;
  const surfaceScale = resolveSurfaceScale(displayZoom, renderedZoom);
  const scaledWidth = layoutPage ? layoutPage.width * surfaceScale : 0;
  const scaledHeight = layoutPage ? layoutPage.height * surfaceScale : 0;

  latestDisplayedPageRef.current = displayedPage;
  latestScrollResetRequestRef.current = scrollResetRequest;
  imageSlotsRef.current = imageSlots;
  activeImageSlotRef.current = activeImageSlot;

  function replaceImageSlot(
    currentSlots: [ImageSlotState, ImageSlotState],
    slotIndex: 0 | 1,
    nextPage: PresentedPage | null,
    ready: boolean,
    role: "displayed" | "incoming" | "reset"
  ) {
    const previousSlot = currentSlots[slotIndex];
    const previousPage = previousSlot.page;
    const nextGeneration = previousSlot.generation + 1;

    if (previousPage && nextPage) {
      debugAction(
        "viewer.slot-replaced",
        buildOpenSessionFields({
          nextPage: nextPage.pageNumber,
          nextRequestKey: nextPage.requestKey,
          pageNumber: previousPage.pageNumber,
          previousRequestKey: previousPage.requestKey,
          role,
          slotIndex
        })
      );
    } else if (previousPage && !nextPage) {
      debugAction(
        "viewer.slot-unmounted",
        buildOpenSessionFields({
          pageNumber: previousPage.pageNumber,
          previousRequestKey: previousPage.requestKey,
          role,
          slotIndex
        })
      );
    }

    if (nextPage) {
      debugAction(
        "viewer.blob-url-assigned",
        buildOpenSessionFields({
          blobUrl: nextPage.imageUrl,
          pageNumber: nextPage.pageNumber,
          requestKey: nextPage.requestKey,
          role,
          slotGeneration: nextGeneration,
          slotIndex
        })
      );
    }

    return {
      page: nextPage,
      generation: nextGeneration,
      ready
    };
  }

  useEffect(() => {
    if (!layoutPage || !shouldAutoFitReaderPage(fitMode)) {
      autoMaximizeMinDocumentWidthRef.current = null;
      return;
    }

    autoMaximizeMinDocumentWidthRef.current = Number(
      (scaledWidth + AUTO_MAXIMIZE_HORIZONTAL_MARGIN_PX * 2).toFixed(2)
    );
  }, [fitMode, layoutPage, scaledWidth]);

  useEffect(() => {
    displayZoomRef.current = displayZoom;
  }, [displayZoom]);

  function clearFitCommitTimer() {
    if (fitCommitTimerRef.current !== null) {
      window.clearTimeout(fitCommitTimerRef.current);
      fitCommitTimerRef.current = null;
    }
  }

  function scheduleFitCommit(targetZoom: number) {
    clearFitCommitTimer();
    fitCommitTimerRef.current = window.setTimeout(() => {
      fitCommitTimerRef.current = null;
      commitAutoMaximizeZoom(targetZoom);
    }, AUTO_MAXIMIZE_RESIZE_SETTLE_MS);
  }

  useEffect(() => {
    fitTargetZoomRef.current = null;
    clearFitCommitTimer();
  }, [fitMode, openSessionId]);

  useEffect(() => {
    firstVisibleLoggedSessionRef.current = null;
    lastSrcAssignedLogRef.current = {
      displayed: null,
      incoming: null
    };
  }, [openSessionId]);

  function buildOpenSessionFields(extraFields: Record<string, unknown> = {}) {
    return {
      documentId: document?.document.id ?? null,
      openSessionId,
      ...(openSessionStartedAtMs === null
        ? {}
        : {
            openElapsedMs: Math.round(performance.now() - openSessionStartedAtMs)
          }),
      ...extraFields
    };
  }

  function buildPresentationFields(page: PresentedPage) {
    return {
      navigationGeneration: page.presentation.navigationGeneration,
      requestId: page.presentation.requestId,
      source: page.presentation.source,
      targetPage: page.presentation.targetPage
    };
  }

  function scheduleFirstVisibleEvent(
    slotPage: PresentedPage,
    trigger: "initial" | "promoted",
    slotIndex: 0 | 1
  ) {
    if (!openSessionId || firstVisibleLoggedSessionRef.current === openSessionId) {
      return;
    }

    firstVisibleLoggedSessionRef.current = openSessionId;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const imageElement = imageElementRefs.current[slotIndex];
        const rect = imageElement?.getBoundingClientRect();
        const computedStyle = imageElement ? window.getComputedStyle(imageElement) : null;
        const visible = Boolean(
          imageElement &&
            imageElement.complete &&
            imageElement.naturalWidth > 0 &&
            rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            computedStyle?.opacity !== "0"
        );

        const fields = buildOpenSessionFields({
          pageNumber: slotPage.pageNumber,
          requestKey: slotPage.requestKey,
          trigger,
          slotIndex,
          visible,
          naturalWidth: imageElement?.naturalWidth ?? 0,
          naturalHeight: imageElement?.naturalHeight ?? 0,
          renderedWidth: rect ? Math.round(rect.width) : 0,
          renderedHeight: rect ? Math.round(rect.height) : 0
        });

        debugAction("reader.first-visible", fields);
        if (visible) {
          markDisplayedPageVisible(slotPage.requestKey);
        }
      });
    });
  }

  useEffect(() => {
    return () => {
      if (slotCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(slotCleanupFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!incomingPage) {
      incomingPromotionCommitKeyRef.current = null;
      incomingPromotionFinalizeKeyRef.current = null;
      return;
    }

    const slotIndex = imageSlots.findIndex(
      (slot) => slot.page?.requestKey === incomingPage.requestKey && slot.ready
    );
    if (slotIndex === -1) {
      return;
    }

    if (incomingPromotionCommitKeyRef.current === incomingPage.requestKey) {
      return;
    }

    incomingPromotionCommitKeyRef.current = incomingPage.requestKey;
    debugAction(
      "viewer.image:promotion-commit-requested",
      buildOpenSessionFields({
        pageNumber: incomingPage.pageNumber,
        requestKey: incomingPage.requestKey,
        slotIndex,
        trigger: "decoded-incoming-ready"
      })
    );
    commitIncomingPageSwap(incomingPage.requestKey);
  }, [commitIncomingPageSwap, imageSlots, incomingPage]);

  useEffect(() => {
    if (
      !displayedPage ||
      !incomingPage ||
      displayedPage.requestKey !== incomingPage.requestKey
    ) {
      incomingPromotionFinalizeKeyRef.current = null;
      return;
    }

    const slotIndex = imageSlots.findIndex(
      (slot) => slot.page?.requestKey === displayedPage.requestKey && slot.ready
    );
    if (slotIndex === -1 || activeImageSlot !== slotIndex) {
      return;
    }

    if (incomingPromotionFinalizeKeyRef.current === displayedPage.requestKey) {
      return;
    }

    incomingPromotionFinalizeKeyRef.current = displayedPage.requestKey;
    const slotPage = imageSlots[slotIndex].page;
    if (!slotPage) {
      return;
    }

    debugAction(
      "viewer.preload-ready-signalled",
      buildOpenSessionFields({
        documentId: slotPage.documentId,
        pageNumber: slotPage.pageNumber,
        requestKey: slotPage.requestKey,
        slotGeneration: imageSlots[slotIndex].generation,
        slotIndex
      })
    );
    markDisplayedPageReadyForPreload({
      documentId: slotPage.documentId,
      pageNumber: slotPage.pageNumber,
      requestKey: slotPage.requestKey
    });
    debugAction(
      "viewer.image:promoted",
      buildOpenSessionFields({
        pageNumber: slotPage.pageNumber,
        requestKey: slotPage.requestKey,
        slotGeneration: imageSlots[slotIndex].generation,
        slotIndex,
        trigger: "swap"
      })
    );
    scheduleFirstVisibleEvent(slotPage, "promoted", slotIndex as 0 | 1);
    if (slotCleanupFrameRef.current !== null) {
      window.cancelAnimationFrame(slotCleanupFrameRef.current);
    }
    slotCleanupFrameRef.current = window.requestAnimationFrame(() => {
      slotCleanupFrameRef.current = null;
      finalizeIncomingPageSwap(slotPage.requestKey);
    });
  }, [activeImageSlot, displayedPage, finalizeIncomingPageSwap, imageSlots, incomingPage]);

  useEffect(() => {
    if (!displayedPage && !incomingPage) {
      setActiveImageSlot(0);
      setImageSlots((currentSlots) => [
        replaceImageSlot(currentSlots, 0, null, false, "reset"),
        replaceImageSlot(currentSlots, 1, null, false, "reset")
      ]);
      return;
    }

    setImageSlots((currentSlots) => {
      let nextSlots = currentSlots;
      let nextActiveSlot = activeImageSlot;
      const inactiveSlot = activeImageSlot === 0 ? 1 : 0;

      if (displayedPage) {
        if (currentSlots[inactiveSlot].page?.requestKey === displayedPage.requestKey) {
          nextActiveSlot = inactiveSlot;
        } else if (currentSlots[activeImageSlot].page?.requestKey !== displayedPage.requestKey) {
          if (lastSrcAssignedLogRef.current.displayed !== displayedPage.requestKey) {
            debugAction(
              "viewer.image:src-assigned",
              buildOpenSessionFields({
                currentGeneration: navigationGeneration,
                currentTargetPage: targetPage,
                imageByteLength: displayedPage.imageBytes.length,
                pageNumber: displayedPage.pageNumber,
                phase: "assign",
                requestKey: displayedPage.requestKey,
                resultPage: displayedPage.pageNumber,
                slotIndex: activeImageSlot,
                role: "displayed",
                ...buildPresentationFields(displayedPage)
              })
            );
            lastSrcAssignedLogRef.current.displayed = displayedPage.requestKey;
          }
          nextSlots = [...currentSlots] as [ImageSlotState, ImageSlotState];
          nextSlots[activeImageSlot] = replaceImageSlot(
            currentSlots,
            activeImageSlot,
            displayedPage,
            true,
            "displayed"
          );
        }
      }

      if (incomingPage) {
        const resolvedInactiveSlot = nextActiveSlot === 0 ? 1 : 0;
        const activePageKey = nextSlots[nextActiveSlot].page?.requestKey;
        const inactivePageKey = nextSlots[resolvedInactiveSlot].page?.requestKey;
        if (
          activePageKey !== incomingPage.requestKey &&
          inactivePageKey !== incomingPage.requestKey
        ) {
          if (nextSlots === currentSlots) {
            nextSlots = [...currentSlots] as [ImageSlotState, ImageSlotState];
          }
          if (lastSrcAssignedLogRef.current.incoming !== incomingPage.requestKey) {
            debugAction(
              "viewer.image:src-assigned",
              buildOpenSessionFields({
                currentGeneration: navigationGeneration,
                currentTargetPage: targetPage,
                imageByteLength: incomingPage.imageBytes.length,
                pageNumber: incomingPage.pageNumber,
                phase: "assign",
                requestKey: incomingPage.requestKey,
                resultPage: incomingPage.pageNumber,
                slotIndex: resolvedInactiveSlot,
                role: "incoming",
                ...buildPresentationFields(incomingPage)
              })
            );
            lastSrcAssignedLogRef.current.incoming = incomingPage.requestKey;
          }
          nextSlots[resolvedInactiveSlot] = replaceImageSlot(
            nextSlots,
            resolvedInactiveSlot,
            incomingPage,
            false,
            "incoming"
          );
        }
      }

      if (nextActiveSlot !== activeImageSlot) {
        setActiveImageSlot(nextActiveSlot);
      }

      return nextSlots;
    });
  }, [activeImageSlot, displayedPage, incomingPage, navigationGeneration, targetPage]);

  const renderedPage = imageSlots[activeImageSlot].page ?? displayedPage;
  const activeSlotPageKey = imageSlots[activeImageSlot].page?.requestKey ?? null;

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    if (
      !scrollSurface ||
      !layoutPage ||
      !shouldAutoFitReaderPage(fitMode) ||
      suspendAutoFitDuringPaneResize
    ) {
      clearFitCommitTimer();
      return;
    }

    const updateAutoMaximizeZoom = () => {
      const effectiveRenderZoom = Math.max(layoutPage.renderZoom, 0.0001);
      // Fit against the full rendered page surface, not just the raw PDF text/page box.
      // Normalized pages can render into a larger canonical frame than textLayerTransform.source*.
      const baseWidth = layoutPage.width / effectiveRenderZoom;
      const baseHeight = layoutPage.height / effectiveRenderZoom;
      const viewportRect = scrollSurface.getBoundingClientRect();
      const nextZoom = resolveAutoMaximizeZoom(
        viewportRect.width,
        viewportRect.height,
        baseWidth,
        baseHeight
      );

      if (nextZoom === null) {
        return;
      }

      reportAutoMaximizeZoom(nextZoom);
      const targetChanged = hasMeaningfulZoomDelta(nextZoom, fitTargetZoomRef.current);
      const commitStillNeeded = hasMeaningfulZoomDelta(nextZoom, committedZoom);

      if (targetChanged) {
        fitTargetZoomRef.current = nextZoom;
        previewAutoMaximizeZoom(nextZoom);
      }

      debugAction(
        "frontend.auto-maximize.fit-state",
        buildOpenSessionFields({
          commitScheduled: fitCommitTimerRef.current !== null,
          committedZoom,
          displayZoom: displayZoomRef.current,
          fitTargetZoom: fitTargetZoomRef.current,
          nextZoom,
          targetChanged
        })
      );

      if (!commitStillNeeded) {
        clearFitCommitTimer();
        return;
      }

      if (fitCommitTimerRef.current === null) {
        debugAction(
          "frontend.auto-maximize.commit-scheduled",
          buildOpenSessionFields({
            committedZoom,
            displayZoom: displayZoomRef.current,
            fitTargetZoom: fitTargetZoomRef.current,
            nextZoom
          })
        );
        scheduleFitCommit(nextZoom);
      }
    };

    updateAutoMaximizeZoom();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateAutoMaximizeZoom();
          });

    resizeObserver?.observe(scrollSurface);
    window.addEventListener("resize", updateAutoMaximizeZoom);

    return () => {
      clearFitCommitTimer();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateAutoMaximizeZoom);
    };
  }, [
    committedZoom,
    commitAutoMaximizeZoom,
    fitMode,
    layoutPage,
    previewAutoMaximizeZoom,
    reportAutoMaximizeZoom,
    suspendAutoFitDuringPaneResize
  ]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    if (!scrollSurface || !displayedPage || !scrollResetRequest) {
      return;
    }

    if (displayedPage.pageNumber !== scrollResetRequest.pageNumber) {
      return;
    }

    if (appliedScrollResetTokenRef.current === scrollResetRequest.token) {
      return;
    }

    appliedScrollResetTokenRef.current = scrollResetRequest.token;
    let secondFrame: number | null = null;
    const resetScrollPosition = () => {
      const latestRequest = latestScrollResetRequestRef.current;
      const latestDisplayedPage = latestDisplayedPageRef.current;
      if (
        !scrollSurfaceRef.current ||
        !latestRequest ||
        latestRequest.token !== scrollResetRequest.token ||
        latestRequest.pageNumber !== scrollResetRequest.pageNumber ||
        latestDisplayedPage?.pageNumber !== scrollResetRequest.pageNumber
      ) {
        return;
      }

      scrollSurfaceRef.current.scrollLeft = 0;
      scrollSurfaceRef.current.scrollTop =
        scrollResetRequest.position === "top"
          ? 0
          : Math.max(
              scrollSurfaceRef.current.scrollHeight - scrollSurfaceRef.current.clientHeight,
              0
            );
    };

    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(resetScrollPosition);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [displayedPage, scrollResetRequest]);

  useLayoutEffect(() => {
    const scrollSurface = scrollSurfaceRef.current;
    if (!scrollSurface || !layoutPage) {
      setPageOffsets((current) =>
        current.offsetX === 0 && current.offsetY === 0
          ? current
          : { offsetX: 0, offsetY: 0 }
      );
      return;
    }

    const updateOverflowState = () => {
      const nextOffsets = computePageShellOffsets(
        scrollSurface.clientWidth,
        scrollSurface.clientHeight,
        scaledWidth,
        scaledHeight
      );
      setPageOffsets((current) =>
        Math.abs(current.offsetX - nextOffsets.offsetX) < 0.5 &&
        Math.abs(current.offsetY - nextOffsets.offsetY) < 0.5
          ? current
          : nextOffsets
      );
    };

    updateOverflowState();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateOverflowState();
          });

    resizeObserver?.observe(scrollSurface);
    window.addEventListener("resize", updateOverflowState);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [layoutPage, scaledHeight, scaledWidth]);

  const pageLayoutStyle = {
    ["--page-offset-x"]: `${pageOffsets.offsetX.toFixed(2)}px`,
    ["--page-offset-y"]: `${pageOffsets.offsetY.toFixed(2)}px`
  } as CSSProperties;
  const appearanceStyle = {
    ["--viewer-paper-color"]: viewerDisplayConfig.paperColor,
    ["--viewer-ink-color"]: viewerDisplayConfig.inkColor,
    ["--viewer-image-filter"]: viewerDisplayConfig.imageFilter,
    ["--viewer-image-blend-mode"]: viewerDisplayConfig.blendMode
  } as CSSProperties;

  useEffect(() => {
    const scrollSurfaceElement = scrollSurfaceRef.current;
    const pageElement = pageRef.current;
    if (!scrollSurfaceElement) {
      return;
    }
    const scrollSurface = scrollSurfaceElement;
    let frameId: number | null = null;

    function updateReaderScrollbar() {
      const nextTrackHeight = Math.max(scrollSurface.clientHeight - 14, 0);
      const rawMaxScroll = Math.max(
        scrollSurface.scrollHeight - scrollSurface.clientHeight,
        0
      );
      const nextMaxScroll =
        rawMaxScroll <= READER_SCROLLBAR_OVERFLOW_EPSILON_PX ? 0 : rawMaxScroll;

      if (nextTrackHeight <= 0 || nextMaxScroll <= 0) {
        scrollbarMetricsRef.current = {
          trackHeight: 0,
          thumbHeight: 0,
          maxThumbTop: 0,
          maxScroll: 0
        };
        setScrollbarState({
          visible: false,
          thumbHeight: 0,
          thumbTop: 0
        });
        return;
      }

      const scrollRatio = scrollSurface.clientHeight / scrollSurface.scrollHeight;
      const thumbHeight = Math.max(32, nextTrackHeight * scrollRatio);
      const maxThumbTop = Math.max(nextTrackHeight - thumbHeight, 0);
      const thumbTop =
        nextMaxScroll === 0 ? 0 : (scrollSurface.scrollTop / nextMaxScroll) * maxThumbTop;

      scrollbarMetricsRef.current = {
        trackHeight: nextTrackHeight,
        thumbHeight,
        maxThumbTop,
        maxScroll: nextMaxScroll
      };
      setScrollbarState({
        visible: true,
        thumbHeight,
        thumbTop
      });
    }

    function scheduleScrollbarUpdate() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateReaderScrollbar();
      });
    }

    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      if (!activeDrag) {
        return;
      }

      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      scrollSurface.scrollTop = activeDrag.startScrollTop + scrollDelta;
    }

    function handlePointerUp(event: PointerEvent) {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      scrollbarDragRef.current = null;
      finishManualScroll();
    }

    updateReaderScrollbar();
    scrollSurface.addEventListener("scroll", updateReaderScrollbar, { passive: true });
    window.addEventListener("resize", scheduleScrollbarUpdate);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleScrollbarUpdate();
          });
    resizeObserver?.observe(scrollSurface);
    if (pageElement) {
      resizeObserver?.observe(pageElement);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      scrollSurface.removeEventListener("scroll", updateReaderScrollbar);
      window.removeEventListener("resize", scheduleScrollbarUpdate);
      resizeObserver?.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      scrollbarDragRef.current = null;
      finishManualScroll();
    };
  }, [displayedPage, incomingPage, scaledHeight, scaledWidth]);

  if (!document) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
        </div>
      </div>
    );
  }

  if (documentError) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <p>{documentError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="reader-stage"
      data-document-appearance={viewerDisplayConfig.mode}
      style={appearanceStyle}
    >
      <div
        ref={scrollSurfaceRef}
        className="reader-scroll-surface"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleNavigationKeyUp}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement | null)?.closest(".reader-page__text-layer")) {
            return;
          }
          event.currentTarget.focus();
        }}
        onScroll={handleNativeScroll}
        onWheel={handleWheel}
      >
        <div ref={pageRef} className="reader-page" style={pageLayoutStyle}>
          {renderedPage || incomingPage ? (
            <div className="pdf-page-layer">
              <div
                className="reader-page__surface-shell"
                style={{
                  width: `${scaledWidth}px`,
                  height: `${scaledHeight}px`
                }}
              >
                <div
                  className="reader-page__surface"
                  style={{
                    width: `${layoutPage?.width ?? 0}px`,
                    height: `${layoutPage?.height ?? 0}px`,
                    transform: `scale(${surfaceScale})`
                  }}
                >
                  {imageSlots.map((slot, index) =>
                    slot.page ? (
                      <img
                        key={`reader-page-slot-${index}`}
                        ref={(element) => {
                          imageElementRefs.current[index as 0 | 1] = element;
                        }}
                        className={
                          index === activeImageSlot
                            ? "reader-page__image reader-page__image--active"
                            : slot.ready
                              ? "reader-page__image reader-page__image--standby"
                              : "reader-page__image reader-page__image--incoming"
                        }
                        src={slot.page.imageUrl}
                        alt={index === activeImageSlot ? `Page ${slot.page.pageNumber}` : ""}
                        aria-hidden={index === activeImageSlot ? undefined : true}
                        draggable={false}
                        onLoad={(event) => {
                          const slotPage = slot.page;
                          const slotGeneration = slot.generation;
                          if (!slotPage) {
                            return;
                          }

                          debugAction(
                            "viewer.image:load",
                            buildOpenSessionFields({
                              pageNumber: slotPage.pageNumber,
                              requestKey: slotPage.requestKey,
                              slotGeneration,
                              slotIndex: index
                            })
                          );

                          const finalizeSlotLoad = () => {
                            const decodeFields = buildOpenSessionFields({
                              pageNumber: slotPage.pageNumber,
                              requestKey: slotPage.requestKey,
                              slotGeneration,
                              slotIndex: index
                            });
                            debugAction("viewer.image:decode:finish", decodeFields);
                            debugAction("viewer.image:decode-finished", decodeFields);
                            setImageSlots((currentSlots) => {
                              const currentSlot = currentSlots[index];
                              if (
                                !currentSlot.page ||
                                currentSlot.page.requestKey !== slotPage.requestKey ||
                                currentSlot.generation !== slotGeneration
                              ) {
                                return currentSlots;
                              }

                              const nextSlots = [...currentSlots] as [ImageSlotState, ImageSlotState];
                              nextSlots[index] = {
                                page: currentSlot.page,
                                generation: currentSlot.generation,
                                ready: true
                              };
                              return nextSlots;
                            });

                            const latestSlot = imageSlotsRef.current[index];
                            if (
                              !latestSlot.page ||
                              latestSlot.page.requestKey !== slotPage.requestKey ||
                              latestSlot.generation !== slotGeneration
                            ) {
                              return;
                            }

                            if (index === activeImageSlotRef.current) {
                              debugAction(
                                "viewer.preload-ready-signalled",
                                buildOpenSessionFields({
                                  documentId: slotPage.documentId,
                                  pageNumber: slotPage.pageNumber,
                                  requestKey: slotPage.requestKey,
                                  slotGeneration,
                                  slotIndex: index
                                })
                              );
                              markDisplayedPageReadyForPreload({
                                documentId: slotPage.documentId,
                                pageNumber: slotPage.pageNumber,
                                requestKey: slotPage.requestKey
                              });
                              debugAction(
                                "viewer.image:promoted",
                                buildOpenSessionFields({
                                  pageNumber: slotPage.pageNumber,
                                  requestKey: slotPage.requestKey,
                                  slotGeneration,
                                  slotIndex: index,
                                  trigger: "initial"
                                })
                              );
                              scheduleFirstVisibleEvent(slotPage, "initial", index as 0 | 1);
                              return;
                            }
                          };

                          if (typeof event.currentTarget.decode === "function") {
                            debugAction(
                              "viewer.image:decode:start",
                              buildOpenSessionFields({
                                pageNumber: slotPage.pageNumber,
                                requestKey: slotPage.requestKey,
                                slotGeneration,
                                slotIndex: index
                              })
                            );
                            void event.currentTarget.decode().then(finalizeSlotLoad).catch(() => {
                              if (event.currentTarget.complete) {
                                finalizeSlotLoad();
                              }
                            });
                            return;
                          }

                          finalizeSlotLoad();
                        }}
                        onError={(event) => {
                          const slotPage = slot.page;
                          if (!slotPage) {
                            return;
                          }

                          debugAction(
                            "viewer.image:error",
                            buildOpenSessionFields({
                              currentSrc: event.currentTarget.currentSrc,
                              pageNumber: slotPage.pageNumber,
                              requestKey: slotPage.requestKey,
                              slotGeneration: slot.generation,
                              slotIndex: index
                            })
                          );
                        }}
                      />
                    ) : null
                  )}

                  {displayedPage && activeSlotPageKey === displayedPage.requestKey ? (
                    <>
                      <NativePdfTextLayer
                        pageNumber={displayedPage.pageNumber}
                        textLayer={displayedPageTextLayer}
                        renderedWidth={displayedPage.width}
                        renderedHeight={displayedPage.height}
                        renderTransform={displayedPage.textLayerTransform}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {isDebugModeEnabled && isRendering ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Rendering...
        </div>
      ) : null}

      {isDebugModeEnabled && loadingDocument && !displayedPage && !incomingPage ? (
        <div className="reader-page__status" role="status" aria-live="polite">
          Loading document...
        </div>
      ) : null}

      {renderError ? (
        <div className="reader-page__status reader-page__status--error" role="status">
          {renderError}
        </div>
      ) : null}

      {rapidTurnOverlay?.visible ? <RapidTurnOverlay overlay={rapidTurnOverlay} /> : null}

      <div
        ref={scrollbarRef}
        className={scrollbarState.visible ? "reader-scrollbar reader-scrollbar--visible" : "reader-scrollbar"}
        onPointerDown={(event) => {
          const scrollbarElement = scrollbarRef.current;
          if (!scrollbarElement || event.target !== event.currentTarget) {
            return;
          }

          const trackRect = scrollbarElement.getBoundingClientRect();
          const { thumbHeight, maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
          if (maxScroll <= 0 || maxThumbTop <= 0) {
            return;
          }

          const nextThumbTop = event.clientY - trackRect.top - thumbHeight / 2;
          const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
          const scrollSurface = scrollSurfaceRef.current;
          if (!scrollSurface) {
            return;
          }
          releaseSmoothWheelForManualScroll(scrollSurface);
          scrollSurface.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
        }}
      >
        <div
          className="reader-scrollbar-thumb"
          style={{
            height: `${scrollbarState.thumbHeight}px`,
            transform: `translateY(${scrollbarState.thumbTop}px)`
          }}
          onPointerDown={(event) => {
            const scrollSurface = scrollSurfaceRef.current;
            if (!scrollSurface) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            releaseSmoothWheelForManualScroll(scrollSurface);
            scrollbarDragRef.current = {
              pointerId: event.pointerId,
              startClientY: event.clientY,
              startScrollTop: scrollSurface.scrollTop
            };
          }}
        />
      </div>

      {isDebugModeEnabled && displayedPage ? (
        <div className="reader-page__status reader-page__status--debug" role="status">
          {`Text: ${displayedPageTextDebugStatus.state} (p${displayedPageTextDebugStatus.pageNumber ?? displayedPage.pageNumber}, items ${displayedPageTextDebugStatus.itemCount})`}
        </div>
      ) : null}
    </div>
  );
});

export default PdfViewer;
