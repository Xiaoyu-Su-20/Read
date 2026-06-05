import { useDeferredValue, useEffect, useMemo, useRef } from "react";

import { filterPaletteItems } from "../lib/commands";
import type { PaletteItem } from "../lib/types";

export type PaletteSession =
  | {
      kind: "commands" | "select";
      title: string;
      query: string;
      items: PaletteItem[];
      emptyMessage: string;
    }
  | {
      kind: "input";
      title: string;
      query: string;
      placeholder: string;
      confirmLabel: string;
      emptyMessage?: string;
      onSubmit: (value: string) => void | Promise<void>;
    };

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

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, session?.kind]);

  const filteredItems = useMemo(() => {
    if (!session || session.kind === "input") {
      return [];
    }
    return filterPaletteItems(session.items, deferredQuery);
  }, [deferredQuery, session]);

  if (!open || !session) {
    return null;
  }

  const handleEnter = async () => {
    if (session.kind === "input") {
      await session.onSubmit(session.query);
      return;
    }

    const firstItem = filteredItems[0];
    if (firstItem) {
      await firstItem.onSelect();
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
        <div className="palette__header">
          <span className="eyebrow">Command</span>
          <h2>{session.title}</h2>
        </div>
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
            if (event.key === "Enter") {
              event.preventDefault();
              void handleEnter();
            }
          }}
        />

        {session.kind === "input" ? (
          <div className="palette__empty">
            <p>Press Enter to {session.confirmLabel.toLowerCase()}.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="palette__empty">
            <p>{session.emptyMessage}</p>
          </div>
        ) : (
          <ul className="palette__results">
            {filteredItems.map((item) => (
              <li key={item.id}>
                <button
                  className="palette__item"
                  type="button"
                  onClick={() => {
                    void item.onSelect();
                  }}
                >
                  <span>
                    <strong>{item.title}</strong>
                    {item.subtitle ? <small>{item.subtitle}</small> : null}
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
