import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import type { DocumentRecord } from "../lib/types";
import { analyzeQuery } from "../search/planning/queryAnalysis";
import type {
  DocumentNameSearchResult,
  SearchHighlightRange
} from "../search/model/SearchResult";
import { searchDocumentNameMatches } from "../search/sources/documentNameMatches";

const POPOVER_WIDTH_PX = 392;
const POPOVER_MIN_LEFT_PX = 8;
const POPOVER_VIEWPORT_GAP_PX = 8;
const POPOVER_ANCHOR_GAP_PX = 12;
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type SidebarDocumentSearchPopoverProps = {
  open: boolean;
  anchorElement: HTMLButtonElement | null;
  documents: readonly DocumentRecord[];
  onClose: () => void;
  onOpenDocument: (documentId: string) => Promise<void>;
};

type SidebarDocumentSearchResult = DocumentNameSearchResult & {
  fileName: string;
};

function FileGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M7.5 4.75h7.25L18.25 8v10.25A1.75 1.75 0 0 1 16.5 20h-9A1.75 1.75 0 0 1 5.75 18.25V6.5A1.75 1.75 0 0 1 7.5 4.75Z" />
      <path d="M14.75 4.75V8h3.5" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function HighlightedText({
  text,
  ranges
}: {
  text: string;
  ranges: SearchHighlightRange[];
}) {
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <mark key={`${range.start}-${range.end}`}>
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}

export default function SidebarDocumentSearchPopover({
  open,
  anchorElement,
  documents,
  onClose,
  onOpenDocument
}: SidebarDocumentSearchPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [popoverStyle, setPopoverStyle] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const normalizedQuery = useMemo(
    () => analyzeQuery(query).normalizedQuery,
    [query]
  );
  const deferredNormalizedQuery = useDeferredValue(normalizedQuery);
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );
  const filteredResults = useMemo(
    () =>
      searchDocumentNameMatches(documents, deferredNormalizedQuery, 50).map((result) => ({
        ...result,
        fileName: documentsById.get(result.documentId)?.fileName ?? result.title
      })),
    [deferredNormalizedQuery, documents, documentsById]
  );

  const visibleResults = useMemo(() => {
    if (deferredNormalizedQuery) {
      return filteredResults;
    }

    return documents.slice(0, 50).map((document) => ({
      id: `document:${document.id}`,
      kind: "document" as const,
      sourceId: "document-name" as const,
      title: document.title,
      documentId: document.id,
      available: document.availability === "available",
      snippet: document.fileName,
      highlights: [],
      fileName: document.fileName
    })) satisfies SidebarDocumentSearchResult[];
  }, [deferredNormalizedQuery, documents, filteredResults]);

  useClientLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return;
    }

    function updatePopoverPosition() {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const nextWidth = Math.min(
        POPOVER_WIDTH_PX,
        viewportWidth - (POPOVER_VIEWPORT_GAP_PX * 2)
      );

      if (!anchorElement) {
        setPopoverStyle({
          left: Math.max(
            POPOVER_MIN_LEFT_PX,
            viewportWidth - nextWidth - POPOVER_VIEWPORT_GAP_PX
          ),
          top: POPOVER_VIEWPORT_GAP_PX
        });
        return;
      }

      const rect = anchorElement.getBoundingClientRect();
      const nextLeft = Math.max(
        POPOVER_MIN_LEFT_PX,
        Math.min(
          rect.right + POPOVER_ANCHOR_GAP_PX,
          viewportWidth - nextWidth - POPOVER_VIEWPORT_GAP_PX
        )
      );
      const nextTop = Math.max(
        POPOVER_VIEWPORT_GAP_PX,
        Math.min(
          rect.top - 8,
          viewportHeight - 520
        )
      );

      setPopoverStyle({
        left: nextLeft,
        top: nextTop
      });
    }

    updatePopoverPosition();

    const resizeObserver =
      typeof ResizeObserver === "undefined" || !anchorElement
        ? null
        : new ResizeObserver(() => {
            updatePopoverPosition();
          });

    if (resizeObserver && anchorElement) {
      resizeObserver.observe(anchorElement);
    }

    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [anchorElement, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef.current?.contains(target) || anchorElement?.contains(target)) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchorElement, onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredNormalizedQuery]);

  useEffect(() => {
    if (!open || visibleResults.length === 0) {
      return;
    }

    resultsRef.current
      ?.querySelector<HTMLElement>(
        `[data-sidebar-search-result-index="${activeIndex}"]`
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, visibleResults.length]);

  async function activateResult(result: SidebarDocumentSearchResult) {
    if (!result.available) {
      return;
    }

    onClose();
    await onOpenDocument(result.documentId);
  }

  if (!open) {
    return null;
  }

  const clampedActiveIndex =
    visibleResults.length === 0
      ? -1
      : Math.min(activeIndex, visibleResults.length - 1);

  return (
    <div
      ref={popoverRef}
      className="palette palette--workspace sidebar-document-search"
      data-positioned={popoverStyle !== null}
      style={popoverStyle ?? undefined}
      role="dialog"
      aria-label="Search PDFs"
    >
      <div className="palette__search sidebar-document-search__search">
        <span className="palette__search-icon" aria-hidden="true">
          <SearchGlyph />
        </span>
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Search PDFs"
          aria-label="Search PDFs"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (visibleResults.length === 0) {
                return;
              }
              setActiveIndex((current) =>
                current >= visibleResults.length - 1 ? 0 : current + 1
              );
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (visibleResults.length === 0) {
                return;
              }
              setActiveIndex((current) =>
                current <= 0 ? visibleResults.length - 1 : current - 1
              );
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const result =
                clampedActiveIndex >= 0 ? visibleResults[clampedActiveIndex] : null;
              if (result) {
                void activateResult(result);
              }
            }
          }}
        />
        <span className="palette__search-meta" aria-hidden="true">
          <span className="palette__keycap palette__keycap--search">ESC</span>
        </span>
      </div>

      <div className="palette__results-shell sidebar-document-search__results-shell">
        <div
          ref={resultsRef}
          className="palette__results sidebar-document-search__results"
          role="listbox"
          aria-label="PDF search results"
        >
          {visibleResults.length === 0 ? (
            <div className="palette__empty sidebar-document-search__empty">
              <p>No PDFs match that name.</p>
            </div>
          ) : (
            visibleResults.map((result, index) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected={index === clampedActiveIndex}
                data-sidebar-search-result-index={index}
                className={`palette__item sidebar-document-search__item${
                  index === clampedActiveIndex ? " palette__item--active" : ""
                }`}
                disabled={!result.available}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
                onClick={() => {
                  void activateResult(result);
                }}
              >
                <span className="palette__item-icon sidebar-document-search__item-icon">
                  <FileGlyph />
                </span>
                <span className="palette__label sidebar-document-search__label">
                  <strong className="sidebar-document-search__title">
                    {deferredNormalizedQuery ? (
                      <HighlightedText text={result.snippet} ranges={result.highlights} />
                    ) : (
                      result.title
                    )}
                  </strong>
                  {!deferredNormalizedQuery && result.fileName !== result.title ? (
                    <span className="sidebar-document-search__meta">
                      {result.snippet}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
