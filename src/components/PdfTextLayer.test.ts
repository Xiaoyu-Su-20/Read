import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PdfTextLayer, {
  copyTextLayerSelection,
  createRuntimeTextLayerViewport,
  deriveTextLayerScale,
  getTextLayerRenderState,
  sanitizeCopiedTextLayerText
} from "./PdfTextLayer";
import type { PageTextLayerData } from "../lib/types";
import type { PdfSelectionLike, PdfTextRunSnapshot } from "../lib/reader/PdfCopyNormalizer";

function createTextLayerData(): PageTextLayerData {
  return {
    pageNumber: 4,
    textContent: {
      items: [
        {
          str: "Alpha",
          dir: "ltr",
          transform: [10, 0, 0, 20, 30, 40],
          width: 50,
          height: 20,
          fontName: "f1",
          hasEOL: false
        }
      ],
      styles: {
        f1: {
          fontFamily: "sans-serif",
          ascent: 0.8,
          descent: -0.2,
          vertical: false
        }
      },
      lang: null
    },
    viewportWidth: 100,
    viewportHeight: 100,
    viewportRawDims: {
      pageWidth: 100,
      pageHeight: 100,
      pageX: 0,
      pageY: 0
    },
    viewportTransform: [1, 0, 0, 1, 0, 0],
    rotation: 0
  };
}

function createFakeSpan(text: string) {
  const textNode = {
    nodeType: 3,
    textContent: text,
    parentNode: null as object | null,
    childNodes: [] as object[]
  };
  const span = {
    nodeType: 1,
    textContent: text,
    parentNode: null as object | null,
    childNodes: [textNode],
    firstChild: textNode
  };
  textNode.parentNode = span;
  return {
    span: span as unknown as Node,
    textNode: textNode as unknown as Node
  };
}

function createRun(
  text: string,
  overrides: Partial<PdfTextRunSnapshot> = {}
): PdfTextRunSnapshot {
  const { span } = createFakeSpan(text);
  return {
    pageIndex: overrides.pageIndex ?? 0,
    text,
    span,
    left: overrides.left ?? 0,
    right: overrides.right ?? Math.max(1, text.length * 6),
    top: overrides.top ?? 0,
    bottom: overrides.bottom ?? 10,
    baseline: overrides.baseline ?? 8,
    fontSize: overrides.fontSize ?? 10,
    height: overrides.height ?? 10,
    width: overrides.width ?? Math.max(1, text.length * 6),
    isNumeric: overrides.isNumeric ?? /^\d+$/.test(text),
    hasEOL: overrides.hasEOL ?? false
  };
}

describe("PdfTextLayer", () => {
  it("normalizes ligatures and removes null characters for copied text", () => {
    expect(sanitizeCopiedTextLayerText("of\uFB01ce\u0000 draft")).toBe("office draft");
  });

  it("writes normalized clean text to the clipboard on copy", () => {
    const setData = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const first = createRun("distinc-", {
      baseline: 10,
      bottom: 12,
      fontSize: 10,
      left: 0,
      right: 40,
      top: 0
    });
    const second = createRun("tion", {
      baseline: 22,
      bottom: 24,
      fontSize: 10,
      left: 0,
      pageIndex: 1,
      right: 25,
      top: 12
    });
    const firstTextNode = ((first.span as unknown) as { childNodes: Node[] }).childNodes[0]!;
    const secondTextNode = ((second.span as unknown) as { childNodes: Node[] }).childNodes[0]!;
    const selection: PdfSelectionLike = {
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: firstTextNode,
        startOffset: 0,
        endContainer: secondTextNode,
        endOffset: 4
      })
    };

    copyTextLayerSelection(
      {
        clipboardData: {
          setData
        } as unknown as DataTransfer,
        preventDefault,
        stopPropagation
      },
      selection,
      [first, second]
    );

    expect(setData).toHaveBeenCalledWith("text/plain", "distinction");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw selection text when no run metadata is available", () => {
    const setData = vi.fn();

    copyTextLayerSelection(
      {
        clipboardData: {
          setData
        } as unknown as DataTransfer,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      },
      {
        rangeCount: 0,
        getRangeAt: vi.fn(),
        toString: () => "of\uFB01ce\u0000 draft"
      } as unknown as PdfSelectionLike,
      []
    );

    expect(setData).toHaveBeenCalledWith("text/plain", "office draft");
  });

  it("keeps the overlay mounted when no text layer data is available", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 1,
        textLayer: null,
        renderedWidth: 612,
        renderedHeight: 792
      })
    );

    expect(markup).toContain("reader-page__text-layer");
    expect(markup).toContain("data-text-layer-state=\"missing\"");
  });

  it("uses the rendered image box as the overlay dimensions", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 4,
        textLayer: createTextLayerData(),
        renderedWidth: 612,
        renderedHeight: 792
      })
    );

    expect(markup).toContain("width:612px");
    expect(markup).toContain("height:792px");
  });

  it("renders the overlay container for the visible page", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 4,
        textLayer: createTextLayerData(),
        renderedWidth: 200,
        renderedHeight: 300
      })
    );

    expect(markup).toContain("reader-page__text-layer");
    expect(markup).toContain("aria-label=\"Text layer for page 4\"");
    expect(markup).toContain("data-text-layer-state=\"rendering\"");
  });

  it("marks the overlay as mismatched when the page numbers differ", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 5,
        textLayer: createTextLayerData(),
        renderedWidth: 200,
        renderedHeight: 300
      })
    );

    expect(markup).toContain("data-text-layer-state=\"mismatch\"");
    expect(markup).toContain("data-text-layer-page-number=\"4\"");
  });

  it("derives text-layer scale from the rendered box rather than viewer zoom state", () => {
    expect(deriveTextLayerScale(createTextLayerData(), 200, 300)).toBe(2.5);
  });

  it("builds a runtime viewport from the rendered image box", () => {
    expect(createRuntimeTextLayerViewport(createTextLayerData(), 200, 300)).toEqual({
      scale: 2.5,
      rotation: 0,
      rawDims: {
        pageWidth: 100,
        pageHeight: 100,
        pageX: 0,
        pageY: 0
      }
    });
  });

  it("writes the derived scale factor to the overlay container", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 4,
        textLayer: createTextLayerData(),
        renderedWidth: 200,
        renderedHeight: 300
      })
    );

    expect(markup).toContain("--total-scale-factor:2.5");
  });

  it("applies the backend affine transform to the inner text layer", () => {
    const markup = renderToStaticMarkup(
      createElement(PdfTextLayer, {
        pageNumber: 4,
        textLayer: createTextLayerData(),
        renderedWidth: 300,
        renderedHeight: 400,
        renderTransform: {
          sourceWidth: 100,
          sourceHeight: 100,
          matrix: [2, 0, 0, 2, 40, 60]
        }
      })
    );

    expect(markup).toContain("matrix(2, 0, 0, 2, 40, 60)");
    expect(markup).toContain("reader-page__text-content textLayer");
  });

  it("derives explicit states for missing, mismatched, and active text layers", () => {
    expect(getTextLayerRenderState(4, null)).toBe("missing");
    expect(getTextLayerRenderState(5, createTextLayerData())).toBe("mismatch");
    expect(getTextLayerRenderState(4, createTextLayerData())).toBe("rendering");
  });
});
