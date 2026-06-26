import type {
  NoteBlock,
  NoteHistoryMergeKey,
  NoteModelSelection
} from "../../../lib/types";

export const NOTE_MODEL_HISTORY_MERGE_WINDOW_MS = 1000;
export const NOTE_MODEL_HISTORY_MAX_UNDO = 100;

export type NoteModelHistoryEntry = {
  blocks: NoteBlock[];
  selection: NoteModelSelection | null;
};

export type NoteModelHistoryState = {
  undoStack: NoteModelHistoryEntry[];
  current: NoteModelHistoryEntry;
  redoStack: NoteModelHistoryEntry[];
  lastCommit: {
    mergeKey: NoteHistoryMergeKey;
    timestamp: number;
  } | null;
};

function cloneSelection(selection: NoteModelSelection | null) {
  if (!selection) {
    return null;
  }

  return {
    anchor: { ...selection.anchor },
    focus: { ...selection.focus }
  } satisfies NoteModelSelection;
}

function snapshotEntry(entry: NoteModelHistoryEntry): NoteModelHistoryEntry {
  return {
    blocks: entry.blocks,
    selection: cloneSelection(entry.selection)
  };
}

export function createNoteModelHistory(initial: NoteModelHistoryEntry): NoteModelHistoryState {
  return {
    undoStack: [],
    current: snapshotEntry(initial),
    redoStack: [],
    lastCommit: null
  };
}

export function replaceNoteModelHistorySelection(
  state: NoteModelHistoryState,
  selection: NoteModelSelection | null
): NoteModelHistoryState {
  return {
    ...state,
    current: {
      ...state.current,
      selection: cloneSelection(selection)
    }
  };
}

export function commitNoteModelHistory(
  state: NoteModelHistoryState,
  next: NoteModelHistoryEntry,
  mergeKey: NoteHistoryMergeKey | null,
  timestamp = Date.now()
): NoteModelHistoryState {
  const canMerge =
    mergeKey !== null &&
    state.lastCommit?.mergeKey === mergeKey &&
    timestamp - state.lastCommit.timestamp <= NOTE_MODEL_HISTORY_MERGE_WINDOW_MS;
  const undoStack = canMerge
    ? state.undoStack
    : [...state.undoStack, state.current].slice(-NOTE_MODEL_HISTORY_MAX_UNDO);
  return {
    undoStack,
    current: snapshotEntry(next),
    redoStack: [],
    lastCommit: mergeKey ? { mergeKey, timestamp } : null
  };
}

export function undoNoteModelHistory(state: NoteModelHistoryState) {
  if (state.undoStack.length === 0) {
    return null;
  }
  const previous = state.undoStack[state.undoStack.length - 1];
  if (!previous) {
    return null;
  }
  return {
    undoStack: state.undoStack.slice(0, -1),
    current: previous,
    redoStack: [...state.redoStack, state.current],
    lastCommit: null
  } satisfies NoteModelHistoryState;
}

export function redoNoteModelHistory(state: NoteModelHistoryState) {
  if (state.redoStack.length === 0) {
    return null;
  }
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) {
    return null;
  }
  return {
    undoStack: [...state.undoStack, state.current].slice(-NOTE_MODEL_HISTORY_MAX_UNDO),
    current: next,
    redoStack: state.redoStack.slice(0, -1),
    lastCommit: null
  } satisfies NoteModelHistoryState;
}
