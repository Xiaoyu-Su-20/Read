import { convertFileSrc } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent
} from "pdfjs-dist/types/src/display/api";

import { readDocumentBytes } from "../api";
import { debugAction, debugError } from "../debugLog";
import type { OutlineItem, PageTextLayerData, PdfNavigationFit, PdfNavigationTarget } from "../types";

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
  convertFileSrc?: typeof convertFileSrc;
  documentFilePath?: string | null;
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

function numericDestinationValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function destinationFit(value: unknown): PdfNavigationFit | null {
  if (!value || typeof value !== "object" || !("name" in value)) {
    return null;
  }

  const name = String((value as { name?: unknown }).name ?? "");
  switch (name) {
    case "XYZ":
      return "xyz";
    case "Fit":
    case "FitB":
      return "fit";
    case "FitH":
    case "FitBH":
      return "fitH";
    case "FitV":
    case "FitBV":
      return "fitV";
    case "FitR":
      return "fitR";
    default:
      return "unknown";
  }
}

async function resolveDestinationTarget(
  document: RuntimePdfDocument,
  documentId: string,
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
  let pageIndex: number | null = null;
  if (typeof reference === "number") {
    pageIndex = reference;
  } else if (reference && typeof reference === "object") {
    pageIndex = await document.getPageIndex(reference);
  }

  if (pageIndex == null || !Number.isInteger(pageIndex) || pageIndex < 0) {
    return null;
  }

  const fit = destinationFit(target[1]);
  const destinationTarget: PdfNavigationTarget = {
    documentId,
    pageIndex,
    ...(fit ? { fit } : {})
  };

  if (fit === "xyz") {
    const x = numericDestinationValue(target[2]);
    const y = numericDestinationValue(target[3]);
    const zoom = numericDestinationValue(target[4]);
    if (x != null) destinationTarget.x = x;
    if (y != null) destinationTarget.y = y;
    if (zoom != null && zoom > 0) destinationTarget.zoom = zoom;
  } else if (fit === "fitH" || fit === "fitV") {
    const position = numericDestinationValue(target[2]);
    if (fit === "fitH" && position != null) destinationTarget.y = position;
    if (fit === "fitV" && position != null) destinationTarget.x = position;
  } else if (fit === "fitR") {
    const x = numericDestinationValue(target[2]);
    const y = numericDestinationValue(target[3]);
    if (x != null) destinationTarget.x = x;
    if (y != null) destinationTarget.y = y;
  }

  return destinationTarget;
}

