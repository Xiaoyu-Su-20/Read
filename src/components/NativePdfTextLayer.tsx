import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

import { debugAction, debugLocalAction } from "../lib/debugLog";
import {
  buildNativeSelectedRunFragments,
  normalizeSelectedRunFragments,
  sanitizePdfCopiedText,
  type NativePdfSelectionLike
} from "../lib/reader/PdfCopyNormalizer";
import type {
  NativeTextPagePayload,
  NativeTextPoint,
  NativeTextQuad,
  NativeTextRect,
  TextLayerTransform
} from "../lib/types";

type NativePdfTextLayerProps = {
  pageNumber: number;
  textLayer: NativeTextPagePayload | null;
  renderedWidth: number;
  renderedHeight: number;
  renderTransform?: TextLayerTransform;
};

type SelectionState = {
  anchorIndex: number;
  focusIndex: number;
};

type DragState = {
  anchorIndex: number;
  focusIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  selectionUpdateCount: number;
  startedAtPerformance: number;
};

type HighlightRect = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LineBounds = NativeTextRect & {
  charEnd: number;
  charStart: number;
  lineIndex: number;
};

type NativeTextGeometry = {
  charBounds: NativeTextRect[];
  lineBounds: LineBounds[];
  transformedCharBounds: NativeTextRect[];
};

const HIT_TEST_PADDING = 3;
const HIT_TEST_MAX_DISTANCE = 18;
const DRAG_MOVE_THRESHOLD_PX = 3;

function fallbackTransform(renderedWidth: number, renderedHeight: number): TextLayerTransform {
  return {
    sourceWidth: renderedWidth,
    sourceHeight: renderedHeight,
    matrix: [1, 0, 0, 1, 0, 0]
  };
}

function applyMatrix(point: NativeTextPoint, matrix: TextLayerTransform["matrix"]) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f
  };
}

function invertPoint(point: NativeTextPoint, matrix: TextLayerTransform["matrix"]) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 0.000001) {
    return null;
  }

  const x = point.x - e;
  const y = point.y - f;
  return {
    x: (d * x - c * y) / determinant,
    y: (-b * x + a * y) / determinant
  };
}

function quadBounds(quad: NativeTextQuad): NativeTextRect {
  const xs = [quad.ul.x, quad.ur.x, quad.ll.x, quad.lr.x];
  const ys = [quad.ul.y, quad.ur.y, quad.ll.y, quad.lr.y];
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys)
  };
}

function transformedQuadBounds(
  quad: NativeTextQuad,
  matrix: TextLayerTransform["matrix"]
): NativeTextRect {
  return quadBounds({
    ul: applyMatrix(quad.ul, matrix),
    ur: applyMatrix(quad.ur, matrix),
    ll: applyMatrix(quad.ll, matrix),
    lr: applyMatrix(quad.lr, matrix)
  });
}

function distanceToRect(point: NativeTextPoint, rect: NativeTextRect) {
  const x0 = rect.x0 - HIT_TEST_PADDING;
  const y0 = rect.y0 - HIT_TEST_PADDING;
  const x1 = rect.x1 + HIT_TEST_PADDING;
  const y1 = rect.y1 + HIT_TEST_PADDING;
  const dx = point.x < x0 ? x0 - point.x : point.x > x1 ? point.x - x1 : 0;
  const dy = point.y < y0 ? y0 - point.y : point.y > y1 ? point.y - y1 : 0;
  return Math.hypot(dx, dy);
}

function buildNativeTextGeometry(
  textLayer: NativeTextPagePayload,
  matrix: TextLayerTransform["matrix"]
): NativeTextGeometry {
  const charBounds = textLayer.chars.map((char) => quadBounds(char.quad));
  const transformedCharBounds = textLayer.chars.map((char) =>
    transformedQuadBounds(char.quad, matrix)
  );
  const lineBounds = textLayer.lines.flatMap((line) => {
    let lineRect: NativeTextRect | null = null;

    for (let index = line.charStart; index < line.charEnd; index += 1) {
      const charRect = charBounds[index];
      if (!charRect) {
        continue;
      }

      lineRect = lineRect
        ? {
            x0: Math.min(lineRect.x0, charRect.x0),
            y0: Math.min(lineRect.y0, charRect.y0),
            x1: Math.max(lineRect.x1, charRect.x1),
            y1: Math.max(lineRect.y1, charRect.y1)
          }
        : charRect;
    }

    if (!lineRect) {
      return [];
    }

    return [
      {
        ...lineRect,
        charEnd: line.charEnd,
        charStart: line.charStart,
        lineIndex: line.index
      }
    ];
  });
  return {
    charBounds,
    lineBounds,
    transformedCharBounds
  };
}

