import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { UnifiedSearchController } from "../controller/UnifiedSearchController";
import type { SearchHighlightRange, SearchResult } from "../model/SearchResult";

type WorkspaceSearchFieldProps = {
  controller: UnifiedSearchController;
  focusRequest: number;
  onOpenDocument: (documentId: string) => Promise<void>;
  onGoToPage: (pageNumber: number) => void;
  onRevealNoteBlock: (blockId: string) => void;
};

const INITIAL_LIMITS = {
  notes: 3,
  "nearby-page": 3,
  "across-document": 3,
  "pdf-names": 5
} as const;

function GroupIcon({ groupId }: { groupId: keyof typeof INITIAL_LIMITS }) {
  if (groupId === "notes") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true">
        <rect x="6" y="4.8" width="12" height="14.4" rx="2" />
        <path d="M9 9.2h6" />
        <path d="M9 13h4.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true">
      <path d="M7 4.8h6.5L18 9.1v10a1.4 1.4 0 0 1-1.4 1.4H7.4A1.4 1.4 0 0 1 6 19.1V6.2A1.4 1.4 0 0 1 7.4 4.8Z" />
      <path d="M13.5 4.9V9H18" />
      {groupId !== "pdf-names" ? (
        <>
          <path d="M9 13.1h6" />
          <path d="M9 16.5h4.2" />
        </>
      ) : null}
    </svg>
  );
}

