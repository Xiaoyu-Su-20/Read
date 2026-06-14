import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { PaletteSession } from "../lib/app/palette";
import { filterPaletteItems } from "../lib/commands";
import type { PaletteGlyph, PaletteGroup, PaletteItem } from "../lib/types";

const PALETTE_GROUP_ORDER: PaletteGroup[] = [
  "navigation",
  "bookmarks",
  "library",
  "view"
];
const PALETTE_OPEN_SHORTCUT = "Tab";

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function fallbackGlyphForSession(kind: PaletteSession["kind"]): PaletteGlyph {
  if (kind === "select") {
    return "folder";
  }

  return "spark";
}

function glyphForItem(item: PaletteItem, kind: PaletteSession["kind"]): PaletteGlyph {
  return item.glyph ?? fallbackGlyphForSession(kind);
}

function PaletteItemGlyph({ glyph }: { glyph: PaletteGlyph }) {
  switch (glyph) {
    case "bookmark":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 7.45C10.35 5.9 8.42 5.23 6.1 5.23H4.45A1.16 1.16 0 0 0 3.29 6.39v10.26a1.16 1.16 0 0 0 1.16 1.16H6.1c2.32 0 4.25.68 5.9 2.23" />
          <path d="M12 7.45c1.65-1.55 3.58-2.22 5.9-2.22h1.65a1.16 1.16 0 0 1 1.16 1.16v10.26a1.16 1.16 0 0 1-1.16 1.16H17.9c-2.32 0-4.25.68-5.9 2.23" />
          <path d="M12 7.45v12.58" />
        </svg>
      );
    case "file-plus":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M14 4H7.5A1.5 1.5 0 0 0 6 5.5v13A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V8Z" />
          <path d="M14 4v4h4" />
          <path d="M12 11v5" />
          <path d="M9.5 13.5h5" />
        </svg>
      );
    case "folder":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
        </svg>
      );
    case "folder-open":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3.75 8.25A2.25 2.25 0 0 1 6 6h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 10.7v.3" />
          <path d="M5 19h11.2a2 2 0 0 0 1.92-1.45l1.55-5.3A1.8 1.8 0 0 0 17.95 10H6.2a2 2 0 0 0-1.92 1.45L2.73 16.75A1.8 1.8 0 0 0 4.45 19Z" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
          <path d="M4 5.5v4h4" />
        </svg>
      );
    case "move":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4.5 12h11" />
          <path d="m12.5 8.5 3.5 3.5-3.5 3.5" />
          <path d="M17 5.5h1.5A1.5 1.5 0 0 1 20 7v10a1.5 1.5 0 0 1-1.5 1.5H17" />
        </svg>
      );
    case "page":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M7.5 4.75h7.25L18.25 8v10.25A1.75 1.75 0 0 1 16.5 20h-9A1.75 1.75 0 0 1 5.75 18.25V6.5A1.75 1.75 0 0 1 7.5 4.75Z" />
          <path d="M14.75 4.75V8h3.5" />
        </svg>
      );
    case "panel":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4.5" y="5" width="15" height="14" rx="1.5" />
          <path d="M11.5 5v14" />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 11a8 8 0 0 0-14.4-4.8" />
          <path d="M4 5v4h4" />
          <path d="M4 13a8 8 0 0 0 14.4 4.8" />
          <path d="M20 19v-4h-4" />
        </svg>
      );
    case "search":
      return <SearchGlyph />;
    case "trash":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 7h12" />
          <path d="M9 7V5.5h6V7" />
          <path d="M8.2 7l.6 11h6.4l.6-11" />
        </svg>
      );
    case "spark":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m12 4 1.65 4.35L18 10l-4.35 1.65L12 16l-1.65-4.35L6 10l4.35-1.65Z" />
        </svg>
      );
  }
}

function metaTokens(meta: string) {
  return meta.split(/\s+/).filter(Boolean);
}

type GroupedPaletteSection = {
  group: PaletteGroup | "ungrouped";
  items: Array<{
    item: PaletteItem;
    index: number;
  }>;
};

