import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent
} from "pdfjs-dist/types/src/display/api";

import { readDocumentBytes } from "../api";
import { debugAction, debugError } from "../debugLog";
import type { OutlineItem, PageTextLayerData } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).toString();

type RuntimePdfPage = Pick<PDFPageProxy, "getViewport" | "getTextContent">;
type RuntimeViewport = {
  height: number;
  rawDims?: {
    pageHeight: number;
    pageWidth: number;
    pageX: number;
    pageY: number;
  };
  transform: [number, number, number, number, number, number];
  width: number;
};
type RuntimePdfDocument = Pick<
  PDFDocumentProxy,
  "numPages" | "getDestination" | "getPageIndex" | "getOutline" | "destroy"
> & {
  getPage: (pageNumber: number) => Promise<RuntimePdfPage>;
};
type PdfLoadingTaskLike = {
  promise: Promise<RuntimePdfDocument>;
  destroy?: () => Promise<unknown> | unknown;
};
type RuntimeDependencies = {
  readDocumentBytes?: typeof readDocumentBytes;
  getDocument?: (src: Parameters<typeof pdfjsLib.getDocument>[0]) => PdfLoadingTaskLike;
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

async function resolveDestinationPage(
  document: RuntimePdfDocument,
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
    const index = await document.getPageIndex(reference);
    return index + 1;
  }

  return null;
}

