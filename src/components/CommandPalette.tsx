import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { PaletteSession } from "../lib/app/palette";
import { filterPaletteItems } from "../lib/commands";

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
  const deferredQuery = useDeferredValue(session?.query ?? "");
  const [activeIndex, setActiveIndex] = useState(0);

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

  if (!open || !session) {
    return null;
  }

  const displayedActiveIndex =
    filteredItems.length === 0 ? -1 : Math.min(activeIndex, filteredItems.length - 1);

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
    <div className="overlay-shell" role="presentation" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={session.title}
        onClick={(event) => event.stopPropagation()}
      >
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
              setActiveIndex((index) => Math.min(index + 1, Math.max(immediateFilteredItems.length - 1, 0)));
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
          <ul className="palette__results" role="listbox" aria-label={session.title}>
            {filteredItems.map((item, index) => (
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
                  <span className="palette__label">
                    <strong>{item.title}</strong>
                  </span>
                  {item.meta ? <em>{item.meta}</em> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
