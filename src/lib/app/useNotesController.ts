import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getOrCreateNoteForBook, saveNote } from "../api";
import { runDebugProcess, startDebugProcess } from "../debugLog";
import {
  NOTE_SAVE_DEBOUNCE_MS,
  deriveNoteNavigationItems,
  normalizeNoteBlocks,
  normalizeNoteDocument,
  noteToPlainText
} from "../notes";
import type { DocumentPayload, NoteBlock, NoteDocument } from "../types";

type UseNotesControllerArgs = {
  activeDocument: DocumentPayload | null;
  setStatusMessage: (message: string) => void;
};

export function useNotesController({
  activeDocument,
  setStatusMessage
}: UseNotesControllerArgs) {
  const activeDocumentId = activeDocument?.document.id ?? null;
  const [note, setNote] = useState<NoteDocument | null>(null);
  const [loading, setLoading] = useState(false);

  const noteRef = useRef<NoteDocument | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingFlushRef = useRef(false);

  const clearScheduledSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persistNote = useCallback(
    async (targetNote: NoteDocument, reason: string) => {
      const process = startDebugProcess("notes.save", {
        noteId: targetNote.id,
        reason
      });

      saveInFlightRef.current = true;
      try {
        const savedNote = normalizeNoteDocument(await saveNote(targetNote));
        if (noteRef.current?.id === savedNote.id) {
          noteRef.current = savedNote;
          setNote(savedNote);
          dirtyRef.current = false;
        }
        process.finish();
      } catch (error) {
        process.fail(error);
        setStatusMessage(error instanceof Error ? error.message : "Unable to save note.");
      } finally {
        saveInFlightRef.current = false;
        if (pendingFlushRef.current && noteRef.current && dirtyRef.current) {
          pendingFlushRef.current = false;
          void persistNote(noteRef.current, "rescheduled");
        }
      }
    },
    [setStatusMessage]
  );

  const flushNow = useCallback(
    async (reason: string) => {
      clearScheduledSave();

      if (!noteRef.current || !dirtyRef.current) {
        return;
      }

      if (saveInFlightRef.current) {
        pendingFlushRef.current = true;
        return;
      }

      await persistNote(noteRef.current, reason);
    },
    [clearScheduledSave, persistNote]
  );

  const scheduleSave = useCallback(() => {
    clearScheduledSave();
    saveTimerRef.current = window.setTimeout(() => {
      void flushNow("debounced");
    }, NOTE_SAVE_DEBOUNCE_MS);
  }, [clearScheduledSave, flushNow]);

  const replaceNote = useCallback((nextNote: NoteDocument) => {
    const normalized = normalizeNoteDocument(nextNote);
    noteRef.current = normalized;
    setNote(normalized);
  }, []);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    const previousNote = noteRef.current;
    if (previousNote && dirtyRef.current) {
      void persistNote(previousNote, "document-switch");
    }

    clearScheduledSave();
    dirtyRef.current = false;
    pendingFlushRef.current = false;

    if (!activeDocumentId) {
      noteRef.current = null;
      setNote(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setNote(null);
    setLoading(true);
    void runDebugProcess(
      "notes.load",
      {
        documentId: activeDocumentId
      },
      async () => {
        const loadedNote = normalizeNoteDocument(await getOrCreateNoteForBook(activeDocumentId));
        if (cancelled) {
          return;
        }
        replaceNote(loadedNote);
        dirtyRef.current = false;
        setLoading(false);
      }
    ).catch((error) => {
      if (!cancelled) {
        setLoading(false);
        setStatusMessage(error instanceof Error ? error.message : "Unable to load note.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeDocumentId, clearScheduledSave, persistNote, replaceNote, setStatusMessage]);

  useEffect(() => {
    function flushOnVisibilityChange() {
      if (window.document.visibilityState === "hidden") {
        void flushNow("document-hidden");
      }
    }

    function flushOnWindowBlur() {
      void flushNow("window-blur");
    }

    function flushOnBeforeUnload() {
      void flushNow("before-unload");
    }

    window.document.addEventListener("visibilitychange", flushOnVisibilityChange);
    window.addEventListener("blur", flushOnWindowBlur);
    window.addEventListener("beforeunload", flushOnBeforeUnload);

    return () => {
      window.document.removeEventListener("visibilitychange", flushOnVisibilityChange);
      window.removeEventListener("blur", flushOnWindowBlur);
      window.removeEventListener("beforeunload", flushOnBeforeUnload);
      clearScheduledSave();
    };
  }, [clearScheduledSave, flushNow]);

  const updateTitle = useCallback(
    (title: string) => {
      setNote((current) => {
        if (!current) {
          return current;
        }
        const nextNote = {
          ...current,
          title
        };
        noteRef.current = nextNote;
        dirtyRef.current = true;
        scheduleSave();
        return nextNote;
      });
    },
    [scheduleSave]
  );

  const updateBlocks = useCallback(
    (blocks: NoteBlock[]) => {
      setNote((current) => {
        if (!current) {
          return current;
        }
        const nextNote = {
          ...current,
          blocks: normalizeNoteBlocks(blocks, current.bookId)
        };
        noteRef.current = nextNote;
        dirtyRef.current = true;
        scheduleSave();
        return nextNote;
      });
    },
    [scheduleSave]
  );

  const copyAllText = useCallback(async () => {
    if (!noteRef.current || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(noteToPlainText(noteRef.current));
    setStatusMessage("Copied the note text.");
  }, [setStatusMessage]);

  const navigationItems = useMemo(
    () => (note ? deriveNoteNavigationItems(note.blocks) : []),
    [note]
  );

  return {
    note,
    loading,
    navigationItems,
    updateTitle,
    updateBlocks,
    flushNow,
    copyAllText
  };
}
