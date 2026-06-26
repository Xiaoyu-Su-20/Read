import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getOrCreateNoteForBook, openStandaloneNote, saveNote } from "../api";
import { debugLocalAction, runDebugProcess, startDebugProcess } from "../debugLog";
import {
  getNoteBlocksUpdateProfile,
  type NoteBlocksUpdateProfile
} from "../noteEditorPerformance";
import {
  NOTE_SAVE_DEBOUNCE_MS,
  deriveNoteNavigationItems,
  normalizeNoteBlocks,
  normalizeNoteDocument,
  noteToPlainText
} from "../notes";
import type { NoteBlock, NoteDocument } from "../types";

export type NoteTarget =
  | {
      kind: "document";
      documentId: string;
    }
  | {
      kind: "standalone";
      noteId: string;
    }
  | null;

type UseNotesControllerArgs = {
  target: NoteTarget;
  onStandaloneNoteChange?: () => unknown;
  setStatusMessage: (message: string) => void;
};

type PendingBlocksCommitProfile = NoteBlocksUpdateProfile & {
  controllerReceivedAt: number;
  normalizeElapsedMs: number;
  updaterElapsedMs: number;
  normalizedBlockCount: number;
};

export function useNotesController({
  target,
  onStandaloneNoteChange,
  setStatusMessage
}: UseNotesControllerArgs) {
  const [note, setNote] = useState<NoteDocument | null>(null);
  const [loading, setLoading] = useState(false);

  const noteRef = useRef<NoteDocument | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingFlushRef = useRef(false);
  const activeTargetKeyRef = useRef<string | null>(null);
  const pendingBlocksCommitProfilesRef = useRef<PendingBlocksCommitProfile[]>([]);

  const targetKey = useMemo(() => {
    if (!target) {
      return null;
    }
    return target.kind === "document"
      ? `document:${target.documentId}`
      : `standalone:${target.noteId}`;
  }, [
    target?.kind,
    target?.kind === "document" ? target.documentId : null,
    target?.kind === "standalone" ? target.noteId : null
  ]);

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
        if (savedNote.bookId === null) {
          void Promise.resolve(onStandaloneNoteChange?.()).catch(() => undefined);
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
    if (!note || pendingBlocksCommitProfilesRef.current.length === 0) {
      return;
    }

    const pendingProfile = pendingBlocksCommitProfilesRef.current.shift();
    if (!pendingProfile) {
      return;
    }

    debugLocalAction("notes.performance.blocks-propagation-committed", {
      noteId: note.id,
      updateId: pendingProfile.id,
      source: pendingProfile.source,
      blockCount: pendingProfile.blockCount,
      normalizedBlockCount: pendingProfile.normalizedBlockCount,
      editorToControllerMs: Math.round(
        pendingProfile.controllerReceivedAt - pendingProfile.startedAt
      ),
      controllerToCommittedNoteMs: Math.round(
        performance.now() - pendingProfile.controllerReceivedAt
      ),
      totalElapsedMs: Math.round(performance.now() - pendingProfile.startedAt),
      normalizeElapsedMs: Math.round(pendingProfile.normalizeElapsedMs),
      updaterElapsedMs: Math.round(pendingProfile.updaterElapsedMs)
    });
  }, [note?.blocks, note?.id]);

  useEffect(() => {
    const previousTargetKey = activeTargetKeyRef.current;
    const targetChanged = previousTargetKey !== targetKey;

    const previousNote = noteRef.current;
    if (targetChanged && previousNote && dirtyRef.current) {
      void persistNote(previousNote, "document-switch");
    }

    clearScheduledSave();
    dirtyRef.current = false;
    pendingFlushRef.current = false;
    pendingBlocksCommitProfilesRef.current = [];
    activeTargetKeyRef.current = targetKey;

    if (!target) {
      noteRef.current = null;
      setNote(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    if (targetChanged) {
      setNote(null);
    }
    void runDebugProcess(
      "notes.load",
      target.kind === "document"
        ? {
            documentId: target.documentId,
            target: "document"
          }
        : {
            noteId: target.noteId,
            target: "standalone"
          },
      async () => {
        const loadedNote = normalizeNoteDocument(
          target.kind === "document"
            ? await getOrCreateNoteForBook(target.documentId)
            : await openStandaloneNote(target.noteId)
        );
        if (cancelled) {
          return;
        }
        replaceNote(loadedNote);
        dirtyRef.current = false;
        setLoading(false);
        if (target.kind === "standalone") {
          void Promise.resolve(onStandaloneNoteChange?.()).catch(() => undefined);
        }
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
  }, [
    clearScheduledSave,
    onStandaloneNoteChange,
    persistNote,
    replaceNote,
    setStatusMessage,
    targetKey
  ]);

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
      const updateProfile = getNoteBlocksUpdateProfile(blocks);
      const controllerReceivedAt = performance.now();
      if (updateProfile) {
        debugLocalAction("notes.performance.blocks-propagation-received", {
          noteId: updateProfile.noteId,
          updateId: updateProfile.id,
          source: updateProfile.source,
          blockCount: updateProfile.blockCount,
          editorToControllerMs: Math.round(controllerReceivedAt - updateProfile.startedAt)
        });
      }

      setNote((current) => {
        if (!current) {
          return current;
        }
        const updaterStartedAt = performance.now();
        const normalizeStartedAt = performance.now();
        const normalizedBlocks = normalizeNoteBlocks(blocks, current.bookId);
        const normalizeElapsedMs = performance.now() - normalizeStartedAt;
        const nextNote = {
          ...current,
          blocks: normalizedBlocks
        };
        noteRef.current = nextNote;
        dirtyRef.current = true;
        scheduleSave();
        if (updateProfile) {
          const updaterElapsedMs = performance.now() - updaterStartedAt;
          pendingBlocksCommitProfilesRef.current.push({
            ...updateProfile,
            controllerReceivedAt,
            normalizeElapsedMs,
            updaterElapsedMs,
            normalizedBlockCount: normalizedBlocks.length
          });
          debugLocalAction("notes.performance.blocks-propagation-updated", {
            noteId: current.id,
            updateId: updateProfile.id,
            source: updateProfile.source,
            blockCount: updateProfile.blockCount,
            normalizedBlockCount: normalizedBlocks.length,
            editorToControllerMs: Math.round(
              controllerReceivedAt - updateProfile.startedAt
            ),
            normalizeElapsedMs: Math.round(normalizeElapsedMs),
            updaterElapsedMs: Math.round(updaterElapsedMs)
          });
        }
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
