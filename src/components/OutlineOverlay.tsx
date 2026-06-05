import type { OutlineItem } from "../lib/types";

type OutlineOverlayProps = {
  open: boolean;
  items: OutlineItem[];
  onClose: () => void;
  onSelect: (item: OutlineItem) => void;
};

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
            {item.page ? <small>Page {item.page}</small> : null}
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
  onClose,
  onSelect
}: OutlineOverlayProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="overlay-shell overlay-shell--edge" role="presentation" onClick={onClose}>
      <section
        className="panel panel--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Outline"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel__header">
          <div>
            <span className="eyebrow">Outline</span>
            <h2>Document map</h2>
          </div>
          <button className="panel__close" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {items.length === 0 ? (
          <div className="empty-state empty-state--panel">
            <p>This PDF does not expose an outline.</p>
          </div>
        ) : (
          <OutlineBranch items={items} onSelect={onSelect} />
        )}
      </section>
    </div>
  );
}
