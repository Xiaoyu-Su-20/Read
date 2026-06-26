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

function pointsEqual(left: NoteModelSelection["anchor"], right: NoteModelSelection["anchor"]) {
  return (
    left.blockId === right.blockId &&
    left.inlineIndex === right.inlineIndex &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity
  );
}

function selectionsEqual(left: NoteModelSelection | null, right: NoteModelSelection | null) {
  if (!left || !right) {
    return left === right;
  }

  return pointsEqual(left.anchor, right.anchor) && pointsEqual(left.focus, right.focus);
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
  const history = params.history;
  const blocksChanged = params.nextBlocks !== params.currentBlocks;
  const selectionChanged = !selectionsEqual(history?.current.selection ?? null, params.selection);

  if (!history) {
    const initialHistory = createNoteModelHistory({
      blocks: params.nextBlocks,
      selection: params.selection
    });
    return {
      blocks: params.nextBlocks,
      history: initialHistory,
      pendingSelectionRestore: params.render ? params.selection : null,
      changed: blocksChanged
    };
  }

  if (!blocksChanged && !selectionChanged) {
    return {
      blocks: params.currentBlocks,
      history,
      pendingSelectionRestore: null,
      changed: false
    };
  }

  const nextHistory =
    !blocksChanged
      ? replaceNoteModelHistorySelection(history, params.selection)
      : commitNoteModelHistory(
          history,
          { blocks: params.nextBlocks, selection: params.selection },
          params.mergeKey
        );

  return {
    blocks: params.nextBlocks,
    history: nextHistory,
    pendingSelectionRestore: params.render ? params.selection : null,
    changed: blocksChanged
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
  return {
    blocks: nextHistory.current.blocks,
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
  return {
    blocks: nextHistory.current.blocks,
    history: nextHistory,
    pendingSelectionRestore: nextHistory.current.selection,
    changed: true
  };
}
