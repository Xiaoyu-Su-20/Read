import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { readerDiagnostic } from "../debug/readerDiagnostics";
import { getCurrentAutoFitCycle } from "./autoFitDebug";
import {
  clampReaderPaneSplitRatioWithMinDocumentWidth,
  deriveReaderPaneLayout,
  getReaderPaneSplitRatioClampResultWithMinDocumentWidth,
  getReaderPaneNotesRatio,
  getReaderPaneSplitRatioFromPointer,
  getReaderPaneUsableWidth,
  nudgeReaderPaneSplitRatio,
  READER_PANE_STACKED_MEDIA_QUERY
} from "./paneLayout";

type UseReaderPaneLayoutControllerArgs = {
  preferredRatio: number;
  onCommitRatio: (nextRatio: number) => void;
  minDocumentWidthPx?: number | null;
};

type ReaderPaneSeparatorProps = {
  role: "separator";
  "aria-label": string;
  "aria-orientation": "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
};

type UseReaderPaneLayoutControllerResult = {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  workspaceStyle: CSSProperties;
  isDragging: boolean;
  isStackedLayout: boolean;
  separatorProps: ReaderPaneSeparatorProps;
};

const BODY_RESIZE_CLASS = "reader-pane-resizing";
const DEFAULT_SEPARATOR_VALUE = 46;

function updateWorkspaceRatio(
  separator: HTMLElement | null,
  preferredRatio: number,
  containerWidth: number
) {
  const layout = deriveReaderPaneLayout(preferredRatio, containerWidth);

  if (separator) {
    separator.setAttribute(
      "aria-valuenow",
      String(Math.round(layout.constrainedRatio * 100))
    );
  }

  return layout;
}

