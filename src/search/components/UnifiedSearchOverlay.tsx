import { useEffect, useRef, useSyncExternalStore } from "react";

import type { UnifiedSearchController } from "../controller/UnifiedSearchController";
import type { SearchHighlightRange, SearchResult } from "../model/SearchResult";

type UnifiedSearchOverlayProps = {
  controller: UnifiedSearchController;
  onOpenDocument: (documentId: string) => Promise<void>;
  onGoToPage: (pageNumber: number) => void;
  onRevealNoteBlock: (blockId: string) => void;
};

const INITIAL_LIMITS = {
  notes: 3,
  "current-page": 3,
  "nearby-pages": 5,
  "across-document": 5,
  documents: 5
} as const;

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
  return "Current note";
}

export default function UnifiedSearchOverlay({
  controller,
  onOpenDocument,
  onGoToPage,
  onRevealNoteBlock
}: UnifiedSearchOverlayProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (state.open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [state.open]);

  useEffect(() => {
    if (!state.activeResultId) return;
    document.querySelector<HTMLElement>(`[data-search-result-id="${CSS.escape(state.activeResultId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [state.activeResultId]);

  if (!state.open) return null;

  async function activate(result: SearchResult) {
    if (result.kind === "pdf") onGoToPage(result.pageNumber);
    else if (result.kind === "note" && result.blockId) onRevealNoteBlock(result.blockId);
    else if (result.kind === "document" && result.available) await onOpenDocument(result.documentId);
  }

  const view = state.committedView;
  const resultCount = view.groups.reduce((sum, group) => sum + group.total, 0);
  const searchActive = state.phase === "typing" || state.phase === "settling" || state.phase === "streaming";

  return (
    <div className="search-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) controller.close();
    }}>
      <section className="unified-search" role="dialog" aria-modal="true" aria-label="Search">
        <div className="unified-search__input-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            value={state.inputQuery}
            placeholder="Search the current reader..."
            aria-label="Search query"
            onChange={(event) => controller.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                controller.close();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                controller.moveActiveResult(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                controller.searchEntireDocument();
              } else if (event.key === "Enter") {
                event.preventDefault();
                const result = controller.getActiveResult();
                if (result) void activate(result);
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
            onClick={() => controller.setQuery("")}
          >
            x
          </button>
          <kbd>Ctrl F</kbd>
        </div>

        <div className={`unified-search__body${view.stale ? " unified-search__body--stale" : ""}`}>
          {view.groups.map((group) => {
              const expanded = state.expandedGroups.has(group.id);
              const visible = group.results.slice(0, expanded ? group.results.length : INITIAL_LIMITS[group.id]);
              return (
                <section className="search-group" key={group.id} aria-label={group.label}>
                  <header className="search-group__header">
                    <strong>{group.label}</strong>
                    <span>{group.countIsFinal ? group.total : `${group.total}+`}</span>
                  </header>
                  {visible.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      data-search-result-id={result.id}
                      className={`search-result${state.activeResultId === result.id ? " search-result--active" : ""}`}
                      disabled={view.stale || (result.kind === "document" && !result.available)}
                      onMouseMove={() => controller.setActiveResult(result.id, "pointer")}
                      onClick={() => void activate(result)}
                    >
                      <span className="search-result__snippet">
                        <HighlightedSnippet text={result.snippet} ranges={result.highlights} />
                      </span>
                      <span className="search-result__meta">{resultMeta(result)}</span>
                    </button>
                  ))}
                  {group.results.length > INITIAL_LIMITS[group.id] ? (
                    <button type="button" className="search-group__more" onClick={() => controller.toggleGroup(group.id)}>
                      {expanded ? "Show less" : `Show all ${group.total} results`}
                    </button>
                  ) : null}
                  {group.action ? (
                    <button type="button" className="search-group__action" onClick={() => controller.searchEntireDocument()}>
                      {group.action.label}
                    </button>
                  ) : null}
                </section>
              );
            })}
        </div>

        {state.inputQuery.trim() ? (
          <footer className="unified-search__footer">
            <span>
              {searchActive ? "Searching current reader" : state.phase === "cancelled" ? "Search cancelled" : `${resultCount} results`}
              {view.progress ? ` · ${view.progress.completedPages}/${view.progress.totalPages} pages` : ""}
            </span>
            <div>
              {searchActive ? (
                <button type="button" onClick={() => controller.cancel()}>Cancel</button>
              ) : null}
            </div>
          </footer>
        ) : null}
        {view.warnings.length > 0 ? (
          <div className="unified-search__warning">Some sources could not be searched.</div>
        ) : null}
      </section>
    </div>
  );
}
