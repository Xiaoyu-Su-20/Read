import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { debugAction, debugError, debugLocalAction } from "../lib/debugLog";
import {
  buildPageTextRunSnapshots,
  extractSelectedRunFragments,
  normalizeSelectedRunFragments,
  sanitizePdfCopiedText,
  type PdfSelectionLike,
  type PdfTextRunSnapshot
} from "../lib/reader/PdfCopyNormalizer";
import type { PageTextLayerData, TextLayerTransform } from "../lib/types";

type PdfTextLayerProps = {
  pageNumber: number;
  textLayer: PageTextLayerData | null;
  renderedWidth: number;
  renderedHeight: number;
  renderTransform?: TextLayerTransform;
};

type TextLayerCopyEvent = Pick<ClipboardEvent, "clipboardData" | "preventDefault" | "stopPropagation">;
type RuntimeTextLayerViewport = {
  scale: number;
  rotation: 0;
  rawDims: {
    pageWidth: number;
    pageHeight: number;
    pageX: number;
    pageY: number;
  };
};
type RuntimeTextLayerInstance = {
  render: () => Promise<void>;
  cancel?: () => void;
  textDivs?: Node[];
};
type TextLayerRenderState = "missing" | "mismatch" | "rendering" | "ready" | "error";

const activeTextLayers = new Map<HTMLDivElement, HTMLSpanElement>();
let selectionListenerController: AbortController | null = null;
let isGlobalPointerDown = false;

function removeNullCharacters(value: string) {
  return value.replace(/\x00/g, "");
}

export function sanitizeCopiedTextLayerText(value: string) {
  return sanitizePdfCopiedText(removeNullCharacters(value));
}

export function copyTextLayerSelection(
  event: TextLayerCopyEvent,
  selection: PdfSelectionLike | null,
  textRuns: readonly PdfTextRunSnapshot[]
) {
  const selectedText = selection
    ? normalizeSelectedRunFragments(extractSelectedRunFragments(selection, textRuns))
    : "";
  const fallbackText = sanitizeCopiedTextLayerText(
    (selection as Selection | null)?.toString?.() ?? ""
  );
  const clipboardText = selectedText || fallbackText;
  if (event.clipboardData) {
    event.clipboardData.setData("text/plain", clipboardText);
  }
  event.preventDefault();
  event.stopPropagation();
}

export function deriveTextLayerScale(
  textLayer: Pick<PageTextLayerData, "viewportWidth" | "viewportHeight">,
  renderedWidth: number,
  renderedHeight: number
) {
  const scaleX = textLayer.viewportWidth > 0 ? renderedWidth / textLayer.viewportWidth : 1;
  const scaleY = textLayer.viewportHeight > 0 ? renderedHeight / textLayer.viewportHeight : 1;

  if (!Number.isFinite(scaleX) && !Number.isFinite(scaleY)) {
    return 1;
  }
  if (!Number.isFinite(scaleX)) {
    return scaleY;
  }
  if (!Number.isFinite(scaleY)) {
    return scaleX;
  }

  return Math.abs(scaleX - scaleY) <= 0.01 ? scaleX : (scaleX + scaleY) / 2;
}

export function createRuntimeTextLayerViewport(
  textLayer: Pick<PageTextLayerData, "viewportWidth" | "viewportHeight" | "viewportRawDims">,
  renderedWidth: number,
  renderedHeight: number
): RuntimeTextLayerViewport {
  return {
    scale: deriveTextLayerScale(textLayer, renderedWidth, renderedHeight),
    rotation: 0,
    rawDims: {
      pageWidth: Math.max(textLayer.viewportRawDims.pageWidth, 1),
      pageHeight: Math.max(textLayer.viewportRawDims.pageHeight, 1),
      pageX: textLayer.viewportRawDims.pageX,
      pageY: textLayer.viewportRawDims.pageY
    }
  };
}

export function getTextLayerRenderState(
  pageNumber: number,
  textLayer: PageTextLayerData | null
): TextLayerRenderState {
  if (!textLayer) {
    return "missing";
  }
  if (textLayer.pageNumber !== pageNumber) {
    return "mismatch";
  }
  return "rendering";
}

function getContainerMetrics(container: HTMLDivElement) {
  const rect = container.getBoundingClientRect();
  return {
    childCount: container.childElementCount,
    heightPx: Number(rect.height.toFixed(2)),
    widthPx: Number(rect.width.toFixed(2))
  };
}

function updateSelectionTailPosition(layer: HTMLDivElement, tail: HTMLSpanElement) {
  const spans = Array.from(layer.querySelectorAll<HTMLElement>("span")).filter(
    (span) =>
      !span.classList.contains("reader-page__selection-tail") &&
      !span.classList.contains("markedContent")
  );

  if (spans.length === 0) {
    tail.style.top = "100%";
    return;
  }

  const layerRect = layer.getBoundingClientRect();
  const scaleY = layer.offsetHeight > 0 ? layerRect.height / layer.offsetHeight : 1;
  let lowestBottom = 0;

  for (const span of spans) {
    const spanRect = span.getBoundingClientRect();
    lowestBottom = Math.max(lowestBottom, (spanRect.bottom - layerRect.top) / scaleY);
  }

  tail.style.top = `${Math.ceil(lowestBottom)}px`;
}