function HighlightedSnippet({ text, ranges }: { text: string; ranges: SearchHighlightRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={`${range.start}-${range.end}`}>{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function resultMeta(result: SearchResult) {
  if (result.kind === "pdf") return `p. ${result.pageNumber}`;
  if (result.kind === "document") return result.available ? "Document" : "Missing";
  return null;
}

function renderGroupLabel(label: string) {
  const normalizedLabel = label.replace("Â·", "·");
  const parts = normalizedLabel.split("·").map((part) => part.trim());

  if (parts.length !== 2) {
    return <strong>{normalizedLabel}</strong>;
  }

  return (
    <strong className="search-group__title">
      <span>{parts[0]}</span>
      <span className="search-group__separator" aria-hidden="true">·</span>
      <span>{parts[1]}</span>
    </strong>
  );
}

export default function WorkspaceSearchField({
  controller,
  focusRequest,
  onOpenDocument,
  onGoToPage,
  onRevealNoteBlock
}: WorkspaceSearchFieldProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
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
  const [focusPulse, setFocusPulse] = useState(false);
  const [scrollbarState, setScrollbarState] = useState({
    thumbHeight: 0,
    thumbTop: 0,
    visible: false
  });
  const view = state.committedView;

  function updateScrollbar() {
    const bodyElement = bodyRef.current;
    const scrollbarElement = scrollbarRef.current;
    if (!bodyElement || !scrollbarElement) {
      return;
    }

    const trackHeight = Math.max(scrollbarElement.clientHeight, 0);
    const maxScroll = Math.max(bodyElement.scrollHeight - bodyElement.clientHeight, 0);

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

    const thumbHeight = Math.max(
      32,
      trackHeight * (bodyElement.clientHeight / bodyElement.scrollHeight)
    );
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop =
      maxScroll === 0 ? 0 : (bodyElement.scrollTop / maxScroll) * maxThumbTop;

    scrollbarMetricsRef.current = {
      thumbHeight,
      maxScroll,
      maxThumbTop
    };
    setScrollbarState({
      thumbHeight,
      thumbTop,
      visible: true
    });
  }

  function scrollBodyToThumbTop(nextThumbTop: number) {
    const bodyElement = bodyRef.current;
    const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
    if (!bodyElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    bodyElement.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
  }

  useEffect(() => {
    if (focusRequest <= 0) {
      return;
    }

    setFocusPulse(true);
    const pulseTimer = window.setTimeout(() => {
      setFocusPulse(false);
    }, 140);

    requestAnimationFrame(() => {
      controller.open();
      const input = inputRef.current;
      input?.focus();
      const caretPosition = input?.value.length ?? 0;
      input?.setSelectionRange(caretPosition, caretPosition);
    });

    return () => {
      window.clearTimeout(pulseTimer);
    };
  }, [controller, focusRequest]);

  useEffect(() => {
    if (!state.open) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (rootRef.current?.contains(target)) {
        return;
      }

      controller.dismiss();
    }

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
    };
  }, [controller, state.open]);

  useEffect(() => {
    if (!state.open || !state.activeResultId) {
      return;
    }

    rootRef.current
      ?.querySelector<HTMLElement>(`[data-search-result-id="${CSS.escape(state.activeResultId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [state.activeResultId, state.open]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateScrollbar();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [state.open, view.groups.length, view.warnings.length, view.stale, state.expandedGroups]);

  useEffect(() => {
    const bodyElement = bodyRef.current;
    if (!bodyElement) {
      return;
    }

    const handleResize = () => {
      updateScrollbar();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateScrollbar();
          });

    resizeObserver?.observe(bodyElement);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [state.open]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      const bodyElement = bodyRef.current;
      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (!activeDrag || !bodyElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      bodyElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
      updateScrollbar();
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

  async function activate(result: SearchResult) {
    controller.dismiss();
    if (result.kind === "pdf") {
      onGoToPage(result.pageNumber);
      return;
    }
    if (result.kind === "note" && result.blockId) {
      onRevealNoteBlock(result.blockId);
      return;
    }
    if (result.kind === "document" && result.available) {
      await onOpenDocument(result.documentId);
    }
  }

  const hasQuery = state.inputQuery.trim().length > 0;
  const hasVisibleDropdownContent = view.groups.length > 0 || view.warnings.length > 0;

  return (
    <div
      ref={rootRef}
      className={`workspace-search${state.open ? " workspace-search--open" : ""}`}
      data-no-window-drag
    >
      <label
        className={`workspace-search__field${state.open ? " workspace-search__field--active" : ""}${focusPulse ? " workspace-search__field--pulse" : ""}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={inputRef}
          value={state.inputQuery}
          aria-label="Search workspace"
          spellCheck={false}
          onFocus={() => controller.open()}
          onChange={(event) => {
            if (!state.open) {
              controller.open();
            }
            controller.setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              controller.dismiss();
              return;
            }

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              controller.moveActiveResult(event.key === "ArrowDown" ? 1 : -1);
              return;
            }

            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              controller.searchEntireDocument();
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const result = controller.getActiveResult();
              if (result) {
                void activate(result);
              }
            }
          }}
        />
        <button
          type="button"
          className={`unified-search__clear${state.inputQuery ? "" : " unified-search__clear--hidden"}`}
          aria-label="Clear search"
          aria-hidden={!state.inputQuery}
          disabled={!state.inputQuery}
          tabIndex={state.inputQuery ? 0 : -1}
          onClick={() => {
            controller.setQuery("");
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      </label>

      {state.open && hasQuery && hasVisibleDropdownContent ? (
        <section className="workspace-search__dropdown" role="dialog" aria-label="Search">
          <div className="unified-search__body-shell">
            <div
              ref={bodyRef}
              className={`unified-search__body${view.stale ? " unified-search__body--stale" : ""}`}
              onScroll={() => {
                updateScrollbar();
              }}
            >
            {view.groups.map((group) => {
              const expanded = state.expandedGroups.has(group.id);
              const displayedGroupLabel =
                group.id === "pdf-names" ? "PDFs" : group.label;
              const displayedGroupLabelNode =
                group.id === "pdf-names" ? (
                  <strong className="search-group__title">
                    <span>PDF</span>
                    <span className="search-group__title-suffix">s</span>
                  </strong>
                ) : (
                  renderGroupLabel(displayedGroupLabel)
                );
              const visible = group.results.slice(
                0,
                expanded ? group.results.length : INITIAL_LIMITS[group.id]
              );
              return (
                <section
                  className="search-group"
                  data-group={group.id}
                  key={group.id}
                  aria-label={displayedGroupLabel}
                >
                  <header className="search-group__header">
                    <div className="search-group__heading">
                      <span className="search-group__icon">
                        <GroupIcon groupId={group.id} />
                      </span>
                      <span className="search-group__decorator" aria-hidden="true">|</span>
                      {displayedGroupLabelNode}
                      <span className="search-group__count">
                        {group.countIsFinal ? group.total : `${group.total}+`}
                      </span>
                    </div>
                  </header>
                  {visible.map((result) => {
                    const meta = resultMeta(result);

                    return (
                      <button
                        type="button"
                        key={result.id}
                        data-search-result-id={result.id}
                        className={`search-result${state.activeResultId === result.id ? " search-result--active" : ""}`}
                        disabled={view.stale || (result.kind === "document" && !result.available)}
                        onMouseEnter={() => controller.setActiveResult(result.id, "pointer")}
                        onClick={() => void activate(result)}
                      >
                        <span className="search-result__leading">
                          <span className="search-result__snippet">
                            <HighlightedSnippet text={result.snippet} ranges={result.highlights} />
                          </span>
                        </span>
                        {meta ? <span className="search-result__meta">{meta}</span> : null}
                      </button>
                    );
                  })}
                  {group.results.length > INITIAL_LIMITS[group.id] ? (
                    <button
                      type="button"
                      className="search-group__more"
                      onClick={() => controller.toggleGroup(group.id)}
                    >
                      {expanded ? "Show less" : `Show all ${group.total} results >`}
                    </button>
                  ) : null}
                  {group.action ? (
                    <button
                      type="button"
                      className="search-group__action"
                      onClick={() => controller.searchEntireDocument()}
                    >
                      {group.action.label}
                    </button>
                  ) : null}
                </section>
              );
            })}
            </div>
            <div
              ref={scrollbarRef}
              className={
                scrollbarState.visible
                  ? "unified-search__scrollbar unified-search__scrollbar--visible"
                  : "unified-search__scrollbar"
              }
              aria-hidden="true"
              onPointerDown={(event) => {
                const scrollbarElement = scrollbarRef.current;
                if (!scrollbarElement || event.target !== event.currentTarget) {
                  return;
                }

                event.preventDefault();
                const trackRect = scrollbarElement.getBoundingClientRect();
                scrollBodyToThumbTop(
                  event.clientY - trackRect.top - scrollbarState.thumbHeight / 2
                );
                updateScrollbar();
              }}
            >
              <div
                className="unified-search__scrollbar-thumb"
                style={{
                  height: `${scrollbarState.thumbHeight}px`,
                  transform: `translateY(${scrollbarState.thumbTop}px)`
                }}
                onPointerDown={(event) => {
                  const bodyElement = bodyRef.current;
                  if (!bodyElement) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  scrollbarDragRef.current = {
                    pointerId: event.pointerId,
                    startClientY: event.clientY,
                    startScrollTop: bodyElement.scrollTop
                  };
                }}
              />
            </div>
          </div>

          {view.warnings.length > 0 ? (
            <div className="unified-search__warning">Some sources could not be searched.</div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