async function extractOutline(
  document: RuntimePdfDocument,
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

function isTextItem(
  item: import("pdfjs-dist/types/src/display/api").TextContent["items"][number]
): item is import("pdfjs-dist/types/src/display/api").TextItem {
  return "str" in item;
}

function createDisposedError() {
  return new Error("PDF runtime session has been disposed.");
}

function getViewportRawDims(viewport: RuntimeViewport) {
  return {
    pageWidth: viewport.rawDims?.pageWidth ?? viewport.width,
    pageHeight: viewport.rawDims?.pageHeight ?? viewport.height,
    pageX: viewport.rawDims?.pageX ?? 0,
    pageY: viewport.rawDims?.pageY ?? 0
  };
}

export function createPdfRuntimeSession(
  documentId: string,
  dependencies: RuntimeDependencies = {}
) {
  const readBytes = dependencies.readDocumentBytes ?? readDocumentBytes;
  const getDocument: NonNullable<RuntimeDependencies["getDocument"]> =
    dependencies.getDocument ??
    ((src) => pdfjsLib.getDocument(src) as unknown as PdfLoadingTaskLike);

  let disposed = false;
  let loadingTask: PdfLoadingTaskLike | null = null;
  let documentPromise: Promise<RuntimePdfDocument> | null = null;
  let loadedDocument: RuntimePdfDocument | null = null;
  let outlinePromise: Promise<OutlineItem[]> | null = null;
  let outlineCache: OutlineItem[] | null = null;

  const pageTextPromises = new Map<number, Promise<PageTextLayerData>>();
  const pageTextCache = new Map<number, PageTextLayerData>();
  const plainTextPromises = new Map<number, Promise<string>>();
  const plainTextCache = new Map<number, string>();

  function assertActive() {
    if (disposed) {
      throw createDisposedError();
    }
  }

  async function ensureDocument(): Promise<RuntimePdfDocument> {
    assertActive();

    if (loadedDocument) {
      debugAction("pdf-runtime.ensure-document-cache-hit", {
        documentId
      });
      return loadedDocument;
    }

    if (!documentPromise) {
      debugAction("pdf-runtime.ensure-document-start", {
        documentId
      });
      documentPromise = (async () => {
        const loadedBytes = await readBytes(documentId);
        assertActive();
        debugAction("pdf-runtime.bytes-loaded", {
          documentId,
          byteLength: loadedBytes.length
        });

        const nextLoadingTask = getDocument({
          data: Uint8Array.from(loadedBytes),
          cMapUrl,
          cMapPacked: true,
          iccUrl,
          standardFontDataUrl,
          wasmUrl,
          useWorkerFetch: false,
          useWasm: false,
          disableFontFace: false,
          useSystemFonts: true
        });
        loadingTask = nextLoadingTask;

        const textDocument = await nextLoadingTask.promise;
        assertActive();
        debugAction("pdf-runtime.document-loaded", {
          documentId,
          pageCount: textDocument.numPages
        });
        loadedDocument = textDocument;
        return textDocument;
      })().catch((error) => {
        documentPromise = null;
        debugError("pdf-runtime.ensure-document-error", error, {
          documentId
        });
        throw error;
      });
    }

    return documentPromise;
  }

  async function load() {
    debugAction("pdf-runtime.load-called", {
      documentId
    });
    await ensureDocument();
  }

  async function getOutline() {
    assertActive();

    if (outlineCache) {
      return outlineCache;
    }

    if (!outlinePromise) {
      outlinePromise = (async () => {
        const document = await ensureDocument();
        const outline = await extractOutline(document, await document.getOutline());
        assertActive();
        outlineCache = outline;
        return outline;
      })().catch((error) => {
        outlinePromise = null;
        throw error;
      });
    }

    return outlinePromise;
  }

  async function getPageText(pageNumber: number) {
    assertActive();

    const cached = pageTextCache.get(pageNumber);
    if (cached) {
      debugAction("pdf-runtime.page-text-cache-hit", {
        documentId,
        itemCount: cached.textContent.items.length,
        pageNumber
      });
      return cached;
    }

    const existing = pageTextPromises.get(pageNumber);
    if (existing) {
      debugAction("pdf-runtime.page-text-promise-hit", {
        documentId,
        pageNumber
      });
      return existing;
    }

    debugAction("pdf-runtime.page-text-requested", {
      documentId,
      pageNumber
    });
    const nextTextPromise = (async () => {
      const document = await ensureDocument();
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({
        scale: 1,
        rotation: 0
      }) as unknown as RuntimeViewport;
      const rawDims = getViewportRawDims(viewport);
      const textContent = await page.getTextContent();
      assertActive();

      const payload: PageTextLayerData = {
        pageNumber,
        textContent,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewportRawDims: {
          pageWidth: rawDims.pageWidth,
          pageHeight: rawDims.pageHeight,
          pageX: rawDims.pageX,
          pageY: rawDims.pageY
        },
        viewportTransform: viewport.transform as [number, number, number, number, number, number],
        rotation: 0
      };

      pageTextCache.set(pageNumber, payload);
      pageTextPromises.delete(pageNumber);
      debugAction("pdf-runtime.page-text-loaded", {
        documentId,
        itemCount: textContent.items.length,
        pageNumber,
        rawPageHeight: rawDims.pageHeight,
        rawPageWidth: rawDims.pageWidth,
        rawPageX: rawDims.pageX,
        rawPageY: rawDims.pageY,
        viewportHeight: viewport.height,
        viewportWidth: viewport.width
      });
      return payload;
    })().catch((error) => {
      pageTextPromises.delete(pageNumber);
      debugError("pdf-runtime.page-text-error", error, {
        documentId,
        pageNumber
      });
      throw error;
    });

    pageTextPromises.set(pageNumber, nextTextPromise);
    return nextTextPromise;
  }

  async function getPagePlainText(pageNumber: number) {
    assertActive();

    const cached = plainTextCache.get(pageNumber);
    if (cached !== undefined) {
      return cached;
    }

    const existing = plainTextPromises.get(pageNumber);
    if (existing) {
      return existing;
    }

    const nextPlainTextPromise = (async () => {
      const existingPageText = pageTextCache.get(pageNumber);
      if (existingPageText) {
        const text = existingPageText.textContent.items
          .map((item) => (isTextItem(item) ? item.str : ""))
          .join(" ")
          .toLowerCase();
        plainTextCache.set(pageNumber, text);
        plainTextPromises.delete(pageNumber);
        return text;
      }

      const document = await ensureDocument();
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      assertActive();

      const text = textContent.items
        .map((item) => (isTextItem(item) ? item.str : ""))
        .join(" ")
        .toLowerCase();

      plainTextCache.set(pageNumber, text);
      plainTextPromises.delete(pageNumber);
      return text;
    })().catch((error) => {
      plainTextPromises.delete(pageNumber);
      throw error;
    });

    plainTextPromises.set(pageNumber, nextPlainTextPromise);
    return nextPlainTextPromise;
  }

  async function search(query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return 0;
    }

    const document = await ensureDocument();
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pageText = await getPagePlainText(pageNumber);
      assertActive();

      if (pageText.includes(normalizedQuery)) {
        return pageNumber;
      }
    }

    return 0;
  }

  async function dispose() {
    if (disposed) {
      return;
    }

    debugAction("pdf-runtime.dispose", {
      documentId,
      cachedPageCount: pageTextCache.size,
      cachedPlainTextCount: plainTextCache.size
    });
    disposed = true;
    outlinePromise = null;
    outlineCache = null;
    documentPromise = null;
    pageTextPromises.clear();
    pageTextCache.clear();
    plainTextPromises.clear();
    plainTextCache.clear();

    const documentToDestroy = loadedDocument;
    const loadingTaskToDestroy = loadingTask;
    loadedDocument = null;
    loadingTask = null;

    const destroyOperations: Promise<unknown>[] = [];
    if (documentToDestroy && "destroy" in documentToDestroy && typeof documentToDestroy.destroy === "function") {
      destroyOperations.push(Promise.resolve(documentToDestroy.destroy()));
    }
    if (loadingTaskToDestroy && typeof loadingTaskToDestroy.destroy === "function") {
      destroyOperations.push(Promise.resolve(loadingTaskToDestroy.destroy()));
    }

    if (destroyOperations.length > 0) {
      await Promise.allSettled(destroyOperations);
    }
  }

  return {
    load,
    getOutline,
    getPageText,
    getPagePlainText,
    search,
    dispose
  };
}

export type PdfRuntimeSession = ReturnType<typeof createPdfRuntimeSession>;