async function extractOutline(
  document: RuntimePdfDocument,
  documentId: string,
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
      url?: string;
      unsafeUrl?: string;
      bold?: boolean;
      italic?: boolean;
      color?: [number, number, number];
      items?: unknown[];
    };
    const target = await resolveDestinationTarget(document, documentId, item.dest);
    const title = item.title?.trim() || "Untitled section";
    const sourceId = `${prefix}-${index}`;
    result.push({
      id: `embedded:${sourceId}`,
      title,
      source: "embedded",
      sourceId,
      target,
      page: target ? target.pageIndex + 1 : null,
      externalUrl: item.url ?? item.unsafeUrl ?? null,
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      color: item.color ?? null,
      items: await extractOutline(document, documentId, item.items ?? null, sourceId)
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

function isAbortLikeError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getViewportRawDims(viewport: RuntimeViewport) {
  return {
    pageWidth: viewport.rawDims?.pageWidth ?? viewport.width,
    pageHeight: viewport.rawDims?.pageHeight ?? viewport.height,
    pageX: viewport.rawDims?.pageX ?? 0,
    pageY: viewport.rawDims?.pageY ?? 0
  };
}

async function loadDocumentBytesForPdfJs(
  documentId: string,
  readBytes: typeof readDocumentBytes
) {
  const readStartedAt = performance.now();
  debugAction("pdf-runtime.bytes-read-start", {
    documentId
  });
  const loadedBytes = await readBytes(documentId);
  const bytesLoadedAt = performance.now();
  debugAction("pdf-runtime.bytes-loaded", {
    documentId,
    byteLength: loadedBytes.length,
    elapsedMs: Math.round(bytesLoadedAt - readStartedAt)
  });

  const convertStartedAt = performance.now();
  const documentBytes = new Uint8Array(loadedBytes);
  debugAction("pdf-runtime.bytes-converted", {
    documentId,
    byteLength: documentBytes.byteLength,
    elapsedMs: Math.round(performance.now() - convertStartedAt)
  });
  return documentBytes;
}

export function createPdfRuntimeSession(
  documentId: string,
  dependencies: RuntimeDependencies = {}
) {
  const readBytes = dependencies.readDocumentBytes ?? readDocumentBytes;
  const toAssetUrl = dependencies.convertFileSrc ?? convertFileSrc;
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
  const searchTextPromises = new Map<number, Promise<string>>();
  const searchTextCache = new Map<number, string>();

  function assertActive() {
    if (disposed) {
      throw createDisposedError();
    }
  }

  function normalizeLifecycleError(error: unknown) {
    return disposed ? createDisposedError() : error;
  }

  function shouldSuppressLifecycleError(error: unknown) {
    if (disposed || isAbortLikeError(error)) {
      return true;
    }

    return error instanceof Error && error.message === createDisposedError().message;
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
        const documentSource = dependencies.documentFilePath
          ? {
              transport: "asset-url" as const,
              url: toAssetUrl(dependencies.documentFilePath)
            }
          : {
              transport: "ipc-bytes" as const,
              data: await loadDocumentBytesForPdfJs(documentId, readBytes)
            };

        debugAction("pdf-runtime.document-load-start", {
          documentId,
          transport: documentSource.transport
        });
        const nextLoadingTask = getDocument({
          ...(documentSource.transport === "asset-url"
            ? { url: documentSource.url }
            : { data: documentSource.data }),
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
        const nextError = normalizeLifecycleError(error);
        if (!shouldSuppressLifecycleError(nextError)) {
          debugError("pdf-runtime.ensure-document-error", nextError, {
            documentId
          });
        }
        throw nextError;
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
        const outline = await extractOutline(document, documentId, await document.getOutline());
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
      const nextError = normalizeLifecycleError(error);
      if (!shouldSuppressLifecycleError(nextError)) {
        debugError("pdf-runtime.page-text-error", nextError, {
          documentId,
          pageNumber
        });
      }
      throw nextError;
    });

    pageTextPromises.set(pageNumber, nextTextPromise);
    return nextTextPromise;
  }

  async function getPageSearchText(pageNumber: number, signal?: AbortSignal) {
    assertActive();

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const cached = searchTextCache.get(pageNumber);
    if (cached !== undefined) {
      return cached;
    }

    const existing = searchTextPromises.get(pageNumber);
    if (existing) {
      const text = await existing;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return text;
    }

    const nextSearchTextPromise = (async () => {
      const existingPageText = pageTextCache.get(pageNumber);
      if (existingPageText) {
        const text = existingPageText.textContent.items
          .map((item) => (isTextItem(item) ? item.str : ""))
          .join(" ");
        searchTextCache.set(pageNumber, text);
        searchTextPromises.delete(pageNumber);
        return text;
      }

      const document = await ensureDocument();
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      assertActive();

      const text = textContent.items
        .map((item) => (isTextItem(item) ? item.str : ""))
        .join(" ");

      searchTextCache.set(pageNumber, text);
      searchTextPromises.delete(pageNumber);
      return text;
    })().catch((error) => {
      searchTextPromises.delete(pageNumber);
      throw error;
    });

    searchTextPromises.set(pageNumber, nextSearchTextPromise);
    const text = await nextSearchTextPromise;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return text;
  }

  async function getPagePlainText(pageNumber: number) {
    assertActive();
    const cached = plainTextCache.get(pageNumber);
    if (cached !== undefined) return cached;
    const existing = plainTextPromises.get(pageNumber);
    if (existing) return existing;
    const nextPlainTextPromise = getPageSearchText(pageNumber)
      .then((text) => {
        const normalized = text.toLocaleLowerCase();
        plainTextCache.set(pageNumber, normalized);
        plainTextPromises.delete(pageNumber);
        return normalized;
      })
      .catch((error) => {
        plainTextPromises.delete(pageNumber);
        throw error;
      });
    plainTextPromises.set(pageNumber, nextPlainTextPromise);
    return nextPlainTextPromise;
  }

  function getExtractedPageNumbers() {
    return new Set([
      ...pageTextCache.keys(),
      ...searchTextCache.keys(),
      ...plainTextCache.keys()
    ]);
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

    debugAction("pdf-runtime:dispose-start", {
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
    searchTextPromises.clear();
    searchTextCache.clear();

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

    debugAction("pdf-runtime:dispose-finished", {
      documentId
    });
  }

  return {
    load,
    getOutline,
    getPageText,
    getPageSearchText,
    getExtractedPageNumbers,
    getPagePlainText,
    search,
    dispose
  };
}

export type PdfRuntimeSession = ReturnType<typeof createPdfRuntimeSession>;