export function useReaderPaneLayoutController({
  preferredRatio,
  onCommitRatio,
  minDocumentWidthPx
}: UseReaderPaneLayoutControllerArgs): UseReaderPaneLayoutControllerResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const separatorRef = useRef<HTMLElement | null>(null);
  const draggingPointerIdRef = useRef<number | null>(null);
  const preferredRatioRef = useRef(preferredRatio);
  const previewRatioRef = useRef(preferredRatio);
  const minDocumentWidthRef = useRef<number | null>(minDocumentWidthPx ?? null);
  const lastPaneClampLogRef = useRef<{
    fitCycleId: string | null;
    nextSplitRatio: number | null;
    resultingDocumentWidth: number | null;
  }>({
    fitCycleId: null,
    nextSplitRatio: null,
    resultingDocumentWidth: null
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isStackedLayout, setIsStackedLayout] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(READER_PANE_STACKED_MEDIA_QUERY).matches;
  });
  const [hasMeasuredLayout, setHasMeasuredLayout] = useState(false);
  const [previewLayout, setPreviewLayout] = useState(() =>
    deriveReaderPaneLayout(preferredRatio, 0)
  );

  function getContainerWidth() {
    return containerRef.current?.getBoundingClientRect().width ?? 0;
  }

  function clampPreviewRatio(nextRatio: number, containerWidth: number) {
    if (
      typeof minDocumentWidthRef.current === "number" &&
      Number.isFinite(minDocumentWidthRef.current)
    ) {
      return clampReaderPaneSplitRatioWithMinDocumentWidth(
        nextRatio,
        containerWidth,
        minDocumentWidthRef.current
      );
    }

    return nextRatio;
  }

  function getMinDocumentWidthClampResult(nextRatio: number, containerWidth: number) {
    if (
      typeof minDocumentWidthRef.current !== "number" ||
      !Number.isFinite(minDocumentWidthRef.current)
    ) {
      return null;
    }

    return getReaderPaneSplitRatioClampResultWithMinDocumentWidth(
      nextRatio,
      containerWidth,
      minDocumentWidthRef.current
    );
  }

  function applyPreviewRatio(nextRatio: number, containerWidth = getContainerWidth()) {
    if (containerWidth <= 0) {
      return deriveReaderPaneLayout(nextRatio, 0);
    }

    const previousSplitRatio = previewRatioRef.current;
    const clampedRatio = clampPreviewRatio(nextRatio, containerWidth);
    previewRatioRef.current = clampedRatio;
    const layout = updateWorkspaceRatio(
      separatorRef.current,
      clampedRatio,
      containerWidth
    );
    setHasMeasuredLayout(true);
    setPreviewLayout((current) =>
      current.preferredRatio === layout.preferredRatio &&
      current.constrainedRatio === layout.constrainedRatio &&
      current.documentWidth === layout.documentWidth &&
      current.notesWidth === layout.notesWidth &&
      current.usableWidth === layout.usableWidth &&
      current.isConstrained === layout.isConstrained
        ? current
        : layout
    );
    const fitCycle = getCurrentAutoFitCycle();
    const minDocumentWidth = minDocumentWidthRef.current;
    const minDocumentWidthClamp = getMinDocumentWidthClampResult(nextRatio, containerWidth);
    const requestedDocumentWidth = Number(
      (getReaderPaneUsableWidth(containerWidth) * nextRatio).toFixed(2)
    );
    const shouldLogClamp =
      fitCycle &&
      typeof minDocumentWidth === "number" &&
      Number.isFinite(minDocumentWidth) &&
      Math.abs(clampedRatio - nextRatio) >= 0.0001 &&
      (
        lastPaneClampLogRef.current.fitCycleId !== fitCycle.fitCycleId ||
        lastPaneClampLogRef.current.nextSplitRatio === null ||
        Math.abs(layout.constrainedRatio - lastPaneClampLogRef.current.nextSplitRatio) >= 0.001 ||
        lastPaneClampLogRef.current.resultingDocumentWidth === null ||
        Math.abs(layout.documentWidth - lastPaneClampLogRef.current.resultingDocumentWidth) >= 1
      );

    if (shouldLogClamp) {
      lastPaneClampLogRef.current = {
        fitCycleId: fitCycle.fitCycleId,
        nextSplitRatio: layout.constrainedRatio,
        resultingDocumentWidth: layout.documentWidth
      };
      readerDiagnostic("pane-layout", "pane-layout.width-clamped", {
        containerWidth: Number(containerWidth.toFixed(2)),
        effectiveDocumentWidth: layout.documentWidth,
        fitCycleId: fitCycle.fitCycleId,
        minDocumentWidth: Number(minDocumentWidth.toFixed(2)),
        nextSplitRatio: layout.constrainedRatio,
        notesPaneMinWidthViolated: minDocumentWidthClamp?.violatesNotesMinWidth ?? false,
        resultingNotesWidth: minDocumentWidthClamp?.notesWidth ?? layout.notesWidth,
        previousDocumentWidth: Number(
          (getReaderPaneUsableWidth(containerWidth) * previousSplitRatio).toFixed(2)
        ),
        previousSplitRatio,
        requestedDocumentWidth,
        resultingDocumentWidth: layout.documentWidth
      });
    }

    return layout;
  }

  function commitPreviewRatio() {
    draggingPointerIdRef.current = null;
    setIsDragging(false);
    const containerWidth = getContainerWidth();
    if (containerWidth <= 0) {
      return;
    }
    const committedRatio = clampPreviewRatio(previewRatioRef.current, containerWidth);
    const layout = applyPreviewRatio(committedRatio, containerWidth);
    const nextRatio = layout.constrainedRatio;
    if (Math.abs(nextRatio - preferredRatioRef.current) > 0.0001) {
      onCommitRatio(nextRatio);
    }
  }

  useEffect(() => {
    preferredRatioRef.current = preferredRatio;
    minDocumentWidthRef.current = minDocumentWidthPx ?? null;
    if (!isDragging) {
      const containerWidth = getContainerWidth();
      if (containerWidth <= 0) {
        setHasMeasuredLayout(false);
        setPreviewLayout(deriveReaderPaneLayout(preferredRatio, 0));
        return;
      }
      const nextRatio = clampPreviewRatio(preferredRatio, containerWidth);
      applyPreviewRatio(nextRatio, containerWidth);
    }
  }, [isDragging, minDocumentWidthPx, preferredRatio]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.body.classList.toggle(BODY_RESIZE_CLASS, isDragging);
    return () => {
      document.body.classList.remove(BODY_RESIZE_CLASS);
    };
  }, [isDragging]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(READER_PANE_STACKED_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsStackedLayout(event.matches);
    };

    setIsStackedLayout(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateFromContainerWidth = () => {
      const containerWidth = getContainerWidth();
      if (containerWidth <= 0) {
        return;
      }
      const preferredOrPreview = isDragging ? previewRatioRef.current : preferredRatioRef.current;
      applyPreviewRatio(preferredOrPreview, containerWidth);
    };

    updateFromContainerWidth();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateFromContainerWidth();
          });

    resizeObserver?.observe(container);
    window.addEventListener("resize", updateFromContainerWidth);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateFromContainerWidth);
    };
  }, [isDragging]);

  const workspaceStyle = useMemo(
    () => {
      const documentRatio = hasMeasuredLayout
        ? previewLayout.constrainedRatio
        : preferredRatioRef.current;
      const notesRatio = getReaderPaneNotesRatio(documentRatio);

      return {
        ["--reader-pane-document-ratio"]: documentRatio.toFixed(4),
        ["--reader-pane-notes-ratio"]: notesRatio.toFixed(4),
        ["--reader-pane-document-width"]: hasMeasuredLayout
          ? `${previewLayout.documentWidth}px`
          : `calc((100% - var(--reader-splitter-line-width)) * ${documentRatio.toFixed(4)})`,
        ["--reader-pane-notes-width"]: hasMeasuredLayout
          ? `${previewLayout.notesWidth}px`
          : `calc((100% - var(--reader-splitter-line-width)) * ${notesRatio.toFixed(4)})`
      } as CSSProperties;
    },
    [hasMeasuredLayout, previewLayout]
  );

  const separatorProps: ReaderPaneSeparatorProps = {
    role: "separator",
    "aria-label": "Resize document and notes panes",
    "aria-orientation": "vertical",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Number.isFinite(previewLayout.constrainedRatio)
      ? Math.round(previewLayout.constrainedRatio * 100)
      : DEFAULT_SEPARATOR_VALUE,
    tabIndex: isStackedLayout ? -1 : 0,
    onKeyDown(event) {
      separatorRef.current = event.currentTarget;
      if (isStackedLayout) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const containerWidth = getContainerWidth();
      if (containerWidth <= 0) {
        return;
      }
      const previousRatio = preferredRatioRef.current;
      const candidateRatio = nudgeReaderPaneSplitRatio(
        previewRatioRef.current,
        event.key === "ArrowLeft" ? "left" : "right",
        containerWidth
      );
      const layout = applyPreviewRatio(candidateRatio, containerWidth);
      const committedRatio = layout.constrainedRatio;
      preferredRatioRef.current = committedRatio;
      if (Math.abs(committedRatio - previousRatio) > 0.0001) {
        onCommitRatio(committedRatio);
      }
    },
    onPointerDown(event) {
      if (isStackedLayout) {
        return;
      }

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        return;
      }

      event.preventDefault();
      separatorRef.current = event.currentTarget;
      draggingPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      const nextRatio = getReaderPaneSplitRatioFromPointer(
        event.clientX,
        containerRect.left,
        containerRect.width
      );
      applyPreviewRatio(nextRatio, containerRect.width);
    },
    onPointerMove(event) {
      if (draggingPointerIdRef.current !== event.pointerId || isStackedLayout) {
        return;
      }

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        return;
      }

      const nextRatio = getReaderPaneSplitRatioFromPointer(
        event.clientX,
        containerRect.left,
        containerRect.width
      );
      applyPreviewRatio(nextRatio, containerRect.width);
    },
    onPointerUp(event) {
      if (draggingPointerIdRef.current !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commitPreviewRatio();
    },
    onPointerCancel(event) {
      if (draggingPointerIdRef.current !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const containerWidth = getContainerWidth();
      if (containerWidth > 0) {
        applyPreviewRatio(preferredRatioRef.current, containerWidth);
      }
      draggingPointerIdRef.current = null;
      setIsDragging(false);
    },
    onLostPointerCapture() {
      if (draggingPointerIdRef.current === null) {
        return;
      }
      commitPreviewRatio();
    }
  };

  return {
    containerRef,
    workspaceStyle,
    isDragging,
    isStackedLayout,
    separatorProps
  };
}
