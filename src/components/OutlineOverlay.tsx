import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Bookmark, OutlineItem } from "../lib/types";
import { dedupeBookmarks } from "../lib/commands";
import { makeBookmark } from "../lib/app/helpers";

export type MarksPopoverTab = "outline" | "bookmarks";
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type OutlineOverlayProps = {
  anchorElement?: HTMLElement | null;
  currentPage: number;
  open: boolean;
  items: OutlineItem[];
  bookmarks: Bookmark[];
  onClose: () => void;
  onAddBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onRenameBookmark: (bookmark: Bookmark, nextLabel: string) => void;
  onSelect: (item: OutlineItem) => void;
  onSelectBookmark: (bookmark: Bookmark) => void;
};

type FlatOutlineNode = {
  ancestorIds: string[];
  item: OutlineItem;
};

function BookmarkGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function OverflowGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <circle cx="12" cy="5.5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18.5" r="1.6" />
    </svg>
  );
}

function flattenOutlineNodes(items: OutlineItem[], ancestorIds: string[] = []): FlatOutlineNode[] {
  return items.flatMap((item) => [
    {
      ancestorIds,
      item
    },
    ...flattenOutlineNodes(item.items ?? [], [...ancestorIds, item.id])
  ]);
}

function sortBookmarksByPage(bookmarks: Bookmark[]) {
  return [...bookmarks].sort((left, right) => {
    if (left.page !== right.page) {
      return left.page - right.page;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function defaultMarksPopoverTab(items: OutlineItem[], bookmarks: Bookmark[]): MarksPopoverTab {
  const hasOutline = items.length > 0;
  const hasBookmarks = dedupeBookmarks(bookmarks).length > 0;
  return hasOutline && !hasBookmarks ? "outline" : "bookmarks";
}

export function initialExpandedOutlineIds(items: OutlineItem[], currentPage: number | null): string[] {
  const firstExpandableRoot = items.find((item) => item.items.length > 0);
  if (!currentPage) {
    return firstExpandableRoot ? [firstExpandableRoot.id] : [];
  }

  const flatItems = flattenOutlineNodes(items).filter(({ item }) => item.page !== null);
  const closest = flatItems.sort((left, right) => {
    const leftPage = left.item.page ?? 0;
    const rightPage = right.item.page ?? 0;
    const leftBefore = leftPage <= currentPage;
    const rightBefore = rightPage <= currentPage;

    if (leftBefore !== rightBefore) {
      return leftBefore ? -1 : 1;
    }

    const distance = Math.abs(leftPage - currentPage) - Math.abs(rightPage - currentPage);
    if (distance !== 0) {
      return distance;
    }

    return leftBefore ? rightPage - leftPage : leftPage - rightPage;
  })[0];

  if (!closest) {
    return firstExpandableRoot ? [firstExpandableRoot.id] : [];
  }

  const expandedIds = [...closest.ancestorIds];
  if (closest.item.items.length > 0) {
    expandedIds.push(closest.item.id);
  }

  return expandedIds.length > 0
    ? expandedIds
    : firstExpandableRoot
      ? [firstExpandableRoot.id]
      : [];
}

function OutlineBranch({
  depth,
  expandedIds,
  items,
  onSelect,
  onToggle
}: {
  depth: number;
  expandedIds: Set<string>;
  items: OutlineItem[];
  onSelect: (item: OutlineItem) => void;
  onToggle: (itemId: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="marks-popover__outline-branch" role="group">
      {items.map((item) => {
        const hasChildren = item.items.length > 0;
        const isExpanded = expandedIds.has(item.id);

        return (
          <div
            key={item.id}
            className="marks-popover__outline-node"
            style={{ ["--marks-outline-depth" as string]: String(depth) }}
          >
            <div className="marks-popover__outline-row-shell">
              {hasChildren ? (
                <button
                  className={`marks-popover__outline-toggle${
                    isExpanded ? " marks-popover__outline-toggle--expanded" : ""
                  }`}
                  type="button"
                  aria-label={isExpanded ? "Collapse section" : "Expand section"}
                  aria-expanded={isExpanded}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggle(item.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d={isExpanded ? "m8 10 4 4 4-4" : "m10 8 4 4-4 4"} />
                  </svg>
                </button>
              ) : (
                <span className="marks-popover__outline-toggle-spacer" aria-hidden="true" />
              )}

              <button
                className={`marks-popover__outline-row${depth === 0 ? " marks-popover__outline-row--chapter" : ""}`}
                type="button"
                onClick={() => onSelect(item)}
              >
                <span className="marks-popover__outline-title">{item.title}</span>
                {item.page ? (
                  <span className="marks-popover__outline-page">{item.page}</span>
                ) : (
                  <span className="marks-popover__outline-page marks-popover__outline-page--empty" />
                )}
              </button>
            </div>

            {hasChildren && isExpanded ? (
              <OutlineBranch
                depth={depth + 1}
                expandedIds={expandedIds}
                items={item.items}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function BookmarksTab({
  bookmarks,
  editingBookmarkId,
  editingValue,
  menuOpenId,
  onDeleteBookmark,
  onChangeEditingValue,
  onRenameBookmark,
  onStartRenameBookmark,
  onStopRenameBookmark,
  onSelectBookmark,
  onToggleBookmarkMenu
}: {
  bookmarks: Bookmark[];
  editingBookmarkId: string | null;
  editingValue: string;
  menuOpenId: string | null;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onChangeEditingValue: (value: string) => void;
  onRenameBookmark: (bookmark: Bookmark) => void;
  onStartRenameBookmark: (bookmark: Bookmark) => void;
  onStopRenameBookmark: () => void;
  onSelectBookmark: (bookmark: Bookmark) => void;
  onToggleBookmarkMenu: (bookmarkId: string) => void;
}) {
  if (bookmarks.length === 0) {
    return (
      <div className="marks-popover__empty-state">
        <p>No bookmarks in this document yet.</p>
      </div>
    );
  }

  return (
    <div className="marks-popover__bookmark-list" role="list">
      {bookmarks.map((bookmark) => {
        const menuOpen = menuOpenId === bookmark.id;
        const isEditing = editingBookmarkId === bookmark.id;

        return (
          <div key={bookmark.id} className="marks-popover__bookmark-item" role="listitem">
            {isEditing ? (
              <form
                className="marks-popover__bookmark-row marks-popover__bookmark-row--editing"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRenameBookmark(bookmark);
                }}
              >
                <span className="marks-popover__bookmark-icon" aria-hidden="true">
                  <BookmarkGlyph />
                </span>
                <input
                  className="marks-popover__bookmark-input"
                  type="text"
                  value={editingValue}
                  spellCheck={false}
                  autoFocus
                  onChange={(event) => {
                    onChangeEditingValue(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onStopRenameBookmark();
                    }
                  }}
                />
                <span className="marks-popover__bookmark-page">{bookmark.page}</span>
              </form>
            ) : (
              <button
                className="marks-popover__bookmark-row"
                type="button"
                onClick={() => onSelectBookmark(bookmark)}
              >
                <span className="marks-popover__bookmark-icon" aria-hidden="true">
                  <BookmarkGlyph />
                </span>
                <span className="marks-popover__bookmark-label">{bookmark.label}</span>
                <span className="marks-popover__bookmark-page">{bookmark.page}</span>
              </button>
            )}

            <div className="marks-popover__bookmark-actions">
              <button
                className={`marks-popover__bookmark-menu-trigger${
                  menuOpen ? " marks-popover__bookmark-menu-trigger--active" : ""
                }`}
                type="button"
                aria-label={`Bookmark actions for ${bookmark.label}`}
                aria-expanded={menuOpen}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleBookmarkMenu(bookmark.id);
                }}
              >
                <OverflowGlyph />
              </button>

              {menuOpen ? (
                <div className="marks-popover__bookmark-menu" role="menu">
                  <button
                    className="marks-popover__bookmark-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onStartRenameBookmark(bookmark);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="marks-popover__bookmark-menu-item marks-popover__bookmark-menu-item--danger"
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteBookmark(bookmark);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OutlineOverlay({
  anchorElement,
  currentPage,
  open,
  items,
  bookmarks,
  onClose,
  onAddBookmark,
  onDeleteBookmark,
  onRenameBookmark,
  onSelect,
  onSelectBookmark
}: OutlineOverlayProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const sectionMarks = useMemo(() => items, [items]);
  const savedMarks = useMemo(() => sortBookmarksByPage(dedupeBookmarks(bookmarks)), [bookmarks]);
  const [activeTab, setActiveTab] = useState<MarksPopoverTab>(() => defaultMarksPopoverTab(items, bookmarks));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(initialExpandedOutlineIds(sectionMarks, currentPage))
  );
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [popoverStyle, setPopoverStyle] = useState<{
    height: number;
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);

  useClientLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return;
    }

    setActiveTab(defaultMarksPopoverTab(sectionMarks, savedMarks));
    setExpandedIds(new Set(initialExpandedOutlineIds(sectionMarks, currentPage)));
    setMenuOpenId(null);
    setEditingBookmarkId(null);
    setEditingValue("");
  }, [currentPage, open, savedMarks, sectionMarks]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePopoverPosition() {
      const maxViewportWidth = window.innerWidth;
      const maxViewportHeight = window.innerHeight;
      const nextWidth = Math.min(320, Math.max(240, maxViewportWidth - 16));
      const nextMaxHeight = Math.min(640, Math.max(280, maxViewportHeight - 16));
      const anchorRect = anchorElement?.getBoundingClientRect();
      const nextLeft = anchorRect
        ? Math.max(8, Math.min(anchorRect.right + 12, maxViewportWidth - nextWidth - 8))
        : 76;
      const nextTop = anchorRect
        ? Math.max(8, Math.min(anchorRect.top - 8, maxViewportHeight - nextMaxHeight - 8))
        : 84;

      setPopoverStyle({
        height: nextMaxHeight,
        left: nextLeft,
        maxHeight: nextMaxHeight,
        top: nextTop,
        width: nextWidth
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

  if (!open) {
    return null;
  }

  const hasOutline = sectionMarks.length > 0;

  return (
    <section
      ref={popoverRef}
      className="marks-popover"
      data-positioned={popoverStyle !== null}
      role="dialog"
      aria-label="Document marks"
      style={popoverStyle ?? undefined}
      onClick={() => {
        setMenuOpenId(null);
        setEditingBookmarkId(null);
      }}
    >
      <div className="marks-popover__header">
        <div className="marks-popover__tabs" role="tablist" aria-label="Document marks">
          <button
            className={`marks-popover__tab${activeTab === "outline" ? " marks-popover__tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "outline"}
            onClick={() => {
              setActiveTab("outline");
              setMenuOpenId(null);
            }}
          >
            Outline
          </button>
          <button
            className={`marks-popover__tab${activeTab === "bookmarks" ? " marks-popover__tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "bookmarks"}
            onClick={() => {
              setActiveTab("bookmarks");
              setMenuOpenId(null);
            }}
          >
            Bookmarks
          </button>
        </div>
        <button
          className="marks-popover__add-bookmark"
          type="button"
          aria-label="Add bookmark for current page"
          onClick={() => {
            setMenuOpenId(null);
            setEditingBookmarkId(null);
            onAddBookmark(makeBookmark(currentPage));
          }}
        >
          +
        </button>
      </div>

      <div className="marks-popover__body" role="tabpanel">
        {activeTab === "outline" ? (
          hasOutline ? (
            <OutlineBranch
              depth={0}
              expandedIds={expandedIds}
              items={sectionMarks}
              onSelect={(item) => {
                setMenuOpenId(null);
                onSelect(item);
              }}
              onToggle={(itemId) => {
                setExpandedIds((current) => {
                  const next = new Set(current);
                  if (next.has(itemId)) {
                    next.delete(itemId);
                  } else {
                    next.add(itemId);
                  }
                  return next;
                });
              }}
            />
          ) : (
            <div className="marks-popover__empty-state">
              <p>No outline available for this document.</p>
            </div>
          )
        ) : (
          <BookmarksTab
            bookmarks={savedMarks}
            editingBookmarkId={editingBookmarkId}
            editingValue={editingValue}
            menuOpenId={menuOpenId}
            onChangeEditingValue={setEditingValue}
            onDeleteBookmark={(bookmark) => {
              setMenuOpenId(null);
              setEditingBookmarkId(null);
              onDeleteBookmark(bookmark);
            }}
            onRenameBookmark={(bookmark) => {
              const nextLabel = editingValue.trim();
              if (!nextLabel) {
                setEditingBookmarkId(null);
                setEditingValue("");
                return;
              }
              setMenuOpenId(null);
              setEditingBookmarkId(null);
              setEditingValue("");
              onRenameBookmark(bookmark, nextLabel);
            }}
            onSelectBookmark={(bookmark) => {
              setMenuOpenId(null);
              onSelectBookmark(bookmark);
            }}
            onStartRenameBookmark={(bookmark) => {
              setMenuOpenId(null);
              setEditingBookmarkId(bookmark.id);
              setEditingValue(bookmark.label);
            }}
            onStopRenameBookmark={() => {
              setEditingBookmarkId(null);
              setEditingValue("");
            }}
            onToggleBookmarkMenu={(bookmarkId) => {
              setEditingBookmarkId(null);
              setMenuOpenId((current) => (current === bookmarkId ? null : bookmarkId));
            }}
          />
        )}
      </div>
    </section>
  );
}