function resetSelectionArtifacts(selectionTail: HTMLSpanElement, container: HTMLDivElement) {
  container.append(selectionTail);
  container.classList.remove("selecting");
}

function removeGlobalSelectionListener() {
  if (activeTextLayers.size > 0) {
    return;
  }
  selectionListenerController?.abort();
  selectionListenerController = null;
  isGlobalPointerDown = false;
}

function enableGlobalSelectionListener() {
  if (selectionListenerController) {
    return;
  }

  selectionListenerController = new AbortController();
  const { signal } = selectionListenerController;

  document.addEventListener(
    "pointerdown",
    () => {
      isGlobalPointerDown = true;
    },
    { signal }
  );
  document.addEventListener(
    "pointerup",
    () => {
      isGlobalPointerDown = false;
      activeTextLayers.forEach((selectionTail, container) => {
        resetSelectionArtifacts(selectionTail, container);
      });
    },
    { signal }
  );
  window.addEventListener(
    "blur",
    () => {
      isGlobalPointerDown = false;
      activeTextLayers.forEach((selectionTail, container) => {
        resetSelectionArtifacts(selectionTail, container);
      });
    },
    { signal }
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isGlobalPointerDown) {
        activeTextLayers.forEach((selectionTail, container) => {
          resetSelectionArtifacts(selectionTail, container);
        });
      }
    },
    { signal }
  );
  document.addEventListener(
    "selectionchange",
    () => {
      const selectionChangeStartedAt = performance.now();
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        activeTextLayers.forEach((selectionTail, container) => {
          resetSelectionArtifacts(selectionTail, container);
        });
        debugLocalAction("reader.text-layer-selectionchange", {
          activeLayerCount: activeTextLayers.size,
          elapsedMs: Math.round(performance.now() - selectionChangeStartedAt),
          rangeCount: 0
        });
        return;
      }

      const activeSelectionLayers = new Set<HTMLDivElement>();
      for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
        const range = selection.getRangeAt(rangeIndex);
        for (const textLayerDiv of activeTextLayers.keys()) {
          if (
            !activeSelectionLayers.has(textLayerDiv) &&
            range.intersectsNode(textLayerDiv)
          ) {
            activeSelectionLayers.add(textLayerDiv);
          }
        }
      }

      for (const [textLayerDiv, selectionTail] of activeTextLayers) {
        if (activeSelectionLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add("selecting");
        } else {
          resetSelectionArtifacts(selectionTail, textLayerDiv);
        }
      }
      debugLocalAction("reader.text-layer-selectionchange", {
        activeLayerCount: activeTextLayers.size,
        activeSelectionLayerCount: activeSelectionLayers.size,
        elapsedMs: Math.round(performance.now() - selectionChangeStartedAt),
        rangeCount: selection.rangeCount
      });
    },
    { signal }
  );
}

function installSelectionBehavior(
  container: HTMLDivElement,
  selectionTail: HTMLSpanElement,
  handleCopy: (event: ClipboardEvent) => void
) {
  const controller = new AbortController();
  const { signal } = controller;

  container.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      container.classList.add("selecting");
    },
    { signal }
  );
  window.addEventListener(
    "pointerup",
    () => {
      resetSelectionArtifacts(selectionTail, container);
    },
    { signal }
  );
  window.addEventListener(
    "pointercancel",
    () => {
      resetSelectionArtifacts(selectionTail, container);
    },
    { signal }
  );
  container.addEventListener(
    "copy",
    handleCopy,
    { signal }
  );

  activeTextLayers.set(container, selectionTail);
  enableGlobalSelectionListener();

  return () => {
    controller.abort();
    activeTextLayers.delete(container);
    resetSelectionArtifacts(selectionTail, container);
    removeGlobalSelectionListener();
  };
}

