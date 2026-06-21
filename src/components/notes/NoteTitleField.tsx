import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { textFromEditable } from "../../lib/noteEditorDom";
import type { NoteDocument } from "../../lib/types";

export type NoteTitleFieldHandle = {
  focusAndSelect: () => void;
};

type NoteTitleFieldProps = {
  note: NoteDocument | null;
  loading: boolean;
  variant?: "compact" | "standalone";
  onChangeTitle: (title: string) => void;
  onBlur: () => void | Promise<void>;
  onEscape: () => void;
  onSubmit: () => void;
};

const NoteTitleField = forwardRef<NoteTitleFieldHandle, NoteTitleFieldProps>(function NoteTitleField(
  { note, loading, onChangeTitle, onBlur, onEscape, onSubmit, variant = "compact" },
  ref
) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  const appliedNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!titleRef.current) {
      return;
    }

    if (!note) {
      titleRef.current.textContent = "";
      appliedNoteIdRef.current = null;
      return;
    }

    if (appliedNoteIdRef.current === note.id) {
      return;
    }

    titleRef.current.textContent = note.title;
    appliedNoteIdRef.current = note.id;
  }, [note]);

  useImperativeHandle(ref, () => ({
    focusAndSelect() {
      const element = titleRef.current;
      if (!element) {
        return;
      }

      element.focus();
      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }));

  return (
    <div className={`notes-title-row${variant === "standalone" ? " notes-title-row--standalone" : ""}`}>
      <div
        ref={titleRef}
        className={`notes-title-row__input${
          variant === "standalone" ? " notes-title-row__input--standalone" : ""
        }`}
        contentEditable={!loading}
        suppressContentEditableWarning
        spellCheck={false}
        data-note-title
        role="textbox"
        aria-label="Note title"
        onBlur={() => {
          void onBlur();
        }}
        onInput={() => {
          if (!titleRef.current) {
            return;
          }

          onChangeTitle(textFromEditable(titleRef.current));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onEscape();
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
});

export default NoteTitleField;