function groupPaletteItems(session: PaletteSession, items: PaletteItem[]): GroupedPaletteSection[] {
  if (session.kind !== "commands") {
    return [
      {
        group: "ungrouped",
        items: items.map((item, index) => ({ item, index }))
      }
    ];
  }

  let nextIndex = 0;
  const visibleSections: GroupedPaletteSection[] = PALETTE_GROUP_ORDER.flatMap((group) => {
    const sectionItems = items
      .filter((item) => item.group === group)
      .map((item) => ({ item, index: nextIndex++ }));

    return sectionItems.length > 0 ? [{ group, items: sectionItems }] : [];
  });

  const ungroupedItems = items
    .filter((item) => !item.group)
    .map((item) => ({ item, index: nextIndex++ }));

  if (ungroupedItems.length > 0) {
    visibleSections.push({
      group: "ungrouped",
      items: ungroupedItems
    });
  }

  return visibleSections;
}

type CommandPaletteProps = {
  session: PaletteSession | null;
  open: boolean;
  onClose: () => void;
  onChangeQuery: (query: string) => void;
};

export default function CommandPalette({
  session,
  open,
  onClose,
  onChangeQuery
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLUListElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const scrollbarMetricsRef = useRef({
    thumbHeight: 0,
    maxScroll: 0,
    maxThumbTop: 0
  });
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const deferredQuery = useDeferredValue(session?.query ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollbarState, setScrollbarState] = useState({
    thumbHeight: 0,
    thumbTop: 0,
    visible: false
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, session?.kind]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, session?.kind, session?.query]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  function scheduleScrollbarHide() {
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      setScrollbarState((current) => ({ ...current, visible: false }));
      scrollTimerRef.current = null;
    }, 700);
  }

  function updateResultsScrollbar(options?: { visible?: boolean }) {
    const resultsElement = resultsRef.current;
    const scrollbarElement = scrollbarRef.current;
    if (!resultsElement || !scrollbarElement) {
      return;
    }

    const trackHeight = Math.max(scrollbarElement.clientHeight, 0);
    const maxScroll = Math.max(resultsElement.scrollHeight - resultsElement.clientHeight, 0);

    if (trackHeight <= 0 || maxScroll <= 0) {
      scrollbarMetricsRef.current = {
        thumbHeight: 0,
        maxScroll: 0,
        maxThumbTop: 0
      };
      setScrollbarState({
        thumbHeight: 0,
        thumbTop: 0,
        visible: false
      });
      return;
    }

    const thumbHeight = Math.max(32, trackHeight * (resultsElement.clientHeight / resultsElement.scrollHeight));
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop = maxScroll === 0 ? 0 : (resultsElement.scrollTop / maxScroll) * maxThumbTop;

    scrollbarMetricsRef.current = {
      thumbHeight,
      maxScroll,
      maxThumbTop
    };
    setScrollbarState((current) => ({
      thumbHeight,
      thumbTop,
      visible: options?.visible ?? current.visible
    }));
  }

  function scrollResultsToThumbTop(nextThumbTop: number) {
    const resultsElement = resultsRef.current;
    const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
    if (!resultsElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    resultsElement.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
  }

  const immediateFilteredItems = useMemo(() => {
    if (!session || session.kind === "input") {
      return [];
    }
    return filterPaletteItems(session.items, session.query);
  }, [session]);

  const filteredItems = useMemo(() => {
    if (!session || session.kind === "input") {
      return [];
    }
    return filterPaletteItems(session.items, deferredQuery);
  }, [deferredQuery, session]);

  useEffect(() => {
    if (!open || !session || session.kind === "input") {
      setScrollbarState({
        thumbHeight: 0,
        thumbTop: 0,
        visible: false
      });
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      updateResultsScrollbar();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [filteredItems.length, open, session?.kind]);

  useEffect(() => {
    const resultsElement = resultsRef.current;
    if (!resultsElement) {
      return;
    }

    const handleResize = () => {
      updateResultsScrollbar();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateResultsScrollbar();
          });

    resizeObserver?.observe(resultsElement);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [open, session?.kind]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      const resultsElement = resultsRef.current;
      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (!activeDrag || !resultsElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      resultsElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
      updateResultsScrollbar({ visible: true });
      scheduleScrollbarHide();
    }

    function handlePointerUp(event: PointerEvent) {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }

      scrollbarDragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  if (!open || !session) {
    return null;
  }

  const displayedActiveIndex =
    filteredItems.length === 0 ? -1 : Math.min(activeIndex, filteredItems.length - 1);
  const groupedItems = session ? groupPaletteItems(session, filteredItems) : [];

  const handleEnter = async () => {
    if (session.kind === "input") {
      await session.onSubmit(session.query);
      onClose();
      return;
    }

    const selectedItem =
      immediateFilteredItems[Math.min(activeIndex, Math.max(immediateFilteredItems.length - 1, 0))];
    if (selectedItem) {
      await selectedItem.onSelect();
      if (session.kind === "select") {
        onClose();
      }
    }
  };

  return (
    <div className="overlay-shell overlay-shell--palette" role="presentation" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={session.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette__search">
          <input
            ref={inputRef}
            className="palette__input"
            value={session.query}
            placeholder={
              session.kind === "input" ? session.placeholder : "Type to filter actions"
            }
            onChange={(event) => onChangeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (session.kind !== "input" && event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.min(index + 1, Math.max(immediateFilteredItems.length - 1, 0))
                );
              }
              if (session.kind !== "input" && event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                void handleEnter();
              }
            }}
          />
          {session.kind === "commands" ? (
            <span className="palette__search-meta" aria-label={`Open command palette: ${PALETTE_OPEN_SHORTCUT}`}>
              {metaTokens(PALETTE_OPEN_SHORTCUT).map((token) => (
                <span key={`palette-open-${token}`} className="palette__keycap palette__keycap--search">
                  {token}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {session.kind === "input" ? (
          <div className="palette__empty">
            <p>
              {session.emptyMessage ??
                `Press Enter to ${session.confirmLabel.toLowerCase()}.`}
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="palette__empty">
            <p>{session.emptyMessage}</p>
          </div>
        ) : (
          <div className="palette__results-shell">
            <ul
              ref={resultsRef}
              className="palette__results"
              role="listbox"
              aria-label={session.title}
              onScroll={() => {
                updateResultsScrollbar({ visible: true });
                scheduleScrollbarHide();
              }}
            >
              {groupedItems.flatMap((section, sectionIndex) => {
                const sectionNodes = section.items.map(({ item, index }) => (
                  <li key={item.id}>
                    <button
                      className={
                        index === displayedActiveIndex
                          ? "palette__item palette__item--active"
                          : "palette__item"
                      }
                      type="button"
                      role="option"
                      aria-selected={index === displayedActiveIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        void item.onSelect();
                        if (session.kind === "select") {
                          onClose();
                        }
                      }}
                    >
                      <span className="palette__item-icon">
                        <PaletteItemGlyph glyph={glyphForItem(item, session.kind)} />
                      </span>
                      <span className="palette__label">
                        <strong>{item.title}</strong>
                      </span>
                      {item.meta ? (
                        <span className="palette__item-meta" aria-label={item.meta}>
                          {metaTokens(item.meta).map((token) => (
                            <span key={`${item.id}-${token}`} className="palette__keycap">
                              {token}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="palette__item-meta" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ));

                if (sectionIndex === groupedItems.length - 1) {
                  return sectionNodes;
                }

                return [
                  ...sectionNodes,
                  <li key={`divider-${section.group}-${sectionIndex}`} className="palette__divider" role="presentation" aria-hidden="true" />
                ];
              })}
            </ul>
            <div
              ref={scrollbarRef}
              className={scrollbarState.visible ? "palette__scrollbar palette__scrollbar--visible" : "palette__scrollbar"}
              aria-hidden="true"
              onPointerDown={(event) => {
                const scrollbarElement = scrollbarRef.current;
                if (!scrollbarElement || event.target !== event.currentTarget) {
                  return;
                }

                event.preventDefault();
                const trackRect = scrollbarElement.getBoundingClientRect();
                scrollResultsToThumbTop(event.clientY - trackRect.top - scrollbarState.thumbHeight / 2);
                updateResultsScrollbar({ visible: true });
                scheduleScrollbarHide();
              }}
            >
              <div
                className="palette__scrollbar-thumb"
                style={{
                  height: `${scrollbarState.thumbHeight}px`,
                  transform: `translateY(${scrollbarState.thumbTop}px)`
                }}
                onPointerDown={(event) => {
                  const resultsElement = resultsRef.current;
                  if (!resultsElement) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  scrollbarDragRef.current = {
                    pointerId: event.pointerId,
                    startClientY: event.clientY,
                    startScrollTop: resultsElement.scrollTop
                  };
                  updateResultsScrollbar({ visible: true });
                  scheduleScrollbarHide();
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
