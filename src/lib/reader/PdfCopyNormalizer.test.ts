import { describe, expect, it } from "vitest";

import {
  buildPageTextRunSnapshots,
  extractSelectedRunFragments,
  normalizeSelectedRunFragments,
  type PdfSelectedTextRunFragment,
  type PdfTextRunSnapshot
} from "./PdfCopyNormalizer";
import type { PageTextLayerData } from "../types";

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

function createTextLayerData(items: PageTextLayerData["textContent"]["items"]): PageTextLayerData {
  return {
    pageNumber: 1,
    textContent: {
      items,
      styles: {
        body: {
          fontFamily: "serif",
          ascent: 0.8,
          descent: -0.2,
          vertical: false
        },
        footnote: {
          fontFamily: "serif",
          ascent: 0.8,
          descent: -0.2,
          vertical: false
        }
      },
      lang: null
    },
    viewportWidth: 100,
    viewportHeight: 120,
    viewportRawDims: {
      pageWidth: 100,
      pageHeight: 120,
      pageX: 0,
      pageY: 0
    },
    viewportTransform: [1, 0, 0, 1, 0, 0],
    rotation: 0
  };
}

function createRun(
  text: string,
  overrides: Partial<PdfSelectedTextRunFragment> = {}
): PdfSelectedTextRunFragment {
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
    hasEOL: overrides.hasEOL ?? false,
    selectedStart: overrides.selectedStart ?? 0,
    selectedEnd: overrides.selectedEnd ?? text.length
  };
}

