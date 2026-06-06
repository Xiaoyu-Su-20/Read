import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import { readDocumentBytes, renderPdfPage } from "../lib/api";
import { debugAction, startDebugProcess } from "../lib/debugLog";
import {
  createRenderedPageCache,
  makeRenderCacheKey,
  shouldIgnoreRenderResponse
} from "../lib/pdfRender";

import type {
  DocumentState,
  OutlineItem,
  RenderedPagePayload,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";

type PdfViewerProps = {
  documentId: string | null;
  initialState: DocumentState | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  registerApi: (api: ViewerApi | null) => void;
};

type LoadedPdfTextDocument = Awaited<ReturnType<typeof loadPdfTextDocument>>;

type VisibleRenderedPage = RenderedPagePayload & {
  imageUrl: string;
  requestKey: string;
};

const RENDER_CACHE_SIZE = 20;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).toString();

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

async function loadPdfTextDocument(data: Uint8Array) {
  return pdfjsLib.getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    iccUrl,
    standardFontDataUrl,
    wasmUrl,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: false,
    useSystemFonts: true
  }).promise;
}

async function resolveDestinationPage(
  document: LoadedPdfTextDocument,
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
    const index = await document.getPageIndex(
      reference as Parameters<LoadedPdfTextDocument["getPageIndex"]>[0]
    );
    return index + 1;
  }

  return null;
}