const PdfTextLayer = memo(function PdfTextLayer({
  pageNumber,
  textLayer,
  renderedWidth,
  renderedHeight,
  renderTransform
}: PdfTextLayerProps) {
  const resolvedRenderTransform = useMemo<TextLayerTransform>(
    () =>
      renderTransform ?? {
        sourceWidth: renderedWidth,
        sourceHeight: renderedHeight,
        matrix: [1, 0, 0, 1, 0, 0]
      },
    [renderTransform, renderedHeight, renderedWidth]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const textRunsRef = useRef<PdfTextRunSnapshot[]>([]);
  const [textLayerState, setTextLayerState] = useState<TextLayerRenderState>(() =>
    getTextLayerRenderState(pageNumber, textLayer)
  );
  const runtimeScale = textLayer
    ? deriveTextLayerScale(
        textLayer,
        resolvedRenderTransform.sourceWidth,
        resolvedRenderTransform.sourceHeight
      )
    : 1;

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }

    container.replaceChildren();
    container.classList.remove("selecting");
    textRunsRef.current = [];

    let cancelled = false;
    let runtimeTextLayer: RuntimeTextLayerInstance | null = null;
    let cleanupSelectionBehavior: (() => void) | null = null;
    const baseFields = {
      pageNumber,
      renderedHeight,
      renderedWidth,
      textItemCount: textLayer?.textContent.items.length ?? 0,
      textLayerPageNumber: textLayer?.pageNumber ?? null,
      ...getContainerMetrics(container)
    };

    if (!textLayer) {
      setTextLayerState("missing");
      debugAction("reader.text-layer-missing", baseFields);
      return () => {
        cancelled = true;
      };
    }

    if (textLayer.pageNumber !== pageNumber) {
      setTextLayerState("mismatch");
      debugAction("reader.text-layer-mismatch", baseFields);
      return () => {
        cancelled = true;
      };
    }

    setTextLayerState("rendering");
    const textLayerRenderStartedAt = performance.now();

    try {
      const constructorStartedAt = performance.now();
      runtimeTextLayer = new pdfjsLib.TextLayer({
        textContentSource: textLayer.textContent,
        container,
        viewport: createRuntimeTextLayerViewport(
          textLayer,
          resolvedRenderTransform.sourceWidth,
          resolvedRenderTransform.sourceHeight
        ) as never
      }) as RuntimeTextLayerInstance;
      debugLocalAction("reader.text-layer-constructor", {
        ...baseFields,
        elapsedMs: Math.round(performance.now() - constructorStartedAt)
      });
      debugAction("reader.text-layer-render-start", {
        ...baseFields,
        rawPageHeight: textLayer.viewportRawDims.pageHeight,
        rawPageWidth: textLayer.viewportRawDims.pageWidth,
        rawPageX: textLayer.viewportRawDims.pageX,
        rawPageY: textLayer.viewportRawDims.pageY,
        viewportHeight: textLayer.viewportHeight,
        viewportWidth: textLayer.viewportWidth
      });
    } catch (error) {
      setTextLayerState("error");
      debugError("reader.text-layer-constructor-error", error, baseFields);
      return () => {
        cancelled = true;
        container.replaceChildren();
      };
    }

    void runtimeTextLayer
      .render()
      .then(() => {
        if (cancelled) {
          return;
        }

        const selectionTail = document.createElement("span");
        selectionTail.className = "reader-page__selection-tail";
        selectionTail.setAttribute("aria-hidden", "true");
        selectionTail.textContent = "\u200B";
        container.append(selectionTail);
        updateSelectionTailPosition(container, selectionTail);
        textRunsRef.current = buildPageTextRunSnapshots(
          textLayer,
          runtimeTextLayer?.textDivs ?? []
        );
        cleanupSelectionBehavior = installSelectionBehavior(
          container,
          selectionTail,
          (event) => {
            copyTextLayerSelection(
              event,
              window.getSelection() as PdfSelectionLike | null,
              textRunsRef.current
            );
          }
        );
        setTextLayerState("ready");
        debugLocalAction("reader.text-layer-rendered", {
          ...baseFields,
          elapsedMs: Math.round(performance.now() - textLayerRenderStartedAt),
          textRunCount: textRunsRef.current.length,
          ...getContainerMetrics(container)
        });
        debugAction("reader.text-layer-rendered", {
          ...baseFields,
          textRunCount: textRunsRef.current.length,
          ...getContainerMetrics(container)
        });

        if (cancelled) {
          cleanupSelectionBehavior();
          container.replaceChildren();
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        container.replaceChildren();
        setTextLayerState("error");
        debugError("reader.text-layer-render-error", error, {
          ...baseFields,
          ...getContainerMetrics(container)
        });
      });

    return () => {
      cancelled = true;
      runtimeTextLayer?.cancel?.();
      cleanupSelectionBehavior?.();
      textRunsRef.current = [];
      container.replaceChildren();
      debugLocalAction("reader.text-layer-unmount", {
        ...baseFields,
        elapsedMs: Math.round(performance.now() - textLayerRenderStartedAt),
        ...getContainerMetrics(container)
      });
      debugAction("reader.text-layer-unmount", {
        ...baseFields,
        ...getContainerMetrics(container)
      });
    };
  }, [pageNumber, resolvedRenderTransform, renderedHeight, renderedWidth, textLayer]);

  const layerStyle = {
    width: `${renderedWidth}px`,
    height: `${renderedHeight}px`
  } as CSSProperties;
  const [a, b, c, d, e, f] = resolvedRenderTransform.matrix;
  const contentStyle = {
    width: `${resolvedRenderTransform.sourceWidth}px`,
    height: `${resolvedRenderTransform.sourceHeight}px`,
    transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
    transformOrigin: "0 0",
    ["--total-scale-factor"]: String(runtimeScale)
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className="reader-page__text-layer"
      aria-label={`Text layer for page ${pageNumber}`}
      data-text-layer-page-number={textLayer?.pageNumber ?? ""}
      data-text-layer-state={textLayerState}
      style={layerStyle}
    >
      <div ref={contentRef} className="reader-page__text-content textLayer" style={contentStyle} />
    </div>
  );
});

export default PdfTextLayer;