describe("PdfCopyNormalizer", () => {
  it("builds page text runs from text content items and spans", () => {
    const textLayer = createTextLayerData([
      {
        str: "Alpha",
        dir: "ltr",
        transform: [1, 0, 0, 10, 10, 100],
        width: 20,
        height: 10,
        fontName: "body",
        hasEOL: false
      }
    ]);
    const { span } = createFakeSpan("Alpha");

    const runs = buildPageTextRunSnapshots(textLayer, [span]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("Alpha");
    expect(runs[0]?.baseline).toBeGreaterThan(runs[0]?.top ?? 0);
  });

  it("extracts partial boundary selections across multiple runs", () => {
    const first = createFakeSpan("Michel");
    const second = createFakeSpan("Serres");
    const third = createFakeSpan("puts");
    const runs: PdfTextRunSnapshot[] = [
      {
        ...createRun("Michel"),
        span: first.span
      },
      {
        ...createRun("Serres", { pageIndex: 1 }),
        span: second.span
      },
      {
        ...createRun("puts", { pageIndex: 2 }),
        span: third.span
      }
    ];

    const fragments = extractSelectedRunFragments(
      {
        rangeCount: 1,
        getRangeAt: () => ({
          startContainer: first.textNode,
          startOffset: 2,
          endContainer: third.textNode,
          endOffset: 2
        })
      },
      runs
    );

    expect(fragments.map((fragment) => fragment.text)).toEqual(["chel", "Serres", "pu"]);
  });

  it("resolves whole-paragraph selections anchored on a container element", () => {
    const first = createFakeSpan("Entertainment");
    const second = createFakeSpan("via");
    const third = createFakeSpan("media");
    const container = {
      nodeType: 1,
      childNodes: [first.span, second.span, third.span],
      parentNode: null
    } as unknown as Node;
    (first.span as { parentNode: Node | null }).parentNode = container;
    (second.span as { parentNode: Node | null }).parentNode = container;
    (third.span as { parentNode: Node | null }).parentNode = container;
    const runs: PdfTextRunSnapshot[] = [
      {
        ...createRun("Entertainment"),
        span: first.span
      },
      {
        ...createRun("via", { left: 70, pageIndex: 1, right: 88 }),
        span: second.span
      },
      {
        ...createRun("media", { left: 92, pageIndex: 2, right: 120 }),
        span: third.span
      }
    ];

    const fragments = extractSelectedRunFragments(
      {
        rangeCount: 1,
        getRangeAt: () => ({
          startContainer: container,
          startOffset: 0,
          endContainer: container,
          endOffset: 3
        })
      },
      runs
    );

    expect(fragments.map((fragment) => fragment.text)).toEqual([
      "Entertainment",
      "via",
      "media"
    ]);
  });

  it("converts conservative superscript footnotes into bracketed markers", () => {
    const result = normalizeSelectedRunFragments([
      createRun("it.", {
        baseline: 10,
        fontSize: 10,
        left: 0,
        right: 12,
        top: 0
      }),
      createRun("20", {
        baseline: 8,
        fontSize: 6,
        isNumeric: true,
        left: 12.5,
        pageIndex: 1,
        right: 16,
        top: 2
      })
    ]);

    expect(result).toBe("it.[20]");
  });

  it("converts raised attached numeric footnotes even when they are near body size", () => {
    const result = normalizeSelectedRunFragments([
      createRun("life.", {
        baseline: 10,
        fontSize: 10,
        left: 0,
        right: 18,
        top: 0
      }),
      createRun("10", {
        baseline: 8.2,
        fontSize: 9.9,
        isNumeric: true,
        left: 18.5,
        pageIndex: 1,
        right: 23,
        top: 0.3
      })
    ]);

    expect(result).toBe("life.[10]");
  });

  it("repairs soft line-ending hyphenation across visual lines", () => {
    const result = normalizeSelectedRunFragments([
      createRun("distinc-", {
        baseline: 10,
        fontSize: 10,
        left: 0,
        right: 40,
        top: 0
      }),
      createRun("tion", {
        baseline: 22,
        fontSize: 10,
        left: 0,
        pageIndex: 1,
        right: 22,
        top: 12
      })
    ]);

    expect(result).toBe("distinction");
  });

  it("joins visual prose lines inside the same paragraph", () => {
    const result = normalizeSelectedRunFragments([
      createRun("The sequences of", {
        baseline: 10,
        fontSize: 10,
        left: 0,
        right: 70,
        top: 0
      }),
      createRun("distinction continue", {
        baseline: 22,
        fontSize: 10,
        left: 0,
        pageIndex: 1,
        right: 90,
        top: 12
      })
    ]);

    expect(result).toBe("The sequences of distinction continue");
  });

  it("preserves real paragraph breaks as blank lines", () => {
    const result = normalizeSelectedRunFragments([
      createRun("Paragraph one line one.", {
        baseline: 10,
        left: 0,
        right: 100,
        top: 0
      }),
      createRun("Paragraph one line two.", {
        baseline: 22,
        left: 0,
        pageIndex: 1,
        right: 100,
        top: 12
      }),
      createRun("Paragraph one line three.", {
        baseline: 34,
        left: 0,
        pageIndex: 2,
        right: 110,
        top: 24
      }),
      createRun("Paragraph two starts here.", {
        baseline: 74,
        left: 0,
        pageIndex: 3,
        right: 110,
        top: 64
      })
    ]);

    expect(result).toBe(
      "Paragraph one line one. Paragraph one line two. Paragraph one line three.\n\nParagraph two starts here."
    );
  });

  it("keeps normal inline numbers unchanged", () => {
    const result = normalizeSelectedRunFragments([
      createRun("Room", {
        baseline: 10,
        left: 0,
        right: 24,
        top: 0
      }),
      createRun("101", {
        baseline: 10,
        fontSize: 10,
        isNumeric: true,
        left: 28,
        pageIndex: 1,
        right: 42,
        top: 0
      })
    ]);

    expect(result).toBe("Room 101");
  });

  it("falls back to preserving visual line breaks for suspicious layouts", () => {
    const result = normalizeSelectedRunFragments([
      createRun("alpha", {
        baseline: 10,
        left: 0,
        right: 24,
        top: 0
      }),
      createRun("beta", {
        baseline: 22,
        left: 0,
        pageIndex: 1,
        right: 20,
        top: 12
      }),
      createRun("gamma", {
        baseline: 10,
        left: 60,
        pageIndex: 2,
        right: 88,
        top: 0
      })
    ]);

    expect(result).toBe("alpha\nbeta\ngamma");
  });
});
