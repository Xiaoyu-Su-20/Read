import { beforeEach, describe, expect, it, vi } from "vitest";

const { debugAction, debugError } = vi.hoisted(() => ({
  debugAction: vi.fn(),
  debugError: vi.fn()
}));

vi.mock("../debugLog", () => ({
  debugAction,
  debugError
}));

import { createPdfRuntimeSession } from "./PdfRuntimeSession";

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createRuntimeFixture() {
  const readDocumentBytes = vi.fn(async () => [1, 2, 3, 4]);
  const destroyLoadingTask = vi.fn(async () => undefined);
  const destroyDocument = vi.fn(async () => undefined);

  const pageTextContent = new Map([
    [
      1,
      {
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
      }
    ],
    [
      2,
      {
        items: [
          {
            str: "Beta",
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
      }
    ],
    [
      3,
      {
        items: [
          {
            str: "Gamma target",
            dir: "ltr",
            transform: [10, 0, 0, 20, 30, 40],
            width: 110,
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
      }
    ]
  ]);

  const getPageTextContent = new Map<number, ReturnType<typeof vi.fn>>();
  const getPage = vi.fn(async (pageNumber: number) => {
    const getTextContent =
      getPageTextContent.get(pageNumber) ??
      vi.fn(async () => pageTextContent.get(pageNumber));
    getPageTextContent.set(pageNumber, getTextContent);

    return {
      getViewport: vi.fn(() => ({
        width: 100,
        height: 120,
        transform: [1, 0, 0, 1, 0, 0]
      })),
      getTextContent
    };
  });

  const pdfDocument = {
    numPages: 3,
    getDestination: vi.fn(async (destination: string) => {
      if (destination === "chapter-1") {
        return [0];
      }
      if (destination === "chapter-2") {
        return [{ id: "page-2" }, { name: "XYZ" }, 12, 34, 1.5];
      }
      return null;
    }),
    getPageIndex: vi.fn(async (reference: { id?: string }) =>
      reference.id === "page-2" ? 1 : 0
    ),
    getOutline: vi.fn(async () => [
      {
        title: "Chapter 1",
        dest: "chapter-1",
        bold: true,
        items: []
      },
      {
        title: "Chapter 2",
        dest: "chapter-2",
        items: []
      }
    ]),
    getPage,
    destroy: destroyDocument
  };

  const loadingTask = {
    promise: Promise.resolve(pdfDocument),
    destroy: destroyLoadingTask
  };

  const getDocument = vi.fn(() => loadingTask);

  return {
    readDocumentBytes,
    getDocument,
    destroyLoadingTask,
    destroyDocument,
    getPage,
    getPageTextContent,
    session: createPdfRuntimeSession("doc-1", {
      readDocumentBytes,
      getDocument: getDocument as never
    })
  };
}

describe("PdfRuntimeSession", () => {
  beforeEach(() => {
    debugAction.mockReset();
    debugError.mockReset();
  });

  it("does not read bytes until load is requested", async () => {
    const fixture = createRuntimeFixture();

    expect(fixture.readDocumentBytes).not.toHaveBeenCalled();

    await fixture.session.load();

    expect(fixture.readDocumentBytes).toHaveBeenCalledTimes(1);
    expect(fixture.getDocument).toHaveBeenCalledTimes(1);
  });

  it("loads lazily for outline, page text, and page plain text", async () => {
    const fixture = createRuntimeFixture();

    const outline = await fixture.session.getOutline();
    const textLayer = await fixture.session.getPageText(1);
    const plainText = await fixture.session.getPagePlainText(2);

    expect(outline[0]?.page).toBe(1);
    expect(outline[0]?.source).toBe("embedded");
    expect(outline[0]?.target).toEqual({
      documentId: "doc-1",
      pageIndex: 0
    });
    expect(outline[1]?.target).toEqual({
      documentId: "doc-1",
      pageIndex: 1,
      fit: "xyz",
      x: 12,
      y: 34,
      zoom: 1.5
    });
    expect(textLayer.pageNumber).toBe(1);
    expect(textLayer.viewportWidth).toBe(100);
    expect(plainText).toBe("beta");
    expect(fixture.readDocumentBytes).toHaveBeenCalledTimes(1);
    expect(fixture.getDocument).toHaveBeenCalledTimes(1);
  });

  it("reuses in-memory promises and cached data for repeated page text calls", async () => {
    const fixture = createRuntimeFixture();

    const [first, second] = await Promise.all([
      fixture.session.getPageText(1),
      fixture.session.getPageText(1)
    ]);

    const third = await fixture.session.getPageText(1);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(fixture.getPage).toHaveBeenCalledTimes(1);
    expect(fixture.getPageTextContent.get(1)).toHaveBeenCalledTimes(1);
  });

  it("searches incrementally and reuses cached page plain text", async () => {
    const fixture = createRuntimeFixture();

    const firstHit = await fixture.session.search("target");
    const secondHit = await fixture.session.search("beta");

    expect(firstHit).toBe(3);
    expect(secondHit).toBe(2);
    expect(fixture.getPageTextContent.get(1)).toHaveBeenCalledTimes(1);
    expect(fixture.getPageTextContent.get(2)).toHaveBeenCalledTimes(1);
    expect(fixture.getPageTextContent.get(3)).toHaveBeenCalledTimes(1);
  });

  it("keeps original-case search text and reports extracted pages", async () => {
    const fixture = createRuntimeFixture();

    const text = await fixture.session.getPageSearchText(1, new AbortController().signal);

    expect(text).toBe("Alpha");
    expect(fixture.session.getExtractedPageNumbers()).toEqual(new Set([1]));
    expect(await fixture.session.getPagePlainText(1)).toBe("alpha");
    expect(fixture.getPageTextContent.get(1)).toHaveBeenCalledTimes(1);
  });

  it("disposes caches and rejects reused access after disposal", async () => {
    const fixture = createRuntimeFixture();

    await fixture.session.getPageText(1);
    await fixture.session.dispose();

    await expect(fixture.session.getPageText(1)).rejects.toThrow("disposed");
    expect(fixture.destroyDocument).toHaveBeenCalledTimes(1);
    expect(fixture.destroyLoadingTask).toHaveBeenCalledTimes(1);
  });

  it("suppresses document-load errors from stale page text requests after disposal", async () => {
    const loadDeferred = createDeferredPromise<{
      numPages: number;
      getDestination: () => Promise<null>;
      getPageIndex: () => Promise<number>;
      getOutline: () => Promise<[]>;
      getPage: () => Promise<never>;
      destroy: () => Promise<void>;
    }>();
    void loadDeferred.promise.catch(() => undefined);
    const destroyLoadingTask = vi.fn(async () => undefined);
    const session = createPdfRuntimeSession("doc-1", {
      readDocumentBytes: vi.fn(async () => [1, 2, 3]),
      getDocument: vi.fn(() => ({
        promise: loadDeferred.promise,
        destroy: destroyLoadingTask
      })) as never
    });

    const pageTextPromise = session.getPageText(1);
    const rejection = expect(pageTextPromise).rejects.toThrow("disposed");
    await session.dispose();
    loadDeferred.reject(new Error("Worker was destroyed"));

    await rejection;
    expect(
      debugError.mock.calls.some(([event]) => event === "pdf-runtime.ensure-document-error")
    ).toBe(false);
  });

  it("suppresses page-text errors from stale requests after disposal", async () => {
    const textDeferred = createDeferredPromise<{
      items: Array<{
        str: string;
        dir: string;
        transform: [number, number, number, number, number, number];
        width: number;
        height: number;
        fontName: string;
        hasEOL: boolean;
      }>;
      styles: {
        f1: {
          fontFamily: string;
          ascent: number;
          descent: number;
          vertical: boolean;
        };
      };
      lang: null;
    }>();
    void textDeferred.promise.catch(() => undefined);
    const session = createPdfRuntimeSession("doc-1", {
      readDocumentBytes: vi.fn(async () => [1, 2, 3]),
      getDocument: vi.fn(() => ({
        promise: Promise.resolve({
          numPages: 1,
          getDestination: vi.fn(async () => null),
          getPageIndex: vi.fn(async () => 0),
          getOutline: vi.fn(async () => []),
          getPage: vi.fn(async () => ({
            getViewport: vi.fn(() => ({
              width: 100,
              height: 120,
              transform: [1, 0, 0, 1, 0, 0]
            })),
            getTextContent: vi.fn(() => textDeferred.promise)
          })),
          destroy: vi.fn(async () => undefined)
        })
      })) as never
    });

    const pageTextPromise = session.getPageText(1);
    const rejection = expect(pageTextPromise).rejects.toThrow("disposed");
    await session.dispose();
    textDeferred.reject(new Error("Invalid page request."));

    await rejection;
    expect(
      debugError.mock.calls.some(([event]) => event === "pdf-runtime.page-text-error")
    ).toBe(false);
  });
});
