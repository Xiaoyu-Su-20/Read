import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clampReaderPaneSplitRatioWithMinDocumentWidth,
  deriveReaderPaneLayout,
  getReaderPaneNotesRatio,
  getReaderPaneSplitRatioFromPointer,
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
  container: HTMLDivElement | null,
  separator: HTMLElement | null,
  preferredRatio: number,
  containerWidth: number
) {
  const layout = deriveReaderPaneLayout(preferredRatio, containerWidth);

  if (container) {
    container.style.setProperty(
      "--reader-pane-document-ratio",
      layout.constrainedRatio.toFixed(4)
    );
    container.style.setProperty(
      "--reader-pane-notes-ratio",
      getReaderPaneNotesRatio(layout.constrainedRatio).toFixed(4)
    );
    container.style.setProperty("--reader-pane-document-width", `${layout.documentWidth}px`);
    container.style.setProperty("--reader-pane-notes-width", `${layout.notesWidth}px`);
  }

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
  const [isDragging, setIsDragging] = useState(false);
  const [isStackedLayout, setIsStackedLayout] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(READER_PANE_STACKED_MEDIA_QUERY).matches;
  });

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

  function applyPreviewRatio(nextRatio: number, containerWidth = getContainerWidth()) {
    const clampedRatio = clampPreviewRatio(nextRatio, containerWidth);
    previewRatioRef.current = clampedRatio;
    return updateWorkspaceRatio(
      containerRef.current,
      separatorRef.current,
      clampedRatio,
      containerWidth
    );
  }

  function commitPreviewRatio() {
    draggingPointerIdRef.current = null;
    setIsDragging(false);
    const containerWidth = getContainerWidth() || 1200;
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
      const containerWidth = getContainerWidth() || 1200;
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
      const preferredOrPreview = isDragging ? previewRatioRef.current : preferredRatioRef.current;
      applyPreviewRatio(preferredOrPreview, getContainerWidth());
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
    () =>
      ({
        ["--reader-pane-document-ratio"]: preferredRatio.toFixed(4),
        ["--reader-pane-notes-ratio"]: getReaderPaneNotesRatio(preferredRatio).toFixed(4),
        ["--reader-pane-document-width"]: `calc((100% - var(--reader-splitter-line-width)) * ${preferredRatio.toFixed(4)})`,
        ["--reader-pane-notes-width"]: `calc((100% - var(--reader-splitter-line-width)) * ${getReaderPaneNotesRatio(preferredRatio).toFixed(4)})`
      }) as CSSProperties,
    [preferredRatio]
  );

  const separatorProps: ReaderPaneSeparatorProps = {
    role: "separator",
    "aria-label": "Resize document and notes panes",
    "aria-orientation": "vertical",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Math.round(preferredRatio * 100) || DEFAULT_SEPARATOR_VALUE,
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
      const candidateRatio = nudgeReaderPaneSplitRatio(
        previewRatioRef.current,
        event.key === "ArrowLeft" ? "left" : "right",
        getContainerWidth() || 1200
      );
      const containerWidth = getContainerWidth() || 1200;
      const nextRatio = clampPreviewRatio(candidateRatio, containerWidth);
      preferredRatioRef.current = nextRatio;
      applyPreviewRatio(nextRatio, containerWidth);
      onCommitRatio(nextRatio);
    },
    onPointerDown(event) {
      if (isStackedLayout) {
        return;
      }

      event.preventDefault();
      separatorRef.current = event.currentTarget;
      draggingPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
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
      applyPreviewRatio(preferredRatioRef.current, getContainerWidth() || 1200);
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
