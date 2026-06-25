import { normalizeNoteBlocks } from "../../../lib/notes";
import type {
  NoteBlock,
  NoteHistoryMergeKey,
  NoteModelSelection
} from "../../../lib/types";
import type { NoteModelEdit } from "../model/noteBlockModel";
import {
  commitNoteModelHistory,
  createNoteModelHistory,
  redoNoteModelHistory,
  replaceNoteModelHistorySelection,
  undoNoteModelHistory,
  type NoteModelHistoryState
} from "./noteModelHistory";

export type { NoteModelHistoryState } from "./noteModelHistory";

export type NoteEditorRuntimeState = {
  blocks: NoteBlock[];
  history: NoteModelHistoryState | null;
  pendingSelectionRestore: NoteModelSelection | null;
  changed: boolean;
};

function blocksEqual(left: NoteBlock[], right: NoteBlock[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createNoteEditorRuntimeState(
  blocks: NoteBlock[],
  bookId: string | null | undefined,
  selection: NoteModelSelection | null = null
): NoteEditorRuntimeState {
  const normalized = normalizeNoteBlocks(blocks, bookId ?? null);
  return {
    blocks: normalized,
    history: createNoteModelHistory({ blocks: normalized, selection }),
    pendingSelectionRestore: null,
    changed: true
  };
}

export function commitNoteEditorBlocks(params: {
  currentBlocks: NoteBlock[];
  history: NoteModelHistoryState | null;
  nextBlocks: NoteBlock[];
  selection: NoteModelSelection | null;
  mergeKey: NoteHistoryMergeKey | null;
  bookId: string | null | undefined;
  render: boolean;
}): NoteEditorRuntimeState {
  const normalized = normalizeNoteBlocks(params.nextBlocks, params.bookId ?? null);
  const history = params.history;
  const nextHistory =
    !history
      ? createNoteModelHistory({ blocks: normalized, selection: params.selection })
      : blocksEqual(history.current.blocks, normalized)
        ? replaceNoteModelHistorySelection(history, params.selection)
        : commitNoteModelHistory(
            history,
            { blocks: normalized, selection: params.selection },
            params.mergeKey
          );

  return {
    blocks: normalized,
    history: nextHistory,
    pendingSelectionRestore: params.render ? params.selection : null,
    changed: !blocksEqual(params.currentBlocks, normalized)
  };
}

export function applyNoteEditorEdit(params: {
  currentBlocks: NoteBlock[];
  history: NoteModelHistoryState | null;
  edit: NoteModelEdit;
  mergeKey: NoteHistoryMergeKey | null;
  bookId: string | null | undefined;
  render?: boolean;
}): NoteEditorRuntimeState {
  return commitNoteEditorBlocks({
    currentBlocks: params.currentBlocks,
    history: params.history,
    nextBlocks: params.edit.blocks,
    selection: params.edit.selection,
    mergeKey: params.mergeKey,
    bookId: params.bookId,
    render: params.render ?? true
  });
}

export function replaceNoteEditorSelection(params: {
  history: NoteModelHistoryState | null;
  selection: NoteModelSelection | null;
}) {
  if (!params.history) {
    return null;
  }
  return replaceNoteModelHistorySelection(params.history, params.selection);
}

export function undoNoteEditorRuntime(params: {
  history: NoteModelHistoryState | null;
  bookId: string | null | undefined;
}): NoteEditorRuntimeState | null {
  const nextHistory = params.history ? undoNoteModelHistory(params.history) : null;
  if (!nextHistory) {
    return null;
  }
  const blocks = normalizeNoteBlocks(nextHistory.current.blocks, params.bookId ?? null);
  return {
    blocks,
    history: nextHistory,
    pendingSelectionRestore: nextHistory.current.selection,
    changed: true
  };
}

export function redoNoteEditorRuntime(params: {
  history: NoteModelHistoryState | null;
  bookId: string | null | undefined;
}): NoteEditorRuntimeState | null {
  const nextHistory = params.history ? redoNoteModelHistory(params.history) : null;
  if (!nextHistory) {
    return null;
  }
  const blocks = normalizeNoteBlocks(nextHistory.current.blocks, params.bookId ?? null);
  return {
    blocks,
    history: nextHistory,
    pendingSelectionRestore: nextHistory.current.selection,
    changed: true
  };
}