function hitTestChar(
  charBounds: readonly NativeTextRect[],
  lineBounds: readonly LineBounds[],
  point: NativeTextPoint
) {
  let bestLineIndex = -1;
  let bestLineDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < lineBounds.length; index += 1) {
    const lineRect = lineBounds[index];
    if (!lineRect) {
      continue;
    }

    const distance = distanceToRect(point, lineRect);
    if (distance < bestLineDistance) {
      bestLineDistance = distance;
      bestLineIndex = index;
    }
  }

  if (bestLineIndex === -1 || bestLineDistance > HIT_TEST_MAX_DISTANCE) {
    return -1;
  }

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const primaryLine = lineBounds[bestLineIndex];
  const candidateLines = [bestLineIndex - 1, bestLineIndex, bestLineIndex + 1];

  for (const candidateLineIndex of candidateLines) {
    const candidateLine = lineBounds[candidateLineIndex];
    if (!candidateLine) {
      continue;
    }

    const scanStart = Math.max(candidateLine.charStart, 0);
    const scanEnd = Math.min(candidateLine.charEnd, charBounds.length);
    for (let index = scanStart; index < scanEnd; index += 1) {
      const rect = charBounds[index];
      if (!rect) {
        continue;
      }

      const distance = distanceToRect(point, rect);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  if (bestIndex !== -1) {
    return bestDistance <= HIT_TEST_MAX_DISTANCE ? bestIndex : -1;
  }

  for (let index = Math.max(primaryLine.charStart, 0); index < Math.min(primaryLine.charEnd, charBounds.length); index += 1) {
    const rect = charBounds[index];
    if (!rect) {
      continue;
    }

    const distance = distanceToRect(point, rect);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestDistance <= HIT_TEST_MAX_DISTANCE ? bestIndex : -1;
}

function selectedRange(selection: SelectionState | null) {
  if (!selection) {
    return null;
  }
  return {
    start: Math.min(selection.anchorIndex, selection.focusIndex),
    end: Math.max(selection.anchorIndex, selection.focusIndex)
  };
}

function buildSelectionText(textLayer: NativeTextPagePayload, selection: SelectionState | null) {
  const range = selectedRange(selection);
  if (!range) {
    return "";
  }

  const selectedLines: string[] = [];
  for (const line of textLayer.lines) {
    const lineStart = Math.max(line.charStart, range.start);
    const lineEnd = Math.min(line.charEnd - 1, range.end);
    if (lineEnd < lineStart) {
      continue;
    }

    let text = "";
    for (let index = lineStart; index <= lineEnd; index += 1) {
      text += textLayer.chars[index]?.text ?? "";
    }
    selectedLines.push(text);
  }

  return selectedLines.join("\n");
}

function normalizeNativeSelectionText(
  textLayer: NativeTextPagePayload,
  selection: SelectionState | null
) {
  if (!selection) {
    return "";
  }

  const normalizedText = normalizeSelectedRunFragments(
    buildNativeSelectedRunFragments(textLayer, selection as NativePdfSelectionLike)
  );
  if (normalizedText) {
    return normalizedText;
  }

  return sanitizePdfCopiedText(buildSelectionText(textLayer, selection));
}

function buildHighlightRects(
  textLayer: NativeTextPagePayload,
  selection: SelectionState | null,
  transformedCharBounds: readonly NativeTextRect[]
): HighlightRect[] {
  const range = selectedRange(selection);
  if (!range) {
    return [];
  }

  const rects: HighlightRect[] = [];
  for (const line of textLayer.lines) {
    const lineStart = Math.max(line.charStart, range.start);
    const lineEnd = Math.min(line.charEnd - 1, range.end);
    if (lineEnd < lineStart) {
      continue;
    }

    let rect: NativeTextRect | null = null;
    for (let index = lineStart; index <= lineEnd; index += 1) {
      const charRect = transformedCharBounds[index];
      if (!charRect) {
        continue;
      }
      rect = rect
        ? {
            x0: Math.min(rect.x0, charRect.x0),
            y0: Math.min(rect.y0, charRect.y0),
            x1: Math.max(rect.x1, charRect.x1),
            y1: Math.max(rect.y1, charRect.y1)
          }
        : charRect;
    }

    if (!rect) {
      continue;
    }

    rects.push({
      key: `${line.index}-${lineStart}-${lineEnd}`,
      x: rect.x0,
      y: rect.y0,
      width: Math.max(1, rect.x1 - rect.x0),
      height: Math.max(1, rect.y1 - rect.y0)
    });
  }

  return rects;
}

function pointFromPointerEvent(
  layer: HTMLDivElement,
  clientX: number,
  clientY: number,
  renderedWidth: number,
  renderedHeight: number,
  matrix: TextLayerTransform["matrix"]
) {
  const rect = layer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const renderedPoint = {
    x: (clientX - rect.left) * (renderedWidth / rect.width),
    y: (clientY - rect.top) * (renderedHeight / rect.height)
  };

  return invertPoint(renderedPoint, matrix);
}

function focusReaderSurface(layer: HTMLDivElement) {
  layer.closest<HTMLDivElement>(".reader-scroll-surface")?.focus({
    preventScroll: true
  });
}

function nativeTextLogFields(fields: Record<string, unknown>) {
  return {
    logOrigin: "native-text-layer",
    logPipeline: "frontend-mupdf-native-selection",
    ...fields
  };
}

const NativePdfTextLayer = memo(function NativePdfTextLayer({
  pageNumber,
  textLayer,
  renderedWidth,
  renderedHeight,
  renderTransform
}: NativePdfTextLayerProps) {
  const resolvedRenderTransform = useMemo(
    () => renderTransform ?? fallbackTransform(renderedWidth, renderedHeight),
    [renderTransform, renderedHeight, renderedWidth]
  );
  const layerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingPointerFrameRef = useRef<number | null>(null);
  const pendingPointerPositionRef = useRef<{ clientX: number; clientY: number; pointerId: number } | null>(
    null
  );
  const selectionRef = useRef<SelectionState | null>(null);
  const textLayerRef = useRef<NativeTextPagePayload | null>(textLayer);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const commitSelection = useCallback((nextSelection: SelectionState | null) => {
    const currentSelection = selectionRef.current;
    if (
      currentSelection?.anchorIndex === nextSelection?.anchorIndex &&
      currentSelection?.focusIndex === nextSelection?.focusIndex
    ) {
      return;
    }
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  }, []);

  useEffect(() => {
    textLayerRef.current = textLayer;
  }, [textLayer]);

  useEffect(() => {
    debugAction(
      "frontend.native-text-layer.mounted",
      nativeTextLogFields({
        pageNumber,
        renderedHeight,
        renderedWidth
      })
    );
    return () => {
      debugAction(
        "frontend.native-text-layer.unmounted",
        nativeTextLogFields({
          pageNumber,
          renderedHeight,
          renderedWidth
        })
      );
    };
  }, []);

  useEffect(() => {
    commitSelection(null);
    dragRef.current = null;
    debugAction(
      textLayer ? "frontend.native-text-layer.ready" : "frontend.native-text-layer.missing",
      nativeTextLogFields({
        charCount: textLayer?.chars.length ?? 0,
        lineCount: textLayer?.lines.length ?? 0,
        pageNumber,
        renderedHeight,
        renderedWidth,
        textLayerPageNumber: textLayer?.pageNumber ?? null,
        transformMatrix: renderTransform?.matrix ?? null
      })
    );

    if (!textLayer) {
      return;
    }

    const readyStartedAt = performance.now();
    let secondFrameId: number | null = null;
    const firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        debugAction(
          "frontend.native-text-layer.selectable-frame",
          nativeTextLogFields({
            charCount: textLayer.chars.length,
            elapsedMs: Math.round(performance.now() - readyStartedAt),
            lineCount: textLayer.lines.length,
            pageNumber,
            textLayerPageNumber: textLayer.pageNumber
          })
        );
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [commitSelection, pageNumber, textLayer]);

  const geometry = useMemo(
    () =>
      textLayer
        ? buildNativeTextGeometry(textLayer, resolvedRenderTransform.matrix)
        : null,
    [resolvedRenderTransform.matrix, textLayer]
  );

  const highlightRects = useMemo(
    () =>
      textLayer && geometry
        ? buildHighlightRects(textLayer, selection, geometry.transformedCharBounds)
        : [],
    [geometry, selection, textLayer]
  );

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      const currentTextLayer = textLayerRef.current;
      const currentSelection = selectionRef.current;
      if (!currentTextLayer || !selectedRange(currentSelection)) {
        return;
      }
      const selectedText = normalizeNativeSelectionText(currentTextLayer, currentSelection);
      if (!selectedText) {
        return;
      }
      event.clipboardData?.setData("text/plain", selectedText);
      event.preventDefault();
      debugAction(
        "frontend.native-text.selection-copy",
        nativeTextLogFields({
          pageNumber,
          textLength: selectedText.length
        })
      );
      debugLocalAction("reader.native-text-selection-copy", {
        pageNumber,
        textLength: selectedText.length
      });
    };

    document.addEventListener("copy", handleCopy);
    return () => {
      document.removeEventListener("copy", handleCopy);
    };
  }, [pageNumber]);

  const updateSelectionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const layer = layerRef.current;
      if (!drag || !layer || !textLayer || !geometry) {
        return;
      }
      const point = pointFromPointerEvent(
        layer,
        clientX,
        clientY,
        renderedWidth,
        renderedHeight,
        resolvedRenderTransform.matrix
      );
      if (!point) {
        return;
      }
      const focusIndex = hitTestChar(geometry.charBounds, geometry.lineBounds, point);
      if (focusIndex < 0) {
        return;
      }

      const moved =
        drag.moved ||
        Math.hypot(clientX - drag.startX, clientY - drag.startY) >=
          DRAG_MOVE_THRESHOLD_PX;
      if (focusIndex === drag.focusIndex && moved === drag.moved) {
        return;
      }
      drag.focusIndex = focusIndex;
      drag.moved = moved;
      drag.selectionUpdateCount += 1;
      commitSelection({
        anchorIndex: drag.anchorIndex,
        focusIndex
      });
    },
    [commitSelection, geometry, renderedHeight, renderedWidth, resolvedRenderTransform.matrix, textLayer]
  );

  useEffect(() => {
    return () => {
      if (pendingPointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingPointerFrameRef.current);
      }
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      focusReaderSurface(event.currentTarget);

      debugAction(
        "frontend.native-text.pointer-down",
        nativeTextLogFields({
          button: event.button,
          charCount: textLayer?.chars.length ?? 0,
          eventTimestamp: Math.round(event.timeStamp),
          hasTextLayer: Boolean(textLayer),
          isPrimary: event.isPrimary,
          lineCount: textLayer?.lines.length ?? 0,
          pageNumber,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          renderedHeight,
          renderedWidth,
          textLayerPageNumber: textLayer?.pageNumber ?? null
        })
      );

      if (!textLayer || !geometry || textLayer.chars.length === 0) {
        commitSelection(null);
        debugAction(
          "frontend.native-text.hit-test",
          nativeTextLogFields({
            hit: false,
            pageNumber,
            reason: textLayer ? "empty-text-layer" : "missing-text-layer"
          })
        );
        return;
      }

      const point = pointFromPointerEvent(
        event.currentTarget,
        event.clientX,
        event.clientY,
        renderedWidth,
        renderedHeight,
        resolvedRenderTransform.matrix
      );
      if (!point) {
        debugAction(
          "frontend.native-text.hit-test",
          nativeTextLogFields({
            hit: false,
            pageNumber,
            reason: "non-invertible-transform-or-empty-layer"
          })
        );
        return;
      }
      const anchorIndex = hitTestChar(geometry.charBounds, geometry.lineBounds, point);
      if (anchorIndex < 0) {
        commitSelection(null);
        debugAction(
          "frontend.native-text.hit-test",
          nativeTextLogFields({
            charCount: textLayer.chars.length,
            hit: false,
            pageNumber,
            pageX: Number(point.x.toFixed(2)),
            pageY: Number(point.y.toFixed(2)),
            reason: "no-char-near-pointer"
          })
        );
        return;
      }

      const anchorChar = textLayer.chars[anchorIndex] ?? null;
      debugAction(
        "frontend.native-text.hit-test",
        nativeTextLogFields({
          charCount: textLayer.chars.length,
          hit: true,
          hitCharIndex: anchorIndex,
          hitLineIndex: anchorChar?.lineIndex ?? null,
          pageNumber,
          pageX: Number(point.x.toFixed(2)),
          pageY: Number(point.y.toFixed(2))
        })
      );
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        anchorIndex,
        focusIndex: anchorIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        selectionUpdateCount: 0,
        startedAtPerformance: performance.now()
      };
      commitSelection({
        anchorIndex,
        focusIndex: anchorIndex
      });
      debugAction(
        "frontend.native-text.selection-start",
        nativeTextLogFields({
          anchorIndex,
          charCount: textLayer.chars.length,
          lineCount: textLayer.lines.length,
          pageNumber
        })
      );
      debugLocalAction("reader.native-text-selection-start", {
        charCount: textLayer.chars.length,
        lineCount: textLayer.lines.length,
        pageNumber
      });
    },
    [
      commitSelection,
      geometry,
      pageNumber,
      renderedHeight,
      renderedWidth,
      resolvedRenderTransform.matrix,
      textLayer
    ]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      pendingPointerPositionRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId
      };
      if (pendingPointerFrameRef.current !== null) {
        return;
      }
      pendingPointerFrameRef.current = window.requestAnimationFrame(() => {
        pendingPointerFrameRef.current = null;
        const pendingPointer = pendingPointerPositionRef.current;
        if (!pendingPointer || dragRef.current?.pointerId !== pendingPointer.pointerId) {
          return;
        }

        updateSelectionFromPointer(pendingPointer.clientX, pendingPointer.clientY);
      });
    },
    [updateSelectionFromPointer]
  );

  const finishPointerSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (pendingPointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingPointerFrameRef.current);
      pendingPointerFrameRef.current = null;
    }
    pendingPointerPositionRef.current = null;
    dragRef.current = null;
    if (!drag.moved) {
      commitSelection(null);
      return;
    }
    debugAction(
      "frontend.native-text.selection-finish",
      nativeTextLogFields({
        anchorIndex: drag.anchorIndex,
        durationMs: Math.round(performance.now() - drag.startedAtPerformance),
        focusIndex: drag.focusIndex,
        pageNumber,
        selectedCharCount: Math.abs(drag.focusIndex - drag.anchorIndex) + 1,
        selectionUpdateCount: drag.selectionUpdateCount
      })
    );
    debugLocalAction("reader.native-text-selection-finish", {
      durationMs: Math.round(performance.now() - drag.startedAtPerformance),
      pageNumber,
      selectedCharCount: Math.abs(drag.focusIndex - drag.anchorIndex) + 1,
      selectionUpdateCount: drag.selectionUpdateCount
    });
  }, [commitSelection, pageNumber]);

  const layerStyle = {
    width: `${renderedWidth}px`,
    height: `${renderedHeight}px`
  } as CSSProperties;

  return (
    <div
      ref={layerRef}
      className="reader-page__text-layer reader-page__native-text-layer"
      aria-label={`Text layer for page ${pageNumber}`}
      data-text-layer-page-number={textLayer?.pageNumber ?? ""}
      data-text-layer-state={textLayer ? "ready" : "missing"}
      style={layerStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerSelection}
      onPointerCancel={finishPointerSelection}
    >
      {highlightRects.map((rect) => (
        <div
          key={rect.key}
          className="reader-page__native-selection-rect"
          style={{
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
          }}
        />
      ))}
    </div>
  );
});

export default NativePdfTextLayer;
