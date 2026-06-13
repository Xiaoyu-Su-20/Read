import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

import { debugAction, debugError } from "../lib/debugLog";
import {
  buildPageTextRunSnapshots,
  extractSelectedRunFragments,
  normalizeSelectedRunFragments,
  sanitizePdfCopiedText,
  type PdfSelectionLike,
  type PdfTextRunSnapshot
} from "../lib/reader/PdfCopyNormalizer";
import type { PageTextLayerData } from "../lib/types";

type PdfTextLayerProps = {
  pageNumber: number;
  textLayer: PageTextLayerData | null;
  renderedWidth: number;
  renderedHeight: number;
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

const activeTextLayers = new Map<HTMLDivElement, HTMLDivElement>();
let selectionListenerController: AbortController | null = null;
let isGlobalPointerDown = false;
let isFirefoxTextSelection: boolean | null = null;
let previousSelectionRange: Range | null = null;

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

function resetSelectionArtifacts(endOfContent: HTMLDivElement, container: HTMLDivElement) {
  container.append(endOfContent);
  endOfContent.style.width = "";
  endOfContent.style.height = "";
  endOfContent.style.userSelect = "";
  container.classList.remove("selecting");
}

function removeGlobalSelectionListener() {
  if (activeTextLayers.size > 0) {
    return;
  }
  selectionListenerController?.abort();
  selectionListenerController = null;
  isGlobalPointerDown = false;
  isFirefoxTextSelection = null;
  previousSelectionRange = null;
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
      activeTextLayers.forEach((endOfContent, container) => {
        resetSelectionArtifacts(endOfContent, container);
      });
    },
    { signal }
  );
  window.addEventListener(
    "blur",
    () => {
      isGlobalPointerDown = false;
      activeTextLayers.forEach((endOfContent, container) => {
        resetSelectionArtifacts(endOfContent, container);
      });
    },
    { signal }
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isGlobalPointerDown) {
        activeTextLayers.forEach((endOfContent, container) => {
          resetSelectionArtifacts(endOfContent, container);
        });
      }
    },
    { signal }
  );
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        activeTextLayers.forEach((endOfContent, container) => {
          resetSelectionArtifacts(endOfContent, container);
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

      for (const [textLayerDiv, endOfContent] of activeTextLayers) {
        if (activeSelectionLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add("selecting");
        } else {
          resetSelectionArtifacts(endOfContent, textLayerDiv);
        }
      }

      const firstTextLayer = activeTextLayers.keys().next().value;
      if (!firstTextLayer) {
        return;
      }

      isFirefoxTextSelection ??=
        getComputedStyle(firstTextLayer).getPropertyValue("-moz-user-select") ===
        "none";
      if (isFirefoxTextSelection) {
        return;
      }

      const range = selection.getRangeAt(0);
      const modifyingStart =
        previousSelectionRange !== null &&
        (range.compareBoundaryPoints(Range.END_TO_END, previousSelectionRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, previousSelectionRange) ===
            0);

      let anchor: Node | null = modifyingStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }
      if (anchor instanceof HTMLElement && anchor.classList.contains("highlight")) {
        anchor = anchor.parentNode;
      }
      if (!anchor) {
        previousSelectionRange = range.cloneRange();
        return;
      }

      if (!modifyingStart && range.endOffset === 0) {
        do {
          while (anchor && !anchor.previousSibling) {
            anchor = anchor.parentNode;
          }
          anchor = anchor?.previousSibling ?? null;
        } while (anchor && anchor.childNodes.length === 0);
      }

      const anchorElement = anchor instanceof Element ? anchor : null;
      const parentTextLayer = anchorElement?.parentElement?.closest(
        ".reader-page__text-layer, .textLayer"
      ) as HTMLDivElement | null;
      const endOfContent = parentTextLayer ? activeTextLayers.get(parentTextLayer) : null;
      if (anchorElement?.parentElement && endOfContent && parentTextLayer) {
        endOfContent.style.width = parentTextLayer.style.width;
        endOfContent.style.height = parentTextLayer.style.height;
        endOfContent.style.userSelect = "text";
        anchorElement.parentElement.insertBefore(
          endOfContent,
          modifyingStart ? anchorElement : anchorElement.nextSibling
        );
      }

      previousSelectionRange = range.cloneRange();
    },
    { signal }
  );
}

function installSelectionBehavior(
  container: HTMLDivElement,
  endOfContent: HTMLDivElement,
  handleCopy: (event: ClipboardEvent) => void
) {
  const controller = new AbortController();
  const { signal } = controller;

  container.addEventListener(
    "mousedown",
    () => {
      container.classList.add("selecting");
    },
    { signal }
  );
  container.addEventListener(
    "copy",
    handleCopy,
    { signal }
  );

  activeTextLayers.set(container, endOfContent);
  enableGlobalSelectionListener();

  return () => {
    controller.abort();
    activeTextLayers.delete(container);
    resetSelectionArtifacts(endOfContent, container);
    removeGlobalSelectionListener();
  };
}

const PdfTextLayer = memo(function PdfTextLayer({
  pageNumber,
  textLayer,
  renderedWidth,
  renderedHeight
}: PdfTextLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRunsRef = useRef<PdfTextRunSnapshot[]>([]);
  const [textLayerState, setTextLayerState] = useState<TextLayerRenderState>(() =>
    getTextLayerRenderState(pageNumber, textLayer)
  );
  const runtimeScale = textLayer
    ? deriveTextLayerScale(textLayer, renderedWidth, renderedHeight)
    : 1;

  useEffect(() => {
    const container = containerRef.current;
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

    try {
      runtimeTextLayer = new pdfjsLib.TextLayer({
        textContentSource: textLayer.textContent,
        container,
        viewport: createRuntimeTextLayerViewport(
          textLayer,
          renderedWidth,
          renderedHeight
        ) as never
      }) as RuntimeTextLayerInstance;
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

        const endOfContent = document.createElement("div");
        endOfContent.className = "endOfContent";
        container.append(endOfContent);
        textRunsRef.current = buildPageTextRunSnapshots(
          textLayer,
          runtimeTextLayer?.textDivs ?? []
        );
        cleanupSelectionBehavior = installSelectionBehavior(
          container,
          endOfContent,
          (event) => {
            copyTextLayerSelection(
              event,
              window.getSelection() as PdfSelectionLike | null,
              textRunsRef.current
            );
          }
        );
        setTextLayerState("ready");
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
      debugAction("reader.text-layer-unmount", {
        ...baseFields,
        ...getContainerMetrics(container)
      });
    };
  }, [pageNumber, renderedHeight, renderedWidth, textLayer]);

  const layerStyle = {
    width: `${renderedWidth}px`,
    height: `${renderedHeight}px`,
    ["--total-scale-factor"]: String(runtimeScale)
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className="reader-page__text-layer textLayer"
      aria-label={`Text layer for page ${pageNumber}`}
      data-text-layer-page-number={textLayer?.pageNumber ?? ""}
      data-text-layer-state={textLayerState}
      style={layerStyle}
    />
  );
});

export default PdfTextLayer;
