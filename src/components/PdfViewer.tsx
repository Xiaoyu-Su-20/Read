import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import type {
  DocumentState,
  OutlineItem,
  ViewerApi,
  ViewerSnapshot
} from "../lib/types";

type PdfViewerProps = {
  filePath: string | null;
  initialState: DocumentState | null;
  onSnapshotChange: (snapshot: ViewerSnapshot) => void;
  onOutlineChange: (items: OutlineItem[]) => void;
  onStatusChange: (message: string) => void;
  registerApi: (api: ViewerApi | null) => void;
};

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

type LoadedPdfDocument = Awaited<ReturnType<typeof loadPdfDocument>>;

async function loadPdfDocument(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to read PDF bytes (${response.status}).`);
  }
  const data = new Uint8Array(await response.arrayBuffer());

  return pdfjsLib.getDocument({
    data,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    isImageDecoderSupported: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: true
  }).promise;
}

async function resolveDestinationPage(
  document: LoadedPdfDocument,
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
      reference as Parameters<LoadedPdfDocument["getPageIndex"]>[0]
    );
    return index + 1;
  }

  return null;
}

async function extractOutline(
  document: LoadedPdfDocument,
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

export default function PdfViewer({
  filePath,
  initialState,
  onSnapshotChange,
  onOutlineChange,
  onStatusChange,
  registerApi
}: PdfViewerProps) {
  const [document, setDocument] = useState<LoadedPdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageTextCache = useRef(new Map<number, string>());
  const lastWheelActionAt = useRef(0);

  const applyZoomDelta = (direction: number) => {
    setZoom((value) => {
      const next = direction < 0 ? value + 0.1 : value - 0.1;
      return Math.min(3, Math.max(0.5, Number(next.toFixed(2))));
    });
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!filePath) {
        setDocument(null);
        setPageCount(0);
        pageTextCache.current.clear();
        registerApi(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const loadedDocument = await loadPdfDocument(convertFileSrc(filePath));
        if (cancelled) {
          return;
        }

        const nextPage = Math.min(
          Math.max(initialState?.lastPage ?? 1, 1),
          loadedDocument.numPages
        );
        const nextZoom = initialState?.zoom ?? 1;
        const nextOutline = await extractOutline(
          loadedDocument,
          await loadedDocument.getOutline()
        );

        pageTextCache.current.clear();
        setDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setCurrentPage(nextPage);
        setZoom(nextZoom);
        onOutlineChange(nextOutline);
        onStatusChange(`Opened ${loadedDocument.numPages} pages.`);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load PDF.");
        onStatusChange("Unable to load the selected PDF.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [filePath, onOutlineChange, onStatusChange]);

  useEffect(() => {
    let cancelled = false;

    async function renderCurrentPage() {
      if (!document || !canvasRef.current || !textLayerRef.current) {
        return;
      }

      try {
        const page = await document.getPage(currentPage);
        if (cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          return;
        }

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        await page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
        }).promise;

        const textLayer = textLayerRef.current;
        textLayer.replaceChildren();
        textLayer.className = "reader-page__text-layer textLayer";
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        if (cancelled) {
          return;
        }

        const renderTask = new pdfjsLib.TextLayer({
          container: textLayer,
          textContentSource: page.streamTextContent(),
          viewport
        });
        await renderTask.render();
      } catch (renderError) {
        if (cancelled) {
          return;
        }
        const message =
          renderError instanceof Error
            ? renderError.message
            : "Unable to render this PDF page.";
        setError(message);
        onStatusChange(message);
      }
    }

    void renderCurrentPage();

    return () => {
      cancelled = true;
    };
  }, [currentPage, document, zoom]);

  useEffect(() => {
    if (!document) {
      return;
    }
    onSnapshotChange({
      currentPage,
      pageCount,
      zoom
    });
  }, [currentPage, document, onSnapshotChange, pageCount, zoom]);

  useEffect(() => {
    if (!document) {
      registerApi(null);
      return;
    }

    const api: ViewerApi = {
      nextPage: () => setCurrentPage((page) => Math.min(page + 1, document.numPages)),
      previousPage: () => setCurrentPage((page) => Math.max(page - 1, 1)),
      zoomIn: () => setZoom((value) => Math.min(3, Number((value + 0.1).toFixed(2)))),
      zoomOut: () => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2)))),
      resetZoom: () => setZoom(1),
      goToPage: (page) =>
        setCurrentPage(Math.min(Math.max(Math.round(page), 1), document.numPages)),
      search: async (query) => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
          onStatusChange("Enter a phrase to search.");
          return 0;
        }

        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          let pageText = pageTextCache.current.get(pageNumber);
          if (!pageText) {
            const page = await document.getPage(pageNumber);
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
  }, [currentPage, document, onStatusChange, pageCount]);

  if (!filePath) {
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

  if (loading) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <p>Loading document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reader-empty">
        <div className="empty-state">
          <p>{error}</p>
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

        if (event.ctrlKey || event.metaKey) {
          applyZoomDelta(event.deltaY);
          lastWheelActionAt.current = now;
          return;
        }

        const primaryDelta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

        if (primaryDelta < 0) {
          setCurrentPage((page) => Math.max(page - 1, 1));
        } else if (primaryDelta > 0) {
          setCurrentPage((page) => Math.min(page + 1, pageCount || page));
        }

        lastWheelActionAt.current = now;
      }}
    >
      <div className="reader-page">
        <canvas ref={canvasRef} className="reader-page__canvas" />
        <div ref={textLayerRef} className="reader-page__text-layer" />
      </div>
    </div>
  );
}