async function extractOutline(
  document: LoadedPdfTextDocument,
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

function toVisibleRenderedPage(
  payload: RenderedPagePayload,
  requestKey: string
): VisibleRenderedPage {
  return {
    ...payload,
    imageUrl: convertFileSrc(payload.imagePath),
    requestKey
  };
}

export default function PdfViewer({
  documentId,
  initialState,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  registerApi
}: PdfViewerProps) {
  const [textDocument, setTextDocument] = useState<LoadedPdfTextDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [visiblePage, setVisiblePage] = useState<VisibleRenderedPage | null>(null);
  const [pageInitialized, setPageInitialized] = useState(false);

  const pageTextCache = useRef(new Map<number, string>());
  const renderedPageCache = useRef(createRenderedPageCache(RENDER_CACHE_SIZE));
  const lastWheelActionAt = useRef(0);
  const renderSequenceRef = useRef(0);
  const initializedDocumentIdRef = useRef<string | null>(null);
  const initialPageRef = useRef(1);

  useEffect(() => {
    if (documentId === initializedDocumentIdRef.current) {
      return;
    }

    initializedDocumentIdRef.current = documentId;
    initialPageRef.current = Math.max(initialState?.lastPage ?? 1, 1);
    setCurrentPage(initialPageRef.current);
    setTextDocument(null);
    setPageCount(0);
    setDocumentError(null);
    setRenderError(null);
    setIsRendering(false);
    setVisiblePage(null);
    setPageInitialized(false);
    pageTextCache.current.clear();
    renderedPageCache.current.clear();
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!documentId) {
        setTextDocument(null);
        setPageCount(0);
        setDocumentError(null);
        pageTextCache.current.clear();
        renderedPageCache.current.clear();
        onOutlineChange([]);
        registerApi(null);
        return;
      }

      setLoadingDocument(true);
      setDocumentError(null);
      const process = startDebugProcess("viewer.load-document", {
        documentId
      });

      try {
        const loadedBytes = await readDocumentBytes(documentId);
        process.checkpoint("bytes-loaded", {
          byteCount: loadedBytes.length
        });
        const loadedDocument = await loadPdfTextDocument(Uint8Array.from(loadedBytes));
        if (cancelled) {
          return;
        }
        process.checkpoint("pdfjs-loaded", {
          pageCount: loadedDocument.numPages
        });

        const nextPage = Math.min(
          Math.max(initialPageRef.current, 1),
          loadedDocument.numPages
        );
        const nextOutline = await extractOutline(
          loadedDocument,
          await loadedDocument.getOutline()
        );
        if (cancelled) {
          return;
        }

        pageTextCache.current.clear();
        setTextDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setCurrentPage(nextPage);
        setPageInitialized(true);
        onOutlineChange(nextOutline);
        onStatusChange(`Opened ${loadedDocument.numPages} pages.`);
        process.finish({
          pageCount: loadedDocument.numPages,
          initialPage: nextPage,
          outlineCount: nextOutline.length
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        const message =
          loadError instanceof Error ? loadError.message : "Unable to load PDF.";
        setDocumentError(message);
        setPageInitialized(false);
        onStatusChange("Unable to load the selected PDF.");
        process.fail(loadError);
      } finally {
        if (!cancelled) {
          setLoadingDocument(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [documentId, onOutlineChange, onStatusChange, registerApi]);

  useEffect(() => {
    if (!documentId) {
      renderSequenceRef.current += 1;
      setVisiblePage(null);
      setIsRendering(false);
      setRenderError(null);
      return;
    }

    if (!pageInitialized) {
      return;
    }

    const requestKey = makeRenderCacheKey(documentId, currentPage);
    const cachedPage = renderedPageCache.current.get(requestKey);
    const requestSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = requestSequence;

    debugAction("viewer.navigate", {
      documentId,
        currentPage,
        requestSequence,
        pageInitialized,
        cached: Boolean(cachedPage)
      });

    if (cachedPage) {
      setVisiblePage(toVisibleRenderedPage(cachedPage, requestKey));
      setRenderError(null);
      setIsRendering(false);
      return;
    }

    setIsRendering(true);
    setRenderError(null);

    const process = startDebugProcess("viewer.render-page", {
      documentId,
      page: currentPage,
      requestSequence,
      pageInitialized,
      cached: false
    });
    void renderPdfPage(documentId, currentPage)
      .then((payload) => {
        if (shouldIgnoreRenderResponse(requestSequence, renderSequenceRef.current)) {
          process.checkpoint("stale-response", {
            page: payload.pageNumber,
            activeSequence: renderSequenceRef.current
          });
          return;
        }

        renderedPageCache.current.set(requestKey, payload);
        setVisiblePage(toVisibleRenderedPage(payload, requestKey));
        setRenderError(null);
        setIsRendering(false);
        process.finish({
          page: payload.pageNumber,
          backendCacheKey: payload.cacheKey
        });
      })
      .catch((renderFailure) => {
        if (shouldIgnoreRenderResponse(requestSequence, renderSequenceRef.current)) {
          return;
        }

        process.fail(renderFailure);
        setRenderError("Unable to render this PDF page.");
        setIsRendering(false);
        onStatusChange("Unable to render this PDF page.");
      });
  }, [currentPage, documentId, onStatusChange, pageInitialized]);

  useEffect(() => {
    if (!textDocument || !pageInitialized) {
      return;
    }

    onSnapshotChange({
      currentPage,
      pageCount,
      zoom: 1
    });
  }, [currentPage, onSnapshotChange, pageCount, pageInitialized, textDocument]);

  useEffect(() => {
    if (!textDocument) {
      registerApi(null);
      return;
    }

    const api: ViewerApi = {
      nextPage: () => setCurrentPage((page) => Math.min(page + 1, textDocument.numPages)),
      previousPage: () => setCurrentPage((page) => Math.max(page - 1, 1)),
      goToPage: (page) =>
        setCurrentPage(Math.min(Math.max(Math.round(page), 1), textDocument.numPages)),
      search: async (query) => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
          onStatusChange("Enter a phrase to search.");
          return 0;
        }

        for (let pageNumber = 1; pageNumber <= textDocument.numPages; pageNumber += 1) {
          let pageText = pageTextCache.current.get(pageNumber);
          if (!pageText) {
            const page = await textDocument.getPage(pageNumber);
            const content = await page.getTextContent();
            pageText = content.items
              .map((item) =>
                "str" in item && typeof item.str === "string" ? item.str : ""
              )
              .join(" ")
              .toLowerCase();
            pageTextCache.current.set(pageNumber, pageText);
          }

          if (pageText.includes(normalizedQuery)) {
            setCurrentPage(pageNumber);
            onStatusChange(`Found "${query}" on page ${pageNumber}.`);
            return pageNumber;
          }
        }

        onStatusChange(`No matches found for "${query}".`);
        return 0;
      },
      jumpToOutline: (item) => {
        if (item.page) {
          setCurrentPage(item.page);
        }
      },
      getCurrentPage: () => currentPage,
      getPageCount: () => pageCount
    };

    registerApi(api);
    return () => registerApi(null);
  }, [currentPage, onStatusChange, pageCount, registerApi, textDocument]);

  if (!documentId) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <span className="eyebrow">Reader</span>
          <h2>Your desk is clear.</h2>
          <p>Press Tab to open commands, import a PDF, and start reading.</p>
        </div>
      </div>
    );
  }

  if (documentError) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <p>{documentError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="reader-stage"
      onWheel={(event) => {
        event.preventDefault();
        const now = Date.now();
        if (now - lastWheelActionAt.current < 180) {
          return;
        }

        const primaryDelta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

        if (primaryDelta < 0) {
          debugAction("viewer.navigate-wheel", {
            direction: "previous",
            currentPage
          });
          setCurrentPage((page) => Math.max(page - 1, 1));
        } else if (primaryDelta > 0) {
          debugAction("viewer.navigate-wheel", {
            direction: "next",
            currentPage
          });
          setCurrentPage((page) => Math.min(page + 1, pageCount || page));
        }

        lastWheelActionAt.current = now;
      }}
    >
      <div className="reader-page">
        {visiblePage ? (
          <img
            key={visiblePage.requestKey}
            className="reader-page__image"
            src={visiblePage.imageUrl}
            alt={`Page ${visiblePage.pageNumber}`}
            draggable={false}
          />
        ) : null}

        {isRendering ? (
          <div className="reader-page__status" role="status" aria-live="polite">
            Rendering...
          </div>
        ) : null}

        {loadingDocument && !visiblePage ? (
          <div className="reader-page__status" role="status" aria-live="polite">
            Loading document...
          </div>
        ) : null}

        {renderError ? (
          <div className="reader-page__status reader-page__status--error" role="status">
            {renderError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
