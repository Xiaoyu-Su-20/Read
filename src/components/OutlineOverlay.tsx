import type { Bookmark, OutlineItem } from "../lib/types";
import { dedupeBookmarks } from "../lib/commands";
import { dedupeOutlineItems } from "../lib/documentReferences";

type OutlineOverlayProps = {
  open: boolean;
  items: OutlineItem[];
  bookmarks: Bookmark[];
  onClose: () => void;
  onSelect: (item: OutlineItem) => void;
  onSelectBookmark: (bookmark: Bookmark) => void;
};

function outlineSourceLabel(item: OutlineItem) {
  return item.source === "user" ? "Note" : "PDF";
}

function outlineMeta(item: OutlineItem) {
  const location = item.page ? `Page ${item.page}` : item.externalUrl ? "External" : "No target";
  return `${location} - ${outlineSourceLabel(item)}`;
}

function BookmarkMarks({
  bookmarks,
  onSelectBookmark
}: {
  bookmarks: Bookmark[];
  onSelectBookmark: (bookmark: Bookmark) => void;
}) {
  if (bookmarks.length === 0) {
    return null;
  }

  return (
    <ul className="outline-list">
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id}>
          <button className="outline-button" type="button" onClick={() => onSelectBookmark(bookmark)}>
            <span>{bookmark.label}</span>
            <small>Page {bookmark.page} - Saved</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function OutlineBranch({
  items,
  onSelect
}: {
  items: OutlineItem[];
  onSelect: (item: OutlineItem) => void;
}) {
  return (
    <ul className="outline-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className="outline-button" type="button" onClick={() => onSelect(item)}>
            <span>{item.title}</span>
            <small>{outlineMeta(item)}</small>
          </button>
          {item.items.length > 0 ? (
            <OutlineBranch items={item.items} onSelect={onSelect} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function OutlineOverlay({
  open,
  items,
  bookmarks,
  onClose,
  onSelect,
  onSelectBookmark
}: OutlineOverlayProps) {
  if (!open) {
    return null;
  }

  const savedMarks = dedupeBookmarks(bookmarks);
  const sectionMarks = dedupeOutlineItems(items);
  const hasMarks = savedMarks.length > 0 || sectionMarks.length > 0;

  return (
    <div className="overlay-shell overlay-shell--edge" role="presentation" onClick={onClose}>
      <section
        className="panel panel--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Marks"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel__header">
          <div>
            <span className="eyebrow">Marks</span>
            <h2>Saved places</h2>
          </div>
          <button className="panel__close" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {!hasMarks ? (
          <div className="empty-state empty-state--panel">
            <p>No marks in this document yet.</p>
          </div>
        ) : (
          <>
            <BookmarkMarks bookmarks={savedMarks} onSelectBookmark={onSelectBookmark} />
            <OutlineBranch items={sectionMarks} onSelect={onSelect} />
          </>
        )}
      </section>
    </div>
  );
}
